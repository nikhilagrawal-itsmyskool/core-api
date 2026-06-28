// Read-only inspector for generated timetable data via the prod APIs.
// Logs in, lists generation runs, and for a run summarizes the top candidate:
// per-class teaching-period totals (vs the grid), teacher clashes, score breakdown.
// Reusable — pass creds each run. NO writes; only GET (+ the login POST).
//
//   node scripts/prod-timetable-inspect.js --user <u> --pass <p> [opts]
//   opts: --school dbpasn  --base https://api.itsmyskool.com
//         --run <runId>        (default: latest completed)
//         --candidate <rank>   (default: 1 = best)
//         --grid               (also print each class's day×period grid)
//
// Node 18+ (global fetch). No dependencies.

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const flag = (name) => process.argv.includes(name);

const BASE = arg("--base", "https://api.itsmyskool.com").replace(/\/$/, "");
const SCHOOL = arg("--school", "dbpasn");
const USER = arg("--user") || process.env.PROD_USER;
const PASS = arg("--pass") || process.env.PROD_PASS;
const RUN_ARG = arg("--run");
const CAND_RANK = Number(arg("--candidate", "1"));
const SHOW_GRID = flag("--grid");
const TEACHER = arg("--teacher"); // audit one teacher's constraints vs the schedule

const DAYS = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun" };

let TOKEN = "";
async function apiGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "X-School-Code": SCHOOL,
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`GET ${path} → ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

async function login() {
  const res = await fetch(`${BASE}/auth/employee/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-School-Code": SCHOOL },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(`login → ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  const token =
    data.token || data.auth_token || data.accessToken || data.jwt ||
    data.data?.token || data.data?.accessToken;
  if (!token)
    throw new Error(`login ok but no token field found. keys: ${Object.keys(data).join(", ")}`);
  TOKEN = token;
  console.log(`LOGIN ok — school=${SCHOOL} user=${USER}`);
}

