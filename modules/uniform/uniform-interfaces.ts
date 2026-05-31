import { UniformCategory, UniformGender, SaleType, PaymentStatus } from './uniform-constants';

// ── Item ──────────────────────────────────────────────────────────────────────

export interface UniformItem {
  uuid: string;
  schoolId: string;
  name: string;
  category: UniformCategory;
  gender: UniformGender;
  isSeeded: boolean;
  description?: string;
  status: string;
  createdbyUserid: string;
  createdAt: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
}

export interface UniformItemSize {
  uuid: string;
  itemId: string;
  schoolId: string;
  sizeLabel: string;
  mrp?: number;
  studentDiscountPct?: number;
  bulkDiscountPct?: number;
  currentStock: number;
  status: string;
  createdbyUserid: string;
  createdAt: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
}

export interface UniformItemWithSizes extends UniformItem {
  sizes: UniformItemSize[];
}

export interface CreateItemRequest {
  name: string;
  category: UniformCategory;
  gender: UniformGender;
  description?: string;
}

export interface UpdateItemRequest {
  name?: string;
  category?: UniformCategory;
  gender?: UniformGender;
  description?: string;
}

export interface CreateSizeRequest {
  sizeLabel: string;
  mrp?: number;
  studentDiscountPct?: number;
  bulkDiscountPct?: number;
}

export interface UpdateSizeRequest {
  sizeLabel?: string;
  mrp?: number;
  studentDiscountPct?: number;
  bulkDiscountPct?: number;
}

// ── Purchase ──────────────────────────────────────────────────────────────────

export interface UniformPurchaseBatch {
  uuid: string;
  schoolId: string;
  purchaseDate: string;
  supplier?: string;
  invoiceNumber?: string;
  notes?: string;
  totalAmount?: number;
  fileId?: string;
  status: string;
  createdbyUserid: string;
  createdAt: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
}

export interface UniformPurchaseLog {
  uuid: string;
  batchId: string;
  schoolId: string;
  itemId: string;
  sizeId: string;
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
  itemCategory?: string;
  itemGender?: string;
  sizeLabel?: string;
}

export interface UniformPurchaseBatchDetail extends UniformPurchaseBatch {
  items: UniformPurchaseLog[];
}

export interface CreatePurchaseBatchRequest {
  purchaseDate: string;
  supplier?: string;
  invoiceNumber?: string;
  notes?: string;
  items: CreatePurchaseItemRequest[];
  bill?: UploadBillRequest;
}

export interface CreatePurchaseItemRequest {
  itemId: string;
  sizeId: string;
  quantity: number;
  mrp: number;
  studentDiscountPct?: number;
  bulkDiscountPct?: number;
}

export interface UploadBillRequest {
  fileName: string;
  mimeType: string;
  base64Data: string;
}

// ── Set ───────────────────────────────────────────────────────────────────────

export interface UniformSet {
  uuid: string;
  schoolId: string;
  name: string;
  gender?: UniformGender;
  description?: string;
  status: string;
  createdbyUserid: string;
  createdAt: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
}

export interface UniformSetItem {
  uuid: string;
  setId: string;
  schoolId: string;
  itemId: string;
  quantity: number;
  sortOrder: number;
  status: string;
  createdbyUserid: string;
  createdAt: Date;
  // Joined fields
  itemName?: string;
  itemCategory?: string;
  itemGender?: string;
}

export interface UniformSetDetail extends UniformSet {
  items: UniformSetItem[];
}

export interface CreateSetRequest {
  name: string;
  gender?: UniformGender;
  description?: string;
  items: CreateSetItemRequest[];
}

export interface CreateSetItemRequest {
  itemId: string;
  quantity: number;
  sortOrder?: number;
}

export interface UpdateSetRequest {
  name?: string;
  gender?: UniformGender;
  description?: string;
  items?: CreateSetItemRequest[];
}

// ── Sale ──────────────────────────────────────────────────────────────────────

export interface UniformSale {
  uuid: string;
  schoolId: string;
  studentId: string;
  saleDate: string;
  saleType: SaleType;
  setId?: string;
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

export interface UniformSaleItem {
  uuid: string;
  saleId: string;
  schoolId: string;
  itemId: string;
  sizeId: string;
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
  itemCategory?: string;
  itemGender?: string;
  sizeLabel?: string;
}

export interface UniformSalePayment {
  uuid: string;
  saleId: string;
  schoolId: string;
  amount: number;
  paymentDate: string;
  notes?: string;
  status: string;
  createdbyUserid: string;
  createdAt: Date;
}

export interface UniformSaleDetail extends UniformSale {
  items: UniformSaleItem[];
  returns: UniformReturn[];
  payments: UniformSalePayment[];
}

export interface CreateSaleRequest {
  studentId: string;
  saleDate: string;
  saleType: SaleType;
  setId?: string;
  amountPaid: number;
  notes?: string;
  items: CreateSaleItemRequest[];
}

export interface CreateSaleItemRequest {
  itemId: string;
  sizeId: string;
  quantity: number;
}

// ── Return ────────────────────────────────────────────────────────────────────

export interface UniformReturn {
  uuid: string;
  schoolId: string;
  saleId: string;
  saleItemId: string;
  returnDate: string;
  quantity: number;
  refundAmount?: number;
  reason: string;
  fileId?: string;
  status: string;
  createdbyUserid: string;
  createdAt: Date;
  // Joined fields
  itemName?: string;
  sizeLabel?: string;
  returnFileName?: string;
  returnMimeType?: string;
}

export interface EvidenceUploadRequest {
  fileName: string;
  mimeType: string;
  base64Data: string;
}

export interface CreateReturnRequest {
  saleItemId: string;
  returnDate: string;
  quantity: number;
  reason: string;
  evidence?: EvidenceUploadRequest;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface UniformStats {
  totalItems: number;
  totalSizesInStock: number;
  totalStockValue: number;
  totalCost: number;
  discountedStockValue: number;
  totalCollection: number;
  pendingCollection: number;
  salesToday: number;
  salesThisMonth: number;
  hotSellingItems: {
    months: string[];
    series: { name: string; data: number[] }[];
  };
}
