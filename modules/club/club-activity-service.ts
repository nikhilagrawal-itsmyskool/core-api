import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { writeAudit } from "./club-common";
import {
  ActivityDetail,
  ActivityListItem,
  CreateActivityRequest,
  MaterialLine,
  UpdateDraftRequest,
  VersionContent,
  VersionView,
} from "./club-interfaces";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

export interface ActivityFilters {
  clubId?: string;
  gradeLevel?: string;
  category?: string;
  versionStatus?: string;
  availability?: string;
  search?: string;
}

// The activity bank: stable identity (club_activity) + versioned content
// (club_activity_version) + structured material lines. Enforces the core rules —
// opaque codes, immutable approved versions, one Approved version in normal use.
class ClubActivityService {
  // ── Read ──────────────────────────────────────────────────────────────────

  async listActivities(schoolId: string, f: ActivityFilters): Promise<ActivityListItem[]> {
    const where: string[] = ["a.school_id = $1"];
    const params: any[] = [schoolId];
    const add = (clause: string, val: any) => { params.push(val); where.push(clause.replace("$?", `$${params.length}`)); };
    if (f.clubId) add("a.club_id = $?", f.clubId);
    if (f.availability) add("a.availability = $?", f.availability);
    if (f.gradeLevel) add("v.grade_level = $?", f.gradeLevel);
    if (f.category) add("v.category = $?", f.category);
    if (f.versionStatus) add("v.status = $?", f.versionStatus);
    if (f.search && f.search.trim()) {
      const s = `%${f.search.trim().toLowerCase()}%`;
      params.push(s);
      const i = params.length;
      where.push(
        `(lower(v.title) like $${i} or lower(coalesce(v.learning_outcome,'')) like $${i}
          or lower(coalesce(v.category,'')) like $${i} or lower(coalesce(v.materials_summary,'')) like $${i}
          or lower(coalesce(v.related_vocabulary,'')) like $${i})`,
      );
    }
    const rows = await DB.query(
      `select a.uuid, a.activity_code, a.club_id, a.availability, a.current_version_id,
              v.version_no as current_version_no, v.status as current_version_status,
              v.title, v.grade_level, v.category
         from club_activity a
         left join club_activity_version v on v.uuid = a.current_version_id
        where ${where.join(" and ")}
        order by v.grade_level nulls last, v.recommended_sequence nulls last, v.title`,
      params,
    );
    return rows.map((r: any) => ({
      uuid: r.uuid,
      activityCode: r.activityCode,
      clubId: r.clubId,
      availability: r.availability,
      title: r.title,
      gradeLevel: r.gradeLevel || undefined,
      category: r.category || undefined,
      currentVersionId: r.currentVersionId || undefined,
      currentVersionNo: r.currentVersionNo ?? undefined,
      currentVersionStatus: r.currentVersionStatus || undefined,
    }));
  }

