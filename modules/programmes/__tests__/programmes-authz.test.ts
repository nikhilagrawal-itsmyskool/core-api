import { requireAction } from '../../auth/authz';
import { PROGRAMME_ACTIONS } from '../programmes-actions';

// End-to-end guard check: teacher reads + teaches, admin/incharge author, config god-first.
const prevOffline = process.env.IS_OFFLINE;
beforeAll(() => { process.env.IS_OFFLINE = 'true'; });
afterAll(() => { process.env.IS_OFFLINE = prevOffline; });

function result(roles: string, action: string): number | 'allowed' {
  let status: number | 'allowed' = 'allowed';
  const cb = (_e: any, res: any) => { if (res && res.statusCode) status = res.statusCode; };
  const ev: any = { headers: { 'X-School-Code': 'DBPASN' }, requestContext: { authorizer: { principalId: 'u1', context: { type: 'employee', roles } } } };
  return requireAction(ev, action, cb as any) ? 'allowed' : status;
}

const VIEW = PROGRAMME_ACTIONS['programmes-unit-handler.list'];
const MANAGE = PROGRAMME_ACTIONS['programmes-unit-handler.create'];
const TEACH = PROGRAMME_ACTIONS['programmes-unit-handler.teach'];
const SRC_UPLOAD = PROGRAMME_ACTIONS['programmes-source-handler.upload'];
// config.manage has no endpoint; assert the leaf directly.
const CONFIG = 'programme.config.manage';

describe('programmes authorization (guard end-to-end)', () => {
  it('teacher: reads + teaches, but cannot author or upload or configure', () => {
    expect(result('teacher', VIEW)).toBe('allowed');
    expect(result('teacher', TEACH)).toBe('allowed');
    expect(result('teacher', MANAGE)).toBe(403);
    expect(result('teacher', SRC_UPLOAD)).toBe(403);
    expect(result('teacher', CONFIG)).toBe(403);
  });
  it('admin + programme-incharge: read + teach, but authoring/config stay god-only', () => {
    expect(result('admin', VIEW)).toBe('allowed');
    expect(result('admin', TEACH)).toBe('allowed');
    expect(result('admin', MANAGE)).toBe(403);
    expect(result('admin', SRC_UPLOAD)).toBe(403);
    expect(result('admin', CONFIG)).toBe(403);
    expect(result('programme-incharge', VIEW)).toBe('allowed');
    expect(result('programme-incharge', MANAGE)).toBe(403);
    expect(result('programme-incharge', CONFIG)).toBe(403);
  });
  it('god: everything incl. authoring + settings', () => {
    expect(result('god', MANAGE)).toBe('allowed');
    expect(result('god', SRC_UPLOAD)).toBe('allowed');
    expect(result('god', CONFIG)).toBe('allowed');
  });
});
