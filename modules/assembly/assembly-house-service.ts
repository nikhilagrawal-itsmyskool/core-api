import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import {
  AssemblyConfig, SetConfigRequest, HouseView, HouseStaff, SetHouseRotationRequest, WeekHouseView, SetWeekHouseRequest,
} from './assembly-interfaces';
import { ASSEMBLY_MODES } from './assembly-constants';
import { isValidDate } from './assembly-common';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const mondayOf = (s: string) => { const d = parse(s); const dow = d.getUTCDay(); d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow)); return iso(d); };
const addWeeks = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n * 7); return iso(d); };

class AssemblyHouseService {
  // ── Per-school config (mode + branding) ─────────────────────────────────────

  public async getConfig(schoolId: string): Promise<AssemblyConfig> {
    const rows = await DB.query(
      singleLineString`select school_id, mode, title, subtitle from assembly_school_config where school_id = $1`,
      [schoolId],
    );
    if (rows.length === 0) return { schoolId, mode: 'template' };
    return { schoolId, mode: rows[0].mode, title: rows[0].title || undefined, subtitle: rows[0].subtitle || undefined };
  }

  public async setConfig(data: SetConfigRequest, schoolId: string, userId: string): Promise<AssemblyConfig> {
    if (data.mode && !ASSEMBLY_MODES.includes(data.mode)) throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid mode: ${data.mode}`);
    const existing = await DB.query(singleLineString`select school_id from assembly_school_config where school_id = $1`, [schoolId]);
    const now = new Date();
    if (existing.length === 0) {
      await DB.query(
        singleLineString`insert into assembly_school_config (school_id, mode, title, subtitle, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6)`,
        [schoolId, data.mode || 'template', data.title || null, data.subtitle || null, userId, now],
      );
    } else {
      const updates: string[] = []; const params: any[] = []; let i = 1;
      const set = (c: string, v: any) => { updates.push(`${c} = $${i++}`); params.push(v); };
      if (data.mode !== undefined) set('mode', data.mode);
      if (data.title !== undefined) set('title', data.title || null);
      if (data.subtitle !== undefined) set('subtitle', data.subtitle || null);
      if (updates.length) {
        set('updatedby_userid', userId); set('updated_at', now); params.push(schoolId);
        await DB.query(singleLineString`update assembly_school_config set ${updates.join(', ')} where school_id = $${i}`, params);
      }
    }
    return this.getConfig(schoolId);
  }

  // ── Houses (identity + leadership from the student module; assembly owns only
  //    the rotation order) ──────────────────────────────────────────────────────

  public async listHouses(schoolId: string): Promise<HouseView[]> {
    const rows = await DB.query(
      singleLineString`
        select h.uuid as house_id, h.name, h.code, h.color, r.sort_order
        from house h
        left join assembly_house_rotation r on r.house_id = h.uuid and r.school_id = h.school_id and r.status = 'active'
        where h.school_id = $1 and h.status = 'active'
        order by r.sort_order asc nulls last, h.name
      `,
      [schoolId],
    );
    const staff = await this.loadHouseStaff(schoolId, rows.map((r: any) => r.houseId));
    return rows.map((r: any) => ({
      houseId: r.houseId, name: r.name, code: r.code, color: r.color,
      rotationOrder: r.sortOrder ?? undefined,
      ...(staff.get(r.houseId) || { teachers: [] }),
    }));
  }

  // Set (or clear) a house's assembly rotation order. sortOrder null removes the
  // house from the rotation; a number sets/updates its place.
  public async setHouseRotation(houseId: string, data: SetHouseRotationRequest, schoolId: string, userId: string): Promise<HouseView | null> {
    const house = await DB.query(singleLineString`select uuid from house where uuid = $1 and school_id = $2 and status = 'active'`, [houseId, schoolId]);
    if (house.length === 0) return null;
    const now = new Date();
    const existing = await DB.query(singleLineString`select uuid from assembly_house_rotation where school_id = $1 and house_id = $2 and status = 'active'`, [schoolId, houseId]);
    if (data.sortOrder === null) {
      if (existing.length) await DB.query(singleLineString`update assembly_house_rotation set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3`, [userId, now, existing[0].uuid]);
    } else if (data.sortOrder !== undefined) {
      if (existing.length) await DB.query(singleLineString`update assembly_house_rotation set sort_order = $1, updatedby_userid = $2, updated_at = $3 where uuid = $4`, [data.sortOrder, userId, now, existing[0].uuid]);
      else await DB.query(singleLineString`insert into assembly_house_rotation (uuid, school_id, house_id, sort_order, status, createdby_userid, created_at) values ($1,$2,$3,$4,'active',$5,$6)`, [generateShortUuid(12), schoolId, houseId, data.sortOrder, userId, now]);
    }
    return (await this.listHouses(schoolId)).find(h => h.houseId === houseId) || null;
  }

  // Leadership + member teachers, read from the student module's house_teacher.
  private async loadHouseStaff(schoolId: string, houseIds: string[]): Promise<Map<string, HouseStaff>> {
    const map = new Map<string, HouseStaff>();
    for (const id of houseIds) map.set(id, { teachers: [] });
    if (houseIds.length === 0) return map;
    const ph = houseIds.map((_, i) => `$${i + 2}`).join(', ');
    const rows = await DB.query(
      singleLineString`
        select ht.house_id, ht.employee_id, ht.role, e.name
        from house_teacher ht
        left join employee e on e.uuid = ht.employee_id and e.school_id = ht.school_id
        where ht.school_id = $1 and ht.house_id in (${ph}) and ht.status = 'active'
      `,
      [schoolId, ...houseIds],
    );
    for (const r of rows) {
      const s = map.get(r.houseId); if (!s) continue;
      if (r.role === 'incharge') { s.inchargeId = r.employeeId; s.inchargeName = r.name || undefined; }
      else if (r.role === 'coincharge') { s.coinchargeId = r.employeeId; s.coinchargeName = r.name || undefined; }
      else s.teachers.push({ employeeId: r.employeeId, name: r.name || undefined });
    }
    return map;
  }

  // ── Rotation (per plan/wing; week pins re-anchor; earliest pin = start) ──────

  public async setWeekHouse(planId: string, data: SetWeekHouseRequest, schoolId: string, userId: string): Promise<WeekHouseView[]> {
    if (!isValidDate(data.weekStart)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'A valid weekStart (yyyy-mm-dd) is required');
    const weekStart = mondayOf(data.weekStart);
    const now = new Date();
    const existing = await DB.query(singleLineString`select uuid from assembly_week_house where plan_id = $1 and week_start = $2`, [planId, weekStart]);
    if (existing.length === 0) {
      await DB.query(
        singleLineString`insert into assembly_week_house (uuid, school_id, plan_id, week_start, house_id, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6,$7)`,
        [generateShortUuid(12), schoolId, planId, weekStart, data.houseId ?? null, userId, now],
      );
    } else {
      await DB.query(
        singleLineString`update assembly_week_house set house_id = $1, updatedby_userid = $2, updated_at = $3 where uuid = $4`,
        [data.houseId ?? null, userId, now, existing[0].uuid],
      );
    }
    // A pin change (skip / re-anchor) re-computes the whole cycle. Re-sync the house
    // snapshot on already-created UNLOCKED weeks so a started-then-skipped week loses
    // its house (skip -> null) and re-anchored weeks follow the new rotation. Locked
    // (approved) weeks keep their finalised snapshot.
    await this.syncWeekSnapshots(planId, schoolId, userId);
    return this.weekCalendar(planId, schoolId, addWeeks(weekStart, -4), addWeeks(weekStart, 8));
  }

  // Bring every unlocked assembly_week's house snapshot back in line with the current
  // rotation calendar (null when the week resolves to a skip / before the cycle start).
  private async syncWeekSnapshots(planId: string, schoolId: string, userId: string): Promise<void> {
    const weeks = await DB.query(
      singleLineString`select uuid, week_start::text as week_start, house_id, locked from assembly_week where plan_id = $1 and school_id = $2`,
      [planId, schoolId],
    );
    const unlocked = weeks.filter((w: any) => w.locked !== true);
    if (unlocked.length === 0) return;
    const starts = unlocked.map((w: any) => mondayOf(w.weekStart)).sort();
    const cal = await this.weekCalendar(planId, schoolId, starts[0], starts[starts.length - 1]);
    const byWeek = new Map(cal.map((c) => [c.weekStart, c]));
    const now = new Date();
    for (const w of unlocked) {
      const resolved = byWeek.get(mondayOf(w.weekStart));
      const newHouseId = resolved?.houseId ?? null;
      const newHouseName = resolved?.houseName ?? null;
      if ((w.houseId ?? null) !== newHouseId) {
        await DB.query(
          singleLineString`update assembly_week set house_id = $1, house_name = $2, updatedby_userid = $3, updated_at = $4 where uuid = $5`,
          [newHouseId, newHouseName, userId, now, w.uuid],
        );
      }
    }
  }

  // The house-on-duty for each Monday in [fromWeek, toWeek]. The rotation cycles
  // the assembly_house_rotation houses (by sort_order) starting from the plan's
  // EARLIEST week pin: a pinned house re-anchors the cycle, a null pin skips the
  // week without shifting. No plan-level anchor.
  public async weekCalendar(planId: string, schoolId: string, fromWeek: string, toWeek: string): Promise<WeekHouseView[]> {
    const houses = await DB.query(
      singleLineString`
        select r.house_id, h.name from assembly_house_rotation r
        join house h on h.uuid = r.house_id and h.school_id = r.school_id and h.status = 'active'
        where r.school_id = $1 and r.status = 'active'
        order by r.sort_order asc
      `,
      [schoolId],
    );
    if (houses.length === 0) return [];
    const n = houses.length;
    const idxById = (id: string) => houses.findIndex((h: any) => h.houseId === id);

    const pinRows = await DB.query(singleLineString`select week_start::text as week_start, house_id from assembly_week_house where plan_id = $1 and school_id = $2 order by week_start`, [planId, schoolId]);
    if (pinRows.length === 0) return []; // no pin → no cycle start → no rotation
    const pins = new Map<string, string | null>();
    for (const r of pinRows) pins.set(mondayOf(r.weekStart), r.houseId);
    const start = mondayOf(pinRows[0].weekStart); // earliest pin = cycle start
    const from = mondayOf(fromWeek); const to = mondayOf(toWeek);

    const out: WeekHouseView[] = [];
    let lastIdx: number | null = null;
    for (let w = start; w <= to; w = addWeeks(w, 1)) {
      const hasPin = pins.has(w);
      const pinHouse = pins.get(w);
      let row: WeekHouseView;
      if (hasPin && (pinHouse === null || pinHouse === undefined)) {
        row = { weekStart: w, source: 'skip' }; // explicit skip; lastIdx unchanged
      } else if (!hasPin && lastIdx === null) {
        row = { weekStart: w, source: 'skip' }; // before any concrete pin — undetermined
      } else {
        let idx: number;
        let source: WeekHouseView['source'];
        if (hasPin && pinHouse) {
          const oi = idxById(pinHouse);
          idx = oi >= 0 ? oi : (lastIdx ?? 0);
          source = 'override';
        } else {
          idx = ((lastIdx as number) + 1) % n; source = 'auto';
        }
        lastIdx = idx;
        row = { weekStart: w, houseId: houses[idx].houseId, houseName: houses[idx].name, source };
      }
      if (w >= from) out.push(row);
    }
    return out;
  }

  // Convenience: the house on duty for one week (used by the roster in Phase B).
  public async houseForWeek(planId: string, schoolId: string, weekStart: string): Promise<WeekHouseView | null> {
    const wk = mondayOf(weekStart);
    const cal = await this.weekCalendar(planId, schoolId, wk, wk);
    return cal.find(c => c.weekStart === wk) || null;
  }
}

export const assemblyHouseService = new AssemblyHouseService();
