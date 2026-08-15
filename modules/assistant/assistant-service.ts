import Anthropic from "@anthropic-ai/sdk";
import { getCurrentAcademicYearId } from "./assistant-common";

// The assistant answers a manager's spoken question by letting Claude drive: it is given a
// single read-only `apiGet(path)` tool over our existing HTTP surface and an `answer()` tool
// to finish. Claude plans which endpoint(s) to call (search a student, load their detail,
// pull attendance/timetable/library/etc.), we execute each GET forwarding the manager's own
// JWT + X-School-Code (so downstream authorization + contact masking are the manager's real
// permissions), feed the JSON back, and loop until it answers. Safety fence:
//   • apiGet only ever issues GET, never a write.
//   • the requested path must pass `allowedPath()` — a read-only allowlist of module prefixes
//     minus sensitive/binary fragments (credentials, /me family routes, images/bills/receipts).
//   • X-School-Code is fixed server-side from the caller — never a value the model supplies.
//   • the loop is capped (MAX_HOPS) and each tool result is size-bounded.
// Stateless: the client holds `context` (an opaque conversation blob) and echoes it each turn.

const GATEWAY = process.env.COMM_BASE_URL || "http://localhost:3000"; // the API gateway base
const MODEL = "claude-haiku-4-5-20251001";
const MAX_HOPS = 6; // max apiGet rounds before we force an answer
const HISTORY_CAP = 24; // messages carried across turns (trimmed to a valid start)
const RESULT_CAP = 6000; // max chars of any single tool result fed back to the model

