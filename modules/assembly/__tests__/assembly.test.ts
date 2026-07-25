import { api, getSeed, cleanupPlan, deleteThemeById, deleteChecklistItemById, resetAssemblyConfig, resetGrading, seedEmployee, seedHouse, setWeekHouse, closePool, dateForWeekday, BASE_URL, headers } from './helpers';

// Integration tests against a running assembly module (or the gateway).
// Covers plans, the node tree (day subset + inheritance), special assemblies
// (day-filtered clone + independence), themes, resolve, and the /me guard.

let seed: { schoolId: string; academicYearId: string; classIds: string[] };
const createdPlans: string[] = [];
const createdThemes: string[] = [];
const createdChecklistItems: string[] = [];
const SUF = Date.now().toString(36);

// Dates in Sep 2026 for deterministic weekday behaviour.
const MON = dateForWeekday(2026, 9, 1);
const TUE = dateForWeekday(2026, 9, 2);
const WED = dateForWeekday(2026, 9, 3);

async function newPlan(name: string, days?: string[]): Promise<any> {
  const r = await api('POST', '/plans', { academicYearId: seed.academicYearId, name: `${name}-${SUF}`, days });
  expect(r.status).toBe(200);
  createdPlans.push(r.body.uuid);
  return r.body;
}
async function addNode(planId: string, title: string, parentId?: string): Promise<string> {
  const r = await api('POST', `/plans/${planId}/nodes`, { parentId, title });
  expect(r.status).toBe(200);
  return r.body.uuid;
}
const titlesOf = (nodes: any[]): string[] =>
  nodes.reduce((acc: string[], n: any) => [...acc, n.title, ...titlesOf(n.children || [])], []);

beforeAll(async () => { seed = await getSeed(); });
afterAll(async () => {
  for (const id of createdPlans) await cleanupPlan(id);
  for (const t of createdThemes) await deleteThemeById(t);
  for (const c of createdChecklistItems) await deleteChecklistItemById(c);
  await resetGrading(seed.schoolId, `AG-${SUF}`); // rubric/evaluators + seeded fixtures
  await resetAssemblyConfig(seed.schoolId); // restore default template mode
  await closePool();
});

describe('lookups', () => {
  it('serves weekday and responsible catalogs', async () => {
    const r = await api('GET', '/lookups');
    expect(r.status).toBe(200);
    expect(r.body.weekdays).toHaveLength(7);
    expect(r.body.responsibleTargetTypes.map((t: any) => t.value)).toEqual(
      expect.arrayContaining(['employee', 'class', 'student', 'text']));
  });
});

describe('plans + audience', () => {
  it('creates a draft plan with default weekdays', async () => {
    const plan = await newPlan('Primary');
    expect(plan.publishStatus).toBe('draft');
    expect(plan.days).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
  });

  it('rejects a duplicate name in the same year', async () => {
    await newPlan('DupName');
    const r = await api('POST', '/plans', { academicYearId: seed.academicYearId, name: `DupName-${SUF}` });
    expect(r.status).toBe(400);
  });

  it('rejects a missing academicYearId', async () => {
    const r = await api('POST', '/plans', { name: `NoYear-${SUF}` });
    expect(r.status).toBe(400);
  });

  it('sets an audience and ALLOWS class overlap across dated plans', async () => {
    const a = await newPlan('WingA');
    const b = await newPlan('WingB');
    const set = await api('PUT', `/plans/${a.uuid}/classes`, { classIds: [seed.classIds[0], seed.classIds[1]] });
    expect(set.status).toBe(200);
    expect(set.body.classes).toHaveLength(2);

    // Overlap is now allowed — dated plans resolve by narrowest-range-wins.
    const overlap = await api('PUT', `/plans/${b.uuid}/classes`, { classIds: [seed.classIds[1], seed.classIds[2]] });
    expect(overlap.status).toBe(200);
    expect(overlap.body.classes).toHaveLength(2);
  });

  it('creates dated plans and clones a plan with its tree', async () => {
    const t1 = await api('POST', '/plans', {
      academicYearId: seed.academicYearId, name: `Term1-${SUF}`, startDate: '2026-04-01', endDate: '2026-09-30',
    });
    expect(t1.status).toBe(200);
    expect(t1.body.startDate).toBe('2026-04-01');
    createdPlans.push(t1.body.uuid);
    await addNode(t1.body.uuid, 'Opening');

    // bad range rejected
    const bad = await api('POST', '/plans', { academicYearId: seed.academicYearId, name: `Bad-${SUF}`, startDate: '2026-10-01', endDate: '2026-09-01' });
    expect(bad.status).toBe(400);

    // clone → new dated draft with the tree copied
    const clone = await api('POST', `/plans/${t1.body.uuid}/clone`, { name: `Term2-${SUF}`, startDate: '2026-10-01', endDate: '2027-03-31' });
    expect(clone.status).toBe(200);
    createdPlans.push(clone.body.uuid);
    expect(clone.body.startDate).toBe('2026-10-01');
    expect(clone.body.publishStatus).toBe('draft');
    const tree = await api('GET', `/plans/${clone.body.uuid}/tree`);
    expect(titlesOf(tree.body)).toContain('Opening');
  });

  it('replaces weekdays and publishes', async () => {
    const plan = await newPlan('Publishable');
    const days = await api('PUT', `/plans/${plan.uuid}/days`, { days: ['mon', 'wed'] });
    expect(days.body.days).toEqual(['mon', 'wed']);
    const bad = await api('PUT', `/plans/${plan.uuid}/days`, { days: ['funday'] });
    expect(bad.status).toBe(400);
    const pub = await api('POST', `/plans/${plan.uuid}/publish`);
    expect(pub.body.publishStatus).toBe('published');
    expect(pub.body.publishedAt).toBeTruthy();
  });
});

