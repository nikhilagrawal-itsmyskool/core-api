/**
 * Syllabus .docx parser (Lambda-usable, buffer-based).
 * ----------------------------------------------------
 * Ports the node-tree parser from scripts/import-syllabus-v2.js so it can run
 * inside the module (for the reconcile upload flow) instead of only from the CLI.
 * Input is the raw .docx bytes; output is the same { subject, grade, layoutType,
 * components, nodes } shape the importer produces.
 *
 * Layouts handled (unchanged from the importer):
 *   - wide      : Month | Chapter | Pages | <subject component columns> → chapter→item tree
 *   - gk        : Month | Topics | Themes | Pages (junior) OR two-column senior → flat topics
 *   - reasoning : Verbal | Pages | Non-Verbal | Pages | Quantitative | Pages → 3 parallel tracks
 * Devanagari (Hindi/Vyakaran) = wide layout with Hindi month names.
 */
import * as zlib from "zlib";

export type LayoutType = "gk" | "wide" | "reasoning";

export interface ParsedComponent {
  key: string;
  label: string;
}

export interface ParsedNode {
  tmp: number;
  parent: number | null;
  seq: number;
  type: string; // unit | chapter | item | topic | section | exam | revision | refresher | note
  component?: string | null;
  month: string | null;
  heading: string;
  theme?: string | null;
  pageRef: string | null;
}

export interface ParsedDoc {
  subject: string;
  grade: string | null;
  layoutType: LayoutType;
  components: ParsedComponent[];
  nodes: ParsedNode[];
}

// ── .docx (zip) reading ───────────────────────────────────────────────────────
function readZipEntry(buf: Buffer, entryName: string): Buffer {
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

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(+d));
}

// Each cell -> array of PARAGRAPH texts (one per <w:p>). Component cells pack
// several activities as separate paragraphs, so this yields one item per line.
function cellParas(tc: string): string[] {
  const paras = tc.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [tc];
  return paras
    .map((p) => {
      const runs = p.match(/<w:t[ >][\s\S]*?<\/w:t>/g) || [];
      return decodeEntities(runs.map((r) => r.replace(/<[^>]+>/g, "")).join(""))
        .replace(/\s+/g, " ")
        .trim();
    })
    .filter((x) => x);
}
const joinCell = (cell: string[]): string =>
  (cell || []).join(" ").replace(/\s+/g, " ").trim();

function tableRows(xml: string): string[][][] {
  return (xml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || []).map((tr) =>
    (tr.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || []).map(cellParas),
  );
}
function docTables(xml: string): string[][][][] {
  const tbls = xml.match(/<w:tbl\b[\s\S]*?<\/w:tbl>/g) || [xml];
  return tbls.map(tableRows);
}
function isSyllabusTable(rowsOfTable: string[][][]): boolean {
  const hdr =
    rowsOfTable.find((r) =>
      r.some((cell) => /^(month|months|मास)$/i.test(joinCell(cell))),
    ) ||
    rowsOfTable[0] ||
    [];
  const H = hdr.map((h) => joinCell(h).toLowerCase());
  const hasMonth = H.some((h) => /^(month|months|मास)$/.test(h));
  const hasChap = H.some(
    (h, i) => i >= 1 && /(chapters?|topics?|पाठ|grammar|aptitude)/.test(h),
  );
  const hasPages = H.some((h) => /(^pages?$|पृष्ठ|page)/.test(h));
  return hasMonth || (hasChap && hasPages);
}
function plainText(xml: string): string {
  return decodeEntities(
    xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, ""),
  ).replace(/[ \t]+/g, " ");
}

// ── months (English + Devanagari) ─────────────────────────────────────────────
const MONTHS = [
  "april", "may", "june", "july", "august", "september",
  "october", "november", "december", "january", "february", "march",
];
const HINDI_MONTH: Record<string, string> = {
  "अप्रैल": "april", "मई": "may", "जून": "june", "जुलाई": "july",
  "अगस्त": "august", "सितंबर": "september", "सितम्बर": "september",
  "अक्टूबर": "october", "अक्तूबर": "october", "नवंबर": "november",
  "नवम्बर": "november", "दिसंबर": "december", "दिसम्बर": "december",
  "जनवरी": "january", "फरवरी": "february", "मार्च": "march",
};
function normMonth(text: string | null | undefined): string | null {
  if (!text) return null;
  const raw = text.trim();
  if (HINDI_MONTH[raw]) return HINDI_MONTH[raw];
  const t = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!t) return null;
  for (const m of MONTHS)
    if (t === m || t === m.slice(0, 3) || (t.length >= 3 && m.startsWith(t)))
      return m;
  return null;
}
const isBlank = (s: string | null | undefined): boolean =>
  !s || /^[-–—\s]+$/.test(s.trim());
