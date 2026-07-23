import {
  Weekday,
  ResponsibleTargetType,
  PublishStatus,
  OwnerType,
  SpecialSource,
  NodeAuditAction,
  ResponsibleMode,
  CycleUnit,
  AssemblyMode,
  FillMode,
  WeekStatus,
  ChecklistScope,
} from './assembly-constants';

// ── House mode: config, houses, rotation ─────────────────────────────────────

export interface AssemblyConfig {
  schoolId: string;
  mode: AssemblyMode;
  title?: string;
  subtitle?: string;
}
export interface SetConfigRequest {
  mode?: AssemblyMode;
  title?: string | null;
  subtitle?: string | null;
}

export interface HouseTeacherView { employeeId: string; name?: string; }

// Leadership + member teachers, sourced from the student module's house_teacher.
export interface HouseStaff {
  inchargeId?: string;
  inchargeName?: string;
  coinchargeId?: string;
  coinchargeName?: string;
  teachers: HouseTeacherView[]; // members
}

export interface HouseView extends HouseStaff {
  houseId: string;
  name: string;
  code?: string;
  color?: string;
  rotationOrder?: number; // assembly-specific rotation order (from assembly_house_rotation)
}

// Assembly owns only the rotation order; leadership/teachers are managed in the
// student (house) module. sortOrder null removes the house from the rotation.
export interface SetHouseRotationRequest {
  sortOrder?: number | null;
}

// One week's house-on-duty for a plan (wing).
export interface WeekHouseView {
  weekStart: string; // yyyy-mm-dd (Monday)
  houseId?: string;
  houseName?: string;
  source: 'auto' | 'override' | 'skip';
}
export interface SetWeekHouseRequest {
  weekStart: string;
  houseId?: string | null; // null = skip (no house that week)
}

// ── House mode Phase B: weekly roster ────────────────────────────────────────

// One roster instance for a plan/wing's week. Workflow: draft -> submitted ->
// approved(=locked). house is the snapshot of the house-on-duty at create time.
export interface AssemblyWeek {
  uuid: string;
  planId: string;
  academicYearId: string;
  weekStart: string;   // yyyy-mm-dd (Monday)
  houseId?: string;    // null = a skip week (no house on duty)
  houseName?: string;
  status: WeekStatus;
  locked: boolean;         // hard lock (set on approve)
  lateUnlocked: boolean;   // assembly-incharge re-opened editing past deadline/lock
  deadlineAt?: string;     // ISO; Wed 14:00 of the prior week
  pastDeadline: boolean;   // computed: now > deadlineAt
  editable: boolean;       // computed: may the roster still be edited
  submittedbyUserid?: string;
  submittedAt?: string;
  approvedbyUserid?: string;
  approvedAt?: string;
}

// A roster participant (polymorphic; mirrors NodeResponsibleView). Used for the
// day's anchors/owners (scope='day') and a slot's speakers/performers (scope='entry').
export interface RosterParticipantView {
  role?: string;
  targetType: ResponsibleTargetType; // employee | class | student | text
  targetId?: string;
  targetName?: string;
  targetClass?: string; // a student's class/section (denormalized)
  targetText?: string;
  sortOrder: number;
}

// A fillable template slot the house completes for a date (fill_mode='roster'
// or is_optional). Carries the authored template context + the saved slot state.
export interface RosterSlot {
  nodeId: string;
  title: string;
  description?: string; // the segment's static description (shown as a hint when no dayHint)
  depth: number;
  parentId?: string;
  fillMode?: FillMode;
  isOptional: boolean;
  options: string[];
  dayHint?: string;     // the template's per-weekday focus/guideline (e.g. "Word of the Day")
  // Saved slot state for this (date, node).
  opted: boolean;       // optional segment opted in (defaults true)
  content?: string;
  participants: RosterParticipantView[]; // speakers / performers / group
}

export interface RosterDayView {
  date: string;         // yyyy-mm-dd
  weekday: Weekday;
  anchors: RosterParticipantView[];  // scope='day', role 'anchor'
  owners: RosterParticipantView[];   // scope='day', role 'day-owner'
  slots: RosterSlot[];
}