describe('node tree', () => {
  it('enforces the weekday subset rule and builds a tree', async () => {
    const plan = await newPlan('Tree', ['mon', 'wed', 'fri']);
    const opening = await addNode(plan.uuid, 'Opening');
    const prayer = await addNode(plan.uuid, 'Prayer', opening);
    const present = await addNode(plan.uuid, 'Presentation');
    const vtalk = await addNode(plan.uuid, 'Value talk', present);

    expect((await api('PUT', `/nodes/${vtalk}/days`, { days: ['wed'] })).status).toBe(200);
    expect((await api('PUT', `/nodes/${vtalk}/days`, { days: ['sun'] })).status).toBe(400); // outside parent
    expect((await api('PUT', `/nodes/${vtalk}/days`, { days: ['tue'] })).status).toBe(400); // outside plan ceiling

    // shrinking the parent below a descendant's explicit day is rejected
    expect((await api('PUT', `/nodes/${present}/days`, { days: ['mon'] })).status).toBe(400);

    const reorder = await api('PUT', `/plans/${plan.uuid}/nodes/order`, { order: [present, opening] });
    expect(reorder.status).toBe(200);
    expect(reorder.body.map((n: any) => n.title)).toEqual(['Presentation', 'Opening']);

    const del = await api('DELETE', `/nodes/${opening}`);
    expect(del.status).toBe(200);
    const tree = await api('GET', `/plans/${plan.uuid}/tree`);
    expect(titlesOf(tree.body)).not.toContain('Prayer'); // subtree gone
    expect(titlesOf(tree.body)).toEqual(expect.arrayContaining(['Presentation', 'Value talk']));
    void prayer;
  });

  it('validates polymorphic responsible parties and skips empty resources', async () => {
    const plan = await newPlan('Resp', ['mon']);
    const node = await addNode(plan.uuid, 'Prayer');
    const ok = await api('PUT', `/nodes/${node}/responsible`, {
      responsible: [
        { role: 'performers', targetType: 'class', targetId: seed.classIds[0] },
        { role: 'anchor', targetType: 'text', targetText: 'Head Girl' },
      ],
    });
    expect(ok.status).toBe(200);
    expect(ok.body.responsible[0].targetName).toBeTruthy();
    expect((await api('PUT', `/nodes/${node}/responsible`, { responsible: [{ targetType: 'employee', targetId: 'nope' }] })).status).toBe(400);
    expect((await api('PUT', `/nodes/${node}/responsible`, { responsible: [{ targetType: 'text' }] })).status).toBe(400);

    const res = await api('PUT', `/nodes/${node}/resources`, { resources: [{ label: 'Script', url: 'https://x/p' }, {}] });
    expect(res.body.resources).toHaveLength(1);
  });
});