let anthropic: Anthropic | null = null;
function llm(): Anthropic {
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

export interface AskAuth {
  schoolCode: string;
  authorization?: string;
}
// Opaque, client-held conversation state (echoed back each turn). `history` is the raw
// Claude message list; `focus*` remembers the student under discussion for follow-ups.
export interface Convo {
  history: any[];
  focusStudentId?: string | null;
  focusName?: string | null;
}
export interface AskInput {
  question: string;
  context?: Convo | null;
  // Reply language. 'hi' -> answer in Hindi.
  lang?: "en" | "hi";
}
// The structured summary card the UI renders when a student is in focus (best-effort — built
// from whatever the model happened to fetch this turn; the spoken answer is authoritative).
export interface StudentCard {
  studentId: string;
  name: string;
  className: string | null;
  roll: number | null;
  admissionNumber: string | null;
  house: string | null;
  guardians: { relation: string; name: string | null; mobile: string | null; whatsapp: string | null }[];
  siblings: { name: string; className: string | null; relation: string | null }[];
  address: string | null;
  classTeacher: { name: string | null; teaches: string | null } | null;
  subjects: string[];
  attendance: { present: number; absent: number; late: number; leave: number; total: number; percent: number } | null;
  today: { subject: string; teacher: string | null; start: string | null }[];
}
export interface AskResult {
  speech: string;
  card?: StudentCard | null;
  context: Convo;
}

// ── HTTP fan-out (forwards the manager's JWT + X-School-Code) ──────────────────
async function apiGet(auth: AskAuth, path: string): Promise<any> {
  const res = await fetch(`${GATEWAY}${path}`, {
    headers: {
      "X-School-Code": auth.schoolCode,
      ...(auth.authorization ? { Authorization: auth.authorization } : {}),
    },
  });
  const text = await res.text();
  if (res.status >= 400) return { error: `HTTP ${res.status}`, detail: text.slice(0, 300) };
  try {
    return JSON.parse(text);
  } catch {
    return { error: "non-JSON response", detail: text.slice(0, 300) };
  }
}
const asArray = (r: any, ...keys: string[]) => (Array.isArray(r) ? r : keys.map((k) => r?.[k]).find(Array.isArray) || []);

// ── Read-only allowlist ───────────────────────────────────────────────────────
// A path is callable iff its first segment is a readable module AND it doesn't hit a
// sensitive/binary fragment. apiGet is GET-only, so writes are already unreachable; this
// fence just keeps the model off login credentials, per-child family (`/me`) routes, and
// binary file/image/receipt endpoints that are useless to speak anyway.
const READ_PREFIXES = new Set([
  "students", "attendance", "timetable", "classes", "academic-years", "homework", "syllabus",
  "transport", "library", "fine", "fees", "medical", "employees", "assembly", "communication",
  "transfer", "shop", "uniform", "lab", "sports", "supplies", "asset", "hiring",
]);
const DENY: RegExp[] = [
  /\/credentials(\/|\?|$)/,
  /\/me(\/|\?|$)/,
  /\/images?(\/|\?|$)/,
  /\/photos?(\/|\?|$)/,
  /\/files?(\/|\?|$)/,
  /\/evidence(\/|\?|$)/,
  /\/bill(\/|\?|$)/,
  /\/receipt(\/|\?|$)/,
  /\/export(\/|\?|$)/,
  /\/source(\/|\?|$)/,
  /\/docs?\/[^/]+\/file/,
  /\/documents?\/[^/]+\/file/,
];
function allowedPath(path: string): boolean {
  if (typeof path !== "string" || !path.startsWith("/")) return false;
  const seg = path.slice(1).split(/[/?#]/)[0];
  if (!READ_PREFIXES.has(seg)) return false;
  return !DENY.some((re) => re.test(path));
}

// ── The API menu handed to Claude (compact; it may call any readable GET, not just these) ──
function apiMenu(ay: string | null): string {
  return [
    "You can call these read-only endpoints via apiGet(path). The school is fixed for you — never put a school code in the path.",
    ay ? `Current academic year id = "${ay}" — pass it as academicYearId where an endpoint accepts one (most default to the current year if omitted).` : "",
    "STUDENTS:",
    "  /students/omni-search?q={text}  — fuzzy search by student/parent/phone/admission. Returns ranked students (uuid, name, className, fatherName). START HERE to find a student.",
    "  /students/search?name=&classId=&academicYearId=&admissionNumber=&phone=  — structured roster search.",
    "  /students/{id}  — full 360 detail: guardians (names + mobile/whatsapp, masked unless you have contact access), siblings, addresses, house, classTeacher{name,subjects}, currentClassName/RollNumber/admissionNumber, currentEffectiveClassId.",
    "  /students/{id}/guardians | /siblings | /addresses  — those sections alone.",
    "  /students/class-strength?academicYearId=  — returns totalStrength (whole-school active head-count), classCount, and per-class strengths. Use totalStrength directly for 'how many students in the school' — never add the per-class numbers yourself.",
    "  /students/houses , /students/houses/{id}/teachers  — houses.",
    "ATTENDANCE:  /attendance/student/{id}?academicYearId=&from=&to=  — a student's summary{present,absent,late,leave,total,percent} + days.",
    "TIMETABLE:  /timetable/today?classId={effectiveClassId}  — today's periods for a class.  /timetable/now?classId=  — current period.  /timetable/class-subjects?classId=&academicYearId=  — subjects for a class.  /timetable/class-teachers , /timetable/teaching-assignments.",
    "CLASSES:  /classes/search?name=&academicYearId=  — resolve a class name to its uuid.  /classes/streams?baseClassId=.",
    "LIBRARY:  /library/borrowers/student/{studentId}/loans  — books a student has out.  /library/fines.",
    "TRANSPORT:  /transport/reports/student/{studentId}?academicYearId=  — a student's route + stop.",
    "FEES / DUES:",
    "  /fees/students/{id}/summary?academicYearId={ay}  — THIS student's fee position for a year: dueNow (payable now, through this month), dueQuarter (cumulative through this quarter's end), outstanding (full remaining this year), advance, paid, concession. Always pass the current academicYearId. monthEndLabel/quarterEndLabel tell you the cut-off dates.",
    "  /fees/students/{id}/dues-by-year  — the student's outstanding split by academic year, ALREADY totalled for you: priorYearsTotal (all previous years combined), currentYearBalance, totalOutstanding. Use priorYearsTotal when asked about 'previous years' dues.",
    "  /fees/students/{id}/concessions?academicYearId={ay}  — the student's concessions/discounts, ALREADY totalled: currentYear.schemes[] (each offered scheme's name, feeHead, valueType/value and the rupee amount 'applied'), currentYear.totalApplied (total discount this year), priorYearsTotal (concession given in all previous years combined), allTimeTotal, byYear[]. Use for 'what concessions does this student get' / 'how much concession this year' / 'concession in previous years'.",
    "  /fees/reports/overview?academicYearId={ay}  — WHOLE-SCHOOL money headline: collectedToday, collectedMonth, dueNow (school-wide due this month), outstanding (total dues as of now), duesStudents, advance. Use this for 'total collection today' and 'total dues as of now'.",
    "  /fees/reports/daily-collection?date=YYYY-MM-DD  — one day's collection: total{receipts,total} plus byMode[{paymentMode,total,receipts}] (cash/UPI/cheque/etc. breakup) and byCashier. Omit ?date for today. Call again with a different date to compare days.",
    "  /fees/reports/dues?academicYearId={ay}&classId=  — class-wise list of students who owe, with totals{dueNow,dueQuarter,fullYear,prevYears,students}.",
    "DISCIPLINE/FINES:  /fine/incidents  (filterable) , /fine/incidents/{id}.",
    "MEDICAL:  /medical/issues  — dispensing log (filterable).",
    "HOMEWORK:  /homework/day?classId=&date=YYYY-MM-DD.",
    "SYLLABUS:  /syllabus/syllabi , /syllabus/syllabi/{id}/progress  — coverage.",
    "STAFF:  /employees/search?name= , /employees/{id}.",
    "ASSEMBLY:  /assembly/plans , /assembly/leaderboard.",
    "Other read endpoints across shop/uniform/lab/sports/supplies/asset/hiring/transfer/communication are also available. To answer about a student you almost always: omni-search -> pick the uuid -> /students/{id} (+ attendance/timetable/etc. as the question needs).",
  ].filter(Boolean).join("\n");
}

// ── Build the UI summary card from whatever parts were fetched this turn ───────
function buildCard(id: string, parts: { detail?: any; attendance?: any; today?: any; classSubjects?: any }): StudentCard | null {
  const detail = parts.detail;
  if (!detail || !detail.name) return null;
  const guardians = (detail.guardians || []).map((g: any) => ({
    relation: g.relation, name: g.name || null, mobile: g.mobile || null, whatsapp: g.whatsapp || null,
  }));
  const siblings = (detail.siblings || []).map((s: any) => ({
    name: s.name || s.siblingName, className: s.className || null, relation: s.relation || s.relationship || null,
  }));
  const primaryAddr = (detail.addresses || []).find((a: any) => a.isPrimary) || (detail.addresses || [])[0] || null;
  const subjects = asArray(parts.classSubjects, "subjects", "results").map((r: any) => r.subjectName).filter(Boolean);
  const todayPeriods = (parts.today?.slots || [])
    .filter((sl: any) => (sl.entries || []).length > 0)
    .map((sl: any) => ({ subject: sl.entries[0].subjectName, teacher: sl.entries[0].teacherName || null, start: sl.startTime || null }));
  return {
    studentId: id,
    name: detail.name,
    className: detail.currentClassName || null,
    roll: detail.currentRollNumber ?? null,
    admissionNumber: detail.admissionNumber || null,
    house: detail.houseName || null,
    guardians,
    siblings,
    address: primaryAddr ? [primaryAddr.line1, primaryAddr.line2, primaryAddr.city, primaryAddr.pincode].filter(Boolean).join(", ") || primaryAddr.address || null : null,
    classTeacher: detail.classTeacher ? { name: detail.classTeacher.name || null, teaches: detail.classTeacher.subjects || null } : null,
    subjects,
    attendance: parts.attendance?.summary || null,
    today: todayPeriods,
  };
}

// Keep the carried history bounded AND valid: trim to the last HISTORY_CAP messages, then drop
// from the front until the first message is a plain user-text turn (so we never begin on an
// orphan tool_result whose matching tool_use was trimmed away — Claude rejects that).
function trimHistory(msgs: any[]): any[] {
  let out = msgs.slice(-HISTORY_CAP);
  while (out.length && !(out[0].role === "user" && typeof out[0].content === "string")) out = out.slice(1);
  return out;
}

// ── Orchestration: Claude drives apiGet/answer over the manager's permitted read surface ──
export async function ask(auth: AskAuth, schoolId: string, input: AskInput): Promise<AskResult> {
  const lang: "en" | "hi" = input.lang === "hi" ? "hi" : "en";
  const ay = await getCurrentAcademicYearId(schoolId).catch(() => null);
  const prior = input.context || null;

  const system = [
    "You are a concise school office assistant for the school manager. Answer spoken questions about students, classes and school operations, then call answer() with a natural 1–2 sentence reply suitable to be read aloud.",
    lang === "hi" ? "Reply in natural Hindi using Devanagari script (keep names and numbers exactly as-is)." : "",
    "Use ONLY data returned by apiGet — never invent facts. Contact numbers come back masked unless the manager has contact access; if a value is masked or absent, say it's restricted or unavailable.",
    "When you state a phone number, write it as a plain unbroken 10-digit string with no spaces, dashes or brackets (e.g. 8887781104) so the app can read it out digit by digit.",
    "Class grades are STORED as Roman numerals (I–XII), e.g. 'IX-A', 'VII-B'. When you search or filter by a class the manager names, use the Roman form for the lookup — convert spoken 'nine A' -> 'IX-A', 'class 7' -> 'VII'. But in your final SPOKEN answer, say the grade as an Arabic numeral — 'class 9-A', not 'IX-A'; 'class 12', not 'XII' (the section letter stays as-is).",
    "State money amounts in Indian numbering words (thousand, lakh, crore) — e.g. ₹1,45,000 as 'one lakh forty-five thousand rupees', ₹2,500 as 'two thousand five hundred rupees' — never as a bare digit run. Round to the nearest rupee.",
    "Never sum or count large lists in your head — if an endpoint gives you a total, a count, or a pre-computed rollup field, use it verbatim.",
    "When the manager names a class along with the name, filter to that class yourself — do not ask them to re-confirm the class. Only ask which student if genuinely more than one matches.",
    prior?.focusStudentId ? `Student currently under discussion: ${prior.focusName || "(unknown)"} — uuid ${prior.focusStudentId}. Follow-up questions are about this student unless a new name is given; you may call their endpoints with this uuid directly.` : "",
    apiMenu(ay),
  ].filter(Boolean).join("\n\n");

  const tools: any[] = [
    {
      name: "apiGet",
      description: "Fetch one read-only endpoint. `path` must start with '/' and include any query string, e.g. /students/omni-search?q=aarav . Returns the JSON body (or an {error} object).",
      input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
    {
      name: "answer",
      description: "Give the final spoken answer to the manager. Set studentId to the uuid of the student the answer is about (if any), so the app can show their card.",
      input_schema: { type: "object", properties: { text: { type: "string" }, studentId: { type: ["string", "null"] } }, required: ["text"] },
    },
  ];

  const messages: any[] = trimHistory([...(prior?.history || [])]);
  messages.push({ role: "user", content: input.question });

  // Parts captured this turn, keyed by student uuid, used to render the card.
  const captured: Record<string, { detail?: any; attendance?: any; today?: any; classSubjects?: any }> = {};
  const stash = (id: string, key: "detail" | "attendance" | "today" | "classSubjects", val: any) => {
    (captured[id] = captured[id] || {})[key] = val;
  };
  let lastDetailId: string | null = null;

  const finish = (text: string, studentId: string | null): AskResult => {
    const focusId = studentId || lastDetailId || prior?.focusStudentId || null;
    const card = focusId && captured[focusId]?.detail ? buildCard(focusId, captured[focusId]) : undefined;
    const focusName = card?.name || (focusId === prior?.focusStudentId ? prior?.focusName : null) || null;
    // Normalise the carried transcript so it's a VALID conversation to resume next turn:
    // it must end with a plain-text assistant turn (never a dangling `answer` tool_use that
    // has no tool_result after it, and never a trailing user tool_result). We keep the real
    // tool_use/tool_result exchanges (so follow-ups don't re-fetch) but cap the transcript.
    const hist = messages.slice();
    const last = hist[hist.length - 1];
    if (last && last.role === "assistant" && Array.isArray(last.content) && last.content.some((c: any) => c.type === "tool_use")) {
      hist[hist.length - 1] = { role: "assistant", content: text }; // drop the dangling answer tool_use
    } else if (!last || last.role !== "assistant") {
      hist.push({ role: "assistant", content: text }); // close an exhausted-hops turn cleanly
    }
    return {
      speech: text,
      card,
      context: { history: trimHistory(hist), focusStudentId: focusId, focusName },
    };
  };

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const msg = await llm().messages.create({
      model: MODEL,
      max_tokens: 700,
      system,
      tools,
      tool_choice: { type: "any" },
      messages,
    });
    messages.push({ role: "assistant", content: msg.content });

    const toolUses = (msg.content as any[]).filter((c) => c.type === "tool_use");
    const ansCall = toolUses.find((t) => t.name === "answer");
    if (ansCall) {
      const text = String(ansCall.input?.text || "").trim() || (lang === "hi" ? "क्षमा करें, वह जानकारी उपलब्ध नहीं है." : "Sorry, I don't have that information.");
      return finish(text, ansCall.input?.studentId || null);
    }
    if (toolUses.length === 0) {
      // Model replied with plain text — treat it as the answer.
      const text = (msg.content as any[]).filter((c) => c.type === "text").map((c) => c.text).join(" ").trim();
      return finish(text || (lang === "hi" ? "क्षमा करें, मैं समझ नहीं पाया." : "Sorry, I didn't catch that."), null);
    }

    // Execute every apiGet in this hop, appending a tool_result for each (required by Claude).
    const results: any[] = [];
    for (const t of toolUses) {
      let out: any;
      const path = String(t.input?.path || "");
      if (!allowedPath(path)) {
        out = { error: "path not allowed", note: "Only read-only endpoints are permitted." };
      } else {
        out = await apiGet(auth, path);
        // Class-strength: compute the exact whole-school total in code (the model must not
        // add 30+ numbers, and the raw per-class payload is big enough to hit RESULT_CAP).
        // Mirrors the Class Strength screen (sum of activeStrength across all rows).
        if (/^\/students\/class-strength(\?|$)/.test(path) && !out?.error) {
          const classes = asArray(out, "classes", "results").map((r: any) => ({ className: r.className, strength: Number(r.activeStrength || 0) }));
          out = { totalStrength: classes.reduce((s: number, c: any) => s + c.strength, 0), classCount: classes.length, classes };
        }
        // Dues-by-year: split current vs prior years and total in code (the model must not add
        // per-year balances). Endpoint returns a bare array of {academicYearId,yearName,balance}.
        if (/^\/fees\/students\/[a-z0-9]+\/dues-by-year(\?|$)/i.test(path) && Array.isArray(out)) {
          const years = out.map((r: any) => ({ academicYearId: r.academicYearId, yearName: r.yearName, balance: Math.round(Number(r.balance || 0)) }));
          const current = years.find((y) => y.academicYearId === ay) || null;
          const priorYears = years.filter((y) => y.academicYearId !== ay);
          out = {
            currentYearBalance: current ? current.balance : 0,
            priorYearsTotal: priorYears.reduce((s: number, y: any) => s + y.balance, 0),
            totalOutstanding: years.reduce((s: number, y: any) => s + y.balance, 0),
            priorYears, years,
          };
        }
        // Capture student parts for the card.
        const detailM = path.match(/^\/students\/([a-z0-9]+)(\?|$)/i);
        const attM = path.match(/^\/attendance\/student\/([a-z0-9]+)/i);
        if (detailM && !out?.error) { stash(detailM[1], "detail", out); lastDetailId = detailM[1]; }
        else if (attM && !out?.error) stash(attM[1], "attendance", out);
        else if (/^\/timetable\/today\?/.test(path) && !out?.error && lastDetailId) stash(lastDetailId, "today", out);
        else if (/^\/timetable\/class-subjects\?/.test(path) && !out?.error && lastDetailId) stash(lastDetailId, "classSubjects", out);
      }
      let content = JSON.stringify(out);
      if (content.length > RESULT_CAP) content = content.slice(0, RESULT_CAP) + '…"[truncated]"';
      results.push({ type: "tool_result", tool_use_id: t.id, content });
    }
    messages.push({ role: "user", content: results });
  }

  // Ran out of hops — ask Claude for a best-effort answer from what it has (no tools).
  const wrap = await llm().messages.create({
    model: MODEL,
    max_tokens: 400,
    system: system + "\n\nYou have gathered enough. Give the final spoken answer now in plain text.",
    messages,
  });
  const text = (wrap.content as any[]).filter((c) => c.type === "text").map((c) => c.text).join(" ").trim();
  return finish(text || (lang === "hi" ? "क्षमा करें, वह जानकारी उपलब्ध नहीं है." : "Sorry, I couldn't find that."), null);
}
