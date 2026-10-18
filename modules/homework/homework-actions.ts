import { ACTIONS } from "../../shared/lib/authz-policy";

// Required permission per homework endpoint, keyed by the `handler:` reference in
// homework-endpoints.yml (`file.export`). Wired at the export site of each handler via guard().
//
// homework-handler = admin oversight (any class): reads -> day.view, edits + the class↔teacher
// mapping -> day.manage. homework-me-handler = the class teacher's own-class posting surface
// (resolveEmployee + canPostForClass) -> day.post. me/today (studentToday) is the student/parent
// app — it self-authorizes via the student token, so it is PUBLIC (not action-gated).
const { HOMEWORK_DAY_VIEW, HOMEWORK_DAY_POST, HOMEWORK_DAY_MANAGE } = ACTIONS;

export const HOMEWORK_ACTIONS: Record<string, string> = {
  // Admin oversight (homework-handler)
  "homework-handler.getDay": HOMEWORK_DAY_VIEW,
  "homework-handler.getItemImage": HOMEWORK_DAY_VIEW,
  "homework-handler.listClasses": HOMEWORK_DAY_VIEW,
  "homework-handler.classTeacherMap": HOMEWORK_DAY_VIEW,
  "homework-handler.getAudit": HOMEWORK_DAY_VIEW,
  "homework-handler.ensureDay": HOMEWORK_DAY_MANAGE,
  "homework-handler.addItem": HOMEWORK_DAY_MANAGE,
  "homework-handler.editItem": HOMEWORK_DAY_MANAGE,
  "homework-handler.removeItem": HOMEWORK_DAY_MANAGE,
  "homework-handler.publish": HOMEWORK_DAY_MANAGE,
  "homework-handler.unpublish": HOMEWORK_DAY_MANAGE,
  "homework-handler.setClassTeacher": HOMEWORK_DAY_MANAGE,
  "homework-handler.clearClassTeacher": HOMEWORK_DAY_MANAGE,

  // Class teacher's own-class posting (homework-me-handler)
  "homework-me-handler.myClasses": HOMEWORK_DAY_POST,
  "homework-me-handler.getDay": HOMEWORK_DAY_POST,
  "homework-me-handler.ensureDay": HOMEWORK_DAY_POST,
  "homework-me-handler.addItem": HOMEWORK_DAY_POST,
  "homework-me-handler.editItem": HOMEWORK_DAY_POST,
  "homework-me-handler.removeItem": HOMEWORK_DAY_POST,
  "homework-me-handler.getItemImage": HOMEWORK_DAY_POST,
  "homework-me-handler.publish": HOMEWORK_DAY_POST,
  "homework-me-handler.unpublish": HOMEWORK_DAY_POST,
};

// Endpoints intentionally NOT gated by requireAction:
//   - health: authorizer-exempt readiness probe
//   - me/today (studentToday): student/parent app; self-authorizes via the student token
//     (students carry no roles, so it cannot be action-gated).
export const HOMEWORK_PUBLIC: string[] = [
  "health-handler.health",
  "homework-me-handler.studentToday",
];
