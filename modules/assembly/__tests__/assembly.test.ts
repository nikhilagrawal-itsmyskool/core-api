import { api, getSeed, cleanupPlan, deleteThemeById, resetAssemblyConfig, closePool, dateForWeekday, BASE_URL, headers } from './helpers';

// Integration tests against a running assembly module (or the gateway).
// Covers plans, the node tree (day subset + inheritance), special assemblies
// (day-filtered clone + independence), themes, resolve, and the /me guard.

let seed: { schoolId: string; academicYearId: string; classIds: string[] };
const createdPlans: string[] = [];
const createdThemes: string[] = [];
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
      entries: [
        { date: MON, nodeId: rosterNode, content: 'Speech on Courage' },
        { date: MON, nodeId: optionalNode, opted: false }, // hide the optional segment
      ],
    });
    expect(save.status).toBe(200);

    expect((await api('POST', `/weeks/${weekId}/submit`)).body.status).toBe('submitted');
    const approved = await api('POST', `/weeks/${weekId}/approve`);
    expect(approved.body.status).toBe('approved');
    expect(approved.body.locked).toBe(true);

    // Resolve now overlays the approved roster: filled content + pruned optional.
    const r = await api('GET', `/resolve?planId=${planId}&date=${MON}`);
    expect(r.body.mode).toBe('house');
    expect(r.body.rosterApproved).toBe(true);
    const pres = r.body.nodes.find((n: any) => n.title === 'Presentation');
    expect(pres.content).toBe('Speech on Courage');
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
});

describe('/me guard', () => {
  it('rejects app endpoints without a student token', async () => {
    // No Authorization header -> unauthenticated (401).
    const today = await fetch(`${BASE_URL}/me/assembly/today`, { headers });
    expect(today.status).toBe(401);
    const on = await fetch(`${BASE_URL}/me/assembly/on?date=${MON}`, { headers });
    expect(on.status).toBe(401);
  });
});
