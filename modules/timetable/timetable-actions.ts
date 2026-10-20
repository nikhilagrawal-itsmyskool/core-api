import { ACTIONS } from '../../shared/lib/authz-policy';

// Required permission per timetable endpoint, keyed by the `handler:` reference in
// timetable-endpoints.yml. Reads (lists/details/lookups + now/today) = timetable.view
// (admin + teacher). Every mutation — subjects, class setup, wings, electives, grid
// config, generation, publish, manual edits, constraints, seasons — = timetable.manage,
// which the policy grants to GOD ONLY (admin can view/print but not manage).
const V = ACTIONS.TIMETABLE_VIEW;
const M = ACTIONS.TIMETABLE_MANAGE;

export const TIMETABLE_ACTIONS: Record<string, string> = {
  'lookup-handler.getAll': V,

  // Subjects
  'subject-handler.list': V, 'subject-handler.getById': V,
  'subject-handler.create': M, 'subject-handler.update': M, 'subject-handler.remove': M,

  // Class ↔ subject demand
  'class-subject-handler.list': V, 'class-subject-handler.getById': V,
  'class-subject-handler.create': M, 'class-subject-handler.update': M, 'class-subject-handler.remove': M,
  'clone-handler.cloneClassSetup': M,

  // Teaching assignments
  'teaching-assignment-handler.list': V, 'teaching-assignment-handler.getById': V,
  'teaching-assignment-handler.create': M, 'teaching-assignment-handler.update': M, 'teaching-assignment-handler.remove': M,

  // Class teachers
  'class-teacher-handler.list': V, 'class-teacher-handler.getById': V,
  'class-teacher-handler.create': M, 'class-teacher-handler.update': M, 'class-teacher-handler.remove': M,

  // Wings
  'wing-handler.list': V, 'wing-handler.getById': V,
  'wing-handler.create': M, 'wing-handler.update': M, 'wing-handler.remove': M,

  // Class groups
  'class-group-handler.list': V, 'class-group-handler.getById': V,
  'class-group-handler.create': M, 'class-group-handler.update': M, 'class-group-handler.remove': M,

  // Elective bands
  'elective-handler.listBands': V, 'elective-handler.getBand': V,
  'elective-handler.createBand': M, 'elective-handler.updateBand': M, 'elective-handler.removeBand': M,
  'elective-handler.addOffering': M, 'elective-handler.removeOffering': M,

  // Grid config / days / slots
  'config-handler.listConfigs': V, 'config-handler.getConfig': V,
  'config-handler.createConfig': M, 'config-handler.updateConfig': M, 'config-handler.removeConfig': M,
  'config-handler.lock': M, 'config-handler.unlock': M, 'config-handler.clone': M,
  'config-handler.createDay': M, 'config-handler.updateDay': M, 'config-handler.removeDay': M, 'config-handler.cloneDaySlots': M,
  'config-handler.createSlot': M, 'config-handler.updateSlot': M, 'config-handler.removeSlot': M,

  // Generation / candidates / publish / manual edits (reads=view, actions=manage)
  'generation-handler.listRuns': V, 'generation-handler.getRun': V, 'generation-handler.getCandidates': V,
  'generation-handler.exportRun': V, 'generation-handler.getPublished': V, 'generation-handler.listPublished': V,
  'generation-handler.feasibility': M, 'generation-handler.generate': M, 'generation-handler.publish': M,
  'generation-handler.validateMove': M, 'generation-handler.moveEntry': M, 'generation-handler.editEntry': M, 'generation-handler.swapEntries': M,

  // Teacher constraints
  'teacher-constraint-handler.list': V, 'teacher-constraint-handler.getById': V,
  'teacher-constraint-handler.create': M, 'teacher-constraint-handler.update': M, 'teacher-constraint-handler.remove': M,

  // Seasons / slot times / activations
  'season-handler.list': V, 'season-handler.getById': V, 'season-handler.listSlotTimes': V, 'season-handler.listActivations': V,
  'season-handler.create': M, 'season-handler.update': M, 'season-handler.remove': M,
  'season-handler.setSlotTimes': M, 'season-handler.prefill': M, 'season-handler.removeSlotTime': M,
  'season-handler.createActivation': M, 'season-handler.updateActivation': M, 'season-handler.removeActivation': M,

  // "What's happening now/today" for a class (staff/360 reads)
  'now-handler.now': V, 'now-handler.today': V,
};

// NOT gated by requireAction:
//   - health: readiness probe
//   - now-handler.myNow / myWeek: parent app (family token + X-Student-Id) — guardActiveStudent
//   - generation-handler.processNext / claimAndDump / importSolution: the generation
//     job queue worker + external solver call these with a machine SERVICE token
//     (type='service', no roles), so requireAction would deny them. They stay on the
//     gateway authorizer (a valid service token) only.
export const TIMETABLE_PUBLIC: string[] = [
  'health-handler.health',
  'now-handler.myNow',
  'now-handler.myWeek',
  'generation-handler.processNext',
  'generation-handler.claimAndDump',
  'generation-handler.importSolution',
];
