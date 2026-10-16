import { requireAction } from '../../auth/authz';
import { SPORT_ACTIONS } from '../sport-actions';

// End-to-end guard check for the sports module (see leave-authz.test.ts for the pattern).
// Teachers may VIEW inventory + the issue log only; admin + sports-incharge hold the sports.*
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

describe('sports authorization (guard end-to-end)', () => {
  it('teacher: may view inventory + issues (incl. lookups)', () => {
    expect(result('teacher', SPORT_ACTIONS['sport-item-handler.search'])).toBe('allowed');
    expect(result('teacher', SPORT_ACTIONS['sport-issue-handler.list'])).toBe('allowed');
    expect(result('teacher', SPORT_ACTIONS['sport-lookup-handler.getUnits'])).toBe('allowed');
  });

  it('teacher: cannot manage, see purchases, breakages, or in-charges -> 403', () => {
    expect(result('teacher', SPORT_ACTIONS['sport-item-handler.create'])).toBe(403);
    expect(result('teacher', SPORT_ACTIONS['sport-purchase-handler.list'])).toBe(403);
    expect(result('teacher', SPORT_ACTIONS['sport-breakage-handler.list'])).toBe(403);
    expect(result('teacher', SPORT_ACTIONS['sport-incharge-handler.list'])).toBe(403);
  });

  it('admin + sports-incharge hold everything via the sports.* wildcard', () => {
    expect(result('admin', SPORT_ACTIONS['sport-incharge-handler.setForSport'])).toBe('allowed');
    expect(result('admin', SPORT_ACTIONS['sport-breakage-handler.create'])).toBe('allowed');
    expect(result('sports-incharge', SPORT_ACTIONS['sport-purchase-batch-handler.createBulk'])).toBe('allowed');
  });
});
