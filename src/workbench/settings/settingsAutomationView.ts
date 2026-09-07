import {
  DEFAULT_AUTOMATION_POLICY_SETTINGS,
  type AutomationPolicySettings,
} from '../../../electron/settings/automationPolicyContract'

/** @deprecated 泛化后 trustedHost key 是任意合法字符串；保留此 alias 供存量引用方向后迁移。 */
export type SettingsHostKey = string
/**
 * `no-models`：连上了、但这家一个可用模型都没有。
 *
 * 补这一态是因为旧口径只看「供应商启用 + 有 key」就报绿色「已连接」——那是**连接**层面的真话、
 * **能不能干活**层面的假话。用户接了一家中转、设置页一片绿，生成时却处处「没有可用图像模型」，
 * 而这一页没有一个字对得上。徽标只能回答「连上没有」，回答不了「能干什么」，所以另给能力摘要。
 */
export type ProviderHealthState = 'connected' | 'local' | 'needs-key' | 'disabled' | 'no-models'

export type SettingsProviderInput = {
  key: string
  name: string
  enabled: boolean
  authType?: string
  hasApiKey?: boolean
}

export type SettingsModelInput = {
  vendorKey: string
  kind: string
  enabled?: boolean
}

export type ProviderHealthRow = {
  key: string
  name: string
  state: ProviderHealthState
  /** 这家按类型的可用模型数（已启用），展示序固定。空数组 = 没有可用模型。 */
  capabilities: Array<{ kind: string; count: number }>
}

/** 能力摘要的展示序（与抽屉能力条同序，两处读起来是一件事）。 */
const CAPABILITY_KIND_ORDER = ['text', 'image', 'video', 'audio', 'model3d']

const HOSTS: SettingsHostKey[] = ['nomi', 'claude', 'codex', 'cursor', 'pi']

export function defaultAutomationPolicySettings(): AutomationPolicySettings {
  return {
    ...DEFAULT_AUTOMATION_POLICY_SETTINGS,
    trustedHosts: [...DEFAULT_AUTOMATION_POLICY_SETTINGS.trustedHosts],
    allowedProviders: [],
    allowedModels: [],
  }
}

export function buildAutomationSettingsView(settings: AutomationPolicySettings) {
  return {
    mode: settings.mode,
    hosts: HOSTS.map((key) => ({
      key,
      enabled: key === 'nomi' || settings.trustedHosts.includes(key),
      locked: key === 'nomi',
    })),
    mandatoryGates: ['first-spend', 'irreversible'] as const,
  }
}

/**
 * 供应商健康 + 能力摘要。
 *
 * `modelsLoaded` 不能省：模型清单是异步取的，未取回时 `models` 是空数组——若照直判就会把每一家都
 * 先闪成「无可用模型」再跳回「已连接」。未加载完时**不降级**，宁可短暂少说一句，也不先说错一句。
 */
export function buildProviderHealthView(
  providers: SettingsProviderInput[],
  models: SettingsModelInput[] = [],
  options: { modelsLoaded?: boolean } = {},
): ProviderHealthRow[] {
  const countsByVendor = new Map<string, Map<string, number>>()
  for (const model of models) {
    if (model.enabled === false) continue
    const byKind = countsByVendor.get(model.vendorKey) ?? new Map<string, number>()
    byKind.set(model.kind, (byKind.get(model.kind) ?? 0) + 1)
    countsByVendor.set(model.vendorKey, byKind)
  }

  return providers.map((provider) => {
    const byKind = countsByVendor.get(provider.key)
    const capabilities = byKind
      ? [...byKind.entries()]
          .sort((left, right) => {
            const li = CAPABILITY_KIND_ORDER.indexOf(left[0])
            const ri = CAPABILITY_KIND_ORDER.indexOf(right[0])
            // 未知 kind（将来新增的第六类）排在已知之后，不丢也不崩。
            return (li < 0 ? CAPABILITY_KIND_ORDER.length : li) - (ri < 0 ? CAPABILITY_KIND_ORDER.length : ri)
          })
          .map(([kind, count]) => ({ kind, count }))
      : []

    let state: ProviderHealthState = 'disabled'
    if (provider.enabled && provider.authType === 'none') state = 'local'
    else if (provider.enabled && provider.hasApiKey) state = 'connected'
    else if (provider.enabled) state = 'needs-key'
    // 只降级「本该是绿的」那两态：needs-key/disabled 各自已经说清了问题，再改口反而丢信息。
    if (options.modelsLoaded && capabilities.length === 0 && (state === 'connected' || state === 'local')) {
      state = 'no-models'
    }
    return { key: provider.key, name: provider.name, state, capabilities }
  })
}
