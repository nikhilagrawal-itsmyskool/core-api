#!/usr/bin/env node
/**
 * Upload the REAL assembly CHECKLIST + GRADING RUBRIC for the Morning Meridian,
 * transcribed from the source docs:
 *   - "House Execution Quality Check List.docx"  -> checklist items (3 phases)
 *   - "Comprehensive Grading Log.docx"           -> rubric metrics + penalties + scaling
 *
 * Config-only: it clears any existing checklist/rubric for the school and writes
 * these. No houses/roster/grades/logins. Idempotent (re-runnable). Reuses the
 * same API-call pattern proven by scripts/seed-house-demo.js.
 *
 * NOTE: the rubric metric/penalty model carries only a `name`, so each doc's
 * detailed "Metrics:" criteria are condensed into a short parenthetical; the
 * full wording lives in the source doc.
 *
 * Usage (LOCAL):  node scripts/seed-assembly-grading.js
 * Usage (PROD):   SCHOOL_CODE=DBPASN GATEWAY=https://api-prod.itsmyskool.com \
 *                 node scripts/seed-assembly-grading.js
 */
const SCHOOL_CODE = process.env.SCHOOL_CODE || 'SS1';
const GATEWAY = (process.env.GATEWAY || 'http://localhost:3000').replace(/\/$/, '');

