import {
  SupplyUnit, ItemType, ItemCondition, IssueType,
  WastageReason, WastageAction, WastageStatus,
  ResponsibleType, ReturnCondition, StatusValue,
} from './supply-constants';

// Base interface with common audit fields
export interface BaseEntity {
  uuid: string;
  schoolId: string;
  createdbyUserid: string;
  createdAt: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
}

// --------------------------------------------------------------------- Category
export interface SupplyCategory extends BaseEntity {
  code: string;
  name: string;
  status: StatusValue;
}

export interface CreateCategoryRequest {
  code?: string; // derived from name if absent
  name: string;
}

export interface UpdateCategoryRequest {
  name?: string;
}

// ------------------------------------------------------------------------- Item
export interface SupplyItem extends BaseEntity {
  categoryId: string;
  categoryName?: string;
  name: string;
  itemType: ItemType;
  unit: SupplyUnit;
  currentStock: number;
  reorderLevel: number;
  location?: string;
  itemCondition?: ItemCondition;
  costPerUnit?: number;
  comments?: string;
  status: StatusValue;
}

export interface CreateItemRequest {
  categoryId: string;
  name: string;
  unit: SupplyUnit;
  itemType?: ItemType;
  reorderLevel?: number;
  location?: string;
  itemCondition?: ItemCondition;
  costPerUnit?: number;
  comments?: string;
  confirmNewItem?: boolean; // override the fuzzy near-match guard
}

export interface UpdateItemRequest {
  categoryId?: string;
  name?: string;
  unit?: SupplyUnit;
  itemType?: ItemType;
  reorderLevel?: number;
  location?: string;
  itemCondition?: ItemCondition;
  costPerUnit?: number;
  comments?: string;
}

export interface MergeItemRequest {
  targetItemId: string;
}

// A candidate surfaced by the near-match guard.
export interface ItemCandidate {
  itemId: string;
  name: string;
  unit: SupplyUnit;
  currentStock: number;
}

// Returned (with 200 + needsConfirmation) when a create/purchase would make a
// near-duplicate item and confirmNewItem was not set.
export interface NeedsConfirmationResult {
  needsConfirmation: true;
  conflicts: { lineIndex: number; proposedName: string; candidates: ItemCandidate[] }[];
}

// ----------------------------------------------------------------- Purchase batch
export interface SupplyPurchaseLog extends BaseEntity {
  batchId: string;
  itemId: string;
  itemName?: string;
  purchaseDate: Date;
  quantity: number;
  costPerUnit?: number;
  supplier?: string;
  invoiceNumber?: string;
  batchNo?: string;
  remarks?: string;
  status: StatusValue;
}

export interface SupplyPurchaseBatch extends BaseEntity {
  purchaseDate: Date;
  supplier?: string;
  invoiceNumber?: string;
  batchNo?: string;
  notes?: string;
  fileId?: string;
  status: StatusValue;
  items?: SupplyPurchaseLog[];
  itemCount?: number;
  totalCost?: number;
}

// A purchase line: references an existing item OR creates a new one inline.
export interface BulkPurchaseLineItem {
  itemId?: string;
  newItem?: {
    name: string;
    categoryId: string;
    unit: SupplyUnit;
    itemType?: ItemType;
    reorderLevel?: number;
  };
  confirmNewItem?: boolean; // override the fuzzy near-match guard for this line
  quantity: number;
  costPerUnit?: number;
  batchNo?: string;
  remarks?: string;
}

export interface CreateBulkPurchaseRequest {
  purchaseDate: string;
  supplier?: string;
  invoiceNumber?: string;
  batchNo?: string;
  notes?: string;
  items: BulkPurchaseLineItem[];
  bill?: { fileName: string; mimeType: string; base64Data: string };
}

export interface UpdateBatchLineItem {
  uuid?: string; // present = existing row; absent = new line to add
  itemId: string; // batch edits only reference existing items
  quantity: number;
  costPerUnit?: number;
  batchNo?: string;
  remarks?: string;
}

export interface UpdatePurchaseBatchRequest {
  purchaseDate?: string;
  supplier?: string;
  invoiceNumber?: string;
  batchNo?: string;
  notes?: string;
  items?: UpdateBatchLineItem[];
}

// ------------------------------------------------------------------- Issue log
export interface SupplyIssueLog extends BaseEntity {
  itemId: string;
  itemName?: string;
  issueDate: Date;
  quantity: number;
  issueType: IssueType;
  issuedTo?: string;
  issuedToType?: string;
  issuedToId?: string;
  issuedToName?: string;
  issuedToClassName?: string;
  purpose?: string;
  expectedReturnDate?: Date;
  returned?: boolean;
  returnDate?: Date;
  returnCondition?: ReturnCondition;
  returnRemarks?: string;
  status: StatusValue;
}

export interface CreateIssueLogRequest {
  itemId: string;
  issueDate: string;
  quantity?: number;
  issueType: IssueType;
  issuedTo?: string;
  issuedToType?: string;
  issuedToId?: string;
  purpose?: string;
  expectedReturnDate?: string;
}

export interface UpdateIssueLogRequest {
  issueDate?: string;
  quantity?: number;
  issueType?: IssueType;
  issuedTo?: string;
  issuedToType?: string;
  issuedToId?: string;
  purpose?: string;
  expectedReturnDate?: string;
}

export interface ReturnItemRequest {
  returnDate: string;
  returnCondition: ReturnCondition;
  returnRemarks?: string;
}

// ----------------------------------------------------------------- Wastage log
export interface SupplyWastageLog extends BaseEntity {
  itemId: string;
  itemName?: string;
  wastageDate: Date;
  quantity: number;
  reason: WastageReason;
  responsibleType?: ResponsibleType;
  responsibleName?: string;
  responsibleClass?: string;
  responsibleId?: string;
  estimatedCost?: number;
  actionTaken?: WastageAction;
  wastageStatus?: WastageStatus;
  remarks?: string;
  fileId?: string;
  status: StatusValue;
}

export interface CreateWastageLogRequest {
  itemId: string;
  wastageDate: string;
  quantity: number;
  reason: WastageReason;
  responsibleType?: ResponsibleType;
  responsibleName?: string;
  responsibleClass?: string;
  responsibleId?: string;
  estimatedCost?: number;
  actionTaken?: WastageAction;
  wastageStatus?: WastageStatus;
  remarks?: string;
  fileData?: { fileName: string; mimeType: string; base64Data: string };
}

export interface UpdateWastageLogRequest {
  wastageDate?: string;
  quantity?: number;
  reason?: WastageReason;
  responsibleType?: ResponsibleType;
  responsibleName?: string;
  responsibleClass?: string;
  responsibleId?: string;
  estimatedCost?: number;
  actionTaken?: WastageAction;
  wastageStatus?: WastageStatus;
  remarks?: string;
  fileData?: { fileName: string; mimeType: string; base64Data: string };
  deleteFile?: boolean;
}
