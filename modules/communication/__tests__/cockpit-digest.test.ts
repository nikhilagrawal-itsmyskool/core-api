import { buildDigestContext } from '../cockpit-digest-service';

// Fixed "today": Fri 16 Oct 2026. due time 07:30 IST (dueMin 450). The digest runs at
// 1 PM IST, so the assembly card reports TODAY when today is an assembly day, and only
// falls back to the most recent prior day on a non-assembly day (weekend/holiday).
const TODAY = '2026-10-16';

// Today (16 Oct) signed 07:20 IST (UTC 01:50) on time / 07:45 IST (UTC 02:15) 15 min late.
const signedTodayOnTime = '2026-10-16T01:50:00Z';
const signedTodayLate = '2026-10-16T02:15:00Z';
// Thu 15 Oct signed 07:20 IST — used for the off-day fallback case.
const signedPrevOnTime = '2026-10-15T01:50:00Z';

describe('cockpit digest — buildDigestContext', () => {
  it('composes a full happy-path briefing (today signed, on time)', () => {
    const ctx = buildDigestContext(
      {
        pulse: {
          dueTime: '07:30',
          checklist: [{ date: '2026-10-16', house: 'Red', signedAt: signedTodayOnTime }],
          grading: [{ date: '2026-10-16', expected: 5, submitted: 5, missing: [] }],
        },
        leave: {
          pending: 3,
          days: [{ date: TODAY, count: 2, names: [{ name: 'Asha Kumari' }, { name: 'Ravi Singh' }] }],
        },
        flow: { open: 5, oldestOpenDays: 9 },
        overview: {
          currentMonthIndex: 1,
          rows: [
            { grade: 'III', subjectName: 'EVS', monthlyScheduled: [2, 3, 1], sections: [{ coveredCount: 3 }] },
            { grade: 'V', subjectName: 'Maths', monthlyScheduled: [1, 1, 1], sections: [{ coveredCount: 5 }] },
          ],
        },
      },
      TODAY,
    );
    expect(ctx.date).toBe('16 Oct 2026');
    // Today is an assembly day and already signed → reported directly, no "last held".
    expect(ctx.assembly).toBe('signed 07:20, on time, 5/5 graded');
    expect(ctx.leaveOut).toBe('2 (Asha, Ravi)');
    expect(ctx.leavePending).toBe('3');
    expect(ctx.feedback).toBe('5 open, oldest 9d');
    expect(ctx.syllabus).toBe('1 behind — III–EVS');
  });

  it('flags a late sign-off with minutes late', () => {
    const ctx = buildDigestContext(
      {
        pulse: {
          dueTime: '07:30',
          checklist: [{ date: '2026-10-16', signedAt: signedTodayLate }],
          grading: [{ date: '2026-10-16', expected: 4, submitted: 4, missing: [] }],
        },
        leave: null,
        flow: null,
        overview: null,
      },
      TODAY,
    );
    expect(ctx.assembly).toBe('signed 07:45, 15m late, 4/4 graded');
  });

  it("flags today's assembly not signed yet by send time", () => {
    const ctx = buildDigestContext(
      {
        pulse: {
          dueTime: '07:30',
          checklist: [{ date: '2026-10-16', signedAt: null }],
          grading: [{ date: '2026-10-16', expected: 5, submitted: 2, missing: [] }],
        },
        leave: null,
        flow: null,
        overview: null,
      },
      TODAY,
    );
    expect(ctx.assembly).toBe('not signed yet, 2/5 graded');
  });

  it('falls back to the last held assembly on a non-assembly day', () => {
    const ctx = buildDigestContext(
      {
        pulse: {
          dueTime: '07:30',
          // No row for today (16th) → today is not an assembly day; fall back to Thu 15.
          checklist: [{ date: '2026-10-15', signedAt: signedPrevOnTime }],
          grading: [{ date: '2026-10-15', expected: 9, submitted: 5, missing: [] }],
        },
        leave: null,
        flow: null,
        overview: null,
      },
      TODAY,
    );
    expect(ctx.assembly).toBe('last held Thu 15 — signed 07:20, on time, 5/9 graded');
  });

  it('shows the all-clear states', () => {
    const ctx = buildDigestContext(
      {
        pulse: { dueTime: '07:30', checklist: [], grading: [] },
        leave: { pending: 0, days: [{ date: TODAY, count: 0, names: [] }] },
        flow: { open: 0, oldestOpenDays: 0 },
        overview: {
          currentMonthIndex: 1,
          rows: [{ grade: 'V', subjectName: 'Maths', monthlyScheduled: [1, 1], sections: [{ coveredCount: 5 }] }],
        },
      },
      TODAY,
    );
    expect(ctx.leaveOut).toBe('none');
    expect(ctx.leavePending).toBe('0');
    expect(ctx.feedback).toBe('all clear');
    expect(ctx.syllabus).toBe('all on track');
  });

  it('degrades every variable to a non-empty placeholder when sources are missing', () => {
    const ctx = buildDigestContext({ pulse: null, leave: null, flow: null, overview: null }, TODAY);
    // Non-empty matters: resolveVariables() would skip the recipient on any blank.
    for (const [k, v] of Object.entries(ctx)) {
      expect(typeof v).toBe('string');
      expect(v.trim().length).toBeGreaterThan(0);
      if (k !== 'date') expect(v).toBe('—');
    }
    expect(ctx.date).toBe('16 Oct 2026');
  });
});
