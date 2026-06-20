import * as fs from 'fs';
import * as path from 'path';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;

describe('Lab Lookup API', () => {
  describe('GET /lab/lookups/units', () => {
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

  describe('GET /lab/lookups/lab-types', () => {
    it('should return list of lab types', async () => {
      const response = await fetch(`${BASE_URL}/lookups/lab-types`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('labTypes');
      expect(Array.isArray(data.labTypes)).toBe(true);

      const typeValues = data.labTypes.map((t: any) => t.value);
      expect(typeValues).toContain('physics');
      expect(typeValues).toContain('chemistry');
      expect(typeValues).toContain('biology');
      expect(typeValues).toContain('computer');
    });
  });

  describe('GET /lab/lookups/categories', () => {
    it('should return all categories when no labType specified', async () => {
      const response = await fetch(`${BASE_URL}/lookups/categories`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('categories');
      expect(data.categories).toHaveProperty('physics');
      expect(data.categories).toHaveProperty('chemistry');
    });

    it('should return categories for a specific lab type', async () => {
      const response = await fetch(`${BASE_URL}/lookups/categories?labType=physics`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('categories');
      expect(Array.isArray(data.categories)).toBe(true);
      expect(data.categories).toContain('Electricity');
      expect(data.categories).toContain('Optics');
      expect(data.categories).toContain('Mechanics');
    });
  });

  describe('GET /lab/lookups/conditions', () => {
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
