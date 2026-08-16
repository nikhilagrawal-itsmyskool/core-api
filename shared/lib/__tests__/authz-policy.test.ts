import { can, ROLE_PERMISSIONS, ACTIONS } from '../authz-policy';

// Pure unit tests for the ported permission predicate.

describe('can()', () => {
  it('allows an exact action granted to a role', () => {
    expect(can(['admin'], 'student.manage')).toBe(true);
    expect(can(['class-teacher'], 'attendance.mark')).toBe(true);
  });

  it('resolves module.* wildcards', () => {
    expect(can(['fees-incharge'], 'fee.collect')).toBe(true);
    expect(can(['fees-incharge'], 'fee.manage')).toBe(true);
    expect(can(['fees-incharge'], 'fee.anything.new')).toBe(true);
  });

  it('god (*) grants everything', () => {
    expect(can(['god'], 'anything.at.all')).toBe(true);
    expect(can(['god'], 'employee.restore')).toBe(true);
  });

  it('denies actions not granted to the role', () => {
    expect(can(['teacher'], 'fee.collect')).toBe(false);
    expect(can(['teacher'], 'student.manage')).toBe(false);
    expect(can(['fees-incharge'], 'student.manage')).toBe(false);
  });

  it('keeps receipt.verify OUT of fee.* (admin/god only, not fee incharges)', () => {
    expect(can(['fees-incharge'], 'receipt.verify')).toBe(false);
    expect(can(['admin'], 'receipt.verify')).toBe(true);
    expect(can(['god'], 'receipt.verify')).toBe(true);
  });

  it('is additive across multiple roles', () => {
    expect(can(['teacher', 'class-teacher'], 'attendance.mark')).toBe(true);
    expect(can(['teacher', 'class-teacher'], 'homework.post')).toBe(true);
    // teacher gives the reads, class-teacher the two writes; neither gives fee.collect
    expect(can(['teacher', 'class-teacher'], 'fee.collect')).toBe(false);
  });

  it('denies for empty/undefined/unknown roles (e.g. a student token)', () => {
    expect(can([], 'student.view')).toBe(false);
    expect(can(undefined, 'student.view')).toBe(false);
    expect(can(['no-such-role'], 'student.view')).toBe(false);
  });

  it('gates god-only leaves away from admin', () => {
    expect(can(['admin'], 'timetable.manage')).toBe(false);
    expect(can(['admin'], 'employee.restore')).toBe(false);
    expect(can(['admin'], 'assistant.use')).toBe(false);
    expect(can(['god'], 'timetable.manage')).toBe(true);
  });

  it('exposes ACTIONS constants that match their string values', () => {
    expect(ACTIONS.FEE_COLLECT).toBe('fee.collect');
    expect(ACTIONS.RECEIPT_VERIFY).toBe('receipt.verify');
    expect(Object.keys(ROLE_PERMISSIONS)).toContain('transport-attendance');
  });
});
