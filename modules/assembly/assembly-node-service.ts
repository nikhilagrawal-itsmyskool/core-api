import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import {
  AssemblyNode,
  AssemblyNodeDetail,
  CreateNodeRequest,
  UpdateNodeRequest,
  ResponsibleInput,
  ResourceInput,
  NodeResponsibleView,
  NodeResourceView,
} from './assembly-interfaces';
import {
  DEFAULTS, WEEKDAY_VALUES, RESPONSIBLE_TARGET_TYPE_VALUES, RESPONSIBLE_MODES, CYCLE_UNIT_VALUES, Weekday, OwnerType,
} from './assembly-constants';
import { findClass, findEmployee, findStudent, isValidDate } from './assembly-common';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

const NODE_COLS = singleLineString`
  uuid, school_id, owner_type, owner_id, parent_id, depth, sort_order,
  title, description, expectation, recommendation, outcome, start_time,
  duration_minutes, status, createdby_userid, created_at, updatedby_userid, updated_at
`;

// The node content fields tracked for per-field audit on update.
const CONTENT_FIELDS: { key: keyof UpdateNodeRequest; col: string }[] = [
  { key: 'title', col: 'title' },
  { key: 'description', col: 'description' },
  { key: 'expectation', col: 'expectation' },
  { key: 'recommendation', col: 'recommendation' },
  { key: 'outcome', col: 'outcome' },
  { key: 'startTime', col: 'start_time' },
  { key: 'durationMinutes', col: 'duration_minutes' },
];

export interface NodeWriteQuery { q: string; p: any[]; }

// Included template nodes for a given weekday, plus their child sets — the
// shared basis for special-assembly cloning (Phase 3) and date resolve (Phase 5).
export interface CollectedTree {
  nodes: AssemblyNode[];
  responsible: Map<string, NodeResponsibleView[]>;
  resources: Map<string, NodeResourceView[]>;
}

class AssemblyNodeService {
  // ── Create ───────────────────────────────────────────────────────────────────

