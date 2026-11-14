import {
  toMinutes, monthDayInSeason, resolvePolicyForDate, deriveDay, Policy, SeasonRow, ConfigRow,
} from '../staff-attendance-derive';

const POLICY: Policy = { expectedIn: '09:00', expectedOut: '15:00', graceMin: 10, halfDayAfterMin: 240, missingPunchAfterMin: 900 /* 15:00 */, dedupGapMin: 5, seasonName: null };

describe('toMinutes', () => {
  it('parses HH:MM and HH:MM:SS', () => {
    expect(toMinutes('09:00')).toBe(540);
    expect(toMinutes('09:10:59')).toBe(550);
    expect(toMinutes('bad')).toBeNaN();
  });
});

describe('monthDayInSeason', () => {
  const summer: SeasonRow = { name: 'Summer', startMonth: 4, startDay: 1, endMonth: 6, endDay: 30, expectedIn: '07:30', expectedOut: '13:30', graceMin: 10, halfDayAfterMin: 200, sortOrder: 1 };
  const winter: SeasonRow = { name: 'Winter', startMonth: 11, startDay: 1, endMonth: 2, endDay: 28, expectedIn: '09:00', expectedOut: '15:00', graceMin: 10, halfDayAfterMin: 240, sortOrder: 2 };
  it('matches a normal window', () => {
    expect(monthDayInSeason(5, 15, summer)).toBe(true);
    expect(monthDayInSeason(7, 1, summer)).toBe(false);
  });
  it('matches a year-wrapping window', () => {
    expect(monthDayInSeason(12, 20, winter)).toBe(true);
    expect(monthDayInSeason(1, 10, winter)).toBe(true);
    expect(monthDayInSeason(6, 1, winter)).toBe(false);
  });
});

describe('resolvePolicyForDate', () => {
  const config: ConfigRow = { expectedIn: '09:30', expectedOut: '15:30', graceMin: 5, halfDayAfterMin: null };
  const seasons: SeasonRow[] = [
    { name: 'Summer', startMonth: 4, startDay: 1, endMonth: 6, endDay: 30, expectedIn: '07:30', expectedOut: '13:30', graceMin: 10, halfDayAfterMin: 200, sortOrder: 1 },
    { name: 'Winter', startMonth: 11, startDay: 1, endMonth: 2, endDay: 28, expectedIn: '09:00', expectedOut: '15:00', graceMin: 10, halfDayAfterMin: 240, sortOrder: 2 },
  ];
  it('uses the summer season in May', () => {
    expect(resolvePolicyForDate('2026-05-15', config, seasons).expectedIn).toBe('07:30');
  });
  it('uses the winter season across the year wrap (Dec, Jan)', () => {
    expect(resolvePolicyForDate('2026-12-20', config, seasons).seasonName).toBe('Winter');
    expect(resolvePolicyForDate('2026-01-10', config, seasons).seasonName).toBe('Winter');
  });
  it('falls back to config defaults outside any season', () => {
    const p = resolvePolicyForDate('2026-09-10', config, seasons);
    expect(p.seasonName).toBeNull();
    expect(p.expectedIn).toBe('09:30');
  });
});

describe('deriveDay', () => {
  it('present when on time with in+out', () => {
    const r = deriveDay('2026-10-26', 'working', POLICY, ['09:05:00', '15:10:00'], null);
    expect(r.status).toBe('present');
    expect(r.firstIn).toBe('09:05');
    expect(r.lastOut).toBe('15:10');
    expect(r.lateByMin).toBe(0);
  });
  it('late when first-in is past grace', () => {
    const r = deriveDay('2026-10-26', 'working', POLICY, ['09:25:00', '15:00:00'], null);
    expect(r.status).toBe('late');
    expect(r.lateByMin).toBe(15); // 09:25 - (09:00 + 10m grace)
  });
  it('half_day when worked below threshold', () => {
    const r = deriveDay('2026-10-26', 'working', POLICY, ['09:05:00', '12:00:00'], null);
    expect(r.status).toBe('half_day');
  });
  it('missing_punch with a single punch (no live clock = past/finalized day)', () => {
    const r = deriveDay('2026-10-26', 'working', POLICY, ['09:05:00'], null);
    expect(r.status).toBe('missing_punch');
    expect(r.lastOut).toBeNull();
  });
  it('checked_in for a lone punch when today and before the cutoff', () => {
    const r = deriveDay('2026-10-26', 'working', POLICY, ['09:05:00'], null, null, 600 /* 10:00 < 15:00 */);
    expect(r.status).toBe('checked_in');
    expect(r.firstIn).toBe('09:05');
    expect(r.lastOut).toBeNull();
  });
  it('missing_punch for a lone punch once past the cutoff even today', () => {
    const r = deriveDay('2026-10-26', 'working', POLICY, ['09:05:00'], null, null, 960 /* 16:00 >= 15:00 */);
    expect(r.status).toBe('missing_punch');
  });
  it('collapses a double-scan at check-in into one checked_in (not present)', () => {
    const r = deriveDay('2026-10-26', 'working', POLICY, ['07:52:03', '07:52:40'], null, null, 600);
    expect(r.status).toBe('checked_in'); // two scans within the 5-min gap = one check-in
    expect(r.lastOut).toBeNull();
  });
  it('a real in+out beyond the dedup gap still derives present', () => {
    const r = deriveDay('2026-10-26', 'working', POLICY, ['09:05:00', '15:10:00'], null, null, 960);
    expect(r.status).toBe('present');
  });
  it('absent with no punches', () => {
    expect(deriveDay('2026-10-26', 'working', POLICY, [], null).status).toBe('absent');
  });
  it('weekly_off / holiday / on_leave by day type', () => {
    expect(deriveDay('2026-10-25', 'weekly_off', POLICY, [], null).status).toBe('weekly_off');
    expect(deriveDay('2026-10-02', 'holiday', POLICY, [], null).status).toBe('holiday');
    expect(deriveDay('2026-10-26', 'leave', POLICY, [], null, 'CL').status).toBe('on_leave');
  });
  it('regularized overrides punches when approved', () => {
    const r = deriveDay('2026-10-26', 'working', POLICY, [], { claimedIn: '09:00', claimedOut: '15:00' });
    expect(r.status).toBe('regularized');
    expect(r.firstIn).toBe('09:00');
    expect(r.lateByMin).toBe(0);
  });
});
