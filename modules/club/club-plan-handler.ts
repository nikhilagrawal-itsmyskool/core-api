import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { guard } from "../auth/authz";
import { resolveSchool, parseBody, requireParam } from "./handler-util";
import { clubPlanService } from "./club-plan-service";
import { getCurrentAcademicYearId } from "./club-common";
import { CLUB_ACTIONS } from "./club-actions";
import {
  AssignmentRequest,
  CompletionRequest,
  CreatePlanRequest,
  GroupRequest,
  SlotRequest,
  UpdatePlanRequest,
} from "./club-interfaces";

// Helper: wrap a (schoolId,userId)->result call with the standard try/resolve/respond.
function run(fn: (schoolId: string, userId: string, event: ApiEvent) => Promise<any>) {
  return async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const result = await fn(auth.schoolId, auth.userId, event);
      if (result === null) return ResponseBuilder.notFound(ErrorCode.InvalidId, "Not found", callback);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      // Surface publish blockers as structured data when present.
      if (err && err.blockers) {
        return ResponseBuilder.badRequest(ErrorCode.BusinessError, JSON.stringify({ message: err.description, blockers: err.blockers }), callback);
      }
      ResponseBuilder.handleError(err, callback);
    }
  };
}

class ClubPlanHandler {
  listPlans = run(async (schoolId, _u, event) => {
    const q = event.queryStringParameters || {};
    return clubPlanService.listPlans(schoolId, { academicYearId: q.academicYearId, from: q.from, to: q.to });
  });

  getPlan = run(async (schoolId, _u, event) => {
    const id = event.pathParameters?.id;
    if (!id) throw new Error("id required");
    return clubPlanService.getPlan(schoolId, id);
  });

  validate = run(async (schoolId, _u, event) => {
    const id = event.pathParameters?.id;
    if (!id) throw new Error("id required");
    return clubPlanService.validate(schoolId, id);
  });

  createPlan = run(async (schoolId, userId, event) => {
    const body = JSON.parse(event.body || "{}") as CreatePlanRequest;
    return clubPlanService.createPlan(schoolId, body, userId);
  });

  updatePlan = run(async (schoolId, userId, event) => {
    const id = event.pathParameters?.id!;
    const body = JSON.parse(event.body || "{}") as UpdatePlanRequest;
    return clubPlanService.updatePlan(schoolId, id, body, userId);
  });

  addSlot = run(async (schoolId, userId, event) => {
    const id = event.pathParameters?.id!;
    return clubPlanService.addSlot(schoolId, id, JSON.parse(event.body || "{}") as SlotRequest, userId);
  });
  removeSlot = run(async (schoolId, _u, event) => {
    const id = event.pathParameters?.id!, slotId = event.pathParameters?.slotId!;
    return clubPlanService.removeSlot(schoolId, id, slotId);
  });

  addGroup = run(async (schoolId, userId, event) => {
    const id = event.pathParameters?.id!;
    return clubPlanService.addGroup(schoolId, id, JSON.parse(event.body || "{}") as GroupRequest, userId);
  });
  removeGroup = run(async (schoolId, _u, event) => {
    const id = event.pathParameters?.id!, groupId = event.pathParameters?.groupId!;
    return clubPlanService.removeGroup(schoolId, id, groupId);
  });
  generateGroups = run(async (schoolId, userId, event) => {
    const id = event.pathParameters?.id!;
    return clubPlanService.generateGroups(schoolId, id, userId);
  });
  generateHouses = run(async (schoolId, userId, event) => {
    const id = event.pathParameters?.id!;
    return clubPlanService.generateGroupsFromHouses(schoolId, id, userId);
  });
  // Custom-group picker data
  listClasses = run(async (schoolId, _u, event) => {
    const q = event.queryStringParameters || {};
    const ay = q.academicYearId || (await getCurrentAcademicYearId(schoolId));
    return ay ? clubPlanService.listPickerClasses(schoolId, ay) : [];
  });
  listClassStudents = run(async (schoolId, _u, event) => {
    const classId = event.pathParameters?.classId!;
    const q = event.queryStringParameters || {};
    const ay = q.academicYearId || (await getCurrentAcademicYearId(schoolId));
    return ay ? clubPlanService.listClassStudents(schoolId, classId, ay) : [];
  });

