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
}

export interface UpdateIssueLogRequest {
  issueDate?: string;
  entityType?: EntityType;
  entityId?: string;
  quantity?: number;
  remarks?: string;
  parentConsent?: boolean;
}
