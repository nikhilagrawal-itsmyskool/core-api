/**
 * Syllabus reconcile service — in-place re-import.
 * ------------------------------------------------
 * preview(): parse an uploaded .docx, match it against the plan's live entries,
 *            and return a rich diff (keep / new / removed / proposals) plus a
 *            grade/subject sanity check. No writes.
 * apply():   re-parse + re-match deterministically, fold in the human decisions,
 *            snapshot the plan (last-10 revisions), then UPDATE matched rows in
 *            place (uuid kept → progress preserved), INSERT new, soft-delete
 *            removed (+ their progress), resequence, and store the new source doc.
 *
 * The whole point: syllabus_progress rows for kept entries are never touched.
 */
import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { fileStorageService } from "../../shared/lib/file-storage";
import { parseDocxBuffer, ParsedDoc, ParsedNode } from "./syllabus-parse";
import {
  matchPlan,
  ExistingEntry,
  DiffPlan,
  anchorKey,
  leafKey,
  ordinalPrefix,
  deriveTitleParts,
  normText,
} from "./syllabus-match";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_REVISIONS = 10;
const stripDataUri = (b64: string) => (b64 || "").replace(/^data:[^;]+;base64,/, "");

export interface ReconcileDecision {
  kind: "map" | "new" | "remove";
  oldId?: string;
  newTmp?: number;
}

interface PlanRow {
  uuid: string;
  grade: string;
  subjectId: string;
  subjectName: string | null;
  componentLayout: { key: string; label: string }[] | null;
  sourceFileId: string | null;
}

class SyllabusReconcileService {
  // ── shared loads ──────────────────────────────────────────────────────────
  private async getPlan(planId: string, schoolId: string): Promise<PlanRow | null> {
    const rows = await DB.query(
      singleLineString`
        select s.uuid, s.grade, s.subject_id, s.component_layout, s.source_file_id,
               sub.name as subject_name
        from syllabus s
        left join syllabus_subject sub on sub.uuid = s.subject_id
        where s.uuid = $1 and s.school_id = $2 and s.status = 'active'
      `,
      [planId, schoolId],
    );
    return rows.length ? rows[0] : null;
  }

  private async loadExisting(planId: string, schoolId: string): Promise<ExistingEntry[]> {
    return DB.query(
      singleLineString`
        select e.uuid, e.seq, e.month, e.entry_type, e.topic_no, e.component,
               e.parent_entry_id, e.title, e.theme, e.page_ref, e.source_key,
               (select count(*)::int from syllabus_progress p where p.syllabus_entry_id = e.uuid) as mark_count
        from syllabus_entry e
        where e.syllabus_id = $1 and e.school_id = $2 and e.status = 'active'
        order by e.seq asc
      `,
      [planId, schoolId],
    );
  }

