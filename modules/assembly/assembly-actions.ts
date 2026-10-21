import { ACTIONS } from "../../shared/lib/authz-policy";

// Required permission per assembly endpoint, keyed by the `handler:` reference in
// assembly-endpoints.yml (`file.export`). Wired at the export site via guard().
//
// plan    = planning content (plans, nodes, specials, themes, references, lookups, resolve, pulse, documents)
// week    = the weekly roster workflow (admin surface); conduct = the teacher /me duty surface
//           (duties-handler; scoped in-handler by house-on-duty / evaluator data, not role)
// grading = rubric + evaluators + grades + the conduct checklist (master + ticks + signoff)
// house   = house mode + rotation
// config.manage = house/grading setConfig (god-first)
// PUBLIC  = health + student-app me/today, me/on + duties leaderboard (student token)
const {
  ASSEMBLY_PLAN_VIEW, ASSEMBLY_PLAN_MANAGE,
  ASSEMBLY_WEEK_VIEW, ASSEMBLY_WEEK_MANAGE, ASSEMBLY_WEEK_CONDUCT,
  ASSEMBLY_GRADING_VIEW, ASSEMBLY_GRADING_MANAGE,
  ASSEMBLY_HOUSE_VIEW, ASSEMBLY_HOUSE_MANAGE, ASSEMBLY_CONFIG_MANAGE,
} = ACTIONS;

