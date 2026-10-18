import { requireAction } from '../../auth/authz';
import { FINE_ACTIONS } from '../fine-actions';

// End-to-end guard check for the fine (disciplinary) module. No teacher access; admin holds fine.*.
const prevOffline = process.env.IS_OFFLINE;
beforeAll(() => { process.env.IS_OFFLINE = 'true'; });
afterAll(() => { process.env.IS_OFFLINE = prevOffline; });

function result(roles: string, action: string): number | 'allowed' {
  let status: number | 'allowed' = 'allowed';
  const cb = (_e: any, res: any) => { if (res && res.statusCode) status = res.statusCode; };
  const ev: any = { headers: { 'X-School-Code': 'DBPASN' }, requestContext: { authorizer: { principalId: 'u1', context: { type: 'employee', roles } } } };
  return requireAction(ev, action, cb as any) ? 'allowed' : status;
}

describe('fine authorization (guard end-to-end)', () => {
  it('teacher: no fine access -> 403', () => {
    expect(result('teacher', FINE_ACTIONS['fine-incident-handler.list'])).toBe(403);
    expect(result('teacher', FINE_ACTIONS['fine-collection-handler.collect'])).toBe(403);
  });
  it('admin holds everything via the fine.* wildcard', () => {
    expect(result('admin', FINE_ACTIONS['fine-incident-handler.create'])).toBe('allowed');
    expect(result('admin', FINE_ACTIONS['fine-collection-handler.collect'])).toBe('allowed');
  });
});
