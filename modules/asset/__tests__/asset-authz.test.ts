import { requireAction } from '../../auth/authz';
import { ASSET_ACTIONS } from '../asset-actions';

// End-to-end guard check for the asset module (see leave-authz.test.ts for the pattern).
// No teacher access; admin + assets-incharge hold the asset.* wildcard.
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

describe('asset authorization (guard end-to-end)', () => {
  it('teacher: no asset access -> 403', () => {
    expect(result('teacher', ASSET_ACTIONS['asset-handler.getTree'])).toBe(403);
    expect(result('teacher', ASSET_ACTIONS['asset-type-handler.list'])).toBe(403);
  });

  it('admin + assets-incharge hold everything via the asset.* wildcard', () => {
    expect(result('admin', ASSET_ACTIONS['asset-handler.getTree'])).toBe('allowed');
    expect(result('admin', ASSET_ACTIONS['asset-handler.create'])).toBe('allowed');
    expect(result('assets-incharge', ASSET_ACTIONS['asset-type-handler.create'])).toBe('allowed');
  });
});
