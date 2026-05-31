import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Fine Incident API', () => {
  const incidentsUrl = `${BASE_URL}/incidents`;
  let createdIncidentId: string;

  const headers = {
    'Content-Type': 'application/json',
    'X-School-Code': TEST_SCHOOL_CODE,
  };

  describe('POST /fine/incidents', () => {
    it('should create a new incident', async () => {
      const response = await fetch(incidentsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          incidentDate: '2026-03-15',
          category: 'labs',
          personType: 'student',
          personId: 'stu000000001',
          description: 'Broke a beaker in chemistry lab',
          suggestedFineAmount: 250,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('uuid');
      expect(data.category).toBe('labs');
      expect(data.personType).toBe('student');
      expect(data.status).toBe('open');
      expect(data.suggestedFineAmount).toBe(250);

      createdIncidentId = data.uuid;
    });

    it('should return 400 for missing incidentDate', async () => {
      const response = await fetch(incidentsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          category: 'labs',
          personType: 'student',
          personId: 'stu000000001',
        }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    it('should return 400 for invalid category', async () => {
      const response = await fetch(incidentsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          incidentDate: '2026-03-15',
          category: 'invalid_category',
          personType: 'student',
          personId: 'stu000000001',
        }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid personType', async () => {
      const response = await fetch(incidentsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          incidentDate: '2026-03-15',
          category: 'labs',
          personType: 'teacher',
          personId: 'stu000000001',
        }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for missing X-School-Code', async () => {
      const response = await fetch(incidentsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incidentDate: '2026-03-15',
          category: 'labs',
          personType: 'student',
          personId: 'stu000000001',
        }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('GET /fine/incidents/:id', () => {
    it('should get incident by id with notes, evidence, collection', async () => {
      const response = await fetch(`${incidentsUrl}/${createdIncidentId}`, { headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.uuid).toBe(createdIncidentId);
      expect(data).toHaveProperty('notes');
      expect(data).toHaveProperty('evidence');
      expect(Array.isArray(data.notes)).toBe(true);
      expect(Array.isArray(data.evidence)).toBe(true);
    });

    it('should return 404 for unknown id', async () => {
      const response = await fetch(`${incidentsUrl}/nonexistent00`, { headers });
      expect(response.status).toBe(404);
    });
  });

  describe('GET /fine/incidents', () => {
    it('should list incidents', async () => {
      const response = await fetch(incidentsUrl, { headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
    });

    it('should filter by status=open', async () => {
      const response = await fetch(`${incidentsUrl}?status=open`, { headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      data.forEach((item: any) => expect(item.status).toBe('open'));
    });

    it('should filter by category', async () => {
      const response = await fetch(`${incidentsUrl}?category=labs`, { headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
    });

    it('should return 400 for invalid status filter', async () => {
      const response = await fetch(`${incidentsUrl}?status=invalid`, { headers });
      expect(response.status).toBe(400);
    });
  });

  describe('PUT /fine/incidents/:id', () => {
    it('should update incident description', async () => {
      const response = await fetch(`${incidentsUrl}/${createdIncidentId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ description: 'Updated: Broke a 250ml beaker' }),
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.description).toBe('Updated: Broke a 250ml beaker');
    });

    it('should transition to under_review when assignedToId is set', async () => {
      const response = await fetch(`${incidentsUrl}/${createdIncidentId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ assignedToId: 'emp000000001' }),
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('under_review');
      expect(data.assignedToId).toBe('emp000000001');
    });

    it('should record decision and transition to decision_made', async () => {
      const response = await fetch(`${incidentsUrl}/${createdIncidentId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ decision: 'collect', decidedFineAmount: 200 }),
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('decision_made');
      expect(data.decision).toBe('collect');
      expect(data.decidedFineAmount).toBe(200);
    });

    it('should return 400 for invalid status transition', async () => {
      // incident is now decision_made, can't go back to open
      const response = await fetch(`${incidentsUrl}/${createdIncidentId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ status: 'open' }),
      });
      expect(response.status).toBe(400);
    });

    it('should require decidedFineAmount when decision is collect', async () => {
      const response = await fetch(`${incidentsUrl}/${createdIncidentId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ decision: 'collect' }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /fine/incidents/:id', () => {
    it('should delete (close) an incident', async () => {
      const createRes = await fetch(incidentsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          incidentDate: '2026-03-20',
          category: 'library',
          personType: 'employee',
          personId: 'emp000000001',
          description: 'To be deleted',
        }),
      });
      const created = await createRes.json();

      const response = await fetch(`${incidentsUrl}/${created.uuid}`, {
        method: 'DELETE',
        headers,
      });
      expect(response.status).toBe(200);
    });
  });
});
