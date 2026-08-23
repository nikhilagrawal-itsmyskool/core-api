import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { DEFAULT_TYPES, HOLIDAY_KINDS, HolidayKind } from "./academic-calendar-constants";
import { parseWorkbook, ParsedEntry } from "./academic-calendar-import";
import {
  AddEntryRequest,
  CalendarDay,
  CalendarEntry,
  CalendarHoliday,
  CalendarType,
  CalendarView,
  CreateTypeRequest,
  SetHolidayRequest,
  UpdateEntryRequest,
  UpdateTypeRequest,
} from "./academic-calendar-interfaces";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function weekdayOf(dateStr: string): string {
  return WEEKDAYS[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
}
function dowOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}
function slugCode(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "type";
}

const TYPE_COLS = singleLineString`uuid, code, name, sort_order, status`;
const ENTRY_COLS = singleLineString`
  uuid, to_char(entry_date, 'YYYY-MM-DD') as entry_date,
  to_char(end_date, 'YYYY-MM-DD') as end_date, type_id, value, detail, sort_order
`;
const HOLIDAY_COLS = singleLineString`
  uuid, to_char(holiday_date, 'YYYY-MM-DD') as holiday_date, name, kind
`;

class AcademicCalendarService {
  // ── Audit ────────────────────────────────────────────────────────────────
  private async audit(
    schoolId: string,
    ay: string | null,
    entity: "type" | "entry" | "holiday",
    entityId: string,
    entryDate: string | null,
    action: "create" | "update" | "delete",
    detail: string,
    userId: string,
  ): Promise<void> {
    await DB.query(
      singleLineString`
        insert into calendar_audit
        (uuid, school_id, academic_year_id, entity, entity_id, entry_date, action, detail, changedby_userid, changed_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [generateShortUuid(12), schoolId, ay, entity, entityId, entryDate, action, detail.slice(0, 256), userId, new Date()],
    );
  }

  // ── Types ──────────────────────────────────────────────────────────────────

  // Seed the default types the first time a school touches the calendar. Idempotent
  // via the (school_id, code) unique index — a re-seed inserts only missing codes.
  async ensureTypesSeeded(schoolId: string, userId: string): Promise<void> {
    const existing = await DB.query(
      singleLineString`select code from calendar_type where school_id = $1 and status = 'active'`,
      [schoolId],
    );
    const have = new Set(existing.map((r: any) => r.code));
    const now = new Date();
    for (const t of DEFAULT_TYPES) {
      if (have.has(t.code)) continue;
      await DB.query(
        singleLineString`
          insert into calendar_type
          (uuid, school_id, code, name, sort_order, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, 'active', $6, $7)
          on conflict do nothing
        `,
        [generateShortUuid(12), schoolId, t.code, t.name, t.sortOrder, userId, now],
      );
    }
  }

  async listTypes(schoolId: string, userId: string): Promise<CalendarType[]> {
    await this.ensureTypesSeeded(schoolId, userId);
    const rows = await DB.query(
      singleLineString`select ${TYPE_COLS} from calendar_type
        where school_id = $1 and status = 'active' order by sort_order nulls last, name`,
      [schoolId],
    );
    return rows as CalendarType[];
  }

  async createType(schoolId: string, req: CreateTypeRequest, userId: string): Promise<CalendarType> {
    const name = (req.name || "").trim();
    if (!name) throw new BusinessErrorResult(ErrorCode.BusinessError, "name is required");
    const code = (req.code && req.code.trim()) || slugCode(name);
    const clash = await DB.query(
      singleLineString`select uuid from calendar_type where school_id = $1 and code = $2 and status = 'active'`,
      [schoolId, code],
    );
    if (clash.length) throw new BusinessErrorResult(ErrorCode.BusinessError, `A type with code "${code}" already exists`);
    let sortOrder = req.sortOrder;
    if (sortOrder == null) {
      const mx = await DB.query(
        singleLineString`select coalesce(max(sort_order), 0) as m from calendar_type where school_id = $1 and status = 'active'`,
        [schoolId],
      );
      sortOrder = (mx[0].m || 0) + 10;
    }
    const uuid = generateShortUuid(12);
    await DB.query(
      singleLineString`
        insert into calendar_type
        (uuid, school_id, code, name, sort_order, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, 'active', $6, $7)
      `,
      [uuid, schoolId, code, name, sortOrder, userId, new Date()],
    );
    await this.audit(schoolId, null, "type", uuid, null, "create", `type "${name}"`, userId);
    const rows = await DB.query(singleLineString`select ${TYPE_COLS} from calendar_type where uuid = $1`, [uuid]);
    return rows[0] as CalendarType;
  }

  async updateType(schoolId: string, id: string, req: UpdateTypeRequest, userId: string): Promise<CalendarType | null> {
    const existing = await DB.query(
      singleLineString`select ${TYPE_COLS} from calendar_type where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    if (!existing.length) return null;
    const name = req.name != null ? req.name.trim() : existing[0].name;
    const sortOrder = req.sortOrder != null ? req.sortOrder : existing[0].sortOrder;
    await DB.query(
      singleLineString`update calendar_type set name = $1, sort_order = $2, updatedby_userid = $3, updated_at = $4
        where uuid = $5 and school_id = $6`,
      [name, sortOrder, userId, new Date(), id, schoolId],
    );
    await this.audit(schoolId, null, "type", id, null, "update", `type "${name}"`, userId);
    const rows = await DB.query(singleLineString`select ${TYPE_COLS} from calendar_type where uuid = $1`, [id]);
    return rows[0] as CalendarType;
  }

  async deleteType(schoolId: string, id: string, userId: string): Promise<boolean> {
    const existing = await DB.query(
      singleLineString`select code, name from calendar_type where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    if (!existing.length) return false;
    const used = await DB.query(
      singleLineString`select 1 from calendar_entry where school_id = $1 and type_id = $2 and status = 'active' limit 1`,
      [schoolId, id],
    );
    if (used.length) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "Type has entries — remove or reassign them before deleting");
    }
    await DB.query(
      singleLineString`update calendar_type set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4`,
      [userId, new Date(), id, schoolId],
    );
    await this.audit(schoolId, null, "type", id, null, "delete", `type "${existing[0].name}"`, userId);
    return true;
  }

  private async resolveTypeId(schoolId: string, typeId?: string, typeCode?: string): Promise<string> {
    if (typeId) {
      const r = await DB.query(
        singleLineString`select uuid from calendar_type where uuid = $1 and school_id = $2 and status = 'active'`,
        [typeId, schoolId],
      );
      if (!r.length) throw new BusinessErrorResult(ErrorCode.BusinessError, "Unknown type");
      return r[0].uuid;
    }
    if (typeCode) {
      const r = await DB.query(
        singleLineString`select uuid from calendar_type where code = $1 and school_id = $2 and status = 'active'`,
        [typeCode, schoolId],
      );
      if (!r.length) throw new BusinessErrorResult(ErrorCode.BusinessError, `Unknown type code "${typeCode}"`);
      return r[0].uuid;
    }
    throw new BusinessErrorResult(ErrorCode.BusinessError, "typeId or typeCode is required");
  }

  // ── Entries ─────────────────────────────────────────────────────────────────

  async addEntry(schoolId: string, ay: string, req: AddEntryRequest, userId: string): Promise<CalendarEntry> {
    const value = (req.value || "").trim();
    if (!value) throw new BusinessErrorResult(ErrorCode.BusinessError, "value is required");
    const typeId = await this.resolveTypeId(schoolId, req.typeId, req.typeCode);
    let sortOrder = req.sortOrder;
    if (sortOrder == null) {
      const mx = await DB.query(
        singleLineString`select coalesce(max(sort_order), 0) as m from calendar_entry
          where school_id = $1 and academic_year_id = $2 and entry_date = $3 and type_id = $4 and status = 'active'`,
        [schoolId, ay, req.entryDate, typeId],
      );
      sortOrder = (mx[0].m || 0) + 10;
    }
    const uuid = generateShortUuid(12);
    await DB.query(
      singleLineString`
        insert into calendar_entry
        (uuid, school_id, academic_year_id, entry_date, end_date, type_id, value, detail, sort_order, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10, $11)
      `,
      [uuid, schoolId, ay, req.entryDate, req.endDate || null, typeId, value, req.detail || null, sortOrder, userId, new Date()],
    );
    await this.audit(schoolId, ay, "entry", uuid, req.entryDate, "create", value, userId);
    return (await this.getEntryById(schoolId, uuid))!;
  }

  private async getEntryById(schoolId: string, id: string): Promise<CalendarEntry | null> {
    const rows = await DB.query(
      singleLineString`select ${ENTRY_COLS} from calendar_entry where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    return rows.length ? (rows[0] as CalendarEntry) : null;
  }

  async updateEntry(schoolId: string, id: string, req: UpdateEntryRequest, userId: string): Promise<CalendarEntry | null> {
    const existing = await this.getEntryById(schoolId, id);
    if (!existing) return null;
    const value = req.value != null ? req.value.trim() : existing.value;
    if (!value) throw new BusinessErrorResult(ErrorCode.BusinessError, "value cannot be empty");
    const detail = req.detail !== undefined ? req.detail : existing.detail;
    const endDate = req.endDate !== undefined ? req.endDate : existing.endDate;
    const sortOrder = req.sortOrder != null ? req.sortOrder : existing.sortOrder;
    const typeId =
      req.typeId || req.typeCode ? await this.resolveTypeId(schoolId, req.typeId, req.typeCode) : existing.typeId;
    await DB.query(
      singleLineString`update calendar_entry
        set value = $1, detail = $2, end_date = $3, sort_order = $4, type_id = $5, updatedby_userid = $6, updated_at = $7
        where uuid = $8 and school_id = $9`,
      [value, detail || null, endDate || null, sortOrder, typeId, userId, new Date(), id, schoolId],
    );
    await this.audit(schoolId, null, "entry", id, existing.entryDate, "update", value, userId);
    return this.getEntryById(schoolId, id);
  }

  async deleteEntry(schoolId: string, id: string, userId: string): Promise<boolean> {
    const existing = await this.getEntryById(schoolId, id);
    if (!existing) return false;
    await DB.query(
      singleLineString`update calendar_entry set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4`,
      [userId, new Date(), id, schoolId],
    );
    await this.audit(schoolId, null, "entry", id, existing.entryDate, "delete", existing.value, userId);
    return true;
  }

  // ── Holidays ────────────────────────────────────────────────────────────────

  async listHolidays(schoolId: string, ay: string, from: string, to: string): Promise<CalendarHoliday[]> {
    const rows = await DB.query(
      singleLineString`select ${HOLIDAY_COLS} from calendar_holiday
        where school_id = $1 and academic_year_id = $2 and status = 'active'
          and holiday_date >= $3 and holiday_date <= $4
        order by holiday_date`,
      [schoolId, ay, from, to],
    );
    return rows as CalendarHoliday[];
  }

  // Upsert a holiday for a date (idempotent on (school, ay, date)).
  async setHoliday(schoolId: string, ay: string, req: SetHolidayRequest, userId: string): Promise<CalendarHoliday> {
    const kind: HolidayKind = req.kind && (HOLIDAY_KINDS as readonly string[]).includes(req.kind) ? req.kind : "full";
    const existing = await DB.query(
      singleLineString`select uuid from calendar_holiday
        where school_id = $1 and academic_year_id = $2 and holiday_date = $3 and status = 'active'`,
      [schoolId, ay, req.holidayDate],
    );
    let uuid: string;
    if (existing.length) {
      uuid = existing[0].uuid;
      await DB.query(
        singleLineString`update calendar_holiday set name = $1, kind = $2, updatedby_userid = $3, updated_at = $4
          where uuid = $5`,
        [req.name || null, kind, userId, new Date(), uuid],
      );
      await this.audit(schoolId, ay, "holiday", uuid, req.holidayDate, "update", req.name || kind, userId);
    } else {
      uuid = generateShortUuid(12);
      await DB.query(
        singleLineString`
          insert into calendar_holiday
          (uuid, school_id, academic_year_id, holiday_date, name, kind, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, 'active', $7, $8)
        `,
        [uuid, schoolId, ay, req.holidayDate, req.name || null, kind, userId, new Date()],
      );
      await this.audit(schoolId, ay, "holiday", uuid, req.holidayDate, "create", req.name || kind, userId);
    }
    const rows = await DB.query(singleLineString`select ${HOLIDAY_COLS} from calendar_holiday where uuid = $1`, [uuid]);
    return rows[0] as CalendarHoliday;
  }

  async deleteHoliday(schoolId: string, id: string, userId: string): Promise<boolean> {
    const existing = await DB.query(
      singleLineString`select to_char(holiday_date, 'YYYY-MM-DD') as holiday_date, academic_year_id
        from calendar_holiday where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    if (!existing.length) return false;
    await DB.query(
      singleLineString`update calendar_holiday set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4`,
      [userId, new Date(), id, schoolId],
    );
    await this.audit(schoolId, existing[0].academicYearId, "holiday", id, existing[0].holidayDate, "delete", "", userId);
    return true;
  }

  // ── Weekly-off setting (stored as academic_year.weekly_off, per year) ───────

  // Returns the non-teaching weekday numbers (0=Sun..6=Sat). null column -> [0]
  // (Sunday only, the historical default); an explicit empty string -> [] (none).
  async getWeeklyOff(schoolId: string, ay: string): Promise<number[]> {
    const rows = await DB.query(
      singleLineString`select weekly_off from academic_year where uuid = $1 and school_id = $2`,
      [ay, schoolId],
    );
    const raw = rows.length ? rows[0].weeklyOff : null;
    if (raw == null) return [0];
    const s = String(raw).trim();
    if (s === "") return [];
    return [...new Set(s.split(",").map((x) => parseInt(x, 10)).filter((n) => n >= 0 && n <= 6))].sort((a, b) => a - b);
  }

  async setWeeklyOff(schoolId: string, ay: string, days: number[], userId: string): Promise<number[]> {
    const clean = [...new Set((days || []).map((n) => Number(n)).filter((n) => n >= 0 && n <= 6))].sort((a, b) => a - b);
    await DB.query(
      singleLineString`update academic_year set weekly_off = $1 where uuid = $2 and school_id = $3`,
      [clean.join(","), ay, schoolId],
    );
    await this.audit(schoolId, ay, "type", "weekly_off", null, "update", `weekly off = [${clean.join(",")}]`, userId);
    return clean;
  }

  // Authoritative non-teaching dates in a range: full holidays + weekly-off weekdays.
  // Restricted holidays are school-open, so excluded. Consumers (attendance %, 360)
  // use this so "is this a holiday" has one definition.
  async nonTeachingDates(schoolId: string, ay: string, from: string, to: string): Promise<{ date: string; kind: "holiday" | "weekly_off"; name: string }[]> {
    const weeklyOff = await this.getWeeklyOff(schoolId, ay);
    const holidays = await this.listHolidays(schoolId, ay, from, to);
    const fullByDate = new Map(holidays.filter((h) => h.kind === "full").map((h) => [h.holidayDate, h.name || "Holiday"]));
    const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const out: { date: string; kind: "holiday" | "weekly_off"; name: string }[] = [];
    let cursor = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    while (cursor.getTime() <= end.getTime()) {
      const date = cursor.toISOString().slice(0, 10);
      const dow = cursor.getUTCDay();
      if (fullByDate.has(date)) out.push({ date, kind: "holiday", name: fullByDate.get(date)! });
      else if (weeklyOff.includes(dow)) out.push({ date, kind: "weekly_off", name: names[dow] });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
  }

  // ── Grid read ─────────────────────────────────────────────────────────────

  async getCalendar(schoolId: string, ay: string, from: string, to: string, userId: string): Promise<CalendarView> {
    const weeklyOff = await this.getWeeklyOff(schoolId, ay);
    const types = await this.listTypes(schoolId, userId);
    const typeById = new Map(types.map((t) => [t.uuid, t]));

    const entryRows = await DB.query(
      singleLineString`select ${ENTRY_COLS} from calendar_entry
        where school_id = $1 and academic_year_id = $2 and status = 'active'
          and entry_date >= $3 and entry_date <= $4
        order by entry_date, type_id, sort_order nulls last`,
      [schoolId, ay, from, to],
    );
    const entriesByDate = new Map<string, CalendarEntry[]>();
    for (const r of entryRows) {
      const t = typeById.get(r.typeId);
      const e: CalendarEntry = { ...r, typeCode: t?.code, typeName: t?.name };
      (entriesByDate.get(r.entryDate) || entriesByDate.set(r.entryDate, []).get(r.entryDate)!).push(e);
    }

    const holidays = await this.listHolidays(schoolId, ay, from, to);
    const holidayByDate = new Map(holidays.map((h) => [h.holidayDate, h]));

    const days: CalendarDay[] = [];
    let cursor = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    while (cursor.getTime() <= end.getTime()) {
      const date = cursor.toISOString().slice(0, 10);
      days.push({
        date,
        weekday: weekdayOf(date),
        isWeeklyOff: weeklyOff.includes(dowOf(date)),
        holiday: holidayByDate.get(date) || null,
        entries: entriesByDate.get(date) || [],
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return { academicYearId: ay, from, to, types, days };
  }

  // ── Import (xlsx) ───────────────────────────────────────────────────────────

  private async academicYearRange(schoolId: string, ay: string): Promise<{ start: string; end: string }> {
    const rows = await DB.query(
      singleLineString`select to_char(start_date,'YYYY-MM-DD') as start, to_char(end_date,'YYYY-MM-DD') as end
        from academic_year where uuid = $1 and school_id = $2`,
      [ay, schoolId],
    );
    if (!rows.length) throw new BusinessErrorResult(ErrorCode.BusinessError, "Unknown academic year");
    return rows[0];
  }

  // Ensure defaults + (optionally) the Academic Activities type, return code -> {id,name}.
  private async ensureImportTypes(schoolId: string, includeAA: boolean, userId: string): Promise<Map<string, { id: string; name: string }>> {
    await this.ensureTypesSeeded(schoolId, userId);
    if (includeAA) {
      const has = await DB.query(
        singleLineString`select 1 from calendar_type where school_id = $1 and code = 'academic_activity' and status = 'active'`,
        [schoolId],
      );
      if (!has.length) {
        await DB.query(
          singleLineString`insert into calendar_type (uuid, school_id, code, name, sort_order, status, createdby_userid, created_at)
            values ($1, $2, 'academic_activity', 'Academic Activities', 70, 'active', $3, $4) on conflict do nothing`,
          [generateShortUuid(12), schoolId, userId, new Date()],
        );
      }
    }
    const rows = await DB.query(
      singleLineString`select uuid, code, name from calendar_type where school_id = $1 and status = 'active'`,
      [schoolId],
    );
    return new Map(rows.map((r: any) => [r.code, { id: r.uuid, name: r.name }]));
  }

  private async existingEntryMap(schoolId: string, ay: string, codeById: Map<string, string>): Promise<Map<string, string | null>> {
    const rows = await DB.query(
      singleLineString`select to_char(entry_date,'YYYY-MM-DD') as entry_date, type_id, value, detail
        from calendar_entry where school_id = $1 and academic_year_id = $2 and status = 'active'`,
      [schoolId, ay],
    );
    const map = new Map<string, string | null>();
    for (const r of rows) {
      const code = codeById.get(r.typeId);
      if (code) map.set(`${r.entryDate}|${code}|${r.value}`, r.detail || null);
    }
    return map;
  }

  // Compute the diff (added/changed/removed) without writing. `sample` is capped.
  async importPreview(schoolId: string, ay: string, buffer: Buffer, opts: { includeAcademicActivities?: boolean; fileName?: string }, userId: string) {
    const { start, end } = await this.academicYearRange(schoolId, ay);
    const parsed = await parseWorkbook(buffer, start, end, opts);
    const typeByCode = await this.ensureImportTypes(schoolId, !!opts.includeAcademicActivities, userId);
    const codeById = new Map([...typeByCode.entries()].map(([code, v]) => [v.id, code]));
    const existing = await this.existingEntryMap(schoolId, ay, codeById);

    const targetKeys = new Set<string>();
    const added: ParsedEntry[] = [], changed: ParsedEntry[] = [];
    for (const e of parsed.entries) {
      if (!typeByCode.has(e.code)) continue;
      const key = `${e.date}|${e.code}|${e.value}`;
      targetKeys.add(key);
      if (!existing.has(key)) added.push(e);
      else if ((existing.get(key) || null) !== (e.detail || null)) changed.push(e);
    }
    const removed: { date: string; code: string; value: string }[] = [];
    for (const key of existing.keys()) {
      if (!targetKeys.has(key)) { const [date, code, value] = key.split("|"); removed.push({ date, code, value }); }
    }

    let full = 0, restricted = 0;
    for (const h of parsed.holidays.values()) (h.kind === "full" ? full++ : restricted++);

    const nameOf = (code: string) => typeByCode.get(code)?.name || code;
    const sample = [
      ...added.map((e) => ({ date: e.date, typeName: nameOf(e.code), value: e.value, detail: e.detail, change: "add" as const })),
      ...changed.map((e) => ({ date: e.date, typeName: nameOf(e.code), value: e.value, detail: e.detail, change: "update" as const })),
      ...removed.map((e) => ({ date: e.date, typeName: nameOf(e.code), value: e.value, detail: null, change: "remove" as const })),
    ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 30);

    return {
      fileName: opts.fileName || "workbook.xlsx",
      dates: parsed.dates,
      added: added.length, changed: changed.length, removed: removed.length,
      holidaysFull: full, holidaysRestricted: restricted,
      skipped: parsed.skipped.outOfMonth + parsed.skipped.outOfRange + parsed.skipped.blankDate,
      unknownHeaders: parsed.unknownHeaders,
      sample,
    };
  }

  // Apply the workbook. replace=true wipes the AY calendar first; otherwise it's an
  // upsert (insert new entries, update changed detail, upsert holidays — never deletes).
  async importApply(schoolId: string, ay: string, buffer: Buffer, opts: { includeAcademicActivities?: boolean; replace?: boolean }, userId: string) {
    const { start, end } = await this.academicYearRange(schoolId, ay);
    const parsed = await parseWorkbook(buffer, start, end, opts);
    const typeByCode = await this.ensureImportTypes(schoolId, !!opts.includeAcademicActivities, userId);
    const now = new Date();

    if (opts.replace) {
      await DB.query(singleLineString`delete from calendar_entry where school_id = $1 and academic_year_id = $2`, [schoolId, ay]);
      await DB.query(singleLineString`delete from calendar_holiday where school_id = $1 and academic_year_id = $2`, [schoolId, ay]);
    }

    const codeById = new Map([...typeByCode.entries()].map(([code, v]) => [v.id, code]));
    const existing = opts.replace ? new Map<string, string | null>() : await this.existingEntryMap(schoolId, ay, codeById);
    const existingIdByKey = new Map<string, string>();
    if (!opts.replace) {
      const rows = await DB.query(
        singleLineString`select uuid, to_char(entry_date,'YYYY-MM-DD') as entry_date, type_id, value from calendar_entry
          where school_id = $1 and academic_year_id = $2 and status = 'active'`,
        [schoolId, ay],
      );
      for (const r of rows) { const code = codeById.get(r.typeId); if (code) existingIdByKey.set(`${r.entryDate}|${code}|${r.value}`, r.uuid); }
    }

    const seq: Record<string, number> = {};
    let written = 0;
    for (const e of parsed.entries) {
      const type = typeByCode.get(e.code);
      if (!type) continue;
      const key = `${e.date}|${e.code}|${e.value}`;
      const grp = `${e.date}|${e.code}`;
      seq[grp] = (seq[grp] || 0) + 10;
      if (existing.has(key)) {
        if ((existing.get(key) || null) !== (e.detail || null)) {
          await DB.query(
            singleLineString`update calendar_entry set detail = $1, updatedby_userid = $2, updated_at = $3 where uuid = $4`,
            [e.detail || null, userId, now, existingIdByKey.get(key)],
          );
          written++;
        }
        continue;
      }
      await DB.query(
        singleLineString`insert into calendar_entry
          (uuid, school_id, academic_year_id, entry_date, end_date, type_id, value, detail, sort_order, status, createdby_userid, created_at)
          values ($1,$2,$3,$4,null,$5,$6,$7,$8,'active',$9,$10)`,
        [generateShortUuid(12), schoolId, ay, e.date, type.id, e.value.slice(0, 512), e.detail ? e.detail.slice(0, 512) : null, seq[grp], userId, now],
      );
      written++;
    }

    let holidaysWritten = 0;
    for (const [date, h] of parsed.holidays.entries()) {
      await this.setHoliday(schoolId, ay, { holidayDate: date, name: h.name, kind: h.kind }, userId);
      holidaysWritten++;
    }

    await this.audit(schoolId, ay, "entry", "import", null, "create", `xlsx import: ${written} entries, ${holidaysWritten} holidays`, userId);
    return { entriesWritten: written, holidaysWritten };
  }
}

export const academicCalendarService = new AcademicCalendarService();
