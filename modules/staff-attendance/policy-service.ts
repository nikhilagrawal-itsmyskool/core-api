import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult, NotFoundResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { ConfigRow, SeasonRow } from './staff-attendance-derive';

const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

// Hardcoded fallback when a school hasn't configured anything yet (keeps derivation working).
const DEFAULTS: ConfigRow = { expectedIn: '09:00', expectedOut: '15:00', graceMin: 10, halfDayAfterMin: null };

function assertHHMM(label: string, v: any): void {
  if (v == null || v === '') return;
  if (!/^\d{1,2}:\d{2}$/.test(String(v)) || parseInt(String(v).split(':')[0], 10) > 23 || parseInt(String(v).split(':')[1], 10) > 59) {
    throw new BusinessErrorResult(ErrorCode.InvalidInput, `${label} must be a valid HH:MM time`);
  }
}

class PolicyService {
  async getConfig(schoolId: string): Promise<{ configured: boolean } & ConfigRow & { minPresentMin: number | null; enabled: string }> {
    const rows = await DB.query(singleLineString`select * from staff_attendance_config where school_id = $1`, [schoolId]);
    if (!rows.length) {
      return { configured: false, ...DEFAULTS, minPresentMin: null, enabled: 'on' };
    }
    const c = rows[0];
    return {
      configured: true,
      expectedIn: c.expectedIn || DEFAULTS.expectedIn,
      expectedOut: c.expectedOut || DEFAULTS.expectedOut,
      graceMin: c.graceMin ?? DEFAULTS.graceMin,
      halfDayAfterMin: c.halfDayAfterMin ?? null,
      minPresentMin: c.minPresentMin ?? null,
      enabled: c.enabled || 'on',
    };
  }

  async upsertConfig(schoolId: string, userId: string, data: any): Promise<any> {
    assertHHMM('expectedIn', data.expectedIn);
    assertHHMM('expectedOut', data.expectedOut);
    const existing = await DB.query(singleLineString`select uuid from staff_attendance_config where school_id = $1`, [schoolId]);
    const vals = [
      data.expectedIn ?? DEFAULTS.expectedIn,
      data.expectedOut ?? DEFAULTS.expectedOut,
      data.graceMin ?? DEFAULTS.graceMin,
      data.halfDayAfterMin ?? null,
      data.minPresentMin ?? null,
      data.enabled === 'off' ? 'off' : 'on',
    ];
    if (existing.length) {
      await DB.query(
        singleLineString`update staff_attendance_config set
          expected_in = $2, expected_out = $3, grace_min = $4, half_day_after_min = $5, min_present_min = $6, enabled = $7,
          updatedby_userid = $8, updated_at = now() where school_id = $1`,
        [schoolId, ...vals, userId],
      );
    } else {
      await DB.query(
        singleLineString`insert into staff_attendance_config
          (uuid, school_id, expected_in, expected_out, grace_min, half_day_after_min, min_present_min, enabled, createdby_userid, created_at, updated_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), now())`,
        [generateShortUuid(12), schoolId, ...vals, userId],
      );
    }
    return this.getConfig(schoolId);
  }

  async listSeasons(schoolId: string): Promise<any[]> {
    return DB.query(
      singleLineString`select * from staff_attendance_season where school_id = $1 and status = 'active'
        order by coalesce(sort_order, 0), name`,
      [schoolId],
    );
  }

  async createSeason(schoolId: string, userId: string, data: any): Promise<any> {
    this.validateSeason(data);
    const uuid = generateShortUuid(12);
    await DB.query(
      singleLineString`insert into staff_attendance_season
        (uuid, school_id, name, start_month, start_day, end_month, end_day, expected_in, expected_out, grace_min, half_day_after_min, sort_order, status, createdby_userid, created_at, updated_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active',$13, now(), now())`,
      [uuid, schoolId, data.name, data.startMonth, data.startDay, data.endMonth, data.endDay,
       data.expectedIn, data.expectedOut, data.graceMin ?? 0, data.halfDayAfterMin ?? null, data.sortOrder ?? 0, userId],
    );
    const rows = await DB.query(singleLineString`select * from staff_attendance_season where uuid = $1`, [uuid]);
    return rows[0];
  }

