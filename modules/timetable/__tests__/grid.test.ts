import { BASE_URL, headers, TEST_ACADEMIC_YEAR_ID, closePool } from "./helpers";

afterAll(async () => {
  await closePool();
});

describe("Timetable API — grid (config / days / slots)", () => {
  let configId: string;

  it("creates a config", async () => {
    const res = await fetch(`${BASE_URL}/configs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        academicYearId: TEST_ACADEMIC_YEAR_ID,
        name: "Default Grid",
      }),
    });
    expect(res.status).toBe(200);
    const config = await res.json();
    expect(config.status).toBe("active");
    configId = config.uuid;
  });

  it("adds a Saturday with teaching + activity slots and nests them under the config", async () => {
    // Saturday = day 6
    let res = await fetch(`${BASE_URL}/configs/${configId}/days`, {
      method: "POST",
      headers,
      body: JSON.stringify({ dayOfWeek: 6, label: "Saturday" }),
    });
    expect(res.status).toBe(200);
    const day = await res.json();

    res = await fetch(`${BASE_URL}/days/${day.uuid}/slots`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sequence: 1, slotType: "teaching", label: "P1" }),
    });
    expect(res.status).toBe(200);

    // last two periods are the teacher-less Saturday activity
    res = await fetch(`${BASE_URL}/days/${day.uuid}/slots`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sequence: 2,
        slotType: "activity",
        label: "Saturday Activity",
      }),
    });
    expect(res.status).toBe(200);
    const activitySlot = await res.json();
    expect(activitySlot.slotType).toBe("activity");

    // nested fetch
    res = await fetch(`${BASE_URL}/configs/${configId}`, { headers });
    const full = await res.json();
    const sat = full.days.find((d: any) => d.dayOfWeek === 6);
    expect(sat).toBeDefined();
    expect(sat.slots.length).toBe(2);
    expect(sat.slots.map((s: any) => s.slotType)).toEqual(
      expect.arrayContaining(["teaching", "activity"]),
    );
  });

  it("rejects an invalid slot type and duplicate sequence", async () => {
    let res = await fetch(`${BASE_URL}/configs/${configId}/days`, {
      method: "POST",
      headers,
      body: JSON.stringify({ dayOfWeek: 1, label: "Monday" }),
    });
    const day = await res.json();
    res = await fetch(`${BASE_URL}/days/${day.uuid}/slots`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sequence: 1, slotType: "nonsense" }),
    });
    expect(res.status).toBe(400);
    res = await fetch(`${BASE_URL}/days/${day.uuid}/slots`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sequence: 1, slotType: "teaching" }),
    });
    expect(res.status).toBe(200);
    res = await fetch(`${BASE_URL}/days/${day.uuid}/slots`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sequence: 1, slotType: "break" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate day for a config", async () => {
    const res = await fetch(`${BASE_URL}/configs/${configId}/days`, {
      method: "POST",
      headers,
      body: JSON.stringify({ dayOfWeek: 6 }),
    });
    expect(res.status).toBe(400);
  });

  it("archives the config on delete", async () => {
    let res = await fetch(`${BASE_URL}/configs/${configId}`, {
      method: "DELETE",
      headers,
    });
    expect(res.status).toBe(200);
    res = await fetch(`${BASE_URL}/configs/${configId}`, { headers });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("archived");
  });
});

describe("Timetable API — clone day slots", () => {
  let configId: string;
  let sourceDayId: string; // Monday, with slots
  let targetDayId: string; // Tuesday, empty

  beforeAll(async () => {
    let res = await fetch(`${BASE_URL}/configs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        academicYearId: TEST_ACADEMIC_YEAR_ID,
        name: "Clone Day Grid",
      }),
    });
    configId = (await res.json()).uuid;

    res = await fetch(`${BASE_URL}/configs/${configId}/days`, {
      method: "POST",
      headers,
      body: JSON.stringify({ dayOfWeek: 1, label: "Monday" }),
    });
    sourceDayId = (await res.json()).uuid;
    for (const slot of [
      { sequence: 0, slotType: "registration", label: "Reg" },
      { sequence: 1, slotType: "teaching", label: "P1" },
      { sequence: 2, slotType: "break", label: "Break" },
    ]) {
      await fetch(`${BASE_URL}/days/${sourceDayId}/slots`, {
        method: "POST",
        headers,
        body: JSON.stringify(slot),
      });
    }

    res = await fetch(`${BASE_URL}/configs/${configId}/days`, {
      method: "POST",
      headers,
      body: JSON.stringify({ dayOfWeek: 2, label: "Tuesday" }),
    });
    targetDayId = (await res.json()).uuid;
  });

  it("clones all slots from the source day onto the empty target day", async () => {
    const res = await fetch(`${BASE_URL}/days/${targetDayId}/clone-slots`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sourceDayId }),
    });
    expect(res.status).toBe(200);
    const day = await res.json();
    expect(day.slots.length).toBe(3);
    expect(day.slots.map((s: any) => s.sequence)).toEqual([0, 1, 2]);
    expect(day.slots.map((s: any) => s.slotType)).toEqual([
      "registration",
      "teaching",
      "break",
    ]);
  });

  it("rejects cloning onto a day that already has slots", async () => {
    const res = await fetch(`${BASE_URL}/days/${targetDayId}/clone-slots`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sourceDayId }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects cloning a day onto itself", async () => {
    const res = await fetch(`${BASE_URL}/days/${sourceDayId}/clone-slots`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sourceDayId }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects cloning from an empty source day", async () => {
    // Add a fresh empty day and try to clone from it onto another fresh empty day.
    let res = await fetch(`${BASE_URL}/configs/${configId}/days`, {
      method: "POST",
      headers,
      body: JSON.stringify({ dayOfWeek: 3, label: "Wednesday" }),
    });
    const emptySource = (await res.json()).uuid;
    res = await fetch(`${BASE_URL}/configs/${configId}/days`, {
      method: "POST",
      headers,
      body: JSON.stringify({ dayOfWeek: 4, label: "Thursday" }),
    });
    const emptyTarget = (await res.json()).uuid;
    res = await fetch(`${BASE_URL}/days/${emptyTarget}/clone-slots`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sourceDayId: emptySource }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for a missing target day", async () => {
    const res = await fetch(`${BASE_URL}/days/nope-day-id/clone-slots`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sourceDayId }),
    });
    expect(res.status).toBe(404);
  });

  afterAll(async () => {
    await fetch(`${BASE_URL}/configs/${configId}`, {
      method: "DELETE",
      headers,
    });
  });
});
