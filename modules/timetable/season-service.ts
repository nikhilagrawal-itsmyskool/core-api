import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import {
  TimetableSeason,
  SeasonSlotTime,
  SeasonSlotTimeInput,
  SeasonActivation,
  CreateSeasonRequest,
  UpdateSeasonRequest,
  CreateSeasonActivationRequest,
  UpdateSeasonActivationRequest,
} from "./timetable-interfaces";
import { DEFAULTS } from "./timetable-constants";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

// Seasonal bell timings. A `timetable_season` is a reusable named set of per-slot
// clock times (season_slot_time) layered over the grid's base times; a dated
// `season_activation` window decides which season is in effect on a given date.
// Structure never changes here — only the times. See DESIGN.md.
class SeasonService {
  // ----- seasons -----
  public async listSeasons(schoolId: string): Promise<TimetableSeason[]> {
    return DB.query(
      singleLineString`select * from timetable_season where school_id = $1 order by created_at desc`,
      [schoolId],
    );
  }

  public async getSeasonById(
    id: string,
    schoolId: string,
  ): Promise<TimetableSeason | null> {
    const rows = await DB.query(
      singleLineString`select * from timetable_season where uuid = $1 and school_id = $2`,
      [id, schoolId],
    );
    if (rows.length === 0) return null;
    const season: TimetableSeason = rows[0];
    season.slotTimes = await this.listSlotTimes(id, schoolId);
    season.activations = await this.listActivations(schoolId, id);
    return season;
  }

  public async seasonExists(id: string, schoolId: string): Promise<boolean> {
    const r = await DB.query(
      singleLineString`select 1 from timetable_season where uuid = $1 and school_id = $2 limit 1`,
      [id, schoolId],
    );
    return r.length > 0;
  }

  public async createSeason(
    data: CreateSeasonRequest,
    schoolId: string,
    userId: string,
  ): Promise<TimetableSeason> {
    const r = await DB.query(
      singleLineString`
        insert into timetable_season
        (uuid, school_id, name, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6)
        returning *
      `,
      [generateShortUuid(12), schoolId, data.name.trim(), DEFAULTS.STATUS, userId, new Date()],
    );
    return r[0];
  }

  public async updateSeason(
    id: string,
    data: UpdateSeasonRequest,
    schoolId: string,
    userId: string,
  ): Promise<TimetableSeason | null> {
    const existing = await DB.query(
      singleLineString`select * from timetable_season where uuid = $1 and school_id = $2`,
      [id, schoolId],
    );
    if (existing.length === 0) return null;
    const name = data.name !== undefined ? data.name.trim() : existing[0].name;
    const status = data.status !== undefined ? data.status : existing[0].status;
    await DB.query(
      singleLineString`
        update timetable_season
        set name = $1, status = $2, updatedby_userid = $3, updated_at = $4
        where uuid = $5 and school_id = $6
      `,
      [name, status, userId, new Date(), id, schoolId],
    );
    return this.getSeasonById(id, schoolId);
  }

  public async archiveSeason(
    id: string,
    schoolId: string,
    userId: string,
  ): Promise<void> {
    await DB.query(
      singleLineString`
        update timetable_season
        set status = 'archived', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4
      `,
      [userId, new Date(), id, schoolId],
    );
  }

  // ----- per-slot times -----
  public async listSlotTimes(
    seasonId: string,
    schoolId: string,
  ): Promise<SeasonSlotTime[]> {
    return DB.query(
      singleLineString`
        select sst.* from season_slot_time sst
        where sst.season_id = $1 and sst.school_id = $2
        order by sst.time_slot_id
      `,
      [seasonId, schoolId],
    );
  }

