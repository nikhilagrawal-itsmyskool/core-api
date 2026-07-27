import { DayStatus } from "./homework-constants";

// ---- Image on an item ----
export interface HomeworkImageInput {
  fileName: string;
  mimeType: string;
  base64Data: string; // raw base64, no data: URI prefix
}

// ---- Write requests ----
export interface EnsureDayRequest {
  classId: string;
  date: string; // YYYY-MM-DD
  academicYearId?: string;
}

export interface AddItemRequest {
  classId: string;
  date: string; // YYYY-MM-DD
  academicYearId?: string;
  subjectLabel?: string;
  note?: string;
  image: HomeworkImageInput;
}

export interface EditItemRequest {
  subjectLabel?: string;
  note?: string;
}

export interface SetClassTeacherRequest {
  teacherId: string;
  academicYearId?: string;
}

// ---- Read models ----
export interface HomeworkItemView {
  uuid: string;
  subjectLabel?: string | null;
  note?: string | null;
  seq: number | null;
  imageUrl?: string | null; // presigned (S3/prod); null in local/Postgres mode
  fileId?: string | null;   // file_storage uuid — fetch base64 via /homework/items/{id}/image
}

export interface HomeworkDayView {
  uuid: string;
  classId: string;
  className?: string | null;
  academicYearId: string;
  homeworkDate: string; // YYYY-MM-DD
  status: DayStatus;
  publishedAt?: string | null;
  items: HomeworkItemView[];
}

// The header + items for a (class, date); day is null when nothing has been started.
export interface HomeworkDayResult {
  classId: string;
  date: string;
  className?: string | null;
  day: HomeworkDayView | null;
}

export interface MyHomeworkClass {
  classId: string;
  className: string;
  source: "override" | "timetable";
}

export interface ClassTeacherMapRow {
  classId: string;
  className: string;
  teacherId: string | null;
  teacherName: string | null;
  source: "override" | "timetable" | "none";
}

// Student "today's homework" — only a published day is returned.
export interface StudentHomeworkView {
  date: string;
  classId: string | null;
  className: string | null;
  published: boolean;
  items: HomeworkItemView[];
}

export interface HomeworkAuditRow {
  uuid: string;
  homeworkDayId?: string | null;
  itemId?: string | null;
  action: string;
  detail?: string | null;
  changedbyUserid?: string | null;
  changedbyName?: string | null;
  changedAt?: string | null;
}
