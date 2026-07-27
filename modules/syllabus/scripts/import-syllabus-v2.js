/**
 * Syllabus .docx importer v2 — node-tree model (Phase 2)
 * ------------------------------------------------------
 * Parses the school's wide syllabus tables into a chapter->item tree and seeds
 * the plan directly in the DB (subject, plan + component_layout + source_file_id,
 * and the entry tree). Coverage stays on leaves; a chapter rolls up.
 *
 * Layouts handled:
 *   - wide      : Month | Chapter | Pages | <subject-specific component columns>
 *                 chapter node + one item per non-empty component cell; Unit/Theme
 *                 headers -> unit nodes; Revision/Test/Exam -> structural leaves.
 *   - gk        : Month | Topics | Themes | Pages (junior) OR the senior two-column
 *                 (Month|Chapters|Pages x2). Flat leaf topics (+ Topic: sections).
 *   - reasoning : Verbal | Pages | Non-Verbal | Pages | Quantitative | Pages
 *                 three parallel track units, each with leaf chapters.
 * Devanagari (Hindi/Vyakaran) = wide layout with Hindi month names.
 *
 * Usage:
 *   node import-syllabus-v2.js --dir "H:/syllabus" --grade VIII --stage local --school-code DBPASN --academic-session 2026-27
 *   node import-syllabus-v2.js --dir "H:/syllabus" --grade VIII --dry-run     # parse + print, no writes
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Pool } = require('pg');
const { generateShortUuid } = require('../../../shared/util/generate-uuid.js');

// ── args ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { stage: 'local', session: '2026-27', schoolCode: 'DBPASN' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--dir') o.dir = argv[++i];
    else if (a === '--file') o.file = argv[++i];
    else if (a === '--grade') o.grade = argv[++i];
    else if (a === '--stage') o.stage = argv[++i];
    else if (a === '--school-code') o.schoolCode = argv[++i];
    else if (a === '--academic-session') o.session = argv[++i];
    else if (a === '--limit') o.limit = parseInt(argv[++i], 10);
  }
  return o;
}
function loadConfig(stage) {
  const cfg = fs.readFileSync(path.join(__dirname, `../../../configs/${stage}/${stage}.yml`), 'utf8');
  const env = {};
  for (const l of cfg.split('\n')) { const m = l.match(/^(\w+):\s*['"]?([^'"]*?)['"]?\s*$/); if (m) env[m[1]] = m[2]; }
  return env;
}

// ── .docx (zip) reading ───────────────────────────────────────────────────────
function readZipEntry(buf, entryName) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a .docx (no EOCD)');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(off + 10), compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28), extraLen = buf.readUInt16LE(off + 30), commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    if (name === entryName) {
      const lNameLen = buf.readUInt16LE(localOff + 26), lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(dataStart, dataStart + compSize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`Entry not found: ${entryName}`);
}
function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
}
// Each cell -> an array of PARAGRAPH texts (one per <w:p> = one line the author
// typed). Component cells pack several activities as separate paragraphs, so this
// lets us make one item per line. Non-item cells just join the paragraphs.
function cellParas(tc) {
  const paras = tc.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [tc];
  return paras
    .map((p) => {
      const runs = p.match(/<w:t[ >][\s\S]*?<\/w:t>/g) || [];
      return decodeEntities(runs.map((r) => r.replace(/<[^>]+>/g, '')).join('')).replace(/\s+/g, ' ').trim();
    })
    .filter((x) => x);
}
const joinCell = (cell) => (cell || []).join(' ').replace(/\s+/g, ' ').trim();
function tableRows(xml) {
  return (xml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || []).map((tr) => (tr.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || []).map(cellParas));
}
function plainText(xml) {
  return decodeEntities(xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ');
}

// ── months (English + Devanagari) ─────────────────────────────────────────────
const MONTHS = ['april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'january', 'february', 'march'];
const HINDI_MONTH = { 'अप्रैल': 'april', 'मई': 'may', 'जून': 'june', 'जुलाई': 'july', 'अगस्त': 'august', 'सितंबर': 'september', 'सितम्बर': 'september', 'अक्टूबर': 'october', 'अक्तूबर': 'october', 'नवंबर': 'november', 'नवम्बर': 'november', 'दिसंबर': 'december', 'दिसम्बर': 'december', 'जनवरी': 'january', 'फरवरी': 'february', 'मार्च': 'march' };
function normMonth(text) {
  if (!text) return null;
  const raw = text.trim();
  if (HINDI_MONTH[raw]) return HINDI_MONTH[raw];
  const t = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (!t) return null;
  for (const m of MONTHS) if (t === m || t === m.slice(0, 3) || (t.length >= 3 && m.startsWith(t))) return m;
  return null;
}
const isBlank = (s) => !s || /^[-–—\s]+$/.test(s.trim());
const extractPage = (s) => { const m = (s || '').match(/P\.?\s*([0-9][0-9\-–,\/\s]*)/i); return m ? m[1].replace(/[–]/g, '-').replace(/\s+/g, '').slice(0, 32) : null; };
const RX_STRUCT = /revision|periodic|assessment|examination|half\s*yearly|annual\s*exam|\bexam\b|\btest\b|olympiad|refresher|पुनरावृत्ति|परीक्षा/i;
const RX_UNIT = /^(unit|theme|topic)\b.*[:：]/i;
const RX_CONT = /continue|continued|\.\.\.$|…$/i;
const structType = (s) => (/exam|examination|test|assessment|periodic|olympiad|परीक्षा/i.test(s) ? 'exam' : /refresher/i.test(s) ? 'refresher' : 'revision');

// ── parse a doc into { subject, grade, layoutType, components, nodes } ─────────
function parseDoc(file) {
  const xml = readZipEntry(fs.readFileSync(file), 'word/document.xml').toString('utf8');
  const text = plainText(xml);
  const base = path.basename(file).replace(/\.docx$/i, '');
  // Subject: "Syllabus: <name>" else from filename after "Class X-"
  let subject = (text.match(/Syllabus:\s*([^\n]+)/i) || [])[1]?.trim();
  if (!subject) subject = base.replace(/^Class\s+[A-Za-z0-9]+\s*[-–]\s*/i, '').replace(/\s*\(\d+\)\s*$/, '').trim();
  subject = subject.replace(/\s+/g, ' ');
  const grade = (text.match(/Class\s+([A-Za-z0-9]+)/i) || [])[1]?.trim() || null;

  const rows = tableRows(xml).filter((c) => c.length && !c.every((cell) => isBlank(joinCell(cell))));
  const hi = rows.findIndex((c) => c.some((x) => /^(month|months|मास)$/i.test(joinCell(x))));
  const hdr = hi >= 0 ? rows[hi] : (rows[1] || rows[0] || []);
  const H = hdr.map((h) => joinCell(h).toLowerCase());

  const isGk = H.some((h) => /^topics?$/.test(h)) || (H[1] && /^chapters?$/.test(H[1]) && H.length >= 6 && /^(month|months)$/.test(H[3] || ''));
  const isReasoning = H.some((h) => /verbal aptitude|verbal\b/.test(h)) && H.some((h) => /quantitative|non-?verbal/.test(h));

  const nodes = [];
  let seq = 0;
  const add = (n) => { nodes.push({ tmp: nodes.length + 1, seq: seq++, ...n }); return nodes[nodes.length - 1].tmp; };

  if (isReasoning) {
    // 3 parallel tracks: [1,2] Verbal, [3,4] Non-Verbal, [5,6] Quantitative.
    const tracks = [{ ci: 1, pi: 2, name: joinCell(hdr[1]) || 'Verbal' }, { ci: 3, pi: 4, name: joinCell(hdr[3]) || 'Non-Verbal' }, { ci: 5, pi: 6, name: joinCell(hdr[5]) || 'Quantitative' }];
    const unitTmp = {};
    for (const t of tracks) unitTmp[t.ci] = add({ parent: null, type: 'unit', month: null, heading: t.name, pageRef: null });
    let curMonth = null;
    for (let r = hi + 1; r < rows.length; r++) {
      const c = rows[r];
      const m = normMonth(joinCell(c[0])); if (m) curMonth = m;
      for (const t of tracks) {
        const ch = joinCell(c[t.ci]);
        if (isBlank(ch)) continue;
        if (RX_STRUCT.test(ch)) { add({ parent: unitTmp[t.ci], type: structType(ch), month: curMonth, heading: ch, pageRef: extractPage(ch) || joinCell(c[t.pi]) || null }); continue; }
        add({ parent: unitTmp[t.ci], type: 'topic', month: curMonth, heading: ch, pageRef: joinCell(c[t.pi]) || null });
      }
    }
    return { file, subject, grade, layoutType: 'reasoning', components: [], nodes };
  }

  if (isGk) {
    const twoCol = H.length >= 6 && /^(month|months)$/.test(H[3] || '');
    const blocks = twoCol ? [{ mi: 0, ti: 1, pi: 2, th: null }, { mi: 3, ti: 4, pi: 5, th: null }]
      : [{ mi: 0, ti: 1, th: 2, pi: 3 }];
    for (const b of blocks) {
      let curMonth = null, curSection = null;
      for (let r = hi + 1; r < rows.length; r++) {
        const c = rows[r];
        const m = normMonth(joinCell(c[b.mi])); if (m) curMonth = m;
        const t = joinCell(c[b.ti]);
        if (isBlank(t)) continue;
        if (/^topic\s*[:：]/i.test(t)) { curSection = add({ parent: null, type: 'section', month: curMonth, heading: t.replace(/^topic\s*[:：]\s*/i, ''), pageRef: null }); continue; }
        if (RX_STRUCT.test(t) && !/^T\s*-?\s*\d/i.test(t)) { add({ parent: curSection, type: structType(t), month: curMonth, heading: t, pageRef: joinCell(c[b.pi]) || null }); continue; }
        add({ parent: curSection, type: 'topic', month: curMonth, heading: t, theme: b.th != null ? (joinCell(c[b.th]) || null) : null, pageRef: joinCell(c[b.pi]) || null });
      }
    }
    return { file, subject, grade, layoutType: 'gk', components: [], nodes };
  }

  // ── wide chapter layout ──
  const pagesIdx = H.findIndex((h, i) => i >= 1 && /(^pages?$|पृष्ठ|page)/.test(h));
  const chapterIdx = 1;
  const compIdx = [];
  for (let k = 0; k < hdr.length; k++) {
    if (k === 0 || k === chapterIdx || k === pagesIdx) continue;
    const label = joinCell(hdr[k]);
    if (label) compIdx.push({ k, label });
  }
  const components = compIdx.map((c) => ({ key: c.label.toLowerCase().replace(/\s+/g, '_').slice(0, 48), label: c.label }));

  let curMonth = null, curUnit = null, curChapter = null;
  for (let r = hi + 1; r < rows.length; r++) {
    const c = rows[r];
    const m = normMonth(joinCell(c[0])); if (m) curMonth = m;
    const c1 = joinCell(c[chapterIdx]);
    const pages = pagesIdx >= 0 ? (joinCell(c[pagesIdx]) || null) : null;

    if (!isBlank(c1)) {
      if (RX_UNIT.test(c1)) { curUnit = add({ parent: null, type: 'unit', month: curMonth, heading: c1, pageRef: null }); curChapter = null; continue; }
      if (RX_STRUCT.test(c1) && !/^(ch|chapter|पाठ|अध्याय)\s*-?\s*\d/i.test(c1)) { add({ parent: curUnit, type: structType(c1), month: curMonth, heading: c1, pageRef: pages }); continue; }
      if (!RX_CONT.test(c1) || !curChapter) { curChapter = add({ parent: curUnit, type: 'chapter', month: curMonth, heading: c1, pageRef: pages }); }
    }
    // items = each non-empty PARAGRAPH of each component cell = one tickable item.
    // Merge a continuation paragraph (a bare page ref, or a line starting with "("
    // or lowercase — a wrapped tail) into the previous item rather than splitting it.
    if (curChapter) {
      for (const comp of compIdx) {
        const paras = c[comp.k] || [];
        let lastTmp = null;
        for (const para of paras) {
          if (isBlank(para)) continue;
          const cont = lastTmp != null && (/^\(/.test(para) || /^[a-z]/.test(para) || /^\(?\s*p\.?\s*[\d][\d\-–\/,\s]*\)?\s*$/i.test(para));
          if (cont) {
            const node = nodes.find((n) => n.tmp === lastTmp);
            node.heading = `${node.heading} ${para}`.slice(0, 4000);
            if (!node.pageRef) node.pageRef = extractPage(para);
            continue;
          }
          // Item page is its OWN page ref (e.g. "(P.4)") or none — never the chapter's range.
          lastTmp = add({ parent: curChapter, type: 'item', component: comp.label, month: curMonth, heading: para, pageRef: extractPage(para) });
        }
      }
    }
  }
  return { file, subject, grade, layoutType: 'wide', components, nodes };
}

