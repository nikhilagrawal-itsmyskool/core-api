import { can, ROLE_PERMISSIONS, ACTIONS } from '../authz-policy';

// Pure unit tests for the ported permission predicate.

describe('can()', () => {
  it('allows an exact action granted to a role', () => {
    expect(can(['admin'], 'student.manage')).toBe(true);
    expect(can(['class-teacher'], 'attendance.mark')).toBe(true);
  });

  it('resolves module.* wildcards (modules that still use them)', () => {
    expect(can(['admin'], 'medical.view')).toBe(true);
    expect(can(['admin'], 'medical.anything.new')).toBe(true);
  });

  it('fees uses explicit module.resource.action — NO fee.* wildcard', () => {
    expect(can(['fees-incharge'], 'fee.collect.collect')).toBe(true);
    expect(can(['fees-incharge'], 'fee.report.view')).toBe(true);
    expect(can(['fees-incharge'], 'fee.anything.new')).toBe(false); // no wildcard
    // god-only money-rule actions: admin/incharge do NOT get them
    expect(can(['admin'], 'fee.concession.manage')).toBe(false);
    expect(can(['admin'], 'fee.waiver.manage')).toBe(false);
    expect(can(['admin'], 'fee.latefee.manage')).toBe(false);
    expect(can(['admin'], 'fee.transport.manage')).toBe(false);
    expect(can(['god'], 'fee.concession.manage')).toBe(true);
    // but admins CAN still add students to a concession
    expect(can(['admin'], 'fee.concession.assign')).toBe(true);
    // late-fine exempt: manager + god only
    expect(can(['manager'], 'fee.fine.exempt')).toBe(true);
    expect(can(['admin'], 'fee.fine.exempt')).toBe(false);
  });

  it('god (*) grants everything', () => {
    expect(can(['god'], 'anything.at.all')).toBe(true);
    expect(can(['god'], 'employee.restore')).toBe(true);
  });

  it('denies actions not granted to the role', () => {
    expect(can(['teacher'], 'fee.collect.collect')).toBe(false);
    expect(can(['teacher'], 'student.manage')).toBe(false);
    expect(can(['fees-incharge'], 'student.manage')).toBe(false);
  });

  it('keeps fee.receipt.verify to admin/god only (not fee incharges)', () => {
    expect(can(['fees-incharge'], 'fee.receipt.verify')).toBe(false);
    expect(can(['admin'], 'fee.receipt.verify')).toBe(true);
    expect(can(['god'], 'fee.receipt.verify')).toBe(true);
  });

  it('is additive across multiple roles', () => {
    expect(can(['teacher', 'class-teacher'], 'attendance.mark')).toBe(true);
    expect(can(['teacher', 'class-teacher'], 'homework.post')).toBe(true);
    // teacher gives the reads, class-teacher the two writes; neither gives fee.collect
    expect(can(['teacher', 'class-teacher'], 'fee.collect.collect')).toBe(false);
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
    expect(ACTIONS.FEE_COLLECT).toBe('fee.collect.collect');
    expect(ACTIONS.FEE_RECEIPT_VERIFY).toBe('fee.receipt.verify');
    expect(Object.keys(ROLE_PERMISSIONS)).toContain('transport-attendance');
  });
});
