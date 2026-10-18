import { requireAction } from '../../auth/authz';
import { SHOP_ACTIONS } from '../shop-actions';

// End-to-end guard check for the shop module. No teacher access; admin holds the shop.* wildcard.
const prevOffline = process.env.IS_OFFLINE;
beforeAll(() => { process.env.IS_OFFLINE = 'true'; });
afterAll(() => { process.env.IS_OFFLINE = prevOffline; });

function result(roles: string, action: string): number | 'allowed' {
  let status: number | 'allowed' = 'allowed';
  const cb = (_e: any, res: any) => { if (res && res.statusCode) status = res.statusCode; };
  const ev: any = { headers: { 'X-School-Code': 'DBPASN' }, requestContext: { authorizer: { principalId: 'u1', context: { type: 'employee', roles } } } };
  return requireAction(ev, action, cb as any) ? 'allowed' : status;
}

describe('shop authorization (guard end-to-end)', () => {
  it('teacher: no shop access -> 403', () => {
    expect(result('teacher', SHOP_ACTIONS['shop-item-handler.listItems'])).toBe(403);
    expect(result('teacher', SHOP_ACTIONS['shop-sale-handler.list'])).toBe(403);
  });
  it('admin holds everything via the shop.* wildcard', () => {
    expect(result('admin', SHOP_ACTIONS['shop-sale-handler.assign'])).toBe('allowed');
    expect(result('admin', SHOP_ACTIONS['shop-intake-handler.create'])).toBe('allowed');
  });
});
