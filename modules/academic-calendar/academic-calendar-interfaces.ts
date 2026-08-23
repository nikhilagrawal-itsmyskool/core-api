import { HolidayKind } from "./academic-calendar-constants";

// ── Types (the configurable "columns") ────────────────────────────────────────
export interface CalendarType {
  uuid: string;
  code: string;
  name: string;
  sortOrder: number;
  status: string;
}

export interface CreateTypeRequest {
  name: string;
  code?: string; // optional; slugged from name when omitted
  sortOrder?: number;
}

export interface UpdateTypeRequest {
  name?: string;
  sortOrder?: number;
}

// ── Entries ───────────────────────────────────────────────────────────────────
export interface CalendarEntry {
  uuid: string;
  entryDate: string; // yyyy-mm-dd
  endDate?: string | null; // yyyy-mm-dd, null = single day
  typeId: string;
  typeCode?: string;
  typeName?: string;
  value: string;
  detail?: string | null;
  sortOrder?: number;
}

export interface AddEntryRequest {
  entryDate: string;
  endDate?: string | null;
  typeId?: string; // either typeId or typeCode identifies the type
  typeCode?: string;
  value: string;
  detail?: string | null;
  sortOrder?: number;
  academicYearId?: string;
}

export interface UpdateEntryRequest {
  value?: string;
  detail?: string | null;
  endDate?: string | null;
  sortOrder?: number;
  typeId?: string;
  typeCode?: string;
}

// ── Holidays ──────────────────────────────────────────────────────────────────
export interface CalendarHoliday {
  uuid: string;
  holidayDate: string; // yyyy-mm-dd
  name?: string | null;
  kind: HolidayKind;
}

export interface SetHolidayRequest {
  holidayDate: string;
  name?: string | null;
  kind?: HolidayKind; // defaults to 'full'
  academicYearId?: string;
}

// ── Grid read model ───────────────────────────────────────────────────────────
export interface CalendarDay {
  date: string; // yyyy-mm-dd
  weekday: string; // sun..sat
  isWeeklyOff: boolean; // Sunday
  holiday?: CalendarHoliday | null;
  entries: CalendarEntry[];
}

export interface CalendarView {
  academicYearId: string;
  from: string;
  to: string;
  types: CalendarType[];
  days: CalendarDay[];
}