  private parse(base64: string, fileName?: string): ParsedDoc {
    let buf: Buffer;
    try {
      buf = Buffer.from(stripDataUri(base64), "base64");
    } catch {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid file data");
    }
    if (!buf.length)
      throw new BusinessErrorResult(ErrorCode.BusinessError, "Empty file");
    try {
      return parseDocxBuffer(buf, { fileName });
    } catch (e: any) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `Could not read this .docx: ${e.message}`,
      );
    }
  }

  private gradeMatches(a: string | null, b: string | null): boolean {
    return normText(a) === normText(b);
  }

  // ── preview ────────────────────────────────────────────────────────────────
  public async preview(
    planId: string,
    base64: string,
    fileName: string | undefined,
    schoolId: string,
  ): Promise<any | null> {
    const plan = await this.getPlan(planId, schoolId);
    if (!plan) return null;
    const parsed = this.parse(base64, fileName);
    const existing = await this.loadExisting(planId, schoolId);
    const diff = matchPlan(existing, parsed);
    return this.enrich(plan, parsed, existing, diff, fileName);
  }

  // Turn the id/tmp-based DiffPlan into a self-contained payload the UI can render.
  private enrich(
    plan: PlanRow,
    parsed: ParsedDoc,
    existing: ExistingEntry[],
    diff: DiffPlan,
    fileName?: string,
  ) {
    const exById = new Map(existing.map((e) => [e.uuid, e]));
    const paByTmp = new Map(parsed.nodes.map((n) => [n.tmp, n]));
    const oldView = (id: string) => {
      const e = exById.get(id);
      return e && { uuid: e.uuid, title: e.title, topicNo: e.topicNo, component: e.component, month: e.month, pageRef: e.pageRef, entryType: e.entryType, markCount: e.markCount };
    };
    const newView = (tmp: number) => {
      const n = paByTmp.get(tmp);
      if (!n) return null;
      const parts = deriveTitleParts(n.heading);
      return { tmp, title: parts.title, topicNo: parts.topicNo, component: n.component ?? null, month: n.month, pageRef: n.pageRef, entryType: n.type, parentTmp: n.parent };
    };
    const gradeOk = this.gradeMatches(parsed.grade, plan.grade);
    const subjectOk = normText(parsed.subject) === normText(plan.subjectName);
    return {
      planId: plan.uuid,
      fileName: fileName || null,
      layoutType: diff.layoutType,
      counts: diff.counts,
      sanity: {
        docGrade: parsed.grade,
        planGrade: plan.grade,
        docSubject: parsed.subject,
        planSubject: plan.subjectName,
        ok: gradeOk && subjectOk,
        warning:
          gradeOk && subjectOk
            ? null
            : `This document looks like ${parsed.grade || "?"} · ${parsed.subject || "?"}, but you are on ${plan.grade} · ${plan.subjectName || "?"}. Check you uploaded the right file.`,
      },
      kept: diff.kept.map((k) => ({ ...k, old: oldView(k.oldId), new: newView(k.newTmp) })),
      proposals: diff.proposals.map((p) => ({ ...p, old: oldView(p.oldId), new: newView(p.newTmp) })),
      added: diff.added.map((tmp) => ({ newTmp: tmp, new: newView(tmp) })),
      removed: diff.removed.map((r) => ({ ...r, old: oldView(r.oldId) })),
    };
  }

  // ── apply ────────────────────────────────────────────────────────────────
  public async apply(
    planId: string,
    base64: string,
    fileName: string | undefined,
    decisions: ReconcileDecision[],
    note: string | undefined,
    schoolId: string,
    userId: string,
  ): Promise<any | null> {
    const plan = await this.getPlan(planId, schoolId);
    if (!plan) return null;
    const parsed = this.parse(base64, fileName);
    const existing = await this.loadExisting(planId, schoolId);
    const diff = matchPlan(existing, parsed);

    const { keptMap, addedTmps, removedIds } = this.resolveDecisions(
      diff,
      existing,
      parsed,
      decisions || [],
    );

    // Build tmp → final uuid (kept reuse the existing uuid; added get a fresh one).
    const newTmpToOld = new Map<number, string>();
    for (const [oldId, tmp] of keptMap) newTmpToOld.set(tmp, oldId);
    const tmpToUuid = new Map<number, string>();
    for (const n of parsed.nodes) {
      tmpToUuid.set(n.tmp, newTmpToOld.get(n.tmp) ?? generateShortUuid(12));
    }
    // parent heading lookup (for durable source_key)
    const headingByTmp = new Map(parsed.nodes.map((n) => [n.tmp, n.heading]));
    const childCount = new Map<number, number>();
    for (const n of parsed.nodes) if (n.parent) childCount.set(n.parent, (childCount.get(n.parent) || 0) + 1);

    // 1) snapshot the current state as a revision (pre-apply), then prune.
    await this.snapshotAndPrune(plan, existing, diff, note, schoolId, userId);

    // 2) store the new source doc.
    const stored = await fileStorageService.upload({
      fileName: fileName || `plan-${plan.uuid}.docx`,
      mimeType: DOCX_MIME,
      base64Data: stripDataUri(base64),
      entityType: "syllabus_source",
      entityId: plan.uuid,
      schoolId,
      userId,
      variant: "original",
    });

    // 3) build the write batch.
    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    parsed.nodes.forEach((n, idx) => {
      const uuid = tmpToUuid.get(n.tmp)!;
      const { topicNo, title } = deriveTitleParts(n.heading);
      const parentUuid = n.parent != null ? tmpToUuid.get(n.parent) ?? null : null;
      const isAnchor = (childCount.get(n.tmp) || 0) > 0;
      const parentKey = n.parent != null ? anchorKey(headingByTmp.get(n.parent) || "") : "";
      const skey = isAnchor
        ? `A::${anchorKey(n.heading)}`.slice(0, 64)
        : `${parentKey}::${leafKey(n.component ?? null, n.heading, ordinalPrefix(n.heading))}`.slice(0, 64);
      const isKept = newTmpToOld.has(n.tmp);
      if (isKept) {
        queries.push(singleLineString`
          update syllabus_entry set
            seq = $1, month = $2, entry_type = $3, component = $4, topic_no = $5,
            title = $6, theme = $7, page_ref = $8, parent_entry_id = $9,
            source_key = $10, updatedby_userid = $11, updated_at = $12
          where uuid = $13 and school_id = $14
        `);
        params.push([
          idx, n.month || "april", n.type, n.component ? String(n.component).slice(0, 64) : null,
          topicNo, title.slice(0, 4000), n.theme ? String(n.theme).slice(0, 128) : null,
          n.pageRef ? String(n.pageRef).slice(0, 32) : null, parentUuid, skey, userId, now, uuid, schoolId,
        ]);
      } else {
        queries.push(singleLineString`
          insert into syllabus_entry
          (uuid, school_id, syllabus_id, parent_entry_id, component, seq, month, entry_type,
           topic_no, title, theme, page_ref, source_key, status, createdby_userid, created_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14,$15)
        `);
        params.push([
          uuid, schoolId, plan.uuid, parentUuid, n.component ? String(n.component).slice(0, 64) : null,
          idx, n.month || "april", n.type, topicNo, title.slice(0, 4000),
          n.theme ? String(n.theme).slice(0, 128) : null, n.pageRef ? String(n.pageRef).slice(0, 32) : null,
          skey, userId, now,
        ]);
      }
    });

    // removed → soft-delete + drop their progress (marks the user confirmed losing).
    for (const oldId of removedIds) {
      queries.push(singleLineString`delete from syllabus_progress where syllabus_entry_id = $1 and school_id = $2`);
      params.push([oldId, schoolId]);
      queries.push(singleLineString`update syllabus_entry set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`);
      params.push([userId, now, oldId, schoolId]);
    }

    // plan header: refreshed component layout + new source doc.
    queries.push(singleLineString`
      update syllabus set component_layout = $1, source_file_id = $2, updatedby_userid = $3, updated_at = $4
      where uuid = $5 and school_id = $6
    `);
    params.push([
      JSON.stringify(parsed.components || []), stored.uuid, userId, now, plan.uuid, schoolId,
    ]);

    await DB.queriesInTransaction(queries, params);

    return {
      applied: true,
      counts: {
        kept: keptMap.size,
        added: addedTmps.size,
        removed: removedIds.size,
        changed: diff.kept.filter((k) => k.changes.length > 0).length,
      },
      sourceFileId: stored.uuid,
    };
  }

  // Fold human decisions over the auto-diff → the final keep/add/remove sets.
  // Guardrail: an unresolved proposal or removal that would drop teacher marks
  // aborts the whole apply with a clear message.
  private resolveDecisions(
    diff: DiffPlan,
    existing: ExistingEntry[],
    parsed: ParsedDoc,
    decisions: ReconcileDecision[],
  ): { keptMap: Map<string, number>; addedTmps: Set<number>; removedIds: Set<string> } {
    const exIds = new Set(existing.map((e) => e.uuid));
    const tmps = new Set(parsed.nodes.map((n) => n.tmp));
    const markById = new Map(existing.map((e) => [e.uuid, e.markCount]));

    const keptMap = new Map<string, number>();
    for (const k of diff.kept) keptMap.set(k.oldId, k.newTmp);

    const decidedOld = new Set<string>();
    const decidedNew = new Set<number>();
    for (const d of decisions) {
      if (d.kind === "map") {
        if (!d.oldId || d.newTmp == null || !exIds.has(d.oldId) || !tmps.has(d.newTmp)) {
          throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid mapping decision");
        }
        // enforce 1:1 — drop any prior use of this old or new
        for (const [o, t] of [...keptMap]) if (t === d.newTmp) keptMap.delete(o);
        keptMap.set(d.oldId, d.newTmp);
        decidedOld.add(d.oldId);
        decidedNew.add(d.newTmp);
      } else if (d.kind === "new") {
        if (d.newTmp == null || !tmps.has(d.newTmp)) continue;
        for (const [o, t] of [...keptMap]) if (t === d.newTmp) keptMap.delete(o);
        decidedNew.add(d.newTmp);
      } else if (d.kind === "remove") {
        if (!d.oldId || !exIds.has(d.oldId)) continue;
        keptMap.delete(d.oldId);
        decidedOld.add(d.oldId);
      }
    }

    // Guardrail: attention items that risk marks must be explicitly decided.
    const unresolved: string[] = [];
    for (const p of diff.proposals) {
      const marks = markById.get(p.oldId) || 0;
      if (marks > 0 && !decidedOld.has(p.oldId)) {
        const e = existing.find((x) => x.uuid === p.oldId);
        unresolved.push(`"${e?.title ?? p.oldId}" (${marks} marks) — confirm rename or removal`);
      }
    }
    for (const r of diff.removed) {
      if (r.markCount > 0 && !decidedOld.has(r.oldId)) {
        const e = existing.find((x) => x.uuid === r.oldId);
        unresolved.push(`"${e?.title ?? r.oldId}" (${r.markCount} marks) — confirm removal or map it`);
      }
    }
    if (unresolved.length) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `Resolve these before applying:\n- ${unresolved.join("\n- ")}`,
      );
    }

    const addedTmps = new Set<number>();
    const keptNewTmps = new Set(keptMap.values());
    for (const n of parsed.nodes) if (!keptNewTmps.has(n.tmp)) addedTmps.add(n.tmp);
    const removedIds = new Set<string>();
    for (const e of existing) if (!keptMap.has(e.uuid)) removedIds.add(e.uuid);
    return { keptMap, addedTmps, removedIds };
  }

  // ── revisions ──────────────────────────────────────────────────────────────
  private async snapshotAndPrune(
    plan: PlanRow,
    existing: ExistingEntry[],
    diff: DiffPlan,
    note: string | undefined,
    schoolId: string,
    userId: string,
  ): Promise<void> {
    const nextNo = (await this.maxRevNo(plan.uuid, schoolId)) + 1;
    const snapshot = existing.map((e) => ({
      uuid: e.uuid, seq: e.seq, month: e.month, entryType: e.entryType, topicNo: e.topicNo,
      component: e.component, parentEntryId: e.parentEntryId, title: e.title, theme: e.theme, pageRef: e.pageRef,
    }));
    await DB.query(
      singleLineString`
        insert into syllabus_revision
        (uuid, school_id, syllabus_id, rev_no, note, source_file_id, snapshot, counts, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      [
        generateShortUuid(12), schoolId, plan.uuid, nextNo, note?.slice(0, 256) || null,
        plan.sourceFileId, JSON.stringify(snapshot), JSON.stringify(diff.counts), userId, new Date(),
      ],
    );
    await this.prune(plan.uuid, schoolId);
  }

  private async maxRevNo(planId: string, schoolId: string): Promise<number> {
    const rows = await DB.query(
      singleLineString`select coalesce(max(rev_no), 0) as max_no from syllabus_revision where syllabus_id = $1 and school_id = $2`,
      [planId, schoolId],
    );
    return Number(rows[0]?.maxNo ?? 0);
  }

  // Keep the newest MAX_REVISIONS; delete older rows and their orphaned source docs.
  private async prune(planId: string, schoolId: string): Promise<void> {
    const all = await DB.query(
      singleLineString`select uuid, rev_no, source_file_id from syllabus_revision where syllabus_id = $1 and school_id = $2 order by rev_no desc`,
      [planId, schoolId],
    );
    if (all.length <= MAX_REVISIONS) return;
    const stale = all.slice(MAX_REVISIONS);
    const survivorFiles = new Set(all.slice(0, MAX_REVISIONS).map((r: any) => r.sourceFileId).filter(Boolean));
    const planRow = await DB.query(
      singleLineString`select source_file_id from syllabus where uuid = $1 and school_id = $2`,
      [planId, schoolId],
    );
    const currentFile = planRow[0]?.sourceFileId;
    for (const r of stale) {
      await DB.query(singleLineString`delete from syllabus_revision where uuid = $1 and school_id = $2`, [r.uuid, schoolId]);
      if (r.sourceFileId && r.sourceFileId !== currentFile && !survivorFiles.has(r.sourceFileId)) {
        try { await fileStorageService.delete(r.sourceFileId, schoolId); } catch { /* best-effort */ }
      }
    }
  }

  public async listRevisions(planId: string, schoolId: string): Promise<any[]> {
    return DB.query(
      singleLineString`
        select uuid, rev_no, note, source_file_id, counts, createdby_userid, created_at
        from syllabus_revision where syllabus_id = $1 and school_id = $2 order by rev_no desc
      `,
      [planId, schoolId],
    );
  }

  // Download the .docx a revision (or the current plan) was built from.
  public async getRevisionSource(
    revisionId: string,
    schoolId: string,
  ): Promise<{ fileName: string; mimeType: string; base64: string } | null> {
    const rows = await DB.query(
      singleLineString`select source_file_id from syllabus_revision where uuid = $1 and school_id = $2`,
      [revisionId, schoolId],
    );
    const fileId = rows[0]?.sourceFileId;
    if (!fileId) return null;
    const file = await fileStorageService.getWithData(fileId, schoolId);
    if (!file) return null;
    return { fileName: file.fileName, mimeType: file.mimeType, base64: file.data };
  }
}

export const syllabusReconcileService = new SyllabusReconcileService();
