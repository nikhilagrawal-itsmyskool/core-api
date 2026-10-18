import { requireAction } from '../../auth/authz';
import { ASSEMBLY_ACTIONS } from '../assembly-actions';

// End-to-end guard check: teacher reads plan + conducts own week; admin/incharge author;
// config (house/grading setup) stays god-only.
const prevOffline = process.env.IS_OFFLINE;
beforeAll(() => { process.env.IS_OFFLINE = 'true'; });
afterAll(() => { process.env.IS_OFFLINE = prevOffline; });

function result(roles: string, action: string): number | 'allowed' {
  let status: number | 'allowed' = 'allowed';
  const cb = (_e: any, res: any) => { if (res && res.statusCode) status = res.statusCode; };
  const ev: any = { headers: { 'X-School-Code': 'DBPASN' }, requestContext: { authorizer: { principalId: 'u1', context: { type: 'employee', roles } } } };
  return requireAction(ev, action, cb as any) ? 'allowed' : status;
}

const PLAN_VIEW = ASSEMBLY_ACTIONS['assembly-plan-handler.list'];
const PLAN_MANAGE = ASSEMBLY_ACTIONS['assembly-plan-handler.create'];
const WEEK_MANAGE = ASSEMBLY_ACTIONS['assembly-week-handler.approve'];
const CONDUCT = ASSEMBLY_ACTIONS['assembly-duties-handler.saveGrade'];
const GRADING_MANAGE = ASSEMBLY_ACTIONS['assembly-grading-handler.saveGrade'];
const HOUSE_SET_CONFIG = ASSEMBLY_ACTIONS['assembly-house-handler.setConfig'];
const GRADING_SET_CONFIG = ASSEMBLY_ACTIONS['assembly-grading-handler.setConfig'];

describe('assembly authorization (guard end-to-end)', () => {
  it('teacher: reads the plan + conducts own week, but cannot author / manage roster / config', () => {
    expect(result('teacher', PLAN_VIEW)).toBe('allowed');
    expect(result('teacher', CONDUCT)).toBe('allowed');
    expect(result('teacher', PLAN_MANAGE)).toBe(403);
    expect(result('teacher', WEEK_MANAGE)).toBe(403);
    expect(result('teacher', GRADING_MANAGE)).toBe(403);
    expect(result('teacher', HOUSE_SET_CONFIG)).toBe(403);
  });
  it('admin + assembly-incharge: author + manage roster + grading, but config stays god-only', () => {
    for (const role of ['admin', 'assembly-incharge']) {
      expect(result(role, PLAN_MANAGE)).toBe('allowed');
      expect(result(role, WEEK_MANAGE)).toBe('allowed');
      expect(result(role, GRADING_MANAGE)).toBe('allowed');
      expect(result(role, HOUSE_SET_CONFIG)).toBe(403);
      expect(result(role, GRADING_SET_CONFIG)).toBe(403);
    }
  });
  it('god: everything incl. config', () => {
    expect(result('god', HOUSE_SET_CONFIG)).toBe('allowed');
    expect(result('god', GRADING_SET_CONFIG)).toBe('allowed');
  });
});
