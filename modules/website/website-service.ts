import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { fileStorageService } from "../../shared/lib/file-storage";
import { ContentfulClient } from "./contentful-client";
import {
  getConfig,
  getCmaToken,
  getSourceMoment,
  listSourceMoments,
  findEmployeeName,
} from "./website-common";
import {
  EVENT_TYPES,
  ACADEMIC_SESSIONS,
  EVENT_MEMORIES_MIN,
  EVENT_MEMORIES_MAX,
} from "./website-constants";
import {
  PushEventRequest,
  PublicationView,
  CtfTag,
  WebsiteConfig,
} from "./website-interfaces";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

class WebsiteService {
  // Resolve the school's Contentful client, or a clear business error if not configured.
  private async client(schoolId: string): Promise<{ client: ContentfulClient; config: WebsiteConfig }> {
    const config = await getConfig(schoolId);
    if (!config) throw new BusinessErrorResult(ErrorCode.BusinessError, "Website publishing is not enabled for this school");
    const token = getCmaToken();
    if (!token) throw new BusinessErrorResult(ErrorCode.BusinessError, "Contentful token is not configured");
    return { client: new ContentfulClient(config.spaceId, config.environment, token, config.defaultLocale), config };
  }

  async isEnabled(schoolId: string): Promise<boolean> {
    return (await getConfig(schoolId)) !== null;
  }

  async listTags(schoolId: string): Promise<CtfTag[]> {
    const { client } = await this.client(schoolId);
    return client.listTags();
  }

  // ── Source (Moments) passthrough ───────────────────────────────────────────────

  async sourceMoments(schoolCode: string, status?: string) {
    return listSourceMoments(schoolCode, status);
  }

  async sourceMoment(schoolCode: string, momentId: string) {
    return getSourceMoment(schoolCode, momentId);
  }

  // ── Push: Moments photos -> tagged Contentful assets + a School Event entry ─────
  // The HTTP call only QUEUES the push (fast: validate + record). The slow Contentful work
  // (many asset uploads can exceed the 29s API-Gateway limit) runs in processNextPush, driven
  // by an EventBridge worker. The UI polls the publication's push_status / push_detail.