describe('special assemblies', () => {
  it('clones a day-filtered tree, stays independent, and supports blank + dup guard', async () => {
    const plan = await newPlan('Special', ['mon', 'wed', 'fri']);
    const opening = await addNode(plan.uuid, 'Opening');
    await addNode(plan.uuid, 'Prayer', opening);
    const present = await addNode(plan.uuid, 'Presentation');
    const vtalk = await addNode(plan.uuid, 'Value talk', present);
    await api('PUT', `/nodes/${vtalk}/days`, { days: ['wed'] });

    // Monday clone excludes the wed-only node; Wednesday clone includes it.
    const mon = await api('POST', `/plans/${plan.uuid}/specials`, { specialDate: MON, title: 'Founders Day' });
    expect(mon.status).toBe(200);
    expect(titlesOf(mon.body.nodes)).not.toContain('Value talk');
    expect(titlesOf(mon.body.nodes)).toEqual(expect.arrayContaining(['Opening', 'Prayer', 'Presentation']));

    const wed = await api('POST', `/plans/${plan.uuid}/specials`, { specialDate: WED, title: 'Science Day' });
    expect(titlesOf(wed.body.nodes)).toContain('Value talk');

    // Editing the special must not touch the template.
    const specialRoot = mon.body.nodes.find((n: any) => n.title === 'Presentation');
    await api('DELETE', `/nodes/${specialRoot.uuid}`);
    await api('POST', `/specials/${mon.body.uuid}/nodes`, { title: 'Chief Guest' });
    const tmpl = await api('GET', `/plans/${plan.uuid}/tree`);
    expect(titlesOf(tmpl.body)).toContain('Presentation');
    expect(titlesOf(tmpl.body)).not.toContain('Chief Guest');

    // dup date + blank + publish
    expect((await api('POST', `/plans/${plan.uuid}/specials`, { specialDate: MON, title: 'dup' })).status).toBe(400);
    const blank = await api('POST', `/plans/${plan.uuid}/specials`, { specialDate: dateForWeekday(2026, 9, 5), title: 'Blank', source: 'blank' });
    expect(blank.body.nodes).toHaveLength(0);
    expect((await api('POST', `/specials/${mon.body.uuid}/publish`)).body.publishStatus).toBe('published');
  });
});

describe('themes', () => {
  it('creates plan-scoped and school-wide themes and validates ranges', async () => {
    const plan = await newPlan('Themed');
    const school = await api('POST', '/themes', { academicYearId: seed.academicYearId, title: `Honesty-${SUF}`, startDate: '2026-09-01', endDate: '2026-09-30' });
    expect(school.status).toBe(200); createdThemes.push(school.body.uuid);
    const scoped = await api('POST', '/themes', { academicYearId: seed.academicYearId, planId: plan.uuid, title: 'Cleanliness', startDate: '2026-09-01', endDate: '2026-09-07' });
    expect(scoped.status).toBe(200);
    expect((await api('POST', '/themes', { academicYearId: seed.academicYearId, title: 'Bad', startDate: '2026-09-10', endDate: '2026-09-01' })).status).toBe(400);
    const list = await api('GET', `/themes?academicYearId=${seed.academicYearId}&planId=${plan.uuid}`);
    expect(list.body.map((t: any) => t.title)).toEqual(expect.arrayContaining([`Honesty-${SUF}`, 'Cleanliness']));
  });
});

describe('resolve', () => {
  it('day-filters the template, inherits responsible, applies special override + not-held', async () => {
    const plan = await newPlan('Resolve', ['mon', 'wed', 'fri']);
    const opening = await addNode(plan.uuid, 'Opening');
    await api('PUT', `/nodes/${opening}/responsible`, { responsible: [{ role: 'in-charge', targetType: 'text', targetText: 'Principal' }] });
    const prayer = await addNode(plan.uuid, 'Prayer', opening); // inherits Principal
    const present = await addNode(plan.uuid, 'Presentation');
    const vtalk = await addNode(plan.uuid, 'Value talk', present);
    await api('PUT', `/nodes/${vtalk}/days`, { days: ['wed'] });
    await api('POST', `/plans/${plan.uuid}/publish`);
    void prayer;

    // Monday: held template, Value talk excluded, Prayer inherits Principal.
    const monR = await api('GET', `/resolve?planId=${plan.uuid}&date=${MON}`);
    expect(monR.body.held).toBe(true);
    expect(monR.body.source).toBe('template');
    expect(titlesOf(monR.body.nodes)).not.toContain('Value talk');
    const openNode = monR.body.nodes.find((n: any) => n.title === 'Opening');
    expect(openNode.children[0].responsible[0].targetText).toBe('Principal'); // inherited

    // Tuesday: not a plan weekday -> not held.
    const tueR = await api('GET', `/resolve?planId=${plan.uuid}&date=${TUE}`);
    expect(tueR.body.held).toBe(false);
    expect(tueR.body.nodes).toHaveLength(0);

    // Published special on Tuesday overrides -> held, source special.
    const sp = await api('POST', `/plans/${plan.uuid}/specials`, { specialDate: TUE, title: 'Sports Day', source: 'blank' });
    await api('POST', `/specials/${sp.body.uuid}/nodes`, { title: 'March Past' });
    await api('POST', `/specials/${sp.body.uuid}/publish`);
    const tueR2 = await api('GET', `/resolve?planId=${plan.uuid}&date=${TUE}`);
    expect(tueR2.body.held).toBe(true);
    expect(tueR2.body.source).toBe('special');
    expect(titlesOf(tueR2.body.nodes)).toContain('March Past');

    expect((await api('GET', `/resolve?planId=${plan.uuid}&date=2026-13-40`)).status).toBe(400);
    expect((await api('GET', `/resolve?planId=nope&date=${MON}`)).status).toBe(404);
  });
});

