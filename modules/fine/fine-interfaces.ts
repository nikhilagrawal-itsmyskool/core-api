import { FineCategory, FineDecision, FinePaymentMethod, FineStatus, PersonType } from './fine-constants';

export interface BaseEntity {
  uuid: string;
  schoolId: string;
  createdbyUserid: string;
  createdAt: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
}

// ── Incident ─────────────────────────────────────────────────────────────────

export interface FineIncident extends BaseEntity {
  incidentDate: Date;
  category: FineCategory;
  personType: PersonType;
  personId: string;
  description?: string;
  suggestedFineAmount?: number;
  assignedToId?: string;
  decidedFineAmount?: number;
  decision?: FineDecision;
  status: FineStatus;
  reportedById: string;
}

export interface FineIncidentDetail extends FineIncident {
  personName?: string;
  personClassName?: string; // students only
  assigneeName?: string;
  reporterName?: string;
  notes: FineIncidentNote[];
  evidence: FineIncidentEvidenceMeta[];
  collections: FineCollection[];
  totalCollected: number;
}

export interface CreateIncidentRequest {
  incidentDate: string; // ISO date string
  category: FineCategory;
  personType: PersonType;
  personId: string;
  description?: string;
  suggestedFineAmount?: number;
  reportedById?: string; // defaults to current user
}

export interface UpdateIncidentRequest {
  incidentDate?: string;
  category?: FineCategory;
  description?: string;
  suggestedFineAmount?: number;
  assignedToId?: string | null; // null to unassign
  decidedFineAmount?: number;
  decision?: FineDecision;
  status?: FineStatus; // direct status override (validated against VALID_STATUS_TRANSITIONS)
}

// ── Note ─────────────────────────────────────────────────────────────────────

export interface FineIncidentNote {
  uuid: string;
  incidentId: string;
  schoolId: string;
  authorId: string;
  authorType: PersonType;
  authorName?: string;
  noteText: string;
  noteType: 'comment' | 'system';
  createdbyUserid: string;
  createdAt: Date;
}

export interface CreateNoteRequest {
  noteText: string;
  authorId?: string; // defaults to current user
  authorType?: PersonType; // defaults to 'employee'
}

// ── Evidence ─────────────────────────────────────────────────────────────────

export interface FineIncidentEvidenceMeta extends BaseEntity {
  incidentId: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string;
  status: 'active' | 'deleted';
}

export interface FineIncidentEvidenceWithData extends FineIncidentEvidenceMeta {
  data: string; // base64
}

export interface UploadEvidenceRequest {
  fileName: string;
  mimeType: string;
  base64Data: string;
}

// ── Collection ────────────────────────────────────────────────────────────────

export interface FineCollection extends BaseEntity {
  incidentId: string;
  amountCollected: number;
  collectionDate: Date;
  paymentMethod?: FinePaymentMethod;
  receiptNumber: string;
  notes?: string;
  collectedById: string;
  status: 'active' | 'deleted';
}

export interface CollectFineRequest {
  amountCollected: number;
  collectionDate: string; // ISO date string
  paymentMethod?: FinePaymentMethod;
  notes?: string;
  collectedById?: string; // defaults to current user
}
