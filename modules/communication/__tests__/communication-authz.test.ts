import { requireAction } from '../../auth/authz';
import { COMMUNICATION_ACTIONS } from '../communication-actions';

// End-to-end guard check: admin sends + manages templates; delete/restore is god-only;
// service tokens bypass (the cross-module notification POST).
const prevOffline = process.env.IS_OFFLINE;
beforeAll(() => { process.env.IS_OFFLINE = 'true'; });
afterAll(() => { process.env.IS_OFFLINE = prevOffline; });

function result(ctxExtra: any, action: string): number | 'allowed' {
  let status: number | 'allowed' = 'allowed';
  const cb = (_e: any, res: any) => { if (res && res.statusCode) status = res.statusCode; };
  const ev: any = { headers: { 'X-School-Code': 'DBPASN' }, requestContext: { authorizer: { principalId: 'u1', context: { type: 'employee', ...ctxExtra } } } };
  return requireAction(ev, action, cb as any) ? 'allowed' : status;
}
const asRole = (roles: string, action: string) => result({ roles }, action);

const SEND = COMMUNICATION_ACTIONS['message-handler.send'];
const TPL_MANAGE = COMMUNICATION_ACTIONS['template-handler.create'];
const TPL_DELETE = COMMUNICATION_ACTIONS['template-handler.remove'];
const NOTIFY = COMMUNICATION_ACTIONS['notification-handler.create'];

describe('communication authorization (guard end-to-end)', () => {
  it('teacher: no send / templates', () => {
    expect(asRole('teacher', SEND)).toBe(403);
    expect(asRole('teacher', TPL_MANAGE)).toBe(403);
  });
  it('admin: send + manage templates, but delete/restore stays god-only', () => {
    expect(asRole('admin', SEND)).toBe('allowed');
    expect(asRole('admin', TPL_MANAGE)).toBe('allowed');
    expect(asRole('admin', TPL_DELETE)).toBe(403);
  });
  it('god: everything incl. delete', () => {
    expect(asRole('god', TPL_DELETE)).toBe('allowed');
  });
  it('service token: bypasses (cross-module notification POST)', () => {
    // type==='service' bypasses requireAction even though these roles lack send.
    expect(result({ type: 'service', roles: 'teacher' }, NOTIFY)).toBe('allowed');
  });
});
