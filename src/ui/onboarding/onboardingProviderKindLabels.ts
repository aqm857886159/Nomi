import type { ProviderKind } from '../../desktop/providerKind'

export const PROVIDER_KIND_LABEL: Record<ProviderKind, string> = {
  'openai-compatible': 'Chat Completions',
  'openai-responses': 'Responses',
  anthropic: 'Anthropic',
  'google-generative-ai': 'Gemini native',
}
