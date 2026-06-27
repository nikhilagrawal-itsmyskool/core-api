import { MessageProvider, SendParams, SendResult } from './provider-interface';

// MSG91 v5 endpoints.
const FLOW_URL = 'https://api.msg91.com/api/v5/flow/';
const WHATSAPP_URL = 'https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/';

// Normalize a phone number to MSG91's expected international format (digits only,
// country code prefixed, no '+'). A bare 10-digit number gets the default CC.
export function normalizeMobile(raw: string, defaultCc = '91'): string {
  let d = String(raw || '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10) d = `${defaultCc}${d}`;
  return d;
}

// SMS Flow body. providerTemplateId = MSG91 flow_id. Variables are sent as NAMED
// params (the flow must declare the same variable names as the template).
export function buildSmsBody(params: SendParams, sender: string, defaultCc = '91') {
  const recipient: Record<string, any> = { mobiles: normalizeMobile(params.toNumber, defaultCc) };
  const names = params.variableNames || [];
  params.variables.forEach((value, i) => {
    recipient[names[i] || `VAR${i + 1}`] = value;
  });
  return { flow_id: params.providerTemplateId, sender, recipients: [recipient] };
}

// WhatsApp template body. providerTemplateId = approved template name. Variables
// map positionally to body_1..n components.
export function buildWhatsappBody(params: SendParams, integratedNumber: string, defaultCc = '91') {
  const components: Record<string, any> = {};
  params.variables.forEach((value, i) => {
    components[`body_${i + 1}`] = { type: 'text', value };
  });
  return {
    integrated_number: integratedNumber,
    content_type: 'template',
    payload: {
      messaging_product: 'whatsapp',
      type: 'template',
      template: {
        name: params.providerTemplateId,
        language: { code: params.language || 'en', policy: 'deterministic' },
        to_and_components: [
          { to: [normalizeMobile(params.toNumber, defaultCc)], components },
        ],
      },
    },
  };
}

// MSG91 BSP adapter (SMS Flow + WhatsApp templates). Selected via COMM_PROVIDER=msg91.
// Reads credentials from env (configs/{stage}.yml → process.env). NOTE: built to
// MSG91's documented v5 shapes but not runtime-verified without a live account —
// confirm the exact WhatsApp component mapping against your integrated number.
export class Msg91Provider implements MessageProvider {
  public readonly name = 'msg91';
  private readonly authKey = process.env.MSG91_AUTH_KEY || '';
  private readonly sender = process.env.MSG91_SMS_SENDER || '';
  private readonly whatsappNumber = process.env.MSG91_WHATSAPP_NUMBER || '';
  private readonly defaultCc = process.env.MSG91_DEFAULT_COUNTRY_CODE || '91';

  public async send(params: SendParams): Promise<SendResult> {
    if (!this.authKey) {
      return { providerMessageId: '', status: 'failed', error: 'MSG91_AUTH_KEY not configured' };
    }
    try {
      return params.channel === 'sms' ? await this.sendSms(params) : await this.sendWhatsapp(params);
    } catch (err: any) {
      return { providerMessageId: '', status: 'failed', error: err?.message || String(err) };
    }
  }

  private async sendSms(params: SendParams): Promise<SendResult> {
    const body = buildSmsBody(params, this.sender, this.defaultCc);
    const res = await fetch(FLOW_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: this.authKey },
      body: JSON.stringify(body),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || data?.type === 'error') {
      return { providerMessageId: '', status: 'failed', error: data?.message || `HTTP ${res.status}` };
    }
    return { providerMessageId: String(data?.request_id || data?.message || ''), status: 'sent' };
  }

  private async sendWhatsapp(params: SendParams): Promise<SendResult> {
    const body = buildWhatsappBody(params, this.whatsappNumber, this.defaultCc);
    const res = await fetch(WHATSAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: this.authKey },
      body: JSON.stringify(body),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || data?.type === 'error' || data?.status === 'error') {
      return { providerMessageId: '', status: 'failed', error: data?.message || `HTTP ${res.status}` };
    }
    return {
      providerMessageId: String(data?.request_id || data?.data?.request_id || data?.messageId || ''),
      status: 'sent',
    };
  }
}
