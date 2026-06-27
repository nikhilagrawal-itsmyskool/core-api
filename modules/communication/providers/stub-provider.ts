import { MessageProvider, SendParams, SendResult } from './provider-interface';
const { generateShortUuid } = require('../../../shared/util/generate-uuid.js');

// Local/dev provider: logs the would-be send and returns a synthetic message id.
// Lets the whole module (queue, ladder, expansion, status) work end-to-end with
// no live BSP account. Swap to a real adapter via COMM_PROVIDER.
export class StubProvider implements MessageProvider {
  public readonly name = 'stub';

  public async send(params: SendParams): Promise<SendResult> {
    const providerMessageId = `stub-${generateShortUuid(12)}`;
    console.log(
      `[comm:stub] send channel=${params.channel} to=${params.toNumber} ` +
      `template=${params.templateKey} providerTemplateId=${params.providerTemplateId || '-'} ` +
      `vars=${JSON.stringify(params.variables)} -> ${providerMessageId}`,
    );
    return { providerMessageId, status: 'sent' };
  }
}
