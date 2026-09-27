/**
 * Spoken English & Life Communication (SELC) .docx parser — CommonJS so it is
 * shared verbatim by the module (source re-upload endpoint) AND the CLI importer.
 *
 * The 15 class-module documents are highly regular prose:
 *   - a preamble (motto, philosophy, "Programme Focus", weekly pattern),
 *   - "MONTHLY UNITS — APRIL TO FEBRUARY",
 *   - one section per month:  "APRIL — <theme>"  then numbered fields
 *     "1. Theme" .. "15. Assessment / Observation", each field's content being
 *     everything under its heading; the "Focus Skills" bullets sit inside field 15,
 *   - trailing all-caps sections ("CLASS I — YEAR-END COMMUNICATION PROFILE", …).
 *
 * Output shape (per file = one grade's whole year):
 *   { detectedGrade, programmeFocus, months: [ { month, title, fields:{F01..F15}, focusSkills:[] } ] }
 * The number of a field heading (1..15) maps to code F01..F15 by POSITION, so a
 * varied heading title ("Story / Narration") still lands in the right slot.
 */
const zlib = require("zlib");

// ── .docx (zip) reading — same minimal reader as syllabus-parse.ts ─────────────
function readZipEntry(buf, entryName) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("Not a .docx (no EOCD)");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    if (name === entryName) {
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

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(+d));
}

// document.xml -> array of paragraph strings (one per <w:p>), tabs/breaks kept.
function extractDocxText(buf) {
  const xml = readZipEntry(buf, "word/document.xml").toString("utf8");
  return (xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []).map((p) => {
    const t = p.replace(/<w:tab\/?>/g, " ").replace(/<w:br\/?>/g, "\n");
    const runs = t.match(/<w:t[ >][\s\S]*?<\/w:t>/g) || [];
    return decodeEntities(runs.map((r) => r.replace(/<[^>]+>/g, "")).join(""))
      .replace(/ /g, " ")
      .replace(/[ \t]+/g, " ");
  });
}

const MONTHS = [
  "april", "may", "june", "july", "august", "september",
  "october", "november", "december", "january", "february", "march",
];
// Optional leading list number ("2. APRIL — …" in some class modules) then the
// month name, then an optional "— <theme>" tail.
const MONTH_RX = new RegExp(
  "^(?:\\d{1,2}[.)]\\s*)?(" + MONTHS.join("|") + ")\\b\\s*(?:[—–\\-]\\s*(.+))?$",
  "i",
);
const FIELD_RX = /^(\d{1,2})\.\s+(.+)$/;
const END_KW =
  /(YEAR-?END|WEEKLY IMPLEMENTATION|TEACHER ROLE|OBSERVATION-BASED|ERP IMPLEMENTATION|DEVELOPMENTAL POSITION|COMMUNICATION PROFILE|FINAL DEVELOPMENTAL)/;

function fieldCode(n) {
  return "F" + String(n).padStart(2, "0");
}
// Some class modules keep the whole model conversation in one paragraph, so the
// A:/B:/Teacher:/… turns run together. Put each speaker turn on its own line by
// breaking after sentence punctuation immediately followed by a speaker label.
const SPEAKER =
  "A|B|C|Teacher|Child|Student|Parent|Mother|Father|Doctor|Nurse|Customer|Shopkeeper|Interviewer|Friend|Boy|Girl|Man|Woman|Speaker \\d";
function splitDialogue(text) {
  if (!text) return text;
  return text
    .replace(new RegExp("([.?!”\"’'])\\s*(?=(?:" + SPEAKER + ")\\s*:)", "g"), "$1\n")
    .trim();
}
// An all-caps trailing section header (ends the monthly region). Uppercasing it
// leaves it unchanged (so "Teacher role:" inside field text does NOT trigger).
function isEndHeader(p) {
  return /[A-Z]/.test(p) && p === p.toUpperCase() && END_KW.test(p);
}

// Parse the paragraph list of one class module into months.
function parseClassModule(paras) {
  let programmeFocus = null;
  let detectedGrade = null;
  for (let i = 0; i < paras.length; i++) {
    const p = (paras[i] || "").trim();
    if (!programmeFocus && /^Programme Focus$/i.test(p) && paras[i + 1])
      programmeFocus = paras[i + 1].trim();
    if (!detectedGrade) {
      const m = p.match(/^Class\s+([A-Za-z]+)\s*$/i) || p.match(/^(Nursery|LKG|UKG)\s*$/i);
      if (m) detectedGrade = m[1];
    }
  }

  const months = [];
  let cur = null;
  let curField = null;
  let buf = [];
  let started = false;

  const flushField = () => {
    if (cur && curField) cur.fields[curField] = buf.join("\n").trim();
    curField = null;
    buf = [];
  };
  const finalizeMonth = (m) => {
    const title = (m.fields.F01 && m.fields.F01.trim()) || m.headerTitle || "";
    if (m.fields.F06) m.fields.F06 = splitDialogue(m.fields.F06); // Model Conversation
    const focusSkills = [...new Set(m.focusRaw)];
    return { month: m.month, title, fields: m.fields, focusSkills };
  };
  const flushMonth = () => {
    if (cur) {
      flushField();
      months.push(finalizeMonth(cur));
      cur = null;
    }
  };

  for (const raw of paras) {
    const p = (raw || "").trim();
    if (!p) {
      if (curField) buf.push("");
      continue;
    }
    const mh = p.match(MONTH_RX);
    if (mh) {
      flushMonth();
      cur = {
        month: mh[1].toLowerCase(),
        headerTitle: (mh[2] || "").trim(),
        fields: {},
        focusRaw: [],
        inFocus: false,
      };
      curField = null;
      buf = [];
      started = true;
      continue;
    }
    if (started && isEndHeader(p)) {
      flushMonth();
      break;
    }
    if (!cur) continue;

    const fh = p.match(FIELD_RX);
    if (fh && +fh[1] >= 1 && +fh[1] <= 15) {
      flushField();
      curField = fieldCode(+fh[1]);
      buf = []; // the heading line itself stays out of the content
      cur.inFocus = false;
      continue;
    }

    if (/^Focus Skills$/i.test(p)) {
      cur.inFocus = true;
      if (curField) buf.push(p);
      continue;
    }
    if (cur.inFocus) {
      if (/^Observe\b/i.test(p) || fh) {
        cur.inFocus = false;
      } else {
        const name = p.replace(/^[••\-\*·]\s*/, "").trim();
        if (name && name.length <= 40 && !/[:.]$/.test(name))
          cur.focusRaw.push(name);
      }
    }
    if (curField) buf.push(p);
  }
  flushMonth();

  return { detectedGrade, programmeFocus, months };
}

function parseDocx(buf) {
  return parseClassModule(extractDocxText(buf));
}

module.exports = { readZipEntry, extractDocxText, parseClassModule, parseDocx, fieldCode, MONTHS };