async function req(method, url, body) {
  const res = await fetch(`${GATEWAY}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-School-Code': SCHOOL_CODE },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (res.status >= 400) {
    const msg = json?.error?.description || text || res.statusText;
    throw new Error(`${method} ${url} → ${res.status}: ${msg}`);
  }
  return json;
}
const A = (m, p, b) => req(m, `/assembly${p}`, b);

// ── Checklist (House Execution Quality Check List) ─────────────────────────────
// Phase 1 = pre-week deadlines -> once per week. Phases 2 & 3 = on the ground -> per day.
const CHECKLIST = [
  { phase: 'Phase 1: Advance Planning & Verifications', scope: 'week', text: 'Wednesday (before 2:00 PM): Advance Roster Sheet submitted to the Coordinator with all student speakers, choir members, and anchors explicitly locked.' },
  { phase: 'Phase 1: Advance Planning & Verifications', scope: 'week', text: 'Thursday (before 4:00 PM): Written scripts for Anchoring, Word/Phrase, Perspective 360, and Calendar Chronicles verified for grammar and pronunciation.' },
  { phase: 'Phase 1: Advance Planning & Verifications', scope: 'week', text: 'Friday (Zero-Period Technical Rehearsal): On-stage walkthrough with anchors — mic handovers, stage transitions, and cue management timed to ensure ZERO dead air.' },

  { phase: 'Phase 2: Daily On-Ground Time & Posture', scope: 'day', text: '07:45 AM (ERP Birthday Sync): House Representative has cross-checked the school ERP database for correct birthday entries of the day to eliminate manual errors.' },
  { phase: 'Phase 2: Daily On-Ground Time & Posture', scope: 'day', text: '07:52 AM (Audio & Choir Lineup): Main podium mics active, instrumentalists (Tabla/Casio) tuned, and vocal choir assembled at their corridor entry points.' },
  { phase: 'Phase 2: Daily On-Ground Time & Posture', scope: 'day', text: '07:55 AM Sharp (The Corridor March): Corridor Song March initiated exactly on time — proper marching cadence, strict silence, and zero lineup shuffling.' },
  { phase: 'Phase 2: Daily On-Ground Time & Posture', scope: 'day', text: '08:00 AM Sharp (The Harmonic Dawn): Choir synchronization takes over the ground sound system; correct Sanskrit pronunciation ensured in Pratah Smaran.' },

  { phase: 'Phase 3: Critical Compliance & Penalty Audits', scope: 'day', text: 'Strict Zero-Prop Rule: No physical charts, makeup, heavy costumes, or cardboard cutouts — focus must strictly remain on vocal and physical talent.' },
  { phase: 'Phase 3: Critical Compliance & Penalty Audits', scope: 'day', text: '20-Minute Stopwatch Cap: Entire assembly flow fits between 07:55 AM (corridor exit) and 08:15 AM (ground dismissal) to avoid the -3 time-drag penalty.' },
  { phase: 'Phase 3: Critical Compliance & Penalty Audits', scope: 'day', text: 'Podium/Backstage Silence: Student volunteers deployed to ensure complete discipline, reverence, and straight posture during the National Anthem.' },
];

// ── Rubric (Comprehensive Grading Log) — 7 metrics ×5 = 35, flat −5 scaling ────
const METRICS = [
  { name: 'Block I – The Harmonic Dawn (07:55 corridor march cadence, choir sync, instrument pitch, Sanskrit diction)', maxMarks: 5 },
  { name: 'Block II – The Core Foundations (Pledge loudness & posture, thought clarity, Newsroom confidence, neutral accent)', maxMarks: 5 },
  { name: 'Block III – Expressions Horizon: Lingua & Mentis (Word/Phrase value-add, Knowledge Hub depth, grammatical reasoning)', maxMarks: 5 },
  { name: 'Block IV – Expressions Horizon: Stage Spectrum / Skill Skylines (delivery, body language, audience connect, zero-prop)', maxMarks: 5 },
  { name: 'Block V – The Day’s Spotlight (Calendar Chronicles accuracy, personality tributes, ERP birthday execution)', maxMarks: 5 },
  { name: 'Block VI – The Wisdom Compass (dignified Mentor/Guest intros, silent transitions, Anthem reverence & posture)', maxMarks: 5 },
  { name: 'Ground Discipline, Diction & Pacing (seamless mic-switching, no dead air, no line shuffling, anchor diction)', maxMarks: 5 },
];
const PENALTIES = [
  { name: 'Zero-Prop Violation (external costumes, heavy charts, physical models, or makeup)', value: 5 },
  { name: 'Time Drag Over 20-Mins (07:55 AM corridor march → 08:15 AM dismissal exceeded)', value: 3 },
  { name: 'Backstage Indiscipline (noise, chaos, or delayed mic handovers during transitions)', value: 2 },
  { name: 'Missing Script / No Prior Sign-off (scripts not verified by the Wed/Thu deadline)', value: 2 },
];
const SCALING_ADJUSTMENT = -5; // "Standard Scaling Factor (B): -5 MARKS flat reduction"

async function main() {
  console.log(`\nSchool=${SCHOOL_CODE}  gateway=${GATEWAY}\n`);

  // Checklist: clear then create.
  for (const it of ((await A('GET', '/checklist/items')).items || [])) await A('DELETE', `/checklist/items/${it.uuid}`);
  for (const it of CHECKLIST) await A('POST', '/checklist/items', it);
  const wk = CHECKLIST.filter((c) => c.scope === 'week').length;
  const dy = CHECKLIST.filter((c) => c.scope === 'day').length;
  console.log(`✓ checklist: ${CHECKLIST.length} items (${wk} week-scope, ${dy} day-scope) across 3 phases`);

  // Rubric: clear metrics + penalties, then create; set scaling.
  const rub = await A('GET', '/rubric');
  for (const m of rub.metrics || []) await A('DELETE', `/rubric/metrics/${m.uuid}`);
  for (const p of rub.penalties || []) await A('DELETE', `/rubric/penalties/${p.uuid}`);
  for (const m of METRICS) await A('POST', '/rubric/metrics', m);
  for (const p of PENALTIES) await A('POST', '/rubric/penalties', p);
  await A('PUT', '/rubric/config', { scalingAdjustment: SCALING_ADJUSTMENT });
  const maxScore = METRICS.reduce((s, m) => s + m.maxMarks, 0);
  console.log(`✓ rubric: ${METRICS.length} metrics (max ${maxScore}), ${PENALTIES.length} penalties, ${SCALING_ADJUSTMENT} scaling → ${maxScore + SCALING_ADJUSTMENT} running max`);

  console.log(`\n🎉 Checklist + grading rubric uploaded for ${SCHOOL_CODE}.\n`);
}

main().catch((e) => { console.error('\n✗ Failed:', e.message); process.exit(1); });
