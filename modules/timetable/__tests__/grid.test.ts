import { BASE_URL, headers, TEST_ACADEMIC_YEAR_ID, closePool } from './helpers';

afterAll(async () => { await closePool(); });

describe('Timetable API — grid (config / days / slots)', () => {
  let configId: string;

  it('creates a config', async () => {
    const res = await fetch(`${BASE_URL}/configs`, {
      method: 'POST', headers,
      body: JSON.stringify({ academicYearId: TEST_ACADEMIC_YEAR_ID, name: 'Default Grid' }),
    });
    expect(res.status).toBe(200);
    const config = await res.json();
    expect(config.status).toBe('active');
    configId = config.uuid;
  });

  it('adds a Saturday with teaching + activity slots and nests them under the config', async () => {
    // Saturday = day 6
    let res = await fetch(`${BASE_URL}/configs/${configId}/days`, {
      method: 'POST', headers, body: JSON.stringify({ dayOfWeek: 6, label: 'Saturday' }),
    });
    expect(res.status).toBe(200);
    const day = await res.json();

    res = await fetch(`${BASE_URL}/days/${day.uuid}/slots`, {
      method: 'POST', headers, body: JSON.stringify({ sequence: 1, slotType: 'teaching', label: 'P1' }),
    });
    expect(res.status).toBe(200);

    // last two periods are the teacher-less Saturday activity
    res = await fetch(`${BASE_URL}/days/${day.uuid}/slots`, {
      method: 'POST', headers, body: JSON.stringify({ sequence: 2, slotType: 'activity', label: 'Saturday Activity' }),
    });
    expect(res.status).toBe(200);
    const activitySlot = await res.json();
    expect(activitySlot.slotType).toBe('activity');

    // nested fetch
    res = await fetch(`${BASE_URL}/configs/${configId}`, { headers });
    const full = await res.json();
    const sat = full.days.find((d: any) => d.dayOfWeek === 6);
    expect(sat).toBeDefined();
    expect(sat.slots.length).toBe(2);
    expect(sat.slots.map((s: any) => s.slotType)).toEqual(expect.arrayContaining(['teaching', 'activity']));
  });

  it('rejects an invalid slot type and duplicate sequence', async () => {
    let res = await fetch(`${BASE_URL}/configs/${configId}/days`, {
      method: 'POST', headers, body: JSON.stringify({ dayOfWeek: 1, label: 'Monday' }),
    });
    const day = await res.json();
    res = await fetch(`${BASE_URL}/days/${day.uuid}/slots`, {
      method: 'POST', headers, body: JSON.stringify({ sequence: 1, slotType: 'nonsense' }),
    });
    expect(res.status).toBe(400);
    res = await fetch(`${BASE_URL}/days/${day.uuid}/slots`, {
      method: 'POST', headers, body: JSON.stringify({ sequence: 1, slotType: 'teaching' }),
    });
    expect(res.status).toBe(200);
    res = await fetch(`${BASE_URL}/days/${day.uuid}/slots`, {
      method: 'POST', headers, body: JSON.stringify({ sequence: 1, slotType: 'break' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate day for a config', async () => {
    const res = await fetch(`${BASE_URL}/configs/${configId}/days`, {
      method: 'POST', headers, body: JSON.stringify({ dayOfWeek: 6 }),
    });
    expect(res.status).toBe(400);
  });

  it('archives the config on delete', async () => {
    let res = await fetch(`${BASE_URL}/configs/${configId}`, { method: 'DELETE', headers });
    expect(res.status).toBe(200);
    res = await fetch(`${BASE_URL}/configs/${configId}`, { headers });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('archived');
  });
});
