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

/**
 * 存完 key 那一刻的发现结果 → 一句话。
 *
 * 为什么要这条：存 key 现在会**就地**走一次真发现（`nomi:integration-session:credential` 通道）。
 * 发现抛错时错误沿 IPC 冒回调用方、已经会显示；发现「成功但返回空清单」时不抛错——旧写法于是
 * 直接 onClose()，用户看到的只是「抽屉一关、什么都没有」，和 P0-2 里「自己手打 model id」是同一
 * 个病。空清单必须和失败一样响：说清为什么空。返回 null = 没有任何阻塞，可以正常收尾。
 */
export function credentialSaveNotice(projection: unknown): {
  key: Parameters<TFunction>[0]
  values?: { reason: string }
} | null {
  if (!projection || typeof projection !== 'object') return null
  const blocking = (projection as Record<string, unknown>).blockingReason
  const code =
    blocking && typeof blocking === 'object' ? (blocking as Record<string, unknown>).code : undefined
  if (typeof code !== 'string' || !code) return null
  // 唯一「不抛错但也没结果」的出口；其余码原样带出去，绝不静默吞掉。
  if (code === 'model_discovery_empty') return { key: 'modelSetup.credentialSavedNoModels' }
  return { key: 'modelSetup.credentialSavedBlocked', values: { reason: code } }
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
