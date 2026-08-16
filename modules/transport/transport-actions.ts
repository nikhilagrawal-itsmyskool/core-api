import { ACTIONS } from '../../shared/lib/authz-policy';

// Required permission per transport endpoint, keyed by the `handler:` reference in
// transport-endpoints.yml. Reads (lookups + vehicle/stop/route/assignment lists &
// details, route roster, student report) = transport.view; config writes (vehicles,
// stops, routes + route-stops, assignments) = transport.manage. Bus-attendance screens
// & marking = transport.attendance.mark (managers on any route; a transport-attendance
// teacher only on routes they staff — that ROUTE-STAFF filtering stays in the handler);
// finalize + post-finalize edit = transport.attendance.finalize.
const { TRANSPORT_VIEW, TRANSPORT_MANAGE, TRANSPORT_ATTENDANCE_MARK, TRANSPORT_ATTENDANCE_FINALIZE } = ACTIONS;

export const TRANSPORT_ACTIONS: Record<string, string> = {
  'transport-lookup-handler.getLookups': TRANSPORT_VIEW,

  // vehicles
  'transport-vehicle-handler.list': TRANSPORT_VIEW,
  'transport-vehicle-handler.getById': TRANSPORT_VIEW,
  'transport-vehicle-handler.create': TRANSPORT_MANAGE,
  'transport-vehicle-handler.update': TRANSPORT_MANAGE,
  'transport-vehicle-handler.remove': TRANSPORT_MANAGE,

  // stops
  'transport-stop-handler.list': TRANSPORT_VIEW,
  'transport-stop-handler.getById': TRANSPORT_VIEW,
  'transport-stop-handler.bulkUpsert': TRANSPORT_MANAGE,
  'transport-stop-handler.create': TRANSPORT_MANAGE,
  'transport-stop-handler.update': TRANSPORT_MANAGE,
  'transport-stop-handler.remove': TRANSPORT_MANAGE,

  // routes
  'transport-route-handler.list': TRANSPORT_VIEW,
  'transport-route-handler.getById': TRANSPORT_VIEW,
  'transport-route-handler.create': TRANSPORT_MANAGE,
  'transport-route-handler.update': TRANSPORT_MANAGE,
  'transport-route-handler.remove': TRANSPORT_MANAGE,
  'transport-route-handler.addStops': TRANSPORT_MANAGE,
  'transport-route-handler.reorderStops': TRANSPORT_MANAGE,
  'transport-route-handler.removeStop': TRANSPORT_MANAGE,

  // assignments + reports
  'transport-assignment-handler.routeRoster': TRANSPORT_VIEW,
  'transport-assignment-handler.list': TRANSPORT_VIEW,
  'transport-assignment-handler.studentReport': TRANSPORT_VIEW,
  'transport-assignment-handler.create': TRANSPORT_MANAGE,
  'transport-assignment-handler.update': TRANSPORT_MANAGE,
  'transport-assignment-handler.remove': TRANSPORT_MANAGE,

  // attendance
  'transport-attendance-handler.getRoster': TRANSPORT_ATTENDANCE_MARK,
  'transport-attendance-handler.openSession': TRANSPORT_ATTENDANCE_MARK,
  'transport-attendance-handler.listSessions': TRANSPORT_ATTENDANCE_MARK,
  'transport-attendance-handler.getSession': TRANSPORT_ATTENDANCE_MARK,
  'transport-attendance-handler.saveMarks': TRANSPORT_ATTENDANCE_MARK,
  'transport-attendance-handler.finalize': TRANSPORT_ATTENDANCE_FINALIZE,
  'transport-attendance-handler.editRecord': TRANSPORT_ATTENDANCE_FINALIZE,
};

// health: readiness probe. transport-assignment-handler.myTransport: parent app
// (family token + X-Student-Id) — guarded by guardActiveStudent, not requireAction.
export const TRANSPORT_PUBLIC: string[] = ['health-handler.health', 'transport-assignment-handler.myTransport'];
