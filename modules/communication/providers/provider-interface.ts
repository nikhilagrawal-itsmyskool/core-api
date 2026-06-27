import { Channel } from '../communication-constants';

// One outbound message to a single recipient, already resolved (number, channel,
// concrete provider template id, and ordered variable values).
export interface SendParams {
  channel: Channel;
  toNumber: string;
  templateKey: string;
  providerTemplateId?: string;
  language?: string;
  variables: string[];
  // Ordered variable names parallel to `variables` (from the template). Used by
  // providers like MSG91 SMS Flow that key variables by name rather than position.
  variableNames?: string[];
  headerType?: string;
}

export interface SendResult {
  providerMessageId: string;
  status: 'sent' | 'failed';
  error?: string;
}

// Provider-agnostic gateway. Real BSP adapters (MSG91 / Gupshup / Twilio) and the
// local stub all implement this, so callers never depend on a specific provider.
export interface MessageProvider {
  readonly name: string;
  send(params: SendParams): Promise<SendResult>;
}
