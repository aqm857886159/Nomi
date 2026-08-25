import { confirmDialog } from '../../../design'
import { getDesktopBridge } from '../../../desktop/bridge'
import i18n from '../../../i18n'
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
  confirm: (options: { title: string; message: string; confirmLabel: string; cancelLabel: string }) => Promise<boolean>
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
    confirm: confirmDialog,
    remember: async () => {
      const current = await policy.get()
      await policy.set({ ...current, anonymousAssetHosting: 'allow' })
    },
  }
}

/**
 * Renderer-side disclosure gate. It runs before the spend grant is consumed,
 * so declining a public fallback never creates a paid vendor request.
 * A configured KIE key is the authenticated/free path and suppresses the
 * public-host disclosure entirely.
 */
export async function requestAssetUploadConsent(
  node: Pick<GenerationCanvasNode, 'meta' | 'references'>,
  injected?: Partial<ConsentDependencies>,
): Promise<boolean> {
  const resolution = await resolveAssetUploadConsent(node, injected)
  if (!resolution.allowed) return false
  if (!resolution.needsConfirmation) return true
  const defaults = defaultDependencies()
  if (!defaults && !injected) return true
  const deps = { ...(defaults || {}), ...(injected || {}) } as ConsentDependencies
  return deps.confirm({
    title: i18n.t('generationCommon.assetUploadConsent.title'),
    message: i18n.t('generationCommon.assetUploadConsent.message'),
    confirmLabel: i18n.t('generationCommon.assetUploadConsent.confirm'),
    cancelLabel: i18n.t('generationCommon.assetUploadConsent.cancel'),
  })
}

/**
 * Resolve the upload channel without opening UI. Spend confirmation owns the
 * visible card; this function is the single policy/KIE truth source used by
 * both the merged card and the legacy direct-run fallback.
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
