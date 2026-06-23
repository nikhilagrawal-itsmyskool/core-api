import { DB, singleLineString } from "../../shared/lib/db";
import { LANGUAGE_LETTER } from "./library-constants";
import { Language } from "./library-constants";

// Local call number = `{CUTTER}-{DDC}-{E|H|B}` (e.g. KAL-954.04-E).
// Cutter (work-level, 3 Roman letters) and DDC are language-independent; the
// trailing letter comes from the title's language. Auto-generated and editable.
class CallnoService {
  public generate(
    cutter: string | undefined,
    ddcNumber: string | undefined,
    language: Language,
  ): string {
    const parts: string[] = [];
    if (cutter && cutter.trim()) parts.push(cutter.trim().toUpperCase());
    if (ddcNumber && ddcNumber.trim()) parts.push(ddcNumber.trim());
    const letter = LANGUAGE_LETTER[language];
    const base = parts.join("-");
    return letter ? (base ? `${base}-${letter}` : letter) : base;
  }

  // Returns titles (other works) that already use this local call number, so the
  // caller can warn about a collision. Same-work titles are excluded (copies /
  // other-language editions legitimately share the cutter+ddc base).
  public async findCollisions(
    localCallNo: string,
    schoolId: string,
    excludeWorkId?: string,
  ): Promise<any[]> {
    if (!localCallNo || !localCallNo.trim()) return [];
    const params: any[] = [schoolId, localCallNo.trim().toLowerCase()];
    let sql = singleLineString`
      select t.uuid as title_id, t.work_id, t.title_as_printed, t.local_call_no
      from library_title t
      where t.school_id = $1 and lower(t.local_call_no) = $2 and t.status = 'active'
    `;
    if (excludeWorkId) {
      params.push(excludeWorkId);
      sql += ` and t.work_id <> $3`;
    }
    return DB.query(sql, params);
  }
}

export const callnoService = new CallnoService();
