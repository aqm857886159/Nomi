import { getDesktopBridge } from '../../../desktop/bridge'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

const LOCAL_ASSET_PREFIX = 'nomi-local://'

export type AssetUploadConsentPolicy = 'ask' | 'allow' | 'deny'

export class AssetUploadConsentCancelledError extends Error {
  constructor() {
    super('用户取消了公共临时托管上传')
    this.name = 'AssetUploadConsentCancelledError'
  }
}

type ConsentDependencies = {
  readPolicy: () => Promise<{ anonymousAssetHosting?: AssetUploadConsentPolicy }>
  listVendors: () => Array<{ key?: string; enabled?: boolean; hasApiKey?: boolean; authType?: string }>
  remember?: () => Promise<void>
}

export type AssetUploadConsentResolution = {
  allowed: boolean
  needsConfirmation: boolean
  remember: () => Promise<void>
}

function hasLocalAsset(value: unknown): boolean {
  if (typeof value === 'string') return value.startsWith(LOCAL_ASSET_PREFIX)
  if (Array.isArray(value)) return value.some(hasLocalAsset)
  if (value && typeof value === 'object') return Object.values(value).some(hasLocalAsset)
  return false
}

export function hasLocalAssetReference(node: Pick<GenerationCanvasNode, 'meta' | 'references'>): boolean {
  return hasLocalAsset(node.meta) || hasLocalAsset(node.references)
}

function defaultDependencies(): ConsentDependencies | null {
  const desktop = getDesktopBridge()
  const policy = desktop?.settings?.automationPolicy
  if (!policy || !desktop?.modelCatalog) return null
  return {
    readPolicy: () => policy.get(),
    listVendors: () => desktop.modelCatalog.listVendors() as Array<{ key?: string; enabled?: boolean; hasApiKey?: boolean; authType?: string }>,
    remember: async () => {
      const current = await policy.get()
      await policy.set({ ...current, anonymousAssetHosting: 'allow' })
    },
  }
}

/**
 * 解析「这次生成要不要走公共临时托管、要不要先跟用户说一声」——**不弹任何 UI**。
 *
 * 这是托管策略的唯一真相源。看得见的卡只有一张：花钱确认卡（SpendConfirmDialog 里的
 * hostingDisclosure 块）。本函数只回答三件事，由上游确认面据此渲染：
 *   · allowed=false           → 策略是 deny，这次生成直接不发（连卡都不用弹）；
 *   · needsConfirmation=false → 无本地素材 / 本地 ComfyUI / KIE 已配好 / 策略已 allow，静默放行；
 *   · needsConfirmation=true  → 要在花钱卡里带上披露块 + 「记住我的选择」。
 *
 * 历史（2026-08-26 F16b 收口）：这里曾有个孪生的 requestAssetUploadConsent 自己弹第二张卡。
 * 它按条件绕过（传了 consent 就不弹），于是没传的调用点——agent 与 MCP 能力路径——每次生成
 * 照弹不误，正是 F16b 要根除的那张卡。现已整个删除：解析与呈现分离，呈现只剩花钱卡一处。
 */
export async function resolveAssetUploadConsent(
  node: Pick<GenerationCanvasNode, 'meta' | 'references'>,
  injected?: Partial<ConsentDependencies>,
): Promise<AssetUploadConsentResolution> {
  const noopRemember = async () => {}
  if (!hasLocalAssetReference(node)) return { allowed: true, needsConfirmation: false, remember: noopRemember }
  const defaults = defaultDependencies()
  if (!defaults && !injected) return { allowed: true, needsConfirmation: false, remember: noopRemember }
  const deps = { ...(defaults || {}), ...(injected || {}) } as ConsentDependencies
  const policy = (await deps.readPolicy()).anonymousAssetHosting || 'ask'
  const remember = deps.remember || (async () => {})
  if (policy === 'deny') return { allowed: false, needsConfirmation: false, remember }
  const targetVendor = typeof node.meta?.modelVendor === 'string'
    ? node.meta.modelVendor
    : typeof node.meta?.vendor === 'string' ? node.meta.vendor : ''
  if (/^comfyui-local/i.test(targetVendor) || targetVendor === 'codex-local') return { allowed: true, needsConfirmation: false, remember }
  const kie = deps.listVendors().find((vendor) => vendor.key === 'kie')
  if (kie?.enabled && (kie.authType === 'none' || kie.hasApiKey)) return { allowed: true, needsConfirmation: false, remember }
  if (policy === 'allow') return { allowed: true, needsConfirmation: false, remember }
  return { allowed: true, needsConfirmation: true, remember }
}
