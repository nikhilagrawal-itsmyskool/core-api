import { requireAction } from '../../auth/authz';
import { LAB_ACTIONS } from '../lab-actions';

// End-to-end guard check for the lab module (see leave-authz.test.ts for the pattern).
// Teachers may VIEW inventory + the issue log only; admin + lab-incharge hold the lab.*
// wildcard (everything).
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

describe('lab authorization (guard end-to-end)', () => {
  it('teacher: may view inventory + issues (incl. lookups)', () => {
    expect(result('teacher', LAB_ACTIONS['lab-item-handler.search'])).toBe('allowed');
    expect(result('teacher', LAB_ACTIONS['lab-issue-handler.list'])).toBe('allowed');
    expect(result('teacher', LAB_ACTIONS['lab-lookup-handler.getUnits'])).toBe('allowed');
  });

  it('teacher: cannot manage, see purchases, breakages, or the labs registry -> 403', () => {
    expect(result('teacher', LAB_ACTIONS['lab-item-handler.create'])).toBe(403);
    expect(result('teacher', LAB_ACTIONS['lab-purchase-handler.list'])).toBe(403);
    expect(result('teacher', LAB_ACTIONS['lab-breakage-handler.list'])).toBe(403);
    expect(result('teacher', LAB_ACTIONS['lab-handler.list'])).toBe(403);
  });

  it('admin + lab-incharge hold everything via the lab.* wildcard', () => {
    expect(result('admin', LAB_ACTIONS['lab-handler.create'])).toBe('allowed');
    expect(result('admin', LAB_ACTIONS['lab-breakage-handler.create'])).toBe('allowed');
    expect(result('lab-incharge', LAB_ACTIONS['lab-purchase-batch-handler.createBulk'])).toBe('allowed');
  });
});
