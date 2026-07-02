import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Hiring Stage API', () => {
  const candidatesUrl = `${BASE_URL}/candidates`;
  let candidateId: string;
  let stageId: string;

  const headers = {
    'Content-Type': 'application/json',
    'X-School-Code': TEST_SCHOOL_CODE,
  };

  beforeAll(async () => {
    const res = await fetch(candidatesUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Stage Test Candidate', positionType: 'tgt', subject: 'english' }),
    });
    const data = await res.json();
    candidateId = data.uuid;
  });

  describe('POST /hiring/candidates/:id/stages', () => {
    it('should add a resume_screening stage and advance status to screening', async () => {
      const res = await fetch(`${candidatesUrl}/${candidateId}/stages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          stageType: 'resume_screening',
          scheduledDate: '2026-07-10',
          outcome: 'moved_to_next',
          comments: 'Resume looks good',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('uuid');
      expect(data.stageType).toBe('resume_screening');
      stageId = data.uuid;

      // moved_to_next on screening → candidate advances to interview
      const getRes = await fetch(`${candidatesUrl}/${candidateId}`, { headers });
      const candidate = await getRes.json();
      expect(candidate.status).toBe('interview');
      expect(candidate.stages.length).toBe(1);
    });

    it('should return 400 for invalid stageType', async () => {
      const res = await fetch(`${candidatesUrl}/${candidateId}/stages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ stageType: 'phone_screen' }),
      });
      expect(res.status).toBe(400);
    });

    it('should return 404 when candidate does not exist', async () => {
      const res = await fetch(`${candidatesUrl}/nonexistent0/stages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ stageType: 'interview_1' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /hiring/candidates/:id/stages/:stageId', () => {
    it('should update stage outcome to rejected and set candidate status rejected', async () => {
      const res = await fetch(`${candidatesUrl}/${candidateId}/stages/${stageId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ outcome: 'rejected', comments: 'Changed mind' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.outcome).toBe('rejected');

      const getRes = await fetch(`${candidatesUrl}/${candidateId}`, { headers });
      const candidate = await getRes.json();
      expect(candidate.status).toBe('rejected');
    });

    it('should return 404 for unknown stage', async () => {
      const res = await fetch(`${candidatesUrl}/${candidateId}/stages/nonexistent0`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ outcome: 'on_hold' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /hiring/candidates/:id/stages/:stageId', () => {
    it('should delete a stage', async () => {
      const res = await fetch(`${candidatesUrl}/${candidateId}/stages/${stageId}`, {
        method: 'DELETE',
        headers,
      });
      expect(res.status).toBe(200);

      const getRes = await fetch(`${candidatesUrl}/${candidateId}`, { headers });
      const candidate = await getRes.json();
      expect(candidate.stages.length).toBe(0);
    });
  });
});
