import {
  Language,
  CopyStatus,
  BookCondition,
  BorrowerType,
  FineType,
  FineStatus,
  LostChargeMode,
  LookupType,
  StatusValue,
  CirculationStatus,
} from "./library-constants";

export interface BaseEntity {
  uuid: string;
  schoolId: string;
  createdbyUserid?: string;
  createdAt?: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
}

// ---- Work (the intellectual work) ----
export interface LibraryWork extends BaseEntity {
  uniformTitle: string;
  authorInput?: string;
  authorDisplay?: string;
  firstAuthorSurname?: string;
  cutter?: string;
  ddcNumber?: string;
  subjectType?: string;
  topic?: string;
  keywords?: string;
  ageFrom?: number;
  ageTo?: number;
  classFrom?: string;
  classTo?: string;
  colorCode?: string;
  status: StatusValue;
}

export interface WorkFields {
  uniformTitle?: string;
  authorInput?: string;
  authorDisplay?: string;
  firstAuthorSurname?: string;
  ddcNumber?: string;
  subjectType?: string;
  topic?: string;
  keywords?: string;
  ageFrom?: number;
  ageTo?: number;
  classFrom?: string;
  classTo?: string;
  colorCode?: string;
}

// ---- Title (an edition+language) ----
export interface LibraryTitle extends BaseEntity {
  workId: string;
  titleAsPrinted: string;
  language: Language;
  edition?: string;
  yearOfPublication?: number;
  publisher?: string;
  isbn?: string;
  localCallNo?: string;
  pages?: number;
  coverFileId?: string;
  status: StatusValue;
}

export interface TitleFields {
  titleAsPrinted?: string;
  language?: Language;
  edition?: string;
  yearOfPublication?: number;
  publisher?: string;
  isbn?: string;
  localCallNo?: string;
  pages?: number;
  coverFileId?: string;
}

// ---- Copy (a physical book) ----
export interface LibraryCopy extends BaseEntity {
  titleId: string;
  accessionNo: string;
  acquisitionDate?: string;
  acquisitionYear?: number;
  source?: string;
  billNo?: string;
  billDate?: string;
  billFileId?: string;
  acquisitionBatchId?: string;
  price?: number;
  isSpecimen?: boolean;
  almirah?: string;
  shelf?: string;
  qrValue?: string;
  bookCondition?: BookCondition;
  remarks?: string;
  status: CopyStatus | "deleted";
}

export interface CopyInput {
  accessionNo: string;
  acquisitionDate?: string;
  acquisitionYear?: number;
  source?: string;
  billNo?: string;
  billDate?: string;
  billFileId?: string;
  price?: number;
  isSpecimen?: boolean;
  almirah?: string;
  shelf?: string;
  bookCondition?: BookCondition;
  remarks?: string;
}

// ---- Catalog (one-shot create) ----
export interface CatalogRequest {
  workId?: string; // when attaching a new edition/language to an existing work
  work?: WorkFields;
  title: TitleFields;
  copies?: CopyInput[];
}

// ---- Rollup ----
export interface TitleRollup extends LibraryTitle {
  totalCopies: number;
  availableCopies: number;
  issuedCopies: number;
}

export interface WorkWithTitles extends LibraryWork {
  titles: TitleRollup[];
  totalCopies: number;
  availableCopies: number;
}

// ---- Author normalization ----
export interface NormalizedAuthor {
  display: string; // "Surname, First Middle"
  surname: string;
  forename: string;
  cutter: string; // 3 Roman letters, uppercase
}

export interface NormalizeAuthorResult {
  input: string;
  authors: NormalizedAuthor[];
  authorDisplay: string; // comma-separated displays of all authors
  firstAuthorSurname: string;
  cutter: string; // from the first author
}

// ---- Lookups ----
export interface LibraryLookup extends BaseEntity {
  lookupType: LookupType;
  code: string;
  label: string;
  extra?: any;
  status: StatusValue;
}

export interface CreateLookupRequest {
  lookupType: LookupType;
  code: string;
  label: string;
  extra?: any;
}

export interface UpdateLookupRequest {
  label?: string;
  extra?: any;
}

// ---- Circulation ----
export interface LibraryCirculation extends BaseEntity {
  copyId: string;
  borrowerType: BorrowerType;
  borrowerId: string;
  borrowerName?: string;
  issueDate: string;
  dueDate: string;
  returnDate?: string;
  renewCount?: number;
  status: CirculationStatus;
  issuedbyUserid?: string;
}

export interface IssueRequest {
  copyId?: string;
  accessionNo?: string;
  borrowerType: BorrowerType;
  borrowerId: string;
  issueDate?: string;
}

export interface ReturnRequest {
  copyId?: string;
  accessionNo?: string;
  returnDate?: string;
  markLost?: boolean;
}

export interface RenewRequest {
  copyId?: string;
  accessionNo?: string;
}

// ---- Fines ----
export interface LibraryFine extends BaseEntity {
  circulationId?: string;
  copyId: string;
  borrowerType: BorrowerType;
  borrowerId: string;
  fineType: FineType;
  daysOverdue?: number;
  amount: number;
  amountCollected?: number;
  status: FineStatus;
  receiptNumber?: string;
  paidDate?: string;
  notes?: string;
}

export interface CollectFineRequest {
  amountCollected?: number;
  paidDate?: string;
  notes?: string;
}

export interface WaiveFineRequest {
  notes?: string;
}

// ---- Policy ----
export interface LibraryPolicy {
  schoolId: string;
  loanPeriodDays: number;
  maxCopiesPerBorrower: number;
  graceDays: number;
  overdueRatePerDay: number;
  maxFineCap: number;
  renewLimit: number;
  lostChargeMode: LostChargeMode;
  lostChargeValue: number;
  updatedbyUserid?: string;
  updatedAt?: Date;
}

export interface UpdatePolicyRequest {
  loanPeriodDays?: number;
  maxCopiesPerBorrower?: number;
  graceDays?: number;
  overdueRatePerDay?: number;
  maxFineCap?: number;
  renewLimit?: number;
  lostChargeMode?: LostChargeMode;
  lostChargeValue?: number;
}
