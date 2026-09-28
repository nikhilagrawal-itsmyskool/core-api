import { DB, singleLineString } from "../../shared/lib/db";
import {
  Programme,
  FieldType,
  MaterialType,
  Domain,
  Skill,
  Stage,
} from "./programmes-interfaces";

// Resolve a programme by code within a school, or null. Shared by the unit and
// source services (no FKs — code is the stable external handle).
export async function getProgrammeByCode(
  schoolId: string,
  code: string,
): Promise<Programme | null> {
  const rows = await DB.query(
    singleLineString`
      select uuid, school_id, code, name, motto, philosophy, teacher_guidance, status
      from programme where school_id = $1 and lower(code) = lower($2) and status = 'active'
    `,
    [schoolId, code],
  );
  return rows.length > 0 ? rows[0] : null;
}

class ProgrammeService {
  public async list(schoolId: string): Promise<Programme[]> {
    return DB.query(
      singleLineString`
        select uuid, school_id, code, name, motto, philosophy, status
        from programme where school_id = $1 and status = 'active' order by name
      `,
      [schoolId],
    );
  }

  // A programme plus its seeded masters — drives the admin editor's dropdowns
  // (field headings/order, material types, domains, skills, stages).
  public async getByCode(schoolId: string, code: string): Promise<
    | (Programme & {
        fieldTypes: FieldType[];
        materialTypes: MaterialType[];
        domains: Domain[];
        skills: Skill[];
        stages: Stage[];
      })
    | null
  > {
    const programme = await getProgrammeByCode(schoolId, code);
    if (!programme) return null;
    const pid = programme.uuid;

    const [fieldTypes, materialTypes, domains, skills, stages] =
      await Promise.all([
        DB.query(
          singleLineString`select uuid, code, name, seq from programme_field_type where programme_id = $1 and status = 'active' order by seq`,
          [pid],
        ),
        DB.query(
          singleLineString`select uuid, code, name from programme_material_type where programme_id = $1 and status = 'active' order by code`,
          [pid],
        ),
        DB.query(
          singleLineString`select uuid, code, name from programme_domain where programme_id = $1 and status = 'active' order by code`,
          [pid],
        ),
        DB.query(
          singleLineString`select uuid, category, name from programme_skill where programme_id = $1 and status = 'active' order by category, name`,
          [pid],
        ),
        DB.query(
          singleLineString`select uuid, grade, seq, developmental_band, master_focus, stage_emphasis, assessment_band from programme_stage where programme_id = $1 and status = 'active' order by seq`,
          [pid],
        ),
      ]);

    return { ...programme, fieldTypes, materialTypes, domains, skills, stages };
  }

  // Update programme-level settings (motto, philosophy, and the "how to teach this"
  // guidance bullets). God-only at the handler. Returns the updated programme or null.
  public async update(
    schoolId: string,
    code: string,
    data: { motto?: string | null; philosophy?: string | null; teacherGuidance?: string[] },
    userId: string,
  ): Promise<Programme | null> {
    const existing = await getProgrammeByCode(schoolId, code);
    if (!existing) return null;

    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;
    const set = (col: string, val: any) => {
      updates.push(`${col} = $${i++}`);
      params.push(val);
    };
    if (data.motto !== undefined) set("motto", data.motto?.trim() || null);
    if (data.philosophy !== undefined) set("philosophy", data.philosophy?.trim() || null);
    if (data.teacherGuidance !== undefined) {
      const clean = (Array.isArray(data.teacherGuidance) ? data.teacherGuidance : [])
        .map((s) => String(s).trim())
        .filter(Boolean);
      set("teacher_guidance", JSON.stringify(clean));
    }
    if (updates.length === 0) return existing;
    set("updatedby_userid", userId);
    set("updated_at", new Date());
    params.push(existing.uuid, schoolId);

    const rows = await DB.query(
      singleLineString`
        update programme set ${updates.join(", ")}
        where uuid = $${i++} and school_id = $${i++} and status = 'active'
        returning uuid, school_id, code, name, motto, philosophy, teacher_guidance, status
      `,
      params,
    );
    return rows.length > 0 ? rows[0] : null;
  }
}

export const programmeService = new ProgrammeService();
