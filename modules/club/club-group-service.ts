import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { clubPlanService } from "./club-plan-service";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

// School-level reusable "saved groups" + the plan-group linkage (promote / add-from-saved /
// edit-in-plan / push-edits-back). Lets a group built once (e.g. a custom roster across classes)
// be reused across plans.
class ClubGroupService {
  // ── Saved group catalog ─────────────────────────────────────────────────────
  async listSaved(schoolId: string): Promise<any[]> {
    return DB.query(
      singleLineString`select g.uuid, g.name, g.source_type, g.source_ref, g.strength_snapshot,
          (select count(*) from club_group_member m where m.group_id = g.uuid) as member_count
        from club_group g where g.school_id = $1 and g.status = 'active' order by g.name`,
      [schoolId],
    );
  }

  async getSaved(schoolId: string, groupId: string): Promise<any | null> {
    const g = await DB.query(
      singleLineString`select uuid, name, source_type, source_ref, strength_snapshot from club_group where uuid = $1 and school_id = $2 and status = 'active'`,
      [groupId, schoolId],
    );
    if (!g.length) return null;
    const members = await DB.query(
      singleLineString`select student_id, student_name_snapshot from club_group_member where group_id = $1 order by student_name_snapshot`,
      [groupId],
    );
    return { ...g[0], members };
  }

