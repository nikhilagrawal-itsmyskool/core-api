import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { findEmployee, writeAudit } from "./club-common";
import {
  ClubConfigRequest,
  ClubView,
  CreateClubRequest,
  SettingsRequest,
  UpdateClubRequest,
} from "./club-interfaces";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

// Club master + per-club config + per-school programme settings. No parallel masters:
// in_charge references the existing employee table by id.
class ClubService {
  // ── Clubs ───────────────────────────────────────────────────────────────────

  async listClubs(schoolId: string): Promise<ClubView[]> {
    const rows = await DB.query(
      singleLineString`
        select c.uuid, c.club_code, c.name, c.display_name, c.in_charge_employee_id,
               c.applicable_grades, c.status, c.sort_order,
               e.name as in_charge_name,
               (select count(*) from club_activity a where a.club_id = c.uuid) as activity_count,
               (select count(*) from club_activity a
                  join club_activity_version v on v.uuid = a.current_version_id
                  where a.club_id = c.uuid and v.status = 'approved' and a.availability = 'available'
               ) as released_count
        from club c
        left join employee e on e.uuid = c.in_charge_employee_id
        where c.school_id = $1
        order by c.sort_order nulls last, c.name
      `,
      [schoolId],
    );
    return rows.map(this._toClubView);
  }

  async getClub(schoolId: string, clubId: string): Promise<ClubView | null> {
    const rows = await DB.query(
      singleLineString`
        select c.uuid, c.club_code, c.name, c.display_name, c.in_charge_employee_id,
               c.applicable_grades, c.status, c.sort_order, e.name as in_charge_name
        from club c left join employee e on e.uuid = c.in_charge_employee_id
        where c.uuid = $1 and c.school_id = $2
      `,
      [clubId, schoolId],
    );
    if (!rows.length) return null;
    const view = this._toClubView(rows[0]);
    view.config = await this.getConfig(schoolId, clubId);
    return view;
  }

  async createClub(schoolId: string, body: CreateClubRequest, userId: string): Promise<ClubView> {
    const code = (body.clubCode || "").trim();
    const name = (body.name || "").trim();
    if (!code) throw new BusinessErrorResult(ErrorCode.InvalidInput, "clubCode is required");
    if (!name) throw new BusinessErrorResult(ErrorCode.InvalidInput, "name is required");

    const dup = await DB.query(
      singleLineString`select uuid from club where school_id = $1 and lower(club_code) = lower($2)`,
      [schoolId, code],
    );
    if (dup.length) throw new BusinessErrorResult(ErrorCode.BusinessError, `Club code already exists: ${code}`);

    if (body.inChargeEmployeeId) {
      const emp = await findEmployee(schoolId, body.inChargeEmployeeId);
      if (!emp) throw new BusinessErrorResult(ErrorCode.InvalidInput, "in-charge employee not found");
    }

    const uuid = generateShortUuid(12);
    await DB.query(
      singleLineString`insert into club
          (uuid, school_id, club_code, name, display_name, in_charge_employee_id, applicable_grades,
           status, sort_order, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,now())`,
      [
        uuid, schoolId, code, name, body.displayName || null, body.inChargeEmployeeId || null,
        JSON.stringify(body.applicableGrades || []), body.status || "planned",
        body.sortOrder ?? null, userId,
      ],
    );
    await writeAudit(schoolId, userId, "club.create", "club", uuid, { after: { clubCode: code, name } });
    return (await this.getClub(schoolId, uuid))!;
  }

  async updateClub(
    schoolId: string,
    clubId: string,
    body: UpdateClubRequest,
    userId: string,
  ): Promise<ClubView | null> {
    const existing = await DB.query(
      singleLineString`select uuid, club_code from club where uuid = $1 and school_id = $2`,
      [clubId, schoolId],
    );
    if (!existing.length) return null;

    if (body.clubCode && body.clubCode.trim().toLowerCase() !== existing[0].clubCode.toLowerCase()) {
      const dup = await DB.query(
        singleLineString`select uuid from club where school_id = $1 and lower(club_code) = lower($2) and uuid <> $3`,
        [schoolId, body.clubCode.trim(), clubId],
      );
      if (dup.length) throw new BusinessErrorResult(ErrorCode.BusinessError, `Club code already exists: ${body.clubCode}`);
    }
    if (body.inChargeEmployeeId) {
      const emp = await findEmployee(schoolId, body.inChargeEmployeeId);
      if (!emp) throw new BusinessErrorResult(ErrorCode.InvalidInput, "in-charge employee not found");
    }

    await DB.query(
      singleLineString`update club set
          club_code = coalesce($3, club_code),
          name = coalesce($4, name),
          display_name = coalesce($5, display_name),
          in_charge_employee_id = coalesce($6, in_charge_employee_id),
          applicable_grades = coalesce($7::jsonb, applicable_grades),
          status = coalesce($8, status),
          sort_order = coalesce($9, sort_order),
          updatedby_userid = $10, updated_at = now()
        where uuid = $1 and school_id = $2`,
      [
        clubId, schoolId,
        body.clubCode ? body.clubCode.trim() : null,
        body.name ? body.name.trim() : null,
        body.displayName ?? null,
        body.inChargeEmployeeId ?? null,
        body.applicableGrades ? JSON.stringify(body.applicableGrades) : null,
        body.status || null,
        body.sortOrder ?? null,
        userId,
      ],
    );
    await writeAudit(schoolId, userId, "club.update", "club", clubId, { after: body });
    return this.getClub(schoolId, clubId);
  }

