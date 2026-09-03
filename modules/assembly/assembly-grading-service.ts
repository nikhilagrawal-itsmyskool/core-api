import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import {
  Rubric, RubricMetric, RubricPenalty, CreateRubricMetricRequest, UpdateRubricMetricRequest,
  CreateRubricPenaltyRequest, UpdateRubricPenaltyRequest, SetRubricConfigRequest,
  Evaluator, CreateEvaluatorRequest, GradeView, SaveGradeRequest, Leaderboard, LeaderboardEntry,
} from './assembly-interfaces';
import { WEEKDAY_VALUES, Weekday } from './assembly-constants';
import { isValidDate, findEmployee } from './assembly-common';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const dateInWeek = (weekStart: string, wd: Weekday) => addDays(weekStart, WEEKDAY_VALUES.indexOf(wd));
const round2 = (n: number) => Math.round(n * 100) / 100;

class AssemblyGradingService {
  // ── Rubric (metrics, penalties, config) ──────────────────────────────────────

  public async getRubric(schoolId: string): Promise<Rubric> {
    const metrics = await DB.query(singleLineString`select uuid, name, max_marks, sort_order from assembly_rubric_metric where school_id = $1 and status = 'active' order by sort_order, name`, [schoolId]);
    const penalties = await DB.query(singleLineString`select uuid, name, value, sort_order from assembly_rubric_penalty where school_id = $1 and status = 'active' order by sort_order, name`, [schoolId]);
    const cfg = await DB.query(singleLineString`select scaling_adjustment from assembly_rubric_config where school_id = $1`, [schoolId]);
    return {
      metrics: metrics.map((m: any) => ({ uuid: m.uuid, name: m.name, maxMarks: Number(m.maxMarks), sortOrder: m.sortOrder })),
      penalties: penalties.map((p: any) => ({ uuid: p.uuid, name: p.name, value: Number(p.value), sortOrder: p.sortOrder })),
      config: { scalingAdjustment: cfg.length && cfg[0].scalingAdjustment != null ? Number(cfg[0].scalingAdjustment) : undefined },
    };
  }

  public async createMetric(data: CreateRubricMetricRequest, schoolId: string, userId: string): Promise<RubricMetric> {
    if (!data.name || !data.name.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, 'name is required');
    if (!(Number(data.maxMarks) > 0)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'maxMarks must be a positive number');
    const uuid = generateShortUuid(12); const now = new Date();
    const sort = data.sortOrder ?? (await this.nextSort('assembly_rubric_metric', schoolId));
    await DB.query(singleLineString`insert into assembly_rubric_metric (uuid, school_id, name, max_marks, sort_order, status, createdby_userid, created_at) values ($1,$2,$3,$4,$5,'active',$6,$7)`, [uuid, schoolId, data.name.trim(), data.maxMarks, sort, userId, now]);
    return (await this.getRubric(schoolId)).metrics.find(m => m.uuid === uuid)!;
  }

  public async updateMetric(id: string, data: UpdateRubricMetricRequest, schoolId: string, userId: string): Promise<RubricMetric | null> {
    const u: string[] = []; const p: any[] = []; let i = 1;
    const set = (c: string, v: any) => { u.push(`${c} = $${i++}`); p.push(v); };
    if (data.name !== undefined) { if (!data.name.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, 'name cannot be blank'); set('name', data.name.trim()); }
    if (data.maxMarks !== undefined) { if (!(Number(data.maxMarks) > 0)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'maxMarks must be positive'); set('max_marks', data.maxMarks); }
    if (data.sortOrder !== undefined) set('sort_order', data.sortOrder);
    if (!u.length) return (await this.getRubric(schoolId)).metrics.find(m => m.uuid === id) || null;
    set('updatedby_userid', userId); set('updated_at', new Date()); p.push(id, schoolId);
    const r = await DB.query(singleLineString`update assembly_rubric_metric set ${u.join(', ')} where uuid = $${i++} and school_id = $${i} and status = 'active' returning uuid`, p);
    if (r.length === 0) return null;
    return (await this.getRubric(schoolId)).metrics.find(m => m.uuid === id) || null;
  }

  public async deleteMetric(id: string, schoolId: string, userId: string): Promise<boolean> {
    const r = await DB.query(singleLineString`update assembly_rubric_metric set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4 and status = 'active' returning uuid`, [userId, new Date(), id, schoolId]);
    return r.length > 0;
  }