const extractPage = (s: string | null | undefined): string | null => {
  const m = (s || "").match(/P\.?\s*([0-9][0-9\-–,\/\s]*)/i);
  return m
    ? m[1].replace(/[–]/g, "-").replace(/\s+/g, "").slice(0, 32)
    : null;
};
const pageFromCell = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const p = extractPage(s);
  if (p) return p;
  const t = s.trim();
  return /^[0-9][0-9\-–\/,.\s]*$/.test(t)
    ? t.replace(/\s+/g, "").replace(/[–]/g, "-").slice(0, 32)
    : null;
};
const RX_STRUCT =
  /revision|periodic|assessment|examination|half\s*yearly|annual\s*exam|\bexam\b|\btest\b|olympiad|refresher|पुनरावृत्ति|परीक्षा/i;
const RX_UNIT = /^(unit|theme|topic)\b.*[:：]/i;
const RX_CONT = /continue|continued|\.\.\.$|…$/i;
const structType = (s: string): string =>
  /exam|examination|test|assessment|periodic|olympiad|परीक्षा/i.test(s)
    ? "exam"
    : /refresher/i.test(s)
      ? "refresher"
      : "revision";

// Re-order nodes into tree preorder (parent, then children) and renumber seq.
function resequence(nodes: ParsedNode[]): ParsedNode[] {
  const children = new Map<number, ParsedNode[]>();
  const roots: ParsedNode[] = [];
  for (const n of nodes) {
    if (n.parent) {
      if (!children.has(n.parent)) children.set(n.parent, []);
      children.get(n.parent)!.push(n);
    } else roots.push(n);
  }
  const out: ParsedNode[] = [];
  let s = 0;
  const visit = (n: ParsedNode) => {
    n.seq = s++;
    out.push(n);
    for (const ch of children.get(n.tmp) || []) visit(ch);
  };
  for (const r of roots) visit(r);
  return out;
}

// Canonical subject names (same doc names a subject differently across grades).
const SUBJECT_CANON: Record<string, string> = {
  "english grammar": "Grammar",
  "life skills": "Value Education and Life Skills",
  "value education & life skills": "Value Education and Life Skills",
  "value education and life skills": "Value Education and Life Skills",
};
function canonSubject(name: string): string {
  const k = (name || "").toLowerCase().replace(/\s+/g, " ").trim();
  return SUBJECT_CANON[k] || name;
}

