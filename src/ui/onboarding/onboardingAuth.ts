import type { ProviderKind } from '../../desktop/providerKind'

export type OnboardingAuth = {
  apiKey: string
  authType: 'none' | 'bearer' | 'x-api-key'
  authHeader?: string
}

export function resolveOnboardingAuth(
  providerKind: ProviderKind,
  userApiKey: string,
  noApiKey: boolean,
): OnboardingAuth {
  if (noApiKey) return { apiKey: '', authType: 'none' }
  if (providerKind === 'google-generative-ai') return { apiKey: userApiKey.trim(), authType: 'x-api-key', authHeader: 'x-goog-api-key' }
  return {
    apiKey: userApiKey.trim(),
    authType: providerKind === 'anthropic' ? 'x-api-key' : 'bearer',
  }
}

export function isOnboardingApiKeyReady(userApiKey: string, noApiKey: boolean): boolean {
  return noApiKey || userApiKey.trim().length > 0
}
