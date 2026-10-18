import { requireAction } from '../../auth/authz';
import { FEEDBACK_ACTIONS } from '../feedback-actions';

// End-to-end guard check: teachers record/respond, the director (god for now) reviews.
const prevOffline = process.env.IS_OFFLINE;
beforeAll(() => { process.env.IS_OFFLINE = 'true'; });
afterAll(() => { process.env.IS_OFFLINE = prevOffline; });

function result(roles: string, action: string): number | 'allowed' {
  let status: number | 'allowed' = 'allowed';
  const cb = (_e: any, res: any) => { if (res && res.statusCode) status = res.statusCode; };
  const ev: any = { headers: { 'X-School-Code': 'DBPASN' }, requestContext: { authorizer: { principalId: 'u1', context: { type: 'employee', roles } } } };
  return requireAction(ev, action, cb as any) ? 'allowed' : status;
}

const RECORD = FEEDBACK_ACTIONS['feedback-handler.record'];
const RESPOND = FEEDBACK_ACTIONS['feedback-me-handler.list'];
const REVIEW = FEEDBACK_ACTIONS['feedback-handler.list'];

describe('feedback authorization (guard end-to-end)', () => {
  it('teacher: records + responds on /me, but cannot review the director dashboard', () => {
    expect(result('teacher', RECORD)).toBe('allowed');
    expect(result('teacher', RESPOND)).toBe('allowed');
    expect(result('teacher', REVIEW)).toBe(403);
  });
  it('education-director: reviews; god-first review stays off plain teachers', () => {
    expect(result('education-director', REVIEW)).toBe('allowed');
  });
  it('god: everything', () => {
    expect(result('god', REVIEW)).toBe('allowed');
  });
});
