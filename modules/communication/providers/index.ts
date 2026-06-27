import { MessageProvider } from './provider-interface';
import { StubProvider } from './stub-provider';
import { Msg91Provider } from './msg91-provider';

// Select the active provider by config (COMM_PROVIDER). Defaults to the stub.
export function getProvider(): MessageProvider {
  const name = (process.env.COMM_PROVIDER || 'stub').toLowerCase();
  switch (name) {
    case 'msg91':
      return new Msg91Provider();
    case 'stub':
    default:
      return new StubProvider();
  }
}

export { MessageProvider, SendParams, SendResult } from './provider-interface';
