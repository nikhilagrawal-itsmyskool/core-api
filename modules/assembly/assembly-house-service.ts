import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import {
  AssemblyConfig, SetConfigRequest, HouseView, SetHouseMetaRequest, WeekHouseView, SetWeekHouseRequest,
} from './assembly-interfaces';
import { ASSEMBLY_MODES } from './assembly-constants';
import { resolveEmployeeNames, isValidDate } from './assembly-common';
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

  // ── Houses (extend the student-module `house` with leadership + teachers) ────

  public async listHouses(schoolId: string): Promise<HouseView[]> {
    const rows = await DB.query(
      singleLineString`
        select h.uuid as house_id, h.name, h.code, h.color,
          m.incharge_id, m.coincharge_id, m.rotation_order
        from house h left join assembly_house_meta m on m.house_id = h.uuid
        where h.school_id = $1 and h.status = 'active'
        order by m.rotation_order asc nulls last, h.name
      `,
      [schoolId],
    );
    const names = await resolveEmployeeNames(schoolId, rows.flatMap((r: any) => [r.inchargeId, r.coinchargeId]));
    const teachers = await this.loadTeachers(schoolId, rows.map((r: any) => r.houseId));
    return rows.map((r: any) => ({
      houseId: r.houseId, name: r.name, code: r.code, color: r.color,
      inchargeId: r.inchargeId || undefined, inchargeName: r.inchargeId ? names[r.inchargeId] : undefined,
      coinchargeId: r.coinchargeId || undefined, coinchargeName: r.coinchargeId ? names[r.coinchargeId] : undefined,
      rotationOrder: r.rotationOrder ?? undefined,
      teachers: teachers.get(r.houseId) || [],
    }));
  }

  public async setHouseMeta(houseId: string, data: SetHouseMetaRequest, schoolId: string, userId: string): Promise<HouseView | null> {
    const house = await DB.query(singleLineString`select uuid from house where uuid = $1 and school_id = $2 and status = 'active'`, [houseId, schoolId]);
    if (house.length === 0) return null;
    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    // Upsert the meta row (incharge / coincharge / rotation_order).
    const meta = await DB.query(singleLineString`select house_id from assembly_house_meta where house_id = $1`, [houseId]);
    if (meta.length === 0) {
      queries.push(singleLineString`insert into assembly_house_meta (house_id, school_id, incharge_id, coincharge_id, rotation_order, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6,$7)`);
      params.push([houseId, schoolId, data.inchargeId ?? null, data.coinchargeId ?? null, data.rotationOrder ?? null, userId, now]);
    } else {
      const u: string[] = []; const p: any[] = []; let i = 1;
      const set = (c: string, v: any) => { u.push(`${c} = $${i++}`); p.push(v); };
      if (data.inchargeId !== undefined) set('incharge_id', data.inchargeId || null);
      if (data.coinchargeId !== undefined) set('coincharge_id', data.coinchargeId || null);
      if (data.rotationOrder !== undefined) set('rotation_order', data.rotationOrder ?? null);
      if (u.length) { set('updatedby_userid', userId); set('updated_at', now); p.push(houseId); queries.push(singleLineString`update assembly_house_meta set ${u.join(', ')} where house_id = $${i}`); params.push(p); }
    }

    // Replace the teacher set when provided.
    if (data.teacherIds) {
      queries.push(singleLineString`update assembly_house_teacher set status = 'deleted', updatedby_userid = $1, updated_at = $2 where house_id = $3 and status = 'active'`);
      params.push([userId, now, houseId]);
      for (const empId of [...new Set(data.teacherIds.filter(Boolean))]) {
        queries.push(singleLineString`insert into assembly_house_teacher (uuid, school_id, house_id, employee_id, status, createdby_userid, created_at) values ($1,$2,$3,$4,'active',$5,$6)`);
        params.push([generateShortUuid(12), schoolId, houseId, empId, userId, now]);
      }
    }
    if (queries.length) await DB.queriesInTransaction(queries, params);
    return (await this.listHouses(schoolId)).find(h => h.houseId === houseId) || null;
  }

  private async loadTeachers(schoolId: string, houseIds: string[]): Promise<Map<string, { employeeId: string; name?: string }[]>> {
    const map = new Map<string, { employeeId: string; name?: string }[]>();
    if (houseIds.length === 0) return map;
    const ph = houseIds.map((_, i) => `$${i + 2}`).join(', ');
    const rows = await DB.query(
      singleLineString`select house_id, employee_id from assembly_house_teacher where school_id = $1 and house_id in (${ph}) and status = 'active'`,
      [schoolId, ...houseIds],
    );
    const names = await resolveEmployeeNames(schoolId, rows.map((r: any) => r.employeeId));
    for (const r of rows) {
      if (!map.has(r.houseId)) map.set(r.houseId, []);
      map.get(r.houseId)!.push({ employeeId: r.employeeId, name: names[r.employeeId] });
    }
    return map;
  }

  // ── Rotation (per plan/wing; re-anchoring overrides) ────────────────────────

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
    // Return the recomputed calendar for the containing month window.
    return this.weekCalendar(planId, schoolId, addWeeks(weekStart, -4), addWeeks(weekStart, 8));
  }

  // The house-on-duty for each Monday in [fromWeek, toWeek]. Walks from the plan
  // anchor: a set override re-anchors the cycle; a null (skip) override pauses it.
  public async weekCalendar(planId: string, schoolId: string, fromWeek: string, toWeek: string): Promise<WeekHouseView[]> {
    const planRows = await DB.query(singleLineString`select rotation_anchor::text as rotation_anchor from assembly_plan where uuid = $1 and school_id = $2 and status = 'active'`, [planId, schoolId]);
    if (planRows.length === 0 || !planRows[0].rotationAnchor) return [];
    const anchor = mondayOf(planRows[0].rotationAnchor);
    const from = mondayOf(fromWeek); const to = mondayOf(toWeek);

    const houses = await DB.query(
      singleLineString`
        select h.uuid as house_id, h.name from house h join assembly_house_meta m on m.house_id = h.uuid
        where h.school_id = $1 and h.status = 'active' and m.rotation_order is not null
        order by m.rotation_order asc
      `,
      [schoolId],
    );
    if (houses.length === 0) return [];
    const n = houses.length;
    const idxById = (id: string) => houses.findIndex((h: any) => h.houseId === id);

    const ovRows = await DB.query(singleLineString`select week_start::text as week_start, house_id from assembly_week_house where plan_id = $1 and school_id = $2`, [planId, schoolId]);
    const overrides = new Map<string, string | null>();
    for (const r of ovRows) overrides.set(mondayOf(r.weekStart), r.houseId);

    const out: WeekHouseView[] = [];
    let lastIdx: number | null = null;
    for (let w = anchor; w <= to; w = addWeeks(w, 1)) {
      const hasOv = overrides.has(w);
      const ovHouse = overrides.get(w);
      let row: WeekHouseView;
      if (hasOv && (ovHouse === null || ovHouse === undefined)) {
        row = { weekStart: w, source: 'skip' }; // no house; lastIdx unchanged
      } else {
        let idx: number;
        let source: WeekHouseView['source'];
        if (hasOv && ovHouse) {
          const oi = idxById(ovHouse);
          idx = oi >= 0 ? oi : (lastIdx ?? 0);
          source = 'override';
        } else if (lastIdx === null) {
          idx = 0; source = 'auto';
        } else {
          idx = (lastIdx + 1) % n; source = 'auto';
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