  async queueEventPush(schoolId: string, schoolCode: string, req: PushEventRequest, userId: string): Promise<PublicationView> {
    await this.client(schoolId); // ensures the module is configured (throws otherwise)
    const f = req.fields || ({} as any);
    if (!f.eventTitle?.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, "Event title is required");
    if (!f.eventDetails?.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, "Event details are required");
    if (!f.eventDate) throw new BusinessErrorResult(ErrorCode.BusinessError, "Event date is required");
    const eventType = (f.eventType || []).filter((x: string) => (EVENT_TYPES as readonly string[]).includes(x));
    if (!eventType.length) throw new BusinessErrorResult(ErrorCode.BusinessError, "Pick at least one event type");
    const academicSession = (f.academicSession || []).filter((x: string) => (ACADEMIC_SESSIONS as readonly string[]).includes(x));
    if (!academicSession.length) throw new BusinessErrorResult(ErrorCode.BusinessError, "Pick at least one academic session");
    const photos = req.photos || [];
    if (photos.length < EVENT_MEMORIES_MIN || photos.length > EVENT_MEMORIES_MAX) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Select between ${EVENT_MEMORIES_MIN} and ${EVENT_MEMORIES_MAX} photos`);
    }
    if (!req.sourceMomentId) throw new BusinessErrorResult(ErrorCode.BusinessError, "sourceMomentId is required");

    // Resolve each selected photo to its file_id (bytes retrieved later by the worker).
    const moment = await getSourceMoment(schoolCode, req.sourceMomentId);
    if (!moment) throw new BusinessErrorResult(ErrorCode.BusinessError, "Source moment not found");
    const byId = new Map(moment.photos.map((p) => [p.photoId, p]));
    for (const sel of photos) {
      const src = byId.get(sel.photoId);
      if (!src || !src.fileId) throw new BusinessErrorResult(ErrorCode.BusinessError, `Photo ${sel.photoId} not in this moment`);
    }

    const pubId = generateShortUuid(12);
    const now = new Date();
    const fieldsJson = {
      fields: { eventTitle: f.eventTitle.trim(), eventDetails: f.eventDetails.trim(), eventDate: f.eventDate, eventType, academicSession },
      entryTags: req.entryTags || [],
      publish: !!req.publish,
    };
    await DB.query(
      singleLineString`insert into website_publication
          (uuid, school_id, content_type, contentful_status, push_status, push_detail, source_moment_id, title, fields_json, status, createdby_userid, created_at)
        values ($1, $2, 'event', 'draft', 'queued', $3, $4, $5, $6, 'active', $7, $8)`,
      [pubId, schoolId, `0/${photos.length} photos`, req.sourceMomentId, f.eventTitle.trim().slice(0, 256), JSON.stringify(fieldsJson), userId, now],
    );
    let seq = 0;
    for (const sel of photos) {
      const src = byId.get(sel.photoId)!;
      await DB.query(
        singleLineString`insert into website_publication_asset
            (uuid, school_id, publication_id, source_photo_id, file_id, tags_json, seq, status, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, 'active', $8)`,
        [generateShortUuid(12), schoolId, pubId, sel.photoId, src.fileId, JSON.stringify(sel.tags || []), seq++, now],
      );
    }
    await this.audit(schoolId, pubId, "create", `queued event push (${photos.length} photos)`, userId);
    return this.getPublication(schoolId, pubId) as Promise<PublicationView>;
  }

  // Worker step: claim one pending publication and run its Contentful uploads + entry creation.
  // Resumable — assets already uploaded (contentful_asset_id set) are skipped. Returns 1 if it
  // processed something, 0 if the queue is empty.
  async processNextPush(): Promise<number> {
    const due = await DB.query(
      singleLineString`select uuid, school_id from website_publication
        where push_status = 'queued' or (push_status = 'processing' and updated_at < now() - interval '5 minutes')
        order by created_at asc limit 1`,
    );
    if (!due.length) return 0;
    const pub = due[0];
    await DB.query(singleLineString`update website_publication set push_status = 'processing', updated_at = $1 where uuid = $2`, [new Date(), pub.uuid]);
    try {
      const { client } = await this.client(pub.schoolId);
      const row = (await DB.query(singleLineString`select fields_json, contentful_entry_id from website_publication where uuid = $1`, [pub.uuid]))[0];
      const fj = row.fieldsJson;
      const assets = await DB.query(
        singleLineString`select uuid, file_id, tags_json, contentful_asset_id, seq from website_publication_asset
          where publication_id = $1 and status = 'active' order by seq asc`,
        [pub.uuid],
      );
      const assetIds: string[] = [];
      for (let i = 0; i < assets.length; i++) {
        const a = assets[i];
        let assetId = a.contentfulAssetId;
        if (!assetId) {
          const stored = await fileStorageService.getWithData(a.fileId, pub.schoolId);
          if (!stored) throw new Error(`photo bytes unavailable (${a.fileId})`);
          assetId = await client.uploadAndPublishAsset({
            buffer: Buffer.from(stored.data, "base64"),
            fileName: stored.fileName || `${a.uuid}.jpg`,
            mimeType: stored.mimeType || "image/jpeg",
            title: fj.fields.eventTitle,
            tagIds: a.tagsJson || [],
          });
          await DB.query(singleLineString`update website_publication_asset set contentful_asset_id = $1, updated_at = $2 where uuid = $3`, [assetId, new Date(), a.uuid]);
        }
        assetIds.push(assetId);
        await DB.query(singleLineString`update website_publication set push_detail = $1, updated_at = $2 where uuid = $3`, [`${i + 1}/${assets.length} photos`, new Date(), pub.uuid]);
      }

      let entryId = row.contentfulEntryId;
      let contentfulStatus = "draft";
      let publishedAt: Date | null = null;
      if (!entryId) {
        const rawFields = {
          eventTitle: fj.fields.eventTitle,
          eventDetails: fj.fields.eventDetails,
          eventDate: fj.fields.eventDate,
          eventMemories: assetIds.map((id) => ContentfulClient.assetLink(id)),
          eventType: fj.fields.eventType,
          academicSession: fj.fields.academicSession,
        };
        const entry = await client.createEntry("event", rawFields, fj.entryTags || []);
        entryId = entry.id;
        if (fj.publish) { await client.publishEntry(entry.id, entry.version); contentfulStatus = "published"; publishedAt = new Date(); }
      }
      await DB.query(
        singleLineString`update website_publication
          set contentful_entry_id = $1, contentful_status = $2, push_status = 'done', push_detail = $3, published_at = $4, updated_at = $5
          where uuid = $6`,
        [entryId, contentfulStatus, `${assets.length}/${assets.length} done`, publishedAt, new Date(), pub.uuid],
      );
      await this.audit(pub.schoolId, pub.uuid, "push", `event ${entryId} (${assetIds.length} assets, ${contentfulStatus})`, "scheduler");
      return 1;
    } catch (e: any) {
      await DB.query(singleLineString`update website_publication set push_status = 'failed', push_detail = $1, updated_at = $2 where uuid = $3`, [String(e.message || e).slice(0, 256), new Date(), pub.uuid]);
      return 1;
    }
  }

  async publishPublication(schoolId: string, id: string, userId: string): Promise<PublicationView | null> {
    const p = await DB.query(
      singleLineString`select contentful_entry_id, contentful_status from website_publication where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    if (!p.length) return null;
    if (!p[0].contentfulEntryId) throw new BusinessErrorResult(ErrorCode.BusinessError, "Nothing to publish");
    if (p[0].contentfulStatus === "published") throw new BusinessErrorResult(ErrorCode.BusinessError, "Already published");
    const { client } = await this.client(schoolId);
    const version = await client.entryVersion(p[0].contentfulEntryId);
    await client.publishEntry(p[0].contentfulEntryId, version);
    await DB.query(
      singleLineString`update website_publication set contentful_status = 'published', published_at = $1, updatedby_userid = $2, updated_at = $1 where uuid = $3`,
      [new Date(), userId, id],
    );
    await this.audit(schoolId, id, "publish", null, userId);
    return this.getPublication(schoolId, id);
  }

