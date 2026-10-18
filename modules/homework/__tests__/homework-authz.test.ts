import { requireAction } from '../../auth/authz';
import { HOMEWORK_ACTIONS } from '../homework-actions';

// End-to-end guard check for the homework module. class-teacher posts; admin oversees.
// (The student/parent app endpoint me/today is PUBLIC and not covered here.)
const prevOffline = process.env.IS_OFFLINE;
beforeAll(() => { process.env.IS_OFFLINE = 'true'; });
afterAll(() => { process.env.IS_OFFLINE = prevOffline; });

function result(roles: string, action: string): number | 'allowed' {
  let status: number | 'allowed' = 'allowed';
  const cb = (_e: any, res: any) => { if (res && res.statusCode) status = res.statusCode; };
  const ev: any = { headers: { 'X-School-Code': 'DBPASN' }, requestContext: { authorizer: { principalId: 'u1', context: { type: 'employee', roles } } } };
  return requireAction(ev, action, cb as any) ? 'allowed' : status;
}

describe('homework authorization (guard end-to-end)', () => {
  it('class-teacher: posts own-class homework (/me), but not admin oversight/mapping -> 403', () => {
    expect(result('class-teacher', HOMEWORK_ACTIONS['homework-me-handler.addItem'])).toBe('allowed');
    expect(result('class-teacher', HOMEWORK_ACTIONS['homework-handler.setClassTeacher'])).toBe(403);
    expect(result('class-teacher', HOMEWORK_ACTIONS['homework-handler.getDay'])).toBe(403);
  });
  it('plain teacher: no homework access -> 403', () => {
    expect(result('teacher', HOMEWORK_ACTIONS['homework-me-handler.addItem'])).toBe(403);
  });
  it('admin: oversight + mapping + posting', () => {
    expect(result('admin', HOMEWORK_ACTIONS['homework-handler.setClassTeacher'])).toBe('allowed');
    expect(result('admin', HOMEWORK_ACTIONS['homework-handler.getAudit'])).toBe('allowed');
    expect(result('admin', HOMEWORK_ACTIONS['homework-me-handler.addItem'])).toBe('allowed');
  });
});
