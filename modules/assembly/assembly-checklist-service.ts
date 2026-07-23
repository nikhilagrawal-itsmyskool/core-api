import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import {
  ChecklistItem, CreateChecklistItemRequest, UpdateChecklistItemRequest,
  WeekChecklist, ChecklistTickView, SaveChecklistRequest, SignoffRequest,
} from './assembly-interfaces';
import { CHECKLIST_SCOPES, WEEKDAY_VALUES, Weekday } from './assembly-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const dateInWeek = (weekStart: string, wd: Weekday) => addDays(weekStart, WEEKDAY_VALUES.indexOf(wd));

const ITEM_COLS = singleLineString`uuid, phase, scope, text, sort_order`;

class AssemblyChecklistService {
  // ── Checklist catalog (per-school, configurable) ─────────────────────────────

  public async listItems(schoolId: string): Promise<ChecklistItem[]> {
    return DB.query(
      singleLineString`select ${ITEM_COLS} from assembly_checklist_item where school_id = $1 and status = 'active' order by sort_order, created_at`,
      [schoolId],
    );
  }

  public async createItem(data: CreateChecklistItemRequest, schoolId: string, userId: string): Promise<ChecklistItem> {
    if (!CHECKLIST_SCOPES.includes(data.scope)) throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid scope: ${data.scope}`);
    if (!data.text || !data.text.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, 'text is required');
    const uuid = generateShortUuid(12);
    const now = new Date();
    const sortOrder = data.sortOrder ?? (await this.nextSort(schoolId));
    await DB.query(
      singleLineString`insert into assembly_checklist_item (uuid, school_id, phase, scope, text, sort_order, status, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6,'active',$7,$8)`,
      [uuid, schoolId, data.phase?.trim() || null, data.scope, data.text.trim(), sortOrder, userId, now],
    );
    return (await this.getItem(uuid, schoolId))!;
  }

  public async updateItem(id: string, data: UpdateChecklistItemRequest, schoolId: string, userId: string): Promise<ChecklistItem | null> {
    const existing = await this.getItem(id, schoolId);
    if (!existing) return null;
    if (data.scope !== undefined && !CHECKLIST_SCOPES.includes(data.scope)) throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid scope: ${data.scope}`);
    if (data.text !== undefined && !String(data.text).trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, 'text cannot be blank');

