import * as fs from 'fs';
import * as path from 'path';
import { ROLE_PERMISSIONS, ACTIONS } from '../authz-policy';

// Drift guard: the backend policy is a port of the admin-portal frontend model. When
// the sibling admin-portal repo is checked out next to core-api, assert the two agree
// so a role/action added on one side but not the other fails CI. Soft-skips (passes)
// when the sibling repo is absent (e.g. a core-api-only checkout).

const FRONTEND_DIR = path.join(__dirname, '../../../../admin-portal/src/permissions');
const policyPath = path.join(FRONTEND_DIR, 'policy.js');
const actionsPath = path.join(FRONTEND_DIR, 'actions.js');

// Extract a top-level object literal `<marker> = { ... }` by brace-matching. These are
// pure data objects (string/array values, no braces inside strings), so a naive counter
// is safe. Evaluated with new Function — the literals are valid JS (comments/trailing
// commas/unquoted keys all fine).
function extractObject(source: string, marker: string): any {
  const at = source.indexOf(marker);
  if (at < 0) throw new Error(`marker not found: ${marker}`);
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        const literal = source.slice(open, i + 1);
        // eslint-disable-next-line no-new-func
        return new Function(`return (${literal});`)();
      }
    }
  }
  throw new Error(`unbalanced braces for ${marker}`);
}

const present = fs.existsSync(policyPath) && fs.existsSync(actionsPath);
const maybe = present ? describe : describe.skip;

maybe('backend authz-policy matches admin-portal source', () => {
  it('ROLE_PERMISSIONS is identical to the frontend policy.js', () => {
    const frontend = extractObject(fs.readFileSync(policyPath, 'utf8'), 'ROLE_PERMISSIONS');
    expect(ROLE_PERMISSIONS).toEqual(frontend);
  });

  it('ACTIONS string values match the frontend actions.js', () => {
    const frontend = extractObject(fs.readFileSync(actionsPath, 'utf8'), 'ACTIONS');
    // Compare the sets of action strings (backend ACTIONS is `as const`).
    expect(new Set(Object.values(ACTIONS))).toEqual(new Set(Object.values(frontend)));
  });
});

if (!present) {
  // Keep a visible marker in the run so it's clear the guard was inactive.
  // eslint-disable-next-line no-console
  console.warn('[authz-policy.parity] admin-portal sibling repo not found — skipping cross-repo parity checks');
}
