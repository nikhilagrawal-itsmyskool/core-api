import { requireAction } from '../../auth/authz';
import { MEDICAL_ACTIONS } from '../medical-actions';

// End-to-end guard check for the medical module (see leave-authz.test.ts for the pattern).
// Teachers may VIEW inventory + the issue log, but not manage anything and not see purchases;
// admin + medical-incharge hold the medical.* wildcard (everything).
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

function result(roles: string, action: string): number | 'allowed' {
  let status: number | 'allowed' = 'allowed';
  const cb = (_err: any, res: any) => {
    if (res && res.statusCode) status = res.statusCode;
  };
  const caller = requireAction(eventFor(roles), action, cb as any);
  return caller ? 'allowed' : status;
}

describe('medical authorization (guard end-to-end)', () => {
  it('teacher: may view inventory + issues', () => {
    expect(result('teacher', MEDICAL_ACTIONS['medical-item-handler.search'])).toBe('allowed');
    expect(result('teacher', MEDICAL_ACTIONS['medical-issue-handler.list'])).toBe('allowed');
  });

  it('teacher: cannot manage or see purchases -> 403', () => {
    expect(result('teacher', MEDICAL_ACTIONS['medical-item-handler.create'])).toBe(403);
    expect(result('teacher', MEDICAL_ACTIONS['medical-issue-handler.create'])).toBe(403);
    expect(result('teacher', MEDICAL_ACTIONS['medical-purchase-handler.list'])).toBe(403);
  });

  it('admin + medical-incharge hold everything via the medical.* wildcard', () => {
    expect(result('admin', MEDICAL_ACTIONS['medical-purchase-handler.create'])).toBe('allowed');
    expect(result('admin', MEDICAL_ACTIONS['medical-item-handler.create'])).toBe('allowed');
    expect(result('medical-incharge', MEDICAL_ACTIONS['medical-purchase-batch-handler.createBulk'])).toBe('allowed');
  });
});