  public async createPenalty(data: CreateRubricPenaltyRequest, schoolId: string, userId: string): Promise<RubricPenalty> {
    if (!data.name || !data.name.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, 'name is required');
    if (data.value == null || isNaN(Number(data.value))) throw new BusinessErrorResult(ErrorCode.BusinessError, 'value is required');
    const uuid = generateShortUuid(12); const now = new Date();
    const sort = data.sortOrder ?? (await this.nextSort('assembly_rubric_penalty', schoolId));
    await DB.query(singleLineString`insert into assembly_rubric_penalty (uuid, school_id, name, value, sort_order, status, createdby_userid, created_at) values ($1,$2,$3,$4,$5,'active',$6,$7)`, [uuid, schoolId, data.name.trim(), data.value, sort, userId, now]);
    return (await this.getRubric(schoolId)).penalties.find(p => p.uuid === uuid)!;
  }

  public async updatePenalty(id: string, data: UpdateRubricPenaltyRequest, schoolId: string, userId: string): Promise<RubricPenalty | null> {
    const u: string[] = []; const p: any[] = []; let i = 1;
    const set = (c: string, v: any) => { u.push(`${c} = $${i++}`); p.push(v); };
    if (data.name !== undefined) { if (!data.name.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, 'name cannot be blank'); set('name', data.name.trim()); }
    if (data.value !== undefined) { if (isNaN(Number(data.value))) throw new BusinessErrorResult(ErrorCode.BusinessError, 'value must be a number'); set('value', data.value); }
    if (data.sortOrder !== undefined) set('sort_order', data.sortOrder);
    if (!u.length) return (await this.getRubric(schoolId)).penalties.find(x => x.uuid === id) || null;
    set('updatedby_userid', userId); set('updated_at', new Date()); p.push(id, schoolId);
    const r = await DB.query(singleLineString`update assembly_rubric_penalty set ${u.join(', ')} where uuid = $${i++} and school_id = $${i} and status = 'active' returning uuid`, p);
    if (r.length === 0) return null;
    return (await this.getRubric(schoolId)).penalties.find(x => x.uuid === id) || null;
  }

  public async deletePenalty(id: string, schoolId: string, userId: string): Promise<boolean> {
    const r = await DB.query(singleLineString`update assembly_rubric_penalty set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4 and status = 'active' returning uuid`, [userId, new Date(), id, schoolId]);
    return r.length > 0;
  }

  public async setConfig(data: SetRubricConfigRequest, schoolId: string, userId: string): Promise<Rubric> {
    const now = new Date();
    const adj = data.scalingAdjustment ?? null;
    const existing = await DB.query(singleLineString`select school_id from assembly_rubric_config where school_id = $1`, [schoolId]);
    if (existing.length === 0) await DB.query(singleLineString`insert into assembly_rubric_config (school_id, scaling_adjustment, updatedby_userid, updated_at) values ($1,$2,$3,$4)`, [schoolId, adj, userId, now]);
    else await DB.query(singleLineString`update assembly_rubric_config set scaling_adjustment = $1, updatedby_userid = $2, updated_at = $3 where school_id = $4`, [adj, userId, now, schoolId]);
    return this.getRubric(schoolId);
  }

  // ── Evaluators ───────────────────────────────────────────────────────────────

  public async listEvaluators(schoolId: string): Promise<Evaluator[]> {
    const rows = await DB.query(singleLineString`select uuid, employee_id, employee_name, start_date::text as start_date, end_date::text as end_date from assembly_evaluator where school_id = $1 and status = 'active' order by created_at`, [schoolId]);
    return rows.map((r: any) => ({ uuid: r.uuid, employeeId: r.employeeId, employeeName: r.employeeName || undefined, startDate: r.startDate || undefined, endDate: r.endDate || undefined }));
  }

