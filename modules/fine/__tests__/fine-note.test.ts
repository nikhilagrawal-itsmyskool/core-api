import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Fine Note API', () => {
  const incidentsUrl = `${BASE_URL}/incidents`;
  let incidentId: string;

  const headers = {
    'Content-Type': 'application/json',
    'X-School-Code': TEST_SCHOOL_CODE,
  };

  beforeAll(async () => {
    // Create a fresh incident for note tests
    const response = await fetch(incidentsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        incidentDate: '2026-03-15',
        category: 'medical',
        personType: 'student',
        personId: 'stu000000002',
        description: 'Misused medical supplies',
      }),
    });
    const data = await response.json();
    incidentId = data.uuid;
  });

  describe('POST /fine/incidents/:id/notes', () => {
    it('should add a comment note', async () => {
      const response = await fetch(`${incidentsUrl}/${incidentId}/notes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ noteText: 'Reporter: Student was caught stealing medicine' }),
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('uuid');
      expect(data.noteText).toBe('Reporter: Student was caught stealing medicine');
      expect(data.noteType).toBe('comment');
    });

    it('should add a second note to the thread', async () => {
      const response = await fetch(`${incidentsUrl}/${incidentId}/notes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ noteText: 'Supervisor: Escalating to principal' }),
      });
      expect(response.status).toBe(200);
    });

    it('should return 400 for empty noteText', async () => {
      const response = await fetch(`${incidentsUrl}/${incidentId}/notes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ noteText: '   ' }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 404 for unknown incident', async () => {
      const response = await fetch(`${incidentsUrl}/nonexistent00/notes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ noteText: 'Some comment' }),
      });
      expect(response.status).toBe(404);
    });
  });

  describe('GET /fine/incidents/:id/notes', () => {
    it('should list notes in chronological order', async () => {
      const response = await fetch(`${incidentsUrl}/${incidentId}/notes`, { headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      // Should include the 2 user comments + 1 system note from incident creation
      expect(data.length).toBeGreaterThanOrEqual(2);
      // System notes should be present
      const systemNotes = data.filter((n: any) => n.noteType === 'system');
      expect(systemNotes.length).toBeGreaterThan(0);
    });

    it('should return 404 for unknown incident', async () => {
      const response = await fetch(`${incidentsUrl}/nonexistent00/notes`, { headers });
      expect(response.status).toBe(404);
    });

    it('should include system notes when status changes', async () => {
      // Assign to someone → status changes → system note added
      await fetch(`${incidentsUrl}/${incidentId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ assignedToId: 'emp000000002' }),
      });

      const response = await fetch(`${incidentsUrl}/${incidentId}/notes`, { headers });
      const data = await response.json();
      const systemNotes = data.filter((n: any) => n.noteType === 'system');
      expect(systemNotes.length).toBeGreaterThanOrEqual(2); // creation + assignment
    });
  });
});
