import { AssetKind, AssetCondition, AssetStatus, StatusValue } from './asset-constants';

// Base interface with common audit fields
export interface BaseEntity {
  uuid: string;
  schoolId: string;
  createdbyUserid: string;
  createdAt: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
}

// ---- Asset Type (managed lookup) ----
export interface AssetType extends BaseEntity {
  code: string;
  label: string;
  kind: AssetKind;
  tagAbbr?: string;
  includeInTag?: boolean;
  status: StatusValue;
}

export interface CreateAssetTypeRequest {
  code: string;
  label: string;
  kind: AssetKind;
  tagAbbr?: string;
  includeInTag?: boolean;
}

export interface UpdateAssetTypeRequest {
  label?: string;
  kind?: AssetKind;
  tagAbbr?: string;
  includeInTag?: boolean;
}

// ---- Asset ----
export interface Asset extends BaseEntity {
  typeId: string;
  name: string;
  parentId?: string;
  quantity: number;
  assetCode?: string;
  tagSeq?: number;
  assetCondition?: AssetCondition;
  responsibleId?: string;
  responsibilityRemarks?: string;
  assetStatus: AssetStatus;
  status: StatusValue;
  // Resolved (join) fields, present on reads
  typeCode?: string;
  typeLabel?: string;
  kind?: AssetKind;
  responsibleName?: string;
}

export interface CreateAssetRequest {
  typeId: string;
  name: string;
  parentId?: string;
  quantity?: number;
  assetCode?: string;
  assetCondition?: AssetCondition;
  responsibleId?: string;
  responsibilityRemarks?: string;
  assetStatus?: AssetStatus;
}

export interface UpdateAssetRequest {
  typeId?: string;
  name?: string;
  quantity?: number;
  assetCode?: string;
  assetCondition?: AssetCondition;
  assetStatus?: AssetStatus;
  responsibilityRemarks?: string;
}

// Tree node = asset + resolved effective responsibility + nested children
export interface AssetTreeNode extends Asset {
  children: AssetTreeNode[];
  effectiveResponsibleId?: string;
  effectiveResponsibleName?: string;
  responsibilitySource?: 'self' | 'inherited' | 'none';
  isDelegated?: boolean;
}

export interface EffectiveResponsibility {
  effectiveResponsibleId?: string;
  effectiveResponsibleName?: string;
  responsibilitySource: 'self' | 'inherited' | 'none';
  isDelegated: boolean;
  sourceAssetId?: string;
}

// ---- Operations ----
export interface MoveRequest {
  toParentId: string | null; // null = move to root (no parent)
  quantity?: number; // omit/equal node qty = whole-node move; less = split a bucket
  movementDate?: string;
  reason?: string;
}

export interface IndividualizeRequest {
  count: number;
  codePrefix?: string;
  codes?: string[]; // optional explicit codes (overrides suggestion), length must equal count
  assetCondition?: AssetCondition;
}

export interface SetResponsibilityRequest {
  responsibleId?: string | null; // null/empty = clear (revert to inherited)
  remarks?: string;
}

export interface AssetMovement extends BaseEntity {
  assetId: string;
  resultAssetId?: string;
  fromParentId?: string;
  toParentId?: string;
  fromCode?: string;
  toCode?: string;
  quantityMoved: number;
  movementDate: Date;
  reason?: string;
  status: StatusValue;
}

// Per-type aggregate of how many units a school holds.
export interface AssetTypeSummary {
  typeId: string;
  typeCode?: string;
  typeLabel?: string;
  kind?: AssetKind;
  totalQuantity: number;       // sum of quantity across all rows of the type
  bucketCount: number;         // rows without a tag (uncounted multiples)
  individualizedCount: number; // rows with a tag (single coded units)
}
