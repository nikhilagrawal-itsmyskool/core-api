import { DB, singleLineString } from "../../shared/lib/db";
import { templateService } from "./template-service";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

// The per-school MESSAGE TYPE registry (the single data-driven source of truth for
// module-event messaging). Each row is a logical message type:
//   key          — the id a module emits (e.g. 'fee_receipt')
//   label, group — display
//   templateKey  — which SMS/WhatsApp template this type sends on (defaults to key)
//   channels     — inApp / sms / whatsapp / studentPref (studentPref = the preference ladder)
// Created explicitly (like templates) — seeded with the known keys, CRUD in the god-only
// Config screen. A send for a key NOT in the registry is skipped (never auto-created).
export interface ChannelSet {
  inApp: boolean;
  sms: boolean;
  whatsapp: boolean;
  studentPref: boolean;
}

export interface MessageType extends ChannelSet {
  key: string;
  label: string;
  group: string;
  templateKey: string;
}

export interface MessageTypeView extends MessageType {
  smsTemplate: boolean;      // an active SMS template exists for templateKey
  whatsappTemplate: boolean; // an active WhatsApp template exists for templateKey
}

interface MessageTypeDef { key: string; label: string; group: string; def: ChannelSet; }
const ch = (inApp: boolean, sms: boolean, whatsapp: boolean, studentPref: boolean): ChannelSet => ({ inApp, sms, whatsapp, studentPref });

// Shipped defaults, seeded once so today's module events work day one. Beyond these,
// types are created in the screen. "nudge, don't spam": receipts/absence = in-app +
// each parent's preferred channel; homework/report-card = in-app only.
export const MESSAGE_TYPES: MessageTypeDef[] = [
  { key: "fee_receipt",           label: "Fee receipt",           group: "Fees",       def: ch(true, false, false, true) },
  { key: "attendance_absent",     label: "Student absent",        group: "Attendance", def: ch(true, false, false, true) },
  { key: "transport_absent",      label: "Transport absent",      group: "Attendance", def: ch(true, false, false, true) },
  { key: "homework_posted",       label: "Homework posted",       group: "Academics",  def: ch(true, false, false, false) },
  { key: "exam_report_published", label: "Report card published", group: "Academics",  def: ch(true, false, false, false) },
  { key: "school_closure",        label: "School closure",        group: "General",    def: ch(true, false, false, true) },
];
const CAT: Record<string, MessageTypeDef> = Object.fromEntries(MESSAGE_TYPES.map((m) => [m.key, m]));

const LANG = "en"; // template availability check (getActiveByKey also matches language-less rows)

class MessagePolicyService {
  async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const rows = await DB.query(singleLineString`select uuid from school where lower(code) = lower($1)`, [schoolCode]);
    return rows.length ? rows[0].uuid : null;
  }

  private rowToType(r: any): MessageType {
    const key = r.messageKey;
    return {
      key,
      label: r.label || CAT[key]?.label || key,
      group: r.groupName || CAT[key]?.group || "General",
      templateKey: r.templateKey || key,
      inApp: !!r.inApp, sms: !!r.sms, whatsapp: !!r.whatsapp, studentPref: !!r.studentPref,
    };
  }

  // Full registry for the Config screen, each type enriched with template availability.
  async list(schoolId: string): Promise<MessageTypeView[]> {
    await this.seedKnown(schoolId);
    const rows = await DB.query(
      singleLineString`select message_key, label, group_name, template_key, in_app, sms, whatsapp, student_pref
        from message_policy where school_id = $1 order by group_name nulls last, message_key`,
      [schoolId],
    );
    const out: MessageTypeView[] = [];
    for (const r of rows) {
      const t = this.rowToType(r);
      const templates = await templateService.getActiveByKey(schoolId, t.templateKey, LANG);
      out.push({ ...t, smsTemplate: templates.has("sms" as any), whatsappTemplate: templates.has("whatsapp" as any) });
    }
    return out;
  }

  // Insert any shipped keys the school doesn't have yet (known set only — never from a send).
  private async seedKnown(schoolId: string): Promise<void> {
    const existing = await DB.query(
      singleLineString`select message_key from message_policy where school_id = $1`, [schoolId],
    );
    const have = new Set(existing.map((r: any) => r.messageKey));
    const now = new Date();
    for (const m of MESSAGE_TYPES) {
      if (have.has(m.key)) continue;
      await DB.query(
        singleLineString`insert into message_policy
          (uuid, school_id, message_key, label, group_name, template_key, in_app, sms, whatsapp, student_pref, updatedby_userid, updated_at, created_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
          on conflict (school_id, message_key) do nothing`,
        [generateShortUuid(12), schoolId, m.key, m.label, m.group, m.key, m.def.inApp, m.def.sms, m.def.whatsapp, m.def.studentPref, "system", now],
      );
    }
  }

  // Explicit create (god screen). Rejects a duplicate key.
  async create(schoolId: string, data: { key: string; label?: string; group?: string; templateKey?: string } & Partial<ChannelSet>, userId: string): Promise<{ ok: boolean; reason?: string }> {
    const key = (data.key || "").trim();
    if (!key) return { ok: false, reason: "key is required" };
    const dup = await DB.query(singleLineString`select 1 from message_policy where school_id = $1 and message_key = $2`, [schoolId, key]);
    if (dup.length) return { ok: false, reason: `Message type "${key}" already exists` };
    const now = new Date();
    await DB.query(
      singleLineString`insert into message_policy
        (uuid, school_id, message_key, label, group_name, template_key, in_app, sms, whatsapp, student_pref, updatedby_userid, updated_at, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
      [generateShortUuid(12), schoolId, key, data.label || key, data.group || "General", (data.templateKey || key).trim(),
        !!data.inApp, !!data.sms, !!data.whatsapp, !!data.studentPref, userId, now],
    );
    return { ok: true };
  }

  // Update label/group/templateKey + channels for an existing type.
  async update(schoolId: string, key: string, data: { label?: string; group?: string; templateKey?: string } & Partial<ChannelSet>, userId: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`update message_policy set
          label = coalesce($3, label), group_name = coalesce($4, group_name), template_key = coalesce($5, template_key),
          in_app = $6, sms = $7, whatsapp = $8, student_pref = $9, updatedby_userid = $10, updated_at = $11
        where school_id = $1 and message_key = $2 returning uuid`,
      [schoolId, key, data.label ?? null, data.group ?? null, data.templateKey ?? null,
        !!data.inApp, !!data.sms, !!data.whatsapp, !!data.studentPref, userId, new Date()],
    );
    return rows.length > 0;
  }

  // Resolve a type for a SEND. Returns null when the key isn't registered (→ caller skips
  // + logs; we never auto-create at send time).
  async resolveType(schoolId: string, key: string): Promise<MessageType | null> {
    const rows = await DB.query(
      singleLineString`select message_key, label, group_name, template_key, in_app, sms, whatsapp, student_pref
        from message_policy where school_id = $1 and message_key = $2`,
      [schoolId, key],
    );
    return rows.length ? this.rowToType(rows[0]) : null;
  }
}

export const messagePolicyService = new MessagePolicyService();
