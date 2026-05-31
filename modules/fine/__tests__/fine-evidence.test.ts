import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

// Minimal 1x1 white PNG as base64
const TEST_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('Fine Evidence API', () => {
  const incidentsUrl = `${BASE_URL}/incidents`;
  let incidentId: string;
  let evidenceId: string;

  const headers = {
    'Content-Type': 'application/json',
    'X-School-Code': TEST_SCHOOL_CODE,
  };

  beforeAll(async () => {
    const response = await fetch(incidentsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        incidentDate: '2026-03-15',
        category: 'infrastructure_movable',
        personType: 'student',
        personId: 'stu000000003',
        description: 'Damaged a chair',
      }),
    });
    const data = await response.json();
    incidentId = data.uuid;
  });

  describe('POST /fine/incidents/:id/evidence', () => {
    it('should upload evidence file', async () => {
      const response = await fetch(`${incidentsUrl}/${incidentId}/evidence`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fileName: 'damage-photo.png',
          mimeType: 'image/png',
          base64Data: TEST_IMAGE_BASE64,
        }),
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('uuid');
      expect(data.fileName).toBe('damage-photo.png');
      expect(data.mimeType).toBe('image/png');

      evidenceId = data.uuid;
    });

    it('should return 400 for missing fileName', async () => {
      const response = await fetch(`${incidentsUrl}/${incidentId}/evidence`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ mimeType: 'image/png', base64Data: TEST_IMAGE_BASE64 }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid mimeType', async () => {
      const response = await fetch(`${incidentsUrl}/${incidentId}/evidence`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fileName: 'doc.exe',
          mimeType: 'application/x-msdownload',
          base64Data: TEST_IMAGE_BASE64,
        }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 404 for unknown incident', async () => {
      const response = await fetch(`${incidentsUrl}/nonexistent00/evidence`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fileName: 'test.png',
          mimeType: 'image/png',
          base64Data: TEST_IMAGE_BASE64,
        }),
      });
      expect(response.status).toBe(404);
    });
  });

  describe('GET /fine/incidents/:id/evidence/:evidenceId', () => {
    it('should get evidence with base64 data', async () => {
      const response = await fetch(
        `${incidentsUrl}/${incidentId}/evidence/${evidenceId}`,
        { headers }
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.uuid).toBe(evidenceId);
      expect(data).toHaveProperty('data');
      expect(data.data).toBe(TEST_IMAGE_BASE64);
    });

    it('should return 404 for unknown evidence', async () => {
      const response = await fetch(
        `${incidentsUrl}/${incidentId}/evidence/nonexistent00`,
        { headers }
      );
      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /fine/incidents/:id/evidence/:evidenceId', () => {
    it('should delete evidence', async () => {
      const response = await fetch(
        `${incidentsUrl}/${incidentId}/evidence/${evidenceId}`,
        { method: 'DELETE', headers }
      );
      expect(response.status).toBe(200);
    });

    it('should return 404 after deletion', async () => {
      const response = await fetch(
        `${incidentsUrl}/${incidentId}/evidence/${evidenceId}`,
        { headers }
      );
      expect(response.status).toBe(404);
    });
  });
});
