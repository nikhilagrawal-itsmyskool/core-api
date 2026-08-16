import { ACTIONS } from '../../shared/lib/authz-policy';

// The conversational assistant is god-only (assistant.use is granted to no role, so
// only god's '*' passes). Replaces the module's hand-rolled isGodCaller check.
const { ASSISTANT_USE } = ACTIONS;

export const ASSISTANT_ACTIONS: Record<string, string> = {
  'assistant-handler.ask': ASSISTANT_USE,
};

export const ASSISTANT_PUBLIC: string[] = ['health-handler.health'];
