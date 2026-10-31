import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { StudentTc, CreateTcRequest, UpdateTcRequest, TransferConfig } from './transfer-interfaces';
import { TC_STATUS_VALUES, DEFAULTS, CONFIG_DEFAULTS, DUES_GATE_MODES } from './transfer-constants';
import { findStudent, deriveStudent, deriveConcession, deriveSubjects, deriveAttendance, nextSrnSequence, nextTcNumberSeq, latestAcademicYear, getTcBranding, ymd, dateInWords } from './transfer-common';
import { feesLedgerService } from '../fees/fees-ledger-service';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');
const QRCode = require('qrcode');

const PORTAL_BASE_URL = process.env.PORTAL_BASE_URL || 'https://dbpasn.itsmyskool.com';

const TC_COLUMNS = singleLineString`
  uuid, school_id, student_id, application_date, srn_number, tc_number, book_no, issue_date,
  reason_for_leaving, result, failed_in_class, subjects_studied, qualified_for_promotion,
  dues_paid_upto, fee_concession, ncc_scout_guide, games_activities, general_conduct, remarks,
  total_attendance_days, total_working_days, status, printed_at, print_count,
  mother_name, father_name, dob, nationality, category, first_admission_date
`;

// Transfer Certificate lifecycle for a student. Issuing a TC withdraws the
// student (student.status -> inactive, withdrawal_date set) via the shared DB.
class TransferService {
  private assertStatus(status: string | undefined): void {
    if (status !== undefined && !(TC_STATUS_VALUES as readonly string[]).includes(status)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `status must be one of: ${TC_STATUS_VALUES.join(', ')}`);
    }
  }

  // ── Per-school TC configuration (god-only Config screen) ─────────────────────
  public async getConfig(schoolId: string): Promise<TransferConfig> {
    const rows = await DB.query(singleLineString`select * from transfer_config where school_id = $1`, [schoolId]);
    const r: any = rows.length ? rows[0] : {};
    const D = CONFIG_DEFAULTS;
    return {
      duesGateMode: r.duesGateMode || D.duesGateMode,
      tcBookNo: r.tcBookNo ?? D.tcBookNo,
      srnPrefix: r.srnPrefix ?? D.srnPrefix,
      tcNumberPrefix: r.tcNumberPrefix ?? D.tcNumberPrefix,
      defaultResult: r.defaultResult ?? D.defaultResult,
      defaultConduct: r.defaultConduct ?? D.defaultConduct,
      defaultPromotion: r.defaultPromotion ?? D.defaultPromotion,
      defaultFailed: r.defaultFailed ?? D.defaultFailed,
      defaultDuesPaidUpto: r.defaultDuesPaidUpto ?? D.defaultDuesPaidUpto,
      defaultNcc: r.defaultNcc ?? D.defaultNcc,
      resultOptions: Array.isArray(r.resultOptions) && r.resultOptions.length ? r.resultOptions : [...D.resultOptions],
      conductOptions: Array.isArray(r.conductOptions) && r.conductOptions.length ? r.conductOptions : [...D.conductOptions],
      autoDeriveSubjects: r.autoDeriveSubjects == null ? D.autoDeriveSubjects : !!r.autoDeriveSubjects,
      allowIdentityOverride: r.allowIdentityOverride == null ? D.allowIdentityOverride : !!r.allowIdentityOverride,
    };
  }

  public async updateConfig(schoolId: string, data: Partial<TransferConfig>, userId: string): Promise<TransferConfig> {
    if (data.duesGateMode !== undefined && !(DUES_GATE_MODES as readonly string[]).includes(data.duesGateMode)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `duesGateMode must be one of: ${DUES_GATE_MODES.join(', ')}`);
    }
    const cur = await this.getConfig(schoolId);
    const m = { ...cur, ...data };
    const now = new Date();
    const vals = [
      m.duesGateMode, m.tcBookNo || null, m.srnPrefix || null, m.tcNumberPrefix || null,
      m.defaultResult || null, m.defaultConduct || null, m.defaultPromotion || null, m.defaultFailed || null,
      m.defaultDuesPaidUpto || null, m.defaultNcc || null,
      JSON.stringify(m.resultOptions || []), JSON.stringify(m.conductOptions || []),
      !!m.autoDeriveSubjects, !!m.allowIdentityOverride,
    ];
    const exists = await DB.query(singleLineString`select 1 from transfer_config where school_id = $1`, [schoolId]);
    if (exists.length) {
      await DB.query(
        singleLineString`update transfer_config set dues_gate_mode = $2, tc_book_no = $3, srn_prefix = $4,
          tc_number_prefix = $5, default_result = $6, default_conduct = $7, default_promotion = $8,
          default_failed = $9, default_dues_paid_upto = $10, default_ncc = $11, result_options = $12,
          conduct_options = $13, auto_derive_subjects = $14, allow_identity_override = $15,
          updatedby_userid = $16, updated_at = $17
          where school_id = $1`,
        [schoolId, ...vals, userId, now]
      );
    } else {
      await DB.query(
        singleLineString`insert into transfer_config (school_id, dues_gate_mode, tc_book_no, srn_prefix,
          tc_number_prefix, default_result, default_conduct, default_promotion, default_failed,
          default_dues_paid_upto, default_ncc, result_options, conduct_options, auto_derive_subjects,
          allow_identity_override, updatedby_userid, updated_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [schoolId, ...vals, userId, now]
      );
    }
    return this.getConfig(schoolId);
  }

  // Identity (DOB/parents/category/etc.) is entered on the student record and derived live
  // unless the school explicitly enables TC-level editing. When disabled, drop any override
  // fields the request carried so they are never stored.
  private async stripIdentityIfDisallowed(schoolId: string, data: CreateTcRequest | UpdateTcRequest): Promise<void> {
    const cfg = await this.getConfig(schoolId);
    if (cfg.allowIdentityOverride) return;
    data.motherName = undefined;
    data.fatherName = undefined;
    data.dob = undefined;
    data.nationality = undefined;
    data.category = undefined;
    data.firstAdmissionDate = undefined;
  }

  // Total academic+transport dues outstanding across all years (fees public API, read-only).
  public async getOutstandingDues(schoolId: string, studentId: string): Promise<number> {
    try {
      const led: any = await feesLedgerService.studentLedger(schoolId, studentId);
      return Math.max(0, Number(led?.totals?.outstanding || 0));
    } catch {
      return 0;
    }
  }

  public async listForStudent(studentId: string, schoolId: string): Promise<StudentTc[]> {
    return DB.query(
      singleLineString`
        select ${TC_COLUMNS} from student_tc
        where student_id = $1 and school_id = $2 and status <> 'deleted'
        order by created_at desc
      `,
      [studentId, schoolId]
    );
  }

  // School-wide TC list with optional text search (student name / admission number)
  // and status filter. Returns denormalized student name + admission + current class.
  public async listAll(
    schoolId: string,
    opts: { query?: string; status?: string } = {}
  ): Promise<any[]> {
    const params: any[] = [schoolId];
    const filters: string[] = [`tc.school_id = $1`, `tc.status <> 'deleted'`, `s.status <> 'deleted'`];
    if (opts.query && opts.query.trim()) {
      params.push(`%${opts.query.trim()}%`);
      filters.push(`(s.name ilike $${params.length} or s.admission_number ilike $${params.length})`);
    }
    if (opts.status && (TC_STATUS_VALUES as readonly string[]).includes(opts.status)) {
      params.push(opts.status);
      filters.push(`tc.status = $${params.length}`);
    }
    const rows = await DB.query(
      singleLineString`
        select tc.uuid, tc.student_id, tc.application_date, tc.srn_number, tc.tc_number, tc.issue_date,
               tc.reason_for_leaving, tc.total_attendance_days, tc.total_working_days, tc.status,
               tc.printed_at, tc.print_count,
               s.name as student_name, s.admission_number,
               cur.class_name
        from student_tc tc
        join student s on s.uuid = tc.student_id and s.school_id = tc.school_id
        left join lateral (
          select c.name as class_name
          from student_class sc
          join academic_year ay on sc.academic_year_id = ay.uuid
          left join class c on sc.class_id = c.uuid
          where sc.student_id = s.uuid and (sc.status is null or sc.status <> 'deleted')
          order by ay.start_date desc nulls last limit 1
        ) cur on true
        where ${filters.join(' and ')}
        order by tc.created_at desc
      `,
      params
    );
    // Dues clearance per student — all-years ledger balance in ONE query (matches the
    // issue gate's figure). A positive balance means the TC is blocked from issuing.
    const ids = [...new Set(rows.map((r: any) => r.studentId).filter(Boolean))];
    if (ids.length) {
      const bals = await DB.query(
        singleLineString`select student_id, round(coalesce(sum(debit),0) - coalesce(sum(credit),0), 2) as bal
          from student_ledger_entry where school_id = $1 and student_id = any($2::text[]) and status = 'active'
          group by student_id`,
        [schoolId, ids]
      );
      const m = new Map(bals.map((b: any) => [b.studentId, Math.max(0, Number(b.bal) || 0)]));
      rows.forEach((r: any) => { r.outstandingDues = m.get(r.studentId) || 0; });
    }
    return rows;
  }

  public async getById(tcId: string, schoolId: string): Promise<StudentTc | null> {
    const rows = await DB.query(
      singleLineString`select ${TC_COLUMNS} from student_tc where uuid = $1 and school_id = $2 and status <> 'deleted'`,
      [tcId, schoolId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  // Suggested form values for a new TC: identity derived live + config defaults +
  // concession/subjects derivation + current outstanding dues.
  public async prefill(schoolId: string, studentId: string): Promise<any> {
    const derived = await deriveStudent(schoolId, studentId);
    if (!derived) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Student not found');
    const cfg = await this.getConfig(schoolId);
    const concession = await deriveConcession(schoolId, studentId);
    const subjects = cfg.autoDeriveSubjects ? await deriveSubjects(schoolId, derived.classWords, derived.classId) : [];
    const subjectsStudied = subjects.map((s, i) => `${i + 1}. ${s}`).join('  ');
    const att = await deriveAttendance(schoolId, studentId, derived.classId, derived.academicYearId);
    const curAy = await latestAcademicYear(schoolId);
    const srnSeq = await nextSrnSequence(schoolId); // continuous
    const tcSeq = await nextTcNumberSeq(schoolId, curAy?.name || null); // resets per year
    const ayToken = curAy?.name ? `/${curAy.name}` : '';
    return {
      derived,
      config: cfg,
      duesOutstanding: await this.getOutstandingDues(schoolId, studentId),
      suggested: {
        srnNumber: `${cfg.srnPrefix || ''}${srnSeq}`,
        tcNumber: `${cfg.tcNumberPrefix || ''}${tcSeq}${ayToken}`,
        result: cfg.defaultResult,
        generalConduct: cfg.defaultConduct,
        qualifiedForPromotion: cfg.defaultPromotion,
        failedInClass: cfg.defaultFailed,
        duesPaidUpto: cfg.defaultDuesPaidUpto,
        nccScoutGuide: cfg.defaultNcc,
        feeConcession: concession,
        subjectsStudied,
        bookNo: cfg.tcBookNo,
        totalWorkingDays: att.workingDays,
        totalAttendanceDays: att.presentDays,
      },
    };
  }

  // Mark the student as withdrawn. Owns the write to the shared `student` row.
  private async withdrawStudent(
    studentId: string,
    schoolId: string,
    withdrawalDate: string | null,
    withdrawalRemarks: string | null,
    userId: string
  ): Promise<void> {
    const fields = ["status = 'inactive'", 'withdrawal_date = $1'];
    const params: any[] = [withdrawalDate || new Date()];
    if (withdrawalRemarks) {
      params.push(withdrawalRemarks);
      fields.push(`withdrawal_remarks = $${params.length}`);
    }
    params.push(userId);
    fields.push(`updatedby_userid = $${params.length}`);
    params.push(new Date());
    fields.push(`updated_at = $${params.length}`);
    params.push(studentId, schoolId);
    await DB.query(
      `update student set ${fields.join(', ')}
       where uuid = $${params.length - 1} and school_id = $${params.length} and status <> 'deleted'`,
      params
    );
  }

  // Enforce the configurable no-dues gate when a TC transitions to 'issued'. Returns a
  // warning string (warn mode) or null. Throws in block mode unless the caller may override.
  private async enforceDuesGate(
    schoolId: string,
    studentId: string,
    overrideDues: boolean,
    canOverrideDues: boolean
  ): Promise<string | null> {
    const cfg = await this.getConfig(schoolId);
    if (cfg.duesGateMode === 'off') return null;
    const outstanding = await this.getOutstandingDues(schoolId, studentId);
    if (outstanding <= 0) return null;
    const amt = `₹${outstanding.toLocaleString('en-IN')}`;
    if (cfg.duesGateMode === 'block') {
      const overriding = overrideDues && canOverrideDues;
      if (!overriding) {
        throw new BusinessErrorResult(
          ErrorCode.BusinessError,
          `Student has outstanding dues of ${amt}. Clear the dues, or a super-admin can override to issue the TC.`
        );
      }
      return `Issued with outstanding dues of ${amt} (overridden).`;
    }
    return `Student has outstanding dues of ${amt}.`;
  }

  public async create(
    studentId: string,
    data: CreateTcRequest,
    schoolId: string,
    userId: string,
    canOverrideDues = false
  ): Promise<StudentTc> {
    const student = await findStudent(schoolId, studentId);
    if (!student) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Student not found');
    this.assertStatus(data.status);
    await this.stripIdentityIfDisallowed(schoolId, data);

    const status = data.status || DEFAULTS.STATUS;
    let duesWarning: string | null = null;
    if (status === 'issued') {
      duesWarning = await this.enforceDuesGate(schoolId, studentId, !!data.overrideDues, canOverrideDues);
    }

    const uuid = generateShortUuid(12);
    const now = new Date();
    await DB.query(
      singleLineString`
        insert into student_tc
        (uuid, school_id, student_id, application_date, srn_number, tc_number, book_no, issue_date,
         reason_for_leaving, result, failed_in_class, subjects_studied, qualified_for_promotion,
         dues_paid_upto, fee_concession, ncc_scout_guide, games_activities, general_conduct, remarks,
         total_attendance_days, total_working_days,
         mother_name, father_name, dob, nationality, category, first_admission_date,
         status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
                $22, $23, $24, $25, $26, $27, $28, $29, $30)
      `,
      [
        uuid, schoolId, studentId,
        data.applicationDate || null, data.srnNumber || null, data.tcNumber || null, data.bookNo || null,
        data.issueDate || null, data.reasonForLeaving || null, data.result || null, data.failedInClass || null,
        data.subjectsStudied || null, data.qualifiedForPromotion || null, data.duesPaidUpto || null,
        data.feeConcession || null, data.nccScoutGuide || null, data.gamesActivities || null,
        data.generalConduct || null, data.remarks || null,
        data.totalAttendanceDays ?? null, data.totalWorkingDays ?? null,
        data.motherName || null, data.fatherName || null, data.dob || null,
        data.nationality || null, data.category || null, data.firstAdmissionDate || null,
        status, userId, now,
      ]
    );

    if (status === 'issued') {
      await this.withdrawStudent(studentId, schoolId, data.issueDate || null, data.reasonForLeaving || null, userId);
    }
    const tc = (await this.getById(uuid, schoolId)) as StudentTc;
    if (duesWarning) (tc as any).duesWarning = duesWarning;
    return tc;
  }

  public async update(
    tcId: string,
    data: UpdateTcRequest,
    schoolId: string,
    userId: string,
    canOverrideDues = false
  ): Promise<StudentTc | null> {
    const existing = await this.getById(tcId, schoolId);
    if (!existing) return null;
    this.assertStatus(data.status);
    await this.stripIdentityIfDisallowed(schoolId, data);

    // Gate BEFORE writing so a blocked issue leaves the row untouched.
    let duesWarning: string | null = null;
    if (data.status === 'issued' && existing.status !== 'issued') {
      duesWarning = await this.enforceDuesGate(schoolId, existing.studentId, !!data.overrideDues, canOverrideDues);
    }

    const fields: string[] = [];
    const params: any[] = [];
    const set = (col: string, val: any) => {
      params.push(val);
      fields.push(`${col} = $${params.length}`);
    };
    if (data.applicationDate !== undefined) set('application_date', data.applicationDate);
    if (data.srnNumber !== undefined) set('srn_number', data.srnNumber);
    if (data.tcNumber !== undefined) set('tc_number', data.tcNumber);
    if (data.bookNo !== undefined) set('book_no', data.bookNo);
    if (data.issueDate !== undefined) set('issue_date', data.issueDate);
    if (data.reasonForLeaving !== undefined) set('reason_for_leaving', data.reasonForLeaving);
    if (data.result !== undefined) set('result', data.result);
    if (data.failedInClass !== undefined) set('failed_in_class', data.failedInClass);
    if (data.subjectsStudied !== undefined) set('subjects_studied', data.subjectsStudied);
    if (data.qualifiedForPromotion !== undefined) set('qualified_for_promotion', data.qualifiedForPromotion);
    if (data.duesPaidUpto !== undefined) set('dues_paid_upto', data.duesPaidUpto);
    if (data.feeConcession !== undefined) set('fee_concession', data.feeConcession);
    if (data.nccScoutGuide !== undefined) set('ncc_scout_guide', data.nccScoutGuide);
    if (data.gamesActivities !== undefined) set('games_activities', data.gamesActivities);
    if (data.generalConduct !== undefined) set('general_conduct', data.generalConduct);
    if (data.remarks !== undefined) set('remarks', data.remarks);
    if (data.totalAttendanceDays !== undefined) set('total_attendance_days', data.totalAttendanceDays);
    if (data.totalWorkingDays !== undefined) set('total_working_days', data.totalWorkingDays);
    if (data.motherName !== undefined) set('mother_name', data.motherName);
    if (data.fatherName !== undefined) set('father_name', data.fatherName);
    if (data.dob !== undefined) set('dob', data.dob || null);
    if (data.nationality !== undefined) set('nationality', data.nationality);
    if (data.category !== undefined) set('category', data.category);
    if (data.firstAdmissionDate !== undefined) set('first_admission_date', data.firstAdmissionDate || null);
    if (data.status !== undefined) set('status', data.status);

    if (fields.length > 0) {
      set('updatedby_userid', userId);
      set('updated_at', new Date());
      params.push(tcId, schoolId);
      await DB.query(
        `update student_tc set ${fields.join(', ')}
         where uuid = $${params.length - 1} and school_id = $${params.length} and status <> 'deleted'`,
        params
      );
    }

    // Transition into 'issued' withdraws the student.
    if (data.status === 'issued' && existing.status !== 'issued') {
      const issueDate = data.issueDate || existing.issueDate || null;
      await this.withdrawStudent(existing.studentId, schoolId, data.withdrawalDate || issueDate, data.withdrawalRemarks || null, userId);
    }
    const tc = await this.getById(tcId, schoolId);
    if (tc && duesWarning) (tc as any).duesWarning = duesWarning;
    return tc;
  }

  // Everything the certificate template needs: stored TC + live-derived identity +
  // central branding + a verification QR.
  public async printData(schoolId: string, tcId: string): Promise<any | null> {
    const tc = await this.getById(tcId, schoolId);
    if (!tc) return null;
    const [derived, branding] = await Promise.all([
      deriveStudent(schoolId, tc.studentId),
      getTcBranding(schoolId),
    ]);
    // Identity = stored override if present, else live-derived. dob-in-words recomputed
    // from the effective dob.
    const base: any = derived || {};
    const effDob = tc.dob ? ymd(tc.dob) : base.dob;
    const identity = {
      ...base,
      motherName: tc.motherName || base.motherName,
      fatherName: tc.fatherName || base.fatherName,
      dob: effDob,
      dobInWords: dateInWords(effDob),
      nationality: tc.nationality || base.nationality,
      category: tc.category || base.category,
      admissionDate: tc.firstAdmissionDate ? ymd(tc.firstAdmissionDate) : base.admissionDate,
    };
    const feeConcession = tc.feeConcession || (await deriveConcession(schoolId, tc.studentId));
    const verifyUrl = `${PORTAL_BASE_URL}/verify/tc/${tc.uuid}`;
    const qrDataUri = await QRCode.toDataURL(verifyUrl, { margin: 2, width: 220 });
    // Non-issued prints are previews only — stamp a watermark so a draft is never mistaken
    // for a valid certificate.
    let watermark: string | null = null;
    if (tc.status === 'cancelled') {
      watermark = 'CANCELLED';
    } else if (tc.status !== 'issued') {
      const dues = await this.getOutstandingDues(schoolId, tc.studentId);
      watermark = dues > 0 ? 'DRAFT — DUES PENDING' : 'DRAFT — NOT ISSUED';
    }
    return { tc, derived: identity, branding, feeConcession, verifyUrl, qrDataUri, watermark };
  }

  public async recordPrint(schoolId: string, tcId: string): Promise<void> {
    await DB.query(
      singleLineString`update student_tc set printed_at = $1, print_count = coalesce(print_count, 0) + 1
        where uuid = $2 and school_id = $3 and status <> 'deleted'`,
      [new Date(), tcId, schoolId]
    );
  }

  // Public QR verification — resolve by uuid alone (globally unique); only 'issued' TCs verify.
  public async verifyPublic(tcId: string): Promise<any> {
    const rows = await DB.query(
      singleLineString`select tc.uuid, tc.tc_number, tc.srn_number, tc.issue_date, tc.status,
          s.name as student_name, s.admission_number, b.school_name,
          cur.class_name
        from student_tc tc
        join student s on s.uuid = tc.student_id and s.school_id = tc.school_id
        left join school_branding b on b.school_id = tc.school_id
        left join lateral (
          select c.name as class_name from student_class sc
          join academic_year ay on sc.academic_year_id = ay.uuid
          left join class c on sc.class_id = c.uuid
          where sc.student_id = s.uuid and (sc.status is null or sc.status <> 'deleted')
          order by ay.start_date desc nulls last limit 1
        ) cur on true
        where tc.uuid = $1 and tc.status = 'issued'`,
      [tcId]
    );
    if (!rows.length) return { valid: false };
    const r: any = rows[0];
    return {
      valid: true,
      studentName: r.studentName,
      admissionNumber: r.admissionNumber,
      className: r.className || null,
      tcNumber: r.tcNumber || null,
      srnNumber: r.srnNumber || null,
      issueDate: r.issueDate || null,
      schoolName: r.schoolName || null,
    };
  }
}

export const transferService = new TransferService();