  public async createNode(
    ownerType: OwnerType, ownerId: string, data: CreateNodeRequest, schoolId: string, userId: string,
  ): Promise<AssemblyNodeDetail> {
    await this.assertOwnerExists(ownerType, ownerId, schoolId);
    if (!data.title || !data.title.trim()) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'title is required');
    }

    let depth = 0;
    let parentId: string | null = null;
    if (data.parentId) {
      const parent = await this.getNodeRow(data.parentId, schoolId);
      if (!parent || parent.ownerType !== ownerType || parent.ownerId !== ownerId) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, 'Invalid parentId for this owner');
      }
      depth = parent.depth + 1;
      parentId = parent.uuid;
    }

    const sortOrder = data.sortOrder ?? (await this.siblingMaxSort(ownerType, ownerId, parentId, schoolId) + 1);
    const uuid = generateShortUuid(12);
    const now = new Date();

    const queries: NodeWriteQuery[] = [];
    queries.push({
      q: singleLineString`
        insert into assembly_node
        (uuid, school_id, owner_type, owner_id, parent_id, depth, sort_order, title, description,
         expectation, recommendation, outcome, start_time, duration_minutes, status, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      `,
      p: [uuid, schoolId, ownerType, ownerId, parentId, depth, sortOrder, data.title.trim(),
        data.description || null, data.expectation || null, data.recommendation || null, data.outcome || null,
        data.startTime || null, data.durationMinutes ?? null, DEFAULTS.STATUS, userId, now],
    });
    queries.push(this.audit(schoolId, uuid, ownerType, ownerId, 'create', null, null, data.title.trim(), userId, now));
    await this.run(queries);

    return (await this.getNodeDetail(uuid, schoolId))!;
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  public async getNodeRow(nodeId: string, schoolId: string): Promise<AssemblyNode | null> {
    const rows = await DB.query(
      singleLineString`select ${NODE_COLS} from assembly_node where uuid = $1 and school_id = $2 and status = 'active'`,
      [nodeId, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async getNodeDetail(nodeId: string, schoolId: string): Promise<AssemblyNodeDetail | null> {
    const node = await this.getNodeRow(nodeId, schoolId);
    if (!node) return null;
    const [days, responsible, resources] = await Promise.all([
      this.loadDays([nodeId], schoolId),
      this.loadResponsible([nodeId], schoolId),
      this.loadResources([nodeId], schoolId),
    ]);
    return {
      ...node,
      days: days.get(nodeId) || [],
      responsible: responsible.get(nodeId) || [],
      resources: resources.get(nodeId) || [],
    };
  }

  // Full authored tree for an owner (plan or special), nested by parent, ordered by sort_order.
  public async getTree(ownerType: OwnerType, ownerId: string, schoolId: string): Promise<AssemblyNodeDetail[]> {
    const nodes: AssemblyNode[] = await DB.query(
      singleLineString`
        select ${NODE_COLS} from assembly_node
        where owner_type = $1 and owner_id = $2 and school_id = $3 and status = 'active'
        order by depth, sort_order
      `,
      [ownerType, ownerId, schoolId],
    );
    if (nodes.length === 0) return [];
    const ids = nodes.map(n => n.uuid);
    const [days, responsible, resources] = await Promise.all([
      this.loadDays(ids, schoolId),
      this.loadResponsible(ids, schoolId),
      this.loadResources(ids, schoolId),
    ]);

    const byId = new Map<string, AssemblyNodeDetail>();
    for (const n of nodes) {
      byId.set(n.uuid, {
        ...n,
        days: days.get(n.uuid) || [],
        responsible: responsible.get(n.uuid) || [],
        resources: resources.get(n.uuid) || [],
        children: [],
      });
    }
    const roots: AssemblyNodeDetail[] = [];
    for (const n of nodes) {
      const detail = byId.get(n.uuid)!;
      if (n.parentId && byId.has(n.parentId)) byId.get(n.parentId)!.children!.push(detail);
      else roots.push(detail);
    }
    return roots;
  }

  // ── Update content ───────────────────────────────────────────────────────────

  public async updateNode(nodeId: string, data: UpdateNodeRequest, schoolId: string, userId: string): Promise<AssemblyNodeDetail | null> {
    const existing = await this.getNodeRow(nodeId, schoolId);
    if (!existing) return null;
    if (data.title !== undefined && !String(data.title).trim()) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'title cannot be blank');
    }

    const updates: string[] = [];
    const params: any[] = [];
    const auditRows: NodeWriteQuery[] = [];
    const now = new Date();
    let i = 1;

    for (const f of CONTENT_FIELDS) {
      if (data[f.key] === undefined) continue;
      let val: any = data[f.key];
      if (typeof val === 'string') val = val.trim();
      if (val === '' ) val = null;
      if (f.key === 'title' && val) val = String(val).trim();
      updates.push(`${f.col} = $${i++}`);
      params.push(val ?? null);
      const oldVal = (existing as any)[f.key];
      auditRows.push(this.audit(schoolId, nodeId, existing.ownerType, existing.ownerId, 'update', f.col,
        oldVal == null ? null : String(oldVal), val == null ? null : String(val), userId, now));
    }

    if (updates.length === 0) return this.getNodeDetail(nodeId, schoolId);
    updates.push(`updatedby_userid = $${i++}`); params.push(userId);
    updates.push(`updated_at = $${i++}`); params.push(now);
    params.push(nodeId, schoolId);

    const queries: NodeWriteQuery[] = [{
      q: singleLineString`update assembly_node set ${updates.join(', ')} where uuid = $${i++} and school_id = $${i++} and status = 'active'`,
      p: params,
    }, ...auditRows];
    await this.run(queries);
    return this.getNodeDetail(nodeId, schoolId);
  }

  // ── Delete (subtree) ───────────────────────────────────────────────────────

  public async deleteNode(nodeId: string, schoolId: string, userId: string): Promise<boolean> {
    const node = await this.getNodeRow(nodeId, schoolId);
    if (!node) return false;
    const ctx = await this.loadOwnerNodes(node.ownerType, node.ownerId, schoolId);
    const subtree = this.collectSubtree(nodeId, ctx.childrenOf); // includes nodeId
    const now = new Date();
    const ph = subtree.map((_, idx) => `$${idx + 3}`).join(', '); // ids at $3.. (after userId,$1 and now,$2)
    const phId = subtree.map((_, idx) => `$${idx + 1}`).join(', '); // ids at $1.. (no prefix params)

    const queries: NodeWriteQuery[] = [
      { q: singleLineString`update assembly_node set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid in (${ph})`, p: [userId, now, ...subtree] },
      { q: singleLineString`update assembly_node_responsible set status = 'deleted', updatedby_userid = $1, updated_at = $2 where node_id in (${ph}) and status = 'active'`, p: [userId, now, ...subtree] },
      { q: singleLineString`update assembly_node_resource set status = 'deleted', updatedby_userid = $1, updated_at = $2 where node_id in (${ph}) and status = 'active'`, p: [userId, now, ...subtree] },
      { q: singleLineString`delete from assembly_node_day where node_id in (${phId})`, p: [...subtree] },
    ];
    for (const id of subtree) {
      queries.push(this.audit(schoolId, id, node.ownerType, node.ownerId, 'delete', null, null, null, userId, now));
    }
    await this.run(queries);
    return true;
  }

  // ── Reorder siblings ─────────────────────────────────────────────────────────

  public async reorderNodes(
    ownerType: OwnerType, ownerId: string, parentId: string | null, order: string[], schoolId: string, userId: string,
  ): Promise<AssemblyNodeDetail[]> {
    await this.assertOwnerExists(ownerType, ownerId, schoolId);
    if (!Array.isArray(order) || order.length === 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'order array is required');
    }
    // All ids must be active siblings under the same parent for this owner.
    const siblings: AssemblyNode[] = await DB.query(
      singleLineString`
        select uuid from assembly_node
        where owner_type = $1 and owner_id = $2 and school_id = $3 and status = 'active'
          and ${parentId ? 'parent_id = $4' : 'parent_id is null'}
      `,
      parentId ? [ownerType, ownerId, schoolId, parentId] : [ownerType, ownerId, schoolId],
    );
    const sibIds = new Set(siblings.map(s => s.uuid));
    if (order.length !== sibIds.size || !order.every(id => sibIds.has(id))) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'order must list exactly the sibling nodes of this parent');
    }

    const now = new Date();
    const queries: NodeWriteQuery[] = order.map((id, idx) => ({
      q: singleLineString`update assembly_node set sort_order = $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5`,
      p: [idx, userId, now, id, schoolId],
    }));
    queries.push(this.audit(schoolId, parentId || 'root', ownerType, ownerId, 'reorder', 'sort_order', null, order.join(','), userId, now));
    await this.run(queries);
    return this.getTree(ownerType, ownerId, schoolId);
  }

  // ── Days (subset-validated, inheritance-aware) ───────────────────────────────

  public async setNodeDays(nodeId: string, days: Weekday[], schoolId: string, userId: string): Promise<AssemblyNodeDetail | null> {
    const node = await this.getNodeRow(nodeId, schoolId);
    if (!node) return null;
    const proposed = this.normalizeDays(days);

    const ctx = await this.loadOwnerNodes(node.ownerType, node.ownerId, schoolId);
    const explicit = await this.loadAllDays(node.ownerType, node.ownerId, schoolId); // nodeId -> weekday[]
    const planDays = node.ownerType === 'plan'
      ? await this.planDays(node.ownerId, schoolId)
      : [...WEEKDAY_VALUES] as Weekday[];

    // Ceiling for THIS node = parent's effective days (or plan days at the root).
    const effectiveOf = this.makeEffectiveResolver(ctx.byId, explicit, planDays);
    const ceiling = node.parentId ? effectiveOf(node.parentId) : planDays;
    if (proposed.length > 0) {
      const outside = proposed.filter(d => !ceiling.includes(d));
      if (outside.length > 0) {
        throw new BusinessErrorResult(ErrorCode.BusinessError,
          `Weekday(s) not allowed by parent: ${outside.join(', ')} (parent runs ${ceiling.join(', ') || 'no days'})`);
      }
    }

    // Tentatively apply and re-validate the subtree: every descendant with explicit
    // days must remain a subset of its (possibly changed) parent's effective days.
    explicit.set(nodeId, proposed);
    const effective2 = this.makeEffectiveResolver(ctx.byId, explicit, planDays);
    const subtree = this.collectSubtree(nodeId, ctx.childrenOf);
    for (const id of subtree) {
      const own = explicit.get(id);
      if (!own || own.length === 0) continue;
      const node2 = ctx.byId.get(id)!;
      const parentEff = node2.parentId ? effective2(node2.parentId) : planDays;
      const bad = own.filter(d => !parentEff.includes(d));
      if (bad.length > 0) {
        throw new BusinessErrorResult(ErrorCode.BusinessError,
          `Descendant "${node2.title}" has weekday(s) ${bad.join(', ')} that would fall outside its parent — adjust it first`);
      }
    }

    const now = new Date();
    const queries: NodeWriteQuery[] = [{ q: singleLineString`delete from assembly_node_day where node_id = $1`, p: [nodeId] }];
    for (const weekday of proposed) {
      queries.push({
        q: singleLineString`insert into assembly_node_day (uuid, school_id, node_id, weekday, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6)`,
        p: [generateShortUuid(12), schoolId, nodeId, weekday, userId, now],
      });
    }
    queries.push(this.audit(schoolId, nodeId, node.ownerType, node.ownerId, 'update', 'days',
      (await this.loadDays([nodeId], schoolId)).get(nodeId)?.join(',') || null, proposed.join(',') || null, userId, now));
    await this.run(queries);
    return this.getNodeDetail(nodeId, schoolId);
  }

  // ── Responsible set (replace) ────────────────────────────────────────────────

  public async setNodeResponsible(nodeId: string, entries: ResponsibleInput[], schoolId: string, userId: string): Promise<AssemblyNodeDetail | null> {
    const node = await this.getNodeRow(nodeId, schoolId);
    if (!node) return null;
    if (!Array.isArray(entries)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'responsible array is required');

    const now = new Date();
    const rows: any[][] = [];
    for (let idx = 0; idx < entries.length; idx++) {
      const e = entries[idx];
      if (!RESPONSIBLE_TARGET_TYPE_VALUES.includes(e.targetType)) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid targetType: ${e.targetType}`);
      }
      let targetId: string | null = null;
      let targetText: string | null = null;
      let targetName: string | null = null;
      if (e.targetType === 'text') {
        if (!e.targetText || !e.targetText.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, 'targetText is required for a text responsible');
        targetText = e.targetText.trim();
      } else {
        if (!e.targetId) throw new BusinessErrorResult(ErrorCode.BusinessError, `targetId is required for a ${e.targetType} responsible`);
        const found = e.targetType === 'employee' ? await findEmployee(schoolId, e.targetId)
          : e.targetType === 'class' ? await findClass(schoolId, e.targetId)
          : await findStudent(schoolId, e.targetId);
        if (!found) throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid ${e.targetType} targetId: ${e.targetId}`);
        targetId = e.targetId;
        targetName = found.name;
      }
      // Time-aware validation.
      const mode = e.mode || null;
      if (mode && !RESPONSIBLE_MODES.includes(mode)) throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid responsible mode: ${e.mode}`);
      for (const [label, d] of [['startDate', e.startDate], ['endDate', e.endDate], ['anchorDate', e.anchorDate]] as const) {
        if (d && !isValidDate(d)) throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid ${label} (yyyy-mm-dd)`);
      }
      if (e.startDate && e.endDate && e.endDate < e.startDate) throw new BusinessErrorResult(ErrorCode.BusinessError, 'endDate must be on or after startDate');
      if (mode === 'rotating') {
        if (!e.cycleUnit || !CYCLE_UNIT_VALUES.includes(e.cycleUnit)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'A rotating responsible needs cycleUnit (weekly|monthly)');
        if (!e.anchorDate) throw new BusinessErrorResult(ErrorCode.BusinessError, 'A rotating responsible needs an anchorDate');
        if (!e.ruleGroup) throw new BusinessErrorResult(ErrorCode.BusinessError, 'A rotating responsible needs a ruleGroup (shared by its members)');
      }
      rows.push([generateShortUuid(12), schoolId, nodeId, e.role?.trim() || null, e.targetType, targetId, targetText, targetName, idx,
        e.startDate || null, e.endDate || null, mode, mode === 'rotating' ? e.cycleUnit : null, e.anchorDate || null, e.ruleGroup || null,
        DEFAULTS.STATUS, userId, now]);
    }

    const queries: NodeWriteQuery[] = [{
      q: singleLineString`update assembly_node_responsible set status = 'deleted', updatedby_userid = $1, updated_at = $2 where node_id = $3 and status = 'active'`,
      p: [userId, now, nodeId],
    }];
    for (const r of rows) {
      queries.push({
        q: singleLineString`insert into assembly_node_responsible (uuid, school_id, node_id, role, target_type, target_id, target_text, target_name, sort_order, start_date, end_date, mode, cycle_unit, anchor_date, rule_group, status, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        p: r,
      });
    }
    queries.push(this.audit(schoolId, nodeId, node.ownerType, node.ownerId, 'update', 'responsible', null, `${rows.length} party(ies)`, userId, now));
    await this.run(queries);
    return this.getNodeDetail(nodeId, schoolId);
  }

  // ── Resource set (replace) ───────────────────────────────────────────────────

  public async setNodeResources(nodeId: string, entries: ResourceInput[], schoolId: string, userId: string): Promise<AssemblyNodeDetail | null> {
    const node = await this.getNodeRow(nodeId, schoolId);
    if (!node) return null;
    if (!Array.isArray(entries)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'resources array is required');

    const now = new Date();
    const rows: any[][] = [];
    entries.forEach((e, idx) => {
      const label = e.label?.trim() || null;
      const url = e.url?.trim() || null;
      const note = e.note?.trim() || null;
      if (!label && !url && !note) return; // skip fully-empty rows
      rows.push([generateShortUuid(12), schoolId, nodeId, label, url, note, idx, DEFAULTS.STATUS, userId, now]);
    });

    const queries: NodeWriteQuery[] = [{
      q: singleLineString`update assembly_node_resource set status = 'deleted', updatedby_userid = $1, updated_at = $2 where node_id = $3 and status = 'active'`,
      p: [userId, now, nodeId],
    }];
    for (const r of rows) {
      queries.push({
        q: singleLineString`insert into assembly_node_resource (uuid, school_id, node_id, label, url, note, sort_order, status, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        p: r,
      });
    }
    queries.push(this.audit(schoolId, nodeId, node.ownerType, node.ownerId, 'update', 'resources', null, `${rows.length} resource(s)`, userId, now));
    await this.run(queries);
    return this.getNodeDetail(nodeId, schoolId);
  }

  // ── Clone / resolve support (used by special assemblies + date resolve) ──────

  // The template nodes of a plan that RUN on the given weekday (own-or-inherited
  // effective days include it), ordered depth→sort, plus their child sets.
  // Because a child's effective days are always ⊆ its parent's, the included set
  // is a well-formed forest (no included node ever has an excluded parent).
  public async collectForClone(planId: string, schoolId: string, weekday: Weekday): Promise<CollectedTree> {
    const ctx = await this.loadOwnerNodes('plan', planId, schoolId);
    const explicit = await this.loadAllDays('plan', planId, schoolId);
    const planDays = await this.planDays(planId, schoolId);
    const eff = this.makeEffectiveResolver(ctx.byId, explicit, planDays);
    const nodes = [...ctx.byId.values()]
      .filter(n => eff(n.uuid).includes(weekday))
      .sort((a, b) => a.depth - b.depth || a.sortOrder - b.sortOrder);
    const ids = nodes.map(n => n.uuid);
    const [responsible, resources] = await Promise.all([
      this.loadResponsible(ids, schoolId),
      this.loadResources(ids, schoolId),
    ]);
    return { nodes, responsible, resources };
  }

  // Nested day-filtered template tree for a weekday (nodes that RUN that day),
  // with explicit responsible/resources attached — the read basis for resolve.
  public async getFilteredTree(planId: string, schoolId: string, weekday: Weekday): Promise<AssemblyNodeDetail[]> {
    const { nodes, responsible, resources } = await this.collectForClone(planId, schoolId, weekday);
    const byId = new Map<string, AssemblyNodeDetail>();
    for (const n of nodes) {
      byId.set(n.uuid, {
        ...n, days: [], responsible: responsible.get(n.uuid) || [], resources: resources.get(n.uuid) || [], children: [],
      });
    }
    const roots: AssemblyNodeDetail[] = [];
    for (const n of nodes) {
      const d = byId.get(n.uuid)!;
      if (n.parentId && byId.has(n.parentId)) byId.get(n.parentId)!.children!.push(d);
      else roots.push(d);
    }
    return roots;
  }

  // Deep-copy the day-filtered plan tree into an independent special-owned tree.
  // Returns the insert/audit queries so the caller can run them in one transaction
  // alongside the special row insert.
  public async buildCloneQueries(
    specialId: string, planId: string, schoolId: string, weekday: Weekday, userId: string, now: Date,
  ): Promise<{ queries: NodeWriteQuery[]; nodeCount: number }> {
    const collected = await this.collectForClone(planId, schoolId, weekday);
    const idMap = new Map<string, string>();
    for (const n of collected.nodes) idMap.set(n.uuid, generateShortUuid(12));

    const queries: NodeWriteQuery[] = [];
    for (const n of collected.nodes) {
      const newId = idMap.get(n.uuid)!;
      const newParent = n.parentId ? (idMap.get(n.parentId) || null) : null;
      queries.push({
        q: singleLineString`
          insert into assembly_node
          (uuid, school_id, owner_type, owner_id, parent_id, depth, sort_order, title, description,
           expectation, recommendation, outcome, start_time, duration_minutes, status, createdby_userid, created_at)
          values ($1,$2,'special',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        `,
        p: [newId, schoolId, specialId, newParent, n.depth, n.sortOrder, n.title, n.description ?? null,
          n.expectation ?? null, n.recommendation ?? null, n.outcome ?? null, n.startTime ?? null,
          n.durationMinutes ?? null, DEFAULTS.STATUS, userId, now],
      });
      queries.push(this.audit(schoolId, newId, 'special', specialId, 'create', null, null, n.title, userId, now));
      for (const r of collected.responsible.get(n.uuid) || []) {
        queries.push({
          q: singleLineString`insert into assembly_node_responsible (uuid, school_id, node_id, role, target_type, target_id, target_text, target_name, sort_order, start_date, end_date, mode, cycle_unit, anchor_date, rule_group, status, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          p: [generateShortUuid(12), schoolId, newId, r.role ?? null, r.targetType, r.targetId ?? null, r.targetText ?? null, r.targetName ?? null, r.sortOrder, r.startDate ?? null, r.endDate ?? null, r.mode ?? null, r.cycleUnit ?? null, r.anchorDate ?? null, r.ruleGroup ?? null, DEFAULTS.STATUS, userId, now],
        });
      }
      for (const res of collected.resources.get(n.uuid) || []) {
        queries.push({
          q: singleLineString`insert into assembly_node_resource (uuid, school_id, node_id, label, url, note, sort_order, status, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          p: [generateShortUuid(12), schoolId, newId, res.label ?? null, res.url ?? null, res.note ?? null, res.sortOrder, DEFAULTS.STATUS, userId, now],
        });
      }
    }
    return { queries, nodeCount: collected.nodes.length };
  }

  // Deep-copy an ENTIRE plan tree (all nodes, all weekdays) into a new plan —
  // nodes + their day rows + responsible + resources. Used by plan clone.
  public async buildFullPlanCloneQueries(
    newPlanId: string, sourcePlanId: string, schoolId: string, userId: string, now: Date,
  ): Promise<NodeWriteQuery[]> {
    const nodes: AssemblyNode[] = await DB.query(
      singleLineString`
        select ${NODE_COLS} from assembly_node
        where owner_type = 'plan' and owner_id = $1 and school_id = $2 and status = 'active'
        order by depth, sort_order
      `,
      [sourcePlanId, schoolId],
    );
    const ids = nodes.map(n => n.uuid);
    const [days, responsible, resources] = await Promise.all([
      this.loadDays(ids, schoolId),
      this.loadResponsible(ids, schoolId),
      this.loadResources(ids, schoolId),
    ]);
    const idMap = new Map<string, string>();
    for (const n of nodes) idMap.set(n.uuid, generateShortUuid(12));

    const queries: NodeWriteQuery[] = [];
    for (const n of nodes) {
      const newId = idMap.get(n.uuid)!;
      const newParent = n.parentId ? (idMap.get(n.parentId) || null) : null;
      queries.push({
        q: singleLineString`
          insert into assembly_node
          (uuid, school_id, owner_type, owner_id, parent_id, depth, sort_order, title, description,
           expectation, recommendation, outcome, start_time, duration_minutes, status, createdby_userid, created_at)
          values ($1,$2,'plan',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        `,
        p: [newId, schoolId, newPlanId, newParent, n.depth, n.sortOrder, n.title, n.description ?? null,
          n.expectation ?? null, n.recommendation ?? null, n.outcome ?? null, n.startTime ?? null,
          n.durationMinutes ?? null, DEFAULTS.STATUS, userId, now],
      });
      queries.push(this.audit(schoolId, newId, 'plan', newPlanId, 'create', null, null, n.title, userId, now));
      for (const wd of days.get(n.uuid) || []) {
        queries.push({
          q: singleLineString`insert into assembly_node_day (uuid, school_id, node_id, weekday, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6)`,
          p: [generateShortUuid(12), schoolId, newId, wd, userId, now],
        });
      }
      for (const r of responsible.get(n.uuid) || []) {
        queries.push({
          q: singleLineString`insert into assembly_node_responsible (uuid, school_id, node_id, role, target_type, target_id, target_text, target_name, sort_order, start_date, end_date, mode, cycle_unit, anchor_date, rule_group, status, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          p: [generateShortUuid(12), schoolId, newId, r.role ?? null, r.targetType, r.targetId ?? null, r.targetText ?? null, r.targetName ?? null, r.sortOrder, r.startDate ?? null, r.endDate ?? null, r.mode ?? null, r.cycleUnit ?? null, r.anchorDate ?? null, r.ruleGroup ?? null, DEFAULTS.STATUS, userId, now],
        });
      }
      for (const res of resources.get(n.uuid) || []) {
        queries.push({
          q: singleLineString`insert into assembly_node_resource (uuid, school_id, node_id, label, url, note, sort_order, status, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          p: [generateShortUuid(12), schoolId, newId, res.label ?? null, res.url ?? null, res.note ?? null, res.sortOrder, DEFAULTS.STATUS, userId, now],
        });
      }
    }
    return queries;
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  private async assertOwnerExists(ownerType: OwnerType, ownerId: string, schoolId: string): Promise<void> {
    const table = ownerType === 'plan' ? 'assembly_plan' : 'assembly_special';
    const rows = await DB.query(
      singleLineString`select 1 from ${table} where uuid = $1 and school_id = $2 and status = 'active'`,
      [ownerId, schoolId],
    );
    if (rows.length === 0) throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid ${ownerType} id`);
  }

  private async siblingMaxSort(ownerType: OwnerType, ownerId: string, parentId: string | null, schoolId: string): Promise<number> {
    const rows = await DB.query(
      singleLineString`
        select coalesce(max(sort_order), -1) as max from assembly_node
        where owner_type = $1 and owner_id = $2 and school_id = $3 and status = 'active'
          and ${parentId ? 'parent_id = $4' : 'parent_id is null'}
      `,
      parentId ? [ownerType, ownerId, schoolId, parentId] : [ownerType, ownerId, schoolId],
    );
    return Number(rows[0].max);
  }

  private async planDays(planId: string, schoolId: string): Promise<Weekday[]> {
    const rows = await DB.query(
      singleLineString`select weekday from assembly_plan_day where plan_id = $1 and school_id = $2`,
      [planId, schoolId],
    );
    return this.orderDays(rows.map((r: any) => r.weekday));
  }

  private async loadOwnerNodes(ownerType: OwnerType, ownerId: string, schoolId: string) {
    const nodes: AssemblyNode[] = await DB.query(
      singleLineString`select ${NODE_COLS} from assembly_node where owner_type = $1 and owner_id = $2 and school_id = $3 and status = 'active'`,
      [ownerType, ownerId, schoolId],
    );
    const byId = new Map<string, AssemblyNode>();
    const childrenOf = new Map<string, string[]>();
    for (const n of nodes) {
      byId.set(n.uuid, n);
      const key = n.parentId || 'root';
      if (!childrenOf.has(key)) childrenOf.set(key, []);
      childrenOf.get(key)!.push(n.uuid);
    }
    return { byId, childrenOf };
  }

  private async loadAllDays(ownerType: OwnerType, ownerId: string, schoolId: string): Promise<Map<string, Weekday[]>> {
    const rows = await DB.query(
      singleLineString`
        select d.node_id, d.weekday from assembly_node_day d
        join assembly_node n on n.uuid = d.node_id
        where n.owner_type = $1 and n.owner_id = $2 and d.school_id = $3 and n.status = 'active'
      `,
      [ownerType, ownerId, schoolId],
    );
    const map = new Map<string, Weekday[]>();
    for (const r of rows) {
      if (!map.has(r.nodeId)) map.set(r.nodeId, []);
      map.get(r.nodeId)!.push(r.weekday);
    }
    for (const [k, v] of map) map.set(k, this.orderDays(v));
    return map;
  }

  // Returns a memoized resolver: nodeId -> effective weekdays (own explicit, else inherit, else plan days).
  private makeEffectiveResolver(byId: Map<string, AssemblyNode>, explicit: Map<string, Weekday[]>, planDays: Weekday[]) {
    const memo = new Map<string, Weekday[]>();
    const resolve = (id: string): Weekday[] => {
      if (memo.has(id)) return memo.get(id)!;
      const own = explicit.get(id);
      let result: Weekday[];
      if (own && own.length > 0) result = own;
      else {
        const node = byId.get(id);
        result = node && node.parentId ? resolve(node.parentId) : planDays;
      }
      memo.set(id, result);
      return result;
    };
    return resolve;
  }

  private collectSubtree(rootId: string, childrenOf: Map<string, string[]>): string[] {
    const out: string[] = [];
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop()!;
      out.push(id);
      for (const c of childrenOf.get(id) || []) stack.push(c);
    }
    return out;
  }

  private async loadDays(nodeIds: string[], schoolId: string): Promise<Map<string, Weekday[]>> {
    if (nodeIds.length === 0) return new Map();
    const ph = nodeIds.map((_, i) => `$${i + 2}`).join(', ');
    const rows = await DB.query(
      singleLineString`select node_id, weekday from assembly_node_day where school_id = $1 and node_id in (${ph})`,
      [schoolId, ...nodeIds],
    );
    const map = new Map<string, Weekday[]>();
    for (const r of rows) {
      if (!map.has(r.nodeId)) map.set(r.nodeId, []);
      map.get(r.nodeId)!.push(r.weekday);
    }
    for (const [k, v] of map) map.set(k, this.orderDays(v));
    return map;
  }

  private async loadResponsible(nodeIds: string[], schoolId: string): Promise<Map<string, NodeResponsibleView[]>> {
    if (nodeIds.length === 0) return new Map();
    const ph = nodeIds.map((_, i) => `$${i + 2}`).join(', ');
    const rows = await DB.query(
      singleLineString`
        select uuid, node_id, role, target_type, target_id, target_text, target_name, sort_order,
          start_date::text as start_date, end_date::text as end_date, mode,
          cycle_unit, anchor_date::text as anchor_date, rule_group
        from assembly_node_responsible where school_id = $1 and node_id in (${ph}) and status = 'active'
        order by sort_order
      `,
      [schoolId, ...nodeIds],
    );
    const map = new Map<string, NodeResponsibleView[]>();
    for (const r of rows) {
      if (!map.has(r.nodeId)) map.set(r.nodeId, []);
      map.get(r.nodeId)!.push({
        uuid: r.uuid, role: r.role, targetType: r.targetType, targetId: r.targetId,
        targetText: r.targetText, targetName: r.targetName, sortOrder: r.sortOrder,
        startDate: r.startDate || undefined, endDate: r.endDate || undefined,
        mode: r.mode || undefined, cycleUnit: r.cycleUnit || undefined,
        anchorDate: r.anchorDate || undefined, ruleGroup: r.ruleGroup || undefined,
      });
    }
    return map;
  }

  private async loadResources(nodeIds: string[], schoolId: string): Promise<Map<string, NodeResourceView[]>> {
    if (nodeIds.length === 0) return new Map();
    const ph = nodeIds.map((_, i) => `$${i + 2}`).join(', ');
    const rows = await DB.query(
      singleLineString`
        select uuid, node_id, label, url, note, sort_order
        from assembly_node_resource where school_id = $1 and node_id in (${ph}) and status = 'active'
        order by sort_order
      `,
      [schoolId, ...nodeIds],
    );
    const map = new Map<string, NodeResourceView[]>();
    for (const r of rows) {
      if (!map.has(r.nodeId)) map.set(r.nodeId, []);
      map.get(r.nodeId)!.push({ uuid: r.uuid, label: r.label, url: r.url, note: r.note, sortOrder: r.sortOrder });
    }
    return map;
  }

  private audit(
    schoolId: string, nodeId: string, ownerType: OwnerType, ownerId: string, action: string,
    changedField: string | null, oldValue: string | null, newValue: string | null, userId: string, now: Date,
  ): NodeWriteQuery {
    return {
      q: singleLineString`
        insert into assembly_node_audit
        (uuid, school_id, node_id, owner_type, owner_id, action, changed_field, old_value, new_value, changedby_userid, changed_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `,
      p: [generateShortUuid(12), schoolId, nodeId, ownerType, ownerId, action, changedField, oldValue, newValue, userId, now],
    };
  }

  private async run(queries: NodeWriteQuery[]): Promise<void> {
    await DB.queriesInTransaction(queries.map(q => q.q), queries.map(q => q.p));
  }

  private normalizeDays(days: Weekday[]): Weekday[] {
    if (!Array.isArray(days)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'days must be an array of weekdays');
    const unique = [...new Set(days)];
    for (const d of unique) {
      if (!WEEKDAY_VALUES.includes(d)) throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid weekday: ${d}`);
    }
    return this.orderDays(unique);
  }

  private orderDays(days: string[]): Weekday[] {
    return WEEKDAY_VALUES.filter(w => days.includes(w)) as Weekday[];
  }
}

export const assemblyNodeService = new AssemblyNodeService();
