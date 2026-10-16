import { requireAction } from '../authz';
import { __setUserGrantsForTest } from '../../../shared/lib/authz-policy';

// Temporary per-employee grants: requireAction allows an action the role model denies when the
// caller holds an active (non-expired) grant, and goes back to 403 once it lapses/is cleared.
const prevOffline = process.env.IS_OFFLINE;
beforeAll(() => {
  process.env.IS_OFFLINE = 'true';
});
afterAll(() => {
  process.env.IS_OFFLINE = prevOffline;
  __setUserGrantsForTest([]);
});
afterEach(() => __setUserGrantsForTest([]));

function teacherEvent(employeeId: string): any {
  return {
    headers: { 'X-School-Code': 'DBPASN' },
    requestContext: { authorizer: { principalId: employeeId, context: { type: 'employee', roles: 'teacher' } } },
  };
}

function allowed(employeeId: string, action: string): boolean {
  let denied = false;
  const cb = (_e: any, res: any) => {
    if (res && res.statusCode === 403) denied = true;
  };
  const caller = requireAction(teacherEvent(employeeId), action, cb as any);
  return !!caller && !denied;
}

const ACTION = 'leave.deduction.run'; // god-only — a teacher never has this via roles

describe('temporary per-employee grant (requireAction)', () => {
  it('denies the teacher by default', () => {
    expect(allowed('emp-1', ACTION)).toBe(false);
  });

  it('allows while an active grant exists for that employee + action', () => {
    __setUserGrantsForTest([{ employeeId: 'emp-1', action: ACTION, expiresAt: Date.now() + 60 * 60 * 1000 }]);
    expect(allowed('emp-1', ACTION)).toBe(true);
    // Scoped to the exact employee + action: a different teacher / action is unaffected.
    expect(allowed('emp-2', ACTION)).toBe(false);
    expect(allowed('emp-1', 'leave.config.manage')).toBe(false);
  });

  it('denies once the grant has expired', () => {
    __setUserGrantsForTest([{ employeeId: 'emp-1', action: ACTION, expiresAt: Date.now() - 1000 }]);
    expect(allowed('emp-1', ACTION)).toBe(false);
  });
});
