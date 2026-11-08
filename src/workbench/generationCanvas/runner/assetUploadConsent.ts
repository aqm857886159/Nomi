import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { resolveGenerationReferences } from './generationReferenceResolver'
import type { HostingDisclosure } from '../spend/spendConfirm'
import i18n from '../../../i18n'
import { getDesktopBridge } from '../../../desktop/bridge'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { isVendorOfBuiltin } from '../../../../electron/shared/builtinVendorIdentity'

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
  listVendors: () => Promise<Array<{ key?: string; enabled?: boolean; hasApiKey?: boolean; authType?: string }>> | Array<{ key?: string; enabled?: boolean; hasApiKey?: boolean; authType?: string }>
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
    listVendors: async () => (await desktop.modelCatalog.listVendors()) as Array<{ key?: string; enabled?: boolean; hasApiKey?: boolean; authType?: string }>,
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
  // 本地运行时两家没有「地址 + Key」形态，长不出兄弟连接，字面量在这里是准确的（见门岗豁免名单）。
  if (/^comfyui-local/i.test(targetVendor) || targetVendor === 'codex-local') return { allowed: true, needsConfirmation: false, remember }
  // #831 最要紧的一处：认不出兄弟连接（`kie--x`）就会把本该走 Kie 通道的素材推去匿名图床。
  const vendors = await deps.listVendors()
  const kie = vendors.find((vendor) => isVendorOfBuiltin(vendors, vendor.key, 'kie'))
  if (kie?.enabled && (kie.authType === 'none' || kie.hasApiKey)) return { allowed: true, needsConfirmation: false, remember }
  if (policy === 'allow') return { allowed: true, needsConfirmation: false, remember }
  return { allowed: true, needsConfirmation: true, remember }
}

export async function buildConsentNode(node: GenerationCanvasNode): Promise<Pick<GenerationCanvasNode, 'meta' | 'references'>> {
  const resolved = resolveGenerationReferences(node, { nodes: [node], edges: [] })
  return {
    ...node,
    references: [
      ...(node.references || []),
      ...resolved.referenceImages,
      ...resolved.referenceVideos,
      ...resolved.referenceAudios,
      ...(resolved.firstFrameUrl ? [resolved.firstFrameUrl] : []),
      ...(resolved.lastFrameUrl ? [resolved.lastFrameUrl] : []),
      ...(resolved.relayFromVideoUrl ? [resolved.relayFromVideoUrl] : []),
    ],
  }
}

/** The existing single-node hosting disclosure, shared by the consent owner. */
export function hostingDisclosureForResolution(resolution: AssetUploadConsentResolution): { allowed: boolean; disclosure?: HostingDisclosure } {
  if (!resolution.allowed) return { allowed: false }
  if (!resolution.needsConfirmation) return { allowed: true }
  return { allowed: true, disclosure: {
    message: i18n.t('generationCommon.spendHostingDisclosure.message'),
    rememberLabel: i18n.t('generationCommon.spendHostingDisclosure.remember'),
    onRemember: resolution.remember,
  } }
}

/**
 * 给**自主路径**（外部 agent / MCP 能力）解析托管同意——这些路径没有人坐在屏幕前，
 * 弹卡等于把整条自动化挂死在一个没人点的对话框上。
 *
 * 判据完全复用同一个 resolveAssetUploadConsent，不另立一套语义：
 * - 策略 deny → 抛 AssetUploadConsentCancelledError，这次生成不发（诚实失败，理由回给调用方）；
 * - 还需要问一次（策略 ask + 有本地素材 + KIE 没配）→ 同样**拒发**。自动化不能替用户
 *   默默把素材传到公共托管上；把「去设置里配 KIE，或把托管策略改成允许」这句人话回给
 *   agent，由它转达。这是 D4「缺口明着标」：宁可这一次不跑，也不偷偷上传。
 * - 其余 → 'allow' / 'not-needed'，照常跑。
 */
export async function resolveAutonomousUploadConsent(
  nodeId: string,
): Promise<'allow' | 'not-needed'> {
  const state = useGenerationCanvasStore.getState()
  const node = state.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return 'not-needed'
  const consentNode = await buildConsentNode(node)
  if (!hasLocalAssetReference(consentNode)) return 'not-needed'
  const resolution = await resolveAssetUploadConsent(consentNode)
  if (!resolution.allowed) throw new AssetUploadConsentCancelledError()
  if (resolution.needsConfirmation) {
    throw new Error(i18n.t('generationCommon.spendHostingDisclosure.autonomousBlocked'))
  }
  return 'allow'
}