  // Upsert several slots' season times in one transaction (partial — only the
  // listed slots are touched). Rejects unknown time-slot ids up front so a typo
  // can't create an override that silently never matches.
  public async setSlotTimes(
    seasonId: string,
    items: SeasonSlotTimeInput[],
    schoolId: string,
    userId: string,
  ): Promise<SeasonSlotTime[]> {
    if (items.length === 0) return this.listSlotTimes(seasonId, schoolId);

    const ids = [...new Set(items.map((i) => i.timeSlotId))];
    const known = await DB.query(
      singleLineString`select uuid from time_slot where uuid = any($1) and school_id = $2`,
      [ids, schoolId],
    );
    if (known.length < ids.length) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "One or more time slots do not exist for this school",
      );
    }

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];
    for (const item of items) {
      queries.push(singleLineString`
        insert into season_slot_time
        (uuid, school_id, season_id, time_slot_id, start_time, end_time, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (season_id, time_slot_id) do update
        set start_time = excluded.start_time, end_time = excluded.end_time,
            updatedby_userid = $7, updated_at = $8
      `);
      params.push([
        generateShortUuid(12),
        schoolId,
        seasonId,
        item.timeSlotId,
        item.startTime ?? null,
        item.endTime ?? null,
        userId,
        now,
      ]);
    }
    await DB.queriesInTransaction(queries, params);
    return this.listSlotTimes(seasonId, schoolId);
  }

  public async deleteSlotTime(id: string, schoolId: string): Promise<boolean> {
    const r = await DB.query(
      singleLineString`delete from season_slot_time where uuid = $1 and school_id = $2 returning uuid`,
      [id, schoolId],
    );
    return r.length > 0;
  }

  // Seed a season's slot times from each slot's base time across one config's grid,
  // so the admin only tweaks the deltas. Idempotent (re-running re-seeds).
  public async prefillFromBase(
    seasonId: string,
    configId: string,
    schoolId: string,
    userId: string,
  ): Promise<SeasonSlotTime[]> {
    const slots = await DB.query(
      singleLineString`
        select ts.uuid, ts.start_time, ts.end_time
        from time_slot ts
        join day_structure ds on ds.uuid = ts.day_structure_id
        where ds.config_id = $1 and ts.school_id = $2
      `,
      [configId, schoolId],
    );
    if (slots.length === 0) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "That config has no time slots to prefill from",
      );
    }
    const items: SeasonSlotTimeInput[] = slots.map((s: any) => ({
      timeSlotId: s.uuid,
      startTime: s.startTime ?? null,
      endTime: s.endTime ?? null,
    }));
    return this.setSlotTimes(seasonId, items, schoolId, userId);
  }

  // ----- activations (dated windows) -----
  public async listActivations(
    schoolId: string,
    seasonId?: string,
  ): Promise<SeasonActivation[]> {
    const params: any[] = [schoolId];
    let where = `sa.school_id = $1`;
    if (seasonId) {
      params.push(seasonId);
      where += ` and sa.season_id = $${params.length}`;
    }
    return DB.query(
      singleLineString`
        select sa.*, s.name as season_name
        from season_activation sa
        left join timetable_season s on s.uuid = sa.season_id
        where ${where}
        order by sa.effective_from desc
      `,
      params,
    );
  }

  public async getActivationById(
    id: string,
    schoolId: string,
  ): Promise<SeasonActivation | null> {
    const r = await DB.query(
      singleLineString`select * from season_activation where uuid = $1 and school_id = $2`,
      [id, schoolId],
    );
    return r.length > 0 ? r[0] : null;
  }

  // Reject a window that overlaps another activation for the school (null
  // effective_to = open-ended). Closed, non-overlapping ranges keep the calendar
  // unambiguous; the runtime resolver is still tolerant (latest start wins).
  private async assertNoOverlap(
    schoolId: string,
    from: string,
    to: string | null,
    excludeId?: string,
  ): Promise<void> {
    const params: any[] = [schoolId, from, to];
    let exclude = "";
    if (excludeId) {
      params.push(excludeId);
      exclude = `and uuid <> $${params.length}`;
    }
    const clash = await DB.query(
      singleLineString`
        select 1 from season_activation
        where school_id = $1 ${exclude}
          and effective_from <= coalesce($3::date, 'infinity'::date)
          and coalesce(effective_to, 'infinity'::date) >= $2::date
        limit 1
      `,
      params,
    );
    if (clash.length > 0) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "This date range overlaps an existing season activation",
      );
    }
  }

  public async createActivation(
    data: CreateSeasonActivationRequest,
    schoolId: string,
    userId: string,
  ): Promise<SeasonActivation> {
    const to = data.effectiveTo ?? null;
    if (to && to < data.effectiveFrom) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "effectiveTo must be on or after effectiveFrom",
      );
    }
    await this.assertNoOverlap(schoolId, data.effectiveFrom, to);
    const r = await DB.query(
      singleLineString`
        insert into season_activation
        (uuid, school_id, season_id, effective_from, effective_to, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7)
        returning *
      `,
      [generateShortUuid(12), schoolId, data.seasonId, data.effectiveFrom, to, userId, new Date()],
    );
    return r[0];
  }

  public async updateActivation(
    id: string,
    data: UpdateSeasonActivationRequest,
    schoolId: string,
    userId: string,
  ): Promise<SeasonActivation | null> {
    const existing = await this.getActivationById(id, schoolId);
    if (!existing) return null;
    const from =
      data.effectiveFrom !== undefined ? data.effectiveFrom : existing.effectiveFrom;
    const to =
      data.effectiveTo !== undefined ? data.effectiveTo : (existing.effectiveTo ?? null);
    if (to && to < from) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "effectiveTo must be on or after effectiveFrom",
      );
    }
    await this.assertNoOverlap(schoolId, from as string, to as string | null, id);
    const r = await DB.query(
      singleLineString`
        update season_activation
        set effective_from = $1, effective_to = $2, updatedby_userid = $3, updated_at = $4
        where uuid = $5 and school_id = $6
        returning *
      `,
      [from, to, userId, new Date(), id, schoolId],
    );
    return r.length > 0 ? r[0] : null;
  }

  public async deleteActivation(id: string, schoolId: string): Promise<boolean> {
    const r = await DB.query(
      singleLineString`delete from season_activation where uuid = $1 and school_id = $2 returning uuid`,
      [id, schoolId],
    );
    return r.length > 0;
  }

  // Which active season applies on `dateStr` (YYYY-MM-DD)? The window containing
  // the date wins; on overlap the latest effective_from wins; archived seasons are
  // ignored; none => null (caller falls back to base slot times).
  public async resolveActiveSeason(
    schoolId: string,
    dateStr: string,
  ): Promise<{ seasonId: string; seasonName: string } | null> {
    const r = await DB.query(
      singleLineString`
        select sa.season_id, s.name as season_name
        from season_activation sa
        join timetable_season s on s.uuid = sa.season_id and s.school_id = sa.school_id
        where sa.school_id = $1
          and sa.effective_from <= $2::date
          and coalesce(sa.effective_to, 'infinity'::date) >= $2::date
          and s.status = 'active'
        order by sa.effective_from desc
        limit 1
      `,
      [schoolId, dateStr],
    );
    if (r.length === 0) return null;
    return { seasonId: r[0].seasonId, seasonName: r[0].seasonName };
  }
}

export const seasonService = new SeasonService();
