import { ACTIONS } from '../../shared/lib/authz-policy';

// Authorization map for the timetable-ext service (overflow endpoints from the timetable
// stack), keyed by the `handler:` reference in timetable-ext-endpoints.yml. The coverage
// test asserts every handler here is gated or explicitly public. Same policy as the primary
// module: reads = timetable.view, mutations = timetable.manage (GOD only).
const V = ACTIONS.TIMETABLE_VIEW;
const M = ACTIONS.TIMETABLE_MANAGE;

export const TIMETABLE_EXT_ACTIONS: Record<string, string> = {
  'timetable-ext-handler.getPublishedById': V,
  'timetable-ext-handler.createManualMaster': M,
  'timetable-ext-handler.createEntry': M,
  'timetable-ext-handler.deleteEntry': M,
  'timetable-ext-handler.deleteMaster': M,
  'timetable-ext-handler.activateDraft': M,
};

export const TIMETABLE_EXT_PUBLIC: string[] = [
  'health-handler.health',
];