  // ── Config (1:1 with club) ────────────────────────────────────────────────────

  async getConfig(schoolId: string, clubId: string): Promise<any> {
    const rows = await DB.query(
      singleLineString`select categories, enabled_blocks, defaults, exception_rules, trial_mode
        from club_config where club_id = $1`,
      [clubId],
    );
    if (!rows.length) {
      return { categories: [], enabledBlocks: [], defaults: {}, exceptionRules: {}, trialMode: false };
    }
    const r = rows[0];
    return {
      categories: r.categories || [],
      enabledBlocks: r.enabledBlocks || [],
      defaults: r.defaults || {},
      exceptionRules: r.exceptionRules || {},
      trialMode: !!r.trialMode,
    };
  }

  async updateConfig(
    schoolId: string,
    clubId: string,
    body: ClubConfigRequest,
    userId: string,
  ): Promise<any> {
    const club = await DB.query(singleLineString`select uuid from club where uuid = $1 and school_id = $2`, [clubId, schoolId]);
    if (!club.length) throw new BusinessErrorResult(ErrorCode.InvalidId, "Club not found");

    const existing = await DB.query(singleLineString`select uuid from club_config where club_id = $1`, [clubId]);
    if (existing.length) {
      await DB.query(
        singleLineString`update club_config set
            categories = coalesce($2::jsonb, categories),
            enabled_blocks = coalesce($3::jsonb, enabled_blocks),
            defaults = coalesce($4::jsonb, defaults),
            exception_rules = coalesce($5::jsonb, exception_rules),
            trial_mode = coalesce($6, trial_mode),
            updatedby_userid = $7, updated_at = now()
          where club_id = $1`,
        [
          clubId,
          body.categories ? JSON.stringify(body.categories) : null,
          body.enabledBlocks ? JSON.stringify(body.enabledBlocks) : null,
          body.defaults ? JSON.stringify(body.defaults) : null,
          body.exceptionRules ? JSON.stringify(body.exceptionRules) : null,
          body.trialMode ?? null,
          userId,
        ],
      );
    } else {
      await DB.query(
        singleLineString`insert into club_config
            (uuid, club_id, categories, enabled_blocks, defaults, exception_rules, trial_mode, updatedby_userid, updated_at)
          values ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,now())`,
        [
          generateShortUuid(12), clubId,
          JSON.stringify(body.categories || []),
          JSON.stringify(body.enabledBlocks || []),
          JSON.stringify(body.defaults || {}),
          JSON.stringify(body.exceptionRules || {}),
          body.trialMode ?? false,
          userId,
        ],
      );
    }
    return this.getConfig(schoolId, clubId);
  }

  // ── Programme settings (1 row per school) ─────────────────────────────────────

  async getSettings(schoolId: string): Promise<any> {
    const rows = await DB.query(
      singleLineString`select display_name, default_slots, parallel_club_limit
        from club_setting where school_id = $1`,
      [schoolId],
    );
    if (!rows.length) return { displayName: null, defaultSlots: [], parallelClubLimit: null };
    const r = rows[0];
    return {
      displayName: r.displayName || null,
      defaultSlots: r.defaultSlots || [],
      parallelClubLimit: r.parallelClubLimit ?? null,
    };
  }

  async updateSettings(schoolId: string, body: SettingsRequest, userId: string): Promise<any> {
    const existing = await DB.query(singleLineString`select uuid from club_setting where school_id = $1`, [schoolId]);
    if (existing.length) {
      await DB.query(
        singleLineString`update club_setting set
            display_name = coalesce($2, display_name),
            default_slots = coalesce($3::jsonb, default_slots),
            parallel_club_limit = $4,
            updatedby_userid = $5, updated_at = now()
          where school_id = $1`,
        [
          schoolId, body.displayName ?? null,
          body.defaultSlots ? JSON.stringify(body.defaultSlots) : null,
          body.parallelClubLimit ?? null, userId,
        ],
      );
    } else {
      await DB.query(
        singleLineString`insert into club_setting
            (uuid, school_id, display_name, default_slots, parallel_club_limit, updatedby_userid, updated_at)
          values ($1,$2,$3,$4::jsonb,$5,$6,now())`,
        [
          generateShortUuid(12), schoolId, body.displayName ?? null,
          JSON.stringify(body.defaultSlots || []), body.parallelClubLimit ?? null, userId,
        ],
      );
    }
    return this.getSettings(schoolId);
  }

  private _toClubView = (r: any): ClubView => ({
    uuid: r.uuid,
    clubCode: r.clubCode,
    name: r.name,
    displayName: r.displayName || undefined,
    inChargeEmployeeId: r.inChargeEmployeeId || null,
    inChargeName: r.inChargeName || null,
    applicableGrades: r.applicableGrades || [],
    status: r.status,
    sortOrder: r.sortOrder ?? undefined,
    activityCount: r.activityCount != null ? Number(r.activityCount) : undefined,
    releasedCount: r.releasedCount != null ? Number(r.releasedCount) : undefined,
  });
}

export const clubService = new ClubService();
