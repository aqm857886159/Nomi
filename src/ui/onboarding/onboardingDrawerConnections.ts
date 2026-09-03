import { ANTIGRAVITY_IMAGE_MODEL_KEY, ANTIGRAVITY_VENDOR_KEY } from '../../../electron/shared/antigravity'
import { groupAntigravityCatalogModels } from './antigravityCardModel'
import { KNOWN_VENDORS, isKnownVendor } from '../../config/knownVendors'
import { isComfyuiVendorKey } from '../../workbench/generationCanvas/model/comfyuiVendor'
import type { ChipModel } from './ModelChipGroups'
import type { ModelSettingsHomeConnection } from './ModelSettingsHome'
import type { ModelSettingsPage } from './modelSettingsNavigation'
import type { OnboardingVendorMeta } from './useOnboardingDrawerCatalog'
import type { DreaminaStatus } from './DreaminaMemberCard'
import { COMFYUI_VENDOR_KEY } from './ComfyuiLocalCard'
import { CODEX_LOCAL_VENDOR_KEY } from './codexLocalProvider'
import { LOCAL_TEXT_VENDOR_KEY } from './LocalModelCard'
import { DREAMINA_CONNECTION_KEY } from './onboardingDrawerConstants'
import { groupOtherVendorModels } from './onboardingDrawerDerivations'

