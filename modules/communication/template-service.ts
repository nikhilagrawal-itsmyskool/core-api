import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { Channel } from './communication-constants';
import { DEFAULTS } from './communication-constants';
import { MessageTemplate, CreateTemplateRequest, UpdateTemplateRequest } from './communication-interfaces';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class TemplateService {
  public async list(schoolId: string): Promise<MessageTemplate[]> {
    return DB.query(
      singleLineString`
        select * from message_template
        where school_id = $1 and status <> 'deleted'
        order by key, channel
      `,
      [schoolId],
    );
  }

  public async getById(id: string, schoolId: string): Promise<MessageTemplate | null> {
    const rows = await DB.query(
      singleLineString`select * from message_template where uuid = $1 and school_id = $2 and status <> 'deleted'`,
      [id, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  // Active templates for a logical key, indexed by channel. Prefers an exact
  // language match, then a language-less template. Drives channel availability
  // and per-recipient template selection in the send flow.
  public async getActiveByKey(schoolId: string, key: string, language: string): Promise<Map<Channel, MessageTemplate>> {
    const rows: MessageTemplate[] = await DB.query(
      singleLineString`
        select * from message_template
        where school_id = $1 and lower(key) = lower($2) and status = 'active'
      `,
      [schoolId, key],
    );
    const byChannel = new Map<Channel, MessageTemplate>();
    for (const t of rows) {
      const existing = byChannel.get(t.channel);
      if (!existing) { byChannel.set(t.channel, t); continue; }
      // Prefer an exact language match over a fallback.
      const existingExact = existing.language === language;
      const candidateExact = t.language === language;
      if (candidateExact && !existingExact) byChannel.set(t.channel, t);
    }
    return byChannel;
  }

  public async create(data: CreateTemplateRequest, schoolId: string, userId: string): Promise<MessageTemplate> {
    if (!data.key || !data.key.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, 'key is required');
    if (data.channel !== 'sms' && data.channel !== 'whatsapp') throw new BusinessErrorResult(ErrorCode.BusinessError, 'channel must be sms or whatsapp');
    const language = (data.language && data.language.trim()) || DEFAULTS.LANGUAGE;

    const dup = await DB.query(
      singleLineString`
        select 1 from message_template
        where school_id = $1 and lower(key) = lower($2) and channel = $3 and coalesce(language, '') = $4 and status = 'active' limit 1
      `,
      [schoolId, data.key.trim(), data.channel, language],
    );
    if (dup.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Template "${data.key}" (${data.channel}/${language}) already exists`);
    }

    const uuid = generateShortUuid(12);
    const now = new Date();
    const rows = await DB.query(
      singleLineString`
        insert into message_template
        (uuid, school_id, key, name, channel, language, provider, provider_template_id, category, header_type, body_preview, variables, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        returning *
      `,
      [
        uuid, schoolId, data.key.trim(), data.name || null, data.channel, language,
        data.provider || DEFAULTS.PROVIDER, data.providerTemplateId || null, data.category || null,
        data.headerType || 'none', data.bodyPreview || null,
        data.variables ? JSON.stringify(data.variables) : null,
        DEFAULTS.STATUS, userId, now,
      ],
    );
    return rows[0];
  }

  public async update(id: string, data: UpdateTemplateRequest, schoolId: string, userId: string): Promise<MessageTemplate | null> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;

    const rows = await DB.query(
      singleLineString`
        update message_template set
          name = $1, language = coalesce($2, language), provider = coalesce($3, provider),
          provider_template_id = coalesce($4, provider_template_id), category = coalesce($5, category),
          header_type = coalesce($6, header_type), body_preview = coalesce($7, body_preview),
          variables = coalesce($8, variables), status = coalesce($9, status),
          updatedby_userid = $10, updated_at = $11
        where uuid = $12 and school_id = $13 and status <> 'deleted'
        returning *
      `,
      [
        data.name !== undefined ? data.name : existing.name,
        data.language || null, data.provider || null, data.providerTemplateId || null,
        data.category || null, data.headerType || null, data.bodyPreview || null,
        data.variables ? JSON.stringify(data.variables) : null,
        data.status || null, userId, new Date(), id, schoolId,
      ],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<void> {
    await DB.query(
      singleLineString`
        update message_template set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status <> 'deleted'
      `,
      [userId, new Date(), id, schoolId],
    );
  }

  public async restore(id: string, schoolId: string, userId: string): Promise<MessageTemplate | null> {
    const rows = await DB.query(
      singleLineString`
        update message_template set status = 'active', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'deleted'
        returning *
      `,
      [userId, new Date(), id, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }
}

export const templateService = new TemplateService();