  // Draft-only assignment editing (manage). Rejects a published plan (use change).
  saveAssignment = run(async (schoolId, userId, event) => {
    const id = event.pathParameters?.id!;
    const plan = await clubPlanService.getPlan(schoolId, id);
    if (!plan) return null;
    if (plan.status !== "draft") throw Object.assign(new Error("Use the change endpoint to edit a published plan"), { code: ErrorCode.BusinessError });
    return clubPlanService.upsertAssignment(schoolId, id, JSON.parse(event.body || "{}") as AssignmentRequest, userId);
  });

  // After-publish controlled change (publish permission).
  changeAssignment = run(async (schoolId, userId, event) => {
    const id = event.pathParameters?.id!;
    const plan = await clubPlanService.getPlan(schoolId, id);
    if (!plan) return null;
    if (plan.status !== "published") throw Object.assign(new Error("Change applies to a published plan"), { code: ErrorCode.BusinessError });
    return clubPlanService.upsertAssignment(schoolId, id, JSON.parse(event.body || "{}") as AssignmentRequest, userId);
  });

  cancelAssignment = run(async (schoolId, userId, event) => {
    const assignmentId = event.pathParameters?.assignmentId!;
    const body = JSON.parse(event.body || "{}");
    return clubPlanService.cancelAssignment(schoolId, assignmentId, body.reason || "", userId);
  });

  adminComplete = run(async (schoolId, userId, event) => {
    const assignmentId = event.pathParameters?.assignmentId!;
    const body = JSON.parse(event.body || "{}") as CompletionRequest;
    return clubPlanService.upsertCompletion(schoolId, assignmentId, body, userId);
  });

  publish = run(async (schoolId, userId, event) => {
    const id = event.pathParameters?.id!;
    const body = JSON.parse(event.body || "{}");
    return clubPlanService.publish(schoolId, id, body.rowVersion, userId);
  });
  close = run(async (schoolId, userId, event) => clubPlanService.close(schoolId, event.pathParameters?.id!, userId));
  reopen = run(async (schoolId, userId, event) => clubPlanService.reopen(schoolId, event.pathParameters?.id!, userId));
  cancelPlan = run(async (schoolId, userId, event) => {
    const body = JSON.parse(event.body || "{}");
    return clubPlanService.cancelPlan(schoolId, event.pathParameters?.id!, body.reason || "", userId);
  });
}

const h = new ClubPlanHandler();
const A = CLUB_ACTIONS;
export const listPlans = guard(A["club-plan-handler.listPlans"], h.listPlans);
export const getPlan = guard(A["club-plan-handler.getPlan"], h.getPlan);
export const validate = guard(A["club-plan-handler.validate"], h.validate);
export const createPlan = guard(A["club-plan-handler.createPlan"], h.createPlan);
export const updatePlan = guard(A["club-plan-handler.updatePlan"], h.updatePlan);
export const addSlot = guard(A["club-plan-handler.addSlot"], h.addSlot);
export const removeSlot = guard(A["club-plan-handler.removeSlot"], h.removeSlot);
export const addGroup = guard(A["club-plan-handler.addGroup"], h.addGroup);
export const removeGroup = guard(A["club-plan-handler.removeGroup"], h.removeGroup);
export const generateGroups = guard(A["club-plan-handler.generateGroups"], h.generateGroups);
export const generateHouses = guard(A["club-plan-handler.generateHouses"], h.generateHouses);
export const listClasses = guard(A["club-plan-handler.listClasses"], h.listClasses);
export const listClassStudents = guard(A["club-plan-handler.listClassStudents"], h.listClassStudents);
export const saveAssignment = guard(A["club-plan-handler.saveAssignment"], h.saveAssignment);
export const changeAssignment = guard(A["club-plan-handler.changeAssignment"], h.changeAssignment);
export const cancelAssignment = guard(A["club-plan-handler.cancelAssignment"], h.cancelAssignment);
export const adminComplete = guard(A["club-plan-handler.adminComplete"], h.adminComplete);
export const publish = guard(A["club-plan-handler.publish"], h.publish);
export const close = guard(A["club-plan-handler.close"], h.close);
export const reopen = guard(A["club-plan-handler.reopen"], h.reopen);
export const cancelPlan = guard(A["club-plan-handler.cancelPlan"], h.cancelPlan);
