import {
  DocType,
  EntryType,
  Exam,
  Layout,
  Month,
  ProgressStatus,
  Term,
} from "./syllabus-constants";

// ── Subjects ────────────────────────────────────────────────────────────────
export interface SyllabusSubject {
  uuid: string;
  schoolId: string;
  name: string;
  description: string | null;
  status: string;
}

export interface CreateSubjectRequest {
  name: string;
  description?: string;
}

export interface UpdateSubjectRequest {
  name?: string;
  description?: string;
}

// ── Plans ───────────────────────────────────────────────────────────────────
export interface Syllabus {
  uuid: string;
  schoolId: string;
  academicYearId: string;
  grade: string;
  streamCode: string | null;
  subjectId: string;
  book: string | null;
  layout: Layout;
  note: string | null;
  status: string;
}

export interface CreateSyllabusRequest {
  academicYearId: string;
  grade: string;
  streamCode?: string | null;
  subjectId: string;
  layout: Layout;
  book?: string;
  note?: string;
}

export interface UpdateSyllabusRequest {
  grade?: string;
  streamCode?: string | null;
  book?: string;
  layout?: Layout;
  note?: string;
}

// ── Entries ─────────────────────────────────────────────────────────────────
export interface SyllabusEntry {
  uuid: string;
  syllabusId: string;
  seq: number;
  month: Month;
  entryType: EntryType;
  topicNo: string | null;
  title: string;
  theme: string | null;
  pageRef: string | null;
  term: Term | null;
}

export interface EntryInput {
  month: Month;
  entryType?: EntryType;
  topicNo?: string;
  title: string;
  theme?: string;
  pageRef?: string;
  term?: Term;
}

export interface BulkEntriesRequest {
  mode?: "append" | "replace";
  entries: EntryInput[];
}

export interface ReorderEntriesRequest {
  order: string[]; // entry uuids in desired sequence
}

// ── Progress ────────────────────────────────────────────────────────────────
export interface MarkProgressRequest {
  entryId: string;
  classId: string;
  status: ProgressStatus;
  coveredDate?: string;
  remark?: string;
}

export interface BulkProgressRequest {
  classId: string;
  marks: {
    entryId: string;
    status: ProgressStatus;
    coveredDate?: string;
    remark?: string;
  }[];
}

export interface EntryWithProgress extends SyllabusEntry {
  covered: boolean;
  coveredDate: string | null;
  remark: string | null;
}

// ── Model papers ────────────────────────────────────────────────────────────
export interface ModelPaperDoc {
  uuid: string;
  docType: DocType;
  pdfStatus: string; // pending | ready | failed | none
  hasDocx: boolean;
  hasPdf: boolean;
  docxFileId: string | null;
  pdfFileId: string | null;
}

export interface ModelPaper {
  uuid: string;
  academicYearId: string;
  grade: string;
  streamCode: string | null;
  subjectId: string;
  subjectName?: string | null;
  exam: Exam;
  answerKeyReleased: boolean;
  docs: ModelPaperDoc[];
}

export interface UploadPaperDocRequest {
  academicYearId: string;
  grade: string;
  streamCode?: string | null;
  subjectId: string;
  exam: Exam;
  docType: DocType;
  fileName: string;
  mimeType?: string;
  base64Data: string; // the .docx (or a PDF if that's all there is)
  pdfFileName?: string; // optional: attach a ready-made PDF, skipping conversion
  pdfBase64Data?: string;
}
