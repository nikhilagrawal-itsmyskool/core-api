import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;
const headers = { 'Content-Type': 'application/json', 'X-School-Code': TEST_SCHOOL_CODE };
const AY = `testay${Date.now()}`.slice(0, 12); // dummy academic-year id (no FK) unique per run

describe('Fees API', () => {
  describe('GET /fees/health', () => {
    it('is healthy', async () => {
      const r = await fetch(`${BASE_URL}/health`);
      expect(r.status).toBe(200);
      expect((await r.json()).module).toBe('fees');
    });
  });

  describe('GET /fees/lookups', () => {
    it('returns enum lookups', async () => {
      const r = await fetch(`${BASE_URL}/lookups`, { headers });
      expect(r.status).toBe(200);
      const d = await r.json();
      expect(d.feeHeadKinds).toContain('recurring');
      expect(d.concessionTypes).toContain('sibling');
      expect(d.paymentModes).toContain('cash');
    });
  });

  describe('Fee heads CRUD', () => {
    let headId: string;
    it('creates a head', async () => {
      const r = await fetch(`${BASE_URL}/heads`, { method: 'POST', headers, body: JSON.stringify({ academicYearId: AY, name: 'Tuition Fee', kind: 'recurring' }) });
      expect(r.status).toBe(200);
      const d = await r.json();
      expect(d.uuid).toBeTruthy();
      expect(d.name).toBe('Tuition Fee');
      headId = d.uuid;
    });
    it('rejects an invalid kind', async () => {
      const r = await fetch(`${BASE_URL}/heads`, { method: 'POST', headers, body: JSON.stringify({ academicYearId: AY, name: 'Bad', kind: 'nope' }) });
      expect(r.status).toBe(400);
    });
    it('lists the head', async () => {
      const r = await fetch(`${BASE_URL}/heads?academicYearId=${AY}`, { headers });
      expect(r.status).toBe(200);
      const d = await r.json();
      expect(d.some((h: any) => h.uuid === headId)).toBe(true);
    });
    it('soft-deletes the head', async () => {
      const r = await fetch(`${BASE_URL}/heads/${headId}`, { method: 'DELETE', headers });
      expect(r.status).toBe(200);
    });
  });

  describe('Fee cycles', () => {
    it('creates and deletes a cycle', async () => {
      const c = await fetch(`${BASE_URL}/cycles`, { method: 'POST', headers, body: JSON.stringify({ academicYearId: AY, name: 'April', fromDate: '2025-04-01', dueDate: '2025-04-15' }) });
      expect(c.status).toBe(200);
      const cd = await c.json();
      expect(cd.uuid).toBeTruthy();
      const del = await fetch(`${BASE_URL}/cycles/${cd.uuid}`, { method: 'DELETE', headers });
      expect(del.status).toBe(200);
    });
  });

  describe('auth', () => {
    it('rejects a missing school code', async () => {
      const r = await fetch(`${BASE_URL}/heads?academicYearId=${AY}`, { headers: { 'Content-Type': 'application/json' } });
      expect(r.status).toBe(400);
    });
  });
});
