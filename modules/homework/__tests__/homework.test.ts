import { BASE_URL, headers, getContext, histDate, closePool, TINY_PNG_BASE64 } from "./helpers";
import { homeworkService } from "../homework-service";
import { DB } from "../../../shared/lib/db";

// A late-resolving pooled query can fire as Jest tears down the shared DB pool
// (the service uses shared/lib/db). Swallow that teardown-only race so it can't
// crash the runner after the assertions have already passed.
let tearingDown = false;
process.on("unhandledRejection", (e) => {
  if (!tearingDown) throw e;
});
process.on("uncaughtException", (e) => {
  if (!tearingDown) throw e;
});

afterAll(async () => {
  tearingDown = true;
  await new Promise((r) => setTimeout(r, 250));
  await closePool();
  try {
    await DB.end();
  } catch {
    /* pool already draining */
  }
});

async function post(pathname: string, body?: any) {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: res.status === 200 ? await res.json() : null, text: res.status !== 200 ? await res.text() : "" };
}
async function put(pathname: string, body: any) {
  const res = await fetch(`${BASE_URL}${pathname}`, { method: "PUT", headers, body: JSON.stringify(body) });
  return { status: res.status, json: res.status === 200 ? await res.json() : null };
}
async function del(pathname: string) {
  const res = await fetch(`${BASE_URL}${pathname}`, { method: "DELETE", headers });
  return { status: res.status, json: res.status === 200 ? await res.json() : null };
}
async function get(pathname: string) {
  const res = await fetch(`${BASE_URL}${pathname}`, { headers });
  return { status: res.status, json: res.status === 200 ? await res.json() : null };
}

function addItemBody(classId: string, date: string, academicYearId: string, subjectLabel?: string, note?: string) {
  return {
    classId,
    date,
    academicYearId,
    subjectLabel,
    note,
    image: { fileName: "hw.png", mimeType: "image/png", base64Data: TINY_PNG_BASE64 },
  };
}

describe("Homework API", () => {
  it("draft → add photos → publish → student sees → unpublish → hidden (with back-dating + audit)", async () => {
    const { schoolId, classId, studentId, academicYearId } = await getContext();
    const date = histDate();

    // ensure a draft day (idempotent)
    const d1 = await post("/day", { classId, date, academicYearId });
    expect(d1.status).toBe(200);
    expect(d1.json.day.status).toBe("draft");
    expect(d1.json.day.items.length).toBe(0);
    const dayId = d1.json.day.uuid;

    // idempotent — same day back
    const d2 = await post("/day", { classId, date, academicYearId });
    expect(d2.json.day.uuid).toBe(dayId);

    // add two photos
    const a1 = await post("/items", addItemBody(classId, date, academicYearId, "Maths", "Ex 4.2 Q1-10"));
    expect(a1.status).toBe(200);
    expect(a1.json.day.items.length).toBe(1);
    expect(a1.json.day.items[0].subjectLabel).toBe("Maths");
    expect(a1.json.day.items[0].fileId).toBeTruthy();
    const firstItemId = a1.json.day.items[0].uuid;

    const a2 = await post("/items", addItemBody(classId, date, academicYearId, "English"));
    expect(a2.json.day.items.length).toBe(2);

    // student cannot see a draft
    const beforePub = await homeworkService.studentToday(schoolId, studentId, date, academicYearId);
    expect(beforePub.published).toBe(false);
    expect(beforePub.items.length).toBe(0);

    // the raw image is fetchable (base64 fallback)
    const img = await get(`/items/${firstItemId}/image`);
    expect(img.status).toBe(200);
    expect(img.json.dataUri).toContain("data:image/png;base64,");

    // publish
    const pub = await post(`/day/${dayId}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.json.day.status).toBe("published");

    // student now sees both photos
    const afterPub = await homeworkService.studentToday(schoolId, studentId, date, academicYearId);
    expect(afterPub.published).toBe(true);
    expect(afterPub.items.length).toBe(2);
    expect(afterPub.className).toBeTruthy();

    // edit / remove blocked while published
    const blockedEdit = await put(`/items/${firstItemId}`, { subjectLabel: "Nope" });
    expect(blockedEdit.status).toBe(400);
    const blockedRemove = await del(`/items/${firstItemId}`);
    expect(blockedRemove.status).toBe(400);

    // unpublish → draft, hidden again
    const unpub = await post(`/day/${dayId}/unpublish`);
    expect(unpub.status).toBe(200);
    expect(unpub.json.day.status).toBe("draft");
    const afterUnpub = await homeworkService.studentToday(schoolId, studentId, date, academicYearId);
    expect(afterUnpub.published).toBe(false);

    // edit / remove allowed while draft
    const okEdit = await put(`/items/${firstItemId}`, { subjectLabel: "Mathematics", note: "updated" });
    expect(okEdit.status).toBe(200);
    expect(okEdit.json.day.items.find((i: any) => i.uuid === firstItemId).subjectLabel).toBe("Mathematics");

    const okRemove = await del(`/items/${firstItemId}`);
    expect(okRemove.status).toBe(200);
    expect(okRemove.json.day.items.find((i: any) => i.uuid === firstItemId)).toBeUndefined();
    expect(okRemove.json.day.items.length).toBe(1);

    // audit trail has every action
    const audit = await get(`/audit?classId=${classId}&date=${date}`);
    expect(audit.status).toBe(200);
    const actions = audit.json.map((r: any) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["upload", "publish", "unpublish", "edit", "remove"]));
  });

  it("publish requires at least one photo", async () => {
    const { classId } = await getContext();
    const date = histDate();
    const d = await post("/day", { classId, date });
    const empty = await post(`/day/${d.json.day.uuid}/publish`);
    expect(empty.status).toBe(400);
  });

  it("admin override maps a class to a chosen class-teacher (resolution + my-classes)", async () => {
    const { schoolId, classId, className, academicYearId, employeeId } = await getContext();

    const set = await put(`/class-teachers/${classId}?`, { teacherId: employeeId, academicYearId });
    expect(set.status).toBe(200);
    const row = set.json.find((r: any) => r.classId === classId);
    expect(row.teacherId).toBe(employeeId);
    expect(row.source).toBe("override");
    expect(row.className).toBe(className);

    // service resolution + teacher's my-classes reflect the override
    expect(await homeworkService.resolveClassTeacher(schoolId, classId, academicYearId)).toBe(employeeId);
    expect(await homeworkService.canPostForClass(schoolId, employeeId, classId, academicYearId)).toBe(true);
    expect(await homeworkService.canPostForClass(schoolId, "zzzzzzzzzzzz", classId, academicYearId)).toBe(false);
    const mine = await homeworkService.myHomeworkClasses(schoolId, employeeId, academicYearId);
    expect(mine.map((c) => c.classId)).toContain(classId);

    // clear the override
    const cleared = await del(`/class-teachers/${classId}?academicYearId=${academicYearId}`);
    expect(cleared.status).toBe(200);
    const clearedRow = cleared.json.find((r: any) => r.classId === classId);
    expect(clearedRow.source).not.toBe("override");
  });

  it("rejects an unsupported image type", async () => {
    const { classId } = await getContext();
    const date = histDate();
    const bad = await post("/items", {
      classId,
      date,
      image: { fileName: "x.gif", mimeType: "image/gif", base64Data: TINY_PNG_BASE64 },
    });
    expect(bad.status).toBe(400);
  });
});
