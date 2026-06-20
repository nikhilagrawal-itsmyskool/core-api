import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Sport Lookup API', () => {
  describe('GET /sport/lookups/units', () => {
    it('should return list of units', async () => {
      const response = await fetch(`${BASE_URL}/lookups/units`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('units');
      expect(Array.isArray(data.units)).toBe(true);
      expect(data.units.length).toBeGreaterThan(0);
      expect(data.units[0]).toHaveProperty('value');
      expect(data.units[0]).toHaveProperty('label');

      const unitValues = data.units.map((u: any) => u.value);
      expect(unitValues).toContain('piece');
      expect(unitValues).toContain('set');
      expect(unitValues).toContain('bottle');
      expect(unitValues).toContain('ml');
      expect(unitValues).toContain('kg');
    });
  });

  describe('GET /sport/lookups/sport-types', () => {
    it('should return list of sport types', async () => {
      const response = await fetch(`${BASE_URL}/lookups/sport-types`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('sportTypes');
      expect(Array.isArray(data.sportTypes)).toBe(true);

      const typeValues = data.sportTypes.map((t: any) => t.value);
      expect(typeValues).toContain('cricket');
      expect(typeValues).toContain('football');
      expect(typeValues).toContain('hockey');
      expect(typeValues).toContain('athletics');
    });
  });

  describe('GET /sport/lookups/categories', () => {
    it('should return all categories when no sportType specified', async () => {
      const response = await fetch(`${BASE_URL}/lookups/categories`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('categories');
      expect(data.categories).toHaveProperty('cricket');
      expect(data.categories).toHaveProperty('football');
    });

    it('should return categories for a specific sport type', async () => {
      const response = await fetch(`${BASE_URL}/lookups/categories?sportType=cricket`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('categories');
      expect(Array.isArray(data.categories)).toBe(true);
      expect(data.categories).toContain('Bats');
      expect(data.categories).toContain('Balls');
      expect(data.categories).toContain('Protective Gear');
    });
  });

  describe('GET /sport/lookups/conditions', () => {
    it('should return conditions, item types, and issue types', async () => {
      const response = await fetch(`${BASE_URL}/lookups/conditions`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('conditions');
      expect(data).toHaveProperty('itemTypes');
      expect(data).toHaveProperty('issueTypes');

      const conditionValues = data.conditions.map((c: any) => c.value);
      expect(conditionValues).toContain('new');
      expect(conditionValues).toContain('good');
      expect(conditionValues).toContain('needs_repair');

      expect(data.itemTypes).toContain('equipment');
      expect(data.itemTypes).toContain('consumable');
    });
  });
});
