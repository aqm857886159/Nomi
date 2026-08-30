import type { TFunction } from 'i18next'
import type { ExistingConnectionErrorCode } from '../../desktop/onboardingBridgeTypes'

const KNOWN_CODES = new Set<ExistingConnectionErrorCode>([
  'CONNECTION_NOT_FOUND', 'BASE_URL_MISSING', 'CREDENTIAL_MISSING', 'MODEL_LIST_UNAVAILABLE',
  'NO_MODELS_SELECTED', 'RUN_NOT_FOUND', 'RUN_ACTIVE', 'RUN_MODELS_MISSING', 'START_FAILED',
])

export function certificationFailureMessage(t: TFunction, code: unknown): string {
  return KNOWN_CODES.has(code as ExistingConnectionErrorCode)
    ? t(`modelSetup.existingConnectionError.${code as ExistingConnectionErrorCode}`)
    : t('modelSetup.saveFailedHint')
}

export class CertificationUiError extends Error {
  constructor(readonly code: ExistingConnectionErrorCode) {
    super(code)
    this.name = 'CertificationUiError'
  }
}
