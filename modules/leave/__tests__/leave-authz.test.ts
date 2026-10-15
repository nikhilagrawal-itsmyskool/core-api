import { requireAction } from '../../auth/authz';
import { LEAVE_ACTIONS } from '../leave-actions';

// End-to-end guard check for the leave module. With IS_OFFLINE set, requireAction()
// synthesizes a caller from the authorizer-override context and runs the REAL can() over
// the leave policy — so this exercises the actual endpoint->action mapping + role policy,
// not just can() in isolation. Proves teachers get the shared calendar + self-service but
// are denied every oversight/config/biometric/deduction route (god-only for now).
const prevOffline = process.env.IS_OFFLINE;
beforeAll(() => {
  process.env.IS_OFFLINE = 'true';
});
afterAll(() => {
  process.env.IS_OFFLINE = prevOffline;
});

function eventFor(roles: string): any {
  return {
    headers: { 'X-School-Code': 'DBPASN' },
    requestContext: { authorizer: { principalId: 'u1', context: { type: 'employee', roles } } },
  };
}

// Returns 'allowed' when guard admits the caller, else the HTTP status it wrote (e.g. 403).
function result(roles: string, action: string): number | 'allowed' {
  let status: number | 'allowed' = 'allowed';
  const cb = (_err: any, res: any) => {
    if (res && res.statusCode) status = res.statusCode;
  };
  const caller = requireAction(eventFor(roles), action, cb as any);
  return caller ? 'allowed' : status;
}

describe('leave authorization (guard end-to-end)', () => {
  it('teacher: shared calendar + self-service are allowed', () => {
    expect(result('teacher', LEAVE_ACTIONS['leave-handler.listApplications'])).toBe('allowed');
    expect(result('teacher', LEAVE_ACTIONS['leave-handler.getHandover'])).toBe('allowed');
    expect(result('teacher', LEAVE_ACTIONS['leave-me-handler.apply'])).toBe('allowed');
  });

  it('teacher: oversight / config / biometric / deduction routes -> 403', () => {
    expect(result('teacher', LEAVE_ACTIONS['leave-handler.approve'])).toBe(403);
    expect(result('teacher', LEAVE_ACTIONS['leave-handler.getApplication'])).toBe(403);
    expect(result('teacher', LEAVE_ACTIONS['leave-handler.getConfig'])).toBe(403);
    expect(result('teacher', LEAVE_ACTIONS['leave-handler.updateConfig'])).toBe(403);
    expect(result('teacher', LEAVE_ACTIONS['leave-attendance-handler.importFile'])).toBe(403);
    expect(result('teacher', LEAVE_ACTIONS['leave-deduction-handler.run'])).toBe(403);
  });

  it('admin: oversight is still god-only -> 403; god is allowed', () => {
    expect(result('admin', LEAVE_ACTIONS['leave-handler.approve'])).toBe(403);
    expect(result('admin', LEAVE_ACTIONS['leave-handler.updateConfig'])).toBe(403);
    // admin keeps the shared calendar + self-service though.
    expect(result('admin', LEAVE_ACTIONS['leave-handler.listApplications'])).toBe('allowed');
    expect(result('god', LEAVE_ACTIONS['leave-deduction-handler.run'])).toBe('allowed');
  });
});
