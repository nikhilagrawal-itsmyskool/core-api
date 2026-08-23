import { BASE_URL, headers, getContext, closePool, cleanupTestWindow } from "./helpers";

const AY = () => getContext().then((c) => c.academicYearId);

async function post(path: string, body: any) {
  const res = await fetch(`${BASE_URL}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
async function put(path: string, body: any) {
  const res = await fetch(`${BASE_URL}${path}`, { method: "PUT", headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
async function del(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, { method: "DELETE", headers });
  return { status: res.status, body: await res.json() };
}
async function get(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  await getContext();
  await cleanupTestWindow();
});

afterAll(async () => {
  await cleanupTestWindow();
  await closePool();
});

describe("academic-calendar: types", () => {
  it("seeds the default types on first read (incl. theme + remembrance)", async () => {
    const { status, body } = await get("/types");
    expect(status).toBe(200);
    const codes = body.map((t: any) => t.code);
    expect(codes).toEqual(expect.arrayContaining(["festival", "important_day", "theme", "remembrance", "academics"]));
  });

  it("creates a custom type (slugged code) and rejects a duplicate", async () => {
    const created = await post("/types", { code: "test_house_event", name: "Test House Event" });
    expect(created.status).toBe(200);
    expect(created.body.code).toBe("test_house_event");

    const dup = await post("/types", { code: "test_house_event", name: "Test House Event 2" });
    expect(dup.status).toBeGreaterThanOrEqual(400);
  });

  it("deletes a custom type only when it has no entries", async () => {
    const t = await post("/types", { code: "test_temp", name: "Test Temp" });
    const d = await del(`/types/${t.body.uuid}`);
    expect(d.status).toBe(200);
    expect(d.body.deleted).toBe(true);
  });
});

describe("academic-calendar: entries", () => {
  it("adds a theme entry by typeCode and a remembrance entry with detail", async () => {
    const ay = await AY();
    const theme = await post("/entries", {
      entryDate: "2099-01-10", typeCode: "theme", value: "Test thought of the day", academicYearId: ay,
    });
    expect(theme.status).toBe(200);
    expect(theme.body.value).toBe("Test thought of the day");

    const rem = await post("/entries", {
      entryDate: "2099-01-10", typeCode: "remembrance", value: "Test Person Birthday", detail: "Poet, Reformer", academicYearId: ay,
    });
    expect(rem.status).toBe(200);
    expect(rem.body.detail).toBe("Poet, Reformer");
  });

  it("updates and soft-deletes an entry", async () => {
    const ay = await AY();
    const e = await post("/entries", { entryDate: "2099-01-11", typeCode: "festival", value: "Test Fest", academicYearId: ay });
    const u = await put(`/entries/${e.body.uuid}`, { value: "Test Fest Renamed" });
    expect(u.body.value).toBe("Test Fest Renamed");
    const d = await del(`/entries/${e.body.uuid}`);
    expect(d.body.deleted).toBe(true);
  });

  it("rejects an unknown typeCode", async () => {
    const ay = await AY();
    const r = await post("/entries", { entryDate: "2099-01-12", typeCode: "does_not_exist", value: "x", academicYearId: ay });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});

describe("academic-calendar: holidays", () => {
  it("upserts a holiday idempotently and lists it", async () => {
    const ay = await AY();
    const h1 = await post("/holidays", { holidayDate: "2099-01-15", name: "Test Holiday", kind: "full", academicYearId: ay });
    expect(h1.status).toBe(200);
    const h2 = await post("/holidays", { holidayDate: "2099-01-15", name: "Test Holiday Renamed", kind: "restricted", academicYearId: ay });
    expect(h2.body.uuid).toBe(h1.body.uuid); // same row (upsert)
    expect(h2.body.kind).toBe("restricted");

    const list = await get(`/holidays?from=2099-01-01&to=2099-01-31&academicYearId=${ay}`);
    expect(list.body.filter((h: any) => h.holidayDate === "2099-01-15").length).toBe(1);

    const d = await del(`/holidays/${h1.body.uuid}`);
    expect(d.body.deleted).toBe(true);
  });
});

describe("academic-calendar: grid", () => {
  it("builds day rows with weekly-off (Sunday), holidays and entries", async () => {
    const ay = await AY();
    await post("/entries", { entryDate: "2099-01-05", typeCode: "theme", value: "Grid theme", academicYearId: ay });
    await post("/holidays", { holidayDate: "2099-01-05", name: "Grid Holiday", kind: "full", academicYearId: ay });

    const { status, body } = await get(`/calendar?month=2099-01&academicYearId=${ay}`);
    expect(status).toBe(200);
    expect(body.days.length).toBe(31);

    const jan5 = body.days.find((d: any) => d.date === "2099-01-05");
    expect(jan5.holiday.name).toBe("Grid Holiday");
    expect(jan5.entries.some((e: any) => e.typeCode === "theme" && e.value === "Grid theme")).toBe(true);

    // 2099-01-04 is a Sunday -> weekly off.
    const jan4 = body.days.find((d: any) => d.date === "2099-01-04");
    expect(jan4.weekday).toBe("sun");
    expect(jan4.isWeeklyOff).toBe(true);
  });
});