// ── parse a .docx buffer into a ParsedDoc ─────────────────────────────────────
export function parseDocxBuffer(
  buf: Buffer,
  opts?: { fileName?: string },
): ParsedDoc {
  const xml = readZipEntry(buf, "word/document.xml").toString("utf8");
  const text = plainText(xml);
  const base = (opts?.fileName || "").replace(/\.docx$/i, "");
  let subject = (text.match(/Syllabus:\s*([^\n]+)/i) || [])[1]?.trim();
  if (!subject && base)
    subject = base
      .replace(/^Class\s+[A-Za-z0-9]+\s*[-–]\s*/i, "")
      .replace(/\s*\(\d+\)\s*$/, "")
      .trim();
  subject = canonSubject((subject || "").replace(/\s+/g, " "));
  const grade = (text.match(/Class\s+([A-Za-z0-9]+)/i) || [])[1]?.trim() || null;

  const rows = docTables(xml)
    .filter(isSyllabusTable)
    .flat()
    .filter((c) => c.length && !c.every((cell) => isBlank(joinCell(cell))));
  const hi = rows.findIndex((c) =>
    c.some((x) => /^(month|months|मास)$/i.test(joinCell(x))),
  );
  const hdr = hi >= 0 ? rows[hi] : rows[1] || rows[0] || [];
  const H = hdr.map((h) => joinCell(h).toLowerCase());

  const isGk =
    H.some((h) => /^topics?$/.test(h)) ||
    (!!H[1] &&
      /^chapters?$/.test(H[1]) &&
      H.length >= 6 &&
      /^(month|months)$/.test(H[3] || ""));
  const isReasoning =
    H.some((h) => /verbal aptitude|verbal\b/.test(h)) &&
    H.some((h) => /quantitative|non-?verbal/.test(h));

  const nodes: ParsedNode[] = [];
  let seq = 0;
  const add = (n: Omit<ParsedNode, "tmp" | "seq"> & Partial<Pick<ParsedNode, "seq">>): number => {
    const node: ParsedNode = {
      tmp: nodes.length + 1,
      seq: seq++,
      parent: n.parent,
      type: n.type,
      component: n.component ?? null,
      month: n.month,
      heading: n.heading,
      theme: n.theme ?? null,
      pageRef: n.pageRef ?? null,
    };
    nodes.push(node);
    return node.tmp;
  };

  if (isReasoning) {
    const tracks = [
      { ci: 1, pi: 2, name: joinCell(hdr[1]) || "Verbal" },
      { ci: 3, pi: 4, name: joinCell(hdr[3]) || "Non-Verbal" },
      { ci: 5, pi: 6, name: joinCell(hdr[5]) || "Quantitative" },
    ];
    const components = tracks.map((t) => ({
      key: t.name.toLowerCase().replace(/\s+/g, "_").slice(0, 48),
      label: t.name,
    }));
    let curMonth: string | null = null;
    for (let r = hi + 1; r < rows.length; r++) {
      const c = rows[r];
      const m = normMonth(joinCell(c[0]));
      if (m) curMonth = m;
      for (const t of tracks) {
        const ch = joinCell(c[t.ci]);
        if (isBlank(ch)) continue;
        const pageRef = joinCell(c[t.pi]) || extractPage(ch) || null;
        const type = RX_STRUCT.test(ch) ? structType(ch) : "chapter";
        add({ parent: null, type, component: t.name, month: curMonth, heading: ch, pageRef });
      }
    }
    return { subject, grade, layoutType: "reasoning", components, nodes };
  }

  if (isGk) {
    const twoCol = H.length >= 6 && /^(month|months)$/.test(H[3] || "");
    const blocks = twoCol
      ? [
          { mi: 0, ti: 1, pi: 2, th: null as number | null },
          { mi: 3, ti: 4, pi: 5, th: null as number | null },
        ]
      : [{ mi: 0, ti: 1, th: 2 as number | null, pi: 3 }];
    for (const b of blocks) {
      let curMonth: string | null = null;
      let curSection: number | null = null;
      for (let r = hi + 1; r < rows.length; r++) {
        const c = rows[r];
        const m = normMonth(joinCell(c[b.mi]));
        if (m) curMonth = m;
        const t = joinCell(c[b.ti]);
        if (/^(chapters?|topics?|months?)$/i.test(t)) continue;
        if (isBlank(t)) continue;
        if (/^topic\s*[:：]/i.test(t)) {
          curSection = add({
            parent: null, type: "section", month: curMonth,
            heading: t.replace(/^topic\s*[:：]\s*/i, ""), pageRef: null,
          });
          continue;
        }
        if (/^(story|chapter|unit|lesson)\s*\d+[a-z]?\s*[:：]/i.test(t)) {
          curSection = add({
            parent: null, type: "chapter", month: curMonth, heading: t,
            pageRef: pageFromCell(joinCell(c[b.pi])),
          });
          continue;
        }
        if (RX_STRUCT.test(t) && !/^T\s*-?\s*\d/i.test(t)) {
          add({
            parent: curSection, type: structType(t), month: curMonth,
            heading: t, pageRef: joinCell(c[b.pi]) || null,
          });
          continue;
        }
        add({
          parent: curSection, type: "topic", month: curMonth, heading: t,
          theme: b.th != null ? joinCell(c[b.th]) || null : null,
          pageRef: joinCell(c[b.pi]) || null,
        });
      }
    }
    return { subject, grade, layoutType: "gk", components: [], nodes };
  }

  // ── wide chapter layout (may span multiple tables) ──────────────────────────
  const wideTables = docTables(xml).filter(isSyllabusTable);
  const infos = wideTables.map((t) => {
    const thi = t.findIndex((r) =>
      r.some((cell) => /^(month|months|मास)$/i.test(joinCell(cell))),
    );
    const th = thi >= 0 ? t[thi] : t[0] || [];
    const TH = th.map((h) => joinCell(h).toLowerCase());
    return {
      t, hi: thi, hdr: th,
      pagesIdx: TH.findIndex((h, i) => i >= 1 && /(^pages?$|पृष्ठ|page)/.test(h)),
    };
  });
  let primaryIdx = infos.findIndex((ti) => ti.pagesIdx >= 0);
  if (primaryIdx < 0) primaryIdx = 0;

  const components: ParsedComponent[] = [];
  const seenComp = new Set<string>();
  const chapterMap = new Map<string, number>();
  const normNameLocal = (s: string): string =>
    (s || "")
      .toLowerCase()
      .replace(/continue.*$/i, "")
      .replace(/\(.*?\)/g, "")
      .replace(/[^\p{L}\p{N}]/gu, "")
      .slice(0, 40);
  const mergePages = (a: string | null, b: string | null): string | null => {
    const nums = `${a || ""} ${b || ""}`.match(/\d+/g);
    if (!nums || !nums.length) return a || b || null;
    const lo = Math.min(...nums.map(Number)),
      hi2 = Math.max(...nums.map(Number));
    return lo === hi2 ? String(lo) : `${lo}-${hi2}`;
  };
  const addPages = (chapTmp: number, pages: string | null) => {
    if (!pages) return;
    const chap = nodes.find((n) => n.tmp === chapTmp);
    if (chap) chap.pageRef = mergePages(chap.pageRef, pages);
  };

  interface CompCol {
    k: number;
    label: string;
    pageColK?: number;
  }

  const processTable = (
    ti: { t: string[][][]; hi: number; hdr: string[][]; pagesIdx: number },
    isPrimary: boolean,
  ) => {
    const { t, hi: thi, hdr: th, pagesIdx: tpi } = ti;
    const chapterIdx = 1;
    const compIdx: CompCol[] = [];
    let lastComp: CompCol | null = null;
    for (let k = 0; k < th.length; k++) {
      if (k === 0 || k === chapterIdx || k === tpi) continue;
      const label = joinCell(th[k]);
      if (!label) continue;
      if (/^pages?$/i.test(label.trim())) {
        if (lastComp) lastComp.pageColK = k;
        continue;
      }
      const comp: CompCol = { k, label };
      compIdx.push(comp);
      lastComp = comp;
      if (!seenComp.has(label.toLowerCase())) {
        seenComp.add(label.toLowerCase());
        components.push({
          key: label.toLowerCase().replace(/\s+/g, "_").slice(0, 48),
          label,
        });
      }
    }
    let curMonth: string | null = null;
    let curUnit: number | null = null;
    let curChapter: number | null = null;
    for (let r = thi + 1; r < t.length; r++) {
      const c = t[r];
      const m = normMonth(joinCell(c[0]));
      if (m) curMonth = m;
      const c1 = joinCell(c[chapterIdx]);
      if (/^(chapters?|topics?|months?|पाठ|मास|projects?)$/i.test(c1)) continue;
      const pages = tpi >= 0 ? joinCell(c[tpi]) || null : null;
      if (!isBlank(c1)) {
        if (RX_UNIT.test(c1)) {
          if (isPrimary) {
            curUnit = add({ parent: null, type: "unit", month: curMonth, heading: c1, pageRef: null });
          }
          curChapter = null;
          continue;
        }
        if (RX_STRUCT.test(c1) && !/^(ch|chapter|पाठ|अध्याय)\s*-?\s*\d/i.test(c1)) {
          if (isPrimary)
            add({ parent: curUnit, type: structType(c1), month: curMonth, heading: c1, pageRef: pages });
          continue;
        }
        const key = normNameLocal(c1);
        if (isPrimary) {
          if (!RX_CONT.test(c1) || !curChapter) {
            curChapter = add({ parent: curUnit, type: "chapter", month: curMonth, heading: c1, pageRef: pages });
            if (key) chapterMap.set(key, curChapter);
          } else addPages(curChapter, pages);
        } else if (key && chapterMap.has(key)) {
          curChapter = chapterMap.get(key)!;
          addPages(curChapter, pages);
        } else if (!RX_CONT.test(c1)) {
          curChapter = add({ parent: null, type: "chapter", month: curMonth, heading: c1, pageRef: pages });
          if (key) chapterMap.set(key, curChapter);
        }
      } else if (curChapter) {
        addPages(curChapter, pages);
      }
      if (curChapter) {
        for (const comp of compIdx) {
          const pageParas = comp.pageColK != null ? c[comp.pageColK] || [] : [];
          const wholePage = pageParas.length ? pageFromCell(joinCell(pageParas)) : null;
          let lastTmp: number | null = null;
          let itemIdx = 0;
          for (const para of c[comp.k] || []) {
            if (isBlank(para)) continue;
            const cont =
              lastTmp != null &&
              (/^\(/.test(para) ||
                /^[a-z]/.test(para) ||
                /^\(?\s*p\.?\s*[\d][\d\-–\/,\s]*\)?\s*$/i.test(para));
            if (cont) {
              const node = nodes.find((n) => n.tmp === lastTmp);
              if (node) {
                node.heading = `${node.heading} ${para}`.slice(0, 4000);
                if (!node.pageRef) node.pageRef = extractPage(para);
              }
              continue;
            }
            const pageRef = extractPage(para) || pageFromCell(pageParas[itemIdx]) || wholePage;
            lastTmp = add({ parent: curChapter, type: "item", component: comp.label, month: curMonth, heading: para, pageRef });
            itemIdx++;
          }
        }
      }
    }
  };

  processTable(infos[primaryIdx], true);
  infos.forEach((ti, idx) => {
    if (idx !== primaryIdx) processTable(ti, false);
  });
  return { subject, grade, layoutType: "wide", components, nodes: resequence(nodes) };
}
