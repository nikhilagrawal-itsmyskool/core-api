import { requireAction } from '../../auth/authz';
import { TRANSPORT_ACTIONS } from '../transport-actions';

// End-to-end guard check: setup is admin/incharge; bus-attendance teacher marks only.
const prevOffline = process.env.IS_OFFLINE;
beforeAll(() => { process.env.IS_OFFLINE = 'true'; });
afterAll(() => { process.env.IS_OFFLINE = prevOffline; });

function result(roles: string, action: string): number | 'allowed' {
  let status: number | 'allowed' = 'allowed';
  const cb = (_e: any, res: any) => { if (res && res.statusCode) status = res.statusCode; };
  const ev: any = { headers: { 'X-School-Code': 'DBPASN' }, requestContext: { authorizer: { principalId: 'u1', context: { type: 'employee', roles } } } };
  return requireAction(ev, action, cb as any) ? 'allowed' : status;
}

const SETUP_VIEW = TRANSPORT_ACTIONS['transport-vehicle-handler.list'];
const SETUP_MANAGE = TRANSPORT_ACTIONS['transport-vehicle-handler.create'];
const ATT_MARK = TRANSPORT_ACTIONS['transport-attendance-handler.saveMarks'];
const ATT_FINALIZE = TRANSPORT_ACTIONS['transport-attendance-handler.finalize'];

describe('transport authorization (guard end-to-end)', () => {
  it('plain teacher: no transport access', () => {
    expect(result('teacher', SETUP_VIEW)).toBe(403);
    expect(result('teacher', ATT_MARK)).toBe(403);
  });
  it('bus-attendance teacher: marks only, no setup, no finalize', () => {
    expect(result('transport-attendance', ATT_MARK)).toBe('allowed');
    expect(result('transport-attendance', SETUP_MANAGE)).toBe(403);
    expect(result('transport-attendance', ATT_FINALIZE)).toBe(403);
  });
  it('admin: setup + finalize', () => {
    expect(result('admin', SETUP_MANAGE)).toBe('allowed');
    expect(result('admin', ATT_FINALIZE)).toBe('allowed');
  });
  it('transport-incharge (wildcard) + god: everything', () => {
    expect(result('transport-incharge', ATT_FINALIZE)).toBe('allowed');
    expect(result('god', ATT_FINALIZE)).toBe('allowed');
  });
});
