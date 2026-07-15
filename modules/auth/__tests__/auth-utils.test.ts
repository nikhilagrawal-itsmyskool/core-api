import { assertStudentInToken, getActiveStudentIdFromHeader } from '../auth-utils';

// Pure unit tests — no running server required.

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
