import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { messageService } from './message-service';
import { SendMessageRequest, PreviewRequest } from './communication-interfaces';

class MessageHandler {
  public send = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<SendMessageRequest>(event, callback);
      if (!body) return;
      const jobId = await messageService.enqueue(ctx.schoolId, body, ctx.userId);
      ResponseBuilder.ok({ jobId, status: 'queued' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public preview = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<PreviewRequest>(event, callback);
      if (!body) return;
      if (!body.templateKey) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'templateKey is required', callback); return; }
      const result = await messageService.preview(ctx.schoolId, body);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const jobs = await messageService.list(ctx.schoolId);
      ResponseBuilder.ok({ jobs }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getById = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const job = await messageService.getById(id, ctx.schoolId);
      if (!job) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Message job not found', callback); return; }
      ResponseBuilder.ok(job, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public cancel = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const job = await messageService.cancel(id, ctx.schoolId, ctx.userId);
      if (!job) { ResponseBuilder.badRequest(ErrorCode.BusinessError, 'Only a queued job can be canceled', callback); return; }
      ResponseBuilder.ok(job, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Internal: claim and process one due job. Called by the worker poller /
  // EventBridge. Not school-scoped (operates across all schools' queues).
  public processNext = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const body = event.body ? JSON.parse(event.body) : {};
      const workerId = (body.workerId || 'worker').toString().slice(0, 64);
      const result = await messageService.processNext(workerId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Internal: drain the queue. The AWS worker — invoked by an EventBridge
  // schedule (rate(1 minute)) rather than an HTTP request. Loops processNext
  // until the queue is empty or a time budget (kept under the function timeout)
  // is spent, so a burst clears in one tick instead of one job per minute.
  // Concurrency-safe via `for update skip locked`; reservedConcurrency:1 avoids
  // overlapping drains piling up.
  public drain = async (_event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    const workerId = `drain-${(context as any).awsRequestId || Date.now()}`.slice(0, 64);
    const deadline = Date.now() + 50_000; // stay under the 60s function timeout
    const tally = { processed: 0, completed: 0, retried: 0, failed: 0 };
    try {
      while (Date.now() < deadline) {
        const r = await messageService.processNext(workerId);
        if (!r.claimed) break; // queue drained
        tally.processed++;
        if (r.status === 'completed') tally.completed++;
        else if (r.status === 'retry') tally.retried++;
        else if (r.status === 'failed') tally.failed++;
      }
      ResponseBuilder.ok(tally, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Provider delivery-status callback. Authenticated by a provider secret in real
  // adapters; the stub never calls it. Generic payload: { providerMessageId, status }.
  public webhook = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const body = event.body ? JSON.parse(event.body) : {};
      const providerMessageId = body.providerMessageId || body.messageId;
      const status = body.status;
      if (!providerMessageId || !status) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'providerMessageId and status are required', callback); return; }
      const updated = await messageService.recordDeliveryStatus(providerMessageId, status, body.error);
      ResponseBuilder.ok({ updated }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new MessageHandler();
export const send = handler.send;
export const preview = handler.preview;
export const list = handler.list;
export const getById = handler.getById;
export const cancel = handler.cancel;
export const processNext = handler.processNext;
export const drain = handler.drain;
export const webhook = handler.webhook;