// Full editor read model: the week + each assembly date's day header + fillable slots.
export interface AssemblyWeekDetail extends AssemblyWeek {
  days: RosterDayView[];
}

export interface WeekSummary {
  uuid: string;
  planId: string;
  weekStart: string;
  houseId?: string;
  houseName?: string;
  status: WeekStatus;
  locked: boolean;
  editable: boolean;
  pastDeadline: boolean;
  deadlineAt?: string;
}

export interface EnsureWeekRequest {
  weekStart: string; // any date in the target week; normalized to its Monday
}

// A participant to save. targetId required unless targetType='text' (targetText).
export interface RosterParticipantInput {
  role?: string;
  targetType: ResponsibleTargetType;
  targetId?: string;
  targetText?: string;
}

// Bulk save of a week's roster (replace-per-kind: sending `days` replaces all day
// participants; sending `entries` replaces all slot state + entry participants).
export interface SaveRosterRequest {
  days?: SaveRosterDayInput[];
  entries?: SaveRosterEntryInput[];
}
export interface SaveRosterDayInput {
  date: string;
  anchors?: RosterParticipantInput[]; // role defaulted to 'anchor'
  owners?: RosterParticipantInput[];  // role defaulted to 'day-owner'
}
export interface SaveRosterEntryInput {
  date: string;
  nodeId: string;
  opted?: boolean;
  content?: string | null;
  participants?: RosterParticipantInput[];
}

export interface UnlockWeekRequest {
  reason?: string;
}

// ── House mode Phase C: execution checklist ──────────────────────────────────

// A per-school configurable checklist item. phase = a free grouping label;
// scope 'week' = once per roster week, 'day' = per assembly date.
export interface ChecklistItem {
  uuid: string;
  phase?: string;
  scope: ChecklistScope;
  text: string;
  sortOrder: number;
}
export interface CreateChecklistItemRequest {
  phase?: string;
  scope: ChecklistScope;
  text: string;
  sortOrder?: number;
}
export interface UpdateChecklistItemRequest {
  phase?: string | null;
  scope?: ChecklistScope;
  text?: string;
  sortOrder?: number;
}

// A recorded tick (checked item) against a roster week. date is set for day-scoped
// items, absent for week-scoped ones.
export interface ChecklistTickView {
  itemId: string;
  date?: string;
  checkedbyUserid?: string;
  checkedAt?: string;
}

// The per-week checklist read model: the catalog (split by scope), the week's
// assembly dates (for day-scope expansion), recorded ticks, and any sign-off.
export interface WeekChecklist {
  weekId: string;
  weekItems: ChecklistItem[];
  dayItems: ChecklistItem[];
  dates: string[];
  ticks: ChecklistTickView[];
  signoff?: ChecklistSignoffView;          // the WEEKLY sign-off (entry_date null)
  daySignoffs?: DayChecklistSignoffView[];  // per-day sign-offs
}
export interface ChecklistSignoffView {
  note?: string;
  signedbyUserid?: string;
  signedAt?: string;
}
export interface DayChecklistSignoffView extends ChecklistSignoffView {
  date: string;
}

// Bulk-set the week's ticks (replace within a partition: send exactly the CHECKED
// items). scope+date pick the partition to replace: 'week' replaces the weekly
// ticks; 'day' with a date replaces just that day's ticks. Omitting scope replaces
// ALL ticks (legacy behaviour).
export interface SaveChecklistRequest {
  ticks: { itemId: string; date?: string | null }[];
  scope?: ChecklistScope;
  date?: string | null;
}
// Sign off a partition: scope 'day' + date signs off that day; otherwise the week.
export interface SignoffRequest {
  note?: string;
  scope?: ChecklistScope;
  date?: string | null;
}

// ── House mode Phase D: grading + house-of-the-month ─────────────────────────

export interface RubricMetric { uuid: string; name: string; maxMarks: number; sortOrder: number; }
export interface RubricPenalty { uuid: string; name: string; value: number; sortOrder: number; }
export interface RubricConfig { scalingAdjustment?: number; }
// GET /rubric read model.
export interface Rubric { metrics: RubricMetric[]; penalties: RubricPenalty[]; config: RubricConfig; }

