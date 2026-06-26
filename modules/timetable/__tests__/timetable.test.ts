import { BASE_URL, headers, closePool } from './helpers';

afterAll(async () => { await closePool(); });

describe('Timetable API — health & lookups', () => {
  it('GET /timetable/health returns ok', async () => {
    const res = await fetch(`${BASE_URL}/health`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('status', 'ok');
    expect(data).toHaveProperty('module', 'timetable');
  });

  it('GET /timetable/lookups returns enum lists', async () => {
    const res = await fetch(`${BASE_URL}/lookups`, { headers });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.subjectKinds.map((k: any) => k.value)).toEqual(
      expect.arrayContaining(['academic', 'games', 'library', 'activity']),
    );
    expect(data.slotTypes.map((s: any) => s.value)).toEqual(expect.arrayContaining(['teaching', 'activity']));
    expect(data.constraintTypes.length).toBeGreaterThan(0);
    expect(data.daysOfWeek.length).toBe(7);
  });
});