    const updates: string[] = []; const params: any[] = []; let i = 1;
    const set = (c: string, v: any) => { updates.push(`${c} = $${i++}`); params.push(v); };
    if (data.phase !== undefined) set('phase', data.phase?.trim() || null);
    if (data.scope !== undefined) set('scope', data.scope);
    if (data.text !== undefined) set('text', String(data.text).trim());
    if (data.sortOrder !== undefined) set('sort_order', data.sortOrder);
    if (updates.length === 0) return existing;
    set('updatedby_userid', userId); set('updated_at', new Date());
    params.push(id, schoolId);
    await DB.query(singleLineString`update assembly_checklist_item set ${updates.join(', ')} where uuid = $${i++} and school_id = $${i} and status = 'active'`, params);
    return this.getItem(id, schoolId);
  }

  public async deleteItem(id: string, schoolId: string, userId: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`update assembly_checklist_item set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4 and status = 'active' returning uuid`,
      [userId, new Date(), id, schoolId],
    );
    return rows.length > 0;
  }

  // ── Per-week ticking + sign-off (execution-time; NOT gated by the week lock) ──

  public async getWeekChecklist(weekId: string, schoolId: string): Promise<WeekChecklist | null> {
    const week = await this.weekRow(weekId, schoolId);
    if (!week) return null;
    const items = await this.listItems(schoolId);
    const dates = await this.weekDates(week.planId, schoolId, week.weekStart);

    const tickRows = await DB.query(
      singleLineString`select item_id, entry_date::text as entry_date, checkedby_userid, checked_at from assembly_checklist_tick where week_id = $1 and checked = true`,
      [weekId],
    );
    const ticks: ChecklistTickView[] = tickRows.map((r: any) => ({
      itemId: r.itemId, date: r.entryDate || undefined,
      checkedbyUserid: r.checkedbyUserid || undefined,
      checkedAt: r.checkedAt ? new Date(r.checkedAt).toISOString() : undefined,
    }));

    const signRows = await DB.query(singleLineString`select entry_date::text as entry_date, note, signedby_userid, signed_at from assembly_checklist_signoff where week_id = $1`, [weekId]);
    const toSign = (r: any) => ({
      note: r.note || undefined,
      signedbyUserid: r.signedbyUserid || undefined,
      signedAt: r.signedAt ? new Date(r.signedAt).toISOString() : undefined,
    });
    const weeklyRow = signRows.find((r: any) => !r.entryDate);
    const signoff = weeklyRow ? toSign(weeklyRow) : undefined;
    const daySignoffs = signRows.filter((r: any) => r.entryDate).map((r: any) => ({ date: r.entryDate, ...toSign(r) }));

    return {
      weekId,
      weekItems: items.filter(it => it.scope === 'week'),
      dayItems: items.filter(it => it.scope === 'day'),
      dates, ticks, signoff, daySignoffs,
    };
  }

  // Replace the week's ticks with exactly the CHECKED items provided.
  public async saveTicks(weekId: string, data: SaveChecklistRequest, schoolId: string, userId: string, lockSubmitted = false): Promise<WeekChecklist | null> {
    const week = await this.weekRow(weekId, schoolId);
    if (!week) return null;
    if (!Array.isArray(data.ticks)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'ticks array is required');
    if (lockSubmitted && data.scope) {
      const entryDate = data.scope === 'day' ? (data.date ?? null) : null;
      if (await this.partitionSignedOff(weekId, entryDate)) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, 'Already submitted. Ask an admin to reopen it to make changes.');
      }
    }
    const dates = new Set(await this.weekDates(week.planId, schoolId, week.weekStart));
    const items = new Map((await this.listItems(schoolId)).map(it => [it.uuid, it]));

    const now = new Date();
    // Scope the replace to a partition so weekly and per-day saves are independent.
    let del = singleLineString`delete from assembly_checklist_tick where week_id = $1`;
    const delParams: any[] = [weekId];
    if (data.scope === 'week') {
      del = singleLineString`delete from assembly_checklist_tick where week_id = $1 and entry_date is null`;
    } else if (data.scope === 'day') {
      if (!data.date || !dates.has(data.date)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'A day-scoped save needs a valid assembly date');
      del = singleLineString`delete from assembly_checklist_tick where week_id = $1 and entry_date = $2`;
      delParams.push(data.date);
    }
    const queries: string[] = [del];
    const params: any[][] = [delParams];
    const seen = new Set<string>();
    for (const t of data.ticks) {
      const item = items.get(t.itemId);
      if (!item) throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid checklist item: ${t.itemId}`);
      const date = t.date ?? null;
      if (item.scope === 'day') {
        if (!date || !dates.has(date)) throw new BusinessErrorResult(ErrorCode.BusinessError, `A day-scoped item needs a valid assembly date (${item.text})`);
      } else if (date) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, `A week-scoped item must not carry a date (${item.text})`);
      }
      const key = `${t.itemId}|${date ?? ''}`;
      if (seen.has(key)) continue; // de-dupe
      seen.add(key);
      queries.push(singleLineString`insert into assembly_checklist_tick (uuid, school_id, week_id, item_id, entry_date, checked, checkedby_userid, checked_at) values ($1,$2,$3,$4,$5,true,$6,$7)`);
      params.push([generateShortUuid(12), schoolId, weekId, t.itemId, date, userId, now]);
    }
    await DB.queriesInTransaction(queries, params);
    return this.getWeekChecklist(weekId, schoolId);
  }

  // Is a partition (weekly = null date, or a specific day) already signed off?
  private async partitionSignedOff(weekId: string, entryDate: string | null): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`select 1 from assembly_checklist_signoff where week_id = $1 and coalesce(entry_date, date '1900-01-01') = coalesce($2::date, date '1900-01-01')`,
      [weekId, entryDate],
    );
    return rows.length > 0;
  }

  // Sign off a partition: scope 'day' + date signs off that assembly day; otherwise
  // the week. Keyed by (week, entry_date) so weekly + per-day sign-offs coexist.
  // lockSubmitted (PWA) rejects re-submitting an already-submitted partition.
  public async signoff(weekId: string, data: SignoffRequest, schoolId: string, userId: string, lockSubmitted = false): Promise<WeekChecklist | null> {
    const week = await this.weekRow(weekId, schoolId);
    if (!week) return null;
    const entryDate = data.scope === 'day' ? (data.date ?? null) : null;
    if (data.scope === 'day') {
      const dates = new Set(await this.weekDates(week.planId, schoolId, week.weekStart));
      if (!entryDate || !dates.has(entryDate)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'A day sign-off needs a valid assembly date');
    }
    if (lockSubmitted && await this.partitionSignedOff(weekId, entryDate)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Already submitted. Ask an admin to reopen it to make changes.');
    }
    const now = new Date();
    const existing = await DB.query(singleLineString`select 1 from assembly_checklist_signoff where week_id = $1 and coalesce(entry_date, date '1900-01-01') = coalesce($2::date, date '1900-01-01')`, [weekId, entryDate]);
    if (existing.length === 0) {
      await DB.query(singleLineString`insert into assembly_checklist_signoff (week_id, school_id, entry_date, note, signedby_userid, signed_at) values ($1,$2,$3,$4,$5,$6)`, [weekId, schoolId, entryDate, data.note?.trim() || null, userId, now]);
    } else {
      await DB.query(singleLineString`update assembly_checklist_signoff set note = $1, signedby_userid = $2, signed_at = $3 where week_id = $4 and coalesce(entry_date, date '1900-01-01') = coalesce($5::date, date '1900-01-01')`, [data.note?.trim() || null, userId, now, weekId, entryDate]);
    }
    return this.getWeekChecklist(weekId, schoolId);
  }

  // Reopen (clear) a sign-off partition — admin only. date null = the weekly block.
  public async clearSignoff(weekId: string, schoolId: string, date?: string | null): Promise<WeekChecklist | null> {
    const week = await this.weekRow(weekId, schoolId);
    if (!week) return null;
    await DB.query(
      singleLineString`delete from assembly_checklist_signoff where week_id = $1 and school_id = $2 and coalesce(entry_date, date '1900-01-01') = coalesce($3::date, date '1900-01-01')`,
      [weekId, schoolId, date ?? null],
    );
    return this.getWeekChecklist(weekId, schoolId);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  private async getItem(id: string, schoolId: string): Promise<ChecklistItem | null> {
    const rows = await DB.query(singleLineString`select ${ITEM_COLS} from assembly_checklist_item where uuid = $1 and school_id = $2 and status = 'active'`, [id, schoolId]);
    return rows.length > 0 ? rows[0] : null;
  }

  private async nextSort(schoolId: string): Promise<number> {
    const rows = await DB.query(singleLineString`select coalesce(max(sort_order), -1) as max from assembly_checklist_item where school_id = $1 and status = 'active'`, [schoolId]);
    return Number(rows[0].max) + 1;
  }

  private async weekRow(weekId: string, schoolId: string): Promise<{ planId: string; weekStart: string } | null> {
    const rows = await DB.query(singleLineString`select plan_id, week_start::text as week_start from assembly_week where uuid = $1 and school_id = $2`, [weekId, schoolId]);
    return rows.length > 0 ? { planId: rows[0].planId, weekStart: rows[0].weekStart } : null;
  }

  private async weekDates(planId: string, schoolId: string, weekStart: string): Promise<string[]> {
    const rows = await DB.query(singleLineString`select weekday from assembly_plan_day where plan_id = $1 and school_id = $2`, [planId, schoolId]);
    const set = rows.map((r: any) => r.weekday);
    return (WEEKDAY_VALUES.filter(w => set.includes(w)) as Weekday[]).map(wd => dateInWeek(weekStart, wd));
  }
}

export const assemblyChecklistService = new AssemblyChecklistService();
