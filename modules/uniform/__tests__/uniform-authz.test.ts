import { requireAction } from '../../auth/authz';
import { UNIFORM_ACTIONS } from '../uniform-actions';

// End-to-end guard check for the uniform module. No teacher access; admin holds the uniform.* wildcard.
const prevOffline = process.env.IS_OFFLINE;
beforeAll(() => { process.env.IS_OFFLINE = 'true'; });
afterAll(() => { process.env.IS_OFFLINE = prevOffline; });

function result(roles: string, action: string): number | 'allowed' {
  let status: number | 'allowed' = 'allowed';
  const cb = (_e: any, res: any) => { if (res && res.statusCode) status = res.statusCode; };
  const ev: any = { headers: { 'X-School-Code': 'DBPASN' }, requestContext: { authorizer: { principalId: 'u1', context: { type: 'employee', roles } } } };
  return requireAction(ev, action, cb as any) ? 'allowed' : status;
}

describe('uniform authorization (guard end-to-end)', () => {
  it('teacher: no uniform access -> 403', () => {
    expect(result('teacher', UNIFORM_ACTIONS['uniform-item-handler.listItems'])).toBe(403);
    expect(result('teacher', UNIFORM_ACTIONS['uniform-sale-handler.list'])).toBe(403);
  });
  it('admin holds everything via the uniform.* wildcard', () => {
    expect(result('admin', UNIFORM_ACTIONS['uniform-item-handler.createItem'])).toBe('allowed');
    expect(result('admin', UNIFORM_ACTIONS['uniform-lookup-handler.getLookups'])).toBe('allowed');
  });
});
