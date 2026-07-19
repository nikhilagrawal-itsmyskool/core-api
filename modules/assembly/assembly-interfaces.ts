import {
  Weekday,
  ResponsibleTargetType,
  PublishStatus,
  OwnerType,
  SpecialSource,
  NodeAuditAction,
  ResponsibleMode,
  CycleUnit,
} from './assembly-constants';

export interface BaseEntity {
  uuid: string;
  schoolId: string;
  createdbyUserid?: string;
  createdAt?: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
}

// ── Plan ─────────────────────────────────────────────────────────────────────

export interface AssemblyPlan extends BaseEntity {
  academicYearId: string;
  name: string;
  scopeLabel?: string;
  startDate?: string; // yyyy-mm-dd; null = -inf (whole-year base plan)
  endDate?: string; // yyyy-mm-dd; null = +inf
  priority?: number; // tie-break for equal-span overlaps (higher wins)
  publishStatus: PublishStatus;
  publishedAt?: Date;
  publishedbyUserid?: string;
  status: string;
}

// Plan detail: plan + its audience (classes) + weekday ceiling.
export interface AssemblyPlanDetail extends AssemblyPlan {
  classes: PlanClassView[];
  days: Weekday[];
}

export interface PlanClassView {
  classId: string;
  className?: string;
}

export interface CreatePlanRequest {
  academicYearId: string;
  name: string;
  scopeLabel?: string;
  startDate?: string; // yyyy-mm-dd; omit for a whole-year base plan
  endDate?: string;
  priority?: number;
  // Optional; defaults to DEFAULTS.PLAN_WEEKDAYS when omitted.
  days?: Weekday[];
}

export interface UpdatePlanRequest {
  name?: string;
  scopeLabel?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  priority?: number | null;
}

// Clone a whole plan (tree + days + audience) into a new dated plan.
export interface ClonePlanRequest {
  name: string;
  startDate?: string;
  endDate?: string;
  scopeLabel?: string;
  copyClasses?: boolean; // default true — carry the audience over
}

export interface SetPlanClassesRequest {
  classIds: string[];
}

export interface SetPlanDaysRequest {
  days: Weekday[];
}

// ── Node ─────────────────────────────────────────────────────────────────────

export interface AssemblyNode extends BaseEntity {
  ownerType: OwnerType;
  ownerId: string;
  parentId?: string;
  depth: number;
  sortOrder: number;
  title: string;
  description?: string;
  expectation?: string;
  recommendation?: string;
  outcome?: string;
  startTime?: string;
  durationMinutes?: number;
  status: string;
}

// Node with its own child sets (days/responsible/resources) attached.
export interface AssemblyNodeDetail extends AssemblyNode {
  days: Weekday[]; // explicit rows only (empty = inherit)
  responsible: NodeResponsibleView[];
  resources: NodeResourceView[];
  children?: AssemblyNodeDetail[];
}

export interface NodeResponsibleView {
  uuid: string;
  role?: string;
  targetType: ResponsibleTargetType;
  targetId?: string;
  targetText?: string;
  targetName?: string;
  sortOrder: number;
  // Time-aware fields (a rotating rule = rows sharing ruleGroup). Absent = fixed/always.
  startDate?: string;
  endDate?: string;
  mode?: ResponsibleMode; // undefined ≡ 'fixed'
  cycleUnit?: CycleUnit;
  anchorDate?: string;
  ruleGroup?: string;
}

export interface NodeResourceView {
  uuid: string;
  label?: string;
  url?: string;
  note?: string;
  sortOrder: number;
}

export interface CreateNodeRequest {
  parentId?: string; // omit for a root node
  title: string;
  description?: string;
  expectation?: string;
  recommendation?: string;
  outcome?: string;
  startTime?: string;
  durationMinutes?: number;
  // Optional insert position among siblings; appended to the end when omitted.
  sortOrder?: number;
}

