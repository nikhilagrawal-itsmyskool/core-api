// Pure unit tests for the trickiest library logic - no running server needed.
import { authorService } from "../library-author-service";
import { callnoService } from "../library-callno-service";
import { fineService } from "../library-fine-service";
import { LibraryPolicy } from "../library-interfaces";

describe("author normalization", () => {
  it("strips an honorific and reorders to surname-first", () => {
    const r = authorService.normalize("Dr. A.P.J. Abdul Kalam");
    expect(r.firstAuthorSurname).toBe("Kalam");
    expect(r.authorDisplay).toBe("Kalam A.P.J. Abdul");
    expect(r.cutter).toBe("KAL");
    expect(r.authors).toHaveLength(1);
  });

  it("handles a single-name author", () => {
    const r = authorService.normalize("Premchand");
    expect(r.firstAuthorSurname).toBe("Premchand");
    expect(r.cutter).toBe("PRE");
  });

  it("treats comma as an author separator and inverts each author", () => {
    const r = authorService.normalize("Dr. A.P.J. Abdul Kalam, Meera Nair");
    expect(r.authors).toHaveLength(2);
    expect(r.authorDisplay).toBe("Kalam A.P.J. Abdul, Nair Meera");
    expect(r.firstAuthorSurname).toBe("Kalam");
    expect(r.cutter).toBe("KAL");
  });

  it("splits multiple authors and uses the first for the cutter", () => {
    const r = authorService.normalize("R.K. Narayan; Mulk Raj Anand");
    expect(r.authors).toHaveLength(2);
    expect(r.firstAuthorSurname).toBe("Narayan");
    expect(r.cutter).toBe("NAR");
    expect(r.authorDisplay).toBe("Narayan R.K., Anand Mulk Raj");
  });

  it("strips a trailing suffix", () => {
    const r = authorService.normalize("John Smith Jr");
    expect(r.firstAuthorSurname).toBe("Smith");
    expect(r.cutter).toBe("SMI");
  });

  it("produces a Roman cutter for a Devanagari surname", () => {
    const cutter = authorService.toRomanCutter("प्रेमचंद");
    expect(cutter).toMatch(/^[A-Z]{1,3}$/);
  });
});

describe("local call number generation", () => {
  it("builds CUTTER-DDC-LANG with the trailing language letter", () => {
    expect(callnoService.generate("KAL", "954.04", "english")).toBe(
      "KAL-954.04-E",
    );
    expect(callnoService.generate("KAL", "954", "hindi")).toBe("KAL-954-H");
    expect(callnoService.generate("KAL", "954", "bilingual")).toBe("KAL-954-B");
  });

  it("omits the DDC when absent", () => {
    expect(callnoService.generate("KAL", undefined, "english")).toBe("KAL-E");
  });
});

describe("fine computation", () => {
  const policy: LibraryPolicy = {
    schoolId: "x",
    loanPeriodDays: 14,
    maxCopiesPerBorrower: 3,
    graceDays: 0,
    overdueRatePerDay: 2,
    maxFineCap: 50,
    renewLimit: 2,
    lostChargeMode: "multiplier",
    lostChargeValue: 1.5,
  };

  it("charges per-day overdue up to the cap", () => {
    expect(fineService.computeOverdueAmount(5, policy)).toBe(10);
    expect(fineService.computeOverdueAmount(100, policy)).toBe(50); // capped
  });

  it("honours the grace period", () => {
    expect(
      fineService.computeOverdueAmount(2, { ...policy, graceDays: 3 }),
    ).toBe(0);
  });

  it("computes lost charge by mode", () => {
    expect(fineService.computeLostAmount(policy, 100)).toBe(150);
    expect(
      fineService.computeLostAmount(
        { ...policy, lostChargeMode: "price" },
        100,
      ),
    ).toBe(100);
    expect(
      fineService.computeLostAmount(
        { ...policy, lostChargeMode: "fixed", lostChargeValue: 75 },
        100,
      ),
    ).toBe(75);
  });

  it("generates a LIB-prefixed receipt number", () => {
    expect(fineService.generateReceiptNumber()).toMatch(
      /^LIB-\d{8}-[A-Z0-9]{6}$/,
    );
  });
});
