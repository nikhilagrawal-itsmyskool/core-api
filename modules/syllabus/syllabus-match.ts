/**
 * Syllabus reconcile — the matcher (pure, no DB).
 * -----------------------------------------------
 * Pairs the entries of a freshly-parsed document with a plan's existing entries so
 * a re-import can UPDATE matched rows in place (keeping their uuid → preserving
 * teacher progress) instead of delete-all + re-insert.
 *
 * Rules (see the design note):
 *   - title is the PRIMARY key; chapter/topic NUMBER is only a tiebreak (it drifts
 *     on insert). page_ref / month are NEVER matched on — they're updated in place.
 *   - matching is HIERARCHICAL: anchors (chapters/sections/units — the nodes that
 *     have children) are matched first; leaves are then matched WITHIN a matched
 *     anchor, which collapses ambiguity. Flat leaves (junior GK) match plan-wide.
 *   - three tiers per node: (0) equal source_key, (1) exact normalized key,
 *     (2) fuzzy similarity. >=HIGH auto-matches; [LOW,HIGH) becomes a "proposal"
 *     that needs human confirmation; <LOW is not a match.
 */
import { ParsedDoc, ParsedNode } from "./syllabus-parse";

export const FUZZY_HIGH = 0.88; // >= → auto-match
export const FUZZY_LOW = 0.55; // [LOW,HIGH) → proposal (needs confirm); < → no match

// An existing entry as loaded from the DB (camelCase), plus its mark count.
export interface ExistingEntry {
  uuid: string;
  seq: number;
  month: string | null;
  entryType: string;
  topicNo: string | null;
  component: string | null;
  parentEntryId: string | null;
  title: string;
  theme: string | null;
  pageRef: string | null;
  sourceKey: string | null;
  markCount: number; // # of syllabus_progress rows on this entry (across sections)
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}
export interface KeptPair {
  oldId: string;
  newTmp: number;
  confidence: number;
  changes: FieldChange[];
}
export interface Proposal {
  oldId: string;
  newTmp: number;
  confidence: number;
}
export interface RemovedItem {
  oldId: string;
  markCount: number;
}
export interface DiffPlan {
  layoutType: string;
  kept: KeptPair[]; // auto-matched (source_key/exact/high-fuzzy)
  proposals: Proposal[]; // ambiguous rename candidates — need a decision
  added: number[]; // parsed tmp ids with no match
  removed: RemovedItem[]; // existing uuids with no match (markCount flags risk)
  counts: {
    total: number;
    kept: number;
    changed: number;
    proposals: number;
    added: number;
    removed: number;
    removedWithMarks: number;
  };
}

// ── text normalization ────────────────────────────────────────────────────────
const NUM_PREFIX =
  /^\s*(?:ch|chapter|t|unit|lesson|story|अध्याय|पाठ)\s*[-.\s]*\s*(\d+)/i;
const LEADING_NUM = /^\s*(\d+)\s*[.)]/;

