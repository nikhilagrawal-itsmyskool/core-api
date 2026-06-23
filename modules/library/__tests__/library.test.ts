import { BASE_URL, headers, RUN, aStudentId, post, get } from "./helpers";

// Integration tests - require the library module (or full gateway) running.
describe("Library module", () => {
  describe("reference data", () => {
    it("serves seeded DDC summaries", async () => {
      const res = await get("/ddc?q=mathematics");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.ddc)).toBe(true);
      expect(data.ddc.some((d: any) => d.code === "510")).toBe(true);
    });

    it("seeds per-school color + age_band lookups on first use", async () => {
      const res = await get("/lookups/color");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.lookups.length).toBeGreaterThan(0);
    });

    it("normalizes an author via the endpoint", async () => {
      const res = await post("/authors/normalize", {
        input: "Dr. A.P.J. Abdul Kalam",
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.firstAuthorSurname).toBe("Kalam");
      expect(data.cutter).toBe("KAL");
    });

    it("returns a default policy", async () => {
      const res = await get("/policy");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.loanPeriodDays).toBeGreaterThan(0);
      expect(data.maxCopiesPerBorrower).toBeGreaterThan(0);
    });
  });

  describe("catalog → rollup across languages", () => {
    let workId: string;
    let englishTitleId: string;
    let hindiTitleId: string;

    it("catalogs an English title with 5 copies and an auto call number", async () => {
      const res = await post("/catalog", {
        work: {
          uniformTitle: `Wings of Fire ${RUN}`,
          authorInput: "Dr. A.P.J. Abdul Kalam",
          ddcNumber: "954",
          subjectType: "History & geography",
          topic: "History of Asia",
          colorCode: "yellow",
        },
        title: {
          titleAsPrinted: "Wings of Fire",
          language: "english",
          edition: "1st ed.",
          yearOfPublication: 1999,
          publisher: "Universities Press",
          isbn: "9788173710148",
          pages: 180,
        },
        copies: [1, 2, 3, 4, 5].map((n) => ({
          accessionNo: `WOF-E-${RUN}-${n}`,
          price: 395,
          acquisitionYear: 2018,
          billNo: "INV-22",
          almirah: "A3",
          shelf: "2",
        })),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.work.uuid).toBeDefined();
      expect(data.title.localCallNo).toBe("KAL-954-E");
      expect(data.copies).toHaveLength(5);
      expect(data.copies[0].qrValue).toBe(`WOF-E-${RUN}-1`);
      workId = data.work.uuid;
      englishTitleId = data.title.uuid;
    });

    it("adds a Hindi edition under the same work and 5 copies", async () => {
      const titleRes = await post(`/works/${workId}/titles`, {
        titleAsPrinted: "Agni Ki Udaan",
        language: "hindi",
        edition: "1st ed.",
        yearOfPublication: 2002,
      });
      expect(titleRes.status).toBe(200);
      const title = await titleRes.json();
      expect(title.localCallNo).toBe("KAL-954-H");
      hindiTitleId = title.uuid;

      const copiesRes = await post(`/titles/${hindiTitleId}/copies`, {
        copies: [1, 2, 3, 4, 5].map((n) => ({
          accessionNo: `WOF-H-${RUN}-${n}`,
          price: 250,
          acquisitionYear: 2022,
        })),
      });
      expect(copiesRes.status).toBe(200);
      const copies = await copiesRes.json();
      expect(copies.copies).toHaveLength(5);
    });

    it("rolls up the work as 5 English + 5 Hindi = 10 copies", async () => {
      const res = await get(`/works/${workId}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.totalCopies).toBe(10);
      expect(data.titles).toHaveLength(2);
      const english = data.titles.find((t: any) => t.language === "english");
      const hindi = data.titles.find((t: any) => t.language === "hindi");
      expect(english.totalCopies).toBe(5);
      expect(hindi.totalCopies).toBe(5);
    });

    it("rejects a duplicate accession number", async () => {
      const res = await post(`/titles/${englishTitleId}/copies`, {
        copies: [{ accessionNo: `WOF-E-${RUN}-1` }],
      });
      expect(res.status).toBe(400);
    });

    it("resolves a scanned accession number to its live location", async () => {
      const res = await get(`/resolve/WOF-E-${RUN}-2`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.almirah).toBe("A3");
      expect(data.shelf).toBe("2");
      expect(data.localCallNo).toBe("KAL-954-E");
    });
  });

  describe("circulation + fines", () => {
    let studentId: string;
    const accession = `CIRC-${RUN}-1`;

    beforeAll(async () => {
      studentId = await aStudentId();
      await post("/catalog", {
        work: {
          uniformTitle: `Panchatantra ${RUN}`,
          authorInput: "Vishnu Sharma",
          ddcNumber: "398",
        },
        title: { titleAsPrinted: "Panchatantra", language: "english" },
        copies: [{ accessionNo: accession, price: 200 }],
      });
    });

    it("issues a copy to a student", async () => {
      const res = await post("/issue", {
        accessionNo: accession,
        borrowerType: "student",
        borrowerId: studentId,
        issueDate: "2026-06-01",
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe("issued");
      expect(data.dueDate).toBeDefined();
    });

    it("rejects issuing an already-issued copy", async () => {
      const res = await post("/issue", {
        accessionNo: accession,
        borrowerType: "student",
        borrowerId: studentId,
      });
      expect(res.status).toBe(400);
    });

    it("rejects an unknown borrower", async () => {
      const res = await post("/issue", {
        accessionNo: `WOF-H-${RUN}-1`,
        borrowerType: "student",
        borrowerId: "nobody000000",
      });
      expect(res.status).toBe(400);
    });

    let fineId: string;
    it("returns the copy past due and raises an overdue fine", async () => {
      const res = await post("/return", {
        accessionNo: accession,
        returnDate: "2026-06-30",
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.circulation.status).toBe("returned");
      expect(data.fine).toBeTruthy();
      expect(data.fine.fineType).toBe("overdue");
      expect(Number(data.fine.amount)).toBeGreaterThan(0);
      fineId = data.fine.uuid;
    });

    it("collects the fine and issues a receipt", async () => {
      const res = await post(`/fines/${fineId}/collect`, {});
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe("paid");
      expect(data.receiptNumber).toMatch(/^LIB-/);
    });
  });

  describe("labels", () => {
    it("returns a label payload encoding the accession number", async () => {
      const create = await post("/catalog", {
        work: { uniformTitle: `Label Book ${RUN}`, authorInput: "Test Author" },
        title: { titleAsPrinted: "Label Book", language: "english" },
        copies: [{ accessionNo: `LBL-${RUN}-1` }],
      });
      const created = await create.json();
      const copyId = created.copies[0].uuid;
      const res = await get(`/copies/${copyId}/label?format=qr`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.value).toBe(`LBL-${RUN}-1`);
    });
  });
});
