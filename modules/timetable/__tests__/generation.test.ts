import {
  BASE_URL, headers, getClassId, createSubject, uniqueYearId,
  TEST_TEACHER_ID, TEST_TEACHER_ID_2, closePool,
} from './helpers';

afterAll(async () => { await closePool(); });

// Build a small, definitely-solvable config on the real test class:
// Mon–Fri, 4 teaching periods/day (20 slots); ENG (homeroom, T1) 5/wk + MATH (T2) 5/wk.
async function setupSolvableConfig() {
  const classId = await getClassId();
  const academicYearId = uniqueYearId();
  const eng = await createSubject();
  const math = await createSubject();

  // config + grid
  let res = await fetch(`${BASE_URL}/configs`, {
    method: 'POST', headers, body: JSON.stringify({ academicYearId, name: 'Gen Test Grid' }),
  });
  const config = await res.json();
  for (const dow of [1, 2, 3, 4, 5]) {
    res = await fetch(`${BASE_URL}/configs/${config.uuid}/days`, {
      method: 'POST', headers, body: JSON.stringify({ dayOfWeek: dow }),
    });
    const day = await res.json();
    for (let seq = 1; seq <= 4; seq++) {
      await fetch(`${BASE_URL}/days/${day.uuid}/slots`, {
        method: 'POST', headers, body: JSON.stringify({ sequence: seq, slotType: 'teaching', label: `P${seq}` }),
      });
    }
  }

  // demand + teachers + class teacher
  for (const [subjectId, teacherId] of [[eng.uuid, TEST_TEACHER_ID], [math.uuid, TEST_TEACHER_ID_2]] as const) {
    await fetch(`${BASE_URL}/class-subjects`, {
      method: 'POST', headers, body: JSON.stringify({ academicYearId, classId, subjectId, periodsPerWeek: 5 }),
    });
    await fetch(`${BASE_URL}/teaching-assignments`, {
      method: 'POST', headers, body: JSON.stringify({ academicYearId, classId, subjectId, teacherId }),
    });
  }
  await fetch(`${BASE_URL}/class-teachers`, {
    method: 'POST', headers, body: JSON.stringify({ academicYearId, classId, teacherId: TEST_TEACHER_ID }),
  });

  return { classId, academicYearId, configId: config.uuid as string, engId: eng.uuid as string };
}

// Drain the queue until our run is no longer queued (handles any backlog).
async function processUntilDone(runId: string): Promise<any> {
  for (let i = 0; i < 15; i++) {
    await fetch(`${BASE_URL}/runs/process-next`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workerId: 'test' }),
    });
    const res = await fetch(`${BASE_URL}/runs/${runId}`, { headers });
    const run = await res.json();
    if (run.status === 'completed' || run.status === 'failed') return run;
  }
  throw new Error('run did not finish');
}

describe('Timetable API — generation flow', () => {
  it('feasibility → generate → worker → candidates → publish, with class-teacher first periods', async () => {
    const { configId, engId, academicYearId } = await setupSolvableConfig();

    // feasibility
    let res = await fetch(`${BASE_URL}/feasibility`, {
      method: 'POST', headers, body: JSON.stringify({ configId }),
    });
    expect(res.status).toBe(200);
    const feas = await res.json();
    expect(feas.feasible).toBe(true);
    expect(feas.lessonCount).toBe(10);

    // generate (enqueue)
    res = await fetch(`${BASE_URL}/generate`, {
      method: 'POST', headers, body: JSON.stringify({ configId, numCandidates: 2 }),
    });
    expect(res.status).toBe(200);
    const { runId, status } = await res.json();
    expect(status).toBe('queued');

    // worker processing (driven explicitly)
    const run = await processUntilDone(runId);
    expect(run.status).toBe('completed');

    // candidates
    res = await fetch(`${BASE_URL}/runs/${runId}/candidates`, { headers });
    const { candidates } = await res.json();
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].entries.length).toBe(10);

    // class-teacher pin: first period of every day is the class teacher (T1, teaching ENG)
    const cfgRes = await fetch(`${BASE_URL}/configs/${configId}`, { headers });
    const cfg = await cfgRes.json();
    const seqOfSlot = new Map<string, number>();
    for (const day of cfg.days) for (const slot of day.slots) seqOfSlot.set(slot.uuid, slot.sequence);

    for (const dow of [1, 2, 3, 4, 5]) {
      const firstPeriod = candidates[0].entries.find((e: any) => e.dayOfWeek === dow && seqOfSlot.get(e.timeSlotId) === 1);
      expect(firstPeriod).toBeDefined();
      expect(firstPeriod.teacherId).toBe(TEST_TEACHER_ID);
      expect(firstPeriod.subjectId).toBe(engId);
    }

    // publish
    res = await fetch(`${BASE_URL}/publish`, {
      method: 'POST', headers, body: JSON.stringify({ candidateId: candidates[0].uuid, effectiveFrom: '2026-06-01' }),
    });
    expect(res.status).toBe(200);
    const published = await res.json();
    expect(published.entryCount).toBe(10);
    expect(published.publishedTimetableId).toBeDefined();

    // active published master is now retrievable with its grid config
    res = await fetch(`${BASE_URL}/published?academicYearId=${academicYearId}`, { headers });
    expect(res.status).toBe(200);
    const active = await res.json();
    expect(active.publishedTimetable).toBeTruthy();
    expect(active.entries.length).toBe(10);
    expect(active.config?.days?.length).toBe(5);
  }, 30000);

  it('feasibility reports actionable issues for an over-constrained config', async () => {
    const classId = await getClassId();
    const academicYearId = uniqueYearId();
    const sub = await createSubject();

    // tiny grid: 1 day, 2 periods; demand 5 → infeasible
    let res = await fetch(`${BASE_URL}/configs`, { method: 'POST', headers, body: JSON.stringify({ academicYearId, name: 'Tiny' }) });
    const config = await res.json();
    res = await fetch(`${BASE_URL}/configs/${config.uuid}/days`, { method: 'POST', headers, body: JSON.stringify({ dayOfWeek: 1 }) });
    const day = await res.json();
    for (let seq = 1; seq <= 2; seq++) {
      await fetch(`${BASE_URL}/days/${day.uuid}/slots`, { method: 'POST', headers, body: JSON.stringify({ sequence: seq, slotType: 'teaching' }) });
    }
    await fetch(`${BASE_URL}/class-subjects`, { method: 'POST', headers, body: JSON.stringify({ academicYearId, classId, subjectId: sub.uuid, periodsPerWeek: 5 }) });
    await fetch(`${BASE_URL}/teaching-assignments`, { method: 'POST', headers, body: JSON.stringify({ academicYearId, classId, subjectId: sub.uuid, teacherId: TEST_TEACHER_ID }) });

    res = await fetch(`${BASE_URL}/feasibility`, { method: 'POST', headers, body: JSON.stringify({ configId: config.uuid }) });
    const feas = await res.json();
    expect(feas.feasible).toBe(false);
    expect(feas.issues.length).toBeGreaterThan(0);
  });
});