  async getActivity(schoolId: string, activityId: string): Promise<ActivityDetail | null> {
    const a = await DB.query(
      singleLineString`select uuid, activity_code, club_id, availability, current_version_id
        from club_activity where uuid = $1 and school_id = $2`,
      [activityId, schoolId],
    );
    if (!a.length) return null;
    const versions = await DB.query(
      singleLineString`select uuid, version_no, status, title, approved_at
        from club_activity_version where activity_id = $1 order by version_no desc`,
      [activityId],
    );
    const currentId = a[0].currentVersionId;
    const current = currentId ? await this._versionView(currentId) : undefined;
    return {
      uuid: a[0].uuid,
      activityCode: a[0].activityCode,
      clubId: a[0].clubId,
      availability: a[0].availability,
      currentVersion: current || undefined,
      versions: versions.map((v: any) => ({
        uuid: v.uuid, versionNo: v.versionNo, status: v.status, title: v.title,
        approvedAt: v.approvedAt || null,
      })),
    };
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  async createActivity(schoolId: string, body: CreateActivityRequest, userId: string): Promise<ActivityDetail> {
    const code = (body.activityCode || "").trim();
    if (!code) throw new BusinessErrorResult(ErrorCode.InvalidInput, "activityCode is required");
    if (!body.clubId) throw new BusinessErrorResult(ErrorCode.InvalidInput, "clubId is required");
    if (!body.content || !body.content.title) throw new BusinessErrorResult(ErrorCode.InvalidInput, "content.title is required");

    const club = await DB.query(singleLineString`select uuid from club where uuid = $1 and school_id = $2`, [body.clubId, schoolId]);
    if (!club.length) throw new BusinessErrorResult(ErrorCode.InvalidInput, "Club not found");

    const dup = await DB.query(
      singleLineString`select uuid from club_activity where school_id = $1 and lower(activity_code) = lower($2)`,
      [schoolId, code],
    );
    if (dup.length) throw new BusinessErrorResult(ErrorCode.BusinessError, `Activity code already exists: ${code}`);

    const activityId = generateShortUuid(12);
    const versionId = generateShortUuid(12);
    // Activity created as 'available' (gate is the version status); v1 is a hidden Draft.
    await DB.query(
      singleLineString`insert into club_activity
          (uuid, school_id, club_id, activity_code, availability, current_version_id, createdby_userid, created_at)
        values ($1,$2,$3,$4,'available',$5,$6,now())`,
      [activityId, schoolId, body.clubId, code, versionId, userId],
    );
    await this._insertVersion(schoolId, activityId, versionId, 1, "draft", body.content, userId);
    if (body.materials?.length) await this._replaceMaterials(schoolId, versionId, body.materials);
    await writeAudit(schoolId, userId, "activity.create", "activity", activityId, { after: { activityCode: code } });
    return (await this.getActivity(schoolId, activityId))!;
  }

  // Edit the latest version IN PLACE — allowed only while it is a Draft (approved/trial/
  // superseded versions are immutable; use createRevision instead).
  async updateDraft(schoolId: string, activityId: string, body: UpdateDraftRequest, userId: string): Promise<ActivityDetail | null> {
    const v = await this._latestVersion(schoolId, activityId);
    if (!v) return null;
    if (v.status !== "draft") {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "Only a Draft version can be edited — create a revision first");
    }
    await this._updateVersionContent(v.uuid, body, userId);
    return this.getActivity(schoolId, activityId);
  }

