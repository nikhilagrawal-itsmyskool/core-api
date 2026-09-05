import { DB, singleLineString } from "../../shared/lib/db";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

export type NotifyRecipientType = "employee" | "student";

export interface CreateNotificationInput {
  schoolId: string;
  recipientType: NotifyRecipientType;
  recipientIds: string[];
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
    const ids = [...new Set((input.recipientIds || []).filter(Boolean))];
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

  async list(
    schoolId: string,
    recipientType: NotifyRecipientType,
    recipientId: string,
    opts: { unreadOnly?: boolean; limit?: number } = {},
  ): Promise<{ items: NotificationView[]; unreadCount: number }> {
    const limit = Math.min(Math.max(opts.limit || 50, 1), 200);
    const conds = ["school_id = $1", "recipient_type = $2", "recipient_id = $3"];
    if (opts.unreadOnly) conds.push("read_at is null");
    const rows = await DB.query(
      singleLineString`select uuid, key, title, body, entity_type, entity_id, read_at::text as read_at, created_at::text as created_at
        from notification where ${conds.join(" and ")}
        order by created_at desc nulls last limit ${limit}`,
      [schoolId, recipientType, recipientId],
    );
    const unread = await DB.query(
      singleLineString`select count(1)::int as n from notification
        where school_id = $1 and recipient_type = $2 and recipient_id = $3 and read_at is null`,
      [schoolId, recipientType, recipientId],
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
      })),
      unreadCount: unread[0].n,
    };
  }

  async markRead(schoolId: string, recipientType: NotifyRecipientType, recipientId: string, id: string): Promise<void> {
    await DB.query(
      singleLineString`update notification set read_at = $1
        where uuid = $2 and school_id = $3 and recipient_type = $4 and recipient_id = $5 and read_at is null`,
      [new Date(), id, schoolId, recipientType, recipientId],
    );
  }

  async markAllRead(schoolId: string, recipientType: NotifyRecipientType, recipientId: string): Promise<void> {
    await DB.query(
      singleLineString`update notification set read_at = $1
        where school_id = $2 and recipient_type = $3 and recipient_id = $4 and read_at is null`,
      [new Date(), schoolId, recipientType, recipientId],
    );
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
      const tokens = await DB.query(
        singleLineString`select token from device_token
          where school_id = $1 and recipient_type = $2 and recipient_id = any($3) and status = 'active'`,
        [schoolId, recipientType, recipientIds],
      );
      if (!tokens.length) return;
      const messages = tokens.map((t: any) => ({ to: t.token, title, body, sound: "default" }));
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
