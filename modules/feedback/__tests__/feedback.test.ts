import { BASE_URL, headers, getContext, closePool, cleanupStudentFeedback } from "./helpers";
import { feedbackService } from "../feedback-service";
import { DB } from "../../../shared/lib/db";

const REVIEWER = { isReviewer: true };
const TEACHER = { isReviewer: false };

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

describe("Feedback ticketing API", () => {
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

  it("record → comment → forward (owner-only) → send back → complete → reopen → cancel", async () => {
    const { schoolId, employeeIds, studentId } = await getContext();
    const recorder = employeeIds[0];
    const teacher = employeeIds[1];
    const other = employeeIds[2] || employeeIds[0];
    const god = "god-user";
    await cleanupStudentFeedback(schoolId, studentId);

    const cats = await feedbackService.listCategories(schoolId);
    const category = cats.find((c) => c.name === "Academic") || cats[0];

    // Record — starts open, owned by the assigned teacher, recorder + assignee watching.
    const rec = await feedbackService.record(schoolId, recorder, {
      studentId,
      categoryId: category.uuid,
      feedbackText: "Parent asked for extra maths support.",
      assignedTo: teacher,
    });
    expect(rec.status).toBe("open");
    expect(rec.assignedTo).toBe(teacher);
    expect(rec.recordedBy).toBe(recorder);
    expect(rec.events.map((e) => e.eventType)).toContain("record");
    const watcherIds = rec.watchers.map((w) => w.employeeId);
    expect(watcherIds).toContain(recorder);
    expect(watcherIds).toContain(teacher);

    // Owner adds a comment (status-neutral).
    const commented = await feedbackService.addComment(schoolId, rec.uuid, teacher, { body: "Looking into it." }, TEACHER);
    expect(commented!.status).toBe("open");
    expect(commented!.events.some((e) => e.eventType === "comment" && /looking into it/i.test(e.body || ""))).toBe(true);

    // A non-owner teacher cannot reassign.
    if (other !== teacher && other !== recorder) {
      await expect(
        feedbackService.assign(schoolId, rec.uuid, other, { toEmployeeId: teacher, comment: "mine now" }, TEACHER),
      ).rejects.toThrow(/current owner/i);
    }

    // Owner reassign requires a comment (teacher surface).
    await expect(
      feedbackService.assign(schoolId, rec.uuid, teacher, { toEmployeeId: other, comment: "  " }, TEACHER),
    ).rejects.toThrow(/comment is required/i);

    // Owner forwards to another teacher, with a comment → owner changes.
    const forwarded = await feedbackService.assign(schoolId, rec.uuid, teacher, { toEmployeeId: other, comment: "This is really an attendance matter." }, TEACHER);
    expect(forwarded!.assignedTo).toBe(other);
    const assignEv = forwarded!.events.find((e) => e.eventType === "assign");
    expect(assignEv!.fromAssignee).toBe(teacher);
    expect(assignEv!.toAssignee).toBe(other);
    // The new owner is now a watcher.
    expect(forwarded!.watchers.map((w) => w.employeeId)).toContain(other);

    // Director (god) sends it back to the original teacher — god may assign WITHOUT a comment.
    const sentBack = await feedbackService.assign(schoolId, rec.uuid, god, { toEmployeeId: teacher }, REVIEWER);
    expect(sentBack!.assignedTo).toBe(teacher);

    // Director completes it.
    const completed = await feedbackService.complete(schoolId, rec.uuid, god, "Resolved, thanks.");
    expect(completed!.status).toBe("completed");
    expect(completed!.closedBy).toBe(god);

    // Cannot reassign a terminal ticket.
    await expect(
      feedbackService.assign(schoolId, rec.uuid, god, { toEmployeeId: other }, REVIEWER),
    ).rejects.toThrow(/open ticket can be reassigned/i);

    // Reopen (optionally reassigning) → back to open.
    const reopened = await feedbackService.reopen(schoolId, rec.uuid, god, { note: "One more check.", toEmployeeId: other });
    expect(reopened!.status).toBe("open");
    expect(reopened!.assignedTo).toBe(other);
    expect(reopened!.closedBy).toBeNull();

    // Cancel a recorded-in-error ticket.
    const cancelled = await feedbackService.cancel(schoolId, rec.uuid, god, "Duplicate.");
    expect(cancelled!.status).toBe("cancelled");

    // Timeline captured the whole flow in order.
    const types = cancelled!.events.map((e) => e.eventType);
    expect(types[0]).toBe("record");
    expect(types).toEqual(expect.arrayContaining(["record", "comment", "assign", "complete", "reopen", "cancel"]));
  });

  it("@mention adds the mentioned person as a watcher", async () => {
    const { schoolId, employeeIds, studentId } = await getContext();
    const recorder = employeeIds[0];
    const teacher = employeeIds[1];
    const mentioned = employeeIds[2] || employeeIds[0];
    await cleanupStudentFeedback(schoolId, studentId);
    const cats = await feedbackService.listCategories(schoolId);

    const rec = await feedbackService.record(schoolId, recorder, {
      studentId, categoryId: cats[0].uuid, feedbackText: "Needs a call.", assignedTo: teacher,
    });
    const withMention = await feedbackService.addComment(
      schoolId, rec.uuid, teacher, { body: "@colleague please advise", mentions: [mentioned] }, TEACHER,
    );
    expect(withMention!.watchers.map((w) => w.employeeId)).toContain(mentioned);
    const ev = withMention!.events.find((e) => e.eventType === "comment" && e.mentions.length > 0);
    expect(ev!.mentions.some((m) => m.id === mentioned)).toBe(true);
  });

  it("summary splits open work into awaiting-director vs out-with-teachers", async () => {
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

    // My "to act" list (teacher surface) shows both open, oldest first.
    const mine = await feedbackService.listForEmployee(schoolId, teacher, "act");
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine.every((m) => m.status === "open")).toBe(true);

    // Complete one.
    await feedbackService.complete(schoolId, a.uuid, "god-user");

    const summary = await feedbackService.summary(schoolId);
    expect(summary.byStatus.completed).toBeGreaterThanOrEqual(1);
    expect(summary.open).toBe(summary.awaitingDirector + summary.outWithTeachers);
    const teacherRow = summary.byTeacher.find((t) => t.employeeId === teacher);
    expect(teacherRow).toBeTruthy();
    expect(teacherRow!.total).toBeGreaterThanOrEqual(2);
  });
});
