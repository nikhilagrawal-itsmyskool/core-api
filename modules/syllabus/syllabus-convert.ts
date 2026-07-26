// docx -> pdf conversion for model papers.
//
// DEFERRED ("the PDF part"): the actual rendering runs LibreOffice, which ships
// as a Lambda LAYER provisioned in the iac repo
// (live/prod/lambda-layer-libreoffice). Until that layer is attached to the
// drain-conversions function and enabled here, conversion is reported as
// unavailable and the worker leaves docs 'pending' (never marks them failed).
//
// TO ENABLE (later):
//   1. iac: drop the LibreOffice layer zip into
//      live/prod/lambda-layer-libreoffice/, `terragrunt apply`, note layer_arn.
//   2. core-api: add `@shelf/aws-lambda-libreoffice` to package.json, attach the
//      layer to the drain-conversions function (serverless), set
//      SYLLABUS_CONVERT_ENABLED=true in configs/<stage>.yml.
//   3. Implement convertDocxToPdf() below with the layer's LibreOffice, e.g.:
//        const { convertTo } = require('@shelf/aws-lambda-libreoffice');
//        write buffer to /tmp/in.docx; const out = await convertTo('in.docx','pdf');
//        read /tmp/<out> and return base64.

// Feature flag: only true once the LibreOffice runtime is wired up (see above).
export function isConversionAvailable(): boolean {
  return process.env.SYLLABUS_CONVERT_ENABLED === "true";
}

// Convert a .docx (base64) to a PDF (base64). Throws until the PDF part is
// enabled — callers must gate on isConversionAvailable() first so a disabled
// converter never marks documents failed.
export async function convertDocxToPdf(
  _docxBase64: string,
  _fileName: string,
): Promise<string> {
  throw new Error(
    "docx->pdf conversion is not enabled yet (LibreOffice layer pending). See syllabus-convert.ts.",
  );
}
