import {
  matchPlan,
  ExistingEntry,
  similarity,
  deriveTitleParts,
  stripPrefix,
  headingNumber,
} from "../syllabus-match";
import { ParsedDoc, ParsedNode } from "../syllabus-parse";

// ── builders ──────────────────────────────────────────────────────────────────
let seq = 0;
function ex(p: Partial<ExistingEntry> & { uuid: string; title: string }): ExistingEntry {
  return {
    seq: seq++, month: "april", entryType: "topic", topicNo: null, component: null,
    parentEntryId: null, theme: null, pageRef: null, sourceKey: null, markCount: 0, ...p,
  };
}
let tmp = 0;
function node(p: Partial<ParsedNode> & { heading: string }): ParsedNode {
  return {
    tmp: ++tmp, parent: null, seq: tmp, type: "topic", component: null,
    month: "april", theme: null, pageRef: null, ...p,
  };
}
function doc(nodes: ParsedNode[], layoutType: ParsedDoc["layoutType"] = "gk"): ParsedDoc {
  return { subject: "X", grade: "IV", layoutType, components: [], nodes };
}
beforeEach(() => { seq = 0; tmp = 0; });

// ── helpers ─────────────────────────────────────────────────────────────────
describe("normalization helpers", () => {
  test("stripPrefix drops chapter/topic numbers, keeps title", () => {
    expect(stripPrefix("Ch-1. I Wish")).toBe("I Wish");
    expect(stripPrefix("Chapter 2: David and Goliath")).toBe("David and Goliath");
    expect(stripPrefix("T-15. Global Warming")).toBe("Global Warming");
  });
  test("headingNumber extracts the drifting number", () => {
    expect(headingNumber("Ch-7. Analogy")).toBe(7);
    expect(headingNumber("T-1. In the Forest")).toBe(1);
    expect(headingNumber("Sample Paper-1")).toBe(null); // no leading chapter/topic no.
  });
  test("deriveTitleParts keeps the whole heading as title (importer convention)", () => {
    expect(deriveTitleParts("T-1. In the Forest")).toEqual({ topicNo: null, title: "T-1. In the Forest" });
    expect(deriveTitleParts("Ch-1. I Wish")).toEqual({ topicNo: null, title: "Ch-1. I Wish" });
    expect(deriveTitleParts("#Q & A Express")).toEqual({ topicNo: null, title: "#Q & A Express" });
  });
  test("similarity: typo is high, unrelated is low", () => {
    expect(similarity("Classification", "Classifications")).toBeGreaterThan(0.88);
    expect(similarity("The Nightingale", "In the Wild")).toBeLessThan(0.55);
  });
});

// ── GK flat: rename, page change, insert, remove ──────────────────────────────
describe("GK flat topics", () => {
  test("keeps ids through minor edits; flags removed-with-marks", () => {
    const existing = [
      ex({ uuid: "g1", title: "Affordable and Clean Energy", topicNo: "T-1", markCount: 2 }),
      ex({ uuid: "g2", title: "Union Territories", topicNo: "T-5", markCount: 1 }),
      ex({ uuid: "g3", title: "How an Elevator Works?", topicNo: "T-22", markCount: 0 }),
    ];
    // after: g1 same; g3 renumbered T-22->T-20 + page change; g2 removed; one new topic
    const parsed = doc([
      node({ heading: "T-1. Affordable and Clean Energy" }),
      node({ heading: "T-20. How an Elevator Works?", pageRef: "34-35" }),
      node({ heading: "T-30. A Brand New Topic" }),
    ]);
    const d = matchPlan(existing, parsed);
    const keptOld = d.kept.map((k) => k.oldId).sort();
    expect(keptOld).toEqual(["g1", "g3"]); // renumber didn't break the match
    expect(d.added.length).toBe(1);
    expect(d.removed.map((r) => r.oldId)).toEqual(["g2"]);
    expect(d.counts.removedWithMarks).toBe(1); // g2 had a mark → surfaced
    // g3 kept but its page changed → recorded as a field change, id preserved
    const g3 = d.kept.find((k) => k.oldId === "g3")!;
    expect(g3.changes.some((c) => c.field === "pageRef")).toBe(true);
  });

  test("a renumber is reported as 'number', not a title change (both storage styles)", () => {
    // split style (topic_no populated)
    const split = matchPlan(
      [ex({ uuid: "g1", title: "In the Forest", topicNo: "T-1", markCount: 1 })],
      doc([node({ heading: "T-2. In the Forest" })]),
    );
    expect(split.kept[0].oldId).toBe("g1");
    expect(split.kept[0].changes.some((c) => c.field === "title")).toBe(false);
    expect(split.kept[0].changes.some((c) => c.field === "number")).toBe(true);
    // number-in-title style (topic_no null) — the real DBPASN convention
    const inline = matchPlan(
      [ex({ uuid: "g2", title: "T-1. In the Forest", topicNo: null, markCount: 1 })],
      doc([node({ heading: "T-2. In the Forest" })]),
    );
    expect(inline.kept[0].oldId).toBe("g2");
    expect(inline.kept[0].changes.some((c) => c.field === "title")).toBe(false);
    expect(inline.kept[0].changes.some((c) => c.field === "number")).toBe(true);
  });

  test("re-import of the SAME number-in-title entry is a no-op", () => {
    const d = matchPlan(
      [ex({ uuid: "g1", title: "T-1. In the Forest", topicNo: null, markCount: 3, pageRef: "7" })],
      doc([node({ heading: "T-1. In the Forest", pageRef: "7" })]),
    );
    expect(d.kept.length).toBe(1);
    expect(d.kept[0].changes.length).toBe(0);
  });
});