export function projectOnboardingConnections({ models, vendorMeta, dreaminaStatus, localNames, openPage }: {
  models: ChipModel[]
  vendorMeta: ReadonlyMap<string, OnboardingVendorMeta>
  dreaminaStatus: DreaminaStatus | null
  localNames: { dreamina: string; codex: string; antigravity: string }
  openPage: (page: Exclude<ModelSettingsPage, { type: 'home' }>) => void
}) {
  const knownCards = KNOWN_VENDORS
    .map((directory) => {
      const meta = vendorMeta.get(directory.vendorKey)
      if (!meta) return null
      const vendorModels = models.filter((m) => m.vendorKey === directory.vendorKey)
      return { directory, meta, vendorModels }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  // A stored credential is not a verified connection. Keep disabled/staged
  // vendors out of the normal connected projection until certification
  // promotion publishes a usable revision.
  const connectedKnown = knownCards.filter((c) => c.meta.hasApiKey && c.meta.enabled)
  const availableKnown = knownCards.filter((c) => !c.meta.hasApiKey || !c.meta.enabled)
  const otherModels = models.filter((m) =>
    !isKnownVendor(m.vendorKey) &&
    m.vendorKey !== 'dreamina' &&
    m.vendorKey !== COMFYUI_VENDOR_KEY &&
    m.vendorKey !== CODEX_LOCAL_VENDOR_KEY &&
    m.vendorKey !== LOCAL_TEXT_VENDOR_KEY &&
    m.vendorKey !== ANTIGRAVITY_VENDOR_KEY,
  )
  const otherVendorKeys = [...vendorMeta.keys()].filter((vendorKey) => (
    !isKnownVendor(vendorKey) &&
    vendorKey !== 'dreamina' &&
    vendorKey !== DREAMINA_CONNECTION_KEY &&
    !isComfyuiVendorKey(vendorKey) &&
    vendorKey !== CODEX_LOCAL_VENDOR_KEY &&
    vendorKey !== LOCAL_TEXT_VENDOR_KEY &&
    vendorKey !== ANTIGRAVITY_VENDOR_KEY
  ))

  const comfyuiInstances = [...vendorMeta.entries()]
    .filter(([key]) => isComfyuiVendorKey(key))
    .sort(([a], [b]) => (a === COMFYUI_VENDOR_KEY ? -1 : b === COMFYUI_VENDOR_KEY ? 1 : a.localeCompare(b)))
    .map(([key, meta]) => ({ key, meta, models: models.filter((m) => m.vendorKey === key) }))
  const comfyuiConnected = comfyuiInstances.filter((i) => i.meta.enabled)
  const comfyuiAvailableList = comfyuiInstances.filter((i) => !i.meta.enabled)

  const dreaminaAvailable = dreaminaStatus !== null
  const dreaminaConnected = !!(dreaminaStatus?.installed && dreaminaStatus?.loggedIn)
  const codexImageMeta = vendorMeta.get(CODEX_LOCAL_VENDOR_KEY)
  const codexImageAvailable = codexImageMeta !== undefined
  const codexImageEnabled = codexImageMeta?.enabled === true
  const localTextMeta = vendorMeta.get(LOCAL_TEXT_VENDOR_KEY)
  const localTextAvailable = localTextMeta !== undefined
  const localTextModels = models.filter((model) => model.vendorKey === LOCAL_TEXT_VENDOR_KEY)
  // 「已连」= vendor 开着且名下真有建档模型（种子默认 enabled:false；只翻 enabled 不建档不算连上）。
  const localTextConnected = localTextMeta?.enabled === true && localTextModels.length > 0

  const otherVendorGroups = groupOtherVendorModels(otherModels, vendorMeta, otherVendorKeys)
  const antigravityEnabled = vendorMeta.get(ANTIGRAVITY_VENDOR_KEY)?.enabled === true
  const antigravityModels = models.filter((model) => model.vendorKey === ANTIGRAVITY_VENDOR_KEY)

  const connectionTitle = (vendorKey: string): string => {
    const known = knownCards.find((card) => card.directory.vendorKey === vendorKey)
    if (known) return known.meta.name
    const custom = otherVendorGroups.find((group) => group.vendorKey === vendorKey)
    if (custom) return custom.name
    const comfy = comfyuiInstances.find((instance) => instance.key === vendorKey)
    if (comfy) return comfy.meta.name
    if (vendorKey === DREAMINA_CONNECTION_KEY) return localNames.dreamina
    if (vendorKey === CODEX_LOCAL_VENDOR_KEY) return localNames.codex
    // 本地模型走 vendor 自己的 name（种子里是「本地模型」），不另建 localName 键。
    if (vendorKey === LOCAL_TEXT_VENDOR_KEY) return localTextMeta?.name ?? vendorKey
    if (vendorKey === ANTIGRAVITY_VENDOR_KEY) return localNames.antigravity
    return vendorKey
  }

  const homeConnection = (
    value: Omit<ModelSettingsHomeConnection, 'onOpen'>,
    onOpen?: () => void,
  ): ModelSettingsHomeConnection => ({
    ...value,
    onOpen: onOpen ?? (() => openPage({ type: 'connection', vendorKey: value.vendorKey })),
  })

  const homeConnections: ModelSettingsHomeConnection[] = [
    ...connectedKnown.map((card) => homeConnection({
      vendorKey: card.directory.vendorKey,
      name: card.meta.name,
      kind: 'api',
      models: card.vendorModels,
      logo: card.directory.logo,
      glyph: card.directory.glyph,
      baseUrl: card.meta.baseUrl,
      hasApiKey: card.meta.hasApiKey,
    })),
    ...otherVendorGroups.map((group) => {
      const meta = vendorMeta.get(group.vendorKey)
      return homeConnection({
        vendorKey: group.vendorKey,
        name: group.name,
        kind: 'api',
        models: group.models,
        baseUrl: meta?.baseUrl ?? '',
        hasApiKey: meta?.hasApiKey ?? true,
        // 与 renderCustomVendorCard 同一判据：direct-script 那类没有可预检的通用接口。
        skipHealthProbe: Boolean(meta?.customCallOnly)
          && group.models.every((model) => model.hasCustomCall || model.customCallDraft),
      })
    }),
    ...comfyuiConnected.map((instance) => homeConnection({
      vendorKey: instance.key,
      name: instance.meta.name,
      kind: 'local',
      models: instance.models,
      glyph: 'C',
    })),
    ...(dreaminaConnected ? [homeConnection({
      vendorKey: DREAMINA_CONNECTION_KEY,
      name: connectionTitle(DREAMINA_CONNECTION_KEY),
      kind: 'account',
      models: [],
      glyph: 'D',
    })] : []),
    ...(codexImageEnabled ? [homeConnection({
      vendorKey: CODEX_LOCAL_VENDOR_KEY,
      name: connectionTitle(CODEX_LOCAL_VENDOR_KEY),
      kind: 'local',
      models: models.filter((model) => model.vendorKey === CODEX_LOCAL_VENDOR_KEY),
      glyph: 'C',
    })] : []),
    ...(localTextConnected ? [homeConnection({
      vendorKey: LOCAL_TEXT_VENDOR_KEY,
      name: connectionTitle(LOCAL_TEXT_VENDOR_KEY),
      kind: 'local',
      models: localTextModels,
      glyph: 'L',
    })] : []),
    ...(antigravityEnabled ? [homeConnection({
      vendorKey: ANTIGRAVITY_VENDOR_KEY,
      name: connectionTitle(ANTIGRAVITY_VENDOR_KEY),
      kind: 'local',
      models: groupAntigravityCatalogModels(antigravityModels.filter((model) => model.modelKey !== 'auto' && model.modelKey !== ANTIGRAVITY_IMAGE_MODEL_KEY)).map((group) => group.model),
      auxiliaryCounts: { tools: antigravityModels.filter((model) => model.modelKey === ANTIGRAVITY_IMAGE_MODEL_KEY).length, routes: antigravityModels.filter((model) => model.modelKey === 'auto').length },
      skipHealthProbe: true,
      glyph: 'AG',
    })] : []),
  ]

  const availableHomeConnections: ModelSettingsHomeConnection[] = [
    ...availableKnown.map((card) => homeConnection({
      vendorKey: card.directory.vendorKey,
      name: card.meta.name,
      kind: 'api',
      models: [],
      logo: card.directory.logo,
      glyph: card.directory.glyph,
    // usesPlatformConnect 缺省 true（档案未声明 = 支持）→ 路由到 platformConnect（key 填入 + 继续验证）。
    // 硬编码 vendorKey 白名单已移除（P1 加新删旧）：由档案字段 derive，不写死。
    }, card.directory.usesPlatformConnect !== false
      ? () => openPage({ type: 'platformConnect', vendorKey: card.directory.vendorKey })
      : undefined)),
    ...comfyuiAvailableList.map((instance) => homeConnection({
      vendorKey: instance.key,
      name: instance.meta.name,
      kind: 'local',
      models: [],
      glyph: 'C',
    })),
    ...(dreaminaAvailable && !dreaminaConnected ? [homeConnection({
      vendorKey: DREAMINA_CONNECTION_KEY,
      name: connectionTitle(DREAMINA_CONNECTION_KEY),
      kind: 'account',
      models: [],
      glyph: 'D',
    })] : []),
    ...(codexImageAvailable && !codexImageEnabled ? [homeConnection({
      vendorKey: CODEX_LOCAL_VENDOR_KEY,
      name: connectionTitle(CODEX_LOCAL_VENDOR_KEY),
      kind: 'local',
      models: [],
      glyph: 'C',
    })] : []),
    ...(localTextAvailable && !localTextConnected ? [homeConnection({
      vendorKey: LOCAL_TEXT_VENDOR_KEY,
      name: connectionTitle(LOCAL_TEXT_VENDOR_KEY),
      kind: 'local',
      models: [],
      glyph: 'L',
    })] : []),
    ...(vendorMeta.has(ANTIGRAVITY_VENDOR_KEY) && !antigravityEnabled ? [homeConnection({
      vendorKey: ANTIGRAVITY_VENDOR_KEY,
      name: connectionTitle(ANTIGRAVITY_VENDOR_KEY),
      kind: 'local',
      models: [],
      glyph: 'AG',
    })] : []),
  ]
  return { knownCards, otherVendorGroups, comfyuiInstances, comfyuiConnected, codexImageEnabled,
    antigravityEnabled, connectionTitle, homeConnections, availableHomeConnections }
}
