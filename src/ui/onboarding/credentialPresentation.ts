export type CredentialCopyKey =
  | 'onboardingProviders.keyOnly.offlineTitle'
  | 'onboardingProviders.keyOnly.publishedTitle'
  | 'onboardingProviders.keyOnly.pendingTitle'
  | 'onboardingProviders.keyOnly.savedTitle'

export type CredentialHintKey =
  | 'onboardingProviders.keyOnly.offlineHint'
  | 'onboardingProviders.keyOnly.publishedHint'
  | 'onboardingProviders.keyOnly.pendingHint'
  | 'onboardingProviders.keyOnly.savedHint'

export function resolveCredentialCopy({
  credentialMaterialSaved,
  verificationPending,
  curatedModelsPublished,
}: {
  credentialMaterialSaved: boolean
  verificationPending: boolean
  curatedModelsPublished: boolean
}): { titleKey: CredentialCopyKey; hintKey: CredentialHintKey } {
  if (verificationPending) {
    return {
      titleKey: 'onboardingProviders.keyOnly.offlineTitle',
      hintKey: 'onboardingProviders.keyOnly.offlineHint',
    }
  }
  if (curatedModelsPublished) {
    return {
      titleKey: 'onboardingProviders.keyOnly.publishedTitle',
      hintKey: 'onboardingProviders.keyOnly.publishedHint',
    }
  }
  if (credentialMaterialSaved) {
    return {
      titleKey: 'onboardingProviders.keyOnly.pendingTitle',
      hintKey: 'onboardingProviders.keyOnly.pendingHint',
    }
  }
  return {
    titleKey: 'onboardingProviders.keyOnly.savedTitle',
    hintKey: 'onboardingProviders.keyOnly.savedHint',
  }
}
