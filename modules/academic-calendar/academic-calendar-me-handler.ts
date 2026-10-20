import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { guardActiveStudent } from "../auth/auth-utils";
import { resolveStudentEnrollment } from "../../shared/lib/student-context";
import { istToday } from "../../shared/util/datetime";
import { academicCalendarService } from "./academic-calendar-service";

// Parent-app calendar surface (family token + X-Student-Id). Self-authorizing (the student
// context is the authorization) — NOT gated by requireAction.
class AcademicCalendarMeHandler {
  // GET /academic-calendar/me/day?date=YYYY-MM-DD  (default: today IST)
  public day = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = guardActiveStudent(event, callback);
      if (!auth) return;
      const schoolId = auth.token.school_id;
      const enrol = await resolveStudentEnrollment(schoolId, auth.activeStudentId);
      const ay = enrol?.academicYearId;
      const date = event.queryStringParameters?.date || istToday();
      if (!ay) {
        // No enrolment → treat as a plain day (Sunday-only awareness downstream in the app).
        ResponseBuilder.ok({ date, weekday: null, isWeeklyOff: false, isHoliday: false, holidayName: null, holidayKind: null, nonTeaching: false, working: true, theme: null, label: null }, callback);
        return;
      }
      ResponseBuilder.ok(await academicCalendarService.meDay(schoolId, ay, date), callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /academic-calendar/me/calendar  — today's status + upcoming holidays & events.
  public calendar = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = guardActiveStudent(event, callback);
      if (!auth) return;
      const schoolId = auth.token.school_id;
      const enrol = await resolveStudentEnrollment(schoolId, auth.activeStudentId);
      const ay = enrol?.academicYearId;
      const from = istToday();
      if (!ay) {
        ResponseBuilder.ok({ academicYearId: null, academicYearName: null, today: null, items: [] }, callback);
        return;
      }
      // Horizon: the rest of the year (~300 days forward covers any academic year).
      const to = new Date(Date.parse(`${from}T00:00:00Z`) + 300 * 86400000).toISOString().slice(0, 10);
      const [today, cal] = await Promise.all([
        academicCalendarService.meDay(schoolId, ay, from),
        academicCalendarService.meCalendar(schoolId, ay, from, to),
      ]);
      ResponseBuilder.ok({ academicYearId: ay, academicYearName: enrol?.academicYearName || null, today, items: cal.items }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new AcademicCalendarMeHandler();
export const day = h.day;
export const calendar = h.calendar;
