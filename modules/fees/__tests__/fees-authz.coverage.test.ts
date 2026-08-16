import * as fs from 'fs';
import * as path from 'path';
import { FEE_ACTIONS, FEE_PUBLIC } from '../fees-actions';

// Guarantees every fees endpoint has an explicit authorization decision: each
// `handler:` in fees-endpoints.yml must be either gated (FEE_ACTIONS) or explicitly
// public (FEE_PUBLIC). A new endpoint added without a decision fails here — no silent
// hole.

function handlerRefsFromYml(): string[] {
  const yml = fs.readFileSync(path.join(__dirname, '../fees-endpoints.yml'), 'utf8');
  const refs: string[] = [];
  const re = /handler:\s*([A-Za-z0-9_.-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(yml)) !== null) refs.push(m[1]);
  return refs;
}

describe('fees authorization coverage', () => {
  const refs = handlerRefsFromYml();
  const decided = new Set([...Object.keys(FEE_ACTIONS), ...FEE_PUBLIC]);

  it('finds every fees endpoint', () => {
    expect(refs.length).toBeGreaterThan(50);
  });

  it('every handler in fees-endpoints.yml has an authorization decision', () => {
    const undecided = refs.filter((r) => !decided.has(r));
    expect(undecided).toEqual([]);
  });

  it('has no stale manifest entries (every mapped/exempt ref still exists in the yml)', () => {
    const inYml = new Set(refs);
    const stale = [...decided].filter((r) => !inYml.has(r));
    expect(stale).toEqual([]);
  });
});
