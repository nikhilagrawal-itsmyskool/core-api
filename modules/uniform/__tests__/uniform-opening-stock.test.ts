import '../../../tests/setup';
import { createTestSchool, cleanupTestSchool, TestSchool } from './test-school';
import { uniformItemService } from '../uniform-item-service';

// Service-level coverage of bulk opening-stock entry (sized items): upsert sizes by
// label + set counts (absolute), price optional. Runs without the HTTP server.
describe('Uniform bulk opening-stock (service layer)', () => {
  let school: TestSchool;
  const userId = 'tester00000';
  let itemId: string;

  beforeAll(async () => { school = await createTestSchool(); });
  afterAll(async () => { await cleanupTestSchool(school); });

  it('creates sizes + sets counts in one call, price optional', async () => {
    const item = await uniformItemService.createItem(
      { name: 'Blazer', category: 'winter', gender: 'male' } as any, school.schoolId, userId);
    itemId = item.uuid;

    const res = await uniformItemService.setOpeningStock(itemId, {
      rows: [
        { sizeLabel: '24', quantity: 4 },
        { sizeLabel: '26', quantity: 14 },
        { sizeLabel: '28', quantity: 3, mrp: 850 },
      ],
    }, school.schoolId, userId);

    const byLabel = Object.fromEntries(res.sizes.filter(s => !s.isPool).map(s => [s.sizeLabel, s]));
    expect(byLabel['24'].currentStock).toBe(4);
    expect(byLabel['26'].currentStock).toBe(14);
    expect(byLabel['28'].currentStock).toBe(3);
    expect(byLabel['24'].mrp).toBeNull();   // price omitted -> stays null
    expect(byLabel['28'].mrp).toBe(850);    // price provided
  });

  it('overwrites existing counts (absolute) and adds a new size', async () => {
    const res = await uniformItemService.setOpeningStock(itemId, {
      rows: [
        { sizeLabel: '24', quantity: 10 },  // was 4 -> set to 10
        { sizeLabel: '30', quantity: 8 },   // new
      ],
    }, school.schoolId, userId);
    const byLabel = Object.fromEntries(res.sizes.filter(s => !s.isPool).map(s => [s.sizeLabel, s]));
    expect(byLabel['24'].currentStock).toBe(10);
    expect(byLabel['30'].currentStock).toBe(8);
    expect(byLabel['26'].currentStock).toBe(14); // untouched rows keep their count
  });

  it('rejects a duplicate size in the same request', async () => {
    await expect(uniformItemService.setOpeningStock(itemId, {
      rows: [{ sizeLabel: '24', quantity: 1 }, { sizeLabel: '24', quantity: 2 }],
    }, school.schoolId, userId)).rejects.toThrow(/duplicate/i);
  });

  it('rejects a negative / non-integer quantity', async () => {
    await expect(uniformItemService.setOpeningStock(itemId, {
      rows: [{ sizeLabel: '24', quantity: -1 }],
    }, school.schoolId, userId)).rejects.toThrow(/whole number/i);
  });

  it('refuses an unsized item', async () => {
    const u = await uniformItemService.createItem(
      { name: 'Tailor Shirt', category: 'summer', gender: 'unisex', sizingMode: 'unsized' }, school.schoolId, userId);
    await expect(uniformItemService.setOpeningStock(u.uuid, {
      rows: [{ sizeLabel: '24', quantity: 1 }],
    }, school.schoolId, userId)).rejects.toThrow(/unsized/i);
  });
});