describe('time-aware responsibility', () => {
  it('rotates a responsible weekly by calendar cycle', async () => {
    const plan = await newPlan('Rota', ['mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
    const node = await addNode(plan.uuid, 'Prayer');
    const set = await api('PUT', `/nodes/${node}/responsible`, {
      responsible: [
        { role: 'performers', targetType: 'class', targetId: seed.classIds[0], mode: 'rotating', cycleUnit: 'weekly', anchorDate: '2026-04-06', ruleGroup: 'rg1' },
        { role: 'performers', targetType: 'class', targetId: seed.classIds[1], mode: 'rotating', cycleUnit: 'weekly', anchorDate: '2026-04-06', ruleGroup: 'rg1' },
      ],
    });
    expect(set.status).toBe(200);
    await api('POST', `/plans/${plan.uuid}/publish`);

    const perf = async (date: string) => {
      const r = await api('GET', `/resolve?planId=${plan.uuid}&date=${date}`);
      const p = (r.body.nodes || []).find((n: any) => n.title === 'Prayer');
      return (p?.responsible || []).map((x: any) => x.targetId)[0];
    };
    expect(await perf('2026-04-08')).toBe(seed.classIds[0]); // week 0 → member 0
    expect(await perf('2026-04-15')).toBe(seed.classIds[1]); // week 1 → member 1
    expect(await perf('2026-04-22')).toBe(seed.classIds[0]); // week 2 → wraps to member 0
  });
});

describe('house mode: weekly roster', () => {
  // MON is a Monday in Sep 2026 → a valid week_start.
  let planId: string;
  let rosterNode: string;
  let optionalNode: string;
  let weekId: string;

  beforeAll(async () => {
    await api('PUT', '/config', { mode: 'house' });
    const plan = await newPlan('HouseWing', ['mon']);
    planId = plan.uuid;
    rosterNode = (await api('POST', `/plans/${planId}/nodes`, { title: 'Presentation', fillMode: 'roster' })).body.uuid;
    optionalNode = (await api('POST', `/plans/${planId}/nodes`, { title: 'Special Item', isOptional: true })).body.uuid;
    await api('POST', `/plans/${planId}/publish`);
  });

  it('ensures a draft week (idempotent) and lists it', async () => {
    const r = await api('POST', `/plans/${planId}/weeks`, { weekStart: MON });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('draft');
    expect(r.body.editable).toBe(true);
    weekId = r.body.uuid;
    // Fillable slots surface the roster + optional nodes for the Monday.
    const monDay = r.body.days.find((d: any) => d.date === MON);
    expect(monDay.slots.map((s: any) => s.nodeId)).toEqual(expect.arrayContaining([rosterNode, optionalNode]));

    const again = await api('POST', `/plans/${planId}/weeks`, { weekStart: MON });
    expect(again.body.uuid).toBe(weekId); // idempotent

    const list = await api('GET', `/plans/${planId}/weeks?from=${MON}&to=${MON}`);
    expect(list.body.map((w: any) => w.uuid)).toContain(weekId);
  });

  it('saves a roster, approves it, and overlays it onto resolve', async () => {
    const save = await api('PUT', `/weeks/${weekId}/roster`, {
      // Day anchors (polymorphic participants, incl. a free-text anchor + a group).
      days: [
        {
          date: MON,
          anchors: [{ targetType: 'text', targetText: 'Head Girl' }, { targetType: 'class', targetId: seed.classIds[0] }],
          commanders: [{ targetType: 'text', targetText: 'Cmdr Rai' }],
          drummers: [{ targetType: 'text', targetText: 'Drummer Das' }],
        },
      ],
      entries: [
        // A skit slot: content + a GROUP of performers (two classes) on one node.
        {
          date: MON, nodeId: rosterNode, content: 'Speech on Courage',
          participants: [
            { role: 'presenter', targetType: 'class', targetId: seed.classIds[0] },
            { role: 'performer', targetType: 'class', targetId: seed.classIds[1] },
          ],
        },
        { date: MON, nodeId: optionalNode, opted: false }, // hide the optional segment
      ],
    });
    expect(save.status).toBe(200);
    const monDay = save.body.days.find((d: any) => d.date === MON);
    expect(monDay.anchors).toHaveLength(2);           // N anchors, not capped at 2 columns
    expect(monDay.commanders).toHaveLength(1);        // assembly commander (own day role)
    expect(monDay.drummers).toHaveLength(1);          // assembly drummer (own day role)
    const savedSlot = monDay.slots.find((s: any) => s.nodeId === rosterNode);
    expect(savedSlot.participants).toHaveLength(2);    // a group on one slot

    expect((await api('POST', `/weeks/${weekId}/submit`)).body.status).toBe('submitted');
    const approved = await api('POST', `/weeks/${weekId}/approve`);
    expect(approved.body.status).toBe('approved');
    expect(approved.body.locked).toBe(true);

    // Resolve now overlays the approved roster: filled content, group of performers,
    // anchors surfaced, and the opted-out optional segment pruned.
    const r = await api('GET', `/resolve?planId=${planId}&date=${MON}`);
    expect(r.body.mode).toBe('house');
    expect(r.body.rosterApproved).toBe(true);
    expect((r.body.anchors || []).map((a: any) => a.name)).toContain('Head Girl');
    // commander/drummer are roster-only roles — they must NOT leak into resolved anchors.
    expect((r.body.anchors || []).map((a: any) => a.name)).not.toContain('Cmdr Rai');
    expect((r.body.anchors || []).map((a: any) => a.name)).not.toContain('Drummer Das');
    const pres = r.body.nodes.find((n: any) => n.title === 'Presentation');
    expect(pres.content).toBe('Speech on Courage');
    expect(pres.responsible).toHaveLength(2);          // the performer group
    expect(titlesOf(r.body.nodes)).not.toContain('Special Item'); // opted out
  });

  it('blocks edits once approved, then re-opens on unlock', async () => {
    const blocked = await api('PUT', `/weeks/${weekId}/roster`, { entries: [] });
    expect(blocked.status).toBe(400);

    const unlocked = await api('POST', `/weeks/${weekId}/unlock`, { reason: 'late correction' });
    expect(unlocked.status).toBe(200);
    expect(unlocked.body.status).toBe('draft');
    expect(unlocked.body.locked).toBe(false);
    expect(unlocked.body.editable).toBe(true);

    expect((await api('PUT', `/weeks/${weekId}/roster`, { entries: [] })).status).toBe(200);
  });

  it('configures a checklist, ticks it for the week, and signs off', async () => {
    const weekItem = await api('POST', '/checklist/items', { scope: 'week', text: 'Roster approved on time', phase: 'Before' });
    expect(weekItem.status).toBe(200);
    createdChecklistItems.push(weekItem.body.uuid);
    const dayItem = await api('POST', '/checklist/items', { scope: 'day', text: 'Mic tested', phase: 'On the day' });
    createdChecklistItems.push(dayItem.body.uuid);

    // The week checklist read model splits scopes and lists the week's assembly dates.
    const before = await api('GET', `/weeks/${weekId}/checklist`);
    expect(before.body.weekItems.map((i: any) => i.uuid)).toContain(weekItem.body.uuid);
    expect(before.body.dayItems.map((i: any) => i.uuid)).toContain(dayItem.body.uuid);
    expect(before.body.dates).toContain(MON);

    // A day-scoped item without a date is rejected; a week-scoped one with a date too.
    expect((await api('PUT', `/weeks/${weekId}/checklist`, { ticks: [{ itemId: dayItem.body.uuid }] })).status).toBe(400);
    expect((await api('PUT', `/weeks/${weekId}/checklist`, { ticks: [{ itemId: weekItem.body.uuid, date: MON }] })).status).toBe(400);

    const saved = await api('PUT', `/weeks/${weekId}/checklist`, {
      ticks: [{ itemId: weekItem.body.uuid }, { itemId: dayItem.body.uuid, date: MON }],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.ticks).toHaveLength(2);

    const signed = await api('POST', `/weeks/${weekId}/checklist/signoff`, { note: 'All good' });
    expect(signed.body.signoff.note).toBe('All good');
    const cleared = await api('DELETE', `/weeks/${weekId}/checklist/signoff`);
    expect(cleared.body.signoff).toBeUndefined();
  });

  it('grades a week against a rubric and computes house-of-the-month', async () => {
    // Give the week a house snapshot + seed an evaluator employee.
    const houseId = await seedHouse(seed.schoolId, `AG-${SUF} Red`);
    await setWeekHouse(weekId, houseId, `AG-${SUF} Red`);
    const evalEmp = await seedEmployee(seed.schoolId, `AG-${SUF} Eval`);

    // Rubric: two metrics (max 5) + one penalty (2), scaling 0.
    const m1 = await api('POST', '/rubric/metrics', { name: 'Discipline', maxMarks: 5 });
    const m2 = await api('POST', '/rubric/metrics', { name: 'Content', maxMarks: 5 });
    const p1 = await api('POST', '/rubric/penalties', { name: 'Overran', value: 2 });
    expect(m1.status).toBe(200);
    await api('PUT', '/rubric/config', { scalingAdjustment: 0 });
    expect((await api('GET', '/rubric')).body.metrics.length).toBeGreaterThanOrEqual(2);

    const ev = await api('POST', '/evaluators', { employeeId: evalEmp, startDate: MON, endDate: MON });
    expect(ev.status).toBe(200);

    // An unassigned evaluator and an over-max score are both rejected.
    expect((await api('POST', `/weeks/${weekId}/grades`, { gradeDate: MON, evaluatorId: 'nobody', metrics: [] })).status).toBe(400);
    expect((await api('POST', `/weeks/${weekId}/grades`, { gradeDate: MON, evaluatorId: evalEmp, metrics: [{ metricId: m1.body.uuid, score: 9 }] })).status).toBe(400);

    // Valid grade: 5 + 4 - 2 (penalty) + 0 (scaling) = 7.
    const g = await api('POST', `/weeks/${weekId}/grades`, {
      gradeDate: MON, evaluatorId: evalEmp,
      metrics: [{ metricId: m1.body.uuid, score: 5 }, { metricId: m2.body.uuid, score: 4 }],
      penalties: [p1.body.uuid], starPresenter: 'Aarav', feedback: 'Crisp',
    });
    expect(g.status).toBe(200);
    expect(g.body.total).toBe(7);

    // Upsert (same evaluator+date) stays a single grade; recomputes total = 5 + 5 = 10.
    await api('POST', `/weeks/${weekId}/grades`, {
      gradeDate: MON, evaluatorId: evalEmp,
      metrics: [{ metricId: m1.body.uuid, score: 5 }, { metricId: m2.body.uuid, score: 5 }],
    });
    const list = await api('GET', `/weeks/${weekId}/grades`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].total).toBe(10);

    // Leaderboard → house-of-the-month is our house at average 10.
    const lb = await api('GET', `/leaderboard?from=${MON}&to=${MON}`);
    expect(lb.body.houseOfTheMonth.houseId).toBe(houseId);
    expect(lb.body.houseOfTheMonth.average).toBe(10);
  });
});

describe('/me guard', () => {
  it('rejects app endpoints without a student token', async () => {
    // No Authorization header -> unauthenticated (401).
    const today = await fetch(`${BASE_URL}/me/assembly/today`, { headers });
    expect(today.status).toBe(401);
    const on = await fetch(`${BASE_URL}/me/assembly/on?date=${MON}`, { headers });
    expect(on.status).toBe(401);
    // Teacher-PWA duties need an employee token; student leaderboard needs a family token.
    const duties = await fetch(`${BASE_URL}/me/assembly/duties`, { headers });
    expect(duties.status).toBe(401);
    const lb = await fetch(`${BASE_URL}/me/assembly/leaderboard`, { headers });
    expect(lb.status).toBe(401);
  });
});
