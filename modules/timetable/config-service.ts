import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import {
  TimetableConfig,
  DayStructure,
  TimeSlot,
  CreateConfigRequest,
  UpdateConfigRequest,
  CreateDayStructureRequest,
  UpdateDayStructureRequest,
  CreateTimeSlotRequest,
  UpdateTimeSlotRequest,
} from "./timetable-interfaces";
import { DEFAULTS } from "./timetable-constants";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

// The grid: a timetable_config holds day_structures, each holding ordered
// time_slots. Configs are soft-archived (status active|archived). Days and slots
// have no status column, so they are hard-deleted (with app-level cascade).
class ConfigService {
  // ----- config -----
  public async listConfigs(
    schoolId: string,
    academicYearId?: string,
  ): Promise<TimetableConfig[]> {
    const params: any[] = [schoolId];
    let where = `school_id = $1`;
    if (academicYearId) {
      params.push(academicYearId);
      where += ` and academic_year_id = $${params.length}`;
    }
    return DB.query(
      singleLineString`select * from timetable_config where ${where} order by created_at desc`,
      params,
    );
  }

  public async getConfigById(
    id: string,
    schoolId: string,
  ): Promise<TimetableConfig | null> {
    const results = await DB.query(
      singleLineString`select * from timetable_config where uuid = $1 and school_id = $2`,
      [id, schoolId],
    );
    if (results.length === 0) return null;
    const config: TimetableConfig = results[0];
    config.days = await this.listDays(id, schoolId);
    return config;
  }

  public async createConfig(
    data: CreateConfigRequest,
    schoolId: string,
    userId: string,
  ): Promise<TimetableConfig> {
    const results = await DB.query(
      singleLineString`
        insert into timetable_config
        (uuid, school_id, academic_year_id, name, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7)
        returning *
      `,
      [
        generateShortUuid(12),
        schoolId,
        data.academicYearId,
        data.name.trim(),
        DEFAULTS.STATUS,
        userId,
        new Date(),
      ],
    );
    return results[0];
  }

  public async updateConfig(
    id: string,
    data: UpdateConfigRequest,
    schoolId: string,
    userId: string,
  ): Promise<TimetableConfig | null> {
    const existing = await DB.query(
      singleLineString`select * from timetable_config where uuid = $1 and school_id = $2`,
      [id, schoolId],
    );
    if (existing.length === 0) return null;
    const name = data.name !== undefined ? data.name.trim() : existing[0].name;
    const status = data.status !== undefined ? data.status : existing[0].status;
    await DB.query(
      singleLineString`
        update timetable_config
        set name = $1, status = $2, updatedby_userid = $3, updated_at = $4
        where uuid = $5 and school_id = $6
      `,
      [name, status, userId, new Date(), id, schoolId],
    );
    return this.getConfigById(id, schoolId);
  }

  public async archiveConfig(
    id: string,
    schoolId: string,
    userId: string,
  ): Promise<void> {
    await DB.query(
      singleLineString`
        update timetable_config
        set status = 'archived', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4
      `,
      [userId, new Date(), id, schoolId],
    );
  }

  public async configExists(id: string, schoolId: string): Promise<boolean> {
    const r = await DB.query(
      singleLineString`select 1 from timetable_config where uuid = $1 and school_id = $2 limit 1`,
      [id, schoolId],
    );
    return r.length > 0;
  }

  // ----- lock lifecycle -----

  // True once any generation run has used this config (so it can no longer unlock).
  public async isUsedInGeneration(
    configId: string,
    schoolId: string,
  ): Promise<boolean> {
    const r = await DB.query(
      singleLineString`select 1 from generation_run where config_id = $1 and school_id = $2 limit 1`,
      [configId, schoolId],
    );
    return r.length > 0;
  }