  // Clone the current/approved version content into a new Draft (version_no+1). The approved
  // version stays current until the new one is approved; history is preserved.
  async createRevision(schoolId: string, activityId: string, userId: string): Promise<ActivityDetail | null> {
    const latest = await this._latestVersion(schoolId, activityId);
    if (!latest) return null;
    if (latest.status === "draft") {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "A Draft revision already exists");
    }
    const src = await this._versionView(latest.uuid);
    const newId = generateShortUuid(12);
    await this._insertVersion(schoolId, activityId, newId, latest.versionNo + 1, "draft", src!, userId);
    const mats = await this._materials(latest.uuid);
    if (mats.length) await this._replaceMaterials(schoolId, newId, mats);
    await writeAudit(schoolId, userId, "activity.revise", "activity", activityId, { after: { versionNo: latest.versionNo + 1 } });
    return this.getActivity(schoolId, activityId);
  }

  // Approve a Draft/Trial version → it becomes the current Approved version; any prior
  // Approved version is Superseded (kept intact in history).
  async approve(schoolId: string, activityId: string, versionId: string, userId: string): Promise<ActivityDetail | null> {
    const target = await DB.query(
      singleLineString`select uuid, status, version_no from club_activity_version where uuid = $1 and activity_id = $2 and school_id = $3`,
      [versionId, activityId, schoolId],
    );
    if (!target.length) return null;
    if (!["draft", "trial"].includes(target[0].status)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "Only a Draft or Trial version can be approved");
    }
    // Each statement references exactly the params it is given (no unused placeholders — an
    // unreferenced $n makes Postgres fail with "could not determine data type of parameter").
    const queries = [
      `update club_activity_version set status = 'superseded', updated_at = now()
         where activity_id = $1 and status = 'approved' and uuid <> $2`,
      `update club_activity_version set status = 'approved', approvedby_userid = $1, approved_at = now(), updated_at = now()
         where uuid = $2`,
      `update club_activity set current_version_id = $1, updatedby_userid = $2, updated_at = now()
         where uuid = $3 and school_id = $4`,
    ];
    const params = [
      [activityId, versionId],
      [userId, versionId],
      [versionId, userId, activityId, schoolId],
    ];
    await DB.queriesInTransaction(queries, params as any);
    await writeAudit(schoolId, userId, "activity.approve", "activity_version", versionId, { after: { versionNo: target[0].versionNo } });
    return this.getActivity(schoolId, activityId);
  }

  // Suspend / archive / re-enable / shelve an activity (availability transition; independent
  // of version status). Blueprint §11.
  async setAvailability(
    schoolId: string,
    activityId: string,
    availability: string,
    userId: string,
    reason?: string,
  ): Promise<ActivityDetail | null> {
    if (!["planned", "available", "suspended", "archived"].includes(availability)) {
      throw new BusinessErrorResult(ErrorCode.InvalidInput, "Invalid availability");
    }
    const rows = await DB.query(
      singleLineString`update club_activity set availability = $3, updatedby_userid = $4, updated_at = now()
        where uuid = $1 and school_id = $2 returning uuid`,
      [activityId, schoolId, availability, userId],
    );
    if (!rows.length) return null;
    const action = availability === "suspended" ? "activity.suspend" : availability === "archived" ? "activity.archive" : "activity.update";
    await writeAudit(schoolId, userId, action, "activity", activityId, { after: { availability }, reason });
    return this.getActivity(schoolId, activityId);
  }

  // Replace the material lines of the latest DRAFT version (immutable once approved).
  async replaceMaterials(schoolId: string, activityId: string, materials: MaterialLine[], _userId: string): Promise<ActivityDetail | null> {
    const v = await this._latestVersion(schoolId, activityId);
    if (!v) return null;
    if (v.status !== "draft") {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "Materials can only be edited on a Draft version");
    }
    await this._replaceMaterials(schoolId, v.uuid, materials);
    return this.getActivity(schoolId, activityId);
  }

  // ── Review queue (activity improvement) ───────────────────────────────────────

  async listReviews(schoolId: string, status: string): Promise<any[]> {
    return DB.query(
      singleLineString`select r.uuid, r.activity_id, r.version_id, r.signal, r.source, r.source_ref,
          r.decision, r.note, r.status, r.raised_at, r.decided_at,
          a.activity_code, v.title
        from club_activity_review r
        left join club_activity a on a.uuid = r.activity_id
        left join club_activity_version v on v.uuid = r.version_id
        where r.school_id = $1 and ($2 = 'all' or r.status = $2)
        order by r.raised_at desc`,
      [schoolId, status || "open"],
    );
  }

  // Decide a review: keep (close), revise (new draft), suspend / archive (availability).
  async decideReview(schoolId: string, reviewId: string, decision: string, note: string, userId: string): Promise<any | null> {
    if (!["keep", "revise", "suspend", "archive"].includes(decision)) {
      throw new BusinessErrorResult(ErrorCode.InvalidInput, "Invalid decision");
    }
    const r = await DB.query(
      singleLineString`select uuid, activity_id, status from club_activity_review where uuid = $1 and school_id = $2`,
      [reviewId, schoolId],
    );
    if (!r.length) return null;
    const activityId = r[0].activityId;
    if (decision === "revise") await this.createRevision(schoolId, activityId, userId);
    if (decision === "suspend") await this.setAvailability(schoolId, activityId, "suspended", userId, note);
    if (decision === "archive") await this.setAvailability(schoolId, activityId, "archived", userId, note);
    await DB.query(
      singleLineString`update club_activity_review set decision = $2, note = $3, status = 'closed',
          decidedby_userid = $4, decided_at = now() where uuid = $1`,
      [reviewId, decision, note || null, userId],
    );
    await writeAudit(schoolId, userId, "review.decide", "activity", activityId, { after: { decision }, reason: note });
    return { ok: true, decision };
  }

  // Manually flag an activity for review (club in-charge).
  async flagReview(schoolId: string, activityId: string, note: string, userId: string): Promise<any | null> {
    const a = await DB.query(singleLineString`select current_version_id from club_activity where uuid = $1 and school_id = $2`, [activityId, schoolId]);
    if (!a.length) return null;
    await DB.query(
      singleLineString`insert into club_activity_review
          (uuid, school_id, activity_id, version_id, signal, source, status, note, raisedby_userid, raised_at)
        values ($1,$2,$3,$4,'manual','manual','open',$5,$6,now())`,
      [generateShortUuid(12), schoolId, activityId, a[0].currentVersionId || null, note || null, userId],
    );
    return { ok: true };
  }

  // ── private ─────────────────────────────────────────────────────────────────

  private async _latestVersion(schoolId: string, activityId: string): Promise<{ uuid: string; versionNo: number; status: string } | null> {
    const rows = await DB.query(
      singleLineString`select uuid, version_no, status from club_activity_version
        where activity_id = $1 and school_id = $2 order by version_no desc limit 1`,
      [activityId, schoolId],
    );
    return rows.length ? { uuid: rows[0].uuid, versionNo: rows[0].versionNo, status: rows[0].status } : null;
  }

  private async _versionView(versionId: string): Promise<VersionView | null> {
    const rows = await DB.query(
      singleLineString`select * from club_activity_version where uuid = $1`,
      [versionId],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      uuid: r.uuid,
      versionNo: r.versionNo,
      status: r.status,
      title: r.title,
      gradeLevel: r.gradeLevel || undefined,
      category: r.category || undefined,
      difficulty: r.difficulty || undefined,
      prepBurden: r.prepBurden || undefined,
      activityMode: r.activityMode || undefined,
      estDuration: r.estDuration ?? undefined,
      recommendedSequence: r.recommendedSequence ?? undefined,
      learningOutcome: r.learningOutcome || undefined,
      teacherPreparation: r.teacherPreparation || undefined,
      procedure: r.procedure || undefined,
      riskSafety: r.riskSafety || undefined,
      safetyLevel: r.safetyLevel || undefined,
      assessmentChecklist: r.assessmentChecklist || undefined,
      relatedVocabulary: r.relatedVocabulary || undefined,
      materialsSummary: r.materialsSummary || undefined,
      materialQuantityPlan: r.materialQuantityPlan || undefined,
      evidenceNote: r.evidenceNote || undefined,
      supportEnrichment: r.supportEnrichment || undefined,
      cleanupStorage: r.cleanupStorage || undefined,
      minRepeatGapDays: r.minRepeatGapDays ?? undefined,
      metadata: r.metadata || undefined,
      materials: await this._materials(versionId),
    };
  }

  private async _materials(versionId: string): Promise<MaterialLine[]> {
    const rows = await DB.query(
      singleLineString`select item, quantity_note, provided_by, consumable, seq
        from club_activity_material where version_id = $1 order by seq nulls last, item`,
      [versionId],
    );
    return rows.map((r: any) => ({
      item: r.item,
      quantityNote: r.quantityNote || undefined,
      providedBy: r.providedBy || undefined,
      consumable: r.consumable ?? undefined,
      seq: r.seq ?? undefined,
    }));
  }

  private async _insertVersion(
    schoolId: string, activityId: string, versionId: string, versionNo: number,
    status: string, c: VersionContent, userId: string,
  ): Promise<void> {
    await DB.query(
      singleLineString`insert into club_activity_version
          (uuid, school_id, activity_id, version_no, status, title, grade_level, category, difficulty,
           prep_burden, activity_mode, est_duration, recommended_sequence, learning_outcome,
           teacher_preparation, procedure, risk_safety, safety_level, assessment_checklist,
           related_vocabulary, materials_summary, material_quantity_plan, evidence_note,
           support_enrichment, cleanup_storage, min_repeat_gap_days, metadata, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27::jsonb,$28,now())`,
      [
        versionId, schoolId, activityId, versionNo, status,
        c.title, c.gradeLevel || null, c.category || null, c.difficulty || null,
        c.prepBurden || null, c.activityMode || null, c.estDuration ?? null, c.recommendedSequence ?? null,
        c.learningOutcome || null, c.teacherPreparation || null, c.procedure || null, c.riskSafety || null,
        c.safetyLevel || null, c.assessmentChecklist || null, c.relatedVocabulary || null,
        c.materialsSummary || null, c.materialQuantityPlan || null, c.evidenceNote || null,
        c.supportEnrichment || null, c.cleanupStorage || null, c.minRepeatGapDays ?? null,
        c.metadata ? JSON.stringify(c.metadata) : null, userId,
      ],
    );
  }

  private async _updateVersionContent(versionId: string, c: UpdateDraftRequest, userId: string): Promise<void> {
    await DB.query(
      singleLineString`update club_activity_version set
          title = coalesce($2, title),
          grade_level = coalesce($3, grade_level),
          category = coalesce($4, category),
          difficulty = coalesce($5, difficulty),
          prep_burden = coalesce($6, prep_burden),
          activity_mode = coalesce($7, activity_mode),
          est_duration = coalesce($8, est_duration),
          recommended_sequence = coalesce($9, recommended_sequence),
          learning_outcome = coalesce($10, learning_outcome),
          teacher_preparation = coalesce($11, teacher_preparation),
          procedure = coalesce($12, procedure),
          risk_safety = coalesce($13, risk_safety),
          safety_level = coalesce($14, safety_level),
          assessment_checklist = coalesce($15, assessment_checklist),
          related_vocabulary = coalesce($16, related_vocabulary),
          materials_summary = coalesce($17, materials_summary),
          material_quantity_plan = coalesce($18, material_quantity_plan),
          evidence_note = coalesce($19, evidence_note),
          support_enrichment = coalesce($20, support_enrichment),
          cleanup_storage = coalesce($21, cleanup_storage),
          min_repeat_gap_days = coalesce($22, min_repeat_gap_days),
          metadata = coalesce($23::jsonb, metadata),
          updatedby_userid = $24, updated_at = now()
        where uuid = $1`,
      [
        versionId, c.title ?? null, c.gradeLevel ?? null, c.category ?? null, c.difficulty ?? null,
        c.prepBurden ?? null, c.activityMode ?? null, c.estDuration ?? null, c.recommendedSequence ?? null,
        c.learningOutcome ?? null, c.teacherPreparation ?? null, c.procedure ?? null, c.riskSafety ?? null,
        c.safetyLevel ?? null, c.assessmentChecklist ?? null, c.relatedVocabulary ?? null,
        c.materialsSummary ?? null, c.materialQuantityPlan ?? null, c.evidenceNote ?? null,
        c.supportEnrichment ?? null, c.cleanupStorage ?? null, c.minRepeatGapDays ?? null,
        c.metadata ? JSON.stringify(c.metadata) : null, userId,
      ],
    );
  }

  private async _replaceMaterials(schoolId: string, versionId: string, materials: MaterialLine[]): Promise<void> {
    await DB.query(singleLineString`delete from club_activity_material where version_id = $1`, [versionId]);
    let seq = 1;
    for (const m of materials) {
      if (!m.item || !m.item.trim()) continue;
      await DB.query(
        singleLineString`insert into club_activity_material
            (uuid, school_id, version_id, item, quantity_note, provided_by, consumable, seq)
          values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          generateShortUuid(12), schoolId, versionId, m.item.trim(),
          m.quantityNote || null, m.providedBy || null, m.consumable ?? null, m.seq ?? seq++,
        ],
      );
    }
  }
}

export const clubActivityService = new ClubActivityService();
