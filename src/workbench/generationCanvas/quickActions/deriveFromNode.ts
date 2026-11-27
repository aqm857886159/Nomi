import i18n from '../../../i18n'
import type { ModelOption } from '../../../config/models'
import { connectionCreateVerdictsForSource } from '../agent/referenceEdgeCapability'
import { withCanvasGestureContext } from '../events/canvasGestureContext'
import { getGenerationModelDefaults } from '../model/generationModelDefaults'
import type { GenerationCanvasEdgeMode, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { findModelOptionByIdentifier } from '../adapters/modelOptionsAdapter'
import { buildModeSwitchMeta, buildNodeModelChangePatch } from '../nodes/buildNodeModelChangePatch'
import { nodeSelectedModelAddress } from '../nodes/controls/parameterControlModel'
import { readModeChannelBody, type VendorMappingsReader } from '../nodes/controls/useChannelCreateBody'
import { LAYER_SPLIT_MODE_ID, layerSplitModeOf, layerSplitWireReady } from '../../../../electron/shared/modelArchetypes/modeForInputs'
import { resolveArchetypeForOption } from '../nodes/nodeModelArchetype'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { findQuickAction, type QuickActionGrid, type QuickActionId } from './quickActionCatalog'

/**
 * 一键派生（2026-10-04 节点快捷动作批次 1）：**建下游节点 + 连参考 + 填模板 + 沿用模型——到此为止，不生成**。
 *
 * 用户 2026-10-05 拍板：派生只做准备，花钱留给用户自己在新节点上点 ↑（那是现有的节点生成入口，这里不碰）。
 * 所以这条路**完全不花钱**：本文件没有任何提交 / 批准 / 派发的调用，也不 import 它们
 * （`deriveFromNode.noMoneyDoor.test.ts` 钉死）。花钱语义沿用节点 ↑，一个字没改。
 *
 * ## 边界
 *
 *   · 新节点是本地的、免费的、空闲的：关窗 / 断网 / 重启都只是一个空闲节点照常存盘；
 *   · 不是幂等的：连点同一项 = 建两个空闲节点（没发任何请求，多了一个删掉就是）；
 *   · 新节点 + 入边 + 模型是一个撤销点（⌘Z 删掉它）；放源节点右侧，不自动编组，选中留在源节点上。
 */

/** 派生出的节点上记一笔「我是谁派生的、出图是几行几列」，给「切成 N 张」与生成记录用。 */
export const QUICK_ACTION_META_KEY = 'quickAction'

export type QuickActionNodeMeta = Readonly<{
  id: QuickActionId
  sourceNodeId: string
  grid?: QuickActionGrid
  /**
   * 派生时就备好了、点 ↑ 即可生成：填进了效果库模板提示词，或（图层分离）方式已定好、提示词留空即自动识别。
   * 高清这类既没模板也没定方式的不带。「已备好 · 未生成」只认它。
   */
  promptReady?: true
}>

export type DeriveRequest = Readonly<{
  sourceNodeId: string
  actionId: QuickActionId
  /** 用户自己补的一句（模板在前、用户补充在后）。浮条入口没有，生成框预设有。 */
  userSupplement?: string
}>

export type DerivedNodePlan = Readonly<{
  kind: 'image'
  /** 「多机位九宫格 · 雨夜街口」——标题带出身，画布上一眼看出它从哪来。 */
  title: string
  position: { x: number; y: number }
  categoryId?: string
  /** 源 → 新节点的那一条参考边。图片源接图片节点是通用参考（`selectConnectionEdgeMode` 同口径）。 */
  edge: Readonly<{ sourceNodeId: string; mode: GenerationCanvasEdgeMode }>
  /** 效果库条目；null = 没有模板（高清：要的是放大能力的模型）。正文在执行时从效果库取。 */
  effectId: string | null
  userSupplement?: string
  /** 沿用源节点选的模型；源没选过就交给默认模型选择。 */
  model: Readonly<{ vendorKey: string; modelKey: string }> | null
  meta: QuickActionNodeMeta
}>

/** 新节点放在源的右侧，与抽帧落点同一个间距（`extractVideoFrameToNode.ts`）；被占时由画布写入口的避让挪开。 */
export const DERIVED_NODE_GAP = 64

export function planDerivedNode(
  source: GenerationCanvasNode,
  request: Pick<DeriveRequest, 'actionId' | 'userSupplement'>,
  labels: { actionLabel: string; formatTitle: (action: string, source: string) => string },
): DerivedNodePlan {
  const action = findQuickAction(request.actionId)
  const size = resolveNodeVisualSize(source)
  const address = nodeSelectedModelAddress((source.meta ?? {}) as Record<string, unknown>)
  const sourceTitle = (source.title || '').trim()
  const supplement = request.userSupplement?.trim()
  return {
    kind: 'image',
    title: sourceTitle ? labels.formatTitle(labels.actionLabel, sourceTitle) : labels.actionLabel,
    position: { x: source.position.x + size.width + DERIVED_NODE_GAP, y: source.position.y },
    ...(source.categoryId ? { categoryId: source.categoryId } : {}),
    edge: { sourceNodeId: source.id, mode: 'reference' },
    effectId: action.effectId,
    ...(supplement ? { userSupplement: supplement } : {}),
    model: source.kind === 'image' && address.modelKey ? { vendorKey: address.vendorKey, modelKey: address.modelKey } : null,
    meta: { id: action.id, sourceNodeId: source.id, ...(action.grid ? { grid: action.grid } : {}) },
  }
}

/** 派生出的节点身上那笔记录（读）。不是派生出来的节点返回 null。 */
export function readQuickActionMeta(node: Pick<GenerationCanvasNode, 'meta'>): QuickActionNodeMeta | null {
  const raw = (node.meta as Record<string, unknown> | undefined)?.[QUICK_ACTION_META_KEY]
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<QuickActionNodeMeta>
  if (typeof value.id !== 'string' || typeof value.sourceNodeId !== 'string') return null
  const grid = value.grid && Number.isInteger(value.grid.rows) && Number.isInteger(value.grid.cols) ? value.grid : undefined
  return { id: value.id as QuickActionId, sourceNodeId: value.sourceNodeId, ...(grid ? { grid } : {}), ...(value.promptReady === true ? { promptReady: true as const } : {}) }
}

/** 派生节点「提示词已填好、还没生成」：派生标记 + 空闲 + 没跑过 + 没结果。一点 ↑ 状态就变，条件自然失效。 */
export function isDerivedPromptReady(node: Pick<GenerationCanvasNode, 'meta' | 'status' | 'runs' | 'result'>): boolean {
  return readQuickActionMeta(node)?.promptReady === true && node.status === 'idle' && !node.runs?.length && !node.result
}

export type DeriveHost = Readonly<{
  /** 能做「参考图 → 新图」的图片模型（目录里 image_edit 档的可用项，按偏好 / 健康排好）。 */
  editModelOptions: readonly ModelOption[]
  /** 效果库里这一条的正文；取不到（库缺条目 / 拉取失败）返回 null。 */
  resolveEffectPrompt: (effectId: string) => Promise<string | null>
  /** 渠道 mapping（按供应商取）：图层分离要问「所接渠道的线缆真发不发得出」。不给 = 查不到 = 没有能拆的模型。 */
  readMappings?: VendorMappingsReader
}>

/** 一次派生的结局：建好了（`derivedNodeId`），或一个节点都没建（`blocked`）。 */
export type DeriveBlockReason =
  | 'source-missing'
  | 'source-not-referenceable'
  | 'no-image-model'
  | 'no-upscale-model'
  | 'no-layer-split-model'
  | 'layer-split-custom-script'
  | 'missing-effect'
  | 'connect-failed'

export type DeriveOutcome =
  | { status: 'blocked'; reason: DeriveBlockReason }
  | { status: 'prepared'; derivedNodeId: string }

/** 放大要的是目录里「放大」档的模型（按能力说，不按供应商说）。 */
export function findUpscaleModelOption(options: readonly ModelOption[]): ModelOption | null {
  return options.find((option) => resolveArchetypeForOption(option, { variantId: undefined, modelId: option.modelKey })?.modes.some((mode) => mode.id === 'upscale')) ?? null
}

/** 模型为「图层分离」挂了自定义调用脚本时，脚本只返回裸地址、带不回图层坐标与顺序，能力准入与发送口一致排除。 */
export function hasLayerSplitCustomScript(option: Pick<ModelOption, 'customCallScriptModes'>): boolean {
  return Boolean(option.customCallScriptModes?.includes(LAYER_SPLIT_MODE_ID))
}

/**
 * 这个模型能不能做图层分离：档案里有「图层分离」方式，未挂拆图自定义调用脚本，**并且**它所接渠道的线缆真读这个开关
 * （与发送口同一句话，见 shared/modelArchetypes/modeForInputs.ts 的图层分离段）。渠道查不到（还没载 / 无 bridge）就当不能——
 * 入口点了要花一次钱，宁可说「没有」，也不派生出一个发出去只是普通改图的节点。
 */
export function canLayerSplit(option: ModelOption, readMappings: VendorMappingsReader): boolean {
  const mode = layerSplitModeOf(resolveArchetypeForOption(option, { variantId: undefined, modelId: option.modelKey }))
  if (!mode || !option.vendor || hasLayerSplitCustomScript(option)) return false
  const wire = readModeChannelBody(option.vendor, option.modelKey || option.value, 'image_edit', mode.id, readMappings)
  return Boolean(wire && layerSplitWireReady(wire.wireParamKeys))
}

/** 当前目录没有可用拆图模型，仅仅因为原本能拆的模型挂了自定义调用脚本（此时浮条置灰说明原因，而非指去接同一家）。 */
export function allLayerSplitBlockedByCustomScript(options: readonly ModelOption[], readMappings?: VendorMappingsReader): boolean {
  if (!readMappings || findLayerSplitModelOption(options, readMappings)) return false
  return options.some((option) => hasLayerSplitCustomScript(option) && canLayerSplit({ ...option, customCallScriptModes: undefined }, readMappings))
}

/**
 * 候选供应商里哪几家能做图层分离（它渠道上某条改图线缆、对应的模型档案都过 `canLayerSplit`）。
 * 缺模型时「去接哪一家」由它从目录算出来，不写死厂商名：以后别家也能拆了，这句话自动跟着变。
 */
export function layerSplitVendorKeys(readMappings: VendorMappingsReader, vendorKeys: readonly string[]): string[] {
  return vendorKeys.filter((vendorKey) => (readMappings(vendorKey) ?? []).some((mapping) => {
    // 桶里是这家的渠道线缆（Mapping 自带 vendorKey）：身份按 (这家, modelKey) 成对走，不拿裸 modelKey 去问。
    const { taskKind, modelKey } = (mapping ?? {}) as { vendorKey?: unknown; taskKind?: unknown; modelKey?: unknown }
    return taskKind === 'image_edit' && typeof modelKey === 'string' && modelKey !== ''
      && canLayerSplit({ value: modelKey, label: modelKey, vendor: vendorKey, modelKey }, readMappings)
  }))
}

/**
 * 目录里能做图层分离、且能拆得最多的那个模型（层数上限 `layerSplit.maxLayers` 最大；一样多按目录里偏好 / 健康排好的顺序）。
 * 拆图层这件事要的是「拆得开」，不是画风接续：源图用的模型能拆 17 层、目录里另一个能拆 100 层且可选层数时，默认给后者
 * （板 2026-11-26-layer-split：派生节点默认「30 层 · 自动」，5.0 Pro 是「换成」之后的样子）。
 */
export function findLayerSplitModelOption(options: readonly ModelOption[], readMappings: VendorMappingsReader): ModelOption | null {
  let best: { option: ModelOption; maxLayers: number } | null = null
  for (const option of options) {
    if (!canLayerSplit(option, readMappings)) continue
    const maxLayers = layerSplitModeOf(resolveArchetypeForOption(option, { variantId: undefined, modelId: option.modelKey }))?.layerSplit?.maxLayers ?? 0
    if (!best || maxLayers > best.maxLayers) best = { option, maxLayers }
  }
  return best?.option ?? null
}

/**
 * 点这一项时派生用哪个模型。
 * - 普通改图：源图自己的（不是放大档的话）→ 用户的改图默认 → 目录第一个不是放大档的。
 * - 图层分离：用户的改图默认（能拆的话）→ 目录里能拆得最多的（`findLayerSplitModelOption`）。不沿用源图模型：拆图层不讲画风接续。
 * - 放大：目录里的放大档。
 */
export function pickDerivedModel(
  source: GenerationCanvasNode,
  options: readonly ModelOption[],
  requires: 'image-edit' | 'upscale' | 'layer-split',
  readMappings?: VendorMappingsReader,
): ModelOption | null {
  if (requires === 'upscale') return findUpscaleModelOption(options)
  const preferred = getGenerationModelDefaults().image_edit
  const preferredOption = preferred ? findModelOptionByIdentifier(options, preferred.modelKey, preferred.vendorKey) : null
  if (requires === 'layer-split') {
    if (!readMappings) return null
    if (preferredOption && canLayerSplit(preferredOption, readMappings)) return preferredOption
    return findLayerSplitModelOption(options, readMappings)
  }
  const fits = (option: ModelOption) => !findUpscaleModelOption([option])
  const own = nodeSelectedModelAddress((source.meta ?? {}) as Record<string, unknown>)
  const sourceOption = source.kind === 'image' && own.modelKey ? findModelOptionByIdentifier(options, own.modelKey, own.vendorKey) : null
  if (sourceOption && fits(sourceOption)) return sourceOption
  if (preferredOption) return preferredOption
  return options.find(fits) ?? null
}

const BLOCKED_WITHOUT_MODEL = { 'image-edit': 'no-image-model', upscale: 'no-upscale-model', 'layer-split': 'no-layer-split-model' } as const satisfies Record<'image-edit' | 'upscale' | 'layer-split', DeriveBlockReason>

export async function deriveFromNode(request: DeriveRequest, host: DeriveHost): Promise<DeriveOutcome> {
  return derive(request, host)
}

async function derive(request: DeriveRequest, host: DeriveHost): Promise<DeriveOutcome> {
  const action = findQuickAction(request.actionId)
  const source = useGenerationCanvasStore.getState().nodes.find((node) => node.id === request.sourceNodeId)
  if (!source) return { status: 'blocked', reason: 'source-missing' }
  // 派生要的是「一张出过图的图片」当参考：文本 / 没出图的节点不是（浮条本来也只在有图时出现）。
  if (source.result?.type !== 'image' || !source.result.url || !connectionCreateVerdictsForSource(source, ['image'] as const)[0]?.ok) return { status: 'blocked', reason: 'source-not-referenceable' }
  const model = pickDerivedModel(source, host.editModelOptions, action.requires, host.readMappings)
  if (!model) {
    if (action.requires === 'layer-split' && allLayerSplitBlockedByCustomScript(host.editModelOptions, host.readMappings)) {
      return { status: 'blocked', reason: 'layer-split-custom-script' }
    }
    return { status: 'blocked', reason: BLOCKED_WITHOUT_MODEL[action.requires] }
  }
  let template = ''
  if (action.effectId) {
    const body = await host.resolveEffectPrompt(action.effectId)
    if (!body) return { status: 'blocked', reason: 'missing-effect' }
    template = body
  }
  const plan = planDerivedNode(source, request, {
    actionLabel: i18n.t(action.labelKey),
    formatTitle: (actionLabel, sourceTitle) => i18n.t('generationCommon.quickActions.derivedTitle', { action: actionLabel, source: sourceTitle }),
  })
  // 模板在前、用户补充在后：生成记录里看得到实际发出去的全文。
  const prompt = [template, plan.userSupplement].filter(Boolean).join('\n')

  // 新节点 + 入边 + 模型是一个撤销点：只有第一笔写入放行 undo barrier（同切图的做法）；只包同步段。
  const txnId = `txn_derive_${Date.now()}`
  let barrierPushed = false
  const inTxn = <T,>(fn: () => T): T => {
    const suppressUndoBarriers = barrierPushed
    barrierPushed = true
    return withCanvasGestureContext({ source: 'user', txnId, suppressUndoBarriers }, fn)
  }
  const store = useGenerationCanvasStore.getState()
  const created = inTxn(() => store.addNode({
    kind: 'image',
    title: plan.title,
    prompt,
    position: plan.position,
    ...(plan.categoryId ? { categoryId: plan.categoryId } : {}),
    meta: { [QUICK_ACTION_META_KEY]: { ...plan.meta, ...(template || action.requires === 'layer-split' ? { promptReady: true } : {}) } },
    select: false,
  }))
  const connected = inTxn(() => {
    const latest = useGenerationCanvasStore.getState()
    latest.startConnection(source.id, 'right')
    const verdict = latest.connectToNode(created.id)
    latest.cancelConnection()
    return 'ok' in verdict && verdict.ok
  })
  if (!connected) {
    inTxn(() => useGenerationCanvasStore.getState().deleteNode(created.id))
    return { status: 'blocked', reason: 'connect-failed' }
  }
  inTxn(() => {
    const latest = useGenerationCanvasStore.getState()
    const node = latest.nodes.find((candidate) => candidate.id === created.id)
    if (!node) return
    const { meta } = buildNodeModelChangePatch({
      node, nodes: latest.nodes, edges: latest.edges, modelOptions: host.editModelOptions,
      value: model.modelKey || model.value, vendor: model.vendor,
    })
    // 图层分离：用户在菜单里点的就是「这一种方式」——和底栏方式菜单手点同一扇门（buildModeSwitchMeta 写人手偏好）。
    // 偏好只定方式，参数（层数 30 / 清晰度自动）仍按方式声明的默认读，派生不另写一份。
    const archetype = action.requires === 'layer-split' ? resolveArchetypeForOption(model, { variantId: undefined, modelId: model.modelKey }) : null
    const layerMode = layerSplitModeOf(archetype)
    const nextMeta = archetype && layerMode
      ? buildModeSwitchMeta({ ...node, meta }, archetype, layerMode.id, { nodes: latest.nodes, edges: latest.edges }, model)
      : meta
    latest.updateNode(created.id, { meta: nextMeta })
  })

  // 到此为止：不提交、不批准、不扣费。用户在新节点上点 ↑ 才生成。
  return { status: 'prepared', derivedNodeId: created.id }
}