  async deleteSaved(schoolId: string, groupId: string, _userId: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`update club_group set status = 'deleted', updated_at = now() where uuid = $1 and school_id = $2 and status = 'active' returning uuid`,
      [groupId, schoolId],
    );
    // Unlink any plan groups that referenced it (they keep their snapshot, just lose the link).
    if (rows.length) await DB.query(singleLineString`update club_plan_group set saved_group_id = null where saved_group_id = $1`, [groupId]);
    return rows.length > 0;
  }

  // ── Promote a plan group → a new saved group (copies label/source/members) ──────
  async promotePlanGroup(schoolId: string, planGroupId: string, userId: string): Promise<any> {
    const pg = await DB.query(
      singleLineString`select uuid, source_type, source_ref, label_snapshot, strength_snapshot, saved_group_id from club_plan_group where uuid = $1 and school_id = $2`,
      [planGroupId, schoolId],
    );
    if (!pg.length) throw new BusinessErrorResult(ErrorCode.InvalidId, "Group not found");
    if (pg[0].savedGroupId) throw new BusinessErrorResult(ErrorCode.BusinessError, "This group is already saved");

    const groupId = generateShortUuid(12);
    await DB.query(
      singleLineString`insert into club_group (uuid, school_id, name, source_type, source_ref, strength_snapshot, status, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,'active',$7,now())`,
      [groupId, schoolId, pg[0].labelSnapshot, pg[0].sourceType, pg[0].sourceRef, pg[0].strengthSnapshot, userId],
    );
    await this._copyMembers(schoolId, planGroupId, groupId);
    // Link the plan group to its new saved group; it is now in sync.
    await DB.query(singleLineString`update club_plan_group set saved_group_id = $1, edited = false where uuid = $2`, [groupId, planGroupId]);
    return { ok: true, savedGroupId: groupId };
  }

  // ── Add a saved group into a plan (snapshot copy, linked, not edited) ──────────
  async addSavedToPlan(schoolId: string, planId: string, savedGroupId: string, userId: string): Promise<any> {
    const saved = await this.getSaved(schoolId, savedGroupId);
    if (!saved) throw new BusinessErrorResult(ErrorCode.InvalidId, "Saved group not found");
    const plan = await DB.query(singleLineString`select status from club_plan where uuid = $1 and school_id = $2`, [planId, schoolId]);
    if (!plan.length || plan[0].status !== "draft") throw new BusinessErrorResult(ErrorCode.BusinessError, "Only a draft plan can be edited");
    const dup = await DB.query(singleLineString`select uuid from club_plan_group where plan_id = $1 and saved_group_id = $2`, [planId, savedGroupId]);
    if (dup.length) throw new BusinessErrorResult(ErrorCode.BusinessError, "That saved group is already in this plan");

    const pgId = generateShortUuid(12);
    await DB.query(
      singleLineString`insert into club_plan_group (uuid, school_id, plan_id, source_type, source_ref, label_snapshot, strength_snapshot, seq, saved_group_id, edited)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,false)`,
      [pgId, schoolId, planId, saved.sourceType || "selected", saved.sourceRef || null, saved.name, saved.strengthSnapshot, 800000, savedGroupId],
    );
    for (const m of saved.members) {
      await DB.query(
        singleLineString`insert into club_plan_group_member (uuid, school_id, plan_group_id, student_id, student_name_snapshot) values ($1,$2,$3,$4,$5)`,
        [generateShortUuid(12), schoolId, pgId, m.studentId, m.studentNameSnapshot],
      );
    }
    return clubPlanService.getPlan(schoolId, planId);
  }

  // ── Edit a plan group (rename / strength); marks it `edited` (diverged) ─────────
  async editPlanGroup(schoolId: string, planGroupId: string, body: { label?: string; strength?: number }, _userId: string): Promise<any> {
    const pg = await DB.query(singleLineString`select plan_id from club_plan_group where uuid = $1 and school_id = $2`, [planGroupId, schoolId]);
    if (!pg.length) throw new BusinessErrorResult(ErrorCode.InvalidId, "Group not found");
    const plan = await DB.query(singleLineString`select status from club_plan where uuid = $1`, [pg[0].planId]);
    if (!plan.length || plan[0].status !== "draft") throw new BusinessErrorResult(ErrorCode.BusinessError, "Only a draft plan can be edited");
    await DB.query(
      singleLineString`update club_plan_group set
          label_snapshot = coalesce($2, label_snapshot),
          strength_snapshot = coalesce($3, strength_snapshot),
          edited = true
        where uuid = $1`,
      [planGroupId, body.label ? body.label.trim() : null, body.strength ?? null],
    );
    return clubPlanService.getPlan(schoolId, pg[0].planId);
  }

  // ── Push an edited plan group's label/members back into its linked saved group ──
  async pushToSaved(schoolId: string, planGroupId: string, _userId: string): Promise<any> {
    const pg = await DB.query(
      singleLineString`select uuid, saved_group_id, label_snapshot, strength_snapshot from club_plan_group where uuid = $1 and school_id = $2`,
      [planGroupId, schoolId],
    );
    if (!pg.length) throw new BusinessErrorResult(ErrorCode.InvalidId, "Group not found");
    const savedId = pg[0].savedGroupId;
    if (!savedId) throw new BusinessErrorResult(ErrorCode.BusinessError, "This group is not linked to a saved group — promote it instead");
    await DB.query(
      singleLineString`update club_group set name = $2, strength_snapshot = $3, updated_at = now() where uuid = $1 and school_id = $4`,
      [savedId, pg[0].labelSnapshot, pg[0].strengthSnapshot, schoolId],
    );
    await DB.query(singleLineString`delete from club_group_member where group_id = $1`, [savedId]);
    await this._copyMembers(schoolId, planGroupId, savedId);
    await DB.query(singleLineString`update club_plan_group set edited = false where uuid = $1`, [planGroupId]);
    return { ok: true };
  }

  private async _copyMembers(schoolId: string, planGroupId: string, savedGroupId: string): Promise<void> {
    const members = await DB.query(
      singleLineString`select student_id, student_name_snapshot from club_plan_group_member where plan_group_id = $1`,
      [planGroupId],
    );
    for (const m of members) {
      await DB.query(
        singleLineString`insert into club_group_member (uuid, school_id, group_id, student_id, student_name_snapshot) values ($1,$2,$3,$4,$5)`,
        [generateShortUuid(12), schoolId, savedGroupId, m.studentId, m.studentNameSnapshot],
      );
    }
  }
}

export const clubGroupService = new ClubGroupService();
