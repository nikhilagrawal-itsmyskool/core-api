import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { Channel, DEFAULTS, RETRY, SEND_BATCH_SIZE, REAPER } from './communication-constants';
import {
  AudienceSpec, AudienceTarget, MessageJob, MessageRecipient, MessageTemplate,
  SendMessageRequest, PreviewRequest,
} from './communication-interfaces';
import { resolveLadder, resolveVariables, studentNumbers, employeeNumbers, autoContext, schoolContext } from './communication-util';
import { templateService } from './template-service';
import { getProvider } from './providers';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

// Single-row insert for message_recipient, shared by the expand transaction.
const RECIPIENT_INSERT_SQL = singleLineString`
  insert into message_recipient
  (uuid, school_id, job_id, recipient_type, recipient_id, role, to_number, channel, template_id, context, status, provider_message_id, error, sent_at, createdby_userid, created_at)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
`;

// Build the ordered parameter row for RECIPIENT_INSERT_SQL. Recipients are created
// in a terminal 'skipped' state or a 'pending' state (send happens later, so
// provider_message_id / sent_at are always null at insert).
function recipientRow(
  job: MessageJob,
  target: AudienceTarget,
  match: { role: string; channel: string; toNumber: string } | null,
  templateId: string | null,
  ctx: Record<string, any> | null,
  status: string,
  error: string | null,
): any[] {
  return [
    generateShortUuid(12), job.schoolId, job.uuid, target.recipientType, target.recipientId,
    match ? match.role : null, match ? match.toNumber : null, match ? match.channel : null,
    templateId, ctx ? JSON.stringify(ctx) : null, status,
    null, error ? String(error).slice(0, 2000) : null,
    null, job.createdbyUserid || 'worker', new Date(),
  ];
}

