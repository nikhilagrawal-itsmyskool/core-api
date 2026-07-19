import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { guardActiveStudent } from "./handler-util";
import { syllabusMeService } from "./syllabus-me-service";

class SyllabusMeHandler {
  // Student/parent app: GET /syllabus/me/timeline?academicYearId=&today=
  // The active child's grade timeline. Child + school from the family token +
  // X-Student-Id header (guardActiveStudent).
  public timeline = async (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback,
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = guardActiveStudent(event, callback);
      if (!auth) return;

      const schoolId = auth.token.school_id;
      const studentId = auth.activeStudentId;
      const q = event.queryStringParameters || {};

      // academicYearId is optional — the service defaults to the current year.
      const result = await syllabusMeService.getTimeline(
        schoolId,
        studentId,
        q.academicYearId,
        q.today,
      );
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new SyllabusMeHandler();
export const timeline = handler.timeline;