  // Throws when the config is locked. Structural edits (days/slots) call this so a
  // generated/published grid can never be mutated underneath its timetables.
  private async assertEditable(
    configId: string,
    schoolId: string,
  ): Promise<void> {
    const rows = await DB.query(
      singleLineString`select locked_at from timetable_config where uuid = $1 and school_id = $2`,
      [configId, schoolId],
    );
    if (rows.length > 0 && rows[0].lockedAt) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "This config is locked; clone it to make changes.",
      );
    }
  }

  private async assertDayEditable(
    dayStructureId: string,
    schoolId: string,
  ): Promise<void> {
    const day = await this.getDayById(dayStructureId, schoolId);
    if (day) await this.assertEditable(day.configId, schoolId);
  }

  private async assertSlotEditable(
    slotId: string,
    schoolId: string,
  ): Promise<void> {
    const slot = await this.getSlotById(slotId, schoolId);
    if (slot) await this.assertDayEditable(slot.dayStructureId, schoolId);
  }

  // Lock a draft config (no-op if already locked). Only locked configs can generate.
  public async lock(
    id: string,
    schoolId: string,
    userId: string,
  ): Promise<TimetableConfig | null> {
    const existing = await DB.query(
      singleLineString`select 1 from timetable_config where uuid = $1 and school_id = $2`,
      [id, schoolId],
    );
    if (existing.length === 0) return null;
    await DB.query(
      singleLineString`
        update timetable_config
        set locked_at = $1, lockedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5 and locked_at is null
      `,
      [new Date(), userId, new Date(), id, schoolId],
    );
    return this.getConfigById(id, schoolId);
  }

  // Unlock — allowed only while the config has not been used to generate.
  public async unlock(
    id: string,
    schoolId: string,
    userId: string,
  ): Promise<TimetableConfig | null> {
    const existing = await DB.query(
      singleLineString`select 1 from timetable_config where uuid = $1 and school_id = $2`,
      [id, schoolId],
    );
    if (existing.length === 0) return null;
    if (await this.isUsedInGeneration(id, schoolId)) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "This config has been used to generate timetables and can no longer be unlocked — clone it instead.",
      );
    }
    await DB.query(
      singleLineString`
        update timetable_config
        set locked_at = null, lockedby_userid = null, updated_at = $1
        where uuid = $2 and school_id = $3
      `,
      [new Date(), id, schoolId],
    );
    return this.getConfigById(id, schoolId);
  }

  // Deep-copy a config (its days + slots) into a new draft, so a locked config can
  // be revised by editing the clone. New uuids throughout; not locked.
  public async clone(
    id: string,
    schoolId: string,
    userId: string,
    name?: string,
  ): Promise<TimetableConfig | null> {
    const source = await this.getConfigById(id, schoolId); // includes days + slots
    if (!source) return null;
    const now = new Date();
    const newConfigId = generateShortUuid(12);
    const queries: string[] = [];
    const params: any[][] = [];

    queries.push(singleLineString`
      insert into timetable_config
      (uuid, school_id, academic_year_id, name, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7)
    `);
    params.push([
      newConfigId,
      schoolId,
      source.academicYearId,
      (name && name.trim()) || `Copy of ${source.name}`,
      DEFAULTS.STATUS,
      userId,
      now,
    ]);

    for (const day of source.days ?? []) {
      const newDayId = generateShortUuid(12);
      queries.push(singleLineString`
        insert into day_structure
        (uuid, school_id, config_id, day_of_week, label, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7)
      `);
      params.push([
        newDayId,
        schoolId,
        newConfigId,
        day.dayOfWeek,
        day.label ?? null,
        userId,
        now,
      ]);
      for (const slot of day.slots ?? []) {
        queries.push(singleLineString`
          insert into time_slot
          (uuid, school_id, day_structure_id, sequence, start_time, end_time, slot_type, label, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `);
        params.push([
          generateShortUuid(12),
          schoolId,
          newDayId,
          slot.sequence,
          slot.startTime ?? null,
          slot.endTime ?? null,
          slot.slotType,
          slot.label ?? null,
          userId,
          now,
        ]);
      }
    }

    await DB.queriesInTransaction(queries, params);
    return this.getConfigById(newConfigId, schoolId);
  }

  // ----- day structures -----
  public async listDays(
    configId: string,
    schoolId: string,
  ): Promise<DayStructure[]> {
    const days: DayStructure[] = await DB.query(
      singleLineString`select * from day_structure where config_id = $1 and school_id = $2 order by day_of_week`,
      [configId, schoolId],
    );
    for (const day of days) {
      day.slots = await this.listSlots(day.uuid, schoolId);
    }
    return days;
  }

  public async getDayById(
    id: string,
    schoolId: string,
  ): Promise<DayStructure | null> {
    const r = await DB.query(
      singleLineString`select * from day_structure where uuid = $1 and school_id = $2`,
      [id, schoolId],
    );
    return r.length > 0 ? r[0] : null;
  }

  public async createDay(
    configId: string,
    data: CreateDayStructureRequest,
    schoolId: string,
    userId: string,
  ): Promise<DayStructure> {
    await this.assertEditable(configId, schoolId);
    const dup = await DB.query(
      singleLineString`select 1 from day_structure where config_id = $1 and day_of_week = $2 limit 1`,
      [configId, data.dayOfWeek],
    );
    if (dup.length > 0) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "This day is already configured for the config",
      );
    }
    const r = await DB.query(
      singleLineString`
        insert into day_structure
        (uuid, school_id, config_id, day_of_week, label, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7)
        returning *
      `,
      [
        generateShortUuid(12),
        schoolId,
        configId,
        data.dayOfWeek,
        data.label ?? null,
        userId,
        new Date(),
      ],
    );
    return r[0];
  }

  public async updateDay(
    id: string,
    data: UpdateDayStructureRequest,
    schoolId: string,
    userId: string,
  ): Promise<DayStructure | null> {
    const existing = await this.getDayById(id, schoolId);
    if (!existing) return null;
    await this.assertEditable(existing.configId, schoolId);
    const label =
      data.label !== undefined ? data.label : (existing.label ?? null);
    const r = await DB.query(
      singleLineString`
        update day_structure
        set label = $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5
        returning *
      `,
      [label, userId, new Date(), id, schoolId],
    );
    return r.length > 0 ? r[0] : null;
  }

  // Hard delete a day and all its slots.
  public async deleteDay(id: string, schoolId: string): Promise<void> {
    await this.assertDayEditable(id, schoolId);
    await DB.queriesInTransaction(
      [
        singleLineString`delete from time_slot where day_structure_id = $1 and school_id = $2`,
        singleLineString`delete from day_structure where uuid = $1 and school_id = $2`,
      ],
      [
        [id, schoolId],
        [id, schoolId],
      ],
    );
  }

  // ----- time slots -----
  public async listSlots(
    dayStructureId: string,
    schoolId: string,
  ): Promise<TimeSlot[]> {
    return DB.query(
      singleLineString`select * from time_slot where day_structure_id = $1 and school_id = $2 order by sequence`,
      [dayStructureId, schoolId],
    );
  }

  public async getSlotById(
    id: string,
    schoolId: string,
  ): Promise<TimeSlot | null> {
    const r = await DB.query(
      singleLineString`select * from time_slot where uuid = $1 and school_id = $2`,
      [id, schoolId],
    );
    return r.length > 0 ? r[0] : null;
  }

  public async createSlot(
    dayStructureId: string,
    data: CreateTimeSlotRequest,
    schoolId: string,
    userId: string,
  ): Promise<TimeSlot> {
    await this.assertDayEditable(dayStructureId, schoolId);
    const dup = await DB.query(
      singleLineString`select 1 from time_slot where day_structure_id = $1 and sequence = $2 limit 1`,
      [dayStructureId, data.sequence],
    );
    if (dup.length > 0) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `Sequence ${data.sequence} already exists for this day`,
      );
    }
    const r = await DB.query(
      singleLineString`
        insert into time_slot
        (uuid, school_id, day_structure_id, sequence, start_time, end_time, slot_type, label, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        returning *
      `,
      [
        generateShortUuid(12),
        schoolId,
        dayStructureId,
        data.sequence,
        data.startTime ?? null,
        data.endTime ?? null,
        data.slotType,
        data.label ?? null,
        userId,
        new Date(),
      ],
    );
    return r[0];
  }

  public async updateSlot(
    id: string,
    data: UpdateTimeSlotRequest,
    schoolId: string,
    userId: string,
  ): Promise<TimeSlot | null> {
    const existing = await this.getSlotById(id, schoolId);
    if (!existing) return null;
    await this.assertDayEditable(existing.dayStructureId, schoolId);

    if (data.sequence !== undefined && data.sequence !== existing.sequence) {
      const dup = await DB.query(
        singleLineString`select 1 from time_slot where day_structure_id = $1 and sequence = $2 and uuid <> $3 limit 1`,
        [existing.dayStructureId, data.sequence, id],
      );
      if (dup.length > 0) {
        throw new BusinessErrorResult(
          ErrorCode.BusinessError,
          `Sequence ${data.sequence} already exists for this day`,
        );
      }
    }

    const sequence =
      data.sequence !== undefined ? data.sequence : existing.sequence;
    const startTime =
      data.startTime !== undefined
        ? data.startTime
        : (existing.startTime ?? null);
    const endTime =
      data.endTime !== undefined ? data.endTime : (existing.endTime ?? null);
    const slotType =
      data.slotType !== undefined ? data.slotType : existing.slotType;
    const label =
      data.label !== undefined ? data.label : (existing.label ?? null);

    const r = await DB.query(
      singleLineString`
        update time_slot
        set sequence = $1, start_time = $2, end_time = $3, slot_type = $4, label = $5, updatedby_userid = $6, updated_at = $7
        where uuid = $8 and school_id = $9
        returning *
      `,
      [
        sequence,
        startTime,
        endTime,
        slotType,
        label,
        userId,
        new Date(),
        id,
        schoolId,
      ],
    );
    return r.length > 0 ? r[0] : null;
  }

  public async deleteSlot(id: string, schoolId: string): Promise<void> {
    await this.assertSlotEditable(id, schoolId);
    await DB.query(
      singleLineString`delete from time_slot where uuid = $1 and school_id = $2`,
      [id, schoolId],
    );
  }
}

export const configService = new ConfigService();
