export type CredentialCopyKey =
  | 'onboardingProviders.keyOnly.offlineTitle'
  | 'onboardingProviders.keyOnly.recheckedTitle'
  | 'onboardingProviders.keyOnly.publishedTitle'
  | 'onboardingProviders.keyOnly.pendingTitle'
  | 'onboardingProviders.keyOnly.savedTitle'

export type CredentialHintKey =
  | 'onboardingProviders.keyOnly.offlineHint'
  | 'onboardingProviders.keyOnly.recheckedHint'
  | 'onboardingProviders.keyOnly.publishedHint'
  | 'onboardingProviders.keyOnly.pendingHint'
  | 'onboardingProviders.keyOnly.savedHint'

/** Tone of the shared StatusBadge for the states that are a badge-sized fact (see StatusBadge in src/design). */
export type CredentialBadgeTone = 'warning' | 'info'

/**
 * "Is a key stored for this vendor" is a fact about the stored credential. The replace-key form is only a
 * view mode, so it must never feed this answer (a rejected replacement keeps the old key).
 */
export function resolveCredentialStored({
  credentialMaterialSaved,
  hasApiKey,
  savedHere,
}: {
  credentialMaterialSaved: boolean
  hasApiKey: boolean
  savedHere: boolean
}): boolean {
  return credentialMaterialSaved || hasApiKey || savedHere
}

export function resolveCredentialCopy({
  credentialMaterialSaved,
  verificationPending,
  curatedModelsPublished,
  keyRechecked = false,
}: {
  credentialMaterialSaved: boolean
  verificationPending: boolean
  curatedModelsPublished: boolean
  /** The pending flag was cleared by an automatic re-check: the key is confirmed, models are not. */
  keyRechecked?: boolean
}): { titleKey: CredentialCopyKey; hintKey: CredentialHintKey; badgeTone?: CredentialBadgeTone } {
  if (verificationPending) {
    return {
      titleKey: 'onboardingProviders.keyOnly.offlineTitle',
      hintKey: 'onboardingProviders.keyOnly.offlineHint',
      badgeTone: 'warning',
    }
  }
  if (curatedModelsPublished) {
    return {
      titleKey: 'onboardingProviders.keyOnly.publishedTitle',
      hintKey: 'onboardingProviders.keyOnly.publishedHint',
    }
  }
  if (credentialMaterialSaved && keyRechecked) {
    return {
      titleKey: 'onboardingProviders.keyOnly.recheckedTitle',
      hintKey: 'onboardingProviders.keyOnly.recheckedHint',
      badgeTone: 'info',
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