function pad(s, n) {
  s = String(s ?? "");
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

async function main() {
  if (!USER || !PASS) {
    console.log("Usage: node scripts/prod-timetable-inspect.js --user <u> --pass <p> [--run <id>] [--grid]");
    process.exit(1);
  }
  await login();

  // --- runs ---
  const { runs } = await apiGet(`/timetable/runs`);
  console.log(`\n=== RUNS (${runs.length}) ===`);
  console.log(
    pad("#", 3) + pad("runId", 14) + pad("status", 11) + pad("config", 20) +
    pad("scope", 16) + pad("cand", 5) + pad("best", 9) + "finished",
  );
  runs.forEach((r, i) => {
    console.log(
      pad(i + 1, 3) + pad(r.uuid, 14) + pad(r.status, 11) +
      pad(r.configName || r.configId, 20) + pad(r.wingName || "whole school", 16) +
      pad(r.candidateCount ?? 0, 5) + pad(r.bestScore ?? "-", 9) +
      (r.finishedAt ? new Date(r.finishedAt).toLocaleString() : "-"),
    );
  });

  const run =
    (RUN_ARG && runs.find((r) => r.uuid === RUN_ARG)) ||
    runs.find((r) => r.status === "completed");
  if (!run) {
    console.log("\nNo completed run to inspect (pass --run <id> to force one).");
    return;
  }

  console.log(`\n=== RUN ${run.uuid} — ${run.configName || run.configId} (${run.wingName || "whole school"}) status=${run.status} ===`);
  if (run.error) console.log(`error: ${run.error}`);

  const { candidates } = await apiGet(`/timetable/runs/${run.uuid}/candidates`);
  console.log(`candidates: ${candidates.length}`);
  for (const c of candidates) {
    const bd = c.scoreBreakdown
      ? Object.entries(c.scoreBreakdown).map(([k, v]) => `${k}=${v}`).join("  ")
      : "";
    console.log(`  #${c.rank}  score ${c.score}  ${bd}`);
  }

  const cand = candidates.find((c) => c.rank === CAND_RANK) || candidates[0];
  if (!cand) return;
  const entries = cand.entries || [];

  // resolve class + slot labels
  let classNames = {};
  try {
    const cs = await apiGet(`/classes/search?academicYearId=${run.academicYearId}`);
    const list = Array.isArray(cs) ? cs : cs.classes || cs.data || [];
    for (const c of list) classNames[c.uuid] = c.name;
  } catch (e) {
    console.log(`(could not resolve class names: ${e.message})`);
  }
  let slotSeq = {}; // time_slot_id -> { day, sequence, slotType }
  let teachingByDay = {};
  try {
    const cfg = await apiGet(`/timetable/configs/${run.configId}`);
    for (const d of cfg.days || []) {
      for (const s of d.slots || []) {
        slotSeq[s.uuid] = { day: d.dayOfWeek, sequence: s.sequence, slotType: s.slotType };
        if (s.slotType === "teaching")
          teachingByDay[d.dayOfWeek] = (teachingByDay[d.dayOfWeek] || 0) + 1;
      }
    }
  } catch (e) {
    console.log(`(could not load config grid: ${e.message})`);
  }
  const gridTeaching = Object.values(teachingByDay).reduce((a, b) => a + b, 0);

  // --- per-class teaching-period totals (distinct day|slot with a subject) ---
  const byClass = {};
  for (const e of entries) {
    if (!e.subjectId) continue; // skip registration (0th, no subject)
    const k = e.classId;
    (byClass[k] = byClass[k] || new Set()).add(`${e.dayOfWeek}|${e.timeSlotId}`);
  }
  console.log(`\n=== Candidate #${cand.rank} (score ${cand.score}) — ${Object.keys(byClass).length} classes, grid teaching slots = ${gridTeaching} ===`);
  const rows = Object.entries(byClass)
    .map(([cid, set]) => ({ cid, n: set.size }))
    .sort((a, b) => (classNames[a.cid] || a.cid).localeCompare(classNames[b.cid] || b.cid));
  for (const r of rows) {
    const flagTxt =
      gridTeaching && r.n < gridTeaching ? `  ⚠ ${gridTeaching - r.n} empty slot(s)` :
      gridTeaching && r.n > gridTeaching ? `  ⚠ OVER by ${r.n - gridTeaching}` : "";
    console.log(`  ${pad(classNames[r.cid] || r.cid, 22)} ${pad(r.n, 4)} periods${flagTxt}`);
  }

  // --- teacher clashes (same teacher, day, slot in >1 entry not sharing a band) ---
  const tslot = {};
  for (const e of entries) {
    if (!e.teacherId) continue;
    const k = `${e.teacherId}|${e.dayOfWeek}|${e.timeSlotId}`;
    (tslot[k] = tslot[k] || []).push(e);
  }
  const clashes = Object.entries(tslot).filter(([, es]) => {
    const bands = new Set(es.map((e) => e.bandId || e.uuid));
    return es.length > 1 && bands.size > 1; // band siblings legitimately share
  });
  console.log(`\nteacher clashes: ${clashes.length === 0 ? "none ✓" : clashes.length}`);
  for (const [k, es] of clashes.slice(0, 20)) {
    const [tid, day] = k.split("|");
    console.log(`  teacher ${tid} day ${DAYS[day] || day}: ${es.map((e) => e.subjectName || e.subjectId).join(" + ")}`);
  }

  // --- optional per-class day×period grid ---
  if (SHOW_GRID && Object.keys(slotSeq).length) {
    const maxSeq = Math.max(...Object.values(slotSeq).map((s) => s.sequence));
    const days = [...new Set(Object.values(slotSeq).map((s) => s.day))].sort();
    for (const r of rows) {
      console.log(`\n--- ${classNames[r.cid] || r.cid} ---`);
      const cell = {}; // day|seq -> label
      for (const e of entries) {
        if (e.classId !== r.cid) continue;
        const s = slotSeq[e.timeSlotId];
        if (!s) continue;
        const key = `${s.day}|${s.sequence}`;
        const lbl = e.subjectCode || e.subjectName || (e.subjectId ? "?" : "reg");
        cell[key] = cell[key] ? `${cell[key]}/${lbl}` : lbl; // bands show A/B/C
      }
      let header = pad("", 5);
      for (let q = 1; q <= maxSeq; q++) header += pad("P" + q, 10);
      console.log(header);
      for (const d of days) {
        let line = pad(DAYS[d] || d, 5);
        for (let q = 1; q <= maxSeq; q++) line += pad(cell[`${d}|${q}`] || "·", 10);
        console.log(line);
      }
    }
  }

  // --- teacher constraint audit ---
  if (TEACHER) {
    let emps = [];
    try {
      const r = await apiGet(`/employees/search?name=${encodeURIComponent(TEACHER)}`);
      emps = Array.isArray(r) ? r : r.employees || r.data || r.results || [];
    } catch (e) {
      console.log(`\nemployee search failed: ${e.message}`);
    }
    const matches = emps.filter((e) =>
      (e.name || "").toLowerCase().includes(TEACHER.toLowerCase()),
    );
    if (matches.length === 0) console.log(`\nNo employee matching "${TEACHER}".`);
    for (const emp of matches) {
      console.log(`\n=== TEACHER AUDIT: ${emp.name} (${emp.uuid}) ===`);
      let cons = [];
      try {
        const r = await apiGet(
          `/timetable/teacher-constraints?teacherId=${emp.uuid}&academicYearId=${run.academicYearId}`,
        );
        cons = r.constraints || [];
      } catch (e) {
        console.log(`  constraints fetch failed: ${e.message}`);
      }
      if (cons.length === 0)
        console.log("  (no constraints configured for this teacher)");
      for (const c of cons)
        console.log(`  constraint: ${c.constraintType} ${JSON.stringify(c.value)} [${c.hardness}]`);

      const sched = entries
        .filter((e) => e.teacherId === emp.uuid)
        .map((e) => ({
          day: e.dayOfWeek,
          seq: slotSeq[e.timeSlotId]?.sequence,
          subject: e.subjectCode || e.subjectName,
        }));
      console.log(`  scheduled in ${sched.length} period(s):`);
      const byDay = {};
      for (const s of sched) (byDay[s.day] = byDay[s.day] || []).push(s);
      for (const d of Object.keys(byDay).sort())
        console.log(
          `    ${DAYS[d] || d}: ` +
            byDay[d]
              .sort((a, b) => (a.seq || 0) - (b.seq || 0))
              .map((s) => `P${s.seq}:${s.subject}`)
              .join("  "),
        );

      const viol = [];
      for (const c of cons) {
        if (c.constraintType === "day_off") {
          for (const s of sched)
            if (Number(s.day) === Number(c.value?.day))
              viol.push(`scheduled on day-off ${DAYS[c.value.day]} (P${s.seq} ${s.subject}) [${c.hardness}]`);
        } else if (c.constraintType === "unavailable_slot") {
          for (const s of sched)
            if (Number(s.day) === Number(c.value?.day) && Number(s.seq) === Number(c.value?.slot))
              viol.push(`in unavailable slot ${DAYS[c.value.day]} P${c.value.slot} (${s.subject}) [${c.hardness}]`);
        }
      }
      console.log(`  violations: ${viol.length === 0 ? "none ✓" : viol.length}`);
      for (const v of viol) console.log(`    ✗ ${v}`);
    }
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
