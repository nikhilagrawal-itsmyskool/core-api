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
      select uuid, school_id, code, name, motto, philosophy, status
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
}

export const programmeService = new ProgrammeService();