// ── reporting ─────────────────────────────────────────────────────────────────
function summarize(p) {
  const by = {};
  for (const n of p.nodes) by[n.type] = (by[n.type] || 0) + 1;
  console.log(`\n## ${path.basename(p.file)}  →  Class ${p.grade} · ${p.subject} · [${p.layoutType}]`);
  console.log(`   layout: ${p.components.length ? p.components.map((c) => c.label).join(' | ') : '(none)'}`);
  console.log(`   nodes: ${p.nodes.length}  (${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(', ')})`);
  const firstChap = p.nodes.find((n) => n.type === 'chapter');
  if (firstChap) {
    console.log(`   e.g. ${firstChap.heading}${firstChap.pageRef ? ` (p.${firstChap.pageRef})` : ''}`);
    for (const it of p.nodes.filter((n) => n.parent === firstChap.tmp).slice(0, 6)) console.log(`        • [${it.component}] ${it.heading.slice(0, 50)}`);
  } else {
    for (const it of p.nodes.filter((n) => n.type === 'topic').slice(0, 4)) console.log(`   • ${it.heading.slice(0, 44)}${it.theme ? ` · ${it.theme}` : ''}${it.pageRef ? ` (p.${it.pageRef})` : ''}`);
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const files = [];
  if (o.file) files.push(o.file);
  if (o.dir) for (const f of fs.readdirSync(o.dir)) {
    if (!/\.docx$/i.test(f)) continue;
    if (o.grade && !new RegExp(`^Class ${o.grade}[-\\s]`, 'i').test(f)) continue;
    files.push(path.join(o.dir, f));
  }
  if (!files.length) { console.error('No matching .docx (need --file or --dir [+ --grade])'); process.exit(1); }
  if (o.limit) files.length = Math.min(files.length, o.limit);

  const plans = [];
  for (const f of files) {
    try { const p = parseDoc(f); plans.push(p); summarize(p); }
    catch (e) { console.error(`  ✗ ${path.basename(f)}: ${e.message}`); }
  }

  if (o.dryRun) { console.log(`\nDRY-RUN — parsed ${plans.length} docs, nothing written.`); return; }
  await persist(o, plans);
}

// ── DB persist (direct, like the other data-sync scripts) ─────────────────────
async function persist(o, plans) {
  const env = loadConfig(o.stage);
  const pool = new Pool({
    host: env.POSTGRES_ENDPOINT || env.POSTGRES_HOST, database: env.POSTGRES_DATABASE,
    user: env.POSTGRES_USERNAME || env.POSTGRES_USER, password: env.POSTGRES_PASSWORD,
    port: parseInt(env.POSTGRES_PORT || '5432', 10),
    ssl: env.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false }, max: 3,
  });
  const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
  try {
    const sid = (await q('select uuid from school where lower(code)=lower($1)', [o.schoolCode]))[0].uuid;
    const ay = (await q('select uuid from academic_year where school_id=$1 and lower(code)=lower($2)', [sid, o.session]))[0];
    if (!ay) throw new Error(`academic year ${o.session} not found`);
    const now = new Date();
    let planCount = 0, nodeCount = 0;

    for (const p of plans) {
      if (!p.grade) { console.error(`  ✗ ${path.basename(p.file)}: no grade`); continue; }
      // subject — grade-scoped (one "Computer" per grade)
      let subj = (await q("select uuid from syllabus_subject where school_id=$1 and coalesce(lower(grade),'')=lower($3) and lower(name)=lower($2) and status='active'", [sid, p.subject, p.grade]))[0];
      if (!subj) { const u = generateShortUuid(12); await q("insert into syllabus_subject (uuid,school_id,grade,name,status,createdby_userid,created_at) values ($1,$2,$3,$4,'active','0',$5)", [u, sid, p.grade, p.subject, now]); subj = { uuid: u }; }

      const layout = p.layoutType === 'wide' ? 'senior' : (p.layoutType === 'gk' ? (p.components.length ? 'senior' : 'junior') : 'senior');
      const compLayout = JSON.stringify(p.components);
      // plan (year, grade, subject) — common (no stream)
      let plan = (await q("select uuid from syllabus where school_id=$1 and academic_year_id=$2 and lower(grade)=lower($3) and coalesce(lower(stream_code),'')='' and subject_id=$4 and status='active'", [sid, ay.uuid, p.grade, subj.uuid]))[0];
      if (!plan) { const u = generateShortUuid(12); await q("insert into syllabus (uuid,school_id,academic_year_id,grade,subject_id,layout,component_layout,status,createdby_userid,created_at) values ($1,$2,$3,$4,$5,$6,$7,'active','0',$8)", [u, sid, ay.uuid, p.grade, subj.uuid, layout, compLayout, now]); plan = { uuid: u }; }
      else { await q('update syllabus set component_layout=$1, layout=$2, updatedby_userid=$3, updated_at=$4 where uuid=$5', [compLayout, layout, '0', now, plan.uuid]); }

      // store source .docx in file_storage (postgres blob locally; S3 in prod via FILE_STORAGE_BUCKET)
      const bytes = fs.readFileSync(p.file);
      const fileUuid = generateShortUuid(12);
      const bucket = env.FILE_STORAGE_BUCKET;
      if (bucket) {
        const S3 = require('@aws-sdk/client-s3'); const s3 = new S3.S3Client({ region: env.AWS_REGION || 'ap-south-1' });
        const key = `${sid}/syllabus_source/${plan.uuid}/original/${fileUuid}.docx`;
        await s3.send(new S3.PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
        await q("insert into file_storage (uuid,file_name,mime_type,size_bytes,data,storage_key,entity_type,entity_id,variant,school_id,createdby_userid,created_at) values ($1,$2,$3,$4,null,$5,'syllabus_source',$6,'original',$7,'0',$8)", [fileUuid, path.basename(p.file), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes.length, key, plan.uuid, sid, now]);
      } else {
        await q("insert into file_storage (uuid,file_name,mime_type,size_bytes,data,entity_type,entity_id,variant,school_id,createdby_userid,created_at) values ($1,$2,$3,$4,$5,'syllabus_source',$6,'original',$7,'0',$8)", [fileUuid, path.basename(p.file), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes.length, bytes.toString('base64'), plan.uuid, sid, now]);
      }
      await q('update syllabus set source_file_id=$1 where uuid=$2', [fileUuid, plan.uuid]);

      // rebuild entries: delete old (+ progress), insert tree with parent links
      await q('delete from syllabus_progress where syllabus_entry_id in (select uuid from syllabus_entry where syllabus_id=$1)', [plan.uuid]);
      await q('delete from syllabus_entry where syllabus_id=$1', [plan.uuid]);
      const uuidOf = {};
      for (const n of p.nodes) uuidOf[n.tmp] = generateShortUuid(12);
      for (const n of p.nodes) {
        await q(`insert into syllabus_entry (uuid,school_id,syllabus_id,parent_entry_id,seq,month,entry_type,component,title,theme,page_ref,status,createdby_userid,created_at)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active','0',$12)`,
          [uuidOf[n.tmp], sid, plan.uuid, n.parent ? uuidOf[n.parent] : null, n.seq, n.month || 'april', n.type, n.component ? String(n.component).slice(0, 64) : null, (n.heading || '').slice(0, 4000), n.theme ? String(n.theme).slice(0, 128) : null, n.pageRef ? String(n.pageRef).slice(0, 32) : null, now]);
        nodeCount++;
      }
      planCount++;
      console.log(`  ✓ ${p.grade} · ${p.subject} — ${p.nodes.length} nodes`);
    }
    console.log(`\nDone: ${planCount} plans, ${nodeCount} nodes.`);
  } finally { await pool.end(); }
}

if (require.main === module) main().catch((e) => { console.error('FATAL', e.stack || e.message); process.exit(1); });
module.exports = { parseDoc };
