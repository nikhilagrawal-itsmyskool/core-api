import { BASE_URL, headers, getSeed, rnd, closePool } from './helpers';

const post = (p: string, body: any) => fetch(`${BASE_URL}${p}`, { method: 'POST', headers, body: JSON.stringify(body) });
const put = (p: string, body: any) => fetch(`${BASE_URL}${p}`, { method: 'PUT', headers, body: JSON.stringify(body) });
const get = (p: string) => fetch(`${BASE_URL}${p}`, { headers });
const del = (p: string) => fetch(`${BASE_URL}${p}`, { method: 'DELETE', headers });

afterAll(async () => { await closePool(); });

describe('Transport module', () => {
  const tag = rnd();

  // ── Stops (grid bulk upsert) ──────────────────────────────────────────────
  describe('Stops bulk upsert', () => {
    const nameA = `Main Gate ${tag}`;
    const nameB = `Market ${tag}`;

    it('creates new stops and reports counts', async () => {
      const res = await post('/stops/bulk', {
        stops: [
          { name: nameA, km: 1.5 },
          { name: nameB, km: 3.2 },
          { name: '   ', km: 1 }, // blank -> skipped
          { name: nameA, km: 9 }, // duplicate in payload -> skipped
        ],
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.created).toBe(2);
      expect(data.updated).toBe(0);
      expect(data.skipped).toBe(2);
    });

    it('updates existing stop km on re-upsert (dedup by name)', async () => {
      const res = await post('/stops/bulk', { stops: [{ name: nameA, km: 2.0 }] });
      const data = await res.json();
      expect(data.created).toBe(0);
      expect(data.updated).toBe(1);
    });

    it('rejects a single-create duplicate stop name', async () => {
      const res = await post('/stops', { name: nameA, km: 5 });
      expect(res.status).toBe(400);
    });
  });

  // ── Vehicle + Route (prefill) + ordered stops ─────────────────────────────
  describe('Vehicle, route and ordered stops', () => {
    let vehicleId: string;
    let routeId: string;
    const stopIds: string[] = [];

    beforeAll(async () => {
      // three stops for the route
      for (const n of [`R1 A ${tag}`, `R1 B ${tag}`, `R1 C ${tag}`]) {
        const r = await post('/stops', { name: n, km: 1 });
        stopIds.push((await r.json()).uuid);
      }
    });

    it('creates a vehicle', async () => {
      const res = await post('/vehicles', {
        vehicleType: 'van', makeModel: 'Force Traveller', registrationNumber: `UP32-${tag}`,
        ownership: 'owned', driverName: 'Ravi', driverPhone: '9990001111',
        conductorName: 'Sunil', conductorPhone: '9990002222',
      });
      expect(res.status).toBe(200);
      vehicleId = (await res.json()).uuid;
    });

    it('rejects a duplicate registration number', async () => {
      const res = await post('/vehicles', {
        vehicleType: 'bus', registrationNumber: `UP32-${tag}`, ownership: 'contract',
      });
      expect(res.status).toBe(400);
    });

    it('creates a morning route and prefills driver/conductor from the vehicle', async () => {
      const res = await post('/routes', { name: `Route ${tag}`, direction: 'morning', vehicleId });
      expect(res.status).toBe(200);
      const data = await res.json();
      routeId = data.uuid;
      expect(data.driverName).toBe('Ravi');
      expect(data.driverPhone).toBe('9990001111');
      expect(data.conductorName).toBe('Sunil');
    });

    it('adds stops in order and rejects a duplicate stop on the route', async () => {
      const add = await post(`/routes/${routeId}/stops`, {
        stops: [{ stopId: stopIds[0] }, { stopId: stopIds[1] }, { stopId: stopIds[2] }],
      });
      expect(add.status).toBe(200);
      const { stops } = await add.json();
      expect(stops.map((s: any) => s.sequence)).toEqual([1, 2, 3]);

      const dup = await post(`/routes/${routeId}/stops`, { stops: [{ stopId: stopIds[0] }] });
      expect(dup.status).toBe(400);
    });

    it('reorders stops', async () => {
      const detail = await (await get(`/routes/${routeId}`)).json();
      const ids = detail.stops.map((s: any) => s.uuid);
      const res = await put(`/routes/${routeId}/stops/order`, { order: [ids[2], ids[0], ids[1]] });
      expect(res.status).toBe(200);
      const { stops } = await res.json();
      expect(stops[0].uuid).toBe(ids[2]);
      expect(stops.map((s: any) => s.sequence)).toEqual([1, 2, 3]);
    });

    it('assigns route staff from employee records', async () => {
      const { employeeId } = await getSeed();
      const res = await put(`/routes/${routeId}`, { routeInchargeId: employeeId });
      expect(res.status).toBe(200);
      const detail = await (await get(`/routes/${routeId}`)).json();
      expect(detail.routeInchargeId).toBe(employeeId);
      expect(detail.routeInchargeName).toBeTruthy();
    });
  });

  // ── Assignment + attendance ───────────────────────────────────────────────
  describe('Assignment and attendance', () => {
    let routeId: string;
    let stopId: string;
    let studentId: string;
    let academicYearId: string;

    beforeAll(async () => {
      const seed = await getSeed();
      academicYearId = seed.academicYearId;
      studentId = seed.studentIds[0];
      const s = await (await post('/stops', { name: `AT ${tag}`, km: 2 })).json();
      stopId = s.uuid;
      const r = await (await post('/routes', { name: `AttRoute ${tag}`, direction: 'morning' })).json();
      routeId = r.uuid;
      await post(`/routes/${routeId}/stops`, { stops: [{ stopId }] });
    });

    it('rejects assignment when the stop is not on the route', async () => {
      const other = await (await post('/stops', { name: `Off ${tag}`, km: 1 })).json();
      const res = await post('/assignments', { academicYearId, studentId, routeId, stopId: other.uuid });
      expect(res.status).toBe(400);
    });

    it('assigns a student to the route/stop and blocks a second morning assignment', async () => {
      const res = await post('/assignments', { academicYearId, studentId, routeId, stopId });
      expect(res.status).toBe(200);
      expect((await res.json()).direction).toBe('morning');

      const again = await post('/assignments', { academicYearId, studentId, routeId, stopId });
      expect(again.status).toBe(400);
    });

    it('runs the attendance lifecycle: open -> mark absent -> finalize (idempotent)', async () => {
      const date = '2015-03-14';
      const session = await (await post('/attendance/sessions', { routeId, academicYearId, date })).json();
      expect(session.status).toBe('open');

      // reopening returns the same session (idempotent)
      const again = await (await post('/attendance/sessions', { routeId, academicYearId, date })).json();
      expect(again.uuid).toBe(session.uuid);

      const marks = await post(`/attendance/sessions/${session.uuid}/marks`, {
        marks: [{ studentId, status: 'absent', remark: 'not at stop' }],
      });
      expect(marks.status).toBe(200);

      const fin = await (await post(`/attendance/sessions/${session.uuid}/finalize`, {})).json();
      expect(fin.status).toBe('finalized');
      expect(fin.counts.absent).toBe(1);
      expect(fin.absentCount).toBe(1);

      // second finalize is a no-op (does not double-notify or change counts)
      const fin2 = await (await post(`/attendance/sessions/${session.uuid}/finalize`, {})).json();
      expect(fin2.status).toBe('finalized');
      expect(fin2.notifiedJobId).toBeNull();
    });

    it('returns the student transport report with the morning assignment', async () => {
      const res = await get(`/reports/student/${studentId}?academicYearId=${academicYearId}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.morning).toBeTruthy();
      expect(data.morning.routeId).toBe(routeId);
    });
  });

  // ── Lookups + health ──────────────────────────────────────────────────────
  it('serves lookups', async () => {
    const res = await get('/lookups');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.directions.map((d: any) => d.value)).toEqual(['morning', 'evening']);
    expect(data.vehicleTypes.length).toBeGreaterThan(0);
  });

  it('responds on health', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect((await res.json()).module).toBe('transport');
  });
});
