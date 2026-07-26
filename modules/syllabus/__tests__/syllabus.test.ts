import { BASE_URL, headers, getSeed, closePool, rnd, ensureStream, Seed } from "./helpers";

const get = (p: string) => fetch(`${BASE_URL}${p}`, { headers });
const post = (p: string, body: any) =>
  fetch(`${BASE_URL}${p}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
const put = (p: string, body: any) =>
  fetch(`${BASE_URL}${p}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
const del = (p: string) =>
  fetch(`${BASE_URL}${p}`, { method: "DELETE", headers });

describe("Syllabus module", () => {
  let seed: Seed;
  let subjectId: string;
  let syllabusId: string;
  const tag = rnd();

  beforeAll(async () => {
    seed = await getSeed();
  });
  afterAll(async () => {
    await closePool();
  });

  describe("Subjects", () => {
    const name = `GK ${tag}`;

    it("creates a subject", async () => {
      const res = await post("/subjects", {
        name,
        description: "General Knowledge",
      });
      expect(res.status).toBe(200);
      const d = await res.json();
      expect(d.uuid).toBeTruthy();
      expect(d.name).toBe(name);
      subjectId = d.uuid;
    });

    it("rejects a duplicate subject name", async () => {
      const res = await post("/subjects", { name });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("lists subjects including the new one", async () => {
      const res = await get("/subjects");
      const d = await res.json();
      expect(Array.isArray(d)).toBe(true);
      expect(d.some((s: any) => s.uuid === subjectId)).toBe(true);
    });
  });

  describe("Grades lookup", () => {
    it("derives grades (with sections) from class names", async () => {
      const res = await get("/grades");
      expect(res.status).toBe(200);
      const d = await res.json();
      expect(Array.isArray(d)).toBe(true);
      const g = d.find(
        (x: any) => x.grade.toLowerCase() === seed.grade.toLowerCase(),
      );
      expect(g).toBeTruthy();
      expect(g.sections.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Plans", () => {
    it("creates a syllabus for the grade + subject", async () => {
      const res = await post("/syllabi", {
        academicYearId: seed.academicYearId,
        grade: seed.grade,
        subjectId,
        layout: "junior",
        note: "Current affairs are also part of the syllabus.",
      });
      expect(res.status).toBe(200);
      const d = await res.json();
      expect(d.uuid).toBeTruthy();
      expect(d.grade).toBe(seed.grade);
      syllabusId = d.uuid;
    });

    it("rejects a duplicate plan (same grade + subject + year)", async () => {
      const res = await post("/syllabi", {
        academicYearId: seed.academicYearId,
        grade: seed.grade,
        subjectId,
        layout: "junior",
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("rejects an invalid layout", async () => {
      const res = await post("/syllabi", {
        academicYearId: seed.academicYearId,
        grade: `Z${rnd()}`,
        subjectId,
        layout: "bogus",
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("rejects an invalid subjectId", async () => {
      const res = await post("/syllabi", {
        academicYearId: seed.academicYearId,
        grade: `Z${rnd()}`,
        subjectId: "nope12345678",
        layout: "junior",
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("Entries", () => {
    it("adds a single entry and defaults its term from the month", async () => {
      const res = await post(`/syllabi/${syllabusId}/entries`, {
        month: "april",
        title: "India is One",
        theme: "Our India",
        topicNo: "T-1",
        pageRef: "177",
      });
      expect(res.status).toBe(200);
      const d = await res.json();
      expect(d.seq).toBe(1);
      expect(d.term).toBe("half_yearly"); // April → half-yearly by default
    });

    it("bulk-appends entries (annual term for later months)", async () => {
      const res = await post(`/syllabi/${syllabusId}/entries/bulk`, {
        mode: "append",
        entries: [
          {
            month: "april",
            title: "Food We Must Eat",
            theme: "Health and Fitness",
          },
          {
            month: "october",
            title: "Take Care of Earth",
            theme: "General Awareness",
          },
        ],
      });
      expect(res.status).toBe(200);
      const d = await res.json();
      expect(d.length).toBe(3);
      const oct = d.find((e: any) => e.month === "october");
      expect(oct.term).toBe("annual");
    });

    it("bulk-replaces the whole entry list, resequenced from 1", async () => {
      const res = await post(`/syllabi/${syllabusId}/entries/bulk`, {
        mode: "replace",
        entries: [
          {
            month: "april",
            title: "Quality Education",
            entryType: "topic",
            theme: "SDGs",
          },
          {
            month: "may",
            title: "Say It Short",
            entryType: "topic",
            theme: "Digital Literacy",
          },
          {
            month: "august",
            title: "Revision & Worksheet-1",
            entryType: "revision",
          },
        ],
      });
      const d = await res.json();
      expect(d.length).toBe(3);
      expect(d.map((e: any) => e.seq)).toEqual([1, 2, 3]);
    });

    it("reorders entries", async () => {
      const list = await (await get(`/syllabi/${syllabusId}`)).json();
      const ids = list.entries.map((e: any) => e.uuid);
      const reversed = [...ids].reverse();
      const res = await put(`/syllabi/${syllabusId}/entries/order`, {
        order: reversed,
      });
      const d = await res.json();
      expect(d.map((e: any) => e.uuid)).toEqual(reversed);
      expect(d.map((e: any) => e.seq)).toEqual([1, 2, 3]);
    });

    it("rejects a blank entry title", async () => {
      const res = await post(`/syllabi/${syllabusId}/entries`, {
        month: "april",
        title: "   ",
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("rejects an invalid month", async () => {
      const res = await post(`/syllabi/${syllabusId}/entries`, {
        month: "smarch",
        title: "X",
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("Progress (per section)", () => {
    let entryId: string;

    beforeAll(async () => {
      const plan = await (await get(`/syllabi/${syllabusId}`)).json();
      entryId = plan.entries.find((e: any) => e.entryType === "topic").uuid;
    });

    it("marks an entry covered for section A", async () => {
      const res = await post("/progress", {
        entryId,
        classId: seed.sectionA.classId,
        status: "covered",
      });
      expect(res.status).toBe(200);
      const d = await res.json();
      expect(d.status).toBe("covered");
      expect(d.coveredDate).toBeTruthy();
    });

    it("roster for section A shows it covered with a count", async () => {
      const res = await get(
        `/syllabi/${syllabusId}/progress?classId=${seed.sectionA.classId}`,
      );
      expect(res.status).toBe(200);
      const d = await res.json();
      const e = d.entries.find((x: any) => x.uuid === entryId);
      expect(e.covered).toBe(true);
      expect(d.counts.covered).toBe(1);
    });

    it("roster for section B shows the same entry still pending (isolation)", async () => {
      const res = await get(
        `/syllabi/${syllabusId}/progress?classId=${seed.sectionB.classId}`,
      );
      const d = await res.json();
      const e = d.entries.find((x: any) => x.uuid === entryId);
      expect(e.covered).toBe(false);
      expect(d.counts.covered).toBe(0);
    });

    it("re-marking covered is idempotent (single row per entry+section)", async () => {
      await post("/progress", {
        entryId,
        classId: seed.sectionA.classId,
        status: "covered",
      });
      const res = await get(
        `/syllabi/${syllabusId}/progress?classId=${seed.sectionA.classId}`,
      );
      const d = await res.json();
      expect(d.entries.filter((x: any) => x.covered).length).toBe(1);
    });

    it("marking pending un-covers the entry", async () => {
      await post("/progress", {
        entryId,
        classId: seed.sectionA.classId,
        status: "pending",
      });
      const res = await get(
        `/syllabi/${syllabusId}/progress?classId=${seed.sectionA.classId}`,
      );
      const d = await res.json();
      const e = d.entries.find((x: any) => x.uuid === entryId);
      expect(e.covered).toBe(false);
    });

    it("rejects marking against an invalid classId", async () => {
      const res = await post("/progress", {
        entryId,
        classId: "nope12345678",
        status: "covered",
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("Streams", () => {
    let streamSubjectId: string;
    let commonPlanId: string;
    let sciPlanId: string;

    beforeAll(async () => {
      await ensureStream("SCI", "Science");
      const res = await post("/subjects", { name: `Physics ${tag}` });
      streamSubjectId = (await res.json()).uuid;
    });

    afterAll(async () => {
      if (sciPlanId) await del(`/syllabi/${sciPlanId}`);
      if (commonPlanId) await del(`/syllabi/${commonPlanId}`);
      if (streamSubjectId) await del(`/subjects/${streamSubjectId}`);
    });

    it("lists the school's streams", async () => {
      const res = await get("/streams");
      expect(res.status).toBe(200);
      const d = await res.json();
      expect(Array.isArray(d)).toBe(true);
      expect(d.some((s: any) => s.code.toLowerCase() === "sci")).toBe(true);
    });

    it("creates a common (no-stream) plan for the grade + subject", async () => {
      const res = await post("/syllabi", {
        academicYearId: seed.academicYearId,
        grade: seed.grade,
        subjectId: streamSubjectId,
        layout: "senior",
      });
      expect(res.status).toBe(200);
      const d = await res.json();
      expect(d.streamCode).toBeNull();
      commonPlanId = d.uuid;
    });

    it("allows a stream plan for the same grade + subject (separate slot)", async () => {
      const res = await post("/syllabi", {
        academicYearId: seed.academicYearId,
        grade: seed.grade,
        streamCode: "SCI",
        subjectId: streamSubjectId,
        layout: "senior",
      });
      expect(res.status).toBe(200);
      const d = await res.json();
      expect(d.streamCode).toBe("SCI");
      sciPlanId = d.uuid;
    });

    it("rejects a duplicate stream plan (same grade + stream + subject)", async () => {
      const res = await post("/syllabi", {
        academicYearId: seed.academicYearId,
        grade: seed.grade,
        streamCode: "SCI",
        subjectId: streamSubjectId,
        layout: "senior",
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("rejects an unknown stream code", async () => {
      const res = await post("/syllabi", {
        academicYearId: seed.academicYearId,
        grade: seed.grade,
        streamCode: "ZZZ",
        subjectId: streamSubjectId,
        layout: "senior",
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("filters the plan list by stream (excludes the common plan)", async () => {
      const res = await get(
        `/syllabi?academicYearId=${seed.academicYearId}&grade=${encodeURIComponent(seed.grade)}&streamCode=SCI`,
      );
      expect(res.status).toBe(200);
      const d = await res.json();
      expect(d.some((p: any) => p.uuid === sciPlanId)).toBe(true);
      expect(d.some((p: any) => p.uuid === commonPlanId)).toBe(false);
    });
  });

  describe("Model papers", () => {
    let mpSubjectId: string;
    let paperId: string;
    let modelDocId: string;
    let answerDocId: string;
    const b64 = Buffer.from('fake-docx-bytes').toString('base64');

    beforeAll(async () => {
      mpSubjectId = (await (await post("/subjects", { name: `Social Studies ${tag}` })).json()).uuid;
    });

    afterAll(async () => {
      if (modelDocId) await del(`/model-papers/docs/${modelDocId}`);
      if (answerDocId) await del(`/model-papers/docs/${answerDocId}`);
      if (mpSubjectId) await del(`/subjects/${mpSubjectId}`);
    });

    it("uploads a model paper (Word) and queues its PDF", async () => {
      const res = await post("/model-papers/upload", {
        academicYearId: seed.academicYearId,
        grade: seed.grade,
        subjectId: mpSubjectId,
        exam: "half_yearly",
        docType: "model_paper",
        fileName: "Model Paper.docx",
        base64Data: b64,
      });
      expect(res.status).toBe(200);
      const d = await res.json();
      paperId = d.uuid;
      expect(d.answerKeyReleased).toBe(false);
      const doc = d.docs.find((x: any) => x.docType === "model_paper");
      expect(doc).toBeTruthy();
      expect(doc.hasDocx).toBe(true);
      expect(doc.pdfStatus).toBe("pending"); // no PDF yet — awaiting conversion
      modelDocId = doc.uuid;
    });

    it("rejects an invalid exam", async () => {
      const res = await post("/model-papers/upload", {
        academicYearId: seed.academicYearId, grade: seed.grade, subjectId: mpSubjectId,
        exam: "bogus", docType: "model_paper", fileName: "x.docx", base64Data: b64,
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("lists the paper for the grade", async () => {
      const res = await get(`/model-papers?academicYearId=${seed.academicYearId}&grade=${encodeURIComponent(seed.grade)}`);
      expect(res.status).toBe(200);
      const d = await res.json();
      expect(d.some((p: any) => p.uuid === paperId)).toBe(true);
    });

    it("downloads the Word source (base64)", async () => {
      const res = await get(`/model-papers/docs/${modelDocId}/file?format=docx`);
      expect(res.status).toBe(200);
      const d = await res.json();
      expect(d.base64Data).toBe(b64);
    });

    it("404s the PDF while it is still pending", async () => {
      const res = await get(`/model-papers/docs/${modelDocId}/file?format=pdf`);
      expect(res.status).toBe(404);
    });

    it("serves a directly-attached PDF as ready", async () => {
      const res = await post("/model-papers/upload", {
        academicYearId: seed.academicYearId, grade: seed.grade, subjectId: mpSubjectId,
        exam: "half_yearly", docType: "answer_key",
        fileName: "Answer Key.docx", base64Data: b64,
        pdfFileName: "Answer Key.pdf", pdfBase64Data: b64,
      });
      const d = await res.json();
      const doc = d.docs.find((x: any) => x.docType === "answer_key");
      expect(doc.pdfStatus).toBe("ready");
      answerDocId = doc.uuid;
      const pdf = await get(`/model-papers/docs/${answerDocId}/file?format=pdf`);
      expect(pdf.status).toBe(200);
    });

    it("toggles answer-key release", async () => {
      const res = await put(`/model-papers/${paperId}/answer-key`, { released: true });
      expect(res.status).toBe(200);
      const d = await res.json();
      expect(d.released).toBe(true);
    });

    it("conversion worker is inert while the PDF part is disabled", async () => {
      const res = await post("/model-papers/process-next", {});
      expect(res.status).toBe(200);
      const d = await res.json();
      expect(d.status).toBe("skipped"); // converter not enabled -> nothing claimed
    });
  });

  describe("Cleanup", () => {
    it("deletes the syllabus and its entries", async () => {
      const res = await del(`/syllabi/${syllabusId}`);
      expect(res.status).toBe(200);
      const check = await get(`/syllabi/${syllabusId}`);
      expect(check.status).toBe(404);
    });

    it("deletes the subject once no plan uses it", async () => {
      const res = await del(`/subjects/${subjectId}`);
      expect(res.status).toBe(200);
    });
  });
});
