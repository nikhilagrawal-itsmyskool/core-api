import {
  BASE_URL,
  headers,
  getClassId,
  createSubject,
  uniqueYearId,
  TEST_TEACHER_ID,
  closePool,
} from "./helpers";

// One shared published master for the whole suite, so exactly one publish happens
// per run (its created_at is newest, so the date-aware resolver picks it over any
// leftover master for the shared sample class). effectiveFrom is fixed 2030-01-01;
// no other test publishes into 2030, and all query dates below are Mondays in 2030.
let ctx: { classId: string; engId: string; slotIds: string[] };
let activationId: string;

async function json(res: Response): Promise<any> {
  return res.json();
}

async function processUntilDone(runId: string): Promise<any> {
  for (let i = 0; i < 15; i++) {
    await fetch(`${BASE_URL}/runs/process-next`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workerId: "test" }),
    });
    const run = await json(await fetch(`${BASE_URL}/runs/${runId}`, { headers }));
    if (run.status === "completed" || run.status === "failed") return run;
  }
  throw new Error("run did not finish");
}

async function publishOneDayMaster() {
  const classId = await getClassId();
  const academicYearId = uniqueYearId();
  const eng = await createSubject();

  const config = await json(
    await fetch(`${BASE_URL}/configs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ academicYearId, name: "Now Test Grid" }),
    }),
  );
  const day = await json(
    await fetch(`${BASE_URL}/configs/${config.uuid}/days`, {
      method: "POST",
      headers,
      body: JSON.stringify({ dayOfWeek: 1 }), // Monday
    }),
  );
  const slotIds: string[] = [];
  for (const [seq, start, end] of [
    [1, "09:00:00", "09:40:00"],
    [2, "09:40:00", "10:20:00"],
  ] as const) {
    const slot = await json(
      await fetch(`${BASE_URL}/days/${day.uuid}/slots`, {
        method: "POST",
        headers,
        body: JSON.stringify({ sequence: seq, slotType: "teaching", startTime: start, endTime: end }),
      }),
    );
    slotIds.push(slot.uuid);
  }

  await fetch(`${BASE_URL}/class-subjects`, {
    method: "POST",
    headers,
    body: JSON.stringify({ academicYearId, classId, subjectId: eng.uuid, periodsPerWeek: 2 }),
  });
  await fetch(`${BASE_URL}/teaching-assignments`, {
    method: "POST",
    headers,
    body: JSON.stringify({ academicYearId, classId, subjectId: eng.uuid, teacherId: TEST_TEACHER_ID }),
  });
  await fetch(`${BASE_URL}/class-teachers`, {
    method: "POST",
    headers,
    body: JSON.stringify({ academicYearId, classId, teacherId: TEST_TEACHER_ID }),
  });

  await fetch(`${BASE_URL}/configs/${config.uuid}/lock`, { method: "POST", headers });
  const { runId } = await json(
    await fetch(`${BASE_URL}/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ configId: config.uuid, numCandidates: 1 }),
    }),
  );
  const run = await processUntilDone(runId);
  expect(run.status).toBe("completed");
  const { candidates } = await json(await fetch(`${BASE_URL}/runs/${runId}/candidates`, { headers }));
  const pub = await json(
    await fetch(`${BASE_URL}/publish`, {
      method: "POST",
      headers,
      body: JSON.stringify({ candidateId: candidates[0].uuid, effectiveFrom: "2030-01-01" }),
    }),
  );
  expect(pub.publishedTimetableId).toBeTruthy();
  return { classId, engId: eng.uuid as string, slotIds };
}

beforeAll(async () => {
  ctx = await publishOneDayMaster();

  // A Winter season that shifts the two Monday slots ~15 min later.
  const season = await json(
    await fetch(`${BASE_URL}/seasons`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Winter" }),
    }),
  );
  await fetch(`${BASE_URL}/seasons/${season.uuid}/slot-times`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      slotTimes: [
        { timeSlotId: ctx.slotIds[0], startTime: "09:15:00", endTime: "09:55:00" },
        { timeSlotId: ctx.slotIds[1], startTime: "09:55:00", endTime: "10:35:00" },
      ],
    }),
  });

  // Clear any leftover 2030 activation from a crashed prior run (school-wide
  // overlap check would otherwise reject ours).
  const { activations } = await json(await fetch(`${BASE_URL}/season-activations`, { headers }));
  for (const a of activations) {
    if (String(a.effectiveFrom).startsWith("2030")) {
      await fetch(`${BASE_URL}/season-activations/${a.uuid}`, { method: "DELETE", headers });
    }
  }
  // Active only for the first ~10 days of Jan 2030 (covers the 7th, not the 14th).
  const act = await json(
    await fetch(`${BASE_URL}/season-activations`, {
      method: "POST",
      headers,
      body: JSON.stringify({ seasonId: season.uuid, effectiveFrom: "2030-01-01", effectiveTo: "2030-01-10" }),
    }),
  );
  activationId = act.uuid;
}, 90000);

afterAll(async () => {
  if (activationId) {
    await fetch(`${BASE_URL}/season-activations/${activationId}`, { method: "DELETE", headers });
  }
  await closePool();
});

describe("Timetable API — happening now", () => {
  it("resolves the current + next slot using the active season's times", async () => {
    // Mon 2030-01-07, 09:30 IST (04:00Z) → inside the overridden first slot.
    const now = await json(
      await fetch(`${BASE_URL}/now?classId=${ctx.classId}&at=2030-01-07T04:00:00Z`, { headers }),
    );
    expect(now.dayOfWeek).toBe(1);
    expect(now.seasonName).toBe("Winter");
    expect(now.now).toBeTruthy();
    expect(now.now.timeSlotId).toBe(ctx.slotIds[0]);
    expect(now.now.slotType).toBe("teaching");
    expect(now.now.startTime).toBe("09:15:00"); // season override, not base 09:00
    expect(now.now.endTime).toBe("09:55:00");
    expect(now.now.entries.length).toBeGreaterThan(0);
    expect(now.now.entries[0].subjectId).toBe(ctx.engId);
    expect(now.now.entries[0].teacherId).toBe(TEST_TEACHER_ID);
    // next slot is the second period, also season-shifted
    expect(now.next.timeSlotId).toBe(ctx.slotIds[1]);
    expect(now.next.startTime).toBe("09:55:00");
  });

  it("falls back to base slot times when no season is active for the date", async () => {
    // Mon 2030-01-14, 09:30 IST — outside the activation window → base times.
    const now = await json(
      await fetch(`${BASE_URL}/now?classId=${ctx.classId}&at=2030-01-14T04:00:00Z`, { headers }),
    );
    expect(now.seasonId).toBeNull();
    expect(now.now.timeSlotId).toBe(ctx.slotIds[0]);
    expect(now.now.startTime).toBe("09:00:00"); // base time
  });

  it("returns a note (no now/next) for a class with no published timetable", async () => {
    const now = await json(
      await fetch(`${BASE_URL}/now?classId=no-such-class&at=2030-01-07T04:00:00Z`, { headers }),
    );
    expect(now.now).toBeNull();
    expect(now.next).toBeNull();
    expect(now.note).toBeTruthy();
  });

  it("requires classId", async () => {
    const res = await fetch(`${BASE_URL}/now`, { headers });
    expect(res.status).toBe(400);
  });
});
