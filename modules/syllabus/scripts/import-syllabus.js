/**
 * Syllabus .docx importer
 * ------------------------
 * Parses a Dr. B. P. Agrawal Shiksha Niketan "General Knowledge" syllabus Word
 * document (the month-wise table) and seeds it as a syllabus plan via the API:
 * ensures the subject, upserts the (year, grade, subject) plan, and bulk-loads
 * its month-wise entries. Handles both layouts:
 *   - junior (Classes I–V): single table  Month | Topics | Themes | Pages
 *   - senior (Classes VI–VIII): two-column Month | Chapters | Pages  (x2),
 *     with "Topic:" umbrella section headers and #Info-scoop / #Q&A / #Out-of-…
 *     rows.
 * Grade, subject name and layout are auto-detected from the document; override
 * with flags if needed.
 *
 * Dependency-free: reads the .docx (a zip) with the built-in `zlib` — no
 * external packages, so it keeps working regardless of node_modules churn.
 *
 * Usage:
 *   node modules/syllabus/scripts/import-syllabus.js --file "Class III- GK.docx" --school SS1 --stage local
 *   node modules/syllabus/scripts/import-syllabus.js --dir ./docs --school dbpasn --stage prod
 *   node modules/syllabus/scripts/import-syllabus.js --file X.docx --school SS1 --dry-run   # parse & print only
 *
 * Flags:
 *   --file <path>            a single .docx (or --dir for a folder of them)
 *   --dir <path>             import every *.docx in the folder
 *   --school <code>          X-School-Code (required for a real import)
 *   --stage <local|prod>     picks the base URL (local→:3000, prod→api-prod). Default local.
 *   --base-url <url>         explicit API base URL (overrides --stage)
 *   --subject <name>         override subject (else read "Syllabus: <name>" from the doc)
 *   --grade <G>              override grade (else read "Class <G>" from the doc)
 *   --academic-year-id <id>  target year (else the school's current year)
 *   --mode append|replace    entry write mode (default replace)
 *   --dry-run                parse and print; do not call the API
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── Minimal zip reader (enough to pull word/document.xml out of a .docx) ──────
function readZipEntry(buf, entryName) {
  // Locate the End Of Central Directory record, then walk the central directory.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip/.docx (no EOCD)');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('Bad central dir entry');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    if (name === entryName) {
      // Jump to the local header to find the actual data offset.
      if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('Bad local header');
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(dataStart, dataStart + compSize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`Entry not found: ${entryName}`);
}

// ── XML helpers ──────────────────────────────────────────────────────────────
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
}
// Text of a <w:tc> cell: concat every <w:t> run (tabs → space), collapse spaces.
function cellText(tcXml) {
  const runs = tcXml.match(/<w:t[ >][\s\S]*?<\/w:t>/g) || [];
  let out = runs.map((r) => decodeEntities(r.replace(/<[^>]+>/g, ''))).join('');
  out = out.replace(/<w:tab\b[^>]*\/>/g, ' ');
  return out.replace(/\s+/g, ' ').trim();
}
function rowsOf(xml) {
  return (xml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || []).map((tr) =>
    (tr.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || []).map(cellText),
  );
}
function plainText(xml) {
  return decodeEntities(xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ');
}

// ── Month + entry classification ─────────────────────────────────────────────
const MONTHS = ['april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'january', 'february', 'march'];
const MONTH_ALIASES = { apr: 'april', jun: 'june', jul: 'july', aug: 'august', sep: 'september', sept: 'september', oct: 'october', nov: 'november', dec: 'december', jan: 'january', feb: 'february', mar: 'march' };
function normMonth(text) {
  if (!text) return null;
  const t = text.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (MONTHS.includes(t)) return t;
  if (MONTH_ALIASES[t]) return MONTH_ALIASES[t];
  for (const m of MONTHS) if (t.startsWith(m.slice(0, 3)) && (t === m.slice(0, 3) || m.startsWith(t))) return m;
  return null;
}
const HEADER_WORDS = new Set(['month', 'months', 'topics', 'topic', 'themes', 'theme', 'pages', 'chapters', 'chapter']);
function isHeaderCell(t) { return HEADER_WORDS.has((t || '').trim().toLowerCase()); }

// Turn a topic/chapter cell into an entry {entryType, topicNo, title} or null.
function classify(raw) {
  const t = (raw || '').trim();
  if (!t || /^-+$/.test(t)) return null;
  let m;
  if ((m = t.match(/^Topic:\s*(.+)$/i))) return { entryType: 'section', topicNo: null, title: m[1].trim() };
  if ((m = t.match(/^#\s*(.+)$/))) return { entryType: 'note', topicNo: null, title: m[1].replace(/^[A-Za-z-]+:\s*/, (s) => s).trim() };
  if ((m = t.match(/^(T\s*-?\s*\d+)\s*\.?\s*(.*)$/i))) {
    const topicNo = m[1].replace(/\s+/g, '').toUpperCase();
    const title = m[2].trim();
    return title ? { entryType: 'topic', topicNo, title } : null;
  }
  if (/revision/i.test(t)) return { entryType: 'revision', topicNo: null, title: t };
  if (/olympiad|quiz-?e-?thon|activity/i.test(t)) return { entryType: 'activity', topicNo: null, title: t };
  if (/refresher/i.test(t)) return { entryType: 'refresher', topicNo: null, title: t };
  if (/exam/i.test(t)) return { entryType: 'exam', topicNo: null, title: t };
  return null; // headers / stray text
}
const clean = (s) => { const v = (s || '').trim(); return !v || /^-+$/.test(v) ? null : v; };

