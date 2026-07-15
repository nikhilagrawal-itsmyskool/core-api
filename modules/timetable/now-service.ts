import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { HappeningNow, HappeningSlot } from "./timetable-interfaces";
import { seasonService } from "./season-service";
import { localParts, timeToMinutes, pickNowNext } from "./now-util";

type TimedSlot = HappeningSlot & { startMin: number | null; endMin: number | null };

// "What's happening now" for a class: resolve its active published master, the
// active season's bell times for the current weekday, and the slot bracketing the
// school-local moment (plus the next one). Structure comes from the grid config;
// times come from the season overlay (falling back to each slot's base time).
class NowService {
  public async happeningNow(
    schoolId: string,
    classId: string,
    atIso?: string,
  ): Promise<HappeningNow> {
    const at = atIso ? new Date(atIso) : new Date();
    if (isNaN(at.getTime())) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "`at` must be a valid ISO date-time",
      );
    }
    const { dateStr, dayOfWeek, minutes } = localParts(at);
    const base: HappeningNow = {
      classId,
      at: at.toISOString(),
      localDate: dateStr,
      dayOfWeek,
      seasonId: null,
      seasonName: null,
      now: null,
      next: null,
    };

    const master = await this.resolveMasterForClass(schoolId, classId, dateStr);
    if (!master) {
      return { ...base, note: "No published timetable for this class" };
    }

    const season = await seasonService.resolveActiveSeason(schoolId, dateStr);
    base.seasonId = season?.seasonId ?? null;
    base.seasonName = season?.seasonName ?? null;

    const slots = await this.daySlots(
      schoolId,
      master.configId,
      dayOfWeek,
      season?.seasonId ?? null,
    );
    if (slots.length === 0) {
      return { ...base, note: "No school scheduled for this day" };
    }

    const entriesBySlot = await this.classEntriesBySlot(
      schoolId,
      master.publishedTimetableId,
      classId,
      dayOfWeek,
    );

    const timed: TimedSlot[] = slots.map((s: any) => ({
      timeSlotId: s.uuid,
      sequence: s.sequence,
      slotType: s.slotType,
      label: s.label ?? null,
      startTime: s.startTime ?? null,
      endTime: s.endTime ?? null,
      entries: entriesBySlot.get(s.uuid) ?? [],
      startMin: timeToMinutes(s.startTime),
      endMin: timeToMinutes(s.endTime),
    }));

    // Current = the slot bracketing now; next = the first slot to start after now
    // (so it's meaningful during gaps and before school).
    const { nowIdx, nextIdx } = pickNowNext(timed, minutes);
    return {
      ...base,
      now: nowIdx >= 0 ? this.strip(timed[nowIdx]) : null,
      next: nextIdx >= 0 ? this.strip(timed[nextIdx]) : null,
    };
  }

  private strip(s: TimedSlot | null): HappeningSlot | null {
    if (!s) return null;
    return {
      timeSlotId: s.timeSlotId,
      sequence: s.sequence,
      slotType: s.slotType,
      label: s.label,
      startTime: s.startTime,
      endTime: s.endTime,
      entries: s.entries,
    };
  }

  // The active master in effect on `localDate` that actually contains this class
  // (whole-school or the wing it belongs to), plus the grid config its entries
  // reference. A master effective in the future isn't "now" yet; among those in
  // effect, the latest effective_from wins, then the most recently published.
  private async resolveMasterForClass(
    schoolId: string,
    classId: string,
    localDate: string,
  ): Promise<{ publishedTimetableId: string; configId: string } | null> {
    const pt = await DB.query(
      singleLineString`
        select pt.uuid from published_timetable pt
        where pt.school_id = $1 and pt.status = 'active'
          and (pt.effective_from is null or pt.effective_from <= $3::date)
          and exists (
            select 1 from published_entry pe
            where pe.published_timetable_id = pt.uuid and pe.class_id = $2
          )
        order by pt.effective_from desc nulls last, pt.created_at desc
        limit 1
      `,
      [schoolId, classId, localDate],
    );
    if (pt.length === 0) return null;
    const publishedTimetableId = pt[0].uuid;

    const cfg = await DB.query(
      singleLineString`
        select ds.config_id from published_entry pe
        join time_slot ts on ts.uuid = pe.time_slot_id
        join day_structure ds on ds.uuid = ts.day_structure_id
        where pe.published_timetable_id = $1 and pe.class_id = $2 and pe.school_id = $3
        limit 1
      `,
      [publishedTimetableId, classId, schoolId],
    );
    if (cfg.length === 0) return null;
    return { publishedTimetableId, configId: cfg[0].configId };
  }

  // All slots of the given config's weekday, with the season's time override
  // applied (coalesced onto each slot's base time). seasonId null => base times.
  private async daySlots(
    schoolId: string,
    configId: string,
    dayOfWeek: number,
    seasonId: string | null,
  ): Promise<any[]> {
    return DB.query(
      singleLineString`
        select ts.uuid, ts.sequence, ts.slot_type, ts.label,
               coalesce(sst.start_time, ts.start_time) as start_time,
               coalesce(sst.end_time, ts.end_time) as end_time
        from day_structure ds
        join time_slot ts on ts.day_structure_id = ds.uuid
        left join season_slot_time sst
          on sst.time_slot_id = ts.uuid and sst.season_id = $4
        where ds.config_id = $1 and ds.day_of_week = $2 and ds.school_id = $3
        order by ts.sequence
      `,
      [configId, dayOfWeek, schoolId, seasonId],
    );
  }

  // Class entries for the weekday, grouped by slot (several rows share a slot for
  // an elective band; assembly/break/lunch have none).
  private async classEntriesBySlot(
    schoolId: string,
    publishedTimetableId: string,
    classId: string,
    dayOfWeek: number,
  ): Promise<Map<string, HappeningSlot["entries"]>> {
    const rows = await DB.query(
      singleLineString`
        select pe.time_slot_id, pe.subject_id, pe.teacher_id,
               s.name as subject_name, e.name as teacher_name
        from published_entry pe
        left join subject s on s.uuid = pe.subject_id
        left join employee e on e.uuid = pe.teacher_id and e.school_id = pe.school_id
        where pe.published_timetable_id = $1 and pe.class_id = $2
          and pe.day_of_week = $3 and pe.school_id = $4
      `,
      [publishedTimetableId, classId, dayOfWeek, schoolId],
    );
    const map = new Map<string, HappeningSlot["entries"]>();
    for (const r of rows) {
      const list = map.get(r.timeSlotId) ?? [];
      list.push({
        subjectId: r.subjectId ?? null,
        subjectName: r.subjectName ?? null,
        teacherId: r.teacherId ?? null,
        teacherName: r.teacherName ?? null,
      });
      map.set(r.timeSlotId, list);
    }
    return map;
  }
}

export const nowService = new NowService();
