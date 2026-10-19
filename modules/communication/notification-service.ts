import { DB, singleLineString } from "../../shared/lib/db";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

// 'family' is used only for device tokens (a shared parent-app phone). Notification
// inbox rows are still written per 'student' | 'employee'.
export type NotifyRecipientType = "employee" | "student" | "family";

export interface CreateNotificationInput {
  schoolId: string;
  recipientType: NotifyRecipientType;
  recipientIds: string[];
  all?: boolean; // when true, ignore recipientIds and target every active recipient of this type
  key?: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  userId?: string;
}

export interface NotificationView {
  uuid: string;
  key: string | null;
  title: string | null;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string | null;
  // Which child this notification is about (student inbox only). Lets the family
  // app show one combined inbox with a per-item child label.
  studentId: string | null;
  studentName: string | null;
}

// In-app notification inbox. Rows are written synchronously (free, instant); a
// best-effort push to any registered native device follows. Never part of the
// SMS/WhatsApp message_job queue.
class NotificationService {
  async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const rows = await DB.query(singleLineString`select uuid from school where lower(code) = lower($1)`, [schoolCode]);
    return rows.length ? rows[0].uuid : null;
  }

  async create(input: CreateNotificationInput): Promise<{ created: number }> {
    let ids = [...new Set((input.recipientIds || []).filter(Boolean))];
    // Broadcast: resolve every active employee/student of the school.
    if (input.all) {
      const table = input.recipientType === "employee" ? "employee" : "student";
      const rows = await DB.query(
        singleLineString`select uuid from ${table} where school_id = $1 and status = 'active'`,
        [input.schoolId],
      );
      ids = rows.map((r: any) => r.uuid);
    }
    if (!ids.length || !input.title) return { created: 0 };
    const now = new Date();
    for (const rid of ids) {
      await DB.query(
        singleLineString`insert into notification
          (uuid, school_id, recipient_type, recipient_id, key, title, body, entity_type, entity_id, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [generateShortUuid(12), input.schoolId, input.recipientType, rid, input.key || null, input.title.slice(0, 128),
          input.body || null, input.entityType || null, input.entityId || null, input.userId || "system", now],
      );
    }
    // Best-effort push; never blocks or throws.
    this.pushToRecipients(input.schoolId, input.recipientType, ids, input.title, input.body || "").catch(() => {});
    return { created: ids.length };
  }

  // The family (parent) app lists ALL its children's notifications in one inbox, so
  // recipientIds is an array (a single id for the employee inbox). Student notifications
  // carry the child's name so the app can label each item.
  async list(
    schoolId: string,
    recipientType: "employee" | "student",
    recipientIds: string[],
    opts: { unreadOnly?: boolean; limit?: number } = {},
  ): Promise<{ items: NotificationView[]; unreadCount: number }> {
    if (!recipientIds.length) return { items: [], unreadCount: 0 };
    const limit = Math.min(Math.max(opts.limit || 50, 1), 200);
    const conds = ["n.school_id = $1", "n.recipient_type = $2", "n.recipient_id = any($3)"];
    if (opts.unreadOnly) conds.push("n.read_at is null");
    const nameJoin = recipientType === "student"
      ? "left join student s on s.uuid = n.recipient_id and s.school_id = n.school_id"
      : "";
    const nameSel = recipientType === "student" ? "s.name as student_name" : "null as student_name";
    const rows = await DB.query(
      singleLineString`select n.uuid, n.key, n.title, n.body, n.entity_type, n.entity_id,
          n.recipient_id, ${nameSel}, n.read_at::text as read_at, n.created_at::text as created_at
        from notification n ${nameJoin}
        where ${conds.join(" and ")}
        order by n.created_at desc nulls last limit ${limit}`,
      [schoolId, recipientType, recipientIds],
    );
    const unread = await DB.query(
      singleLineString`select count(1)::int as n from notification
        where school_id = $1 and recipient_type = $2 and recipient_id = any($3) and read_at is null`,
      [schoolId, recipientType, recipientIds],
    );
    return {
      items: rows.map((r: any) => ({
        uuid: r.uuid,
        key: r.key || null,
        title: r.title || null,
        body: r.body || null,
        entityType: r.entityType || null,
        entityId: r.entityId || null,
        readAt: r.readAt || null,
        createdAt: r.createdAt || null,
        studentId: recipientType === "student" ? r.recipientId || null : null,
        studentName: r.studentName || null,
      })),
      unreadCount: unread[0].n,
    };
  }

  async markRead(schoolId: string, recipientType: "employee" | "student", recipientIds: string[], id: string): Promise<void> {
    if (!recipientIds.length) return;
    await DB.query(
      singleLineString`update notification set read_at = $1
        where uuid = $2 and school_id = $3 and recipient_type = $4 and recipient_id = any($5) and read_at is null`,
      [new Date(), id, schoolId, recipientType, recipientIds],
    );
  }

  async markAllRead(schoolId: string, recipientType: "employee" | "student", recipientIds: string[]): Promise<void> {
    if (!recipientIds.length) return;
    await DB.query(
      singleLineString`update notification set read_at = $1
        where school_id = $2 and recipient_type = $3 and recipient_id = any($4) and read_at is null`,
      [new Date(), schoolId, recipientType, recipientIds],
    );
  }

  // Resolve a child → its family login number + all sibling student uuids (active),
  // so the parent app's inbox/device scope spans the whole family.
  async resolveFamily(schoolId: string, studentId: string): Promise<{ familyNumber: string | null; studentIds: string[] }> {
    const fam = await DB.query(
      singleLineString`select family_unique_number from student where uuid = $1 and school_id = $2`,
      [studentId, schoolId],
    );
    const familyNumber = (fam[0]?.familyUniqueNumber || "").trim() || null;
    if (!familyNumber) return { familyNumber: null, studentIds: [studentId] };
    const sibs = await DB.query(
      singleLineString`select uuid from student where school_id = $1 and family_unique_number = $2
        and (status is null or status <> 'deleted')`,
      [schoolId, familyNumber],
    );
    const studentIds = sibs.map((r: any) => r.uuid);
    return { familyNumber, studentIds: studentIds.length ? studentIds : [studentId] };
  }

  async registerDevice(
    schoolId: string,
    recipientType: NotifyRecipientType,
    recipientId: string,
    platform: string,
    token: string,
  ): Promise<void> {
    const now = new Date();
    // Re-point an existing token to this recipient (device handed over / re-login).
    const existing = await DB.query(
      singleLineString`select uuid from device_token where school_id = $1 and token = $2 and status = 'active'`,
      [schoolId, token],
    );
    if (existing.length) {
      await DB.query(
        singleLineString`update device_token set recipient_type = $1, recipient_id = $2, platform = $3, last_seen = $4, updated_at = $4
          where uuid = $5`,
        [recipientType, recipientId, platform, now, existing[0].uuid],
      );
      return;
    }
    await DB.query(
      singleLineString`insert into device_token (uuid, school_id, recipient_type, recipient_id, platform, token, status, last_seen, created_at)
        values ($1, $2, $3, $4, $5, $6, 'active', $7, $7)`,
      [generateShortUuid(12), schoolId, recipientType, recipientId, platform, token, now],
    );
  }

  async unregisterDevice(schoolId: string, token: string): Promise<void> {
    await DB.query(
      singleLineString`update device_token set status = 'deleted', updated_at = $1 where school_id = $2 and token = $3 and status = 'active'`,
      [new Date(), schoolId, token],
    );
  }

  // Best-effort push to Expo. No-op unless EXPO_PUSH_ENABLED is set (phase 1: the
  // inbox works everywhere; real push lights up once the app registers tokens + the
  // APNs key is configured). Never throws.
  private async pushToRecipients(
    schoolId: string,
    recipientType: NotifyRecipientType,
    recipientIds: string[],
    title: string,
    body: string,
  ): Promise<void> {
    if (String(process.env.EXPO_PUSH_ENABLED || "").toLowerCase() !== "true") return;
    try {
      let messages: any[] = [];
      if (recipientType === "student") {
        // A student notification goes to the FAMILY's shared device(s). Resolve each
        // child → family number → family tokens, and label the push with the child's
        // name (the phone serves all siblings).
        const kids = await DB.query(
          singleLineString`select uuid, name, family_unique_number from student
            where school_id = $1 and uuid = any($2)`,
          [schoolId, recipientIds],
        );
        for (const k of kids) {
          const familyNumber = (k.familyUniqueNumber || "").trim();
          if (!familyNumber) continue;
          const toks = await DB.query(
            singleLineString`select token from device_token where school_id = $1
              and recipient_type = 'family' and recipient_id = $2 and status = 'active'`,
            [schoolId, familyNumber],
          );
          const childBody = k.name ? (body ? `${k.name}: ${body}` : k.name) : body;
          for (const t of toks) {
            messages.push({ to: t.token, title, body: childBody, sound: "default", data: { studentId: k.uuid } });
          }
        }
      } else {
        const toks = await DB.query(
          singleLineString`select token from device_token
            where school_id = $1 and recipient_type = $2 and recipient_id = any($3) and status = 'active'`,
          [schoolId, recipientType, recipientIds],
        );
        messages = toks.map((t: any) => ({ to: t.token, title, body, sound: "default" }));
      }
      if (!messages.length) return;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers,
        body: JSON.stringify(messages),
      });
    } catch (err: any) {
      console.error(`[communication] push error: ${err.message}`);
    }
  }
}

export const notificationService = new NotificationService();
