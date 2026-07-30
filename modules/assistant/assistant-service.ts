import Anthropic from "@anthropic-ai/sdk";
import { getCurrentAcademicYearId } from "./assistant-common";

// The assistant answers a manager's spoken question about a student. It resolves the
// student, loads a context (reusing the student / attendance / timetable modules over
// HTTP — forwarding the manager's JWT so their real authorization + contact masking
// apply), then lets Claude either answer from that context or request a different
// student. Stateless: the client holds `context` and echoes it back each turn.

const GATEWAY = process.env.COMM_BASE_URL || "http://localhost:3000"; // the API gateway base
const MODEL = "claude-haiku-4-5-20251001";

let anthropic: Anthropic | null = null;
function llm(): Anthropic {
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

export interface AskAuth {
  schoolCode: string;
  authorization?: string;
}
export interface AskInput {
  question: string;
  context?: StudentContext | null;
  // Force a specific student (skips name resolution) — used when the manager picks
  // one from a disambiguation list.
  studentId?: string;
}
export interface StudentContext {
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
  card?: StudentContext;
  context: StudentContext | null;
  needsDisambiguation?: boolean;
  candidates?: { studentId: string; name: string; className: string | null; roll: number | null; admissionNumber: string | null }[];
}

// ── HTTP fan-out (forwards the manager's JWT + X-School-Code) ──────────────────
async function apiGet(auth: AskAuth, path: string): Promise<any> {
  const res = await fetch(`${GATEWAY}${path}`, {
    headers: {
      "X-School-Code": auth.schoolCode,
      ...(auth.authorization ? { Authorization: auth.authorization } : {}),
    },
  });
  if (res.status >= 400) {
    const t = await res.text();
    throw new Error(`GET ${path} -> ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}
const asArray = (r: any, ...keys: string[]) => (Array.isArray(r) ? r : keys.map((k) => r?.[k]).find(Array.isArray) || []);

// ── Class-name normalisation ("nine A" / "9-A" / "IX A" -> "IXA") ─────────────
const NUM_WORD: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12" };
const DIGIT_ROMAN: Record<string, string> = { "1": "I", "2": "II", "3": "III", "4": "IV", "5": "V", "6": "VI", "7": "VII", "8": "VIII", "9": "IX", "10": "X", "11": "XI", "12": "XII" };
function canonClass(s?: string | null): string {
  if (!s) return "";
  let t = String(s).toLowerCase().replace(/class|grade|section/g, "").replace(/[^a-z0-9]/g, "");
  for (const [w, d] of Object.entries(NUM_WORD)) t = t.replace(w, d);
  const m = t.match(/^([ivxlcdm]+|\d+)([a-z]*)$/);
  if (!m) return t;
  let grade = m[1];
  if (/^\d+$/.test(grade)) grade = DIGIT_ROMAN[grade] || grade;
  else grade = grade.toUpperCase();
  return grade + (m[2] || "").toUpperCase();
}
const classMatch = (a?: string | null, b?: string | null) => !!canonClass(a) && canonClass(a) === canonClass(b);

// ── Resolve a student by (name, class) within the current year ────────────────
type ResolveResult =
  | { status: "one"; student: any }
  | { status: "many"; candidates: any[] }
  | { status: "none" };

async function resolveStudent(auth: AskAuth, schoolId: string, name: string, className: string | null): Promise<ResolveResult> {
  const ay = await getCurrentAcademicYearId(schoolId);
  const q = new URLSearchParams({ name });
  if (ay) q.set("academicYearId", ay);
  const raw = await apiGet(auth, `/students/search?${q.toString()}`);
  let list: any[] = asArray(raw, "students", "results");
  if (className) {
    const filtered = list.filter((s) => classMatch(className, s.className || s.currentClassName));
    if (filtered.length) list = filtered;
  }
  if (list.length === 0) return { status: "none" };
  if (list.length === 1) return { status: "one", student: list[0] };
  return { status: "many", candidates: list.slice(0, 6) };
}

// ── Load the full context for a resolved student (parallel fan-out) ───────────
async function loadContext(auth: AskAuth, schoolId: string, student: any): Promise<StudentContext> {
  const id = student.uuid;
  const ay = await getCurrentAcademicYearId(schoolId);
  const detail = await apiGet(auth, `/students/${id}`);
  const effClassId = detail.currentEffectiveClassId || detail.currentClassId;
  const [attendance, today, classSubjects] = await Promise.all([
    apiGet(auth, `/attendance/student/${id}${ay ? `?academicYearId=${ay}` : ""}`).catch(() => null),
    effClassId ? apiGet(auth, `/timetable/today?classId=${effClassId}`).catch(() => null) : Promise.resolve(null),
    effClassId ? apiGet(auth, `/timetable/class-subjects?classId=${effClassId}${ay ? `&academicYearId=${ay}` : ""}`).catch(() => null) : Promise.resolve(null),
  ]);

  const guardians = (detail.guardians || []).map((g: any) => ({
    relation: g.relation, name: g.name || null, mobile: g.mobile || null, whatsapp: g.whatsapp || null,
  }));
  const siblings = (detail.siblings || []).map((s: any) => ({
    name: s.name || s.siblingName, className: s.className || null, relation: s.relation || s.relationship || null,
  }));
  const primaryAddr = (detail.addresses || []).find((a: any) => a.isPrimary) || (detail.addresses || [])[0] || null;
  const subjects = asArray(classSubjects, "subjects", "results").map((r: any) => r.subjectName).filter(Boolean);
  const todayPeriods = (today?.slots || [])
    .filter((sl: any) => (sl.entries || []).length > 0)
    .map((sl: any) => ({ subject: sl.entries[0].subjectName, teacher: sl.entries[0].teacherName || null, start: sl.startTime || null }));

  return {
    studentId: id,
    name: detail.name,
    className: detail.currentClassName || student.className || null,
    roll: detail.currentRollNumber ?? student.rollNumber ?? null,
    admissionNumber: detail.admissionNumber || null,
    house: detail.houseName || null,
    guardians,
    siblings,
    address: primaryAddr ? [primaryAddr.line1, primaryAddr.line2, primaryAddr.city, primaryAddr.pincode].filter(Boolean).join(", ") || primaryAddr.address || null : null,
    classTeacher: detail.classTeacher ? { name: detail.classTeacher.name || null, teaches: detail.classTeacher.subjects || null } : null,
    subjects,
    attendance: attendance?.summary || null,
    today: todayPeriods,
  };
}

// ── Claude: answer from context, or request a (different) student ─────────────
type Route = { action: "answer"; text: string } | { action: "lookup"; name: string; className: string | null };

async function route(question: string, context: StudentContext | null): Promise<Route> {
  const system = [
    "You are a concise school office assistant for the school manager, answering aloud.",
    context
      ? `You are currently discussing this student. Use ONLY this data (numbers may be masked — if a value is masked or absent, say it's restricted; never invent facts):\n${JSON.stringify(context)}`
      : "No student is loaded yet.",
    "If the manager's message can be answered about the current student, call answer() with a natural 1–2 sentence spoken reply.",
    "If the manager is naming a different or not-yet-loaded student (a person and/or a class), call lookup() with the name and class you heard.",
  ].join("\n\n");

  const msg = await llm().messages.create({
    model: MODEL,
    max_tokens: 500,
    system,
    tools: [
      { name: "answer", description: "Speak the answer about the current student.", input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
      { name: "lookup", description: "Look up a (different) student by name and, if given, class.", input_schema: { type: "object", properties: { name: { type: "string" }, className: { type: ["string", "null"] } }, required: ["name"] } },
    ],
    tool_choice: { type: "any" },
    messages: [{ role: "user", content: question }],
  });
  const tu: any = msg.content.find((c: any) => c.type === "tool_use");
  if (!tu) return { action: "answer", text: "Sorry, I didn't catch that — could you say it again?" };
  if (tu.name === "lookup") return { action: "lookup", name: String(tu.input?.name || "").trim(), className: tu.input?.className || null };
  return { action: "answer", text: String(tu.input?.text || "").trim() || "I don't have that information." };
}

function disambiguationSpeech(name: string, className: string | null, cands: any[]): string {
  const list = cands.map((c) => `${c.name}${c.rollNumber != null ? `, roll ${c.rollNumber}` : ""}${c.admissionNumber ? `, admission ${c.admissionNumber}` : ""}`).join("; ");
  return `There are ${cands.length} students named ${name}${className ? ` in ${className}` : ""}: ${list}. Which one?`;
}

export async function ask(auth: AskAuth, schoolId: string, input: AskInput): Promise<AskResult> {
  // Explicit student pick (from a disambiguation list): load + answer directly.
  if (input.studentId) {
    const ctx = await loadContext(auth, schoolId, { uuid: input.studentId });
    const a = await route(input.question || "Give me a summary", ctx);
    const speech = a.action === "answer" ? a.text : `This is ${ctx.name}, class ${ctx.className || "unknown"}.`;
    return { speech, card: ctx, context: ctx };
  }

  const context = input.context || null;
  const r = await route(input.question, context);

  if (r.action === "answer") {
    return { speech: r.text, context };
  }

  // lookup a (new) student
  if (!r.name) return { speech: "Which student would you like to know about? Please say the name and class.", context };
  const resolved = await resolveStudent(auth, schoolId, r.name, r.className);
  if (resolved.status === "none") {
    return { speech: `I couldn't find a student named ${r.name}${r.className ? ` in class ${r.className}` : ""}.`, context: null };
  }
  if (resolved.status === "many") {
    return {
      speech: disambiguationSpeech(r.name, r.className, resolved.candidates),
      needsDisambiguation: true,
      candidates: resolved.candidates.map((c) => ({ studentId: c.uuid, name: c.name, className: c.className || null, roll: c.rollNumber ?? null, admissionNumber: c.admissionNumber || null })),
      context: null,
    };
  }

  const ctx = await loadContext(auth, schoolId, resolved.student);
  const answer = await route(input.question, ctx);
  const speech = answer.action === "answer" ? answer.text : `This is ${ctx.name}, class ${ctx.className || "unknown"}.`;
  return { speech, card: ctx, context: ctx };
}
