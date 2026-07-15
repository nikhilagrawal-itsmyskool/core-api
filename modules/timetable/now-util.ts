// Pure, DB-free time helpers for the "happening now" resolver, so the fiddly bits
// (timezone math, slot bracketing) are unit-testable without a server.

// School timezone. India-only for now (no DST); promote to a per-school setting if
// the product ever leaves IST. Kept here as the single source of truth.
export const SCHOOL_TZ_OFFSET_MIN = 5 * 60 + 30; // Asia/Kolkata = UTC+5:30

// Read an instant as school-local wall-clock by shifting into the TZ, then using
// the UTC getters (which then report local values).
export function localParts(
  at: Date,
  offsetMin = SCHOOL_TZ_OFFSET_MIN,
): { dateStr: string; dayOfWeek: number; minutes: number } {
  const shifted = new Date(at.getTime() + offsetMin * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth() + 1;
  const d = shifted.getUTCDate();
  const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const jsDow = shifted.getUTCDay(); // 0=Sun..6=Sat
  const dayOfWeek = jsDow === 0 ? 7 : jsDow; // 1=Mon..7=Sun
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  return { dateStr, dayOfWeek, minutes };
}

// A pg `time` column arrives as "HH:MM:SS". Convert to minutes-of-day, or null.
export function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const parts = String(t).split(":");
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] ?? "0", 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

export interface SlotMinutes {
  startMin: number | null;
  endMin: number | null;
}

// From slots ordered by sequence, pick the one bracketing `minutes` ([start,end))
// and the next one to start after `minutes`. -1 = none (before/after school, gaps,
// or slots without configured times). Later matches win the "now" slot so that a
// zero-length/edge overlap resolves to the latest applicable slot.
export function pickNowNext(
  slots: SlotMinutes[],
  minutes: number,
): { nowIdx: number; nextIdx: number } {
  let nowIdx = -1;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s.startMin != null && s.endMin != null && minutes >= s.startMin && minutes < s.endMin) {
      nowIdx = i;
    }
  }
  let nextIdx = -1;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].startMin != null && (slots[i].startMin as number) > minutes) {
      nextIdx = i;
      break;
    }
  }
  return { nowIdx, nextIdx };
}
