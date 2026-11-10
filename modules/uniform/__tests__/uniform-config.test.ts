import '../../../tests/setup';
import { createTestSchool, cleanupTestSchool, TestSchool } from './test-school';
import { uniformItemService } from '../uniform-item-service';

// Per-school uniform config: default shows preset hints; toggle persists (upsert).
describe('Uniform config (service layer)', () => {
  let school: TestSchool;
  const userId = 'tester00000';

  beforeAll(async () => { school = await createTestSchool(); });
  afterAll(async () => {
    await school.pool.query(`delete from uniform_config where school_id = $1`, [school.schoolId]);
    await cleanupTestSchool(school);
  });

  it('defaults showSeededHints to true when no row exists', async () => {
    const cfg = await uniformItemService.getConfig(school.schoolId);
    expect(cfg.showSeededHints).toBe(true);
  });

  it('persists showSeededHints=false (insert then update)', async () => {
    const off = await uniformItemService.updateConfig(school.schoolId, { showSeededHints: false }, userId);
    expect(off.showSeededHints).toBe(false);
    expect((await uniformItemService.getConfig(school.schoolId)).showSeededHints).toBe(false);

    const on = await uniformItemService.updateConfig(school.schoolId, { showSeededHints: true }, userId);
    expect(on.showSeededHints).toBe(true);
  });
});
