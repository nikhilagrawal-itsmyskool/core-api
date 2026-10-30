// docx -> pdf conversion for model papers. The implementation now lives in the
// shared converter (shared/lib/docx-to-pdf.ts) so syllabus and homework share one
// LibreOffice integration. This file keeps the syllabus-specific feature gate and
// re-exports the shared entry points, so existing imports are unchanged.
//
// Gated by isConversionAvailable() (env SYLLABUS_CONVERT_ENABLED): the queue worker
// only calls convertDocxToPdf when enabled, so a disabled/mis-provisioned converter
// never marks documents failed. selfTest() bypasses the flag so the runtime (AL2
// binary on AL2023) can be verified before flipping it on.

export { convertDocxToPdf, selfTest } from "../../shared/lib/docx-to-pdf";

export function isConversionAvailable(): boolean {
  return process.env.SYLLABUS_CONVERT_ENABLED === "true";
}