// ── Document → plan ──────────────────────────────────────────────────────────
function parseDoc(docxPath) {
  const xml = readZipEntry(fs.readFileSync(docxPath), 'word/document.xml').toString('utf8');
  const text = plainText(xml);

  const subject = (text.match(/Syllabus:\s*([^\n]+)/i) || [])[1]?.trim() || 'General Knowledge';
  const grade = (text.match(/Class\s+([A-Za-z0-9]+)/i) || [])[1]?.trim() || null;
  const note = (text.match(/Note\s*:?\s*-?\s*([^\n]+)/i) || [])[1]?.trim() || null;

  const rows = rowsOf(xml).filter((cells) => cells.length && !cells.every((c) => !c));
  const isSenior = rows.some((cells) => cells.some((c) => /^chapters$/i.test(c.trim())));
  const layout = isSenior ? 'senior' : 'junior';

  const entries = [];
  if (isSenior) {
    // Two logical columns: read the left stream (Apr–Aug) fully, then the right
    // (Sep–Mar). Each row: [m1, chapter1, pages1, m2, chapter2, pages2].
    const left = [];
    const right = [];
    let lm = null;
    let rm = null;
    for (const cells of rows) {
      if (cells.some(isHeaderCell)) continue;
      const m1 = normMonth(cells[0]); if (m1) lm = m1;
      const m2 = normMonth(cells[3]); if (m2) rm = m2;
      if (clean(cells[1])) left.push({ month: lm, text: cells[1], pages: cells[2] });
      if (clean(cells[4])) right.push({ month: rm, text: cells[4], pages: cells[5] });
    }
    for (const it of [...left, ...right]) {
      const e = classify(it.text);
      if (!e || !it.month) continue;
      entries.push({ ...e, month: it.month, theme: null, pageRef: clean(it.pages) });
    }
  } else {
    // Junior single column: [month?, topic, theme, pages]. Month carries forward.
    let cur = null;
    for (const cells of rows) {
      if (cells.some(isHeaderCell)) continue;
      const m = normMonth(cells[0]); if (m) cur = m;
      const topicCell = cells.length >= 2 ? cells[1] : cells[0];
      const e = classify(topicCell);
      if (!e || !cur) continue;
      entries.push({
        ...e, month: cur,
        theme: e.entryType === 'topic' ? clean(cells[2]) : null,
        pageRef: clean(cells[3]),
      });
    }
  }
  return { subject, grade, note, layout, entries };
}

