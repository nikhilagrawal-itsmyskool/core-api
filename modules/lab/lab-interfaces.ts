import {
  LabType, LabUnit, ItemType, ItemCondition, IssueType,
  ResponsibleType, BreakageCause, BreakageAction, BreakageStatus,
  ReturnCondition, StatusValue, LabStatusValue,
} from './lab-constants';

// Base interface with common audit fields
export interface BaseEntity {
  uuid: string;
  schoolId: string;
  createdbyUserid: string;
  createdAt: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
}

// Lab
export interface Lab extends BaseEntity {
  name: string;
  type: LabType;
  location?: string;
  inChargeId?: string;
  status: LabStatusValue;
}

export interface CreateLabRequest {
  name: string;
  type: LabType;
  location?: string;
  inChargeId?: string;
}

export interface UpdateLabRequest {
  name?: string;
  type?: LabType;
  location?: string;
  inChargeId?: string;
  status?: LabStatusValue;
}

// Lab Item
export interface LabItem extends BaseEntity {
  labId: string;
  name: string;
  category?: string;
  itemType: ItemType;
  unit: LabUnit;
  currentStock: number;
  reorderLevel: number;
  location?: string;
  itemCondition?: ItemCondition;
  costPerUnit?: number;
  comments?: string;
  status: StatusValue;
}

export interface CreateLabItemRequest {
  labId: string;
  name: string;
  category?: string;
  itemType: ItemType;
  unit: LabUnit;
  reorderLevel?: number;
  location?: string;
  itemCondition?: ItemCondition;
  costPerUnit?: number;
  comments?: string;
}

export interface UpdateLabItemRequest {
  name?: string;
  category?: string;
  itemType?: ItemType;
  unit?: LabUnit;
  reorderLevel?: number;
  location?: string;
  itemCondition?: ItemCondition;
  costPerUnit?: number;
  comments?: string;
}

// Purchase Log
export interface LabPurchaseLog extends BaseEntity {
  itemId: string;
  labId: string;
  itemName?: string;
  purchaseDate: Date;
  quantity: number;
  costPerUnit?: number;
  supplier?: string;
  invoiceNumber?: string;
  batchNo?: string;
  expiryDate?: Date;
  warrantyEndDate?: Date;
  remarks?: string;
  status: StatusValue;
}

export interface CreatePurchaseLogRequest {
  itemId: string;
  labId: string;
  purchaseDate: string;
  quantity: number;
  costPerUnit?: number;
  supplier?: string;
  invoiceNumber?: string;
  batchNo?: string;
  expiryDate?: string;
  warrantyEndDate?: string;
  remarks?: string;
}

export interface UpdatePurchaseLogRequest {
  purchaseDate?: string;
  quantity?: number;
  costPerUnit?: number;
  supplier?: string;
  invoiceNumber?: string;
  batchNo?: string;
  expiryDate?: string;
  warrantyEndDate?: string;
  remarks?: string;
}

// Issue Log
export interface LabIssueLog extends BaseEntity {
  itemId: string;
  labId: string;
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
  labId: string;
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
export interface LabBreakageLog extends BaseEntity {
  itemId: string;
  labId: string;
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
  status: StatusValue;
}

export interface CreateBreakageLogRequest {
  itemId: string;
  labId: string;
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
}
