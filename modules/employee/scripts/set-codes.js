/**
 * Generate and optionally apply teacher codes to the employee table.
 * Usage:
 *   node modules/employee/scripts/set-codes.js --stage prod          (preview)
 *   node modules/employee/scripts/set-codes.js --stage prod --apply  (apply)
 */

const path = require('path');
const { loadConfig, createPool } = require(path.join(__dirname, '../../../scripts/run-sql'));

const args = process.argv.slice(2);
const stageIdx = args.indexOf('--stage');
const stage = stageIdx !== -1 ? args[stageIdx + 1] : 'local';
const apply = args.includes('--apply');

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'sir', 'shri', 'smt', 'km']);

function stripTitles(name) {
  const parts = name.trim().split(/\s+/).filter(p => p.length > 0);
  return parts.filter(p => !TITLES.has(p.replace(/\.$/, '').toLowerCase()));
}

function primaryCode(parts) {
  if (parts.length === 1) return parts[0].substring(0, 3).toUpperCase();
  if (parts.length === 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0][0] + parts[1][0] + parts[2][0]).toUpperCase();
}

function candidates(parts) {
  const f = parts[0], l = parts[parts.length - 1], m = parts.length > 2 ? parts[1] : null;
  const set = [];

  // Primary
  set.push(primaryCode(parts));

  // Extend with more letters
  if (parts.length === 2) {
    if (f.length >= 2) set.push((f[0] + f[1] + l[0]).toUpperCase());   // FFl
    if (l.length >= 2) set.push((f[0] + l[0] + l[1]).toUpperCase());   // fLL
    if (f.length >= 3) set.push(f.substring(0, 3).toUpperCase());      // FFF
    if (l.length >= 3) set.push(l.substring(0, 3).toUpperCase());      // LLL
    if (f.length >= 2 && l.length >= 2) set.push((f[0] + f[1] + l[1]).toUpperCase()); // FFl2
  } else if (parts.length >= 3 && m) {
    if (m.length >= 2) set.push((f[0] + m[0] + m[1]).toUpperCase());
    if (l.length >= 2) set.push((f[0] + m[0] + l[1]).toUpperCase());
    if (f.length >= 2) set.push((f[0] + f[1] + m[0]).toUpperCase());
  } else {
    // single name fallbacks
    if (f.length >= 2) set.push((f[0] + f[1] + f[2 < f.length ? 2 : 1]).toUpperCase());
  }

  // Deduplicate preserving order
  return [...new Set(set)];
}

function assignCode(name, usedCodes) {
  const parts = stripTitles(name);
  if (parts.length === 0) return null;

  for (const code of candidates(parts)) {
    if (!usedCodes.has(code)) {
      usedCodes.add(code);
      return code;
    }
  }

  // Last resort: primary code + numeric suffix
  const base = primaryCode(parts).substring(0, 2);
  for (let i = 2; i <= 9; i++) {
    const code = base + i;
    if (!usedCodes.has(code)) {
      usedCodes.add(code);
      return code;
    }
  }
  return null;
}

async function main() {
  const config = loadConfig(stage);
  const pool = createPool(config);

  try {
    const { rows } = await pool.query(
      `select uuid, name, school_id, code from employee where name is not null order by school_id, name`
    );

    // Group by school and assign codes per school (codes are unique within a school)
    const bySchool = new Map();
    for (const row of rows) {
      if (!bySchool.has(row.school_id)) bySchool.set(row.school_id, []);
      bySchool.get(row.school_id).push(row);
    }

    const updates = [];
    let collidedCount = 0;

    for (const [schoolId, employees] of bySchool) {
      const usedCodes = new Set();
      console.log(`\nSchool: ${schoolId}`);
      console.log(`${'Name'.padEnd(40)} ${'New Code'}`);
      console.log('-'.repeat(50));

      for (const emp of employees) {
        const newCode = assignCode(emp.name, usedCodes);
        const nameParts = stripTitles(emp.name);
        const primary = nameParts.length > 0 ? primaryCode(nameParts) : '?';
        const note = newCode && newCode !== primary ? ` (collision)` : '';
        if (note) collidedCount++;
        console.log(`${emp.name.padEnd(40)} ${newCode || '?'}${note}`);
        if (newCode) updates.push({ uuid: emp.uuid, code: newCode });
      }
    }

    console.log(`\nTotal to update: ${updates.length}  Collisions resolved: ${collidedCount}`);

    if (apply) {
      console.log('\nApplying...');
      for (const u of updates) {
        await pool.query(`update employee set code = $1 where uuid = $2`, [u.code, u.uuid]);
      }
      console.log('Done.');
    } else {
      console.log('\nRun with --apply to commit these changes.');
    }
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
