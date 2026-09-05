import { BASE_URL, headers, getContext, closePool, cleanupMonth, cleanupNotifications, cleanupAttendance, cleanupDeductions } from "./helpers";
import { leaveService } from "../leave-service";
import { leaveAttendanceService } from "../leave-attendance-service";
import { leaveDeductionService } from "../leave-deduction-service";
import { importBiometric } from "../leave-attendance-import";
import { notificationService } from "../../communication/notification-service";
import { DB } from "../../../shared/lib/db";
import * as ExcelJS from "exceljs";

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

// Fixed historical month so runs are repeatable (cleaned at start).
const MONTH = "2016-03";
const FIRST = "2016-03-01";
const LAST = "2016-03-31";

describe("Leave API", () => {
  it("seeds types + config over HTTP (school-header surface)", async () => {
    await getContext();
    const health = await get("/health");
    expect(health.status).toBe(200);
    expect(health.json.module).toBe("leave");

    const types = await get("/types");
    expect(types.status).toBe(200);
    const codes = types.json.map((t: any) => t.code);
    expect(codes).toContain("CL");
    expect(codes).toContain("ML");

    const cfg = await get("/config");
    expect(cfg.status).toBe(200);
    expect(cfg.json.clPerMonth).toBe(1);
    expect(cfg.json.dailyCap).toBe(2);
  });

  it("apply → monthly CL quota → approve → reject → cancel → balance", async () => {
    const { schoolId, employeeIds } = await getContext();
    const emp = employeeIds[0];
    await cleanupMonth(schoolId, employeeIds, FIRST, LAST);

    // Apply one CL — pending.
    const cl = await leaveService.apply(schoolId, emp, {
      leaveTypeCode: "CL", fromDate: "2016-03-10", toDate: "2016-03-10", reason: "personal",
    });
    expect(cl.status).toBe("pending");
    expect(cl.leaveTypeCode).toBe("CL");
    expect(cl.workingDays).toBeGreaterThanOrEqual(1);

    // Second CL in the same month is blocked by the monthly quota.
    await expect(
      leaveService.apply(schoolId, emp, { leaveTypeCode: "CL", fromDate: "2016-03-20", toDate: "2016-03-20" }),
    ).rejects.toThrow(/allowed in 2016-03/i);

    // ML (does not count against the CL quota) is allowed.
    const ml = await leaveService.apply(schoolId, emp, {
      leaveTypeCode: "ML", fromDate: "2016-03-21", toDate: "2016-03-22", reason: "fever",
      attachment: { fileName: "cert.pdf", mimeType: "application/pdf", base64Data: Buffer.from("dummy-cert").toString("base64") },
    });
    expect(ml.status).toBe("pending");
    expect(ml.hasAttachment).toBe(true);

    // ML requires an attachment.
    await expect(
      leaveService.apply(schoolId, emp, { leaveTypeCode: "ML", fromDate: "2016-03-25", toDate: "2016-03-25" }),
    ).rejects.toThrow(/requires a document/i);

    // Approve the CL.
    const approved = await leaveService.approve(schoolId, cl.uuid, emp);
    expect(approved!.status).toBe("approved");
    expect(approved!.decidedBy).toBe(emp);

    // Cannot approve twice.
    await expect(leaveService.approve(schoolId, cl.uuid, emp)).rejects.toThrow(/cannot approve/i);

    // Reject the ML.
    const rejected = await leaveService.reject(schoolId, ml.uuid, "no certificate on file", emp);
    expect(rejected!.status).toBe("rejected");
    expect(rejected!.decisionNote).toContain("no certificate");

    // Balance: 1 CL used (approved), quota 1 → 0 remaining. ML doesn't count.
    const bal = await leaveService.balance(schoolId, emp, MONTH);
    expect(bal.clUsed).toBe(1);
    expect(bal.clRemaining).toBe(0);
    expect(bal.approved).toBe(1);
    expect(bal.rejected).toBe(1);

    // Audit trail records apply + approve for the CL.
    const audit = await leaveService.getAudit(schoolId, cl.uuid);
    const actions = audit.map((a) => a.action);
    expect(actions).toContain("apply");
    expect(actions).toContain("approve");
  });

  it("enforces the per-day approval cap for CL", async () => {
    const { schoolId, employeeIds } = await getContext();
    if (employeeIds.length < 3) return; // needs 3 distinct employees; sample-school dependent
    const [e0, e1, e2] = employeeIds;
    const DATE = "2016-03-15";
    await cleanupMonth(schoolId, [e0, e1, e2], FIRST, LAST);

    const a0 = await leaveService.apply(schoolId, e0, { leaveTypeCode: "CL", fromDate: DATE, toDate: DATE });
    const a1 = await leaveService.apply(schoolId, e1, { leaveTypeCode: "CL", fromDate: DATE, toDate: DATE });
    const a2 = await leaveService.apply(schoolId, e2, { leaveTypeCode: "CL", fromDate: DATE, toDate: DATE });

    expect((await leaveService.approve(schoolId, a0.uuid, e0))!.status).toBe("approved");
    expect((await leaveService.approve(schoolId, a1.uuid, e1))!.status).toBe("approved");
    // Third approval on the same day exceeds dailyCap (2) → blocked.
    await expect(leaveService.approve(schoolId, a2.uuid, e2)).rejects.toThrow(/daily cap/i);
  });

  it("applicant can cancel a pending / not-yet-started leave", async () => {
    const { schoolId, employeeIds } = await getContext();
    const emp = employeeIds[0];
    await cleanupMonth(schoolId, [emp], FIRST, LAST);
    const app = await leaveService.apply(schoolId, emp, { leaveTypeCode: "EMERG", fromDate: "2016-03-28", toDate: "2016-03-28", reason: "family" });
    const cancelled = await leaveService.cancel(schoolId, app.uuid, emp, "2016-03-01");
    expect(cancelled!.status).toBe("cancelled");
    // A different employee cannot cancel it.
    await expect(leaveService.cancel(schoolId, app.uuid, "someoneelse", "2016-03-01")).rejects.toThrow(/your own/i);
  });

  it("reconciles attendance + leave + holidays into a per-day month view", async () => {
    const { schoolId, employeeIds } = await getContext();
    const emp = employeeIds[0];
    await cleanupMonth(schoolId, [emp], FIRST, LAST);
    await cleanupAttendance(schoolId, [emp], FIRST, LAST);

    // Approved CL on the 10th (paid), present on the 1st, absent (no leave) on the 2nd.
    const cl = await leaveService.apply(schoolId, emp, { leaveTypeCode: "CL", fromDate: "2016-03-10", toDate: "2016-03-10" });
    await leaveService.approve(schoolId, cl.uuid, emp);
    await leaveAttendanceService.mark(schoolId, emp, "2016-03-01", "present", { firstIn: "2016-03-01T08:05:00", lastOut: "2016-03-01T14:30:00" });
    await leaveAttendanceService.mark(schoolId, emp, "2016-03-02", "absent");

    const rec = await leaveAttendanceService.employeeMonth(schoolId, emp, MONTH, "2016-04-01");
    const byDate = new Map(rec.days.map((d) => [d.date, d]));
    expect(byDate.get("2016-03-01")!.status).toBe("present");
    expect(byDate.get("2016-03-01")!.firstIn).toBeTruthy();
    expect(byDate.get("2016-03-02")!.status).toBe("unauthorized");
    expect(byDate.get("2016-03-10")!.status).toBe("leave_paid");
    expect(byDate.get("2016-03-06")!.status).toBe("off"); // Sunday
    expect(rec.counts.present).toBeGreaterThanOrEqual(1);
    expect(rec.counts.unauthorized).toBeGreaterThanOrEqual(1);
    expect(rec.counts.paidLeave).toBeGreaterThanOrEqual(1);

    // Day view: the 10th shows the employee on (approved) leave.
    const dv = await leaveAttendanceService.dayView(schoolId, "2016-03-10");
    expect(dv.onLeave.find((r) => r.employeeId === emp && r.status === "approved")).toBeTruthy();
  });

  it("deduction ladder: 2 counted absences → plain 2 / ladder 3, finalize applies ladder", async () => {
    const { schoolId, employeeIds } = await getContext();
    const emp = employeeIds[0];
    await cleanupMonth(schoolId, [emp], FIRST, LAST);
    await cleanupAttendance(schoolId, [emp], FIRST, LAST);
    await cleanupDeductions(schoolId, [emp], 2016, 3);

    // Two unauthorized absences (working days, no leave).
    await leaveAttendanceService.mark(schoolId, emp, "2016-03-02", "absent");
    await leaveAttendanceService.mark(schoolId, emp, "2016-03-03", "absent");

    const provisional = await leaveDeductionService.employeeSummary(schoolId, emp, MONTH);
    expect(provisional.countedAbsences).toBe(2);
    expect(provisional.plainLwpDays).toBe(2);
    expect(provisional.ladderDeductionDays).toBe(3); // 1 + 2
    expect(provisional.status).toBe("provisional");

    const runRes = await leaveDeductionService.run(schoolId, MONTH, "tester");
    expect(runRes.drafted).toBeGreaterThanOrEqual(1);
    const runs = await leaveDeductionService.listRuns(schoolId, MONTH);
    const mine = runs.find((r: any) => r.employeeId === emp);
    expect(mine).toBeTruthy();
    expect(mine.appliedDeductionDays).toBe(2); // draft defaults to plain LWP

    await leaveDeductionService.finalize(schoolId, mine.uuid, true, "tester");
    const finalSummary = await leaveDeductionService.employeeSummary(schoolId, emp, MONTH);
    expect(finalSummary.status).toBe("final");
    expect(finalSummary.appliedDeductionDays).toBe(3); // ladder applied on finalize
  });

  it("column-mapping biometric import marks punched days present", async () => {
    const { schoolId, employeeIds } = await getContext();
    const emp = employeeIds[0];
    await cleanupAttendance(schoolId, [emp], FIRST, LAST);
    await leaveAttendanceService.mapEnroll(schoolId, "EMP-TEST-1", emp, "tester");

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Log");
    ws.addRow(["Code", "Date", "In", "Out"]);
    ws.addRow(["EMP-TEST-1", "2016-03-08", "08:10", "14:20"]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const result = await importBiometric(schoolId, buffer, {
      fileName: "test.xlsx",
      mapping: { codeHeader: "Code", dateHeader: "Date", inHeader: "In", outHeader: "Out" },
      coverageFrom: "2016-03-08", coverageTo: "2016-03-08",
      inferAbsent: false,
    });
    expect(result.matchedRows).toBe(1);
    expect(result.unmatchedCodes.length).toBe(0);

    const rec = await leaveAttendanceService.employeeMonth(schoolId, emp, MONTH, "2016-04-01");
    const d = rec.days.find((x) => x.date === "2016-03-08");
    expect(d!.status).toBe("present");
    expect(d!.firstIn).toBeTruthy();
  });

  it("in-app notification inbox: create → list → unread → mark read", async () => {
    const { schoolId, employeeIds } = await getContext();
    const emp = employeeIds[0];
    await cleanupNotifications(schoolId, emp);

    const res = await notificationService.create({
      schoolId, recipientType: "employee", recipientIds: [emp],
      key: "test_leave", title: "Leave approved", body: "Your CL was approved", entityType: "leave", entityId: "abc123",
    });
    expect(res.created).toBe(1);

    const inbox = await notificationService.list(schoolId, "employee", emp, {});
    expect(inbox.unreadCount).toBeGreaterThanOrEqual(1);
    const mine = inbox.items.find((n) => n.key === "test_leave");
    expect(mine).toBeTruthy();
    expect(mine!.title).toBe("Leave approved");

    await notificationService.markRead(schoolId, "employee", emp, mine!.uuid);
    const after = await notificationService.list(schoolId, "employee", emp, { unreadOnly: true });
    expect(after.items.find((n) => n.uuid === mine!.uuid)).toBeFalsy();
  });
});
