import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { clubPlanService } from "./club-plan-service";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

// Group model (simplified): class / house / saved groups are LIVE, read-only references in a
// plan (membership resolves at read/attendance time). The ONLY editable group is a materialised
// CUSTOM group — created from scratch or by CLONING a live group. A custom group can be PROMOTED
// to a school-level Saved group (reusable, live, edited in its own manager).
//
// "Editable" plan group = saved_group_id IS NULL AND source_type in ('selected','mixed').
const EDITABLE_SOURCE = ["selected", "mixed"];

type Member = { studentId: string; name: string };

class ClubGroupService {
  // ── Saved group manager (school-level; live; edited here, read-only in plans) ────
  async listSaved(schoolId: string): Promise<any[]> {
    return DB.query(
      singleLineString`select g.uuid, g.name, g.source_type, g.strength_snapshot,
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

  async createSaved(schoolId: string, body: { name: string; members?: Member[] }, userId: string): Promise<any> {
    if (!body.name || !body.name.trim()) throw new BusinessErrorResult(ErrorCode.InvalidInput, "name is required");
    const id = generateShortUuid(12);
    const members = body.members || [];
    await DB.query(
      singleLineString`insert into club_group (uuid, school_id, name, source_type, strength_snapshot, status, createdby_userid, created_at)
        values ($1,$2,$3,'selected',$4,'active',$5,now())`,
      [id, schoolId, body.name.trim(), members.length, userId],
    );
    await this._writeMembers(schoolId, id, members);
    return { ok: true, savedGroupId: id };
  }

  async updateSaved(schoolId: string, groupId: string, body: { name?: string; members?: Member[] }, userId: string): Promise<any> {
    const g = await DB.query(singleLineString`select uuid from club_group where uuid = $1 and school_id = $2 and status = 'active'`, [groupId, schoolId]);
    if (!g.length) throw new BusinessErrorResult(ErrorCode.InvalidId, "Saved group not found");
    if (body.members) {
      await DB.query(singleLineString`delete from club_group_member where group_id = $1`, [groupId]);
      await this._writeMembers(schoolId, groupId, body.members);
    }
    await DB.query(
      singleLineString`update club_group set name = coalesce($2, name),
          strength_snapshot = coalesce($3, strength_snapshot), updatedby_userid = $4, updated_at = now()
        where uuid = $1`,
      [groupId, body.name ? body.name.trim() : null, body.members ? body.members.length : null, userId],
    );
    return { ok: true };
  }

  async deleteSaved(schoolId: string, groupId: string, _userId: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`update club_group set status = 'deleted', updated_at = now() where uuid = $1 and school_id = $2 and status = 'active' returning uuid`,
      [groupId, schoolId],
    );
    // Plan groups that referenced it lose the live link (they become empty custom shells the
    // planner can clone/replace); keep them rather than silently deleting plan data.
    if (rows.length) await DB.query(singleLineString`update club_plan_group set saved_group_id = null where saved_group_id = $1`, [groupId]);
    return rows.length > 0;
  }

  // ── Promote a CUSTOM plan group → a new Saved group ─────────────────────────────
  async promotePlanGroup(schoolId: string, planGroupId: string, userId: string): Promise<any> {
    const pg = await this._planGroup(schoolId, planGroupId);
    if (!pg) throw new BusinessErrorResult(ErrorCode.InvalidId, "Group not found");
    if (!this._isEditable(pg)) throw new BusinessErrorResult(ErrorCode.BusinessError, "Only a custom (cloned) group can be promoted — clone a class/house/saved group first");
    const members = await this._customMembers(planGroupId);
    const res = await this.createSaved(schoolId, { name: pg.labelSnapshot, members }, userId);
    await DB.query(singleLineString`update club_plan_group set saved_group_id = $1 where uuid = $2`, [res.savedGroupId, planGroupId]);
    return res;
  }

  // ── Add a Saved group into a plan as a LIVE reference (no member copy) ───────────
  async addSavedToPlan(schoolId: string, planId: string, savedGroupId: string, userId: string): Promise<any> {
    const saved = await this.getSaved(schoolId, savedGroupId);
    if (!saved) throw new BusinessErrorResult(ErrorCode.InvalidId, "Saved group not found");
    const plan = await DB.query(singleLineString`select status from club_plan where uuid = $1 and school_id = $2`, [planId, schoolId]);
    if (!plan.length || plan[0].status !== "draft") throw new BusinessErrorResult(ErrorCode.BusinessError, "Only a draft plan can be edited");
    const dup = await DB.query(singleLineString`select uuid from club_plan_group where plan_id = $1 and saved_group_id = $2`, [planId, savedGroupId]);
    if (dup.length) throw new BusinessErrorResult(ErrorCode.BusinessError, "That saved group is already in this plan");
    await DB.query(
      singleLineString`insert into club_plan_group (uuid, school_id, plan_id, source_type, source_ref, label_snapshot, strength_snapshot, seq, saved_group_id)
        values ($1,$2,$3,'selected',null,$4,null,700000,$5)`,
      [generateShortUuid(12), schoolId, planId, saved.name, savedGroupId],
    );
    return clubPlanService.getPlan(schoolId, planId);
  }

  // ── Clone ANY plan group → a new editable CUSTOM group (live members materialised) ─
  async cloneGroup(schoolId: string, planGroupId: string, userId: string): Promise<any> {
    const pg = await this._planGroup(schoolId, planGroupId);
    if (!pg) throw new BusinessErrorResult(ErrorCode.InvalidId, "Group not found");
    const plan = await DB.query(singleLineString`select academic_year_id, status from club_plan where uuid = $1`, [pg.planId]);
    if (!plan.length || plan[0].status !== "draft") throw new BusinessErrorResult(ErrorCode.BusinessError, "Only a draft plan can be edited");
    const members = await this._resolveLiveMembers(schoolId, plan[0].academicYearId, pg);
    const newId = generateShortUuid(12);
    await DB.query(
      singleLineString`insert into club_plan_group (uuid, school_id, plan_id, source_type, source_ref, label_snapshot, strength_snapshot, seq)
        values ($1,$2,$3,'selected',null,$4,$5,null)`,
      [newId, schoolId, pg.planId, `${pg.labelSnapshot} (copy)`, members.length],
    );
    await this._writePlanMembers(schoolId, newId, members);
    return clubPlanService.getPlan(schoolId, pg.planId);
  }

  // ── Edit a CUSTOM plan group (rename + optional member replace) ──────────────────
  async editPlanGroup(schoolId: string, planGroupId: string, body: { label?: string; members?: Member[] }, _userId: string): Promise<any> {
    const pg = await this._planGroup(schoolId, planGroupId);
    if (!pg) throw new BusinessErrorResult(ErrorCode.InvalidId, "Group not found");
    if (!this._isEditable(pg)) throw new BusinessErrorResult(ErrorCode.BusinessError, "Class / house / saved groups are read-only — clone to edit");
    const plan = await DB.query(singleLineString`select status from club_plan where uuid = $1`, [pg.planId]);
    if (!plan.length || plan[0].status !== "draft") throw new BusinessErrorResult(ErrorCode.BusinessError, "Only a draft plan can be edited");
    if (body.members) {
      await DB.query(singleLineString`delete from club_plan_group_member where plan_group_id = $1`, [planGroupId]);
      await this._writePlanMembers(schoolId, planGroupId, body.members);
    }
    await DB.query(
      singleLineString`update club_plan_group set label_snapshot = coalesce($2, label_snapshot),
          strength_snapshot = coalesce($3, strength_snapshot) where uuid = $1`,
      [planGroupId, body.label ? body.label.trim() : null, body.members ? body.members.length : null],
    );
    return clubPlanService.getPlan(schoolId, pg.planId);
  }

  // ── private ─────────────────────────────────────────────────────────────────────
  private _isEditable(pg: any): boolean {
    return !pg.savedGroupId && EDITABLE_SOURCE.includes(pg.sourceType);
  }
  private async _planGroup(schoolId: string, planGroupId: string): Promise<any | null> {
    const r = await DB.query(
      singleLineString`select uuid, plan_id, source_type, source_ref, label_snapshot, saved_group_id from club_plan_group where uuid = $1 and school_id = $2`,
      [planGroupId, schoolId],
    );
    return r.length ? r[0] : null;
  }
  private async _customMembers(planGroupId: string): Promise<Member[]> {
    const rows = await DB.query(singleLineString`select student_id, student_name_snapshot from club_plan_group_member where plan_group_id = $1`, [planGroupId]);
    return rows.map((m: any) => ({ studentId: m.studentId, name: m.studentNameSnapshot }));
  }
  // Resolve the CURRENT members of any plan group by kind (for cloning).
  private async _resolveLiveMembers(schoolId: string, ay: string, pg: any): Promise<Member[]> {
    if (pg.savedGroupId) {
      const rows = await DB.query(singleLineString`select student_id, student_name_snapshot from club_group_member where group_id = $1`, [pg.savedGroupId]);
      return rows.map((m: any) => ({ studentId: m.studentId, name: m.studentNameSnapshot }));
    }
    if (pg.sourceType === "class" && pg.sourceRef) {
      const rows = await DB.query(
        singleLineString`select s.uuid, s.name from student s join student_class sc on sc.student_id = s.uuid
          where sc.class_id = $1 and sc.academic_year_id = $2 and sc.status = 'active' and s.status <> 'deleted' order by s.name`,
        [pg.sourceRef, ay],
      );
      return rows.map((s: any) => ({ studentId: s.uuid, name: s.name }));
    }
    if (pg.sourceType === "house" && pg.sourceRef) {
      const rows = await DB.query(
        singleLineString`select distinct s.uuid, s.name from student s join student_class sc on sc.student_id = s.uuid and sc.academic_year_id = $2 and sc.status = 'active'
          where s.house_id = $1 and s.status <> 'deleted' order by s.name`,
        [pg.sourceRef, ay],
      );
      return rows.map((s: any) => ({ studentId: s.uuid, name: s.name }));
    }
    return this._customMembers(pg.uuid);
  }
  private async _writeMembers(schoolId: string, savedGroupId: string, members: Member[]): Promise<void> {
    for (const m of members) {
      if (!m.studentId) continue;
      await DB.query(
        singleLineString`insert into club_group_member (uuid, school_id, group_id, student_id, student_name_snapshot) values ($1,$2,$3,$4,$5)`,
        [generateShortUuid(12), schoolId, savedGroupId, m.studentId, (m as any).studentName || m.name || null],
      );
    }
  }
  private async _writePlanMembers(schoolId: string, planGroupId: string, members: Member[]): Promise<void> {
    for (const m of members) {
      if (!m.studentId) continue;
      await DB.query(
        singleLineString`insert into club_plan_group_member (uuid, school_id, plan_group_id, student_id, student_name_snapshot) values ($1,$2,$3,$4,$5)`,
        [generateShortUuid(12), schoolId, planGroupId, m.studentId, (m as any).studentName || m.name || null],
      );
    }
  }
}

export const clubGroupService = new ClubGroupService();
