import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { istToday } from '../../shared/util/datetime';
import {
  Asset, CreateAssetRequest, UpdateAssetRequest, AssetTreeNode,
  EffectiveResponsibility, MoveRequest, IndividualizeRequest,
  SetResponsibilityRequest, AssetMovement,
} from './asset-interfaces';
import { DEFAULTS } from './asset-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

// Columns selected for an asset read, with resolved type + own-responsible name.
const ASSET_SELECT = singleLineString`
  select a.*, t.code as type_code, t.label as type_label, t.kind, e.name as responsible_name
  from asset a
  left join asset_type t on a.type_id = t.uuid
  left join employee e on a.responsible_id = e.uuid
`;

class AssetService {
  public async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const results = await DB.query(
      singleLineString`select uuid from school where lower(code) = lower($1)`,
      [schoolCode]
    );
    return results.length > 0 ? results[0].uuid : null;
  }

  // ---- helpers ----

  private async getTypeIfActive(typeId: string, schoolId: string): Promise<any | null> {
    const r = await DB.query(
      singleLineString`select * from asset_type where uuid = $1 and school_id = $2 and status = 'active'`,
      [typeId, schoolId]
    );
    return r.length > 0 ? r[0] : null;
  }

  private async getRaw(id: string, schoolId: string): Promise<any | null> {
    const r = await DB.query(
      singleLineString`select * from asset where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId]
    );
    return r.length > 0 ? r[0] : null;
  }

  // Walk up the ancestor chain (inclusive of startId) and return rows ordered by depth.
  private async ancestorChain(startId: string, schoolId: string): Promise<any[]> {
    const query = singleLineString`
      with recursive chain as (
        select uuid, parent_id, responsible_id, 0 as depth
        from asset where uuid = $1 and school_id = $2 and status = 'active'
        union all
        select a.uuid, a.parent_id, a.responsible_id, c.depth + 1
        from asset a join chain c on a.uuid = c.parent_id
        where a.school_id = $2 and a.status = 'active'
      )
      select uuid, parent_id, responsible_id, depth from chain order by depth
    `;
    return DB.query(query, [startId, schoolId]);
  }

  // Effective responsible id by walking up from startId (inclusive). undefined if none.
  private async effectiveIdFrom(startId: string | null | undefined, schoolId: string): Promise<string | undefined> {
    if (!startId) return undefined;
    const chain = await this.ancestorChain(startId, schoolId);
    for (const row of chain) {
      if (row.responsibleId) return row.responsibleId;
    }
    return undefined;
  }

  private async resolveEmployeeNames(ids: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(ids.filter((x) => !!x))];
    if (unique.length === 0) return {};
    const placeholders = unique.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await DB.query(
      singleLineString`select uuid, name from employee where uuid in (${placeholders})`,
      unique
    );
    const map: Record<string, string> = {};
    for (const r of rows) map[r.uuid] = r.name;
    return map;
  }

  // ---- CRUD ----

  public async create(data: CreateAssetRequest, schoolId: string, userId: string): Promise<Asset> {
    const type = await this.getTypeIfActive(data.typeId, schoolId);
    if (!type) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Invalid or unknown asset type');
    }

    if (data.parentId) {
      const parent = await this.getRaw(data.parentId, schoolId);
      if (!parent) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, 'Parent asset not found');
      }
    }

    const quantity = data.quantity ?? DEFAULTS.QUANTITY;
    if (quantity < 1) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Quantity must be at least 1');
    }

    // Tag resolution: an explicit code wins; otherwise auto-tag containers and
    // single (quantity 1) items whose type participates in tags. Quantity buckets
    // (uncounted multiples) stay untagged until individualized.
    let assetCode: string | null = null;
    let tagSeq: number | null = null;
    if (data.assetCode && data.assetCode.trim()) {
      assetCode = data.assetCode.trim();
      await this.assertCodesFree([assetCode], schoolId);
    } else if (this.shouldAutoTag(type, quantity)) {
      tagSeq = await this.nextTagSeq(data.parentId || null, type.tagAbbr, schoolId);
      assetCode = await this.composeNewCode(data.parentId || null, type, tagSeq, schoolId);
    }

    const uuid = generateShortUuid(12);
    const now = new Date();
    const query = singleLineString`
      insert into asset
      (uuid, school_id, type_id, name, parent_id, quantity, asset_code, tag_seq, asset_condition,
       responsible_id, responsibility_remarks, asset_status, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      returning uuid
    `;
    const params = [
      uuid, schoolId, data.typeId, data.name.trim(), data.parentId || null, quantity, assetCode, tagSeq,
      data.assetCondition || null, data.responsibleId || null, data.responsibilityRemarks || null,
      data.assetStatus || DEFAULTS.ASSET_STATUS, DEFAULTS.STATUS, userId, now,
    ];
    await DB.query(query, params);
    return (await this.getById(uuid, schoolId)) as Asset;
  }

  public async getById(id: string, schoolId: string): Promise<Asset | null> {
    const r = await DB.query(`${ASSET_SELECT} where a.uuid = $1 and a.school_id = $2 and a.status = 'active'`, [id, schoolId]);
    return r.length > 0 ? r[0] : null;
  }

  public async search(
    schoolId: string,
    filters: { typeId?: string; parentId?: string; responsibleId?: string; assetStatus?: string; hasCode?: boolean; search?: string }
  ): Promise<Asset[]> {
    let query = `${ASSET_SELECT} where a.school_id = $1 and a.status = 'active'`;
    const params: any[] = [schoolId];
    let i = 2;

    if (filters.typeId) {
      query += ` and a.type_id = $${i++}`;
      params.push(filters.typeId);
    }
    if (filters.parentId !== undefined) {
      if (filters.parentId === 'null' || filters.parentId === '') {
        query += ` and a.parent_id is null`;
      } else {
        query += ` and a.parent_id = $${i++}`;
        params.push(filters.parentId);
      }
    }
    if (filters.responsibleId) {
      query += ` and a.responsible_id = $${i++}`;
      params.push(filters.responsibleId);
    }
    if (filters.assetStatus) {
      query += ` and a.asset_status = $${i++}`;
      params.push(filters.assetStatus);
    }
    if (filters.hasCode !== undefined) {
      query += filters.hasCode ? ` and a.asset_code is not null` : ` and a.asset_code is null`;
    }
    if (filters.search && filters.search.trim()) {
      query += ` and (lower(a.name) like lower($${i}) or lower(a.asset_code) like lower($${i}))`;
      params.push(`%${filters.search.trim()}%`);
      i++;
    }

    query += ` order by a.name`;
    return DB.query(query, params);
  }

  public async update(id: string, data: UpdateAssetRequest, schoolId: string, userId: string): Promise<Asset | null> {
    const existing = await this.getRaw(id, schoolId);
    if (!existing) return null;

    if (data.typeId !== undefined) {
      const type = await this.getTypeIfActive(data.typeId, schoolId);
      if (!type) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, 'Invalid or unknown asset type');
      }
    }
    if (data.quantity !== undefined && data.quantity < 1) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Quantity must be at least 1');
    }
    if (data.assetCode !== undefined && data.assetCode && data.assetCode.trim() && data.assetCode.trim() !== existing.assetCode) {
      await this.assertCodesFree([data.assetCode.trim()], schoolId);
    }

    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;
    const set = (col: string, val: any) => { updates.push(`${col} = $${i++}`); params.push(val); };

    if (data.typeId !== undefined) set('type_id', data.typeId);
    if (data.name !== undefined) set('name', data.name);
    if (data.quantity !== undefined) set('quantity', data.quantity);
    if (data.assetCode !== undefined) set('asset_code', data.assetCode && data.assetCode.trim() ? data.assetCode.trim() : null);
    if (data.assetCondition !== undefined) set('asset_condition', data.assetCondition);
    if (data.assetStatus !== undefined) set('asset_status', data.assetStatus);
    if (data.responsibilityRemarks !== undefined) set('responsibility_remarks', data.responsibilityRemarks);

    if (updates.length === 0) return this.getById(id, schoolId);

    set('updatedby_userid', userId);
    set('updated_at', new Date());
    params.push(id);
    params.push(schoolId);

    await DB.query(
      singleLineString`update asset set ${updates.join(', ')} where uuid = $${i++} and school_id = $${i++} and status = 'active'`,
      params
    );
    return this.getById(id, schoolId);
  }

  // Soft-delete. Blocked while the node still has active children.
  public async delete(id: string, schoolId: string, userId: string): Promise<void> {
    const children = await DB.query(
      singleLineString`select count(*)::int as count from asset where school_id = $1 and parent_id = $2 and status = 'active'`,
      [schoolId, id]
    );
    if (children.length > 0 && children[0].count > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Cannot delete: asset has ${children[0].count} active child asset(s)`);
    }
    await DB.query(
      singleLineString`update asset set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4 and status = 'active'`,
      [userId, new Date(), id, schoolId]
    );
  }

  // ---- Tree ----

  public async getTree(schoolId: string, rootId?: string): Promise<AssetTreeNode[]> {
    const rootCondition = rootId ? `a.uuid = $2` : `a.parent_id is null`;
    const params: any[] = rootId ? [schoolId, rootId] : [schoolId];

    const query = singleLineString`
      with recursive subtree as (
        select a.* from asset a
        where a.school_id = $1 and a.status = 'active' and ${rootCondition}
        union all
        select a.* from asset a
        join subtree s on a.parent_id = s.uuid
        where a.school_id = $1 and a.status = 'active'
      )
      select s.*, t.code as type_code, t.label as type_label, t.kind, e.name as responsible_name
      from subtree s
      left join asset_type t on s.type_id = t.uuid
      left join employee e on s.responsible_id = e.uuid
      order by s.name
    `;
    const rows: any[] = await DB.query(query, params);

    // Seed inherited responsibility from above the subtree root(s).
    const byId = new Map<string, AssetTreeNode>();
    for (const row of rows) {
      byId.set(row.uuid, { ...row, children: [] });
    }

    const roots: AssetTreeNode[] = [];
    for (const node of byId.values()) {
      if (node.parentId && byId.has(node.parentId)) {
        byId.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    // For each root, the inherited-from-above value comes from its real parent chain.
    const effectiveNameIds: string[] = [];
    for (const root of roots) {
      const seed = await this.effectiveIdFrom(root.parentId, schoolId);
      this.applyEffectiveResponsibility(root, seed, effectiveNameIds);
    }

    const nameMap = await this.resolveEmployeeNames(effectiveNameIds);
    this.fillEffectiveNames(roots, nameMap);
    return roots;
  }

  // DFS: set effective responsibility on a node and recurse to children.
  private applyEffectiveResponsibility(node: AssetTreeNode, inheritedFromAbove: string | undefined, collectIds: string[]): void {
    const own = node.responsibleId;
    if (own) {
      node.effectiveResponsibleId = own;
      node.responsibilitySource = 'self';
      node.isDelegated = !!inheritedFromAbove && inheritedFromAbove !== own;
    } else if (inheritedFromAbove) {
      node.effectiveResponsibleId = inheritedFromAbove;
      node.responsibilitySource = 'inherited';
      node.isDelegated = false;
    } else {
      node.effectiveResponsibleId = undefined;
      node.responsibilitySource = 'none';
      node.isDelegated = false;
    }
    if (node.effectiveResponsibleId) collectIds.push(node.effectiveResponsibleId);

    for (const child of node.children) {
      this.applyEffectiveResponsibility(child, node.effectiveResponsibleId, collectIds);
    }
  }

  private fillEffectiveNames(nodes: AssetTreeNode[], nameMap: Record<string, string>): void {
    for (const node of nodes) {
      if (node.effectiveResponsibleId) {
        node.effectiveResponsibleName = nameMap[node.effectiveResponsibleId];
      }
      this.fillEffectiveNames(node.children, nameMap);
    }
  }

  // ---- Effective responsibility (single node) ----

  public async getEffectiveResponsibility(id: string, schoolId: string): Promise<EffectiveResponsibility | null> {
    const node = await this.getRaw(id, schoolId);
    if (!node) return null;

    const chain = await this.ancestorChain(id, schoolId); // includes node at depth 0
    const inheritedFromAbove = chain.find((r) => r.depth > 0 && r.responsibleId)?.responsibleId as string | undefined;

    let result: EffectiveResponsibility;
    if (node.responsibleId) {
      result = {
        effectiveResponsibleId: node.responsibleId,
        responsibilitySource: 'self',
        isDelegated: !!inheritedFromAbove && inheritedFromAbove !== node.responsibleId,
        sourceAssetId: id,
      };
    } else if (inheritedFromAbove) {
      const sourceRow = chain.find((r) => r.depth > 0 && r.responsibleId);
      result = {
        effectiveResponsibleId: inheritedFromAbove,
        responsibilitySource: 'inherited',
        isDelegated: false,
        sourceAssetId: sourceRow?.uuid,
      };
    } else {
      return { responsibilitySource: 'none', isDelegated: false };
    }

    if (result.effectiveResponsibleId) {
      const names = await this.resolveEmployeeNames([result.effectiveResponsibleId]);
      result.effectiveResponsibleName = names[result.effectiveResponsibleId];
    }
    return result;
  }

  public async setResponsibility(id: string, req: SetResponsibilityRequest, schoolId: string, userId: string): Promise<Asset | null> {
    const existing = await this.getRaw(id, schoolId);
    if (!existing) return null;

    const responsibleId = req.responsibleId && req.responsibleId.trim() ? req.responsibleId.trim() : null;
    await DB.query(
      singleLineString`
        update asset
        set responsible_id = $1, responsibility_remarks = $2, updatedby_userid = $3, updated_at = $4
        where uuid = $5 and school_id = $6 and status = 'active'
      `,
      [responsibleId, req.remarks ?? existing.responsibilityRemarks ?? null, userId, new Date(), id, schoolId]
    );
    return this.getById(id, schoolId);
  }

  // Assets a person is effectively responsible for (own + inherited).
  public async getByResponsible(employeeId: string, schoolId: string): Promise<Asset[]> {
    const rows: any[] = await DB.query(`${ASSET_SELECT} where a.school_id = $1 and a.status = 'active'`, [schoolId]);
    const map = new Map<string, any>();
    for (const r of rows) map.set(r.uuid, r);

    const effectiveId = (node: any): string | undefined => {
      let cur: any = node;
      const guard = new Set<string>();
      while (cur && !guard.has(cur.uuid)) {
        if (cur.responsibleId) return cur.responsibleId;
        guard.add(cur.uuid);
        cur = cur.parentId ? map.get(cur.parentId) : undefined;
      }
      return undefined;
    };

    return rows
      .filter((r) => effectiveId(r) === employeeId)
      .map((r) => ({ ...r, responsibilitySource: r.responsibleId === employeeId ? 'self' : 'inherited' }));
  }

  // ---- Codes ----

  private async assertCodesFree(codes: string[], schoolId: string): Promise<void> {
    const lower = codes.map((c) => c.toLowerCase());
    const dupInBatch = lower.filter((c, idx) => lower.indexOf(c) !== idx);
    if (dupInBatch.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Duplicate asset code(s): ${[...new Set(dupInBatch)].join(', ')}`);
    }
    const placeholders = codes.map((_, idx) => `$${idx + 2}`).join(', ');
    const existing = await DB.query(
      singleLineString`
        select asset_code from asset
        where school_id = $1 and status = 'active' and lower(asset_code) in (${placeholders})
      `,
      [schoolId, ...lower]
    );
    if (existing.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Asset code(s) already in use: ${existing.map((e: any) => e.assetCode).join(', ')}`);
    }
  }

  private async maxCodeSuffix(schoolId: string, prefix: string): Promise<number> {
    const rows = await DB.query(
      singleLineString`select asset_code from asset where school_id = $1 and status = 'active' and asset_code like $2`,
      [schoolId, `${prefix}%`]
    );
    let max = 0;
    for (const r of rows) {
      const m = String(r.assetCode).match(/(\d+)\s*$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return max;
  }

  private formatCode(prefix: string, n: number): string {
    return `${prefix}-${String(n).padStart(DEFAULTS.CODE_PAD, '0')}`;
  }

  public async suggestCode(schoolId: string, opts: { prefix?: string; parentId?: string | null; typeId?: string }): Promise<string> {
    // Hierarchy-aware suggestion: with a typeId, preview the next path tag for
    // that type under the given parent. Without it, fall back to the flat scheme.
    if (opts.typeId) {
      const type = await this.getTypeIfActive(opts.typeId, schoolId);
      if (!type) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, 'Invalid or unknown asset type');
      }
      const seq = await this.nextTagSeq(opts.parentId || null, type.tagAbbr, schoolId);
      return this.composeNewCode(opts.parentId || null, type, seq, schoolId);
    }
    const p = (opts.prefix && opts.prefix.trim()) || DEFAULTS.CODE_PREFIX;
    const next = (await this.maxCodeSuffix(schoolId, p)) + 1;
    return this.formatCode(p, next);
  }

  // ---- Tag (asset_code) composition ----
  //
  // A tag is the chain of `{abbr}-{seq}` segments from the tree root down to the
  // node (e.g. `bld-01/rm-01/fn-01`), optionally prefixed with the school code.
  // Levels whose type has include_in_tag = false contribute no segment, so a
  // school can keep institution/campus levels out of printed tags.

  private async getSchoolCode(schoolId: string): Promise<string | null> {
    const r = await DB.query(singleLineString`select code from school where uuid = $1`, [schoolId]);
    return r.length > 0 ? r[0].code : null;
  }

  // Whether a freshly created node should get an auto tag.
  private shouldAutoTag(type: any, quantity: number): boolean {
    return type.includeInTag !== false && (type.kind === 'container' || quantity === 1);
  }

  private segment(abbr: string | null | undefined, seq: number): string {
    return `${this.effAbbr(abbr)}-${String(seq).padStart(DEFAULTS.TAG_SEQ_PAD, '0')}`;
  }

  private joinCode(segs: string[], schoolCode: string | null): string {
    const parts = DEFAULTS.TAG_INCLUDE_SCHOOL_CODE && schoolCode ? [schoolCode, ...segs] : segs;
    return parts.join(DEFAULTS.TAG_SEPARATOR);
  }

  private effAbbr(abbr: string | null | undefined): string {
    return (abbr && String(abbr).trim() ? String(abbr).trim() : DEFAULTS.TAG_ABBR_FALLBACK).toLowerCase();
  }

  // Next sequence for a tag segment under `parentId`. Scoped by the effective
  // abbreviation (not the type) because the segment is `{abbr}-{seq}` and two
  // distinct types can share an abbr — they must not collide on the global tag.
  private async nextTagSeq(parentId: string | null, abbr: string | null | undefined, schoolId: string): Promise<number> {
    const eff = this.effAbbr(abbr);
    const rows = await DB.query(
      singleLineString`
        select coalesce(max(a.tag_seq), 0) + 1 as next
        from asset a join asset_type t on a.type_id = t.uuid
        where a.school_id = $1 and a.parent_id is not distinct from $2
          and lower(coalesce(t.tag_abbr, $3)) = $4
          and a.tag_seq is not null and a.status = 'active'
      `,
      [schoolId, parentId, DEFAULTS.TAG_ABBR_FALLBACK, eff]
    );
    return rows[0].next;
  }

  // Ordered (root -> node) tag segments for the ancestor chain of `nodeId`.
  private async pathSegments(nodeId: string | null, schoolId: string): Promise<string[]> {
    if (!nodeId) return [];
    const rows = await DB.query(
      singleLineString`
        with recursive chain as (
          select a.uuid, a.parent_id, a.tag_seq, a.type_id, 0 as depth
          from asset a where a.uuid = $1 and a.school_id = $2 and a.status = 'active'
          union all
          select a.uuid, a.parent_id, a.tag_seq, a.type_id, c.depth + 1
          from asset a join chain c on a.uuid = c.parent_id
          where a.school_id = $2 and a.status = 'active'
        )
        select c.tag_seq, c.depth, t.tag_abbr, t.include_in_tag
        from chain c left join asset_type t on c.type_id = t.uuid
        order by c.depth desc
      `,
      [nodeId, schoolId]
    );
    const segs: string[] = [];
    for (const r of rows) {
      if (r.includeInTag === false) continue;
      if (r.tagSeq === null || r.tagSeq === undefined) continue;
      segs.push(this.segment(r.tagAbbr, r.tagSeq));
    }
    return segs;
  }

  // Full tag for a not-yet-inserted node of `type` with `seq` under `parentId`.
  private async composeNewCode(parentId: string | null, type: any, seq: number, schoolId: string): Promise<string> {
    const segs = [...(await this.pathSegments(parentId, schoolId)), this.segment(type.tagAbbr, seq)];
    return this.joinCode(segs, await this.getSchoolCode(schoolId));
  }

  // Recompute asset_code for a moved node and its whole subtree under a new parent.
  // Returns batched update queries plus the moved node's new tag.
  private async recomputeSubtreeCodes(
    rootId: string, toParentId: string | null, rootNewSeq: number, schoolId: string, userId: string, now: Date
  ): Promise<{ queries: string[]; params: any[][]; rootCode: string | null }> {
    const rows: any[] = await DB.query(
      singleLineString`
        with recursive st as (
          select a.uuid, a.parent_id, a.tag_seq, a.type_id, a.asset_code
          from asset a where a.uuid = $1 and a.school_id = $2 and a.status = 'active'
          union all
          select a.uuid, a.parent_id, a.tag_seq, a.type_id, a.asset_code
          from asset a join st on a.parent_id = st.uuid
          where a.school_id = $2 and a.status = 'active'
        )
        select st.uuid, st.parent_id, st.tag_seq, st.asset_code, t.tag_abbr, t.include_in_tag
        from st left join asset_type t on st.type_id = t.uuid
      `,
      [rootId, schoolId]
    );

    const schoolCode = await this.getSchoolCode(schoolId);
    const prefix = await this.pathSegments(toParentId, schoolId);

    const childrenOf = new Map<string | null, any[]>();
    const byId = new Map<string, any>();
    for (const r of rows) {
      byId.set(r.uuid, r);
      const key = r.parentId ?? null;
      if (!childrenOf.has(key)) childrenOf.set(key, []);
      childrenOf.get(key)!.push(r);
    }

    const queries: string[] = [];
    const params: any[][] = [];
    let rootCode: string | null = null;

    const walk = (node: any, parentSegs: string[]) => {
      const seq = node.uuid === rootId ? rootNewSeq : node.tagSeq;
      const include = node.includeInTag !== false && seq !== null && seq !== undefined;
      const ownSegs = include ? [...parentSegs, this.segment(node.tagAbbr, seq)] : parentSegs;
      if (node.assetCode !== null && node.assetCode !== undefined) {
        const code = this.joinCode(ownSegs, schoolCode);
        if (node.uuid === rootId) rootCode = code;
        queries.push(singleLineString`
          update asset set asset_code = $1, updatedby_userid = $2, updated_at = $3
          where uuid = $4 and school_id = $5 and status = 'active'
        `);
        params.push([code, userId, now, node.uuid, schoolId]);
      }
      for (const c of childrenOf.get(node.uuid) || []) walk(c, ownSegs);
    };
    walk(byId.get(rootId), prefix);
    return { queries, params, rootCode };
  }

  // ---- Move (whole node or split a bucket) ----

  public async move(id: string, req: MoveRequest, schoolId: string, userId: string): Promise<any | null> {
    const node = await this.getRaw(id, schoolId);
    if (!node) return null;

    const toParentId = req.toParentId || null;

    if (toParentId) {
      const target = await this.getRaw(toParentId, schoolId);
      if (!target) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, 'Target parent not found');
      }
      // Cycle prevention: target must not be the node itself or any descendant of it.
      const targetChain = await this.ancestorChain(toParentId, schoolId);
      if (targetChain.some((r) => r.uuid === id)) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, 'Cannot move an asset under itself or its own descendant');
      }
    }

    const qty = req.quantity ?? node.quantity;
    if (qty < 1) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Move quantity must be at least 1');
    }
    if (qty > node.quantity) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Move quantity (${qty}) exceeds available (${node.quantity})`);
    }

    const movementDate = req.movementDate || istToday();
    const now = new Date();

    // Individual coded item, or whole-node move.
    if (node.assetCode || qty === node.quantity) {
      if (node.assetCode && qty !== node.quantity) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, 'A coded individual item can only be moved whole');
      }
      const queries: string[] = [];
      const params: any[][] = [];

      // A tagged node is re-sequenced and re-tagged in its new location; its old
      // tag is preserved in the movement log. Untagged nodes just reparent.
      const fromCode: string | null = node.assetCode || null;
      let toCode: string | null = fromCode;
      let newSeq: number | null = node.tagSeq ?? null;
      if (node.assetCode) {
        const nodeType = await this.getTypeIfActive(node.typeId, schoolId);
        newSeq = await this.nextTagSeq(toParentId, nodeType?.tagAbbr, schoolId);
      }

      queries.push(singleLineString`
        update asset set parent_id = $1, tag_seq = $2, updatedby_userid = $3, updated_at = $4
        where uuid = $5 and school_id = $6 and status = 'active'
      `);
      params.push([toParentId, newSeq, userId, now, id, schoolId]);

      if (node.assetCode) {
        const recompute = await this.recomputeSubtreeCodes(id, toParentId, newSeq as number, schoolId, userId, now);
        queries.push(...recompute.queries);
        params.push(...recompute.params);
        toCode = recompute.rootCode;
      }

      queries.push(this.movementInsertSql());
      params.push([generateShortUuid(12), schoolId, id, id, node.parentId || null, toParentId, fromCode, toCode, qty, movementDate, req.reason || null, DEFAULTS.STATUS, userId, now]);

      await DB.queriesInTransaction(queries, params);
      return { moved: await this.getById(id, schoolId), source: await this.getById(id, schoolId) };
    }

    // Split a bucket: qty < node.quantity, node has no code.
    const queries: string[] = [];
    const params: any[][] = [];

    // Decrement source bucket.
    queries.push(singleLineString`
      update asset set quantity = quantity - $1, updatedby_userid = $2, updated_at = $3
      where uuid = $4 and school_id = $5 and status = 'active'
    `);
    params.push([qty, userId, now, id, schoolId]);

    // Find an existing compatible bucket under the destination to merge into.
    const mergeTarget = await DB.query(
      singleLineString`
        select * from asset
        where school_id = $1 and parent_id is not distinct from $2 and type_id = $3
          and lower(name) = lower($4) and asset_code is null
          and coalesce(asset_status, 'active') = coalesce($5, 'active')
          and status = 'active' and uuid <> $6
        limit 1
      `,
      [schoolId, toParentId, node.typeId, node.name, node.assetStatus || DEFAULTS.ASSET_STATUS, id]
    );

    let resultId: string;
    if (mergeTarget.length > 0) {
      resultId = mergeTarget[0].uuid;
      queries.push(singleLineString`
        update asset set quantity = quantity + $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5 and status = 'active'
      `);
      params.push([qty, userId, now, resultId, schoolId]);
    } else {
      resultId = generateShortUuid(12);
      queries.push(singleLineString`
        insert into asset
        (uuid, school_id, type_id, name, parent_id, quantity, asset_code, asset_condition,
         responsible_id, responsibility_remarks, asset_status, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `);
      params.push([
        resultId, schoolId, node.typeId, node.name, toParentId, qty, null,
        node.assetCondition || null, node.responsibleId || null, node.responsibilityRemarks || null,
        node.assetStatus || DEFAULTS.ASSET_STATUS, DEFAULTS.STATUS, userId, now,
      ]);
    }

    queries.push(this.movementInsertSql());
    params.push([generateShortUuid(12), schoolId, id, resultId, node.parentId || null, toParentId, null, null, qty, movementDate, req.reason || null, DEFAULTS.STATUS, userId, now]);

    await DB.queriesInTransaction(queries, params);
    return { moved: await this.getById(resultId, schoolId), source: await this.getById(id, schoolId) };
  }

  private movementInsertSql(): string {
    return singleLineString`
      insert into asset_movement_log
      (uuid, school_id, asset_id, result_asset_id, from_parent_id, to_parent_id, from_code, to_code, quantity_moved, movement_date, reason, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `;
  }

  // History where the asset is either the source or the destination of a move,
  // so a node moved into via a split still shows its received history.
  public async getMovements(assetId: string, schoolId: string): Promise<AssetMovement[]> {
    return DB.query(
      singleLineString`
        select * from asset_movement_log
        where school_id = $1 and (asset_id = $2 or result_asset_id = $2) and status = 'active'
        order by created_at desc
      `,
      [schoolId, assetId]
    );
  }

  // ---- Per-type quantity summary ----

  public async summary(schoolId: string): Promise<any[]> {
    return DB.query(
      singleLineString`
        select a.type_id, t.code as type_code, t.label as type_label, t.kind,
               sum(a.quantity)::int as total_quantity,
               count(*) filter (where a.asset_code is null)::int as bucket_count,
               count(*) filter (where a.asset_code is not null)::int as individualized_count
        from asset a
        left join asset_type t on a.type_id = t.uuid
        where a.school_id = $1 and a.status = 'active'
        group by a.type_id, t.code, t.label, t.kind
        order by t.kind, t.label
      `,
      [schoolId]
    );
  }

  // Drill-down for one type: total quantity plus each asset record with its
  // ancestor breadcrumb (immediate parent -> root).
  public async counts(schoolId: string, typeId: string): Promise<any> {
    const all: any[] = await DB.query(
      singleLineString`
        select a.uuid, a.name, a.parent_id, a.asset_code, a.quantity, a.type_id,
               t.label as type_label
        from asset a
        left join asset_type t on a.type_id = t.uuid
        where a.school_id = $1 and a.status = 'active'
      `,
      [schoolId]
    );

    const byId = new Map<string, any>();
    for (const a of all) byId.set(a.uuid, a);

    const ancestorsOf = (node: any): { name: string; typeLabel?: string }[] => {
      const chain: { name: string; typeLabel?: string }[] = [];
      const guard = new Set<string>();
      let cur = node.parentId ? byId.get(node.parentId) : undefined;
      while (cur && !guard.has(cur.uuid)) {
        chain.push({ name: cur.name, typeLabel: cur.typeLabel });
        guard.add(cur.uuid);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      return chain; // immediate parent first ... root last
    };

    const ofType = all.filter((a) => a.typeId === typeId);
    const rows = ofType.map((a) => ({
      uuid: a.uuid,
      name: a.name,
      assetCode: a.assetCode || null,
      quantity: a.quantity,
      ancestors: ancestorsOf(a),
    }));
    const total = ofType.reduce((sum, a) => sum + (a.quantity || 0), 0);
    const typeLabel = ofType.length > 0 ? ofType[0].typeLabel : undefined;

    return { typeId, typeLabel, total, rows };
  }

  // ---- Individualize a bucket into coded items ----

  public async individualize(id: string, req: IndividualizeRequest, schoolId: string, userId: string): Promise<Asset[]> {
    const bucket = await this.getRaw(id, schoolId);
    if (!bucket) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Asset not found');
    }
    if (bucket.assetCode) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Asset is already an individual coded item');
    }

    const count = req.count;
    if (!Number.isInteger(count) || count < 1) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'count must be a positive integer');
    }
    if (count > bucket.quantity) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `count (${count}) exceeds bucket quantity (${bucket.quantity})`);
    }

    // Determine tags: explicit list (validated, untracked seq) or generated path
    // tags sequenced under the bucket's parent for the bucket's type.
    let units: { code: string; tagSeq: number | null }[];
    if (req.codes && req.codes.length > 0) {
      if (req.codes.length !== count) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, `codes length (${req.codes.length}) must equal count (${count})`);
      }
      const codes = req.codes.map((c) => c.trim());
      if (codes.some((c) => !c)) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, 'codes must not be empty');
      }
      await this.assertCodesFree(codes, schoolId);
      units = codes.map((code) => ({ code, tagSeq: null }));
    } else {
      const type = await this.getTypeIfActive(bucket.typeId, schoolId);
      const start = await this.nextTagSeq(bucket.parentId || null, type?.tagAbbr, schoolId);
      const parentSegs = await this.pathSegments(bucket.parentId || null, schoolId);
      const schoolCode = await this.getSchoolCode(schoolId);
      units = Array.from({ length: count }, (_, k) => {
        const seq = start + k;
        const code = this.joinCode([...parentSegs, this.segment(type?.tagAbbr, seq)], schoolCode);
        return { code, tagSeq: seq };
      });
    }

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];
    const newIds: string[] = [];

    for (const unit of units) {
      const itemId = generateShortUuid(12);
      newIds.push(itemId);
      queries.push(singleLineString`
        insert into asset
        (uuid, school_id, type_id, name, parent_id, quantity, asset_code, tag_seq, asset_condition,
         responsible_id, responsibility_remarks, asset_status, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `);
      params.push([
        itemId, schoolId, bucket.typeId, bucket.name, bucket.parentId || null, 1, unit.code, unit.tagSeq,
        req.assetCondition || bucket.assetCondition || null, bucket.responsibleId || null, bucket.responsibilityRemarks || null,
        bucket.assetStatus || DEFAULTS.ASSET_STATUS, DEFAULTS.STATUS, userId, now,
      ]);
    }

    // Decrement (or soft-delete) the bucket.
    const remaining = bucket.quantity - count;
    if (remaining <= 0) {
      queries.push(singleLineString`
        update asset set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `);
      params.push([userId, now, id, schoolId]);
    } else {
      queries.push(singleLineString`
        update asset set quantity = $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5 and status = 'active'
      `);
      params.push([remaining, userId, now, id, schoolId]);
    }

    await DB.queriesInTransaction(queries, params);

    const created: Asset[] = [];
    for (const newId of newIds) {
      const item = await this.getById(newId, schoolId);
      if (item) created.push(item);
    }
    return created;
  }
}

export const assetService = new AssetService();
