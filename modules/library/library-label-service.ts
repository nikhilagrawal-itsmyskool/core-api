import { copyService } from "./library-copy-service";

// Labels encode identity (the accession number), never location - so re-shelving
// a book never requires reprinting. A scan resolves the live location via
// resolve(). Image generation (qrcode / bwip-js) is lazy-loaded so the module
// still works if those optional deps are unavailable; the encodable value and
// resolve endpoint always work.
class LabelService {
  public async generate(
    accessionNo: string,
    format: "qr" | "barcode",
  ): Promise<{
    value: string;
    format: string;
    mimeType: string;
    dataUrl: string | null;
  }> {
    const value = accessionNo;
    let dataUrl: string | null = null;
    try {
      if (format === "barcode") {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const bwipjs = require("bwip-js");
        const png: Buffer = await bwipjs.toBuffer({
          bcid: "code128",
          text: value,
          scale: 3,
          height: 10,
          includetext: true,
          textxalign: "center",
        });
        dataUrl = `data:image/png;base64,${png.toString("base64")}`;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const QRCode = require("qrcode");
        dataUrl = await QRCode.toDataURL(value, { margin: 1, width: 256 });
      }
    } catch {
      dataUrl = null; // optional dependency not available; caller still gets the value
    }
    return { value, format, mimeType: "image/png", dataUrl };
  }

  // Resolve a scanned accession number to its current location + bibliographic
  // summary for a mobile "where is this book" lookup.
  public async resolve(
    accessionNo: string,
    schoolId: string,
  ): Promise<any | null> {
    const copy = await copyService.getByAccession(accessionNo, schoolId);
    if (!copy) return null;
    return {
      accessionNo: copy.accessionNo,
      title: copy.titleAsPrinted,
      author: copy.authorDisplay,
      localCallNo: copy.localCallNo,
      language: copy.language,
      almirah: copy.almirah,
      shelf: copy.shelf,
      status: copy.status,
    };
  }
}

export const labelService = new LabelService();
