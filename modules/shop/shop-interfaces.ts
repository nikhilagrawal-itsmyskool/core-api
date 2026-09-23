import { ItemType, Section, PaymentStatus, LooseReason } from './shop-constants';

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
  grade: string;
  classNo?: number;
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
  mrp?: number;         // unit list price for this line
  discountPct?: number; // 0..100
  unitPrice?: number;   // computed: mrp * (1 - discountPct/100)
  lineTotal?: number;   // computed: unitPrice * quantity
  sortOrder: number;
  status: string;
  createdbyUserid: string;
  createdAt: Date;
  // Joined fields
  itemName?: string;
  itemType?: string;
  itemSubject?: string;
  itemPublisher?: string;
}

export interface ShopSetDetail extends ShopSet {
  items: ShopSetItem[];
  setPrice: number; // sum of line totals
}

// Stock summary for a set (the "sets + loose box" model).
export interface ShopSetStock {
  received: number;
  assigned: number;
  remaining: number;
  loose: ShopLooseEntry[];
}

export interface CreateSetRequest {
  name?: string;
  grade: string;
  academicSession: string;
  description?: string;
  items: CreateSetItemRequest[];
}

export interface CreateSetItemRequest {
  itemId: string;
  section: Section;
  quantity: number;
  mrp?: number;
  discountPct?: number;
  sortOrder?: number;
}

export interface UpdateSetRequest {
  name?: string;
  description?: string;
  items?: CreateSetItemRequest[];
}

// ── Set intake (procurement) ────────────────────────────────────────────────

export interface ShopSetIntake {
  uuid: string;
  schoolId: string;
  setId: string;
  grade: string;
  academicSession: string;
  qtySets: number;
  unitCost?: number;
  supplier?: string;
  intakeDate: string;
  notes?: string;
  status: string;
  createdbyUserid: string;
  createdAt: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
  // Joined fields
  setName?: string;
}

export interface CreateIntakeRequest {
  setId: string;
  qtySets: number;
  intakeDate: string;
  unitCost?: number;
  supplier?: string;
  notes?: string;
}

// ── Loose box ────────────────────────────────────────────────────────────────

export interface ShopLooseEntry {
  itemId: string;
  itemName?: string;
  itemType?: string;
  qty: number;
}

export interface ShopLooseMovement {
  uuid: string;
  schoolId: string;
  itemId: string;
  academicSession?: string;
  grade?: string;
  qty: number;
  reason: LooseReason;
  refSaleId?: string;
  note?: string;
  status: string;
  createdbyUserid: string;
  createdAt: Date;
  itemName?: string;
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

// Assign a whole set to a student, optionally minus some declined recipe lines.
// Pricing comes from the set recipe; declined lines drop into the loose box.
export interface AssignSetRequest {
  studentId: string;
  setId: string;
  saleDate: string;
  amountPaid: number;
  notes?: string;
  declinedSetItemIds?: string[]; // shop_set_item uuids the student did not take
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
