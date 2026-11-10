import '../../../tests/setup';
import { createTestSchool, cleanupTestSchool, TestSchool } from './test-school';
import { uniformItemService } from '../uniform-item-service';
import { uniformPurchaseService } from '../uniform-purchase-service';
import { uniformSaleService } from '../uniform-sale-service';

// Service-level (direct DB) coverage of the "judge the number at the counter" feature:
// unsized items, per-item price bands, suggestion, unsized sale pricing, and the
// permanent break-into-numbers conversion. Runs without the HTTP server.
describe('Uniform unsized items / price bands / break (service layer)', () => {
  let school: TestSchool;
  const userId = 'tester00000';
  let itemId: string;
  let poolSizeId: string;

  beforeAll(async () => {
    school = await createTestSchool();
  });

  afterAll(async () => {
    await cleanupTestSchool(school);
  });

  it('creates an unsized item with exactly one pool stock row', async () => {
    const item = await uniformItemService.createItem(
      { name: 'Tailor Shirt', category: 'summer', gender: 'unisex', sizingMode: 'unsized' },
      school.schoolId, userId
    );
    expect(item.sizingMode).toBe('unsized');
    itemId = item.uuid;

    const full = await uniformItemService.getItemWithSizes(itemId, school.schoolId);
    expect(full!.sizes).toHaveLength(1);
    expect(full!.sizes[0].isPool).toBe(true);
    expect(full!.sizes[0].currentStock).toBe(0);
    poolSizeId = full!.sizes[0].uuid;
  });

  it('defaults sizingMode to sized when omitted', async () => {
    const item = await uniformItemService.createItem(
      { name: 'Blazer', category: 'winter', gender: 'male' } as any,
      school.schoolId, userId
    );
    expect(item.sizingMode).toBe('sized');
    const full = await uniformItemService.getItemWithSizes(item.uuid, school.schoolId);
    expect(full!.sizes).toHaveLength(0);
  });

  it('creates number->price bands and suggests the covering price', async () => {
    await uniformItemService.createBand(itemId, { numberFrom: 20, numberTo: 24, mrp: 250, studentDiscountPct: 10, bulkDiscountPct: 5, sortOrder: 1 }, school.schoolId, userId);
    await uniformItemService.createBand(itemId, { numberFrom: 26, numberTo: 32, mrp: 300, studentDiscountPct: 10, bulkDiscountPct: 5, sortOrder: 2 }, school.schoolId, userId);

    const full = await uniformItemService.getItemWithSizes(itemId, school.schoolId);
    expect(full!.bands).toHaveLength(2);

    const hit = await uniformItemService.suggestPrice(itemId, 28, school.schoolId);
    expect(hit.matched).toBe(true);
    expect(hit.mrp).toBe(300);

    const miss = await uniformItemService.suggestPrice(itemId, 99, school.schoolId);
    expect(miss.matched).toBe(false);
    expect(miss.mrp).toBeNull();
  });

  it('prices an unsized sale from the judged number and records judgedSize', async () => {
    // Stock the pool with 50 units.
    await uniformPurchaseService.createBatch(
      { purchaseDate: '2026-01-10', items: [{ itemId, sizeId: poolSizeId, quantity: 50, mrp: 0 }] },
      school.schoolId, userId
    );

    const sale = await uniformSaleService.create(
      {
        studentId: school.studentId, saleDate: '2026-02-01', saleType: 'student', amountPaid: 270,
        items: [{ itemId, sizeId: poolSizeId, quantity: 1, judgedSize: '28' }],
      },
      school.schoolId, userId
    );
    expect(sale.totalMrp).toBe(300);     // band mrp for 28
    expect(sale.totalDiscount).toBe(30); // 10%
    expect(sale.totalAmount).toBe(270);
    expect(sale.items[0].judgedSize).toBe('28');

    const full = await uniformItemService.getItemWithSizes(itemId, school.schoolId);
    expect(full!.sizes.find(s => s.isPool)!.currentStock).toBe(49);
  });

  it('rejects a breakdown whose total != pool stock', async () => {
    await expect(
      uniformItemService.breakIntoSizes(itemId, { breakdown: [{ sizeLabel: '28', quantity: 10 }] }, school.schoolId, userId)
    ).rejects.toThrow(/equal pool stock/i);
  });

  it('breaks the pool into sized rows, inheriting band prices, and flips to sized', async () => {
    const result = await uniformItemService.breakIntoSizes(
      itemId,
      { breakdown: [
        { sizeLabel: '22', quantity: 14 },
        { sizeLabel: '28', quantity: 20 },
        { sizeLabel: '30', quantity: 15 },
      ] },
      school.schoolId, userId
    );
    expect(result.sizingMode).toBe('sized');

    const sized = result.sizes.filter(s => !s.isPool);
    expect(sized.map(s => s.sizeLabel).sort()).toEqual(['22', '28', '30']);
    expect(result.sizes.find(s => s.isPool)).toBeUndefined();
    expect(sized.find(s => s.sizeLabel === '22')!.mrp).toBe(250); // band 20-24
    expect(sized.find(s => s.sizeLabel === '28')!.mrp).toBe(300); // band 26-32
    expect(sized.find(s => s.sizeLabel === '30')!.currentStock).toBe(15);
  });

  it('refuses to break an already-sized item', async () => {
    await expect(
      uniformItemService.breakIntoSizes(itemId, { breakdown: [{ sizeLabel: '22', quantity: 1 }] }, school.schoolId, userId)
    ).rejects.toThrow(/unsized/i);
  });
});