  // ── Reads ──────────────────────────────────────────────────────────────────────

  async listPublications(schoolId: string, limit = 50): Promise<PublicationView[]> {
    const rows = await DB.query(
      singleLineString`select p.uuid, p.content_type, p.contentful_entry_id, p.contentful_status, p.push_status, p.push_detail, p.title, p.source_moment_id,
          p.createdby_userid, p.created_at::text as created_at, p.published_at::text as published_at,
          (select count(1)::int from website_publication_asset a where a.publication_id = p.uuid and a.status = 'active') as asset_count
        from website_publication p
        where p.school_id = $1 and p.status = 'active'
        order by p.created_at desc limit ${Math.min(limit, 200)}`,
      [schoolId],
    );
    const out: PublicationView[] = [];
    for (const r of rows) {
      out.push({
        uuid: r.uuid,
        contentType: r.contentType,
        contentfulEntryId: r.contentfulEntryId || null,
        contentfulStatus: r.contentfulStatus,
        pushStatus: r.pushStatus,
        pushDetail: r.pushDetail || null,
        title: r.title || null,
        sourceMomentId: r.sourceMomentId || null,
        assetCount: r.assetCount,
        createdbyName: r.createdbyUserid ? await findEmployeeName(schoolId, r.createdbyUserid) : null,
        createdAt: r.createdAt || null,
        publishedAt: r.publishedAt || null,
      });
    }
    return out;
  }

  async getPublication(schoolId: string, id: string): Promise<PublicationView | null> {
    const rows = await DB.query(
      singleLineString`select uuid, content_type, contentful_entry_id, contentful_status, push_status, push_detail, title, source_moment_id, fields_json,
          createdby_userid, created_at::text as created_at, published_at::text as published_at,
          (select count(1)::int from website_publication_asset a where a.publication_id = website_publication.uuid and a.status = 'active') as asset_count
        from website_publication where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      uuid: r.uuid,
      contentType: r.contentType,
      contentfulEntryId: r.contentfulEntryId || null,
      contentfulStatus: r.contentfulStatus,
      pushStatus: r.pushStatus,
      pushDetail: r.pushDetail || null,
      title: r.title || null,
      sourceMomentId: r.sourceMomentId || null,
      assetCount: r.assetCount,
      fields: r.fieldsJson || null,
      createdbyName: r.createdbyUserid ? await findEmployeeName(schoolId, r.createdbyUserid) : null,
      createdAt: r.createdAt || null,
      publishedAt: r.publishedAt || null,
    };
  }

  private async audit(schoolId: string, publicationId: string | null, action: string, detail: string | null, userId: string): Promise<void> {
    await DB.query(
      singleLineString`insert into website_audit (uuid, school_id, publication_id, action, detail, changedby_userid, changed_at)
        values ($1, $2, $3, $4, $5, $6, $7)`,
      [generateShortUuid(12), schoolId, publicationId, action, detail ? detail.slice(0, 512) : null, userId, new Date()],
    );
  }
}

export const websiteService = new WebsiteService();
