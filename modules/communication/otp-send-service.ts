import { DEFAULTS } from './communication-constants';
import { templateService } from './template-service';
import { getProvider } from './providers';

// Synchronous OTP send. Unlike the normal message flow (audience-expanded, queued,
// drained by a worker), an OTP must reach one known number RIGHT NOW so the caller
// (auth's recovery-service) can tell the user whether the code went out. So this
// bypasses the queue and calls the provider inline.
//
// Template: logical key 'otp', channel 'sms'. When no active template row exists
// (e.g. before the DLT template is approved, or in local dev) we still send via the
// stub provider with providerTemplateId undefined — the stub just logs it, which is
// exactly what local development needs.
class OtpSendService {
  public async send(schoolId: string, toNumber: string, code: string): Promise<{ status: 'sent' | 'failed'; providerMessageId?: string; error?: string }> {
    const language = DEFAULTS.LANGUAGE;
    const byChannel = await templateService.getActiveByKey(schoolId, 'otp', language);
    const template = byChannel.get('sms');

    const provider = getProvider();
    // A real BSP (MSG91) needs a registered flow id; without an active 'otp' template
    // there is nothing to send, so fail fast with a clear message instead of firing a
    // malformed request. The stub needs no template (it just logs), so let it through.
    if (!template && provider.name !== 'stub') {
      return { status: 'failed', error: "No active 'otp' SMS template configured" };
    }

    // The DLT OTP template carries a single numeric variable. Prefer the template's
    // declared variable name(s); fall back to ['otp'] so the stub/dev path works
    // even before a template row exists.
    const variableNames = template && Array.isArray(template.variables) && template.variables.length ? template.variables : ['otp'];

    const result = await provider.send({
      channel: 'sms',
      toNumber,
      templateKey: 'otp',
      providerTemplateId: template?.providerTemplateId,
      language,
      variables: [code],
      variableNames,
      headerType: template?.headerType,
    });

    return { status: result.status, providerMessageId: result.providerMessageId, error: result.error };
  }
}

export const otpSendService = new OtpSendService();
