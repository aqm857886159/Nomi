import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { getDesktopActiveProjectId } from '../../../desktop/activeProject'
import {
  deriveGenerationModelCatalogStatus,
  findModelOptionByIdentifier,
  requiredModeForGenerationNode,
  useGenerationModelOptionsState,
} from '../adapters/modelOptionsAdapter'
import { type ModelParameterControl } from '../../../config/modelCatalogMeta'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import {
  buildImageUrlSlots, edgeModeForGroup, parameterReferenceMetaPatch,
  readParameterReferenceSlots, resolveParameterReferenceAssignments, type ImageUrlSlot,
} from '../model/parameterReferenceSlots'
import {
  getGenerationNodeExecutionKind,
  isAudioLikeGenerationNodeKind,
  isImageLikeGenerationNodeKind,
  isModel3dLikeGenerationNodeKind,
  isVideoLikeGenerationNodeKind,
} from '../model/generationNodeKinds'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { CanvasMutationOptions } from '../store/canvasGuards'
import { importWorkbenchLocalAssetFile } from '../../api/assetUploadApi'
import { comfyWorkflowTakesPrompt } from '../runner/promptRequirement'
import {
  type DynamicCatalogControl,
  assetUrl,
  buildEffectiveImageCatalogConfig,
  defaultPatchForCatalogControl,
  videoAspectDefaultPatch,
  getSlotNodeRef,
  getSlotThumbUrl,
  imageCatalogReferenceSlot,
  isImportedComfyWorkflowModel,
  nodeSelectedModelAddress,
  parseControlInput,
  readMeta,
  resultPreviewUrl,
  shouldUseVideoFrameSlotFallback,
} from './controls/parameterControlModel'
import {
  type ArchetypeArraySlot,
  appendArchetypeArrayValue,
  applyArchetypeModeSwitch,
  applyArchetypeVariantSwitch,
  archetypeModeArraySlots,
  archetypeModeSlots,
  archetypeModeSourceVideoSlot,
  archetypeVariantChoices,
  currentArchetypeMode,
  currentArchetypeVariant,
  readArchetypeArray,
  referenceSlotStorage,
} from './controls/archetypeMeta'
import {
  archetypeModeChoices,
  archetypeModeIsVisible,
  archetypeModeSlotReachByKey,
  archetypeVariantAxisIsLive,
  fallbackVisibleModeId,
} from './controls/channelModeReach'
import {
  NARROWED_MODE_GUIDANCE_DISMISSED_META_KEY,
  referencesSectionIsEmpty,
  useNarrowedModeGuidance,
} from './controls/narrowedModeGuidance'
import NarrowedModeGuidanceNote from './controls/NarrowedModeGuidanceNote'
import { resolveReferenceSlots, decideArrayReferenceRemoval } from '../runner/referenceSlots'
import { useChannelCreateBodies } from './controls/useChannelCreateBody'
import { translateModelDisplayText } from '../../../i18n/modelDisplayText'
import { modeTransportFor, specializeArchetypeForVariant } from '../../../config/modelArchetypes'
import ModeBar from './controls/ModeBar'
import AssetReference, { type AssetSlot } from '../../assets/AssetReference'
import type { AssetRef } from '../../assets/assetTypes'
import { moveArrayItem } from '../../assets/assetTypes'
import { removeMention } from '../../assets/promptMentions'
import { showInfoToast } from '../../../utils/showInfoToast'
import InlineParameterBar from './InlineParameterBar'
import { useNodeModelAutoSelect } from './useNodeModelAutoSelect'
import { resolveArchetypeForOption, resolveRenderedControls } from './nodeModelArchetype'
import {
  buildAspectRatioNodePatch,
  type ComposerAttachmentSide,
} from './nodeSizing'
import {
  ASPECT_RATIO_KEYS,
  collectInputAspectRatios,
  normalizeAspectRatioToWH,
  parseAspectRatioValue,
  preferredVideoAspect,
} from './aspectRatio'
import { buildNodeModelChangePatch } from './buildNodeModelChangePatch'

// 模块级常量：比例参数的 key 白名单（与 aspectRatio.ts 的 ASPECT_RATIO_KEYS 保持一致）。
const ASPECT_RATIO_KEY_SET = new Set<string>(ASPECT_RATIO_KEYS)

type NodeParameterControlsProps = {
  node: GenerationCanvasNode
  section?: 'all' | 'references' | 'parameters' | 'model' | 'controls'
  /** 点参考 tile → 在描述框光标处插入 @ 引用 chip(主路径,由 composer 注入 editor 命令)。 */
  onInsertMention?: (url: string) => void
  /** 当前 composer 连在节点哪条边；比例切换用它保持同一连接锚点。 */
  composerAttachmentSide?: ComposerAttachmentSide
}

