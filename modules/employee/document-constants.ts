// Staff document handbook constants.

// file_storage entity types for the two signature artifacts + an optional doc PDF.
export const ENTITY_DOC_PDF = "employee_doc";
export const ENTITY_ACK_SIGNATURE = "employee_doc_sig";     // drawn signature image
export const ENTITY_ACK_SIGNED_PAGE = "employee_doc_page";  // uploaded physically-signed page

// Roles that may create/manage documents, upload, and see the who-signed report.
// GOD-ONLY by decision — admins are treated like teachers (read & sign their own only),
// mirroring leave's APPROVER_ROLES. Single flip point: add "admin" here (and grant admin
// the `documents.manage` perm in the portal role map) to give office admins authoring.
export const MANAGER_ROLES = ["god"] as const;

export const SIGN_MODES = ["digital", "upload", "both"] as const;
export const AUDIENCES = ["all", "teaching", "non_teaching"] as const;
export const DOC_STATUSES = ["draft", "published", "archived"] as const;

// Upload limits.
export const SIGNATURE_MAX_BYTES = 2 * 1024 * 1024;  // drawn signature PNG
export const SIGNATURE_ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp"] as const;
export const SIGNED_PAGE_MAX_BYTES = 10 * 1024 * 1024; // scan/photo of the signed page
export const SIGNED_PAGE_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const DOC_PDF_MAX_BYTES = 15 * 1024 * 1024;
export const DOC_PDF_ALLOWED_MIME = ["application/pdf"] as const;
