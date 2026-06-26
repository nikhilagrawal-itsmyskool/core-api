import {
  BASE_URL,
  headers,
  getClassId,
  createSubject,
  uniqueYearId,
  TEST_TEACHER_ID,
  closePool,
} from "./helpers";

afterAll(async () => {
  await closePool();
});

// A minimal config: 1 day (Mon) with 2 teaching slots. Returns its id + first day id.
async function makeConfig(
  name = "Lifecycle Test",
): Promise<{ configId: string; dayId: string; academicYearId: string }> {
  const academicYearId = uniqueYearId();
  let res = await fetch(`${BASE_URL}/configs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ academicYearId, name }),
  });
  const config = await res.json();
  res = await fetch(`${BASE_URL}/configs/${config.uuid}/days`, {
    method: "POST",
    headers,
    body: JSON.stringify({ dayOfWeek: 1 }),
  });
  const day = await res.json();
  for (let seq = 1; seq <= 2; seq++) {
    await fetch(`${BASE_URL}/days/${day.uuid}/slots`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sequence: seq, slotType: "teaching" }),
    });
  }
  return { configId: config.uuid, dayId: day.uuid, academicYearId };
}

describe("Timetable API — config lock lifecycle", () => {
  it("rejects generation on a draft config and allows it once locked", async () => {
    const { configId, academicYearId } = await makeConfig();
    const classId = await getClassId();
    const sub = await createSubject();
    await fetch(`${BASE_URL}/class-subjects`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        academicYearId,
        classId,
        subjectId: sub.uuid,
        periodsPerWeek: 2,
      }),
    });
    await fetch(`${BASE_URL}/teaching-assignments`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        academicYearId,
        classId,
        subjectId: sub.uuid,
        teacherId: TEST_TEACHER_ID,
      }),
    });

    // draft → generate rejected
    let res = await fetch(`${BASE_URL}/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ configId, numCandidates: 1 }),
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain("lock");

    // lock → generate accepted
    res = await fetch(`${BASE_URL}/configs/${configId}/lock`, {
      method: "POST",
      headers,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).lockedAt).toBeTruthy();

    res = await fetch(`${BASE_URL}/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ configId, numCandidates: 1 }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("queued");
  }, 20000);

  it("blocks structural edits on a locked config but allows rename", async () => {
    const { configId, dayId } = await makeConfig();
    await fetch(`${BASE_URL}/configs/${configId}/lock`, {
      method: "POST",
      headers,
    });

    // add a slot → blocked
    let res = await fetch(`${BASE_URL}/days/${dayId}/slots`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sequence: 3, slotType: "teaching" }),
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain("locked");

    // add a day → blocked
    res = await fetch(`${BASE_URL}/configs/${configId}/days`, {
      method: "POST",
      headers,
      body: JSON.stringify({ dayOfWeek: 2 }),
    });
    expect(res.status).toBe(400);

    // rename (updateConfig) → still allowed
    res = await fetch(`${BASE_URL}/configs/${configId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ name: "Renamed While Locked" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe("Renamed While Locked");
  }, 20000);

  it("allows unlock while unused, but not after a generation run exists", async () => {
    const { configId } = await makeConfig();

    // lock then unlock (unused) → allowed, back to draft
    await fetch(`${BASE_URL}/configs/${configId}/lock`, {
      method: "POST",
      headers,
    });
    let res = await fetch(`${BASE_URL}/configs/${configId}/unlock`, {
      method: "POST",
      headers,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).lockedAt).toBeFalsy();

    // edit is possible again after unlock
    res = await fetch(`${BASE_URL}/configs/${configId}/days`, {
      method: "POST",
      headers,
      body: JSON.stringify({ dayOfWeek: 3 }),
    });
    expect(res.status).toBe(200);

    // lock + generate → now used → unlock rejected
    await fetch(`${BASE_URL}/configs/${configId}/lock`, {
      method: "POST",
      headers,
    });
    await fetch(`${BASE_URL}/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ configId, numCandidates: 1 }),
    });
    res = await fetch(`${BASE_URL}/configs/${configId}/unlock`, {
      method: "POST",
      headers,
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain("clone");
  }, 20000);

  it("clones a config into an editable draft with copied days/slots and new ids", async () => {
    const { configId, dayId } = await makeConfig("Original");
    await fetch(`${BASE_URL}/configs/${configId}/lock`, {
      method: "POST",
      headers,
    });

    const res = await fetch(`${BASE_URL}/configs/${configId}/clone`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Cloned Grid" }),
    });
    expect(res.status).toBe(200);
    const clone = await res.json();
    expect(clone.uuid).not.toBe(configId);
    expect(clone.name).toBe("Cloned Grid");
    expect(clone.lockedAt).toBeFalsy(); // a fresh draft
    expect(clone.days.length).toBe(1);
    expect(clone.days[0].uuid).not.toBe(dayId); // new day id
    expect(clone.days[0].slots.length).toBe(2);

    // the clone is editable (draft) — add a slot succeeds
    const add = await fetch(`${BASE_URL}/days/${clone.days[0].uuid}/slots`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sequence: 3, slotType: "break" }),
    });
    expect(add.status).toBe(200);

    // the original (locked) is untouched — still 2 slots
    const origRes = await fetch(`${BASE_URL}/configs/${configId}`, { headers });
    const orig = await origRes.json();
    expect(orig.days[0].slots.length).toBe(2);
  }, 20000);
});
