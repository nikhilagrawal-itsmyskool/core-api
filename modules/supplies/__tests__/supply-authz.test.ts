import { requireAction } from '../../auth/authz';
import { SUPPLY_ACTIONS } from '../supply-actions';

// End-to-end guard check for the supplies module (see leave-authz.test.ts for the pattern).
// Teachers may view inventory + the issue log; admin + supplies-incharge hold the supplies.* wildcard.
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

describe('supplies authorization (guard end-to-end)', () => {
  it('teacher: may view inventory + issues', () => {
    expect(result('teacher', SUPPLY_ACTIONS['supply-item-handler.search'])).toBe('allowed');
    expect(result('teacher', SUPPLY_ACTIONS['supply-issue-handler.list'])).toBe('allowed');
  });

  it('teacher: cannot manage, see purchases, categories or wastage -> 403', () => {
    expect(result('teacher', SUPPLY_ACTIONS['supply-item-handler.create'])).toBe(403);
    expect(result('teacher', SUPPLY_ACTIONS['supply-purchase-batch-handler.list'])).toBe(403);
    expect(result('teacher', SUPPLY_ACTIONS['supply-category-handler.list'])).toBe(403);
    expect(result('teacher', SUPPLY_ACTIONS['supply-wastage-handler.list'])).toBe(403);
  });

  it('admin + supplies-incharge hold everything via the supplies.* wildcard', () => {
    expect(result('admin', SUPPLY_ACTIONS['supply-category-handler.create'])).toBe('allowed');
    expect(result('supplies-incharge', SUPPLY_ACTIONS['supply-wastage-handler.create'])).toBe('allowed');
  });
});
