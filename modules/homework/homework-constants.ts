// Homework module constants.

export const DAY_STATUSES = ["draft", "published"] as const;
export const ITEM_STATUSES = ["active", "deleted"] as const;
export const AUDIT_ACTIONS = ["upload", "remove", "edit", "publish", "unpublish"] as const;

export type DayStatus = (typeof DAY_STATUSES)[number];
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// Image validation — same limits as student/guardian photos.
export const HW_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB (a homework photo can be bigger than an ID photo)
export const HW_IMAGE_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

// Documents. A PDF is stored as-is (immediately viewable). A Word doc is stored as the
// SOURCE and converted to a PDF asynchronously by the conversion worker (LibreOffice
// layer) — parents only ever see the converted PDF, never a .docx.
export const HW_DOC_MAX_BYTES = 8 * 1024 * 1024; // 8 MB (pdf / word)
export const HW_PDF_MIME = "application/pdf";
export const HW_WORD_ALLOWED_MIME = [
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
] as const;

// Target mime for a converted document.
export const HW_PDF_MIME_OUT = "application/pdf";

// Conversion worker: give up (mark 'failed') after this many attempts on the same item.
export const HW_MAX_CONVERT_ATTEMPTS = 3;

// file_storage variants under a homework item: the rendered/stored file parents see
// ('original'), and the uploaded Word source awaiting conversion ('source').
export const FILE_ENTITY_TYPE = "homework";
export const HW_VARIANT_ORIGINAL = "original";
export const HW_VARIANT_SOURCE = "source";
