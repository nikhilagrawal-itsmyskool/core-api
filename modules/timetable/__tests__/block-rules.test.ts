import { validateBlockRules } from '../timetable-util';

// Pure unit tests (no server) for block_rules validation, including the optional
// soft day/period `prefer` hint exposed in the UI.
describe('validateBlockRules', () => {
  it('accepts absent block rules (defaults to singles)', () => {
    expect(validateBlockRules(undefined, 5)).toBeNull();
  });

  it('requires sum(size*count) === periodsPerWeek', () => {
    expect(validateBlockRules({ blocks: [{ size: 2, count: 2 }] }, 4)).toBeNull();
    expect(validateBlockRules({ blocks: [{ size: 2, count: 2 }] }, 9)).toMatch(/must equal periodsPerWeek/);
  });

  it('accepts a valid prefer hint on a block', () => {
    expect(validateBlockRules({ blocks: [{ size: 2, count: 1, prefer: [{ day: 3, slot: 4 }] }, { size: 1, count: 7 }] }, 9)).toBeNull();
  });

  it('rejects a prefer with an out-of-range day', () => {
    expect(validateBlockRules({ blocks: [{ size: 2, count: 1, prefer: [{ day: 8, slot: 1 }] }] }, 2)).toMatch(/prefer.day/);
  });

  it('rejects a prefer with a non-positive slot', () => {
    expect(validateBlockRules({ blocks: [{ size: 2, count: 1, prefer: [{ day: 1, slot: 0 }] }] }, 2)).toMatch(/prefer.slot/);
  });

  it('rejects a prefer that is not an array', () => {
    expect(validateBlockRules({ blocks: [{ size: 2, count: 1, prefer: { day: 1, slot: 1 } as any }] }, 2)).toMatch(/prefer must be an array/);
  });
});