export const ASSEMBLY_ACTIONS: Record<string, string> = {
  // Lookups + live/resolve + pulse (staff reads)
  "assembly-lookup-handler.getLookups": ASSEMBLY_PLAN_VIEW,
  "assembly-resolve-handler.resolve": ASSEMBLY_PLAN_VIEW,
  "assembly-pulse-handler.pulse": ASSEMBLY_PLAN_VIEW,

  // Plans
  "assembly-plan-handler.list": ASSEMBLY_PLAN_VIEW,
  "assembly-plan-handler.getById": ASSEMBLY_PLAN_VIEW,
  "assembly-plan-handler.getClasses": ASSEMBLY_PLAN_VIEW,
  "assembly-plan-handler.create": ASSEMBLY_PLAN_MANAGE,
  "assembly-plan-handler.update": ASSEMBLY_PLAN_MANAGE,
  "assembly-plan-handler.remove": ASSEMBLY_PLAN_MANAGE,
  "assembly-plan-handler.publish": ASSEMBLY_PLAN_MANAGE,
  "assembly-plan-handler.clone": ASSEMBLY_PLAN_MANAGE,
  "assembly-plan-handler.setClasses": ASSEMBLY_PLAN_MANAGE,
  "assembly-plan-handler.setDays": ASSEMBLY_PLAN_MANAGE,

  // Nodes (plan tree)
  "assembly-node-handler.tree": ASSEMBLY_PLAN_VIEW,
  "assembly-node-handler.getById": ASSEMBLY_PLAN_VIEW,
  "assembly-node-handler.create": ASSEMBLY_PLAN_MANAGE,
  "assembly-node-handler.createForSpecial": ASSEMBLY_PLAN_MANAGE,
  "assembly-node-handler.reorderForSpecial": ASSEMBLY_PLAN_MANAGE,
  "assembly-node-handler.reorder": ASSEMBLY_PLAN_MANAGE,
  "assembly-node-handler.update": ASSEMBLY_PLAN_MANAGE,
  "assembly-node-handler.remove": ASSEMBLY_PLAN_MANAGE,
  "assembly-node-handler.setDays": ASSEMBLY_PLAN_MANAGE,
  "assembly-node-handler.setResponsible": ASSEMBLY_PLAN_MANAGE,
  "assembly-node-handler.setResources": ASSEMBLY_PLAN_MANAGE,
  "assembly-node-handler.setDayContent": ASSEMBLY_PLAN_MANAGE,

  // Special assemblies
  "assembly-special-handler.list": ASSEMBLY_PLAN_VIEW,
  "assembly-special-handler.getById": ASSEMBLY_PLAN_VIEW,
  "assembly-special-handler.create": ASSEMBLY_PLAN_MANAGE,
  "assembly-special-handler.update": ASSEMBLY_PLAN_MANAGE,
  "assembly-special-handler.remove": ASSEMBLY_PLAN_MANAGE,
  "assembly-special-handler.publish": ASSEMBLY_PLAN_MANAGE,

  // Themes
  "assembly-theme-handler.list": ASSEMBLY_PLAN_VIEW,
  "assembly-theme-handler.getById": ASSEMBLY_PLAN_VIEW,
  "assembly-theme-handler.create": ASSEMBLY_PLAN_MANAGE,
  "assembly-theme-handler.update": ASSEMBLY_PLAN_MANAGE,
  "assembly-theme-handler.remove": ASSEMBLY_PLAN_MANAGE,

  // References (plan resources)
  "assembly-reference-handler.list": ASSEMBLY_PLAN_VIEW,
  "assembly-reference-handler.getFile": ASSEMBLY_PLAN_VIEW,
  "assembly-reference-handler.add": ASSEMBLY_PLAN_MANAGE,
  "assembly-reference-handler.update": ASSEMBLY_PLAN_MANAGE,
  "assembly-reference-handler.remove": ASSEMBLY_PLAN_MANAGE,

  // Documents
  "assembly-document-handler.list": ASSEMBLY_PLAN_VIEW,
  "assembly-document-handler.getFile": ASSEMBLY_PLAN_VIEW,
  "assembly-document-handler.upload": ASSEMBLY_PLAN_MANAGE,
  "assembly-document-handler.remove": ASSEMBLY_PLAN_MANAGE,

  // Weekly roster (admin surface)
  "assembly-week-handler.list": ASSEMBLY_WEEK_VIEW,
  "assembly-week-handler.getById": ASSEMBLY_WEEK_VIEW,
  "assembly-week-handler.ensure": ASSEMBLY_WEEK_MANAGE,
  "assembly-week-handler.saveRoster": ASSEMBLY_WEEK_MANAGE,
  "assembly-week-handler.submit": ASSEMBLY_WEEK_MANAGE,
  "assembly-week-handler.approve": ASSEMBLY_WEEK_MANAGE,
  "assembly-week-handler.recall": ASSEMBLY_WEEK_MANAGE,
  "assembly-week-handler.lock": ASSEMBLY_WEEK_MANAGE,
  "assembly-week-handler.unlock": ASSEMBLY_WEEK_MANAGE,

  // Teacher duty surface (/me) — conduct; scoped in-handler by house/evaluator
  "assembly-duties-handler.duties": ASSEMBLY_WEEK_CONDUCT,
  "assembly-duties-handler.ensureWeek": ASSEMBLY_WEEK_CONDUCT,
  "assembly-duties-handler.getWeek": ASSEMBLY_WEEK_CONDUCT,
  "assembly-duties-handler.saveRoster": ASSEMBLY_WEEK_CONDUCT,
  "assembly-duties-handler.submit": ASSEMBLY_WEEK_CONDUCT,
  "assembly-duties-handler.recall": ASSEMBLY_WEEK_CONDUCT,
  "assembly-duties-handler.addReference": ASSEMBLY_WEEK_CONDUCT,
  "assembly-duties-handler.updateReference": ASSEMBLY_WEEK_CONDUCT,
  "assembly-duties-handler.removeReference": ASSEMBLY_WEEK_CONDUCT,
  "assembly-duties-handler.getChecklist": ASSEMBLY_WEEK_CONDUCT,
  "assembly-duties-handler.saveChecklist": ASSEMBLY_WEEK_CONDUCT,
  "assembly-duties-handler.signoff": ASSEMBLY_WEEK_CONDUCT,
  "assembly-duties-handler.getGrades": ASSEMBLY_WEEK_CONDUCT,
  "assembly-duties-handler.saveGrade": ASSEMBLY_WEEK_CONDUCT,

  // Grading (admin surface). getRubric + leaderboard are non-sensitive (grading criteria
  // and house averages) and needed by evaluator-teachers (to grade) and all staff (to see
  // the leaderboard), so they sit at plan.view — matching the frontend tile gate. The
  // per-evaluator reads (listGrades/getGrade/listEvaluators) stay grading.view so one
  // teacher can't see another's individual marks.
  "assembly-grading-handler.getRubric": ASSEMBLY_PLAN_VIEW,
  "assembly-grading-handler.leaderboard": ASSEMBLY_PLAN_VIEW,
  "assembly-grading-handler.listEvaluators": ASSEMBLY_GRADING_VIEW,
  "assembly-grading-handler.listGrades": ASSEMBLY_GRADING_VIEW,
  "assembly-grading-handler.getGrade": ASSEMBLY_GRADING_VIEW,
  "assembly-grading-handler.createMetric": ASSEMBLY_GRADING_MANAGE,
  "assembly-grading-handler.updateMetric": ASSEMBLY_GRADING_MANAGE,
  "assembly-grading-handler.deleteMetric": ASSEMBLY_GRADING_MANAGE,
  "assembly-grading-handler.createPenalty": ASSEMBLY_GRADING_MANAGE,
  "assembly-grading-handler.updatePenalty": ASSEMBLY_GRADING_MANAGE,
  "assembly-grading-handler.deletePenalty": ASSEMBLY_GRADING_MANAGE,
  "assembly-grading-handler.addEvaluator": ASSEMBLY_GRADING_MANAGE,
  "assembly-grading-handler.removeEvaluator": ASSEMBLY_GRADING_MANAGE,
  "assembly-grading-handler.saveGrade": ASSEMBLY_GRADING_MANAGE,
  "assembly-grading-handler.deleteGrade": ASSEMBLY_GRADING_MANAGE,
  "assembly-grading-handler.setConfig": ASSEMBLY_CONFIG_MANAGE,

  // Conduct checklist master (admin surface)
  "assembly-checklist-handler.listItems": ASSEMBLY_GRADING_VIEW,
  "assembly-checklist-handler.getWeekChecklist": ASSEMBLY_GRADING_VIEW,
  "assembly-checklist-handler.createItem": ASSEMBLY_GRADING_MANAGE,
  "assembly-checklist-handler.updateItem": ASSEMBLY_GRADING_MANAGE,
  "assembly-checklist-handler.deleteItem": ASSEMBLY_GRADING_MANAGE,
  "assembly-checklist-handler.saveTicks": ASSEMBLY_GRADING_MANAGE,
  "assembly-checklist-handler.signoff": ASSEMBLY_GRADING_MANAGE,
  "assembly-checklist-handler.clearSignoff": ASSEMBLY_GRADING_MANAGE,

  // Houses
  "assembly-house-handler.getConfig": ASSEMBLY_HOUSE_VIEW,
  "assembly-house-handler.listHouses": ASSEMBLY_HOUSE_VIEW,
  "assembly-house-handler.rotation": ASSEMBLY_HOUSE_VIEW,
  "assembly-house-handler.setRotation": ASSEMBLY_HOUSE_MANAGE,
  "assembly-house-handler.setWeekHouse": ASSEMBLY_HOUSE_MANAGE,
  "assembly-house-handler.setConfig": ASSEMBLY_CONFIG_MANAGE,
};

// Endpoints intentionally NOT gated by requireAction:
//   - health: authorizer-exempt readiness probe.
//   - me/today, me/on (assembly-me-handler): student/parent app (student token).
//   - duties leaderboard (assembly-duties-handler.leaderboard): student app leaderboard.
export const ASSEMBLY_PUBLIC: string[] = [
  "health-handler.health",
  "assembly-me-handler.today",
  "assembly-me-handler.on",
  "assembly-duties-handler.leaderboard",
];
