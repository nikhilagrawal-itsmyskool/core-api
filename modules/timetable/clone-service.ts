import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import {
  ClassSubject,
  TeachingAssignment,
  ElectiveBand,
  CloneClassSetupRequest,
  CloneClassSetupResult,
} from "./timetable-interfaces";
import { DEFAULTS } from "./timetable-constants";
import { toJsonb } from "./timetable-util";
import { classSubjectService } from "./class-subject-service";
import { teachingAssignmentService } from "./teaching-assignment-service";
import { electiveService } from "./elective-service";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

class CloneService {
  // Deep-copy a section's academic setup onto another section in the same year.
  // The class teacher is intentionally NOT copied — it is the piece that differs
  // between sections, so the admin sets it on the target (which may already be set
  // before cloning). Refuses if the target already has cloneable setup.
  public async cloneClassSetup(
    data: CloneClassSetupRequest,
    schoolId: string,
    userId: string,
  ): Promise<CloneClassSetupResult> {
    const { sourceClassId, targetClassId, academicYearId } = data;
    if (sourceClassId === targetClassId) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "Source and target sections must be different",
      );
    }

    // Reject when the target already has any active setup for this year.
    const existing = await this.countSetup(
      schoolId,
      targetClassId,
      academicYearId,
    );
    if (existing > 0) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "The target section already has timetable setup for this year. Clear it before cloning.",
      );
    }

    // Read everything from the source section.
    const classSubjects: ClassSubject[] = await classSubjectService.list(
      schoolId,
      sourceClassId,
      academicYearId,
    );
    const assignments: TeachingAssignment[] =
      await teachingAssignmentService.list(
        schoolId,
        sourceClassId,
        undefined,
        academicYearId,
      );
    const bands: ElectiveBand[] = await electiveService.listBands(
      schoolId,
      sourceClassId,
      academicYearId,
    );

    if (
      classSubjects.length === 0 &&
      assignments.length === 0 &&
      bands.length === 0
    ) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "The source section has no timetable setup to clone",
      );
    }

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    for (const cs of classSubjects) {
      queries.push(singleLineString`
        insert into class_subject
        (uuid, school_id, academic_year_id, class_id, subject_id, periods_per_week, block_rules, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `);
      params.push([
        generateShortUuid(12),
        schoolId,
        academicYearId,
        targetClassId,
        cs.subjectId,
        cs.periodsPerWeek,
        toJsonb(cs.blockRules),
        DEFAULTS.STATUS,
        userId,
        now,
      ]);
    }

    for (const ta of assignments) {
      queries.push(singleLineString`
        insert into teaching_assignment
        (uuid, school_id, academic_year_id, class_id, subject_id, teacher_id, period_share, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `);
      params.push([
        generateShortUuid(12),
        schoolId,
        academicYearId,
        targetClassId,
        ta.subjectId,
        ta.teacherId,
        ta.periodShare ?? null,
        DEFAULTS.STATUS,
        userId,
        now,
      ]);
    }

    let electiveOfferings = 0;
    for (const band of bands) {
      const newBandId = generateShortUuid(12);
      queries.push(singleLineString`
        insert into elective_band
        (uuid, school_id, academic_year_id, class_id, name, periods_per_week, block_rules, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `);
      params.push([
        newBandId,
        schoolId,
        academicYearId,
        targetClassId,
        band.name,
        band.periodsPerWeek,
        toJsonb(band.blockRules),
        DEFAULTS.STATUS,
        userId,
        now,
      ]);
      for (const off of band.offerings || []) {
        queries.push(singleLineString`
          insert into elective_offering
          (uuid, school_id, band_id, subject_id, teacher_id, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8)
        `);
        params.push([
          generateShortUuid(12),
          schoolId,
          newBandId,
          off.subjectId,
          off.teacherId,
          DEFAULTS.STATUS,
          userId,
          now,
        ]);
        electiveOfferings++;
      }
    }

    await DB.queriesInTransaction(queries, params);

    return {
      classSubjects: classSubjects.length,
      teachingAssignments: assignments.length,
      electiveBands: bands.length,
      electiveOfferings,
    };
  }

  // Count active cloneable setup rows for a section in a year. The class teacher
  // is excluded: it is not cloned, and a target may legitimately already have one.
  private async countSetup(
    schoolId: string,
    classId: string,
    academicYearId: string,
  ): Promise<number> {
    const results = await DB.query(
      singleLineString`
        select
          (select count(*) from class_subject where school_id = $1 and class_id = $2 and academic_year_id = $3 and status = 'active')
        + (select count(*) from teaching_assignment where school_id = $1 and class_id = $2 and academic_year_id = $3 and status = 'active')
        + (select count(*) from elective_band where school_id = $1 and class_id = $2 and academic_year_id = $3 and status = 'active')
        as total
      `,
      [schoolId, classId, academicYearId],
    );
    return Number(results[0]?.total ?? 0);
  }
}

export const cloneService = new CloneService();
