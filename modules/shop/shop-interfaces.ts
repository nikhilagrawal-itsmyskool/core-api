import { ItemType, Section, PaymentStatus } from './shop-constants';

// ── Item ──────────────────────────────────────────────────────────────────────

export interface ShopItem {
  uuid: string;
  schoolId: string;
  name: string;
  type: ItemType;
  subject?: string;
  publisher?: string;
  classNo?: number;
  currentStock: number;
  description?: string;
  status: string;
  createdbyUserid: string;
  createdAt: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
}

export interface ShopItemWithPricing extends ShopItem {
  lastMrp?: number;
  lastStudentDiscountPct?: number;
  lastBulkDiscountPct?: number;
  lastAcademicSession?: string;
  discountedStockValue?: number;
}

export interface CreateItemRequest {
  name: string;
  type: ItemType;
  subject?: string;
  publisher?: string;
  classNo?: number;
  description?: string;
}

export interface UpdateItemRequest {
  name?: string;
  subject?: string;
  publisher?: string;
  classNo?: number;
  description?: string;
}

// ── Purchase ──────────────────────────────────────────────────────────────────

export interface ShopPurchaseBatch {
  uuid: string;
  schoolId: string;
  purchaseDate: string;
  academicSession?: string;
  supplier?: string;
  invoiceNumber?: string;
  notes?: string;
  totalAmount?: number;
  studentDiscountPct?: number;
  bulkDiscountPct?: number;
  fileId?: string;
  status: string;
  createdbyUserid: string;
  createdAt: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
}

export interface ShopPurchaseLog {
  uuid: string;
  batchId: string;
  schoolId: string;
  itemId: string;
  quantity: number;
  mrp?: number;
  studentDiscountPct?: number;
  bulkDiscountPct?: number;
  costPerUnit?: number;
  remainingQuantity?: number;
  status: string;
  createdbyUserid: string;
  createdAt: Date;
  // Joined fields
  itemName?: string;
  itemType?: string;
  itemClassNo?: number;
  academicSession?: string;
}

export interface ShopPurchaseBatchDetail extends ShopPurchaseBatch {
  items: ShopPurchaseLog[];
}

export interface CreatePurchaseBatchRequest {
  purchaseDate: string;
  academicSession?: string;
  supplier?: string;
  invoiceNumber?: string;
  notes?: string;
  studentDiscountPct?: number;
  bulkDiscountPct?: number;
  items: CreatePurchaseItemRequest[];
  bill?: UploadBillRequest;
}

export interface CreatePurchaseItemRequest {
  itemId: string;
  quantity: number;
  mrp: number;
  studentDiscountPct?: number;
  bulkDiscountPct?: number;
  costPerUnit?: number;
}

export interface UploadBillRequest {
  fileName: string;
  mimeType: string;
  base64Data: string;
}

// ── Set ───────────────────────────────────────────────────────────────────────

export interface ShopSet {
  uuid: string;
  schoolId: string;
  name: string;
  classNo: number;
  academicSession: string;
  description?: string;
  status: string;
  createdbyUserid: string;
  createdAt: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
}

export interface ShopSetItem {
  uuid: string;
  setId: string;
  schoolId: string;
  itemId: string;
  section: Section;
  quantity: number;
  sortOrder: number;
  status: string;
  createdbyUserid: string;
  createdAt: Date;
  // Joined fields
  itemName?: string;
  itemType?: string;
  itemSubject?: string;
  itemPublisher?: string;
  lastMrp?: number;
  lastStudentDiscountPct?: number;
}

export interface ShopSetDetail extends ShopSet {
  items: ShopSetItem[];
}

export interface CreateSetRequest {
  name: string;
  classNo: number;
  academicSession: string;
  description?: string;
  items: CreateSetItemRequest[];
}

export interface CreateSetItemRequest {
  itemId: string;
  section: Section;
  quantity: number;
  sortOrder?: number;
}

export interface UpdateSetRequest {
  name?: string;
  description?: string;
  items?: CreateSetItemRequest[];
}

// ── Sale ──────────────────────────────────────────────────────────────────────

export interface ShopSale {
  uuid: string;
  schoolId: string;
  studentId: string;
  saleDate: string;
  setId?: string;
  academicSession?: string;
  totalMrp?: number;
  totalDiscount?: number;
  totalAmount?: number;
  amountPaid?: number;
  paymentStatus: PaymentStatus;
  notes?: string;
  status: string;
  createdbyUserid: string;
  createdAt: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
  // Joined fields
  studentName?: string;
  studentAdmissionNo?: string;
}

export interface ShopSaleItem {
  uuid: string;
  saleId: string;
  schoolId: string;
  itemId: string;
  quantity: number;
  mrp?: number;
  discountPct?: number;
  unitPrice?: number;
  lineTotal?: number;
  returnedQuantity: number;
  status: string;
  createdbyUserid: string;
  createdAt: Date;
  // Joined fields
  itemName?: string;
  itemType?: string;
  itemClassNo?: number;
}

export interface ShopSaleDetail extends ShopSale {
  items: ShopSaleItem[];
}

export interface CreateSaleRequest {
  studentId: string;
  saleDate: string;
  setId?: string;
  academicSession?: string;
  amountPaid: number;
  notes?: string;
  items: CreateSaleItemRequest[];
}

export interface CreateSaleItemRequest {
  itemId: string;
  quantity: number;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface ShopStats {
  totalItems: number;
  totalStockValue: number;
  totalCollection: number;
  pendingCollection: number;
  salesToday: number;
  salesThisMonth: number;
}
