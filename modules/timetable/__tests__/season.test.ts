import { BASE_URL, headers, uniqueYearId, closePool } from "./helpers";

// Activation windows use fixed dates and the overlap check is school-wide, so
// clean them up (the test DB persists between runs — otherwise a re-run collides).
const createdActivations: string[] = [];
async function postActivation(body: object): Promise<Response> {
  const res = await fetch(`${BASE_URL}/season-activations`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (res.status === 200) createdActivations.push((await res.clone().json()).uuid);
  return res;
}

afterAll(async () => {
  for (const id of createdActivations) {
    await fetch(`${BASE_URL}/season-activations/${id}`, { method: "DELETE", headers });
  }
  await closePool();
});

// A tiny config: 1 day (Mon) with 2 timed teaching slots. Returns the slot uuids.
async function makeTimedConfig(): Promise<{ configId: string; slotIds: string[] }> {
  const academicYearId = uniqueYearId();
  let res = await fetch(`${BASE_URL}/configs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ academicYearId, name: "Season Test Grid" }),
  });
  const config = await res.json();
  res = await fetch(`${BASE_URL}/configs/${config.uuid}/days`, {
    method: "POST",
    headers,
    body: JSON.stringify({ dayOfWeek: 1 }),
  });
  const day = await res.json();
  const slotIds: string[] = [];
  for (const [seq, start, end] of [
    [1, "09:00:00", "09:40:00"],
    [2, "09:40:00", "10:20:00"],
  ] as const) {
    res = await fetch(`${BASE_URL}/days/${day.uuid}/slots`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sequence: seq, slotType: "teaching", startTime: start, endTime: end }),
    });
    slotIds.push((await res.json()).uuid);
  }
  return { configId: config.uuid, slotIds };
}

async function createSeason(name: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/seasons`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(200);
  return (await res.json()).uuid;
}

describe("Timetable API — seasons CRUD", () => {
  it("creates, reads, updates and archives a season", async () => {
    const id = await createSeason("Summer");
    let res = await fetch(`${BASE_URL}/seasons/${id}`, { headers });
    expect(res.status).toBe(200);
    let season = await res.json();
    expect(season.name).toBe("Summer");
    expect(season.status).toBe("active");
    expect(season.slotTimes).toEqual([]);
    expect(season.activations).toEqual([]);

    res = await fetch(`${BASE_URL}/seasons/${id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ name: "Summer 2026" }),
    });
    expect((await res.json()).name).toBe("Summer 2026");

    res = await fetch(`${BASE_URL}/seasons/${id}`, { method: "DELETE", headers });
    expect(res.status).toBe(200);
    season = await (await fetch(`${BASE_URL}/seasons/${id}`, { headers })).json();
    expect(season.status).toBe("archived");
  });

  it("rejects an invalid status and a nameless season", async () => {
    const id = await createSeason("Bad");
    let res = await fetch(`${BASE_URL}/seasons/${id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ status: "nope" }),
    });
    expect(res.status).toBe(400);

    res = await fetch(`${BASE_URL}/seasons`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "   " }),
    });
    expect(res.status).toBe(400);
  });
});

describe("Timetable API — season slot times", () => {
  it("bulk-sets per-slot times and lists them back", async () => {
    const { slotIds } = await makeTimedConfig();
    const id = await createSeason("Winter");

    let res = await fetch(`${BASE_URL}/seasons/${id}/slot-times`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        slotTimes: [
          { timeSlotId: slotIds[0], startTime: "09:15:00", endTime: "09:55:00" },
          { timeSlotId: slotIds[1], startTime: "09:55:00", endTime: "10:35:00" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).slotTimes.length).toBe(2);

    // upsert: re-sending one slot updates in place (still 2 rows total)
    res = await fetch(`${BASE_URL}/seasons/${id}/slot-times`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ slotTimes: [{ timeSlotId: slotIds[0], startTime: "09:10:00", endTime: "09:50:00" }] }),
    });
    const after = await res.json();
    expect(after.slotTimes.length).toBe(2);
    const s0 = after.slotTimes.find((s: any) => s.timeSlotId === slotIds[0]);
    expect(s0.startTime).toBe("09:10:00");
  });

  it("rejects an unknown time-slot id", async () => {
    const id = await createSeason("Winter2");
    const res = await fetch(`${BASE_URL}/seasons/${id}/slot-times`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ slotTimes: [{ timeSlotId: "no-such-slot", startTime: "09:00:00", endTime: "09:40:00" }] }),
    });
    expect(res.status).toBe(400);
  });

  it("prefills slot times from a config's base times", async () => {
    const { configId, slotIds } = await makeTimedConfig();
    const id = await createSeason("Prefilled");
    const res = await fetch(`${BASE_URL}/seasons/${id}/prefill`, {
      method: "POST",
      headers,
      body: JSON.stringify({ configId }),
    });
    expect(res.status).toBe(200);
    const { slotTimes } = await res.json();
    expect(slotTimes.length).toBe(slotIds.length);
    const s0 = slotTimes.find((s: any) => s.timeSlotId === slotIds[0]);
    expect(s0.startTime).toBe("09:00:00"); // seeded from the slot's base time
  });
});

describe("Timetable API — season activations", () => {
  it("creates non-overlapping windows and rejects an overlap", async () => {
    const summer = await createSeason("ActSummer");
    const winter = await createSeason("ActWinter");

    // Summer Apr–Oct
    let res = await postActivation({ seasonId: summer, effectiveFrom: "2027-04-01", effectiveTo: "2027-10-31" });
    expect(res.status).toBe(200);
    const summerAct = await res.json();

    // Winter Nov–Mar (adjacent, no overlap) → ok
    res = await postActivation({ seasonId: winter, effectiveFrom: "2027-11-01", effectiveTo: "2028-03-31" });
    expect(res.status).toBe(200);

    // overlapping Summer window → rejected
    res = await postActivation({ seasonId: summer, effectiveFrom: "2027-10-15", effectiveTo: "2027-12-01" });
    expect(res.status).toBe(400);

    // list scoped by season
    res = await fetch(`${BASE_URL}/season-activations?seasonId=${summer}`, { headers });
    const { activations } = await res.json();
    expect(activations.length).toBe(1);
    expect(activations[0].seasonName).toBe("ActSummer");

    // update + delete
    res = await fetch(`${BASE_URL}/season-activations/${summerAct.uuid}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ effectiveTo: "2027-09-30" }),
    });
    expect(res.status).toBe(200);
    res = await fetch(`${BASE_URL}/season-activations/${summerAct.uuid}`, { method: "DELETE", headers });
    expect(res.status).toBe(200);
  });

  it("rejects effectiveTo before effectiveFrom and an unknown season", async () => {
    const s = await createSeason("ActBad");
    let res = await fetch(`${BASE_URL}/season-activations`, {
      method: "POST",
      headers,
      body: JSON.stringify({ seasonId: s, effectiveFrom: "2027-05-01", effectiveTo: "2027-04-01" }),
    });
    expect(res.status).toBe(400);

    res = await fetch(`${BASE_URL}/season-activations`, {
      method: "POST",
      headers,
      body: JSON.stringify({ seasonId: "no-such-season", effectiveFrom: "2027-05-01" }),
    });
    expect(res.status).toBe(400);
  });
});
