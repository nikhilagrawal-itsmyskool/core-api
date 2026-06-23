// Item-hygiene helpers for the supplies catalog.
//
// These power the de-duplication guard around inline item creation: exact/
// normalized matches are auto-reused; close (typo-level) matches are surfaced
// for confirmation. Levenshtein is computed app-side over a single category's
// (small) item set, so no Postgres extension (pg_trgm) is needed.

// Lower-case, trim, and collapse internal whitespace so that "Crayons",
// "  crayons " and "Crayons" all compare equal. Used for the natural key.
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Classic iterative Levenshtein edit distance.
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost // substitution
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

// Whether two normalized names are "near" enough to be a likely typo of each
// other. Stricter for short names (where a single edit changes meaning).
export function isNearMatch(normA: string, normB: string): boolean {
  if (normA === normB) return false; // exact handled separately (auto-reuse)
  const longer = Math.max(normA.length, normB.length);
  const threshold = longer > 4 ? 2 : 1;
  return levenshtein(normA, normB) <= threshold;
}
