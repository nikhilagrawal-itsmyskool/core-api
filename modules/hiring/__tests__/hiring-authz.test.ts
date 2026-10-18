import { requireAction } from '../../auth/authz';
import { HIRING_ACTIONS } from '../hiring-actions';

// End-to-end guard check for the hiring module. No teacher access; admin + hiring-incharge.
const prevOffline = process.env.IS_OFFLINE;
beforeAll(() => { process.env.IS_OFFLINE = 'true'; });
afterAll(() => { process.env.IS_OFFLINE = prevOffline; });

function result(roles: string, action: string): number | 'allowed' {
  let status: number | 'allowed' = 'allowed';
  const cb = (_e: any, res: any) => { if (res && res.statusCode) status = res.statusCode; };
  const ev: any = { headers: { 'X-School-Code': 'DBPASN' }, requestContext: { authorizer: { principalId: 'u1', context: { type: 'employee', roles } } } };
  return requireAction(ev, action, cb as any) ? 'allowed' : status;
}

describe('hiring authorization (guard end-to-end)', () => {
  it('teacher: no hiring access -> 403', () => {
    expect(result('teacher', HIRING_ACTIONS['hiring-candidate-handler.list'])).toBe(403);
  });
  it('admin + hiring-incharge hold the pipeline', () => {
    expect(result('admin', HIRING_ACTIONS['hiring-candidate-handler.create'])).toBe('allowed');
    expect(result('hiring-incharge', HIRING_ACTIONS['hiring-stage-handler.create'])).toBe('allowed');
  });
});
