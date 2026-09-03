import { DB, singleLineString } from '../../shared/lib/db';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

// Cycles never fined regardless of config.
const NEVER_FINE = ['toa', 'full term'];
const norm = (s: any) => String(s == null ? '' : s).trim().toLowerCase();
const n = (x: any) => (x == null ? 0 : Number(x));
// Dates arrive as 'YYYY-MM-DD' text (cast in SQL); ymd() is a defensive fallback for Date objects.
const ymd = (d: any) => (d == null ? null : (typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10)));
const daysBetween = (a: string, b: string) => Math.floor((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

export interface ApplyFineOptions { asOf?: string; dryRun?: boolean; userId?: string; }

/**
 * Auto-levy the Late Fee ("Apply-Fine"), driven by the school's fee_late_fee_rule config.
 * One fine per overdue, unpaid, fineable cycle = min(days × rate, cap), where days are counted from
 * max(cycle_due_date, effectiveFrom) — so effectiveFrom is a fine-clock floor (no accrual before it).
 * A cycle is skipped when its unpaid balance is at/under the min-due threshold (₹ or %), or fully
 * paid (existing fine then freezes — the job just stops touching it), or already exempted (a waiver
 * exists). Idempotent for a given as-of date. Off unless an enabled rule exists.
 */
class ApplyFineService {
  private async ensureHead(schoolId: string, ay: string, userId?: string): Promise<string> {
    const ex = await DB.query(singleLineString`select uuid from fee_head where school_id = $1 and academic_year_id = $2 and lower(name) = 'late fee fine' and status = 'active'`, [schoolId, ay]);
    if (ex.length) return ex[0].uuid;
    const uuid = generateShortUuid(12);
    await DB.query(singleLineString`insert into fee_head (uuid, school_id, academic_year_id, name, kind, refundable, one_time, status, createdby_userid, created_at) values ($1,$2,$3,'Late Fee Fine','other',false,false,'active',$4,now())`, [uuid, schoolId, ay, userId || 'apply-fine']);
    return uuid;
  }

  public async run(schoolId: string, academicYearId: string, opts: ApplyFineOptions = {}) {
    const asOf = opts.asOf || new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); // IST calendar date
    const rule = (await DB.query(singleLineString`select *, to_char(effective_from, 'YYYY-MM-DD') as effective_from_ymd from fee_late_fee_rule where school_id = $1 and academic_year_id = $2 and status = 'active' and enabled = true order by created_at desc limit 1`, [schoolId, academicYearId]))[0];
    if (!rule) return { enabled: false, asOf, created: 0, grown: 0, unchanged: 0, total: 0, byCycle: [], message: 'No enabled late-fee rule for this year.' };

    const rate = n(rule.amount), cap = n(rule.cap) > 0 ? n(rule.cap) : Infinity;
    const effectiveFrom = rule.effectiveFromYmd || null;
    const minPct = rule.minDuePct != null ? n(rule.minDuePct) : null;
    const minAmt = rule.minDueAmount != null ? n(rule.minDueAmount) : null;
    const scope = rule.cycleScope ? String(rule.cycleScope).split(',').map(norm).filter(Boolean) : null;
    const fineable = (label: string) => { const l = norm(label); if (NEVER_FINE.includes(l)) return false; return scope ? scope.includes(l) : true; };

    // base charged/settled per (student, cycle)
    const base: any[] = await DB.query(singleLineString`
      select b.student_id, b.cycle_id, b.cycle_label, b.due, sum(b.debit) charged, sum(b.paid) settled from (
        select c.student_id, c.cycle_id, c.cycle_label, coalesce(fc.due_date, fc.from_date)::text due, c.debit,
          coalesce((select sum(cr.credit) from student_ledger_entry cr where cr.settles_entry_id = c.uuid and cr.status = 'active' and cr.kind in ('payment','concession','waiver')),0) paid
        from student_ledger_entry c left join fee_cycle fc on fc.uuid = c.cycle_id and fc.status = 'active'
        where c.school_id = $1 and c.academic_year_id = $2 and c.kind = 'charge' and c.status = 'active' and c.head_label not ilike '%late%'
      ) b group by b.student_id, b.cycle_id, b.cycle_label, b.due`, [schoolId, academicYearId]);

    // existing fines per (student, cycle)
    const fines: any[] = await DB.query(singleLineString`
      select l.student_id, l.cycle_id, l.uuid, l.debit,
        coalesce((select sum(credit) from student_ledger_entry w where w.settles_entry_id = l.uuid and w.kind = 'waiver' and w.status = 'active'),0) waived
      from student_ledger_entry l where l.school_id = $1 and l.academic_year_id = $2 and l.kind = 'charge' and l.status = 'active' and l.head_label ilike '%late%'`, [schoolId, academicYearId]);
    const fineBy: Record<string, any> = {};
    fines.forEach((f) => { fineBy[`${f.studentId}|${f.cycleId}`] = f; });

    const head = opts.dryRun ? null : await this.ensureHead(schoolId, academicYearId, opts.userId);
    const inserts: any[][] = [], updates: any[][] = [];
    let created = 0, grown = 0, unchanged = 0, total = 0, belowThresh = 0, paidFreeze = 0, exemptSkip = 0;
    const byCycle: Record<string, { n: number; amt: number }> = {};

    // NOTE: DB.query() returns camelCase keys (studentId/cycleId/cycleLabel), so read them as such.
    // Reading snake_case here made every cycle look "not fineable" (undefined label) and silently
    // levied nothing. (`due`/`charged`/`settled` are single lowercase words, unchanged by the transform.)
    for (const b of base) {
      if (!fineable(b.cycleLabel) || !b.due) continue;
      const dueY = ymd(b.due) as string;
      const fineStart = effectiveFrom && effectiveFrom > dueY ? effectiveFrom : dueY;
      const days = daysBetween(asOf, fineStart);
      if (days <= 0) continue; // clock hasn't started
      const charged = n(b.charged), unpaid = charged - n(b.settled);
      if (unpaid <= 0.5) { paidFreeze++; continue; } // paid -> freeze existing fine
      if (minAmt != null && unpaid < minAmt) { belowThresh++; continue; }
      if (minPct != null && charged > 0 && (unpaid / charged) * 100 <= minPct) { belowThresh++; continue; }
      const computed = Math.round(Math.min(days * rate, cap) * 100) / 100;
      const ex = fineBy[`${b.studentId}|${b.cycleId}`];
      if (ex) {
        if (n(ex.waived) > 0.5) { exemptSkip++; continue; } // exempted -> never touch
        if (Math.abs(n(ex.debit) - computed) < 0.5) { unchanged++; continue; }
        grown++; if (!opts.dryRun) updates.push([computed, ex.uuid]);
      } else {
        created++; if (!opts.dryRun) inserts.push([generateShortUuid(12), schoolId, b.studentId, academicYearId, head, b.cycleId, b.cycleLabel, computed]);
      }
      total += computed;
      (byCycle[b.cycleLabel] ||= { n: 0, amt: 0 }); byCycle[b.cycleLabel].n++; byCycle[b.cycleLabel].amt += computed;
    }

    if (!opts.dryRun) {
      const q: string[] = [], p: any[][] = [];
      for (const u of updates) { q.push(singleLineString`update student_ledger_entry set debit = $1, updated_at = now(), updatedby_userid = 'apply-fine' where uuid = $2`); p.push(u); }
      for (const ins of inserts) { q.push(singleLineString`insert into student_ledger_entry (uuid, school_id, student_id, academic_year_id, entry_date, category, fee_head_id, cycle_id, head_label, cycle_label, kind, debit, source_module, allocation, status, createdby_userid, created_at) values ($1,$2,$3,$4,now(),'fee',$5,$6,'Late Fee Fine',$7,'charge',$8,'fees','explicit','active','apply-fine',now())`); p.push(ins); }
      if (q.length) await DB.queriesInTransaction(q, p);
    }

    return {
      enabled: true, asOf, effectiveFrom, rate, cap: cap === Infinity ? null : cap, minPct, minAmt,
      created, grown, unchanged, belowThreshold: belowThresh, paidFrozen: paidFreeze, exemptedSkipped: exemptSkip,
      total: Math.round(total * 100) / 100,
      byCycle: Object.entries(byCycle).map(([cycle, v]) => ({ cycle, count: v.n, amount: Math.round(v.amt * 100) / 100 })).sort((a, b) => b.amount - a.amount),
    };
  }

  // Nightly entry point: run for every (school, year) that has an enabled rule.
  public async runAllEnabled(opts: ApplyFineOptions = {}) {
    const rules = await DB.query(singleLineString`select distinct school_id, academic_year_id from fee_late_fee_rule where status = 'active' and enabled = true`, []);
    const results: any[] = [];
    for (const r of rules) {
      try { results.push({ schoolId: r.schoolId, academicYearId: r.academicYearId, ...(await this.run(r.schoolId, r.academicYearId, opts)) }); }
      catch (e: any) { results.push({ schoolId: r.schoolId, academicYearId: r.academicYearId, error: e.message }); }
    }
    return results;
  }
}

export const applyFineService = new ApplyFineService();
