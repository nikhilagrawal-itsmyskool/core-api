import * as fs from 'fs';
import * as path from 'path';

// Load module config - use GATEWAY_PORT env var if set, otherwise use module port
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Medical Lookup API', () => {
  const unitsUrl = `${BASE_URL}/units`;

  describe('GET /medical/units', () => {
    it('should return list of units and entity types', async () => {
      const response = await fetch(unitsUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('units');
      expect(data).toHaveProperty('entityTypes');
      expect(Array.isArray(data.units)).toBe(true);
      expect(Array.isArray(data.entityTypes)).toBe(true);

      // Verify unit structure
      expect(data.units.length).toBeGreaterThan(0);
      expect(data.units[0]).toHaveProperty('value');
      expect(data.units[0]).toHaveProperty('label');

      // Verify expected units exist
      const unitValues = data.units.map((u: any) => u.value);
      expect(unitValues).toContain('tablet');
      expect(unitValues).toContain('capsule');
      expect(unitValues).toContain('ml');
      expect(unitValues).toContain('tube');
      expect(unitValues).toContain('piece');

      // Verify entity types
      expect(data.entityTypes).toContain('employee');
      expect(data.entityTypes).toContain('student');
    });
  });
});
