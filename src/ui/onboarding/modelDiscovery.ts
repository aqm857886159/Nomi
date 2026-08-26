import type { TFunction } from 'i18next'
import type { DesktopExistingConnectionSummary } from '../../desktop/onboardingBridgeTypes'
import type { ModelListFailureKind } from '../../../electron/ai/onboarding/modelListResponse'
import type { PickerModel } from './ModelPickerScreen'

export type PickerDiscoveryResult = {
  ok: boolean
  models?: string[]
  error?: string
  status?: number
  failureKind?: ModelListFailureKind
  partial?: boolean
  connection?: DesktopExistingConnectionSummary
  code?: string
}

export type GuessModelKinds = (input: { ids: string[] }) => Promise<{ kinds: Record<string, string> }>

export function modelDiscoveryMessage(result: PickerDiscoveryResult, hasExisting: boolean): {
  key: Parameters<TFunction>[0] | null
  values?: { error: string }
} {
  if (result.ok) return { key: result.partial ? 'modelSetup.discoveryPartial' : result.models?.length ? null : 'modelSetup.noModelsListedHint' }
  const connectionErrors = {
    CONNECTION_NOT_FOUND: 'modelSetup.existingConnectionError.CONNECTION_NOT_FOUND',
    BASE_URL_MISSING: 'modelSetup.existingConnectionError.BASE_URL_MISSING',
    CREDENTIAL_MISSING: 'modelSetup.existingConnectionError.CREDENTIAL_MISSING',
  } as const
  if (result.code && result.code in connectionErrors) {
    return { key: connectionErrors[result.code as keyof typeof connectionErrors] }
  }
  if (result.failureKind === 'unsupported') {
    return { key: hasExisting ? 'modelSetup.discoveryUnsupportedExisting' : 'modelSetup.discoveryUnsupported' }
  }
  const keys = {
    auth: 'modelSetup.discoveryError.auth',
    rate_limit: 'modelSetup.discoveryError.rate_limit',
    network: 'modelSetup.discoveryError.network',
    invalid_response: 'modelSetup.discoveryError.invalid_response',
    upstream: 'modelSetup.discoveryError.upstream',
  } as const
  const error = (result.error || '').trim() || (result.status ? `HTTP ${result.status}` : '')
  return {
    key: result.failureKind ? keys[result.failureKind] : error ? 'modelSetup.noModelsFetchedWithReason' : 'modelSetup.noModelsFetchedHint',
    values: { error },
  }
}

/** Shared request-to-picker projection; only the hook owns rendering and request lifetime. */
export async function runModelDiscovery({ load, guessKinds, existing, previous, isCurrent }: {
  load: () => Promise<PickerDiscoveryResult>
  guessKinds?: GuessModelKinds
  existing: PickerModel[]
  previous: PickerModel[]
  isCurrent: () => boolean
}): Promise<{ result: PickerDiscoveryResult; candidates: PickerModel[]; remoteTotal: number } | undefined> {
  let result: PickerDiscoveryResult
  try { result = await load() } catch (error) {
    result = { ok: false, failureKind: 'network', error: error instanceof Error ? error.message : String(error) }
  }
  if (!isCurrent()) return undefined
  const remoteIds = result.ok ? [...new Set((result.models || []).map(id => id.trim()).filter(Boolean))] : []
  const saved = result.connection?.existingModels.map(model => ({ id: model.modelKey, kind: model.kind })) ?? existing
  const savedKinds = new Map(saved.map(model => [model.id, model.kind]))
  if (!result.ok) {
    const retained = new Map([...previous, ...saved].map(model => [model.id, model]))
    return { result, candidates: [...retained.values()], remoteTotal: 0 }
  }
  let kinds: Record<string, string> = {}
  const newIds = remoteIds.filter(id => !savedKinds.has(id))
  if (newIds.length && guessKinds) {
    try { kinds = (await guessKinds({ ids: newIds })).kinds || {} } catch { /* Kind inference is optional. */ }
  }
  if (!isCurrent()) return undefined
  return {
    result,
    candidates: [...new Set([...savedKinds.keys(), ...remoteIds])].map(id => ({ id, kind: savedKinds.get(id) ?? kinds[id] ?? 'text' })),
    remoteTotal: remoteIds.length,
  }
}
