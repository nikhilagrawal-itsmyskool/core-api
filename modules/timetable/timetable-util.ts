import { BlockRules } from "./timetable-interfaces";

// Validate block_rules against the declared weekly period count.
// Returns an error message string when invalid, or null when valid/absent.
// Rule: sum(size * count) over all blocks must equal periodsPerWeek.
export function validateBlockRules(
  blockRules: BlockRules | undefined,
  periodsPerWeek: number,
): string | null {
  if (blockRules === undefined || blockRules === null) {
    return null; // block_rules optional; solver defaults to all singles
  }
  // Day-rule fields are valid with or without blocks.
  if (
    blockRules.maxPeriodsPerDay !== undefined &&
    (!Number.isInteger(blockRules.maxPeriodsPerDay) ||
      blockRules.maxPeriodsPerDay < 1)
  ) {
    return "blockRules.maxPeriodsPerDay must be a positive integer";
  }
  if (
    blockRules.maxPerDay !== undefined &&
    (!Number.isInteger(blockRules.maxPerDay) || blockRules.maxPerDay < 1)
  ) {
    return "blockRules.maxPerDay must be a positive integer";
  }
  const hasBlocks =
    Array.isArray(blockRules.blocks) && blockRules.blocks.length > 0;
  if (!hasBlocks) {
    return null; // only day-rules (e.g. maxPeriodsPerDay) set — no block sum to check
  }
  let total = 0;
  for (const block of blockRules.blocks) {
    if (!Number.isInteger(block.size) || block.size < 1) {
      return "each block size must be a positive integer";
    }
    if (!Number.isInteger(block.count) || block.count < 1) {
      return "each block count must be a positive integer";
    }
    if (block.prefer !== undefined) {
      if (!Array.isArray(block.prefer)) {
        return "block prefer must be an array of { day, slot }";
      }
      for (const pref of block.prefer) {
        if (!Number.isInteger(pref?.day) || pref.day < 1 || pref.day > 7) {
          return "block prefer.day must be an integer between 1 (Mon) and 7 (Sun)";
        }
        if (!Number.isInteger(pref?.slot) || pref.slot < 1) {
          return "block prefer.slot must be a positive integer";
        }
      }
    }
    total += block.size * block.count;
  }
  if (total !== periodsPerWeek) {
    return `block rules sum (${total}) must equal periodsPerWeek (${periodsPerWeek})`;
  }
  if (
    blockRules.maxPeriodsPerDay !== undefined &&
    blockRules.blocks.some((b) => b.size > blockRules.maxPeriodsPerDay!)
  ) {
    return `a block is longer than maxPeriodsPerDay (${blockRules.maxPeriodsPerDay})`;
  }
  return null;
}

// Coerce a value to a clean jsonb-storable object (null passthrough).
export function toJsonb(value: any): any {
  return value === undefined ? null : value;
}
