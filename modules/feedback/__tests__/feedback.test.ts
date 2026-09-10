import { BASE_URL, headers, getContext, closePool, cleanupStudentFeedback } from "./helpers";
import { feedbackService } from "../feedback-service";
import { DB } from "../../../shared/lib/db";

let tearingDown = false;
process.on("unhandledRejection", (e) => { if (!tearingDown) throw e; });
process.on("uncaughtException", (e) => { if (!tearingDown) throw e; });

afterAll(async () => {
  tearingDown = true;
  await new Promise((r) => setTimeout(r, 250));
  await closePool();
  try { await DB.end(); } catch { /* pool draining */ }
});

async function get(pathname: string) {
  const res = await fetch(`${BASE_URL}${pathname}`, { headers });
  return { status: res.status, json: res.status === 200 ? await res.json() : null };
}

describe("Feedback API", () => {
  it("health + seeds categories over HTTP (school-header surface)", async () => {
    await getContext();
    const health = await get("/health");
    expect(health.status).toBe(200);
    expect(health.json.module).toBe("feedback");

    const cats = await get("/categories");
    expect(cats.status).toBe(200);
    const names = cats.json.map((c: any) => c.name);
    expect(names).toContain("Academic");
    expect(names).toContain("Other");
  });

  it("record → respond (ownership) → complete → reopen → respond → complete", async () => {
    const { schoolId, employeeIds, studentId } = await getContext();
    const recorder = employeeIds[0];
    const teacher = employeeIds[1];
    const other = employeeIds[2] || employeeIds[0];
    await cleanupStudentFeedback(schoolId, studentId);

    const cats = await feedbackService.listCategories(schoolId);
    const category = cats.find((c) => c.name === "Academic") || cats[0];

    // Record + assign — starts assigned.
    const rec = await feedbackService.record(schoolId, recorder, {
      studentId,
      categoryId: category.uuid,
      feedbackText: "Parent asked for extra maths support.",
      assignedTo: teacher,
    });
    expect(rec.status).toBe("assigned");
    expect(rec.assignedTo).toBe(teacher);
    expect(rec.recordedBy).toBe(recorder);
    expect(rec.categoryName).toBe(category.name);

    // A different teacher cannot respond.
    if (other !== teacher) {
      await expect(feedbackService.respond(schoolId, rec.uuid, other, "not mine")).rejects.toThrow(/not assigned to you/i);
    }

    // Empty comment rejected.
    await expect(feedbackService.respond(schoolId, rec.uuid, teacher, "   ")).rejects.toThrow(/comment is required/i);

    // Assigned teacher responds — moves to responded.
    const responded = await feedbackService.respond(schoolId, rec.uuid, teacher, "Will start remedial classes next week.");
    expect(responded!.status).toBe("responded");
    expect(responded!.teacherComment).toMatch(/remedial/i);
    expect(responded!.respondedBy).toBe(teacher);

    // Cannot complete something that isn't responded... it is responded, so complete works.
    const completed = await feedbackService.complete(schoolId, rec.uuid, "god-user", "Good follow-up.");
    expect(completed!.status).toBe("completed");
    expect(completed!.reviewNote).toMatch(/follow-up/i);

    // Reopen sends it back to the teacher.
    const reopened = await feedbackService.reopen(schoolId, rec.uuid, "god-user", "Please add parent's phone confirmation.");
    expect(reopened!.status).toBe("reopened");

    // Teacher can respond again on a reopened item.
    const responded2 = await feedbackService.respond(schoolId, rec.uuid, teacher, "Confirmed with parent on call.");
    expect(responded2!.status).toBe("responded");

    // Final completion.
    const completed2 = await feedbackService.complete(schoolId, rec.uuid, "god-user");
    expect(completed2!.status).toBe("completed");

    // Cannot reopen an assigned/fresh item (guard) — complete already terminal-ish; reopen ok here,
    // but completing a non-responded item must fail: reopen then try complete-before-respond.
    await feedbackService.reopen(schoolId, rec.uuid, "god-user");
    await expect(feedbackService.complete(schoolId, rec.uuid, "god-user")).rejects.toThrow(/responded feedback can be completed/i);

    // Audit trail records every transition.
    const audit = await feedbackService.getAudit(schoolId, rec.uuid);
    const actions = audit.map((a) => a.action);
    expect(actions).toContain("record");
    expect(actions).toContain("respond");
    expect(actions).toContain("complete");
    expect(actions).toContain("reopen");
  });

  it("summary + open filter reflect state", async () => {
    const { schoolId, employeeIds, studentId } = await getContext();
    const teacher = employeeIds[1];
    await cleanupStudentFeedback(schoolId, studentId);
    const cats = await feedbackService.listCategories(schoolId);

    const a = await feedbackService.record(schoolId, employeeIds[0], {
      studentId, categoryId: cats[0].uuid, feedbackText: "Item A", assignedTo: teacher,
    });
    await feedbackService.record(schoolId, employeeIds[0], {
      studentId, categoryId: cats[0].uuid, feedbackText: "Item B", assignedTo: teacher,
    });

    const openBefore = await feedbackService.listFeedback(schoolId, { assignedTo: teacher, status: "open" });
    expect(openBefore.length).toBeGreaterThanOrEqual(2);

    // Complete one (respond then complete).
    await feedbackService.respond(schoolId, a.uuid, teacher, "done");
    await feedbackService.complete(schoolId, a.uuid, "god-user");

    const summary = await feedbackService.summary(schoolId);
    expect(summary.byStatus.completed).toBeGreaterThanOrEqual(1);
    const teacherRow = summary.byTeacher.find((t) => t.employeeId === teacher);
    expect(teacherRow).toBeTruthy();
    expect(teacherRow!.total).toBeGreaterThanOrEqual(2);
  });
});
