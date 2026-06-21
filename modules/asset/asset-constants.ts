// Asset module constants.
//
// NOTE: asset "types" are NOT a hardcoded enum. They live in the per-school
// `asset_type` lookup table. The seeds below are only used to populate that
// table the first time a school touches the asset module (seed-on-first-use,
// see asset-type-service.ts). Schools can then add/edit/remove types freely.

export const ASSET_KINDS = ['container', 'item'] as const;

// Default asset types seeded per school on first use.
//
// `tagAbbr` is the short code used to build a node's segment in an asset tag,
// rendered as `{abbr}-{seq}` (e.g. fan -> `fn-01`). `includeInTag` controls
// whether this level appears in the composed tag path at all: set it false for
// levels a school does not want in printed tags (e.g. institution/campus) so a
// tag can start lower in the tree (e.g. `bld-01/rm-01/fn-01`). Both are editable
// per-school after seeding.
export const ASSET_TYPE_SEEDS: {
  code: string;
  label: string;
  kind: AssetKind;
  tagAbbr: string;
  includeInTag: boolean;
}[] = [
  // Containers (typically have children)
  { code: 'institution', label: 'Institution', kind: 'container', tagAbbr: 'inst', includeInTag: true },
  { code: 'campus', label: 'Campus', kind: 'container', tagAbbr: 'camp', includeInTag: true },
  { code: 'building', label: 'Building', kind: 'container', tagAbbr: 'bld', includeInTag: true },
  { code: 'block', label: 'Block', kind: 'container', tagAbbr: 'blk', includeInTag: true },
  { code: 'floor', label: 'Floor', kind: 'container', tagAbbr: 'fl', includeInTag: true },
  { code: 'room', label: 'Room', kind: 'container', tagAbbr: 'rm', includeInTag: true },
  { code: 'lab', label: 'Lab', kind: 'container', tagAbbr: 'lab', includeInTag: true },
  { code: 'hall', label: 'Hall', kind: 'container', tagAbbr: 'hl', includeInTag: true },
  { code: 'office', label: 'Office', kind: 'container', tagAbbr: 'off', includeInTag: true },
  { code: 'store_room', label: 'Store Room', kind: 'container', tagAbbr: 'str', includeInTag: true },
  // Items (typically leaves)
  { code: 'fan', label: 'Fan', kind: 'item', tagAbbr: 'fn', includeInTag: true },
  { code: 'tube_light', label: 'Tube Light', kind: 'item', tagAbbr: 'tl', includeInTag: true },
  { code: 'ac', label: 'AC', kind: 'item', tagAbbr: 'ac', includeInTag: true },
  { code: 'projector', label: 'Projector', kind: 'item', tagAbbr: 'prj', includeInTag: true },
  { code: 'computer', label: 'Computer', kind: 'item', tagAbbr: 'cmp', includeInTag: true },
  { code: 'student_desk', label: 'Student Desk', kind: 'item', tagAbbr: 'sd', includeInTag: true },
  { code: 'student_table', label: 'Student Table', kind: 'item', tagAbbr: 'stb', includeInTag: true },
  { code: 'student_chair', label: 'Student Chair', kind: 'item', tagAbbr: 'sch', includeInTag: true },
  { code: 'table_chair', label: 'Table Chair', kind: 'item', tagAbbr: 'tc', includeInTag: true },
  { code: 'teacher_table', label: 'Teacher Table', kind: 'item', tagAbbr: 'tt', includeInTag: true },
  { code: 'almirah', label: 'Almirah', kind: 'item', tagAbbr: 'alm', includeInTag: true },
  { code: 'cupboard', label: 'Cupboard', kind: 'item', tagAbbr: 'cb', includeInTag: true },
  { code: 'rack', label: 'Rack', kind: 'item', tagAbbr: 'rk', includeInTag: true },
  { code: 'notice_board', label: 'Notice Board', kind: 'item', tagAbbr: 'nb', includeInTag: true },
  { code: 'black_board', label: 'Black Board', kind: 'item', tagAbbr: 'bb', includeInTag: true },
  { code: 'white_board', label: 'White Board', kind: 'item', tagAbbr: 'wb', includeInTag: true },
  { code: 'bench', label: 'Bench', kind: 'item', tagAbbr: 'bn', includeInTag: true },
  { code: 'other', label: 'Other', kind: 'item', tagAbbr: 'oth', includeInTag: true },
];

export const ASSET_CONDITIONS = [
  { value: 'new', label: 'New' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'needs_repair', label: 'Needs Repair' },
  { value: 'condemned', label: 'Condemned' },
] as const;

// Lifecycle status of an asset (distinct from the active/deleted soft-delete).
export const ASSET_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'condemned', label: 'Condemned' },
  { value: 'disposed', label: 'Disposed' },
  { value: 'lost', label: 'Lost' },
] as const;

export const STATUS_VALUES = ['active', 'deleted'] as const;

export const DEFAULTS = {
  QUANTITY: 1,
  STATUS: 'active',
  ASSET_STATUS: 'active',
  CODE_PREFIX: 'AST',
  CODE_PAD: 6,
  // Tag (asset_code) composition.
  TAG_SEPARATOR: '/',
  TAG_SEQ_PAD: 2,
  TAG_ABBR_FALLBACK: 'ast',
  // Prefix composed tags with the school code (e.g. `dbpasn/bld-01/rm-01/fn-01`).
  // Flip to false to drop the school-code level so tags start at the tree root.
  TAG_INCLUDE_SCHOOL_CODE: true,
} as const;

// Type exports
export type AssetKind = typeof ASSET_KINDS[number];
export type AssetCondition = typeof ASSET_CONDITIONS[number]['value'];
export type AssetStatus = typeof ASSET_STATUSES[number]['value'];
export type StatusValue = typeof STATUS_VALUES[number];
