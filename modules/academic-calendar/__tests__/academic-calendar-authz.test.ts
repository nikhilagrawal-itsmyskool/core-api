import { requireAction } from '../../auth/authz';
import { ACADEMIC_CALENDAR_ACTIONS } from '../academic-calendar-actions';

// End-to-end guard check: teacher reads, admin manages, settings are god-only.
const prevOffline = process.env.IS_OFFLINE;
beforeAll(() => { process.env.IS_OFFLINE = 'true'; });
afterAll(() => { process.env.IS_OFFLINE = prevOffline; });

function result(roles: string, action: string): number | 'allowed' {
  let status: number | 'allowed' = 'allowed';
  const cb = (_e: any, res: any) => { if (res && res.statusCode) status = res.statusCode; };
  const ev: any = { headers: { 'X-School-Code': 'DBPASN' }, requestContext: { authorizer: { principalId: 'u1', context: { type: 'employee', roles } } } };
  return requireAction(ev, action, cb as any) ? 'allowed' : status;
}

const VIEW = ACADEMIC_CALENDAR_ACTIONS['academic-calendar-handler.getCalendar'];
const MANAGE = ACADEMIC_CALENDAR_ACTIONS['academic-calendar-handler.addEntry'];
const CONFIG = ACADEMIC_CALENDAR_ACTIONS['academic-calendar-handler.setSettings'];

describe('academic-calendar authorization (guard end-to-end)', () => {
  it('teacher: reads the calendar but cannot manage or edit settings', () => {
    expect(result('teacher', VIEW)).toBe('allowed');
    expect(result('teacher', MANAGE)).toBe(403);
    expect(result('teacher', CONFIG)).toBe(403);
  });
  it('admin: reads + manages, but settings stay god-only', () => {
    expect(result('admin', VIEW)).toBe('allowed');
    expect(result('admin', MANAGE)).toBe('allowed');
    expect(result('admin', CONFIG)).toBe(403);
  });
  it('god: everything incl. settings', () => {
    expect(result('god', CONFIG)).toBe('allowed');
  });
});
