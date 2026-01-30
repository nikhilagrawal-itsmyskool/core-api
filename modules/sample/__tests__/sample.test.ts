import * as fs from 'fs';
import * as path from 'path';

// Load module config - use GATEWAY_PORT env var if set, otherwise use module port
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Sample API', () => {
  describe('GET /sample/health', () => {
    it('should return health status', async () => {
      const response = await fetch(`${BASE_URL}/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('status', 'ok');
      expect(data).toHaveProperty('module', 'sample');
    });
  });

  describe('GET /sample/data', () => {
    it('should return sample data', async () => {
      const response = await fetch(`${BASE_URL}/data`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
    });
  });
});