// ── Wide tree: match chapters first, then items (incl. page-only + repeats) ────
describe("wide chapter→item tree", () => {
  test("page-only items and repeated components keep ids by ordinal", () => {
    const chap = ex({ uuid: "c1", title: "Ch-1. I Wish", entryType: "chapter" });
    const existing = [
      chap,
      ex({ uuid: "i-phon", title: "7-14", entryType: "item", component: "Phonics", parentEntryId: "c1", markCount: 1 }),
      ex({ uuid: "i-lit1", title: "1. Match the columns.", entryType: "item", component: "Lit Vocab", parentEntryId: "c1", markCount: 1 }),
      ex({ uuid: "i-lit2", title: "2. Fill in the blanks.", entryType: "item", component: "Lit Vocab", parentEntryId: "c1", markCount: 1 }),
    ];
    const nChap = node({ heading: "Ch-1. I Wish", type: "chapter" });
    const parsed = doc([
      nChap,
      // phonics page range shifted (title changes) — identity is (chapter, Phonics)
      node({ heading: "8-15", type: "item", component: "Phonics", parent: nChap.tmp }),
      node({ heading: "1. Match the columns.", type: "item", component: "Lit Vocab", parent: nChap.tmp }),
      node({ heading: "2. Fill in the blanks.", type: "item", component: "Lit Vocab", parent: nChap.tmp }),
    ], "wide");
    const d = matchPlan(existing, parsed);
    const keptOld = d.kept.map((k) => k.oldId).sort();
    expect(keptOld).toEqual(["c1", "i-lit1", "i-lit2", "i-phon"]);
    expect(d.added.length).toBe(0);
    expect(d.removed.length).toBe(0);
    // the phonics leaf kept its id even though the page-range text changed
    const phon = d.kept.find((k) => k.oldId === "i-phon")!;
    expect(phon.changes.some((c) => c.field === "title")).toBe(true);
  });
});

// ── Reasoning: track (component) disambiguates same title ──────────────────────
describe("reasoning parallel tracks", () => {
  test("'Analogy' in two tracks stays distinct", () => {
    const existing = [
      ex({ uuid: "v1", title: "Ch-1. Analogy", entryType: "chapter", component: "Verbal Aptitude", markCount: 1 }),
      ex({ uuid: "nv7", title: "Ch-7. Analogy", entryType: "chapter", component: "Non-Verbal Aptitude", markCount: 1 }),
    ];
    const parsed = doc([
      node({ heading: "Ch-1. Analogy", type: "chapter", component: "Verbal Aptitude", pageRef: "7-10" }),
      node({ heading: "Ch-7. Analogy", type: "chapter", component: "Non-Verbal Aptitude", pageRef: "36-41" }),
    ], "reasoning");
    const d = matchPlan(existing, parsed);
    const map = Object.fromEntries(d.kept.map((k) => [k.oldId, k.newTmp]));
    // verbal old matched the verbal new, not the non-verbal one
    expect(map["v1"]).toBeDefined();
    expect(map["nv7"]).toBeDefined();
    expect(map["v1"]).not.toBe(map["nv7"]);
    expect(d.removed.length).toBe(0);
    expect(d.added.length).toBe(0);
  });
});