export interface CreateRubricMetricRequest { name: string; maxMarks: number; sortOrder?: number; }
export interface UpdateRubricMetricRequest { name?: string; maxMarks?: number; sortOrder?: number; }
export interface CreateRubricPenaltyRequest { name: string; value: number; sortOrder?: number; }
export interface UpdateRubricPenaltyRequest { name?: string; value?: number; sortOrder?: number; }
export interface SetRubricConfigRequest { scalingAdjustment?: number | null; }

export interface Evaluator {
  uuid: string;
  employeeId: string;
  employeeName?: string;
  startDate?: string;
  endDate?: string;
}
export interface CreateEvaluatorRequest { employeeId: string; startDate?: string; endDate?: string; }

export interface GradeMetricScore { metricId: string; score: number; }

export interface GradeView {
  uuid: string;
  weekId: string;
  gradeDate: string;
  houseId?: string;
  houseName?: string;
  evaluatorEmployeeId: string;
  evaluatorName?: string;
  starPresenter?: string;
  diction?: string;
  feedback?: string;
  total?: number;
  metrics: GradeMetricScore[];
  penalties: string[]; // applied penalty ids
}

export interface SaveGradeRequest {
  gradeDate: string;
  evaluatorId: string; // employee id (must have an evaluator assignment covering the date)
  metrics: GradeMetricScore[];
  penalties?: string[]; // penalty ids applied
  starPresenter?: string;
  diction?: string;
  feedback?: string;
}

// Leaderboard / house-of-the-month over a date range.
export interface LeaderboardWeek { weekId: string; weekStart: string; average: number; }
export interface LeaderboardEntry {
  houseId?: string;
  houseName?: string;
  average: number;   // avg of the house's week averages
  weekCount: number;
  weeks: LeaderboardWeek[];
}
export interface Leaderboard {
  from: string;
  to: string;
  houseOfTheMonth?: { houseId?: string; houseName?: string; average: number };
  standings: LeaderboardEntry[];
}

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
  fillMode?: FillMode;   // 'auto' (template content) | 'roster' (house fills weekly)
  isOptional?: boolean;  // can be opted in/out per day
  options?: string[];    // pick-one choices (e.g. performance types)
  status: string;
}

export interface NodeDayContent { weekday: Weekday; content?: string; }

// Node with its own child sets (days/responsible/resources/day-content) attached.
export interface AssemblyNodeDetail extends AssemblyNode {
  days: Weekday[]; // explicit rows only (empty = inherit)
  responsible: NodeResponsibleView[];
  resources: NodeResourceView[];
  dayContent: NodeDayContent[]; // per-weekday content grid (leaf template content)
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
  fillMode?: FillMode;
  isOptional?: boolean;
  options?: string[];
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
  fillMode?: FillMode | null;
  isOptional?: boolean | null;
  options?: string[] | null;
}

export interface SetNodeDayContentRequest {
  content: NodeDayContent[]; // per-weekday content; empty content clears a day
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
  // House mode: the house on duty that week + (when an approved roster exists) the
  // day's anchors/owner. Absent for template-mode schools.
  mode?: AssemblyMode;
  houseId?: string;
  houseName?: string;
  rosterApproved?: boolean; // true when an approved roster was overlaid onto the template
  anchors?: ResolvedAnchor[];
  dayOwners?: { employeeId?: string; name?: string }[];
}

export interface ResolvedAnchor {
  studentId?: string;
  name?: string;
  className?: string;
}

export interface ResolvedNode {
  uuid: string;
  title: string;
  content?: string; // the template's per-weekday content cell for the resolved date
  description?: string;
  expectation?: string;
  recommendation?: string;
  outcome?: string;
  startTime?: string;
  durationMinutes?: number;
  sortOrder: number;
  fillMode?: FillMode;  // house mode: 'roster' slots are filled from the approved roster
  isOptional?: boolean; // house mode: dropped when the roster opts it out
  responsible: NodeResponsibleView[]; // effective (own or inherited)
  resources: NodeResourceView[];
  children: ResolvedNode[];
}