  async updateSeason(schoolId: string, userId: string, id: string, data: any): Promise<any> {
    const rows = await DB.query(singleLineString`select * from staff_attendance_season where uuid = $1 and school_id = $2 and status = 'active'`, [id, schoolId]);
    if (!rows.length) throw new NotFoundResult(ErrorCode.InvalidId, 'Season not found');
    const cur = rows[0];
    const merged = {
      name: data.name ?? cur.name,
      startMonth: data.startMonth ?? cur.startMonth, startDay: data.startDay ?? cur.startDay,
      endMonth: data.endMonth ?? cur.endMonth, endDay: data.endDay ?? cur.endDay,
      expectedIn: data.expectedIn ?? cur.expectedIn, expectedOut: data.expectedOut ?? cur.expectedOut,
      graceMin: data.graceMin ?? cur.graceMin, halfDayAfterMin: data.halfDayAfterMin ?? cur.halfDayAfterMin,
      sortOrder: data.sortOrder ?? cur.sortOrder,
    };
    this.validateSeason(merged);
    await DB.query(
      singleLineString`update staff_attendance_season set
        name = $3, start_month = $4, start_day = $5, end_month = $6, end_day = $7,
        expected_in = $8, expected_out = $9, grace_min = $10, half_day_after_min = $11, sort_order = $12,
        updatedby_userid = $13, updated_at = now() where uuid = $1 and school_id = $2`,
      [id, schoolId, merged.name, merged.startMonth, merged.startDay, merged.endMonth, merged.endDay,
       merged.expectedIn, merged.expectedOut, merged.graceMin ?? 0, merged.halfDayAfterMin ?? null, merged.sortOrder ?? 0, userId],
    );
    const out = await DB.query(singleLineString`select * from staff_attendance_season where uuid = $1`, [id]);
    return out[0];
  }

  async deleteSeason(schoolId: string, userId: string, id: string): Promise<{ deleted: boolean }> {
    await DB.query(
      singleLineString`update staff_attendance_season set status = 'deleted', updatedby_userid = $3, updated_at = now()
        where uuid = $1 and school_id = $2`,
      [id, schoolId, userId],
    );
    return { deleted: true };
  }

  private validateSeason(d: any): void {
    if (!d.name || !String(d.name).trim()) throw new BusinessErrorResult(ErrorCode.InvalidInput, 'Season name is required');
    assertHHMM('expectedIn', d.expectedIn);
    assertHHMM('expectedOut', d.expectedOut);
    for (const [k, max] of [['startMonth', 12], ['endMonth', 12], ['startDay', 31], ['endDay', 31]] as [string, number][]) {
      const v = Number(d[k]);
      if (!Number.isInteger(v) || v < 1 || v > max) throw new BusinessErrorResult(ErrorCode.InvalidInput, `${k} must be 1..${max}`);
    }
  }

  // Derivation context: concrete config defaults + active seasons (camelCase from transformKeys
  // already matches SeasonRow/ConfigRow field names).
  async loadContext(schoolId: string): Promise<{ config: ConfigRow; seasons: SeasonRow[] }> {
    const config = await this.getConfig(schoolId);
    const seasons = await this.listSeasons(schoolId);
    return {
      config: { expectedIn: config.expectedIn, expectedOut: config.expectedOut, graceMin: config.graceMin, halfDayAfterMin: config.halfDayAfterMin },
      seasons: seasons.map((s: any) => ({
        name: s.name, startMonth: s.startMonth, startDay: s.startDay, endMonth: s.endMonth, endDay: s.endDay,
        expectedIn: s.expectedIn, expectedOut: s.expectedOut, graceMin: s.graceMin ?? 0, halfDayAfterMin: s.halfDayAfterMin ?? null,
        sortOrder: s.sortOrder ?? 0,
      })),
    };
  }
}

export const policyService = new PolicyService();