// Chapter/topic number, if the heading starts with one. Used only as a tiebreak.
export function headingNumber(title: string): number | null {
  const m = title.match(NUM_PREFIX) || title.match(LEADING_NUM);
  return m ? Number(m[1]) : null;
}
// Strip a leading "Ch-1." / "Chapter 2:" / "T-3." / "Unit 1 -" style prefix so the
// real title carries the match (a renumber shouldn't change the key).
export function stripPrefix(title: string): string {
  return (title || "")
    .replace(
      /^\s*(?:ch|chapter|t|unit|lesson|story|अध्याय|पाठ)\s*[-.\s]*\s*\d+[a-z]?\s*[:.)\-–]?\s*/i,
      "",
    )
    .trim();
}
// Leading ordinal of an item ("1.", "2)", "(a)") — the identity fallback for
// page-only / repeated-component leaves.
export function ordinalPrefix(text: string): string | null {
  const m = (text || "").match(/^\s*\(?\s*([0-9]{1,3}|[a-z])\s*[.)]/i);
  return m ? m[1].toLowerCase() : null;
}
// Lowercase, keep letters/digits of ANY script (Devanagari-safe), drop the rest.
export function normText(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

// How a parsed heading is stored as an entry. The importers keep the WHOLE heading
// as the title (the number stays in the text, e.g. "T-1. In the Forest" / "Ch-1. I
// Wish"), with topic_no null — so reconcile writes the same way to avoid churn.
// (Matching still ignores the number via stripPrefix; see anchorKey/leafKey.)
export function deriveTitleParts(heading: string): { topicNo: string | null; title: string } {
  return { topicNo: null, title: (heading || "").trim() };
}

// ── similarity (dependency-free) ──────────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + cost);
      diag = tmp;
    }
  }
  return prev[b.length];
}
function tokenSet(s: string): Set<string> {
  return new Set(
    (s || "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1),
  );
}
function jaccard(a: string, b: string): number {
  const A = tokenSet(a),
    B = tokenSet(b);
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
// Max of char-level edit ratio and word-level Jaccard. 0..1.
export function similarity(a: string, b: string): number {
  const na = normText(a),
    nb = normText(b);
  if (!na && !nb) return 0;
  if (na === nb && na) return 1;
  const dist = levenshtein(na, nb);
  const editRatio = 1 - dist / Math.max(na.length, nb.length, 1);
  return Math.max(editRatio, jaccard(a, b));
}

// ── keys ──────────────────────────────────────────────────────────────────────
// Anchor identity: its title with any number prefix stripped.
export function anchorKey(title: string): string {
  return normText(stripPrefix(title));
}
// A leaf whose text is only a page range / "P.16" (no words) carries no identity of
// its own — its identity is positional within (anchor, component). Detect that.
export function isPageOnly(text: string): boolean {
  const s = stripPrefix(text || "").trim();
  return !s || /^[\s\d\-–—\/,.:p()]+$/i.test(s);
}
// Leaf identity within its (anchor, component): distinctive stripped text, else the
// ordinal fallback (page-only / repeated items).
export function leafKey(component: string | null, text: string, ordinal: string | null): string {
  const t = isPageOnly(text) ? "" : normText(stripPrefix(text));
  return `${normText(component)}|${t || (ordinal ? "#" + ordinal : "")}`;
}
// Durable fingerprint stamped on every entry at apply time (Tier-0 next time).
export function sourceKeyOf(node: {
  component?: string | null;
  title?: string;
  heading?: string;
  parentKey?: string | null;
  ordinal?: string | null;
}): string {
  const text = node.title ?? node.heading ?? "";
  const body = leafKey(node.component ?? null, text, node.ordinal ?? null);
  return `${node.parentKey || ""}::${body}`.slice(0, 64);
}

// ── the matcher ───────────────────────────────────────────────────────────────
interface Cand {
  score: number;
  auto: boolean; // exact/source_key or fuzzy>=HIGH
}
function scorePair(
  exText: string,
  exComp: string | null,
  exNum: number | null,
  exKey: string | null,
  paText: string,
  paComp: string | null,
  paNum: number | null,
  paKey: string | null,
  bySourceKey?: { ex: string | null; pa: string | null },
): Cand | null {
  // Tier 0: durable source_key equality.
  if (bySourceKey?.ex && bySourceKey?.pa && bySourceKey.ex === bySourceKey.pa) {
    return { score: 3, auto: true };
  }
  // component must be compatible for leaves (both null, or equal-ish).
  if (exComp != null || paComp != null) {
    if (normText(exComp) !== normText(paComp)) {
      // different activity column — only allow if strong text identity
      const s = similarity(exText, paText);
      return s >= FUZZY_HIGH ? { score: s, auto: true } : null;
    }
  }
  // Tier 1: exact normalized key.
  if (exKey && paKey && exKey === paKey) {
    return { score: 2 + (exNum != null && exNum === paNum ? 0.01 : 0), auto: true };
  }
  // Tier 2: fuzzy on text; number agreement is a small tiebreak only.
  let s = similarity(exText, paText);
  if (s < FUZZY_LOW) return null;
  if (exNum != null && exNum === paNum) s = Math.min(1, s + 0.03);
  return { score: s, auto: s >= FUZZY_HIGH };
}

interface Assign {
  oldId: string;
  newTmp: number;
  score: number;
  auto: boolean;
}
// Greedy 1:1 assignment: take the highest-scoring pair, remove both, repeat.
function greedy(pairs: Array<Assign>): Assign[] {
  const out: Assign[] = [];
  const usedOld = new Set<string>();
  const usedNew = new Set<number>();
  pairs.sort((a, b) => b.score - a.score);
  for (const p of pairs) {
    if (usedOld.has(p.oldId) || usedNew.has(p.newTmp)) continue;
    usedOld.add(p.oldId);
    usedNew.add(p.newTmp);
    out.push(p);
  }
  return out;
}

export function matchPlan(existing: ExistingEntry[], parsed: ParsedDoc): DiffPlan {
  const nodes = parsed.nodes;

  // children sets → anchor (has children) vs leaf (none)
  const exChildCount = new Map<string, number>();
  for (const e of existing)
    if (e.parentEntryId)
      exChildCount.set(e.parentEntryId, (exChildCount.get(e.parentEntryId) || 0) + 1);
  const paChildCount = new Map<number, number>();
  for (const n of nodes)
    if (n.parent) paChildCount.set(n.parent, (paChildCount.get(n.parent) || 0) + 1);

  const exIsAnchor = (e: ExistingEntry) => (exChildCount.get(e.uuid) || 0) > 0;
  const paIsAnchor = (n: ParsedNode) => (paChildCount.get(n.tmp) || 0) > 0;

  const exById = new Map(existing.map((e) => [e.uuid, e]));
  const paByTmp = new Map(nodes.map((n) => [n.tmp, n]));

  // ── phase 1: anchors ──
  const exAnchors = existing.filter(exIsAnchor);
  const paAnchors = nodes.filter(paIsAnchor);
  const anchorPairs: Assign[] = [];
  for (const pa of paAnchors) {
    for (const ex of exAnchors) {
      const c = scorePair(
        ex.title, null, headingNumber(ex.title), anchorKey(ex.title),
        pa.heading, null, headingNumber(pa.heading), anchorKey(pa.heading),
        { ex: ex.sourceKey, pa: null },
      );
      if (c) anchorPairs.push({ oldId: ex.uuid, newTmp: pa.tmp, score: c.score, auto: c.auto });
    }
  }
  const anchorAssign = greedy(anchorPairs);
  const paAnchorToEx = new Map<number, string>(); // parsed anchor tmp → existing uuid
  const exAnchorToPa = new Map<string, number>();
  for (const a of anchorAssign) {
    paAnchorToEx.set(a.newTmp, a.oldId);
    exAnchorToPa.set(a.oldId, a.newTmp);
  }

  // ── phase 2: leaves (within matched anchors, else plan-wide flat) ──
  const exLeaves = existing.filter((e) => !exIsAnchor(e));
  const paLeaves = nodes.filter((n) => !paIsAnchor(n));
  const exLeafByParent = new Map<string, ExistingEntry[]>();
  const exFlatLeaves: ExistingEntry[] = [];
  for (const e of exLeaves) {
    if (e.parentEntryId) {
      if (!exLeafByParent.has(e.parentEntryId)) exLeafByParent.set(e.parentEntryId, []);
      exLeafByParent.get(e.parentEntryId)!.push(e);
    } else exFlatLeaves.push(e);
  }
  // ordinal per (parent,component) as a page-only fallback
  const ordAmong = (list: { component?: string | null; heading?: string; title?: string }[], idx: number) => {
    const self = list[idx];
    const comp = normText(self.component);
    let n = 0;
    for (let i = 0; i <= idx; i++) if (normText(list[i].component) === comp) n++;
    return String(n);
  };

  const leafPairs: Assign[] = [];
  // group parsed leaves by parent (or flat) to compute ordinals + candidate pools
  const paLeafByParent = new Map<number | null, ParsedNode[]>();
  for (const n of paLeaves) {
    const k = n.parent ?? null;
    if (!paLeafByParent.has(k)) paLeafByParent.set(k, []);
    paLeafByParent.get(k)!.push(n);
  }

  for (const [paParent, group] of paLeafByParent) {
    // candidate existing leaves: those under the matched existing anchor, or flat.
    let exPool: ExistingEntry[];
    if (paParent != null && paAnchorToEx.has(paParent)) {
      exPool = exLeafByParent.get(paAnchorToEx.get(paParent)!) || [];
    } else if (paParent == null) {
      exPool = exFlatLeaves;
    } else {
      exPool = []; // parent unmatched → its leaves are all new
    }
    const exPoolOrd = exPool.map((e, i) => ({ e, ord: ordAmong(exPool, i) }));
    group.forEach((pa, i) => {
      const paOrd = ordinalPrefix(pa.heading) || ordAmong(group, i);
      const paKey = leafKey(pa.component ?? null, pa.heading, paOrd);
      for (const { e, ord } of exPoolOrd) {
        const exOrd = ordinalPrefix(e.title) || ord;
        const exKey = leafKey(e.component, e.title, exOrd);
        const c = scorePair(
          e.title, e.component, headingNumber(e.title), exKey,
          pa.heading, pa.component ?? null, headingNumber(pa.heading), paKey,
          { ex: e.sourceKey, pa: null },
        );
        if (c) leafPairs.push({ oldId: e.uuid, newTmp: pa.tmp, score: c.score, auto: c.auto });
      }
    });
  }
  const leafAssign = greedy(leafPairs);

  // ── assemble the diff ──
  const allAssign = [...anchorAssign, ...leafAssign];
  const kept: KeptPair[] = [];
  const proposals: Proposal[] = [];
  const matchedOld = new Set<string>();
  const matchedNew = new Set<number>();

  for (const a of allAssign) {
    matchedOld.add(a.oldId);
    matchedNew.add(a.newTmp);
    const ex = exById.get(a.oldId)!;
    const pa = paByTmp.get(a.newTmp)!;
    if (a.auto) {
      kept.push({ oldId: a.oldId, newTmp: a.newTmp, confidence: a.score >= 2 ? 1 : a.score, changes: fieldChanges(ex, pa, paAnchorToEx) });
    } else {
      proposals.push({ oldId: a.oldId, newTmp: a.newTmp, confidence: a.score });
    }
  }

  const added = nodes.filter((n) => !matchedNew.has(n.tmp)).map((n) => n.tmp);
  const removed: RemovedItem[] = existing
    .filter((e) => !matchedOld.has(e.uuid))
    .map((e) => ({ oldId: e.uuid, markCount: e.markCount }));

  const changed = kept.filter((k) => k.changes.length > 0).length;
  return {
    layoutType: parsed.layoutType,
    kept,
    proposals,
    added,
    removed,
    counts: {
      total: nodes.length,
      kept: kept.length,
      changed,
      proposals: proposals.length,
      added: added.length,
      removed: removed.length,
      removedWithMarks: removed.filter((r) => r.markCount > 0).length,
    },
  };
}

// Fields that differ between the existing row and its matched parsed node. page_ref
// / month / theme / title / component / parent are the ones an update writes.
function fieldChanges(
  ex: ExistingEntry,
  pa: ParsedNode,
  paAnchorToEx: Map<number, string>,
): FieldChange[] {
  const ch: FieldChange[] = [];
  const push = (field: string, from: unknown, to: unknown) => {
    const norm = (v: unknown) => (v == null || v === "" ? null : String(v).trim());
    if (norm(from) !== norm(to)) ch.push({ field, from: norm(from), to: norm(to) });
  };
  // Title change = the CONTENT changed (number-stripped). A pure renumber is reported
  // separately as "number", not a title rewrite — so a same-doc re-import is a no-op
  // regardless of whether the number lives in the title or in topic_no.
  if (normText(stripPrefix(ex.title)) !== normText(stripPrefix(pa.heading))) {
    push("title", ex.title, pa.heading);
  }
  const exNum = headingNumber(ex.topicNo || "") ?? headingNumber(ex.title);
  const paNum = headingNumber(pa.heading);
  if (exNum !== paNum) push("number", exNum, paNum);
  push("month", ex.month, pa.month);
  push("pageRef", ex.pageRef, pa.pageRef);
  push("theme", ex.theme, pa.theme);
  push("component", ex.component, pa.component ?? null);
  push("entryType", ex.entryType, pa.type);
  // parent change: did this node move under a different (matched) anchor?
  const newParentEx = pa.parent != null ? paAnchorToEx.get(pa.parent) ?? "?" : null;
  push("parent", ex.parentEntryId, newParentEx);
  return ch;
}
