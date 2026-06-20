import {
  SportType, SportUnit, ItemType, ItemCondition, IssueType,
  ResponsibleType, BreakageCause, BreakageAction, BreakageStatus,
  ReturnCondition, StatusValue,
} from './sport-constants';

// Base interface with common audit fields
export interface BaseEntity {
  uuid: string;
  schoolId: string;
  createdbyUserid: string;
  createdAt: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
}

// Sport In-charge (who manages a sport's equipment; multiple allowed per sport)
export interface SportIncharge extends BaseEntity {
  sportType: SportType;
  inChargeId: string;
  inChargeName?: string;
  status: StatusValue;
}

export interface SetInchargesRequest {
  inChargeIds: string[];
}

// Sport Item
export interface SportItem extends BaseEntity {
  sportType: SportType;
  name: string;
  category?: string;
  itemType: ItemType;
  unit: SportUnit;
  currentStock: number;
  reorderLevel: number;
  location?: string;
  itemCondition?: ItemCondition;
  costPerUnit?: number;
  comments?: string;
  status: StatusValue;
}

export interface CreateSportItemRequest {
  sportType: SportType;
  name: string;
  category?: string;
  itemType: ItemType;
  unit: SportUnit;
  reorderLevel?: number;
  location?: string;
  itemCondition?: ItemCondition;
  costPerUnit?: number;
  comments?: string;
}

export interface UpdateSportItemRequest {
  name?: string;
  category?: string;
  itemType?: ItemType;
  unit?: SportUnit;
  reorderLevel?: number;
  location?: string;
  itemCondition?: ItemCondition;
  costPerUnit?: number;
  comments?: string;
}

// Purchase Log
export interface SportPurchaseLog extends BaseEntity {
  itemId: string;
  sportType: SportType;
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

export interface CreatePurchaseLogRequest {
  itemId: string;
  sportType: SportType;
  purchaseDate: string;
  quantity: number;
  costPerUnit?: number;
  supplier?: string;
  invoiceNumber?: string;
  batchNo?: string;
  remarks?: string;
}

export interface UpdatePurchaseLogRequest {
  purchaseDate?: string;
  quantity?: number;
  costPerUnit?: number;
  supplier?: string;
  invoiceNumber?: string;
  batchNo?: string;
  remarks?: string;
}

// Issue Log
export interface SportIssueLog extends BaseEntity {
  itemId: string;
  sportType: SportType;
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
  sportType: SportType;
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

// Breakage Log
export interface SportBreakageLog extends BaseEntity {
  itemId: string;
  sportType: SportType;
  itemName?: string;
  breakageDate: Date;
  quantity: number;
  responsibleType?: ResponsibleType;
  responsibleName?: string;
  responsibleClass?: string;
  responsibleId?: string;
  cause?: BreakageCause;
  estimatedCost?: number;
  actionTaken?: BreakageAction;
  breakageStatus?: BreakageStatus;
  remarks?: string;
  fileId?: string;
  status: StatusValue;
}

export interface CreateBreakageLogRequest {
  itemId: string;
  sportType: SportType;
  breakageDate: string;
  quantity: number;
  responsibleType?: ResponsibleType;
  responsibleName?: string;
  responsibleClass?: string;
  responsibleId?: string;
  cause?: BreakageCause;
  estimatedCost?: number;
  actionTaken?: BreakageAction;
  breakageStatus?: BreakageStatus;
  remarks?: string;
  fileData?: { fileName: string; mimeType: string; base64Data: string };
}

export interface UpdateBreakageLogRequest {
  breakageDate?: string;
  quantity?: number;
  responsibleType?: ResponsibleType;
  responsibleName?: string;
  responsibleClass?: string;
  responsibleId?: string;
  cause?: BreakageCause;
  estimatedCost?: number;
  actionTaken?: BreakageAction;
  breakageStatus?: BreakageStatus;
  remarks?: string;
  fileData?: { fileName: string; mimeType: string; base64Data: string };
  deleteFile?: boolean;
}

// Purchase Batch
export interface SportPurchaseBatch extends BaseEntity {
  purchaseDate: Date;
  supplier?: string;
  invoiceNumber?: string;
  batchNo?: string;
  notes?: string;
  fileId?: string;
  status: StatusValue;
  items?: SportPurchaseLog[];
  recordType?: 'batch' | 'purchase';
  itemCount?: number;
  totalCost?: number;
}

export interface BulkSportPurchaseLineItem {
  itemId: string;
  sportType: SportType;
  quantity: number;
  costPerUnit?: number;
  batchNo?: string;
  remarks?: string;
}

export interface CreateBulkSportPurchaseRequest {
  purchaseDate: string;
  supplier?: string;
  invoiceNumber?: string;
  batchNo?: string;
  notes?: string;
  items: BulkSportPurchaseLineItem[];
  bill?: { fileName: string; mimeType: string; base64Data: string };
}

export interface UpdateBatchLineItem {
  uuid?: string; // present = existing row; absent = new item to add
  itemId: string;
  sportType: SportType;
  quantity: number;
  costPerUnit?: number;
  batchNo?: string;
  remarks?: string;
}

export interface UpdateSportPurchaseBatchRequest {
  purchaseDate?: string;
  supplier?: string;
  invoiceNumber?: string;
  batchNo?: string;
  notes?: string;
  items?: UpdateBatchLineItem[];
}