  public async addEvaluator(data: CreateEvaluatorRequest, schoolId: string, userId: string): Promise<Evaluator> {
    if (!data.employeeId) throw new BusinessErrorResult(ErrorCode.BusinessError, 'employeeId is required');
    const emp = await findEmployee(schoolId, data.employeeId);
    if (!emp) throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid employee: ${data.employeeId}`);
    for (const [label, d] of [['startDate', data.startDate], ['endDate', data.endDate]] as const) {
      if (d && !isValidDate(d)) throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid ${label} (yyyy-mm-dd)`);
    }
    if (data.startDate && data.endDate && data.endDate < data.startDate) throw new BusinessErrorResult(ErrorCode.BusinessError, 'endDate must be on or after startDate');
    const uuid = generateShortUuid(12); const now = new Date();
    await DB.query(singleLineString`insert into assembly_evaluator (uuid, school_id, employee_id, employee_name, start_date, end_date, status, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6,'active',$7,$8)`, [uuid, schoolId, data.employeeId, emp.name, data.startDate || null, data.endDate || null, userId, now]);
    return (await this.listEvaluators(schoolId)).find(e => e.uuid === uuid)!;
  }

  public async removeEvaluator(id: string, schoolId: string, userId: string): Promise<boolean> {
    const r = await DB.query(singleLineString`update assembly_evaluator set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4 and status = 'active' returning uuid`, [userId, new Date(), id, schoolId]);
    return r.length > 0;
  }

  // Is this employee assigned to grade on this date? (date-range membership)
  private async evaluatorAssignedFor(schoolId: string, employeeId: string, date: string): Promise<boolean> {
    const r = await DB.query(
      singleLineString`select 1 from assembly_evaluator where school_id = $1 and employee_id = $2 and status = 'active' and (start_date is null or start_date <= $3::date) and (end_date is null or end_date >= $3::date) limit 1`,
      [schoolId, employeeId, date],
    );
    return r.length > 0;
  }

  // ── Grades ───────────────────────────────────────────────────────────────────

  public async saveGrade(weekId: string, data: SaveGradeRequest, schoolId: string, userId: string): Promise<GradeView | null> {
    const week = await this.weekRow(weekId, schoolId);
    if (!week) return null;
    if (!isValidDate(data.gradeDate)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'A valid gradeDate (yyyy-mm-dd) is required');
    const dates = await this.weekDates(week.planId, schoolId, week.weekStart);
    if (!dates.includes(data.gradeDate)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'gradeDate is not an assembly day of this week');
    if (!data.evaluatorId) throw new BusinessErrorResult(ErrorCode.BusinessError, 'evaluatorId is required');
    if (!(await this.evaluatorAssignedFor(schoolId, data.evaluatorId, data.gradeDate))) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'This evaluator is not assigned to grade on that date');
    }
    const evaluator = await findEmployee(schoolId, data.evaluatorId);

    // Validate metric scores against the rubric.
    const rubric = await this.getRubric(schoolId);
    const metricById = new Map(rubric.metrics.map(m => [m.uuid, m]));
    const penaltyById = new Map(rubric.penalties.map(p => [p.uuid, p]));
    let sum = 0;
    for (const ms of data.metrics || []) {
      const m = metricById.get(ms.metricId);
      if (!m) throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid metric: ${ms.metricId}`);
      const score = Number(ms.score);
      if (isNaN(score) || score < 0 || score > m.maxMarks) throw new BusinessErrorResult(ErrorCode.BusinessError, `Score for "${m.name}" must be between 0 and ${m.maxMarks}`);
      sum += score;
    }
    const penalties = [...new Set(data.penalties || [])];
    for (const pid of penalties) {
      const pen = penaltyById.get(pid);
      if (!pen) throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid penalty: ${pid}`);
      sum -= pen.value;
    }
    const total = round2(sum + (rubric.config.scalingAdjustment ?? 0));

    const now = new Date();
    const existing = await DB.query(singleLineString`select uuid from assembly_grade where week_id = $1 and grade_date = $2 and evaluator_employee_id = $3 and status = 'active'`, [weekId, data.gradeDate, data.evaluatorId]);
    const gradeId = existing.length > 0 ? existing[0].uuid : generateShortUuid(12);

    const queries: string[] = [];
    const params: any[][] = [];
    if (existing.length > 0) {
      queries.push(singleLineString`update assembly_grade set house_id = $1, house_name = $2, evaluator_name = $3, star_presenter = $4, diction = $5, feedback = $6, total = $7, updatedby_userid = $8, updated_at = $9 where uuid = $10`);
      params.push([week.houseId ?? null, week.houseName ?? null, evaluator?.name ?? null, data.starPresenter?.trim() || null, data.diction?.trim() || null, data.feedback?.trim() || null, total, userId, now, gradeId]);
      queries.push(singleLineString`delete from assembly_grade_metric where grade_id = $1`); params.push([gradeId]);
      queries.push(singleLineString`delete from assembly_grade_penalty where grade_id = $1`); params.push([gradeId]);
    } else {
      queries.push(singleLineString`insert into assembly_grade (uuid, school_id, week_id, grade_date, house_id, house_name, evaluator_employee_id, evaluator_name, star_presenter, diction, feedback, total, status, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active',$13,$14)`);
      params.push([gradeId, schoolId, weekId, data.gradeDate, week.houseId ?? null, week.houseName ?? null, data.evaluatorId, evaluator?.name ?? null, data.starPresenter?.trim() || null, data.diction?.trim() || null, data.feedback?.trim() || null, total, userId, now]);
    }
    for (const ms of data.metrics || []) {
      queries.push(singleLineString`insert into assembly_grade_metric (uuid, grade_id, metric_id, score) values ($1,$2,$3,$4)`);
      params.push([generateShortUuid(12), gradeId, ms.metricId, Number(ms.score)]);
    }
    for (const pid of penalties) {
      queries.push(singleLineString`insert into assembly_grade_penalty (uuid, grade_id, penalty_id) values ($1,$2,$3)`);
      params.push([generateShortUuid(12), gradeId, pid]);
    }
    await DB.queriesInTransaction(queries, params);
    return this.getGrade(gradeId, schoolId);
  }

  public async listGrades(weekId: string, schoolId: string): Promise<GradeView[]> {
    const grades = await DB.query(singleLineString`select uuid from assembly_grade where week_id = $1 and school_id = $2 and status = 'active' order by grade_date, created_at`, [weekId, schoolId]);
    const out: GradeView[] = [];
    for (const g of grades) out.push((await this.getGrade(g.uuid, schoolId))!);
    return out;
  }

  // The caller's own grades for a week (one per graded day) — powers the evaluator PWA
  // read-back so a teacher can see and keep editing the marks they submitted.
  public async listMyGrades(weekId: string, evaluatorId: string, schoolId: string): Promise<GradeView[]> {
    const grades = await DB.query(singleLineString`select uuid from assembly_grade where week_id = $1 and school_id = $2 and evaluator_employee_id = $3 and status = 'active' order by grade_date, created_at`, [weekId, schoolId, evaluatorId]);
    const out: GradeView[] = [];
    for (const g of grades) out.push((await this.getGrade(g.uuid, schoolId))!);
    return out;
  }

  public async getGrade(gradeId: string, schoolId: string): Promise<GradeView | null> {
    const rows = await DB.query(singleLineString`select uuid, week_id, grade_date::text as grade_date, house_id, house_name, evaluator_employee_id, evaluator_name, star_presenter, diction, feedback, total from assembly_grade where uuid = $1 and school_id = $2 and status = 'active'`, [gradeId, schoolId]);
    if (rows.length === 0) return null;
    const g = rows[0];
    const metrics = await DB.query(singleLineString`select metric_id, score from assembly_grade_metric where grade_id = $1`, [gradeId]);
    const penalties = await DB.query(singleLineString`select penalty_id from assembly_grade_penalty where grade_id = $1`, [gradeId]);
    return {
      uuid: g.uuid, weekId: g.weekId, gradeDate: g.gradeDate,
      houseId: g.houseId || undefined, houseName: g.houseName || undefined,
      evaluatorEmployeeId: g.evaluatorEmployeeId, evaluatorName: g.evaluatorName || undefined,
      starPresenter: g.starPresenter || undefined, diction: g.diction || undefined, feedback: g.feedback || undefined,
      total: g.total != null ? Number(g.total) : undefined,
      metrics: metrics.map((m: any) => ({ metricId: m.metricId, score: Number(m.score) })),
      penalties: penalties.map((p: any) => p.penaltyId),
    };
  }

  public async deleteGrade(gradeId: string, schoolId: string, userId: string): Promise<boolean> {
    const r = await DB.query(singleLineString`update assembly_grade set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4 and status = 'active' returning uuid`, [userId, new Date(), gradeId, schoolId]);
    return r.length > 0;
  }

  // ── Aggregation: day → week → house-of-the-month ─────────────────────────────

  public async leaderboard(schoolId: string, from: string, to: string): Promise<Leaderboard> {
    if (!isValidDate(from) || !isValidDate(to)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Valid from/to dates (yyyy-mm-dd) are required');
    const grades = await DB.query(
      singleLineString`select week_id, grade_date::text as grade_date, house_id, house_name, total from assembly_grade where school_id = $1 and status = 'active' and total is not null and grade_date >= $2::date and grade_date <= $3::date`,
      [schoolId, from, to],
    );
    // Day score = avg of evaluators' totals for (week, date).
    const dayAgg = new Map<string, { sum: number; count: number }>(); // week|date
    const weekMeta = new Map<string, { houseId?: string; houseName?: string }>();
    for (const g of grades) {
      const dk = `${g.weekId}|${g.gradeDate}`;
      const a = dayAgg.get(dk) || { sum: 0, count: 0 };
      a.sum += Number(g.total); a.count++;
      dayAgg.set(dk, a);
      if (!weekMeta.has(g.weekId)) weekMeta.set(g.weekId, { houseId: g.houseId || undefined, houseName: g.houseName || undefined });
    }
    // Week score = avg of its day scores.
    const weekDayScores = new Map<string, number[]>();
    for (const [dk, a] of dayAgg) {
      const weekId = dk.split('|')[0];
      (weekDayScores.get(weekId) || weekDayScores.set(weekId, []).get(weekId)!).push(a.sum / a.count);
    }
    const weekIds = [...weekDayScores.keys()];
    const weekStarts = await this.weekStarts(weekIds, schoolId);

    // Group weeks by house; house average = avg of its week averages.
    const houseAgg = new Map<string, LeaderboardEntry>();
    for (const weekId of weekIds) {
      const scores = weekDayScores.get(weekId)!;
      const weekAvg = round2(scores.reduce((s, n) => s + n, 0) / scores.length);
      const meta = weekMeta.get(weekId) || {};
      const key = meta.houseId || '__none__';
      const entry = houseAgg.get(key) || { houseId: meta.houseId, houseName: meta.houseName, average: 0, weekCount: 0, weeks: [] };
      entry.weeks.push({ weekId, weekStart: weekStarts.get(weekId) || '', average: weekAvg });
      houseAgg.set(key, entry);
    }
    const standings: LeaderboardEntry[] = [...houseAgg.values()].map(e => {
      const avg = round2(e.weeks.reduce((s, w) => s + w.average, 0) / e.weeks.length);
      return { ...e, average: avg, weekCount: e.weeks.length, weeks: e.weeks.sort((a, b) => a.weekStart.localeCompare(b.weekStart)) };
    }).sort((a, b) => b.average - a.average);

    const top = standings.find(s => s.houseId); // house-of-the-month ignores the "no house" bucket
    return {
      from, to,
      houseOfTheMonth: top ? { houseId: top.houseId, houseName: top.houseName, average: top.average } : undefined,
      standings,
    };
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  private async nextSort(table: string, schoolId: string): Promise<number> {
    const rows = await DB.query(singleLineString`select coalesce(max(sort_order), -1) as max from ${table} where school_id = $1 and status = 'active'`, [schoolId]);
    return Number(rows[0].max) + 1;
  }

  private async weekRow(weekId: string, schoolId: string): Promise<{ planId: string; weekStart: string; houseId?: string; houseName?: string } | null> {
    const rows = await DB.query(singleLineString`select plan_id, week_start::text as week_start, house_id, house_name from assembly_week where uuid = $1 and school_id = $2`, [weekId, schoolId]);
    if (rows.length === 0) return null;
    return { planId: rows[0].planId, weekStart: rows[0].weekStart, houseId: rows[0].houseId || undefined, houseName: rows[0].houseName || undefined };
  }

  private async weekStarts(weekIds: string[], schoolId: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (weekIds.length === 0) return map;
    const ph = weekIds.map((_, i) => `$${i + 2}`).join(', ');
    const rows = await DB.query(singleLineString`select uuid, week_start::text as week_start from assembly_week where school_id = $1 and uuid in (${ph})`, [schoolId, ...weekIds]);
    for (const r of rows) map.set(r.uuid, r.weekStart);
    return map;
  }

  private async weekDates(planId: string, schoolId: string, weekStart: string): Promise<string[]> {
    const rows = await DB.query(singleLineString`select weekday from assembly_plan_day where plan_id = $1 and school_id = $2`, [planId, schoolId]);
    const set = rows.map((r: any) => r.weekday);
    return (WEEKDAY_VALUES.filter(w => set.includes(w)) as Weekday[]).map(wd => dateInWeek(weekStart, wd));
  }
}

export const assemblyGradingService = new AssemblyGradingService();