export interface UpdateNodeRequest {
  title?: string;
  description?: string | null;
  expectation?: string | null;
  recommendation?: string | null;
  outcome?: string | null;
  startTime?: string | null;
  durationMinutes?: number | null;
}

export interface ReorderNodesRequest {
  parentId?: string; // the sibling group being reordered (null = roots)
  order: string[]; // node uuids in the new order
}

export interface SetNodeDaysRequest {
  days: Weekday[]; // validated ⊆ parent's effective days; empty clears (= inherit)
}

export interface ResponsibleInput {
  role?: string;
  targetType: ResponsibleTargetType;
  targetId?: string; // required unless targetType = 'text'
  targetText?: string; // required when targetType = 'text'
  // Optional time-scoping. For a rotating rule, send one entry per member, all with
  // the same ruleGroup + mode:'rotating' + cycleUnit + anchorDate; sortOrder = order.
  startDate?: string;
  endDate?: string;
  mode?: ResponsibleMode; // 'fixed' (default) | 'rotating'
  cycleUnit?: CycleUnit;
  anchorDate?: string;
  ruleGroup?: string;
}

export interface SetNodeResponsibleRequest {
  responsible: ResponsibleInput[];
}

export interface ResourceInput {
  label?: string;
  url?: string;
  note?: string;
}

export interface SetNodeResourcesRequest {
  resources: ResourceInput[];
}

// ── Special assembly ─────────────────────────────────────────────────────────

export interface AssemblySpecial extends BaseEntity {
  academicYearId: string;
  planId: string;
  specialDate: string; // yyyy-mm-dd
  title: string;
  description?: string;
  source: SpecialSource;
  publishStatus: PublishStatus;
  status: string;
}

export interface CreateSpecialRequest {
  specialDate: string; // yyyy-mm-dd
  title: string;
  description?: string;
  // 'cloned' (default) seeds the tree from that date's resolved template; 'blank' starts empty.
  source?: SpecialSource;
}

export interface UpdateSpecialRequest {
  title?: string;
  description?: string | null;
}

// ── Theme ────────────────────────────────────────────────────────────────────

export interface AssemblyTheme extends BaseEntity {
  academicYearId: string;
  planId?: string; // null = school-wide (all plans that year)
  title: string;
  description?: string;
  startDate: string; // yyyy-mm-dd
  endDate: string; // yyyy-mm-dd
  status: string;
}

export interface CreateThemeRequest {
  academicYearId: string;
  planId?: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
}

export interface UpdateThemeRequest {
  title?: string;
  description?: string | null;
  startDate?: string;
  endDate?: string;
}

// ── Audit ────────────────────────────────────────────────────────────────────

export interface AssemblyNodeAudit {
  uuid: string;
  schoolId: string;
  nodeId: string;
  ownerType?: OwnerType;
  ownerId?: string;
  action: NodeAuditAction;
  changedField?: string;
  oldValue?: string;
  newValue?: string;
  changedbyUserid?: string;
  changedAt: Date;
}

// ── Resolve (read model) ─────────────────────────────────────────────────────

// The fully-resolved assembly for a plan on a date: either the published
// special (date-pinned) or the day-filtered template, with effective
// responsible/resources attached per node, plus any active themes.
export interface ResolvedAssembly {
  planId: string;
  date: string; // yyyy-mm-dd
  weekday: Weekday;
  held: boolean; // false when the plan holds no assembly that weekday and no special exists
  source: 'special' | 'template';
  specialId?: string;
  title?: string; // special title, when source = 'special'
  themes: AssemblyTheme[];
  nodes: ResolvedNode[]; // top-level nodes, nested via children
}

export interface ResolvedNode {
  uuid: string;
  title: string;
  description?: string;
  expectation?: string;
  recommendation?: string;
  outcome?: string;
  startTime?: string;
  durationMinutes?: number;
  sortOrder: number;
  responsible: NodeResponsibleView[]; // effective (own or inherited)
  resources: NodeResourceView[];
  children: ResolvedNode[];
}
