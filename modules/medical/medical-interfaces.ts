import { MedicalUnit, EntityType, StatusValue } from './medical-constants';

// Base interface with common audit fields
export interface BaseEntity {
  uuid: string;
  schoolId: string;
  createdbyUserid: string;
  createdAt: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
}

// Medical Item
export interface MedicalItem extends BaseEntity {
  name: string;
  unit: MedicalUnit;
  reorderLevel: number;
  currentStock: number;
  comments?: string;
  status: StatusValue;
}

export interface CreateMedicalItemRequest {
  name: string;
  unit: MedicalUnit;
  reorderLevel?: number;
  comments?: string;
}

export interface UpdateMedicalItemRequest {
  name?: string;
  unit?: MedicalUnit;
  reorderLevel?: number;
  comments?: string;
}

// Purchase Log
export interface MedicalPurchaseLog extends BaseEntity {
  itemId: string;
  itemName?: string; // Joined from medical_item
  purchaseDate: Date;
  batchNo?: string;
  expiryDate?: Date;
  quantity: number;
  supplier?: string;
  invoiceNumber?: string;
  costPerUnit?: number;
  batchId?: string;
  status: StatusValue;
}

export interface CreatePurchaseLogRequest {
  itemId: string;
  purchaseDate: string; // ISO date string
  batchNo?: string;
  expiryDate?: string; // ISO date string
  quantity: number;
  supplier?: string;
  invoiceNumber?: string;
  costPerUnit?: number;
}

export interface UpdatePurchaseLogRequest {
  purchaseDate?: string;
  batchNo?: string;
  expiryDate?: string;
  quantity?: number;
  supplier?: string;
  invoiceNumber?: string;
  costPerUnit?: number;
}

// Issue Log
export interface MedicalIssueLog extends BaseEntity {
  itemId: string;
  itemName?: string; // Joined from medical_item
  issueDate: Date;
  entityType: EntityType;
  entityId: string;
  entityName?: string; // Employee name or Student name
  entityClassName?: string; // Class name (students only)
  quantity: number;
  remarks?: string;
  parentConsent: boolean;
  issuedById?: string;
  issuedByName?: string;
  status: StatusValue;
}

export interface CreateIssueLogRequest {
  itemId: string;
  issueDate: string; // ISO date string
  entityType: EntityType;
  entityId: string;
  quantity?: number;
  remarks?: string;
  parentConsent?: boolean;
  issuedById?: string;
}

export interface UpdateIssueLogRequest {
  issueDate?: string;
  entityType?: EntityType;
  entityId?: string;
  quantity?: number;
  remarks?: string;
  parentConsent?: boolean;
  issuedById?: string;
}

// Purchase Batch
export interface MedicalPurchaseBatch extends BaseEntity {
  purchaseDate: Date;
  supplier?: string;
  invoiceNumber?: string;
  batchNo?: string;
  notes?: string;
  fileId?: string;
  status: StatusValue;
  items?: MedicalPurchaseLog[]; // populated only on getById
  recordType?: 'batch' | 'purchase'; // 'purchase' = pre-batch individual purchase
  itemCount?: number;
  itemName?: string; // set for pre-batch individual purchases
  totalCost?: number;
}

export interface BulkPurchaseLineItem {
  itemId: string;
  quantity: number;
  costPerUnit?: number;
  expiryDate?: string;
  batchNo?: string; // per-item pharmaceutical lot; inherits batch header batchNo if omitted
}

export interface CreateBulkPurchaseRequest {
  purchaseDate: string; // required
  supplier?: string;
  invoiceNumber?: string;
  batchNo?: string; // default lot for all items
  notes?: string;
  items: BulkPurchaseLineItem[]; // min 1 required
  bill?: {
    fileName: string;
    mimeType: string;
    base64Data: string;
  };
}

export interface UpdatePurchaseBatchRequest {
  purchaseDate?: string;
  supplier?: string;
  invoiceNumber?: string;
  batchNo?: string;
  notes?: string;
}

export interface UploadBillRequest {
  fileName: string;
  mimeType: string;
  base64Data: string;
}

export interface ExpiringPurchase {
  uuid: string;
  itemId: string;
  itemName: string;
  batchNo: string | null;
  expiryDate: string;
  daysUntilExpiry: number;
  quantity: number;
  purchaseDate: string;
  supplier: string | null;
  batchId: string | null;
}
