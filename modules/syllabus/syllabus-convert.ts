// docx -> pdf conversion for model papers, using the LibreOffice Lambda layer
// provisioned in iac (live/prod/lambda-layer-libreoffice). The layer ships
// /opt/lo.tar.br (brotli-compressed tar); on cold start we stream-extract it to
// /tmp (soffice.bin lands at /tmp/instdir/program/) and then shell out to it.
// Dependency-free — no @shelf lib — so we control the paths and flags exactly.
//
// Gated by isConversionAvailable() (env SYLLABUS_CONVERT_ENABLED): the queue
// worker only calls convertDocxToPdf when enabled, so a disabled/mis-provisioned
// converter never marks documents failed. selfTest() bypasses the flag so the
// runtime (AL2 binary on AL2023) can be verified before flipping it on.

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as zlib from "zlib";
import { pipeline } from "stream/promises";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");
// In-process tar extractor — the AL2023 (nodejs22.x) runtime has no `tar` binary.
const tar = require("tar");

const LAYER_TAR = "/opt/lo.tar.br";
const SOFFICE = "/tmp/instdir/program/soffice.bin";
const SOFFICE_ARGS = [
  "--headless", "--norestore", "--invisible", "--nodefault",
  "--nolockcheck", "--nologo", "--nofirststartwizard",
];

export function isConversionAvailable(): boolean {
  return process.env.SYLLABUS_CONVERT_ENABLED === "true";
}

let extractPromise: Promise<void> | null = null;

// Extract the LibreOffice layer to /tmp once per warm container (idempotent).
async function ensureLibreOffice(): Promise<void> {
  if (fs.existsSync(SOFFICE)) return;
  if (!extractPromise) {
    extractPromise = (async () => {
      if (!fs.existsSync(LAYER_TAR)) {
        throw new Error(`LibreOffice layer not found at ${LAYER_TAR} — is the layer attached?`);
      }
      // Stream /opt/lo.tar.br -> brotli-decompress -> untar into /tmp, all in-process.
      // node-tar preserves file modes, so soffice.bin stays executable. We can't shell
      // out to `tar` because the AL2023 runtime doesn't ship it (spawnSync tar ENOENT).
      await pipeline(
        fs.createReadStream(LAYER_TAR),
        zlib.createBrotliDecompress(),
        tar.x({ cwd: "/tmp" }),
      );
      if (!fs.existsSync(SOFFICE)) {
        throw new Error("extracted layer but soffice.bin is missing");
      }
    })().catch((e) => { extractPromise = null; throw e; });
  }
  return extractPromise;
}

function runSoffice(inputPath: string, outDir: string): void {
  execFileSync(SOFFICE, [...SOFFICE_ARGS, "--convert-to", "pdf", "--outdir", outDir, inputPath], {
    env: { ...process.env, HOME: "/tmp" },
    stdio: "pipe",
    timeout: 90000,
  });
}

// Convert a .docx (base64) to a PDF (base64).
export async function convertDocxToPdf(docxBase64: string, fileName: string): Promise<string> {
  await ensureLibreOffice();
  const id = generateShortUuid(12);
  const inDir = "/tmp/in";
  const outDir = "/tmp/out";
  fs.mkdirSync(inDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const base = ((fileName || "doc").replace(/\.docx?$/i, "").replace(/[^\w.\-]+/g, "_") || "doc");
  const stem = `${id}-${base}`;
  const inPath = `${inDir}/${stem}.docx`;
  const outPath = `${outDir}/${stem}.pdf`;
  fs.writeFileSync(inPath, Buffer.from(docxBase64, "base64"));
  try {
    runSoffice(inPath, outDir);
    if (!fs.existsSync(outPath)) throw new Error("conversion produced no PDF");
    return fs.readFileSync(outPath).toString("base64");
  } finally {
    try { fs.rmSync(inPath, { force: true }); } catch { /* noop */ }
    try { fs.rmSync(outPath, { force: true }); } catch { /* noop */ }
  }
}

// Runtime compatibility check: extract the layer and convert a trivial file.
// Bypasses the feature flag so it can be run before enabling conversion.
export async function selfTest(): Promise<{ ok: boolean; ms: number; soffice: string; error?: string }> {
  const started = Date.now();
  try {
    await ensureLibreOffice();
    const inPath = "/tmp/selftest.txt";
    const outPath = "/tmp/selftest.pdf";
    try { fs.rmSync(outPath, { force: true }); } catch { /* noop */ }
    fs.writeFileSync(inPath, "LibreOffice self-test on this runtime.");
    runSoffice(inPath, "/tmp");
    const ok = fs.existsSync(outPath);
    return { ok, ms: Date.now() - started, soffice: SOFFICE, error: ok ? undefined : "no PDF produced" };
  } catch (e: any) {
    const stderr = e?.stderr ? Buffer.from(e.stderr).toString().slice(0, 800) : "";
    return { ok: false, ms: Date.now() - started, soffice: SOFFICE, error: `${String(e?.message || e).slice(0, 400)}${stderr ? ` | ${stderr}` : ""}` };
  }
}