class MessageService {
  // ----------------------------------------------------------------- enqueue
  // Create a queued job storing its audience spec. No recipient rows yet — the
  // worker resolves the population lazily at send time (live roster).
  public async enqueue(schoolId: string, req: SendMessageRequest, userId: string): Promise<string> {
    if (!req.templateKey || !req.templateKey.trim()) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'templateKey is required');
    }
    if (!req.audience || (!req.audience.students && !req.audience.employees && !req.audience.transport)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'audience is required');
    }

    const uuid = generateShortUuid(12);
    const now = new Date();
    const scheduledAt = req.scheduledAt ? new Date(req.scheduledAt) : now;
    await DB.query(
      singleLineString`
        insert into message_job
        (uuid, school_id, status, scheduled_at, template_key, language, force_channel, audience, audience_summary, context, source, attempts, createdby_userid, created_at)
        values ($1, $2, 'queued', $3, $4, $5, $6, $7, $8, $9, $10, 0, $11, $12)
      `,
      [
        uuid, schoolId, scheduledAt, req.templateKey.trim(), req.language || DEFAULTS.LANGUAGE,
        req.forceChannel || null, JSON.stringify(req.audience), audienceSummary(req.audience),
        req.context ? JSON.stringify(req.context) : null, req.source || 'manual', userId, now,
      ],
    );
    return uuid;
  }

  public async list(schoolId: string): Promise<MessageJob[]> {
    return DB.query(
      singleLineString`select * from message_job where school_id = $1 order by created_at desc limit 100`,
      [schoolId],
    );
  }

  public async getById(jobId: string, schoolId: string): Promise<MessageJob | null> {
    const rows = await DB.query(
      singleLineString`select * from message_job where uuid = $1 and school_id = $2`,
      [jobId, schoolId],
    );
    if (rows.length === 0) return null;
    const job = rows[0];
    job.recipients = await DB.query(
      singleLineString`select * from message_recipient where job_id = $1 and school_id = $2 order by created_at`,
      [jobId, schoolId],
    );
    return job;
  }

  public async cancel(jobId: string, schoolId: string, userId: string): Promise<MessageJob | null> {
    const rows = await DB.query(
      singleLineString`
        update message_job set status = 'canceled', updatedby_userid = $1, updated_at = now()
        where uuid = $2 and school_id = $3 and status = 'queued'
        returning *
      `,
      [userId, jobId, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  // ----------------------------------------------------------------- preview
  // Resolve audience + ladder for a spec WITHOUT sending or persisting — lets the
  // UI preview who a (scheduled) job would reach.
  public async preview(schoolId: string, req: PreviewRequest): Promise<any> {
    const language = req.language || DEFAULTS.LANGUAGE;
    const templates = await templateService.getActiveByKey(schoolId, req.templateKey, language);
    const availableChannels = new Set<Channel>(templates.keys());
    const targets = await this.resolveTargets(schoolId, req.audience);
    const schoolCtx = schoolContext(await this.getSchool(schoolId));

    const recipients = targets.map((t) => {
      const match = resolveLadder(t, availableChannels, req.forceChannel);
      if (!match) {
        return { recipientType: t.recipientType, recipientId: t.recipientId, name: t.name, status: 'skipped', reason: 'no reachable channel with an approved template' };
      }
      const template = templates.get(match.channel)!;
      const ctx = { ...(req.context || {}), ...t.context, ...schoolCtx };
      const { missing } = resolveVariables(template.variables, ctx);
      if (missing.length > 0) {
        return { recipientType: t.recipientType, recipientId: t.recipientId, name: t.name, role: match.role, channel: match.channel, status: 'skipped', reason: `missing variables: ${missing.join(', ')}` };
      }
      return { recipientType: t.recipientType, recipientId: t.recipientId, name: t.name, role: match.role, channel: match.channel, toNumber: match.toNumber, status: 'pending' };
    });

    const counts = recipients.reduce((acc: any, r: any) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
    return {
      availableChannels: Array.from(availableChannels),
      targetCount: targets.length,
      counts,
      recipients,
    };
  }

  // ------------------------------------------------------------- process-next
  // One unit of queue work, called repeatedly by the worker poller / drain loop.
  // A "unit" is intentionally small so no single invocation runs long:
  //   1. sweep the reaper (recover crashed expands / stuck sends / strays),
  //   2. drain ONE batch of an in-flight job's pending recipients, else
  //   3. expand ONE freshly-claimed queued job into recipient rows.
  // In-flight sends are prioritised over new expands so broadcasts finish before
  // new ones pile on. Returns { claimed:false } only when nothing is left to do.
  public async processNext(workerId: string): Promise<{ claimed: boolean; kind?: string; jobId?: string; status?: string; counts?: any; error?: string }> {
    await this.reap();

    // 1. Send one batch of an already-expanded job.
    const batch = await this.claimSendBatch(workerId);
    if (batch.length > 0) {
      const counts = await this.sendClaimedBatch(batch);
      const jobIds = Array.from(new Set(batch.map((r) => r.jobId)));
      const completed = await this.completeFinishedJobs(jobIds);
      return { claimed: true, kind: 'send', status: completed > 0 ? 'completed' : 'sending', counts };
    }

    // 2. Nothing to send — expand the next due queued job.
    const claimed = await DB.query(
      singleLineString`
        update message_job
        set status = 'expanding', worker_id = $1, heartbeat_at = now(), started_at = now(),
            attempts = coalesce(attempts, 0) + 1, updated_at = now()
        where uuid = (
          select uuid from message_job where status = 'queued' and scheduled_at <= now() order by scheduled_at limit 1 for update skip locked
        )
        returning *
      `,
      [workerId],
    );
    if (claimed.length === 0) return { claimed: false };

    const job = claimed[0];
    try {
      const counts = await this.expand(job);
      // A job with no reachable recipients (all skipped) is already done.
      return { claimed: true, kind: 'expand', jobId: job.uuid, status: counts.pending > 0 ? 'expanded' : 'completed', counts };
    } catch (err: any) {
      const message = err.message || String(err);
      const outcome = await this.markFailedOrRetry(job, err);
      return { claimed: true, kind: 'expand', jobId: job.uuid, status: outcome, error: message };
    }
  }

  // ---------------------------------------------------------------- phase 1: expand
  // Resolve the live roster into message_recipient rows in ONE transaction. Each
  // target is classified now (ladder + variable resolution): reachable -> pending
  // (to be sent in phase 2), unreachable/missing-vars -> skipped (terminal). The
  // leading delete makes a re-run after a crash idempotent. The job flips to
  // 'sending' (or 'completed' if nothing is pending) atomically with the inserts.
  private async expand(job: MessageJob): Promise<{ pending: number; skipped: number }> {
    const language = job.language || DEFAULTS.LANGUAGE;
    const templates = await templateService.getActiveByKey(job.schoolId, job.templateKey, language);
    const availableChannels = new Set<Channel>(templates.keys());
    if (availableChannels.size === 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `No active template for key "${job.templateKey}"`);
    }

    const targets = await this.resolveTargets(job.schoolId, job.audience);
    const schoolCtx = schoolContext(await this.getSchool(job.schoolId));

    const queries: string[] = [`delete from message_recipient where job_id = $1`];
    const params: any[][] = [[job.uuid]];
    let pending = 0;
    let skipped = 0;

    for (const t of targets) {
      const match = resolveLadder(t, availableChannels, job.forceChannel);
      if (!match) {
        queries.push(RECIPIENT_INSERT_SQL);
        params.push(recipientRow(job, t, null, null, null, 'skipped', 'no reachable channel with an approved template'));
        skipped++;
        continue;
      }
      const template = templates.get(match.channel)!;
      const ctx = { ...(job.context || {}), ...t.context, ...schoolCtx };
      const { missing } = resolveVariables(template.variables, ctx);
      if (missing.length > 0) {
        queries.push(RECIPIENT_INSERT_SQL);
        params.push(recipientRow(job, t, match, template.uuid, ctx, 'skipped', `missing variables: ${missing.join(', ')}`));
        skipped++;
        continue;
      }
      // Reachable: store the resolved context so phase 2 re-derives the exact same
      // variable values from it at send time.
      queries.push(RECIPIENT_INSERT_SQL);
      params.push(recipientRow(job, t, match, template.uuid, ctx, 'pending', null));
      pending++;
    }

    const finalStatus = pending > 0 ? 'sending' : 'completed';
    queries.push(
      singleLineString`
        update message_job set status = $1, finished_at = ${pending > 0 ? 'null' : 'now()'}, updated_at = now() where uuid = $2
      `,
    );
    params.push([finalStatus, job.uuid]);

    await DB.queriesInTransaction(queries, params);
    return { pending, skipped };
  }

  // ---------------------------------------------------------------- phase 2: send
  // Claim up to SEND_BATCH_SIZE pending recipients belonging to a 'sending' job,
  // oldest job / oldest recipient first, marking them 'sending' so a concurrent
  // worker skips them. `for update of r skip locked` locks only the recipient rows.
  private async claimSendBatch(workerId: string): Promise<MessageRecipient[]> {
    return DB.query(
      singleLineString`
        update message_recipient
        set status = 'sending', updatedby_userid = $1, updated_at = now()
        where uuid in (
          select r.uuid from message_recipient r
          join message_job j on j.uuid = r.job_id and j.status = 'sending'
          where r.status = 'pending'
          order by j.scheduled_at, r.created_at
          limit ${SEND_BATCH_SIZE}
          for update of r skip locked
        )
        returning *
      `,
      [workerId],
    );
  }

  // Send each claimed recipient and record its outcome IMMEDIATELY (per row), so a
  // mid-batch crash leaves at most one recipient in limbo for the reaper to requeue.
  private async sendClaimedBatch(batch: MessageRecipient[]): Promise<{ sent: number; failed: number }> {
    const provider = getProvider();
    const templates = await this.getTemplatesByIds(
      Array.from(new Set(batch.map((r) => r.templateId).filter((id): id is string => !!id))),
    );
    const counts = { sent: 0, failed: 0 };

    for (const r of batch) {
      try {
        const template = templates.get(r.templateId!);
        if (!template) throw new Error('template not found at send time');
        const { values } = resolveVariables(template.variables, r.context || {});
        const result = await provider.send({
          channel: r.channel!,
          toNumber: r.toNumber!,
          templateKey: template.key,
          providerTemplateId: template.providerTemplateId,
          language: template.language || DEFAULTS.LANGUAGE,
          variables: values,
          variableNames: template.variables,
          headerType: template.headerType,
        });
        const status = result.status === 'sent' ? 'sent' : 'failed';
        await this.markRecipient(r.uuid, status, {
          providerMessageId: result.providerMessageId,
          error: result.error,
          sentAt: status === 'sent' ? new Date() : undefined,
        });
        if (status === 'sent') counts.sent++; else counts.failed++;
      } catch (err: any) {
        await this.markRecipient(r.uuid, 'failed', { error: err.message || String(err) });
        counts.failed++;
      }
    }
    return counts;
  }

  private async markRecipient(
    uuid: string,
    status: string,
    extra: { providerMessageId?: string; error?: string; sentAt?: Date },
  ): Promise<void> {
    await DB.query(
      singleLineString`
        update message_recipient
        set status = $1, provider_message_id = coalesce($2, provider_message_id),
            error = $3, sent_at = $4, updated_at = now()
        where uuid = $5
      `,
      [
        status, extra.providerMessageId || null,
        extra.error ? String(extra.error).slice(0, 2000) : null,
        extra.sentAt || null, uuid,
      ],
    );
  }

  private async getTemplatesByIds(ids: string[]): Promise<Map<string, MessageTemplate>> {
    const map = new Map<string, MessageTemplate>();
    if (ids.length === 0) return map;
    const rows = await DB.query(
      singleLineString`select * from message_template where uuid = any($1)`,
      [ids],
    );
    for (const row of rows) map.set(row.uuid, row);
    return map;
  }

  // Flip any of the given 'sending' jobs to 'completed' once none of their
  // recipients are still pending or in-flight. Idempotent / concurrency-safe.
  private async completeFinishedJobs(jobIds: string[]): Promise<number> {
    if (jobIds.length === 0) return 0;
    const rows = await DB.query(
      singleLineString`
        update message_job set status = 'completed', finished_at = now(), updated_at = now()
        where uuid = any($1) and status = 'sending'
          and not exists (
            select 1 from message_recipient r
            where r.job_id = message_job.uuid and r.status in ('pending', 'sending')
          )
        returning uuid
      `,
      [jobIds],
    );
    return rows.length;
  }

  // ---------------------------------------------------------------- reaper
  // Crash recovery, cheap enough to run before every unit of work (all three
  // UPDATEs match zero rows in the common case, guarded by indexed predicates):
  //   1. an 'expanding' job that stalled -> back to 'queued' (expand is idempotent),
  //   2. a recipient stuck 'sending' (invocation died mid-batch) -> back to 'pending'
  //      (at-least-once: it may already have been sent, hence a possible duplicate),
  //   3. a 'sending' job whose recipients are all terminal but never got flipped
  //      (crash right before completion) -> 'completed'.
  private async reap(): Promise<void> {
    await DB.query(
      singleLineString`
        update message_job set status = 'queued', worker_id = null, started_at = null, updated_at = now()
        where status = 'expanding' and coalesce(heartbeat_at, started_at) < now() - make_interval(secs => $1)
      `,
      [REAPER.EXPANDING_STALE_SECONDS],
    );
    await DB.query(
      singleLineString`
        update message_recipient set status = 'pending', updated_at = now()
        where status = 'sending' and updated_at < now() - make_interval(secs => $1)
      `,
      [REAPER.SENDING_RECIPIENT_STALE_SECONDS],
    );
    await DB.query(
      singleLineString`
        update message_job set status = 'completed', finished_at = now(), updated_at = now()
        where status = 'sending'
          and not exists (
            select 1 from message_recipient r
            where r.job_id = message_job.uuid and r.status in ('pending', 'sending')
          )
      `,
    );
  }

  private async markFailed(jobId: string, error: string): Promise<void> {
    await DB.query(
      singleLineString`
        update message_job set status = 'failed', error = $1, finished_at = now(), updated_at = now() where uuid = $2
      `,
      [String(error).slice(0, 2000), jobId],
    );
  }

  // Decide a failed job's fate. `attempts` was already incremented when the job
  // was claimed, so it reflects the attempt that just failed. A BusinessErrorResult
  // is a permanent config problem (e.g. no active template) — no point retrying,
  // so fail immediately. Otherwise (transient/unexpected) we requeue with
  // exponential backoff until the cap, then fail terminally. Returns the resulting
  // status for the worker log.
  private async markFailedOrRetry(job: MessageJob, err: any): Promise<'retry' | 'failed'> {
    const message = err?.message || String(err);
    const permanent = err instanceof BusinessErrorResult;
    const attempts = job.attempts || 0;
    if (permanent || attempts >= RETRY.MAX_ATTEMPTS) {
      await this.markFailed(job.uuid, message);
      return 'failed';
    }
    const backoffSeconds = Math.min(
      RETRY.MAX_BACKOFF_SECONDS,
      RETRY.BASE_BACKOFF_SECONDS * Math.pow(2, attempts - 1),
    );
    const nextAt = new Date(Date.now() + backoffSeconds * 1000);
    await DB.query(
      singleLineString`
        update message_job
        set status = 'queued', scheduled_at = $1, worker_id = null, started_at = null,
            error = $2, updated_at = now()
        where uuid = $3
      `,
      [nextAt, String(message).slice(0, 2000), job.uuid],
    );
    return 'retry';
  }

  // ------------------------------------------------------------- webhook
  // Delivery-status callback. Updates a recipient by provider_message_id. Generic
  // shape; real adapters map their payload onto { providerMessageId, status }.
  public async recordDeliveryStatus(providerMessageId: string, status: string, error?: string): Promise<boolean> {
    const allowed = ['sent', 'delivered', 'read', 'failed'];
    if (!allowed.includes(status)) return false;
    const rows = await DB.query(
      singleLineString`
        update message_recipient set status = $1, error = coalesce($2, error), updated_at = now()
        where provider_message_id = $3
        returning uuid
      `,
      [status, error ? String(error).slice(0, 2000) : null, providerMessageId],
    );
    return rows.length > 0;
  }

  // --------------------------------------------------------- audience resolve
  // Resolve an audience spec to a deduped list of targets, each carrying its
  // contact numbers + auto-derived per-recipient variable context. Supports
  // The school's public code + name, for job-level auto context (e.g. signatures).
  private async getSchool(schoolId: string): Promise<any> {
    const rows = await DB.query(
      singleLineString`select code, name from school where uuid = $1`,
      [schoolId],
    );
    return rows[0] || {};
  }

  // student ids/classes/all, employee ids/roles/all, and transport route(s).
  // (wingId is reserved.)
  private async resolveTargets(schoolId: string, audience?: AudienceSpec): Promise<AudienceTarget[]> {
    const byKey = new Map<string, AudienceTarget>();
    if (!audience) return [];

    const studentRows: any[] = [];
    const s = audience.students;
    if (s) {
      if (s.studentIds && s.studentIds.length > 0) {
        studentRows.push(...await DB.query(
          singleLineString`select * from student where school_id = $1 and status = 'active' and uuid = any($2)`,
          [schoolId, s.studentIds],
        ));
      }
      if (s.classIds && s.classIds.length > 0) {
        const params: any[] = [schoolId, s.classIds];
        let yearClause = '';
        if (s.academicYearId) { yearClause = ' and sc.academic_year_id = $3'; params.push(s.academicYearId); }
        studentRows.push(...await DB.query(
          singleLineString`
            select st.* from student st
            join student_class sc on sc.student_id = st.uuid and sc.school_id = st.school_id
            where st.school_id = $1 and st.status = 'active' and sc.class_id = any($2)${yearClause}
          `,
          params,
        ));
      }
      if (s.all) {
        studentRows.push(...await DB.query(
          singleLineString`select * from student where school_id = $1 and status = 'active'`,
          [schoolId],
        ));
      }
    }

    const employeeRows: any[] = [];
    const e = audience.employees;
    if (e) {
      if (e.employeeIds && e.employeeIds.length > 0) {
        employeeRows.push(...await DB.query(
          singleLineString`select * from employee where school_id = $1 and status = 'active' and uuid = any($2)`,
          [schoolId, e.employeeIds],
        ));
      }
      if (e.roleIds && e.roleIds.length > 0) {
        employeeRows.push(...await DB.query(
          singleLineString`
            select emp.* from employee emp
            join employee_role er on er.employee_id = emp.uuid and er.school_id = emp.school_id
            where emp.school_id = $1 and emp.status = 'active' and er.role_id = any($2)
          `,
          [schoolId, e.roleIds],
        ));
      }
      if (e.all) {
        employeeRows.push(...await DB.query(
          singleLineString`select * from employee where school_id = $1 and status = 'active'`,
          [schoolId],
        ));
      }
    }

    // Transport routes: assigned students and/or route staff (teacher/helper/incharge).
    const t = audience.transport;
    if (t && t.routeIds && t.routeIds.length > 0) {
      if (t.includeStudents !== false) {
        const params: any[] = [schoolId, t.routeIds];
        let yearClause = '';
        if (t.academicYearId) { yearClause = ' and tsa.academic_year_id = $3'; params.push(t.academicYearId); }
        studentRows.push(...await DB.query(
          singleLineString`
            select st.* from student st
            join transport_student_assignment tsa on tsa.student_id = st.uuid and tsa.school_id = st.school_id
            where st.school_id = $1 and st.status = 'active' and tsa.status = 'active'
              and tsa.route_id = any($2)${yearClause}
          `,
          params,
        ));
      }
      if (t.includeStaff !== false) {
        const routes = await DB.query(
          singleLineString`
            select accompanying_teacher_id, helper_id, route_incharge_id
            from transport_route where school_id = $1 and status = 'active' and uuid = any($2)
          `,
          [schoolId, t.routeIds],
        );
        const staffIds = Array.from(new Set(
          routes.flatMap((r: any) => [r.accompanyingTeacherId, r.helperId, r.routeInchargeId])
            .filter((id: any) => !!id),
        ));
        if (staffIds.length > 0) {
          employeeRows.push(...await DB.query(
            singleLineString`select * from employee where school_id = $1 and status = 'active' and uuid = any($2)`,
            [schoolId, staffIds],
          ));
        }
      }
    }

    for (const row of studentRows) {
      const key = `student:${row.uuid}`;
      if (byKey.has(key)) continue;
      byKey.set(key, {
        recipientType: 'student',
        recipientId: row.uuid,
        name: row.name,
        preference: row.communicationPreference,
        numbers: studentNumbers(row),
        context: autoContext('student', row),
      });
    }
    for (const row of employeeRows) {
      const key = `employee:${row.uuid}`;
      if (byKey.has(key)) continue;
      byKey.set(key, {
        recipientType: 'employee',
        recipientId: row.uuid,
        name: row.name,
        preference: row.communicationPreference,
        numbers: employeeNumbers(row),
        context: autoContext('employee', row),
      });
    }

    return Array.from(byKey.values());
  }
}

// A short human label for the job list UI.
function audienceSummary(audience: AudienceSpec): string {
  const parts: string[] = [];
  const s = audience.students;
  if (s) {
    if (s.all) parts.push('All students');
    else if (s.studentIds?.length) parts.push(`${s.studentIds.length} student(s)`);
    else if (s.classIds?.length) parts.push(`${s.classIds.length} class(es)`);
  }
  const e = audience.employees;
  if (e) {
    if (e.all) parts.push('All employees');
    else if (e.employeeIds?.length) parts.push(`${e.employeeIds.length} employee(s)`);
    else if (e.roleIds?.length) parts.push(`${e.roleIds.length} role(s)`);
  }
  const tr = audience.transport;
  if (tr && tr.routeIds?.length) parts.push(`${tr.routeIds.length} transport route(s)`);
  return parts.join(' + ') || 'No audience';
}

export const messageService = new MessageService();