// ── API seeding ──────────────────────────────────────────────────────────────
function baseUrlFor(stage, override) {
  if (override) return override.replace(/\/$/, '');
  return stage === 'prod' ? 'https://api-prod.itsmyskool.com'
    : stage === 'dev' ? 'https://api-dev.itsmyskool.com'
      : 'http://localhost:3000';
}
async function seed(plan, { baseUrl, school, mode, academicYearId, gradeOverride, subjectOverride, authHeaders }) {
  const H = { 'Content-Type': 'application/json', 'X-School-Code': school, ...(authHeaders || {}) };
  const j = async (res) => { const t = await res.text(); let b; try { b = JSON.parse(t); } catch { b = t; } if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(b)}`); return b; };
  const get = (p) => fetch(`${baseUrl}${p}`, { headers: H }).then(j);
  const post = (p, body) => fetch(`${baseUrl}${p}`, { method: 'POST', headers: H, body: JSON.stringify(body) }).then(j);

  const grade = gradeOverride || plan.grade;
  const subjectName = subjectOverride || plan.subject;
  if (!grade) throw new Error('Could not determine grade (pass --grade)');

  let yearId = academicYearId;
  if (!yearId) {
    const years = await get('/academic-years/search');
    const list = Array.isArray(years) ? years : years.academicYears || [];
    const y = list.find((x) => x.isCurrent) || list[0];
    if (!y) throw new Error('No academic year for this school');
    yearId = y.uuid;
    console.log(`   year: ${y.name}`);
  }

  const subjects = await get('/syllabus/subjects');
  let subject = (subjects || []).find((s) => s.name.toLowerCase() === subjectName.toLowerCase());
  if (!subject) subject = await post('/syllabus/subjects', { name: subjectName });

  const existing = await get(`/syllabus/syllabi?academicYearId=${yearId}&grade=${encodeURIComponent(grade)}&subjectId=${subject.uuid}`);
  let syllabus = (existing || [])[0];
  if (!syllabus) {
    syllabus = await post('/syllabus/syllabi', {
      academicYearId: yearId, grade, subjectId: subject.uuid, layout: plan.layout, note: plan.note || undefined,
    });
  }
  const result = await post(`/syllabus/syllabi/${syllabus.uuid}/entries/bulk`, { mode, entries: plan.entries });
  return { syllabusId: syllabus.uuid, grade, subject: subjectName, count: result.length };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { stage: 'local', mode: 'replace' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a.startsWith('--')) { o[a.slice(2)] = argv[i + 1]; i++; }
  }
  return o;
}
function summarize(plan, file) {
  const by = {};
  for (const e of plan.entries) by[e.entryType] = (by[e.entryType] || 0) + 1;
  console.log(`\n${path.basename(file)}  →  Class ${plan.grade || '?'} · ${plan.subject} · ${plan.layout}`);
  console.log(`   ${plan.entries.length} entries (${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(', ')})`);
}
function printEntries(plan) {
  for (const e of plan.entries) {
    const no = e.topicNo ? e.topicNo.padEnd(6) : '      ';
    console.log(`   ${String(e.month).slice(0, 3)} ${e.entryType.padEnd(9)} ${no} ${e.title}${e.theme ? `  ·  ${e.theme}` : ''}${e.pageRef ? `  (p.${e.pageRef})` : ''}`);
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const files = [];
  if (o.file) files.push(o.file);
  if (o.dir) for (const f of fs.readdirSync(o.dir)) if (/\.docx$/i.test(f)) files.push(path.join(o.dir, f));
  if (files.length === 0) { console.error('Provide --file <doc.docx> or --dir <folder>'); process.exit(1); }

  const baseUrl = baseUrlFor(o.stage, o['base-url']);
  const { serviceAuthHeaders } = require(path.join(__dirname, '..', '..', '..', 'scripts', 'service-auth.js'));
  const authHeaders = serviceAuthHeaders(o.stage, 'import-syllabus');
  if (!o.dryRun && !o.school) { console.error('--school <code> is required (or use --dry-run)'); process.exit(1); }
  if (!o.dryRun) console.log(`Target: ${baseUrl}  (school ${o.school}, mode ${o.mode})`);

  for (const file of files) {
    try {
      const plan = parseDoc(file);
      summarize(plan, file);
      if (o.dryRun) { printEntries(plan); continue; }
      const r = await seed(plan, {
        baseUrl, school: o.school, mode: o.mode, authHeaders,
        academicYearId: o['academic-year-id'], gradeOverride: o.grade, subjectOverride: o.subject,
      });
      console.log(`   ✓ seeded plan ${r.syllabusId} — ${r.count} entries`);
    } catch (err) {
      console.error(`   ✗ ${path.basename(file)}: ${err.message}`);
    }
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { parseDoc };
