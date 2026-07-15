const jwt = require('jsonwebtoken');
import { assertStudentInToken, getActiveStudentIdFromHeader, resolveActiveStudent } from '../auth-utils';

// Pure unit tests — no running server required.

// resolveActiveStudent verifies a real signed token, so give it a secret + magic key.
const SECRET = 'test-secret';
const MAGIC = 'test-magic';
beforeAll(() => {
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_MAGIC_KEY = MAGIC;
});

function studentToken(students: Array<{ id: string; name: string }>): string {
  return jwt.sign({ auth: MAGIC, type: 'student', school_id: 's1', students }, SECRET);
}

function eventWith(authorization: string | undefined, studentId?: string): any {
  const headers: any = {};
  if (authorization) headers['Authorization'] = authorization;
  if (studentId) headers['X-Student-Id'] = studentId;
  return { headers };
}

describe('assertStudentInToken', () => {
  const token = { students: [{ id: 'a1' }, { id: 'b2' }] };

  it('allows an id present in the token list', () => {
    expect(assertStudentInToken('a1', token)).toBe(true);
    expect(assertStudentInToken('b2', token)).toBe(true);
  });

  it('rejects an id not in the list', () => {
    expect(assertStudentInToken('zz', token)).toBe(false);
  });

  it('rejects when studentId or token is missing/malformed', () => {
    expect(assertStudentInToken(null, token)).toBe(false);
    expect(assertStudentInToken('a1', null)).toBe(false);
    expect(assertStudentInToken('a1', {} as any)).toBe(false);
  });
});

describe('getActiveStudentIdFromHeader', () => {
  it('reads X-Student-Id case-insensitively', () => {
    expect(getActiveStudentIdFromHeader({ headers: { 'X-Student-Id': 'x' } } as any)).toBe('x');
    expect(getActiveStudentIdFromHeader({ headers: { 'x-student-id': 'y' } } as any)).toBe('y');
  });

  it('returns null when the header is absent', () => {
    expect(getActiveStudentIdFromHeader({ headers: {} } as any)).toBeNull();
    expect(getActiveStudentIdFromHeader({} as any)).toBeNull();
  });
});

describe('resolveActiveStudent', () => {
  const token = studentToken([{ id: 'a1', name: 'Aya' }, { id: 'b2', name: 'Ben' }]);

  it('resolves the active child when token + X-Student-Id agree', () => {
    const result = resolveActiveStudent(eventWith(`Bearer ${token}`, 'b2'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auth.activeStudentId).toBe('b2');
      expect(result.auth.token.type).toBe('student');
    }
  });

  it('is unauthenticated with no/invalid token', () => {
    expect(resolveActiveStudent(eventWith(undefined, 'a1'))).toMatchObject({
      ok: false,
      failure: { reason: 'unauthenticated' },
    });
    expect(resolveActiveStudent(eventWith('Bearer garbage', 'a1'))).toMatchObject({
      ok: false,
      failure: { reason: 'unauthenticated' },
    });
  });

  it('rejects a non-student token as unauthenticated', () => {
    const empToken = jwt.sign({ auth: MAGIC, type: 'employee' }, SECRET);
    expect(resolveActiveStudent(eventWith(`Bearer ${empToken}`, 'a1'))).toMatchObject({
      ok: false,
      failure: { reason: 'unauthenticated' },
    });
  });

  it('flags a missing X-Student-Id header', () => {
    expect(resolveActiveStudent(eventWith(`Bearer ${token}`))).toMatchObject({
      ok: false,
      failure: { reason: 'missing-student' },
    });
  });

  it('forbids a child outside the family login', () => {
    expect(resolveActiveStudent(eventWith(`Bearer ${token}`, 'zz'))).toMatchObject({
      ok: false,
      failure: { reason: 'forbidden' },
    });
  });
});
