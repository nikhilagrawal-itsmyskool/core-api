import { DB, singleLineString } from "../../shared/lib/db";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

// The per-school message-routing policy. For each message TYPE (key), which channels fire:
//   inApp        — the free in-app inbox + push
//   sms          — force SMS to every recipient
//   whatsapp     — force WhatsApp to every recipient
//   studentPref  — resolve each recipient's own preference (WhatsApp-first ladder)
// Multiple may be on (e.g. inApp + studentPref). Senders dedupe per physical channel so a
// recipient never gets the same message twice (e.g. SMS ticked AND their preference is SMS).
export interface ChannelSet {
  inApp: boolean;
  sms: boolean;
  whatsapp: boolean;
  studentPref: boolean;
}

export interface MessageTypeView extends ChannelSet {
  key: string;
  label: string;
  group: string;
}

// The configurable catalog. Defaults follow the "nudge, don't spam" product rule: receipts
// and absence go in-app + the family's preferred channel; homework/report-card are in-app only.
// OTP and other transactional-security messages are deliberately NOT here (never reconfigurable).
interface MessageTypeDef { key: string; label: string; group: string; def: ChannelSet; }
const ch = (inApp: boolean, sms: boolean, whatsapp: boolean, studentPref: boolean): ChannelSet => ({ inApp, sms, whatsapp, studentPref });

export const MESSAGE_TYPES: MessageTypeDef[] = [
  { key: "fee_receipt",          label: "Fee receipt",           group: "Fees",       def: ch(true, false, false, true) },
  { key: "attendance_absent",    label: "Student absent",        group: "Attendance", def: ch(true, false, false, true) },
  { key: "transport_absent",     label: "Transport absent",      group: "Attendance", def: ch(true, false, false, true) },
  { key: "homework_posted",      label: "Homework posted",       group: "Academics",  def: ch(true, false, false, false) },
  { key: "exam_report_published", label: "Report card published", group: "Academics",  def: ch(true, false, false, false) },
  { key: "school_closure",       label: "School closure",        group: "General",    def: ch(true, false, false, true) },
];

const BY_KEY: Record<string, MessageTypeDef> = Object.fromEntries(MESSAGE_TYPES.map((m) => [m.key, m]));

class MessagePolicyService {
  async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const rows = await DB.query(singleLineString`select uuid from school where lower(code) = lower($1)`, [schoolCode]);
    return rows.length ? rows[0].uuid : null;
  }

  // Full catalog with the school's current (or default) channel set per type. Seeds any
  // missing rows with the catalog default so the screen and resolver agree.
  async list(schoolId: string): Promise<MessageTypeView[]> {
    const rows = await DB.query(
      singleLineString`select message_key, in_app, sms, whatsapp, student_pref from message_policy where school_id = $1`,
      [schoolId],
    );
    const have: Record<string, ChannelSet> = {};
    for (const r of rows) have[r.messageKey] = { inApp: !!r.inApp, sms: !!r.sms, whatsapp: !!r.whatsapp, studentPref: !!r.studentPref };

    const now = new Date();
    for (const m of MESSAGE_TYPES) {
      if (have[m.key]) continue;
      await DB.query(
        singleLineString`insert into message_policy
          (uuid, school_id, message_key, in_app, sms, whatsapp, student_pref, updatedby_userid, updated_at, created_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
          on conflict (school_id, message_key) do nothing`,
        [generateShortUuid(12), schoolId, m.key, m.def.inApp, m.def.sms, m.def.whatsapp, m.def.studentPref, "system", now],
      );
      have[m.key] = m.def;
    }
    return MESSAGE_TYPES.map((m) => ({ key: m.key, label: m.label, group: m.group, ...have[m.key] }));
  }

  // Set the channels for one message type (god-only screen). Unknown keys are rejected.
  async upsert(schoolId: string, messageKey: string, channels: ChannelSet, userId: string): Promise<boolean> {
    if (!BY_KEY[messageKey]) return false;
    const now = new Date();
    await DB.query(
      singleLineString`insert into message_policy
        (uuid, school_id, message_key, in_app, sms, whatsapp, student_pref, updatedby_userid, updated_at, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
        on conflict (school_id, message_key)
        do update set in_app = $4, sms = $5, whatsapp = $6, student_pref = $7, updatedby_userid = $8, updated_at = $9`,
      [generateShortUuid(12), schoolId, messageKey, !!channels.inApp, !!channels.sms, !!channels.whatsapp, !!channels.studentPref, userId, now],
    );
    return true;
  }

  // Resolve the channels for a message type (used by senders). Falls back to the catalog
  // default if the school has no row yet — never throws for a known key.
  async resolveChannels(schoolId: string, messageKey: string): Promise<ChannelSet> {
    const rows = await DB.query(
      singleLineString`select in_app, sms, whatsapp, student_pref from message_policy where school_id = $1 and message_key = $2`,
      [schoolId, messageKey],
    );
    if (rows.length) {
      const r = rows[0];
      return { inApp: !!r.inApp, sms: !!r.sms, whatsapp: !!r.whatsapp, studentPref: !!r.studentPref };
    }
    return BY_KEY[messageKey]?.def || ch(true, false, false, true);
  }
}

export const messagePolicyService = new MessagePolicyService();
