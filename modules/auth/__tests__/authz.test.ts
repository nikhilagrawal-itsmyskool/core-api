const jwt = require('jsonwebtoken');
import { getCaller, requireAction } from '../authz';

// Pure unit tests — no running server. tests/setup.ts sets JWT_SECRET/JWT_MAGIC_KEY
// and does NOT set IS_OFFLINE, so by default these run with prod-style enforcement.
const SECRET = process.env.JWT_SECRET as string;
const MAGIC = process.env.JWT_MAGIC_KEY as string;

function empToken(roles: string[], schoolCode = 'DBPASN'): string {
  return jwt.sign(
    { auth: MAGIC, type: 'employee', id: 'u1', employee_id: 'e1', login_name: 'n1', school_id: 's1', school_code: schoolCode, roles },
    SECRET
  );
}
function studentToken(): string {
  return jwt.sign(
    { auth: MAGIC, type: 'student', id: 'f1', login_name: 'p1', school_id: 's1', school_code: 'DBPASN', students: [{ id: 'a1', name: 'Aya' }] },
    SECRET
  );
}
function event(authorization?: string, schoolCode = 'DBPASN', authorizerCtx?: any): any {
  const headers: any = {};
  if (authorization) headers['Authorization'] = authorization;
  if (schoolCode) headers['X-School-Code'] = schoolCode;
  return { headers, requestContext: { authorizer: authorizerCtx } };
}
// Capture what ResponseBuilder passes to the callback.
function capture() {
  let resp: any;
  const cb = (_err: any, r: any) => { resp = r; };
  return { cb, status: () => resp && resp.statusCode, code: () => resp && JSON.parse(resp.body).error.code };
}

afterEach(() => { delete process.env.IS_OFFLINE; });

describe('getCaller', () => {
  it('maps a verified employee token to a Caller', () => {
    const c = getCaller(event(`Bearer ${empToken(['admin'])}`));
    expect(c).toMatchObject({ type: 'employee', employeeId: 'e1', schoolCode: 'DBPASN', roles: ['admin'] });
  });

  it('returns null for a missing/invalid token in a deployed stage (IS_OFFLINE unset)', () => {
    expect(getCaller(event(undefined))).toBeNull();
    expect(getCaller(event('Bearer garbage'))).toBeNull();
  });
});

describe('requireAction', () => {
  it('returns the caller when the role grants the action', () => {
    const cap = capture();
    const caller = requireAction(event(`Bearer ${empToken(['fees-incharge'])}`), 'fee.collect', cap.cb);
    expect(caller).not.toBeNull();
    expect(cap.status()).toBeUndefined(); // no error response written
  });

  it('403 MISSING_PERMISSION when the role lacks the action', () => {
    const cap = capture();
    const caller = requireAction(event(`Bearer ${empToken(['teacher'])}`), 'fee.collect', cap.cb);
    expect(caller).toBeNull();
    expect(cap.status()).toBe(403);
    expect(cap.code()).toBe('MISSING_PERMISSION');
  });

  it('401 when there is no valid token (deployed stage)', () => {
    const cap = capture();
    const caller = requireAction(event(undefined), 'fee.view', cap.cb);
    expect(caller).toBeNull();
    expect(cap.status()).toBe(401);
  });

  it('403 for a student token on an employee action (no roles)', () => {
    const cap = capture();
    const caller = requireAction(event(`Bearer ${studentToken()}`), 'fee.view', cap.cb);
    expect(caller).toBeNull();
    expect(cap.status()).toBe(403);
  });

  it('403 on cross-tenant school mismatch (header != token school_code)', () => {
    const cap = capture();
    // token is for DBPASN, header claims OTHER
    const caller = requireAction(event(`Bearer ${empToken(['admin'], 'DBPASN')}`, 'OTHER'), 'student.manage', cap.cb);
    expect(caller).toBeNull();
    expect(cap.status()).toBe(403);
    expect(cap.code()).toBe('MISSING_PERMISSION');
  });

  it('allows when header matches the token school_code', () => {
    const cap = capture();
    const caller = requireAction(event(`Bearer ${empToken(['admin'], 'DBPASN')}`, 'DBPASN'), 'student.manage', cap.cb);
    expect(caller).not.toBeNull();
  });

  describe('offline fallback (IS_OFFLINE=true)', () => {
    beforeEach(() => { process.env.IS_OFFLINE = 'true'; });

    it('defaults to a god caller when no token and no override roles (existing tests keep passing)', () => {
      const cap = capture();
      const caller = requireAction(event(undefined), 'fee.collect', cap.cb);
      expect(caller).not.toBeNull();
      expect(caller!.roles).toEqual(['god']);
    });

    it('honors roles from the offline authorizer override (negative-path tests)', () => {
      const cap = capture();
      const caller = requireAction(event(undefined, 'DBPASN', { principalId: '123', type: 'employee', roles: 'teacher' }), 'fee.collect', cap.cb);
      expect(caller).toBeNull();
      expect(cap.status()).toBe(403);
    });
  });
});
