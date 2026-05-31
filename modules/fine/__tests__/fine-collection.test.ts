import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Fine Collection API', () => {
  const incidentsUrl = `${BASE_URL}/incidents`;
  let incidentId: string;

  const headers = {
    'Content-Type': 'application/json',
    'X-School-Code': TEST_SCHOOL_CODE,
  };

  beforeAll(async () => {
    // Create and progress an incident to decision_made state
    const createRes = await fetch(incidentsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        incidentDate: '2026-03-15',
        category: 'library_books',
        personType: 'student',
        personId: 'stu000000004',
        description: 'Damaged a library book',
        suggestedFineAmount: 150,
      }),
    });
    const incident = await createRes.json();
    incidentId = incident.uuid;

    // Set decision to collect
    await fetch(`${incidentsUrl}/${incidentId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ decision: 'collect', decidedFineAmount: 150 }),
    });
  });

  describe('POST /fine/incidents/:id/collect', () => {
    it('should collect the fine and return receipt', async () => {
      const response = await fetch(`${incidentsUrl}/${incidentId}/collect`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          amountCollected: 150,
          collectionDate: '2026-04-01',
          paymentMethod: 'cash',
          notes: 'Collected from student directly',
        }),
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('uuid');
      expect(data).toHaveProperty('receiptNumber');
      expect(data.receiptNumber).toMatch(/^FINE-\d{8}-[A-Z0-9]{6}$/);
      expect(data.amountCollected).toBe(150);
      expect(data.paymentMethod).toBe('cash');
    });

    it('incident should now be closed after collection', async () => {
      const response = await fetch(`${incidentsUrl}/${incidentId}`, { headers });
      const data = await response.json();
      expect(data.status).toBe('closed');
    });

    it('should return 400 if fine already collected', async () => {
      const response = await fetch(`${incidentsUrl}/${incidentId}/collect`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ amountCollected: 150, collectionDate: '2026-04-01' }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 if incident is not in decision_made state', async () => {
      // Create a fresh open incident
      const createRes = await fetch(incidentsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          incidentDate: '2026-03-20',
          category: 'labs',
          personType: 'employee',
          personId: 'emp000000003',
          description: 'Open incident',
        }),
      });
      const openIncident = await createRes.json();

      const response = await fetch(`${incidentsUrl}/${openIncident.uuid}/collect`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ amountCollected: 100, collectionDate: '2026-04-01' }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for missing amountCollected', async () => {
      // Create another incident at decision_made
      const createRes = await fetch(incidentsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          incidentDate: '2026-03-20',
          category: 'medical',
          personType: 'student',
          personId: 'stu000000005',
          description: 'Another incident',
        }),
      });
      const inc = await createRes.json();
      await fetch(`${incidentsUrl}/${inc.uuid}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ decision: 'collect', decidedFineAmount: 100 }),
      });

      const response = await fetch(`${incidentsUrl}/${inc.uuid}/collect`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ collectionDate: '2026-04-01' }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('GET /fine/incidents/:id/receipt', () => {
    it('should return receipt for collected fine', async () => {
      const response = await fetch(`${incidentsUrl}/${incidentId}/receipt`, { headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('receiptNumber');
      expect(data.incidentId).toBe(incidentId);
      expect(data.amountCollected).toBe(150);
    });

    it('should return 404 for incident with no collection', async () => {
      const createRes = await fetch(incidentsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          incidentDate: '2026-03-20',
          category: 'library',
          personType: 'student',
          personId: 'stu000000007',
          description: 'No collection yet',
        }),
      });
      const newIncident = await createRes.json();

      const response = await fetch(`${incidentsUrl}/${newIncident.uuid}/receipt`, { headers });
      expect(response.status).toBe(404);
    });
  });

  describe('Waive fine workflow', () => {
    it('should auto-close incident when decision is waive', async () => {
      const createRes = await fetch(incidentsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          incidentDate: '2026-03-15',
          category: 'library',
          personType: 'student',
          personId: 'stu000000006',
          description: 'Incident to be waived',
        }),
      });
      const incident = await createRes.json();

      const updateRes = await fetch(`${incidentsUrl}/${incident.uuid}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ decision: 'waive' }),
      });
      expect(updateRes.status).toBe(200);
      const updated = await updateRes.json();
      expect(updated.status).toBe('closed');
      expect(updated.decision).toBe('waive');
    });
  });
});