export default function NodeParameterControls({
  node,
  section = 'all',
  onInsertMention,
  composerAttachmentSide = 'bottom',
}: NodeParameterControlsProps): JSX.Element | null {
  const { t } = useTranslation()
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const edges = useGenerationCanvasStore((state) => state.edges)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const storeConnectNodes = useGenerationCanvasStore((state) => state.connectNodes)
  const storeDisconnectEdge = useGenerationCanvasStore((state) => state.disconnectEdge)
  const meta = React.useMemo<Record<string, unknown>>(() => node.meta || {}, [node.meta])
  const [uploadingSlotKey, setUploadingSlotKey] = React.useState('')
  const [uploadError, setUploadError] = React.useState('')
  // 统一的「哪个槽的选择器展开」(单/数组共用一个,P1 归一)+ 数组/源视频上传中标记。
  const [openSlotKey, setOpenSlotKey] = React.useState('')
  const [uploadingArrayKey, setUploadingArrayKey] = React.useState('')
  const isImageLike = isImageLikeGenerationNodeKind(node.kind)
  const isVideoLike = isVideoLikeGenerationNodeKind(node.kind)
  // C5：文本节点也是可生成节点（executionKind:'text'）——要渲染模型选择器，否则没处选模型。
  const isTextLike = getGenerationNodeExecutionKind(node.kind) === 'text'
  // 声音节点同为可生成节点：要走模型自动选择(选到「声音」档案)→ ModeBar(配音/转写)+ 参数才显现。
  const isAudioLike = isAudioLikeGenerationNodeKind(node.kind)
  // 3D 模型节点同为可生成节点(executionKind:'model3d')：与图片/视频共用同一套模型选择器/自动选择/参数机制，
  // 只是 catalogKind→'model3d'、requiredMode→'text_to_3d'(见 modelOptionsAdapter)把候选过滤到已接入的 3D 模型。
  const isModel3dLike = isModel3dLikeGenerationNodeKind(node.kind)
  const isGenerationNode = isImageLike || isVideoLike || isTextLike || isAudioLike || isModel3dLike
  const requiredMode = requiredModeForGenerationNode(node, { nodes, edges })
  const modelOptionsState = useGenerationModelOptionsState(node.kind, requiredMode)
  const modelOptions = modelOptionsState.options
  const modelCatalogStatus = deriveGenerationModelCatalogStatus(node.kind, modelOptionsState)

  // 模型寻址链单源在 parameterControlModel.nodeSelectedModelAddress（报错卡自定义调用入口共用）。
  // 必须带上节点存的 vendor 寻址：两个中转站可提供同名 modelKey，裸身份匹配永远命中数组首条
  // （最新接入那家），下方 vendor 同步 effect 会跟着把 meta.vendor 改写过去——用户锁定被静默翻家。
  const { modelKey: selectedModelValue, vendorKey: selectedModelVendor } = nodeSelectedModelAddress(meta)
  const selectedModelOption = findModelOptionByIdentifier(modelOptions, selectedModelValue, selectedModelVendor) || null
  // 认得的模型 → 内置档案（供应商无关）；驱动模式分段切换 + 当前模式的槽/参数。认不出 → null（走 flat）。
  const archetype = resolveArchetypeForOption(selectedModelOption)
  // 变体特化：选中变体可能收窄某 mode 的参数（如 Seedance fast 的 resolution 仅 480/720）——
  // 槽/参数全由特化后的档案派生，保证 UI 选项与发送一致。无 variants → 原样（零开销）。
  const declaredVariantChoices = archetype ? archetypeVariantChoices(archetype) : []
  const activeVariantId = archetype ? currentArchetypeVariant(archetype, meta)?.id || '' : ''
  const effectiveArchetype = archetype ? specializeArchetypeForVariant(archetype, activeVariantId) : null
  const archMode = effectiveArchetype ? currentArchetypeMode(effectiveArchetype, meta) : null
  const imageCatalogConfig = archetype ? null : buildEffectiveImageCatalogConfig(selectedModelOption?.meta)
  const renderedControls = resolveRenderedControls(selectedModelOption, meta, isImageLike, isVideoLike)

  // ── 渠道诚实：档案声明的槽 × **这条渠道真发得出的键** ──────────────────────────────
  // UI 能力由档案声明（供应商无关），发得出什么由渠道 mapping 决定；此前两者只在「点生成那一刻」
  // 才对账，于是用户连好参考、切到「全能参考」、点了生成才被拒。这里提前算出来，发不出的槽不显示、
  // 只带得动 1 张的槽如实收成 1 张。判据与第三闸同一套（referenceReachability），不另起一份。
  // 拿不到 body（老 preload / 查不到 mapping）→ 空表 → 一律不收窄，绝不因为查不到就藏用户的槽。
  //
  // 模式栏（U4）要的是**每个**声明模式各自的 body，不只是当前选中那个：档案的模式集供应商无关，
  // 而「这家到底有没有这个模式」得逐模式问 mapping（至多两个 taskKind：text_to_video / image_to_video）。
  // taskKind 走唯一入口 modeTransportFor（供应商特化 > 模式级 > 档案级）：同一模型身份在 kie 是单端点
  // （text_to_video）、在 Runway 图模式走 /v1/image_to_video，问错桶会查不到 mapping 而误收窄。
  const modeBodySpecs = React.useMemo(
    () =>
      (effectiveArchetype?.modes ?? []).map((mode) => ({
        key: mode.id,
        taskKind: (modeTransportFor(mode, effectiveArchetype, selectedModelOption?.vendor) ?? '') as string,
        modeId: mode.id,
      })),
    [effectiveArchetype, selectedModelOption?.vendor],
  )
  const modeBodies = useChannelCreateBodies(
    selectedModelOption?.vendor ?? '',
    selectedModelOption?.value ?? '',
    modeBodySpecs,
  )
  // 变体轴收窄：变体的意义是换一个真发出去的 model 串，渠道没把 model 参数化就什么也不会发生
  // （Runway 把 model 写死、且 veo3.1 / veo3.1_fast 本就是两个目录行）。惰性时整条不显示，别骗用户。
  const variantChoices = archMode && !archetypeVariantAxisIsLive(modeBodies[archMode.id]) ? [] : declaredVariantChoices
  // 槽级收窄仍只看**当前**模式的 body（口径不变）。三态里的 undefined/null 都落到「拿不到 body」→ 不收窄。
  const channelCreateBody = archMode ? (modeBodies[archMode.id]?.body ?? null) : null
  const slotReachByKey = React.useMemo(
    () => (archMode && channelCreateBody ? archetypeModeSlotReachByKey(archMode, channelCreateBody) : {}),
    [archMode, channelCreateBody],
  )
  // 被收窄的模式：不再静默消失，而是指一条路（样张 B/E）。判据与候选查询都住在 narrowedModeGuidance，
  // 这里只消费结论——见该模块头注释（含「样张 C 为何故意不做」的实测依据）。
  // 位置必须在下面那些 early return **之前**：hooks 不能条件调用（react-hooks/rules-of-hooks）。
  const modeGuidance = useNarrowedModeGuidance({
    archetype: effectiveArchetype,
    selectedModelOption,
    modelOptions,
    modeBodies,
    nodeMeta: meta,
  })

  // P1 单一真相源：所有 meta 增量 patch 都从 store 读**最新** meta 再 spread，绝不基于渲染快照 prop
  // `node.meta`（那是第二份真相源）。连边赋图 + 紧接改参数等「先后两次写」时，读快照会让后写覆盖前写
  // (lost-update 竞态)。updateNode 是整体替换 meta（Object.assign 浅替换），故必须在此处自己合并最新值。
  const getLatestMeta = (): Record<string, unknown> =>
    useGenerationCanvasStore.getState().nodes.find((n) => n.id === node.id)?.meta || {}

  const updateMeta = (patch: Record<string, unknown>, options?: CanvasMutationOptions) => {
    updateNode(node.id, {
      meta: { ...getLatestMeta(), ...patch },
    }, options)
  }

  const updateAspectRatioMeta = (patch: Record<string, unknown>, targetRatio: number | null) => {
    const latest = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)
    if (!latest) return
    const nextMeta = { ...(latest.meta || {}), ...patch }
    updateNode(
      node.id,
      buildAspectRatioNodePatch(latest, nextMeta, targetRatio, composerAttachmentSide),
    )
  }

  const handleModelChange = (value: string, vendor?: string) => {
    const state = useGenerationCanvasStore.getState()
    const latestNode = state.nodes.find((candidate) => candidate.id === node.id) || node
    updateNode(node.id, buildNodeModelChangePatch({
      node: latestNode,
      nodes: state.nodes,
      edges: state.edges,
      modelOptions,
      value,
      vendor,
    }))
  }

  useNodeModelAutoSelect({
    node,
    modelOptions,
    selectedModelValue,
    selectedModelOption,
    archetype,
    isGenerationNode,
    isImageLike,
    isVideoLike,
    updateNode,
  })

  // 连边联动（2026-07-17 用户拍板）：视频比例产品默认 = 首选 16:9、已连输入**全竖**才 9:16。
  // 输入边集合或模型变化时重算；用户显式选过比例（aspect_ratio_user_set）后不再自动改。
  const inputAspectSignature = edges
    .filter((e) => e.target === node.id)
    .map((e) => `${e.source}:${String(e.mode || '')}`)
    .sort()
    .join('|')
  React.useEffect(() => {
    if (!isVideoLike) return
    const latest = getLatestMeta()
    if (latest.aspect_ratio_user_set === true) return
    const state = useGenerationCanvasStore.getState()
    const preferred = preferredVideoAspect(collectInputAspectRatios(node.id, state.edges, state.nodes))
    const current = ((): string | null => {
      for (const key of ASPECT_RATIO_KEYS) {
        const wh = normalizeAspectRatioToWH(String(latest[key] ?? ''))
        if (wh) return wh
      }
      return null
    })()
    if (current === preferred) return
    const patch = videoAspectDefaultPatch(renderedControls, preferred)
    if (Object.keys(patch).length > 0) updateMeta(patch, { history: false })
    // renderedControls/updateMeta 每渲染重建，入 deps 会令 effect 每次 meta 写都重跑；
    // 触发时机只需「输入边集合 / 模型」变化，语义由下面两个签名精确表达。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputAspectSignature, isVideoLike, selectedModelValue, node.id])

  // 模式收窄的**选择安全**（U4）：收窄只改「显示哪几个」，节点 meta 里钉的 modeId 不会自己动。存量节点
  // （或用户把模型换到另一家后）可能停在一个已经不显示的模式上——那时模式栏一个都不高亮，而发送路径仍按
  // 那个看不见的模式投影槽，UI 与发送再次分家（正是本轮要根治的那类病）。这里把它写回 meta，让两边一致。
  // history:false —— 这是系统纠偏，不是用户操作，不该占一格撤销。
  const visibleModeIdSignature = archetype
    ? archetype.modes.filter((mode) => archetypeModeIsVisible(mode, modeBodies[mode.id])).map((m) => m.id).join('|')
    : ''
  React.useEffect(() => {
    if (!archetype) return
    const visibleIds = visibleModeIdSignature ? visibleModeIdSignature.split('|') : []
    const latest = getLatestMeta()
    const next = fallbackVisibleModeId(archetype, latest, visibleIds)
    if (!next) return
    updateNode(node.id, { meta: applyArchetypeModeSwitch(latest, archetype, next) }, { history: false })
    // getLatestMeta/updateNode 每渲染重建；触发时机只需「可见模式集 / 档案 / 节点」变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleModeIdSignature, archetype?.id, node.id])

  if (!isGenerationNode) return null

  const handleParameterControlChange = (control: ModelParameterControl, value: string) => {
    const parsed = parseControlInput(control, value)
    const patch: Record<string, unknown> = { [control.key]: parsed }
    // 跨键同步：凡写任意比例 key（aspect_ratio / size / ratio / image_size），
    // 同时把规范化后的 W:H 写进 aspect_ratio（最高优先级读取键）。
    // 防止旧模式遗留的 stale aspect_ratio 遮蔽当前模式的比例选择（如 t2i→改图后 image_size 被旧值盖住）。
    if (ASPECT_RATIO_KEY_SET.has(control.key)) {
      const wh = normalizeAspectRatioToWH(parsed)
      patch.aspect_ratio = wh ?? (control.key === 'aspect_ratio' ? parsed : null)
      // 用户显式选过比例 → 打标记，连边联动不再自动改（用户选择优先于产品默认）。
      patch.aspect_ratio_user_set = true
      updateAspectRatioMeta(patch, parseAspectRatioValue(parsed))
      return
    }
    updateMeta(patch)
  }

  const handleCatalogControlChange = (control: DynamicCatalogControl, value: string) => {
    const isAspect =
      control.binding === 'size' || control.binding === 'aspectRatio' || ASPECT_RATIO_KEY_SET.has(control.key)
    const patch = {
      ...defaultPatchForCatalogControl({ ...control, defaultValue: value }),
      ...(isAspect ? { aspect_ratio_user_set: true } : {}),
    }
    if (isAspect) {
      updateAspectRatioMeta(patch, parseAspectRatioValue(value))
      return
    }
    updateMeta(patch)
  }

  // 切生成方式：只改 modeId，参考值全局保留（切回照片还在）；互斥发生在传输投影。
  const handleModeSwitch = (modeId: string) => {
    if (!archetype) return
    updateNode(node.id, { meta: applyArchetypeModeSwitch(getLatestMeta(), archetype, modeId) })
    setOpenSlotKey('')
  }

  // 切型号变体：只改 variantId（正交轴，不动模式/参考值）。决定实际发请求的 model + 参数收窄。
  const handleVariantSwitch = (variantId: string) => {
    if (!archetype) return
    updateNode(node.id, { meta: applyArchetypeVariantSwitch(getLatestMeta(), archetype, variantId) })
    setOpenSlotKey('')
  }

  // ── C3 数组参考槽（全能参考，meta-only）：append / remove / 上传，写 node.meta[metaKey] 数组 ──
  const setArrayValue = (metaKey: string, next: string[]) => updateMeta({ [metaKey]: next })
  const handleArrayAdd = (slot: ArchetypeArraySlot, url: string) => {
    // 容量先按**已占用位置**判（含连线 + pending 边，单源 resolveReferenceSlots），不能只看 meta 数组长度——
    // 否则被边占满的槽仍允许写入 meta、却落不进槽（显示/发送都没它）=「参考图上不去」。
    const occupied = resolveReferenceSlots(node, nodes, edges).find(
      (rs) => referenceSlotStorage({ kind: rs.slotKind })?.metaKey === slot.metaKey,
    )?.fills.length
    if (occupied != null && slot.max !== undefined && occupied >= slot.max) {
      showInfoToast(t('generationCommon.parameters.referenceFull', { max: slot.max }))
      return
    }
    // 单源去重/上限：与拖入/连线共用 appendArchetypeArrayValue（规则 1：不另开写路径）。
    // 读最新 meta 计算追加（避免基于渲染快照算出过期数组 → 覆盖刚连边写入的项）。
    const result = appendArchetypeArrayValue(getLatestMeta(), slot, url)
    if (result.status === 'full') {
      showInfoToast(t('generationCommon.parameters.maximum', { max: slot.max, label: slot.label }))
      return
    } // 到上限:明确告知(对抗评审:别静默丢)
    if (result.status !== 'added') return // empty / duplicate：静默
    setArrayValue(slot.metaKey, result.next)
    setOpenSlotKey('')
  }
  const handleArrayRemove = (metaKey: string, index: number) => {
    // 「×」按这一项的来源分流（单一真相源 decideArrayReferenceRemoval）：
    // 来自连边 → 断边（之前只删 meta 不断边，边来源的图重渲染又被解析回来 = 「叉不掉」根因）；
    // 来自上传 → 按 url 删 meta（显示 index 是「边+上传」合并列表的下标，不能直接拿去 filter meta 数组）。
    const decision = decideArrayReferenceRemoval(node, nodes, edges, metaKey, index)
    // image 数组(= character 参考)删除时，同步抹掉描述框里指向它的 @ chip（保 undo 原子性 + 一次持久化）。
    const promptAfterRemovingMention = (url: string | null) =>
      metaKey === 'referenceImageUrls' && url ? removeMention(node.prompt || '', url) : null

    if (decision.kind === 'disconnect-edge') {
      storeDisconnectEdge(decision.edgeId)
      // B5：同一 url 既来自边、又残留在 meta 上传里（去重后只显示边那份）→ 仅断边会让它以 upload 形态
      // 重现（「叉一次还在」）。断边时一并清掉 meta 里的同 url 上传（与断边/删 chip 合成一次持久化，保 undo 原子）。
      const latestMeta = getLatestMeta()
      const metaArr = readArchetypeArray(latestMeta, metaKey)
      const cleanedMeta = decision.url ? metaArr.filter((u) => u !== decision.url) : metaArr
      const nextPrompt = promptAfterRemovingMention(decision.url)
      const patch: { meta?: Record<string, unknown>; prompt?: string } = {}
      if (cleanedMeta.length !== metaArr.length) patch.meta = { ...latestMeta, [metaKey]: cleanedMeta }
      if (nextPrompt != null && nextPrompt !== (node.prompt || '')) patch.prompt = nextPrompt
      if (Object.keys(patch).length > 0) updateNode(node.id, patch)
      return
    }
    if (decision.kind === 'noop') return

    // remove-upload：按 url 从 meta 数组删（不是显示 index）。
    const latestMeta = getLatestMeta()
    const next = readArchetypeArray(latestMeta, metaKey).filter((u) => u !== decision.url)
    const nextPrompt = promptAfterRemovingMention(decision.url)
    if (nextPrompt != null && nextPrompt !== (node.prompt || '')) {
      updateNode(node.id, { meta: { ...latestMeta, [metaKey]: next }, prompt: nextPrompt })
      return
    }
    setArrayValue(metaKey, next)
  }
  const handleArrayUpload = async (slot: ArchetypeArraySlot, file: File | null | undefined) => {
    if (!file) return
    setUploadingArrayKey(slot.metaKey)
    setUploadError('')
    try {
      const uploaded = await importWorkbenchLocalAssetFile(file, file.name || slot.label, {
        ownerNodeId: node.id,
        taskKind: 'image_edit',
      })
      const url = assetUrl(uploaded)
      if (!url) throw new Error(t('generationCommon.parameters.missingAssetUrl'))
      handleArrayAdd(slot, url)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setUploadingArrayKey('')
    }
  }

  // D3 源视频单槽（video-edit）：上传一个视频 → 写 meta.sourceVideoUrl（传输映射成 video_url）。
  const handleSourceVideoUpload = async (metaKey: string, file: File | null | undefined) => {
    if (!file) return
    setUploadingArrayKey(metaKey)
    setUploadError('')
    try {
      const uploaded = await importWorkbenchLocalAssetFile(
        file,
        file.name || t('generationCommon.parameters.sourceVideo'),
        { ownerNodeId: node.id, taskKind: 'image_edit' },
      )
      const url = assetUrl(uploaded)
      if (!url) throw new Error(t('generationCommon.parameters.missingVideoUrl'))
      updateMeta({ [metaKey]: url })
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setUploadingArrayKey('')
    }
  }
  const handleSlotAssignment = (slot: ImageUrlSlot, newSourceNodeId: string) => {
    const state = useGenerationCanvasStore.getState()
    const target = state.nodes.find((candidate) => candidate.id === node.id) || node
    const existingEdge = resolveParameterReferenceAssignments(target, state.nodes, state.edges, imageUrlSlots)
      .find((assignment) => assignment.slot.key === slot.key)?.edge
    const targetMode = edgeModeForGroup(slot.group)
    if (!newSourceNodeId) {
      if (existingEdge) storeDisconnectEdge(existingEdge.id, { scope: 'parameter' })
      const clearPatch = parameterReferenceMetaPatch(slot, imageUrlSlots, null)
      updateNode(node.id, { meta: { ...getLatestMeta(), ...clearPatch } }, { history: !existingEdge })
      setOpenSlotKey('')
      return
    }
    const declared = readParameterReferenceSlots(target.meta).some((candidate) => candidate.key === slot.key)
    if (existingEdge?.source === newSourceNodeId) { setOpenSlotKey(''); return }
    if (existingEdge) storeDisconnectEdge(existingEdge.id, { scope: 'parameter' })
    else state.captureHistory()
    storeConnectNodes(newSourceNodeId, node.id, targetMode, declared ? slot.key : undefined)
    // S2 写收口：边即真相源——不再写 firstFrameUrl/firstFrameRef/referenceImages 等快照 meta。
    // 那份快照在连边时 resultPreviewUrl 还可能为空(源未生成)=陈旧,且与其它参数写入竞态(lost-update)；
    // 所有读取方(resolver、显示 resolveParameterReferenceAssignments/resolveReferenceSlots)都已边优先，
    // 快照纯冗余。源生成后 url 由边实时解析,不需回写。
    setOpenSlotKey('')
  }
  // 上传 / 选项目素材只替换该槽来源；退出编组继承时其它槽保留为手工边。
  const setSingleFrameUrlMeta = (slot: ImageUrlSlot, url: string) => {
    const state = useGenerationCanvasStore.getState()
    const target = state.nodes.find((candidate) => candidate.id === node.id) || node
    const existingEdge = resolveParameterReferenceAssignments(target, state.nodes, state.edges, imageUrlSlots)
      .find((assignment) => assignment.slot.key === slot.key)?.edge
    if (existingEdge) storeDisconnectEdge(existingEdge.id, { scope: 'parameter' })
    const latestMeta = getLatestMeta()
    const patch = parameterReferenceMetaPatch(slot, imageUrlSlots, url)
    updateNode(node.id, { meta: { ...latestMeta, ...patch } }, { history: !existingEdge })
    setOpenSlotKey('')
  }
  const handleSlotUpload = async (slot: ImageUrlSlot, file: File | null | undefined) => {
    if (!file) return
    if (!file.type.startsWith(`${slot.mediaKind ?? 'image'}/`)) {
      setUploadError(t(slot.mediaKind === 'video' ? 'generationCommon.parameters.videoOnly' : 'generationCommon.parameters.imageOnly'))
      return
    }
    setUploadingSlotKey(slot.key)
    setUploadError('')
    try {
      const uploaded = await importWorkbenchLocalAssetFile(file, file.name || slot.label, {
        ownerNodeId: node.id,
        ...(slot.mediaKind === 'video' ? {} : { taskKind: 'image_edit' }),
      })
      const url = assetUrl(uploaded)
      if (!url) throw new Error(t(slot.mediaKind === 'video' ? 'generationCommon.parameters.missingVideoUrl' : 'generationCommon.parameters.missingImageUrl'))
      setSingleFrameUrlMeta(slot, url)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setUploadingSlotKey('')
    }
  }

  // ComfyUI 导入的工作流不再走特例：它把声明的每个媒体输入都以 type:'image-url' 写进 meta.parameters，
  // 于是这里的通用出槽器**按条出槽**——声明几个就长几个（2026-08-20，治「多参工作流只能连一张图」）。
  const modelImageUrlSlots = [
    ...buildImageUrlSlots(selectedModelOption?.meta, selectedModelOption?.vendor),
    ...imageCatalogReferenceSlot(imageCatalogConfig),
  ].filter(
    (slot, index, slots) => slots.findIndex((item) => item.key === slot.key && item.group === slot.group) === index,
  )
  // 认得档案 → 槽位严格由当前模式声明（首帧 / 首尾帧…，切模式即换整组，互斥 hide）。
  // 认不出 → 现有启发式槽 + 视频模型 首/尾帧 兜底。
  const imageUrlSlots: ImageUrlSlot[] = archMode
    ? archetypeModeSlots(archMode)
    : shouldUseVideoFrameSlotFallback({
        isVideoLike,
        modelImageUrlSlots,
        vendor: selectedModelOption?.vendor,
      })
      ? [
          { key: 'firstFrameUrl', label: t('generationCommon.parameters.firstFrame'), group: 'first_frame' },
          { key: 'lastFrameUrl', label: t('generationCommon.parameters.lastFrame'), group: 'last_frame' },
        ]
      : modelImageUrlSlots
  // 模式栏按可达性收窄（U4）：档案声明了模式 ≠ 这家发得出。判据与第三闸同源（archetypeModeIsVisible），
  // 拿不到 body 一律不收窄。变体特化不改模式 id，故按 id 取 body 与 archetype/effectiveArchetype 无关。
  const modeChoices = archetype
    ? archetypeModeChoices(archetype, (mode) => modeBodies[mode.id])
    : []
  const showModeBar = modeChoices.length > 1
  const showVariantBar = variantChoices.length > 1
  // 当前模式的数组参考槽（全能参考，meta-only）+ 源视频单槽（HappyHorse 视频编辑）。
  const arraySlots: ArchetypeArraySlot[] = archMode ? archetypeModeArraySlots(archMode) : []
  const sourceVideoSlot = archMode ? archetypeModeSourceVideoSlot(archMode) : null
  const showReferences = section === 'all' || section === 'references'

  // ── P1 统一参考槽：声明式 AssetSlot 列表 + 当前值 + 三类回调（单帧连边 / 数组 meta / 源视频 meta，复用上面已验证的写入逻辑）──
  const assetSlots: AssetSlot[] = [
    ...imageUrlSlots.map(
      (s): AssetSlot => ({
        key: s.key,
        // 唯一翻译点：档案路的槽标签在 archetypeModeSlots 里已翻过（对已是英文的再翻是 no-op，
        // 查不到即原样返回），**启发式路（通用中转/ComfyUI 导入）此前根本没翻** → 英文用户在这个槽
        // 上看到的是中文「参考图」。收在这里翻一次，两条路才真的一个口径。
        label: translateModelDisplayText(s.label),
        accept: s.mediaKind ?? 'image',
        form: 'single',
        persistAsEdge: true,
        numbered: false,
        max: 1,
      }),
    ),
    ...arraySlots.map(
      (s): AssetSlot => ({
        key: s.metaKey,
        label: translateModelDisplayText(s.label),
        accept: s.accept,
        form: 'array',
        persistAsEdge: false,
        numbered: s.numbered,
        max: s.max,
        caption: s.caption,
      }),
    ),
    ...(sourceVideoSlot
      ? [
          {
            key: sourceVideoSlot.metaKey,
            label: translateModelDisplayText(sourceVideoSlot.label),
            accept: 'video',
            form: 'single',
            persistAsEdge: false,
            numbered: false,
            max: 1,
          } as AssetSlot,
        ]
      : []),
  ]
    // 这条渠道压根发不出的槽：不显示。让用户连上一个「连了也不会进请求」的东西，才是真的坑。
    .filter((slot) => slotReachByKey[slot.key] !== 'none')
    // 只挤得进单图聚合位的槽：如实收成 1 张并说明白，别让用户放了 9 张以为都发得出去。
    .map((slot) =>
      slotReachByKey[slot.key] === 'single' && (slot.max === undefined || slot.max > 1)
        ? { ...slot, max: 1, caption: t('generationCommon.parameters.channelSingleReferenceOnly') }
        : slot,
    )
  // 档案节点：槽值统一由 resolveReferenceSlots（边 + 上传单一真相源）派生——这样连线参考在槽里
  // 真的看得见（根治「显示读 meta、生成读边」分裂导致的「连线没用」）。按存储键回填到 assetValuesByKey。
  // pending（连了边但源未生成/待抽帧）本片先不显示空位（占位态留 S4b）；非档案模型仍走旧启发式路径。
  const resolvedFillUrlsByMetaKey = new Map<string, string[]>()
  // 槽位**已占用位置数**（含「连了边但源未生成」的 pending fill，它占位但 url 为空）。容量判断（能否再加/连）
  // 必须用它，而非「有 url 的显示图数」或「meta 数组长度」——否则被 pending 边占满的槽仍显示「+」、上传/连线
  // 写得进去却落不下（resolveReferenceSlots 没空位放）→「参考图上不去 / 连线连不上」（2026-06-25 真机存档定位）。
  const arrayOccupiedByKey = new Map<string, number>()
  if (archMode) {
    for (const rs of resolveReferenceSlots(node, nodes, edges)) {
      const storage = referenceSlotStorage({ kind: rs.slotKind })
      if (storage) {
        resolvedFillUrlsByMetaKey.set(
          storage.metaKey,
          rs.fills.map((f) => f.url).filter((u): u is string => Boolean(u)),
        )
        arrayOccupiedByKey.set(storage.metaKey, rs.fills.length)
      }
    }
  }
  const assetValuesByKey: Record<string, string | string[]> = {}
  const parameterAssignments = resolveParameterReferenceAssignments(node, nodes, edges, imageUrlSlots)
  for (const s of imageUrlSlots) {
    if (archMode && resolvedFillUrlsByMetaKey.has(s.key)) {
      assetValuesByKey[s.key] = resolvedFillUrlsByMetaKey.get(s.key)![0] || ''
      continue
    }
    const edgeSource = parameterAssignments.find((assignment) => assignment.slot.key === s.key)?.edge?.source
    const nodeRef = edgeSource || getSlotNodeRef(meta, s.key)
    const thumbNode = nodeRef ? nodes.find((n) => n.id === nodeRef) : undefined
    assetValuesByKey[s.key] = edgeSource ? resultPreviewUrl(thumbNode) :
      (thumbNode ? resultPreviewUrl(thumbNode) : null) ||
      getSlotThumbUrl(meta, s.key, nodes) ||
      readMeta(meta, s.key) ||
      ''
  }
  for (const s of arraySlots)
    assetValuesByKey[s.metaKey] = resolvedFillUrlsByMetaKey.get(s.metaKey) ?? readArchetypeArray(meta, s.metaKey)
  if (sourceVideoSlot)
    assetValuesByKey[sourceVideoSlot.metaKey] =
      resolvedFillUrlsByMetaKey.get(sourceVideoSlot.metaKey)?.[0] || readMeta(meta, sourceVideoSlot.metaKey) || ''

  const handleAssetPick = (slot: AssetSlot, asset: AssetRef) => {
    if (slot.form === 'array') {
      const arr = arraySlots.find((a) => a.metaKey === slot.key)
      if (arr) handleArrayAdd(arr, asset.renderUrl)
      setOpenSlotKey('')
      return
    }
    if (slot.persistAsEdge) {
      const img = imageUrlSlots.find((i) => i.key === slot.key)
      if (!img) return
      if (asset.source === 'canvas' && asset.origin.source === 'canvas') handleSlotAssignment(img, asset.origin.nodeId)
      else setSingleFrameUrlMeta(img, asset.renderUrl)
      return
    }
    updateMeta({ [slot.key]: asset.renderUrl })
    setOpenSlotKey('')
  }
  const handleAssetUpload = async (slot: AssetSlot, file: File) => {
    if (slot.form === 'array') {
      const arr = arraySlots.find((a) => a.metaKey === slot.key)
      if (arr) await handleArrayUpload(arr, file)
      return
    }
    if (slot.persistAsEdge) {
      const img = imageUrlSlots.find((i) => i.key === slot.key)
      if (img) await handleSlotUpload(img, file)
      return
    }
    await handleSourceVideoUpload(slot.key, file)
  }
  // 同槽内拖拽重排:移动 referenceXxxUrls 数组项(单源 setArrayValue 写入);character{N} 编号由
  // projectPromptForSend 按新数组位置自动重算(单源,无需手动改 prompt/chip)。
  const handleReorder = (slot: AssetSlot, from: number, to: number) => {
    if (slot.form !== 'array') return
    const arr = readArchetypeArray(getLatestMeta(), slot.key)
    if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return
    setArrayValue(slot.key, moveArrayItem(arr, from, to))
  }
  const handleBrowseAll = () => {
    setOpenSlotKey('')
    window.dispatchEvent(new CustomEvent('nomi-open-files-panel'))
  }
  const handleAssetRemove = (slot: AssetSlot, index: number) => {
    if (slot.form === 'array') {
      handleArrayRemove(slot.key, index)
      return
    }
    if (slot.persistAsEdge) {
      const img = imageUrlSlots.find((i) => i.key === slot.key)
      if (img) handleSlotAssignment(img, '')
      return
    }
    updateMeta({ [slot.key]: null })
  }

  // section="parameters"：底栏 = 模型芯片 + 变体 + 最常调参数内联 + 「更多」弹层（主次分层，实现见 InlineParameterBar）。
  if (section === 'parameters') {
    // 导入的 ComfyUI 工作流：参数名是作者随手起的（采样步数/帧率/Float (duration)…），
    // 把当前值串成 pill（`15 · 24`）没人认得出那是自己勾的东西。改成报名字+条数。
    // 判据取 meta.comfyWorkflowImport 是否存在——它只由导入流程写入，档案模型不会有。
    const workflowSummary = isImportedComfyWorkflowModel(selectedModelOption?.meta) && renderedControls.length > 0
      ? t('generationCommon.parameters.workflowParams', { count: renderedControls.length })
      : undefined
    return (
      <InlineParameterBar
        modelOptions={modelOptions}
        modelCatalogStatus={modelCatalogStatus}
        renderedControls={renderedControls}
        selectedModelOption={selectedModelOption}
        archetype={archetype}
        meta={meta}
        onModelChange={handleModelChange}
        onCatalogControlChange={handleCatalogControlChange}
        onParameterControlChange={handleParameterControlChange}
        variantChoices={showVariantBar ? variantChoices : []}
        activeVariantId={activeVariantId}
        onVariantSelect={handleVariantSwitch}
        summaryOverride={workflowSummary}
      />
    )
  }

  // 模式分段切换要常驻（即便当前模式无参考槽，如纯文生）——有 modeBar / 数组槽 / 源视频槽都不空返回。
  // 变体（型号）已从这里挪到底栏 InlineParameterBar 的小下拉（用户拍板：和模型并排在最下面），不再占顶部一排。
  // 处理类 ComfyUI 工作流（去背景/超分/补帧）图里没有提示词槽——诚实说一句，
  // 否则用户在下面的提示词框里打了字却毫无作用，只会以为是我们坏了（D4 缺口明着标）。
  const comfyTakesPrompt = comfyWorkflowTakesPrompt(selectedModelOption?.meta)
  const showNoPromptNote = section === 'references' && comfyTakesPrompt === false
  // 指路提示**独立于模式栏存在**：最坏的一种（样张 D）恰恰是「只剩 1 个模式 → 整条模式栏不显示」，
  // 那时用户什么都看不到。它若跟着模式栏一起消失，最需要说话的场合反而哑了，所以它单独进空返回判据。
  const showModeGuidance = showReferences && Boolean(modeGuidance)

  if (
    section === 'references' &&
    referencesSectionIsEmpty({
      hasImageUrlSlots: imageUrlSlots.length > 0,
      hasArraySlots: arraySlots.length > 0,
      hasSourceVideoSlot: Boolean(sourceVideoSlot),
      showModeBar,
      showNoPromptNote,
      hasModeGuidance: showModeGuidance,
    })
  )
    return null

  // 走到这里只剩 section="references"（parameters/settings 已提前 return；旧的 all/model/controls 网格
  // 渲染随设置弹层落地而删除——参数现在进设置弹层，模型进底栏芯片，不再有这套裸值网格，Rule 1/12）。
  const rootClassName = cn('generation-canvas-v2-node__ref-section', 'flex flex-col gap-1')

  return (
    <div className={rootClassName} aria-label={t('generationCommon.parameters.referencesAria')}>
      {showReferences && showModeBar ? (
        <ModeBar choices={modeChoices} activeId={archMode?.id || ''} onSelect={handleModeSwitch} />
      ) : null}

      {showModeGuidance && modeGuidance ? (
        <NarrowedModeGuidanceNote
          guidance={modeGuidance}
          currentVendorName={selectedModelOption?.vendorName || selectedModelOption?.vendor || ''}
          // 复用**已有的** handleModelChange = 与用户手动换模型同一条状态写入路径（updateNode 带 meta patch
          // → pushEditBurstBarrier），因此天然被 Cmd+Z 覆盖，不新开第二条切换路径。
          onSwitch={handleModelChange}
          onDismiss={() => updateMeta({ [NARROWED_MODE_GUIDANCE_DISMISSED_META_KEY]: true })}
        />
      ) : null}

      {showReferences && assetSlots.length > 0 ? (
        <AssetReference
          slots={assetSlots}
          valuesByKey={assetValuesByKey}
          occupiedByKey={arrayOccupiedByKey}
          projectId={getDesktopActiveProjectId() || null}
          openSlotKey={openSlotKey}
          uploadingSlotKey={uploadingSlotKey || uploadingArrayKey}
          onTogglePicker={(key) => setOpenSlotKey((prev) => (prev === key ? '' : key))}
          onPick={handleAssetPick}
          onUpload={(slot, file) => {
            void handleAssetUpload(slot, file)
          }}
          onRemove={handleAssetRemove}
          onInsertMention={onInsertMention}
          onReorder={handleReorder}
          onBrowseAll={handleBrowseAll}
        />
      ) : null}

      {showNoPromptNote ? (
        <div className={cn('text-ink-40 text-micro leading-tight')}>
          {t('generationCommon.parameters.comfyNoPrompt')}
        </div>
      ) : null}

      {showReferences && uploadError ? (
        <div className={cn('text-workbench-danger text-micro leading-tight')} role="alert">
          {uploadError}
        </div>
      ) : null}
    </div>
  )
}
