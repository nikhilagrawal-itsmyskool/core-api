import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { Channel, DEFAULTS, RETRY } from './communication-constants';
import {
  AudienceSpec, AudienceTarget, MessageJob, MessageRecipient,
  SendMessageRequest, PreviewRequest,
} from './communication-interfaces';
import { resolveLadder, resolveVariables, studentNumbers, employeeNumbers, autoContext, schoolContext } from './communication-util';
import { templateService } from './template-service';
import { getProvider } from './providers';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class MessageService {
  // ----------------------------------------------------------------- enqueue
  // Create a queued job storing its audience spec. No recipient rows yet — the
  // worker resolves the population lazily at send time (live roster).
  public async enqueue(schoolId: string, req: SendMessageRequest, userId: string): Promise<string> {
    if (!req.templateKey || !req.templateKey.trim()) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'templateKey is required');
    }
    if (!req.audience || (!req.audience.students && !req.audience.employees)) {
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
  // Claim one DUE queued job and process it. Called by the worker poller.
  public async processNext(workerId: string): Promise<{ claimed: boolean; jobId?: string; status?: string; counts?: any; error?: string }> {
    const claimed = await DB.query(
      singleLineString`
        update message_job
        set status = 'running', worker_id = $1, heartbeat_at = now(), started_at = now(),
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
      const counts = await this.expandAndSend(job);
      return { claimed: true, jobId: job.uuid, status: 'completed', counts };
    } catch (err: any) {
      const message = err.message || String(err);
      const outcome = await this.markFailedOrRetry(job, err);
      return { claimed: true, jobId: job.uuid, status: outcome, error: message };
    }
  }

  private async expandAndSend(job: MessageJob): Promise<any> {
    const language = job.language || DEFAULTS.LANGUAGE;
    const templates = await templateService.getActiveByKey(job.schoolId, job.templateKey, language);
    const availableChannels = new Set<Channel>(templates.keys());
    if (availableChannels.size === 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `No active template for key "${job.templateKey}"`);
    }

    const targets = await this.resolveTargets(job.schoolId, job.audience);
    const provider = getProvider();
    const schoolCtx = schoolContext(await this.getSchool(job.schoolId));
    const counts = { sent: 0, failed: 0, skipped: 0 };

    for (const t of targets) {
      const match = resolveLadder(t, availableChannels, job.forceChannel);
      if (!match) {
        await this.insertRecipient(job, t, null, null, null, 'skipped', { error: 'no reachable channel with an approved template' });
        counts.skipped++;
        continue;
      }
      const template = templates.get(match.channel)!;
      const ctx = { ...(job.context || {}), ...t.context, ...schoolCtx };
      const { values, missing } = resolveVariables(template.variables, ctx);
      if (missing.length > 0) {
        await this.insertRecipient(job, t, match, template.uuid, ctx, 'skipped', { error: `missing variables: ${missing.join(', ')}` });
        counts.skipped++;
        continue;
      }
      try {
        const result = await provider.send({
          channel: match.channel,
          toNumber: match.toNumber,
          templateKey: job.templateKey,
          providerTemplateId: template.providerTemplateId,
          language,
          variables: values,
          variableNames: template.variables,
          headerType: template.headerType,
        });
        const status = result.status === 'sent' ? 'sent' : 'failed';
        await this.insertRecipient(job, t, match, template.uuid, ctx, status, {
          providerMessageId: result.providerMessageId,
          error: result.error,
          sentAt: status === 'sent' ? new Date() : undefined,
        });
        if (status === 'sent') counts.sent++; else counts.failed++;
      } catch (err: any) {
        await this.insertRecipient(job, t, match, template.uuid, ctx, 'failed', { error: err.message || String(err) });
        counts.failed++;
      }
    }

    await this.markCompleted(job.uuid, counts);
    return counts;
  }

  private async insertRecipient(
    job: MessageJob,
    target: AudienceTarget,
    match: { role: string; channel: string; toNumber: string } | null,
    templateId: string | null,
    ctx: Record<string, any> | null,
    status: string,
    extra: { providerMessageId?: string; error?: string; sentAt?: Date },
  ): Promise<void> {
    await DB.query(
      singleLineString`
        insert into message_recipient
        (uuid, school_id, job_id, recipient_type, recipient_id, role, to_number, channel, template_id, context, status, provider_message_id, error, sent_at, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `,
      [
        generateShortUuid(12), job.schoolId, job.uuid, target.recipientType, target.recipientId,
        match ? match.role : null, match ? match.toNumber : null, match ? match.channel : null,
        templateId, ctx ? JSON.stringify(ctx) : null, status,
        extra.providerMessageId || null, extra.error ? String(extra.error).slice(0, 2000) : null,
        extra.sentAt || null, job.createdbyUserid || 'worker', new Date(),
      ],
    );
  }

  private async markCompleted(jobId: string, counts: any): Promise<void> {
    await DB.query(
      singleLineString`
        update message_job set status = 'completed', finished_at = now(), updated_at = now() where uuid = $1
      `,
      [jobId],
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

  // student ids/classes/all and employee ids/roles/all. (wingId is reserved.)
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
  return parts.join(' + ') || 'No audience';
}

export const messageService = new MessageService();
