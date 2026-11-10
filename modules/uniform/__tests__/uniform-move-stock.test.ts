import '../../../tests/setup';
import { createTestSchool, cleanupTestSchool, TestSchool } from './test-school';
import { uniformItemService } from '../uniform-item-service';

// Service-level coverage of the Unknown-bucket + move-stock flow: a sized item holds an
// "Unknown" size (flagged + note) for tailor-stitched pieces; units are moved out of it
// into real numbered sizes (existing or newly created). Runs without the HTTP server.
describe('Uniform Unknown bucket + move-stock (service layer)', () => {
  let school: TestSchool;
  const userId = 'tester00000';
  let itemId: string;
  let unknownSizeId: string;

  beforeAll(async () => { school = await createTestSchool(); });
  afterAll(async () => { await cleanupTestSchool(school); });

  it('creates an Unknown size bucket with a note, then stocks it', async () => {
    const item = await uniformItemService.createItem(
      { name: 'Full Shirt', category: 'summer', gender: 'male' } as any, school.schoolId, userId);
    itemId = item.uuid;

    const unknown = await uniformItemService.createSize(itemId,
      { sizeLabel: 'Unknown', isUnknown: true, note: 'tailor stitched' }, school.schoolId, userId);
    expect(unknown.isUnknown).toBe(true);
    expect(unknown.note).toBe('tailor stitched');
    unknownSizeId = unknown.uuid;

    await uniformItemService.setOpeningStock(itemId, { rows: [{ sizeLabel: 'Unknown', quantity: 10 }] }, school.schoolId, userId);
    const full = await uniformItemService.getItemWithSizes(itemId, school.schoolId);
    const u = full!.sizes.find(s => s.uuid === unknownSizeId);
    expect(u!.currentStock).toBe(10);
    expect(u!.isUnknown).toBe(true); // stocking the bucket keeps its flag/note
  });

  it('moves units from Unknown into a NEW numbered size with a price', async () => {
    const res = await uniformItemService.moveStock(itemId,
      { fromSizeId: unknownSizeId, toSizeLabel: '38', quantity: 4, mrp: 850 }, school.schoolId, userId);
    const byLabel = Object.fromEntries(res.sizes.map(s => [s.sizeLabel, s]));
    expect(byLabel['Unknown'].currentStock).toBe(6);
    expect(byLabel['38'].currentStock).toBe(4);
    expect(byLabel['38'].mrp).toBe(850);
    expect(byLabel['38'].isUnknown).toBe(false);
  });

  it('moves units from Unknown into an EXISTING size', async () => {
    const res = await uniformItemService.moveStock(itemId,
      { fromSizeId: unknownSizeId, toSizeLabel: '38', quantity: 3 }, school.schoolId, userId);
    const byLabel = Object.fromEntries(res.sizes.map(s => [s.sizeLabel, s]));
    expect(byLabel['Unknown'].currentStock).toBe(3);
    expect(byLabel['38'].currentStock).toBe(7); // 4 + 3, no duplicate size created
    expect(res.sizes.filter(s => s.sizeLabel === '38')).toHaveLength(1);
  });

  it('rejects moving more than the source holds', async () => {
    await expect(uniformItemService.moveStock(itemId,
      { fromSizeId: unknownSizeId, toSizeLabel: '40', quantity: 99 }, school.schoolId, userId))
      .rejects.toThrow(/in stock to move/i);
  });

  it('rejects moving a size into itself', async () => {
    await expect(uniformItemService.moveStock(itemId,
      { fromSizeId: unknownSizeId, toSizeLabel: 'Unknown', quantity: 1 }, school.schoolId, userId))
      .rejects.toThrow(/same/i);
  });
});
