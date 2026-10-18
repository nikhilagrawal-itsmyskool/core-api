import { ACTIONS } from "../../shared/lib/authz-policy";

// Required permission per academic-calendar endpoint, keyed by the `handler:` reference in
// academic-calendar-endpoints.yml (`file.export`). Wired at the export site via guard().
//
// view    -> read the year's calendar, holidays, types ("columns") and settings (admin + teacher).
// manage  -> add/edit/delete entries, holidays, closures and types + the xlsx import console (admin).
// config.manage -> write the module settings (non-teaching / weekly-off config); god-first.
// Attendance reads calendar_holiday straight from the DB and other modules call via a service
// token (exempt), so no endpoint here is student-facing / public except the readiness probe.
const { ACADEMIC_CALENDAR_VIEW, ACADEMIC_CALENDAR_MANAGE, ACADEMIC_CALENDAR_CONFIG_MANAGE } = ACTIONS;

export const ACADEMIC_CALENDAR_ACTIONS: Record<string, string> = {
  // Reads
  "academic-calendar-handler.listTypes": ACADEMIC_CALENDAR_VIEW,
  "academic-calendar-handler.getCalendar": ACADEMIC_CALENDAR_VIEW,
  "academic-calendar-handler.listHolidays": ACADEMIC_CALENDAR_VIEW,
  "academic-calendar-handler.getNonTeaching": ACADEMIC_CALENDAR_VIEW,
  "academic-calendar-handler.getSettings": ACADEMIC_CALENDAR_VIEW,

  // Writes (admin)
  "academic-calendar-handler.createType": ACADEMIC_CALENDAR_MANAGE,
  "academic-calendar-handler.updateType": ACADEMIC_CALENDAR_MANAGE,
  "academic-calendar-handler.deleteType": ACADEMIC_CALENDAR_MANAGE,
  "academic-calendar-handler.addEntry": ACADEMIC_CALENDAR_MANAGE,
  "academic-calendar-handler.updateEntry": ACADEMIC_CALENDAR_MANAGE,
  "academic-calendar-handler.deleteEntry": ACADEMIC_CALENDAR_MANAGE,
  "academic-calendar-handler.setHoliday": ACADEMIC_CALENDAR_MANAGE,
  "academic-calendar-handler.closeRange": ACADEMIC_CALENDAR_MANAGE,
  "academic-calendar-handler.deleteHoliday": ACADEMIC_CALENDAR_MANAGE,
  "academic-calendar-handler.importPreview": ACADEMIC_CALENDAR_MANAGE,
  "academic-calendar-handler.importApply": ACADEMIC_CALENDAR_MANAGE,
  "academic-calendar-handler.importHistory": ACADEMIC_CALENDAR_MANAGE,
  "academic-calendar-handler.importFile": ACADEMIC_CALENDAR_MANAGE,

  // Module settings (god-first)
  "academic-calendar-handler.setSettings": ACADEMIC_CALENDAR_CONFIG_MANAGE,
};

// Endpoints intentionally NOT gated by requireAction:
//   - health: authorizer-exempt readiness probe.
export const ACADEMIC_CALENDAR_PUBLIC: string[] = ["health-handler.health"];
