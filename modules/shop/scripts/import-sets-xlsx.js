#!/usr/bin/env node
/*
 * Import the school's "Books and Stationery List" workbook into the shop module
 * as a deduped catalog + one priced set per grade.
 *
 * Each sheet (one per grade) has two blocks:
 *   Books:      Subject | Book's Title | Publisher | Price(MRP)   (no discount)
 *   Stationery: Item    | Qty | Cost(MRP) | Disc.(fraction) | Price
 * Line price = qty * mrp * (1 - disc). Set price = sum of lines.
 *
 * Usage:
 *   node modules/shop/scripts/import-sets-xlsx.js --file "H:/DBPASN 25-26-1.xlsx" \
 *        --stage local --school DBPASN --session 2026-27 [--apply] [--replace]
 *
 * Default is a DRY RUN (parse + assert + print plan, no DB writes). Pass --apply
 * to write. --replace overwrites an existing set for a grade+session.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── args ──────────────────────────────────────────────────────────────────────
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = process.argv[i + 1];
    if (next && !next.startsWith('--')) { args[key] = next; i++; }
    else args[key] = true;
  }
}
const FILE = args.file;
const STAGE = args.stage || 'local';
const SCHOOL = args.school || 'DBPASN';
const SESSION = args.session || '2026-27';
const APPLY = !!args.apply;
const REPLACE = !!args.replace;

if (!FILE || !fs.existsSync(FILE)) {
  console.error(`--file is required and must exist. Got: ${FILE}`);
  process.exit(1);
}

// ── grade mapping ───────────────────────────────────────────────────────────
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
function sheetToGrade(name) {
  const n = name.trim().toUpperCase();
  const m = n.match(/^CLASS\s+(\d+)$/);
  if (m) return ROMAN[parseInt(m[1], 10) - 1] || null;
  if (n === 'NURSERY') return 'Nursery';
  if (n === 'LKG') return 'LKG';
  if (n === 'UKG') return 'UKG';
  return null;
}

// ── minimal xlsx reader (shared strings + sheets), no external deps ──────────
function readWorkbook(xlsxPath) {
  const tmp = path.join(require('os').tmpdir(), 'shop-xlsx-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  // Use PowerShell Expand-Archive on Windows; fall back to unzip.
  const zipCopy = path.join(tmp, 'wb.zip');
  fs.copyFileSync(xlsxPath, zipCopy);
  try {
    execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipCopy}' -DestinationPath '${tmp}' -Force"`, { stdio: 'ignore' });
  } catch (e) {
    execSync(`unzip -o "${zipCopy}" -d "${tmp}"`, { stdio: 'ignore' });
  }
  const read = (p) => fs.readFileSync(path.join(tmp, p), 'utf8');

  const ssXml = read('xl/sharedStrings.xml');
  const shared = [];
  {
    const re = /<si>([\s\S]*?)<\/si>/g; let m;
    while ((m = re.exec(ssXml))) {
      const texts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]);
      shared.push(decode(texts.join('')));
    }
  }
  const wb = read('xl/workbook.xml');
  const sheets = [...wb.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="(rId\d+)"/g)].map(m => ({ name: decode(m[1]), rid: m[2] }));
  const rels = read('xl/_rels/workbook.xml.rels');
  const relMap = {};
  [...rels.matchAll(/<Relationship[^>]*Id="(rId\d+)"[^>]*Target="([^"]*)"/g)].forEach(m => relMap[m[1]] = m[2]);

  const out = [];
  for (const s of sheets) {
    const target = relMap[s.rid].replace(/^\//, '').replace(/^xl\//, '');
    out.push({ name: s.name, rows: parseSheet(read('xl/' + target), shared) });
  }
  return out;
}
function decode(s) {
  return (s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, '\n').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
function colToNum(c) { let n = 0; for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
function parseSheet(xml, shared) {
  const rows = {};
  const re = /<c r="([A-Z]+)(\d+)"([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g; let m;
  while ((m = re.exec(xml))) {
    const col = colToNum(m[1]); const row = +m[2]; const attrs = m[3]; const inner = m[4] || '';
    const t = (/t="([^"]*)"/.exec(attrs) || [])[1] || 'n';
    let val = '';
    const vM = /<v>([\s\S]*?)<\/v>/.exec(inner);
    if (t === 's') { if (vM) val = shared[+vM[1]]; }
    else if (t === 'inlineStr') { const iM = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner); if (iM) val = decode(iM[1]); }
    else if (vM) val = vM[1];
    if (!rows[row]) rows[row] = {};
    rows[row][col] = val;
  }
  return rows;
}

// ── cell helpers ──────────────────────────────────────────────────────────────
const isNum = (v) => v !== '' && v != null && !isNaN(parseFloat(v)) && isFinite(v);
const num = (v) => parseFloat(v);
const txt = (v) => (v == null ? '' : String(v).trim());
const looksText = (v) => txt(v) !== '' && !isNum(v);

function findHeader(rows, predicate) {
  const nums = Object.keys(rows).map(Number).sort((a, b) => a - b);
  for (const r of nums) {
    const cells = rows[r];
    const found = predicate(cells, r);
    if (found) return { row: r, cells };
  }
  return null;
}
function colOf(cells, re) {
  for (const c of Object.keys(cells).map(Number)) if (re.test(txt(cells[c]))) return c;
  return -1;
}

// ── parse one grade sheet ─────────────────────────────────────────────────────
function parseGradeSheet(rows) {
  const rowNums = Object.keys(rows).map(Number).sort((a, b) => a - b);

  // Books header: a row containing "Subject" and a price-ish header.
  const booksHdr = findHeader(rows, (cells) => colOf(cells, /^subject$/i) >= 0 && colOf(cells, /price/i) >= 0);
  // Stationery header: a row containing "Qty" and "Cost" and "Disc".
  const statHdr = findHeader(rows, (cells) => colOf(cells, /^qty/i) >= 0 && colOf(cells, /^cost$/i) >= 0 && colOf(cells, /disc/i) >= 0);

  const books = [];
  const stationery = [];

  if (booksHdr) {
    const subjectCol = colOf(booksHdr.cells, /^subject$/i);
    const titleCol = subjectCol + 1;
    const pubCol = subjectCol + 2;
    const priceCol = subjectCol + 3;
    const end = statHdr ? statHdr.row : Infinity;
    for (const r of rowNums) {
      if (r <= booksHdr.row || r >= end) continue;
      const cells = rows[r];
      const title = txt(cells[titleCol]);
      if (!looksText(cells[titleCol])) continue;      // skip subtotals / strays
      if (!isNum(cells[priceCol])) continue;
      books.push({
        subject: txt(cells[subjectCol]) || null,
        name: title,
        publisher: txt(cells[pubCol]) || null,
        mrp: num(cells[priceCol]),
        discountPct: 0,
        quantity: 1,
      });
    }
  }

  if (statHdr) {
    const itemCol = colOf(statHdr.cells, /item/i) >= 0 ? colOf(statHdr.cells, /item/i) : (colOf(statHdr.cells, /^qty/i) - 1);
    const qtyCol = colOf(statHdr.cells, /^qty/i);
    const costCol = colOf(statHdr.cells, /^cost$/i);
    const discCol = colOf(statHdr.cells, /disc/i);
    const priceCol = colOf(statHdr.cells, /price/i);
    for (const r of rowNums) {
      if (r <= statHdr.row) continue;
      const cells = rows[r];
      if (!looksText(cells[itemCol])) continue;       // skip subtotal / grand-total rows
      if (!isNum(cells[qtyCol]) || !isNum(cells[costCol])) continue;
      const disc = isNum(cells[discCol]) ? num(cells[discCol]) : 0;
      stationery.push({
        subject: null,
        name: txt(cells[itemCol]),
        publisher: null,
        mrp: num(cells[costCol]),
        discountPct: Math.round(disc * 1000) / 10,     // 0.2 -> 20 (%)
        quantity: Math.round(num(cells[qtyCol])),
        sheetPrice: isNum(cells[priceCol]) ? num(cells[priceCol]) : null,
      });
    }
  }

  return { books, stationery };
}

const round2 = (n) => Math.round(n * 100) / 100;
function lineTotal(l) { return round2(l.quantity * l.mrp * (1 - l.discountPct / 100)); }

// ── build plan ────────────────────────────────────────────────────────────────
function buildPlan(workbook) {
  const catalog = new Map();     // lower(name) -> {name,type,subject,publisher}
  const sets = [];               // {grade, lines:[{...,type,section}]}

  for (const sheet of workbook) {
    const grade = sheetToGrade(sheet.name);
    if (!grade) { console.warn(`  ! skipping unmapped sheet "${sheet.name}"`); continue; }
    const { books, stationery } = parseGradeSheet(sheet.rows);
    const lines = [];
    for (const b of books) lines.push({ ...b, type: 'book', section: 'main' });
    for (const s of stationery) lines.push({ ...s, type: 'stationery', section: 'other' });

    for (const l of lines) {
      const key = l.name.toLowerCase();
      if (!catalog.has(key)) catalog.set(key, { name: l.name, type: l.type, subject: l.subject, publisher: l.publisher });
    }
    sets.push({ grade, sheet: sheet.name, lines });
  }
  return { catalog, sets };
}

function printPlan(plan) {
  console.log(`\n=== IMPORT PLAN (school ${SCHOOL}, session ${SESSION}, stage ${STAGE}) ===`);
  console.log(`Distinct catalog items (deduped): ${plan.catalog.size}`);
  const byType = {};
  for (const it of plan.catalog.values()) byType[it.type] = (byType[it.type] || 0) + 1;
  console.log(`  by type: ${JSON.stringify(byType)}`);
  console.log(`\nGrade sets: ${plan.sets.length}`);
  console.log('grade   | lines | books | stat | set price | (sheet price cross-check)');
  for (const s of plan.sets) {
    const nb = s.lines.filter(l => l.type === 'book').length;
    const ns = s.lines.filter(l => l.type === 'stationery').length;
    const total = round2(s.lines.reduce((a, l) => a + lineTotal(l), 0));
    // Cross-check stationery lines against the sheet's own Price column.
    let statMine = 0, statSheet = 0, mismatches = 0;
    for (const l of s.lines.filter(x => x.type === 'stationery')) {
      statMine += lineTotal(l);
      if (l.sheetPrice != null) { statSheet += l.sheetPrice; if (Math.abs(lineTotal(l) - l.sheetPrice) > 1) mismatches++; }
    }
    const flag = mismatches ? `  ⚠ ${mismatches} stationery line(s) differ from sheet` : '';
    console.log(`${(s.grade + '      ').slice(0, 7)} | ${String(s.lines.length).padStart(5)} | ${String(nb).padStart(5)} | ${String(ns).padStart(4)} | ${String(total).padStart(9)} |${flag}`);
  }
  console.log('\n(dry run — no DB writes. Pass --apply to write.)');
}

// ── apply to DB ────────────────────────────────────────────────────────────────
async function apply(plan) {
  const yaml = require('js-yaml');
  const { Pool } = require('pg');
  const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/${STAGE}/${STAGE}.yml`), 'utf8'));
  const pool = new Pool({
    host: cfg.POSTGRES_ENDPOINT || cfg.POSTGRES_HOST,
    database: cfg.POSTGRES_DATABASE,
    user: cfg.POSTGRES_USERNAME || cfg.POSTGRES_USER,
    password: cfg.POSTGRES_PASSWORD,
    port: parseInt(cfg.POSTGRES_PORT || '5432'),
    ssl: cfg.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
  const { generateShortUuid } = require('../../../shared/util/generate-uuid.js');

  const sc = await pool.query(`select uuid from school where lower(code) = lower($1)`, [SCHOOL]);
  if (sc.rows.length === 0) { console.error(`School code ${SCHOOL} not found`); process.exit(1); }
  const schoolId = sc.rows[0].uuid;
  const now = new Date();
  const USER = 'import';

  // 1) upsert catalog items, reusing existing active rows by lower(name)
  const itemIdByName = new Map();
  for (const it of plan.catalog.values()) {
    const ex = await pool.query(
      `select uuid from shop_item where lower(name) = lower($1) and school_id = $2 and status = 'active' limit 1`,
      [it.name, schoolId]
    );
    if (ex.rows.length > 0) { itemIdByName.set(it.name.toLowerCase(), ex.rows[0].uuid); continue; }
    const uuid = generateShortUuid(12);
    await pool.query(
      `insert into shop_item (uuid, school_id, name, type, subject, publisher, current_stock, status, createdby_userid, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9)`,
      [uuid, schoolId, it.name, it.type, it.subject, it.publisher, 0, USER, now]
    );
    itemIdByName.set(it.name.toLowerCase(), uuid);
  }
  console.log(`Catalog: ${itemIdByName.size} items ready.`);

  // 2) sets + set items
  let created = 0, skipped = 0;
  for (const s of plan.sets) {
    const ex = await pool.query(
      `select uuid from shop_set where school_id = $1 and grade = $2 and academic_session = $3 and status = 'active' limit 1`,
      [schoolId, s.grade, SESSION]
    );
    if (ex.rows.length > 0) {
      if (!REPLACE) { console.log(`  = set for grade ${s.grade} exists — skipping (use --replace)`); skipped++; continue; }
      const setId = ex.rows[0].uuid;
      await pool.query(`update shop_set_item set status='deleted' where set_id=$1 and status='active'`, [setId]);
      await insertLines(pool, setId, schoolId, s, itemIdByName, now, USER, generateShortUuid);
      console.log(`  ~ replaced set for grade ${s.grade}`);
      created++;
      continue;
    }
    const setId = generateShortUuid(12);
    await pool.query(
      `insert into shop_set (uuid, school_id, name, grade, academic_session, status, createdby_userid, created_at)
       values ($1,$2,$3,$4,$5,'active',$6,$7)`,
      [setId, schoolId, `Class ${s.grade} Set ${SESSION}`, s.grade, SESSION, USER, now]
    );
    await insertLines(pool, setId, schoolId, s, itemIdByName, now, USER, generateShortUuid);
    console.log(`  + created set for grade ${s.grade} (${s.lines.length} lines)`);
    created++;
  }
  console.log(`\nDone. Sets created/replaced: ${created}, skipped: ${skipped}.`);
  await pool.end();
}

async function insertLines(pool, setId, schoolId, s, itemIdByName, now, USER, genUuid) {
  let sort = 0;
  for (const l of s.lines) {
    const itemId = itemIdByName.get(l.name.toLowerCase());
    await pool.query(
      `insert into shop_set_item (uuid, set_id, school_id, item_id, section, quantity, mrp, discount_pct, sort_order, status, createdby_userid, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11)`,
      [genUuid(12), setId, schoolId, itemId, l.section, l.quantity, l.mrp, l.discountPct, sort++, USER, now]
    );
  }
}

// ── main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Reading ${FILE} ...`);
  const workbook = readWorkbook(FILE);
  console.log(`Sheets: ${workbook.map(s => s.name).join(', ')}`);
  const plan = buildPlan(workbook);
  printPlan(plan);
  if (APPLY) {
    console.log('\n--apply set: writing to DB...');
    await apply(plan);
  }
})().catch(e => { console.error(e); process.exit(1); });
