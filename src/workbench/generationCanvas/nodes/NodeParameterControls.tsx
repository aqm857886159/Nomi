import NodeInputReferenceEntry from './NodeInputReferenceEntry'
import { notify } from '../../../ui/notificationPolicy'
import { normalizeConditionalParameters } from '../../../../electron/shared/videoCapabilities/crossFieldConstraints'
import { nodeReferenceCapacity } from './controls/nodeCrossFieldConstraints'
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { useOpenProjectId } from '../../project/useOpenProjectId'
import {
  deriveGenerationModelCatalogStatus,
  findModelOptionByIdentifier,
} from '../adapters/modelOptionsAdapter'
import type { ModelOptionsState } from '../../../config/useModelOptions'
import type { ComposerGraph } from './composerGraphSnapshot'
import { type ModelParameterControl } from '../../../config/modelCatalogMeta'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import {
  buildImageUrlSlots, resolveParameterReferenceAssignments, type ImageUrlSlot,
} from '../model/parameterReferenceSlots'
import {
  getGenerationNodeExecutionKind,
  isAudioLikeGenerationNodeKind,
  isImageLikeGenerationNodeKind,
  isModel3dLikeGenerationNodeKind,
  isVideoLikeGenerationNodeKind,
} from '../model/generationNodeKinds'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useNodeWriteAccess } from './nodeWriteAccess'
import type { CanvasMutationOptions } from '../store/canvasGuards'
import { comfyWorkflowTakesPrompt } from '../runner/promptRequirement'
import {
  type DynamicCatalogControl,
  buildEffectiveImageCatalogConfig,
  defaultPatchForCatalogControl,
  getSlotNodeRef,
  getSlotThumbUrl,
  imageCatalogReferenceSlot,
  isImportedComfyWorkflowModel,
  isParameterControl,
  nodeSelectedModelAddress,
  parameterControlRole,
  parseControlInput,
  readMeta,
  resultPreviewUrl,
  shouldUseVideoFrameSlotFallback,
} from './controls/parameterControlModel'
import { createSlotFileUploads } from './controls/slotFileUploads'
import { addToArraySlot, assignSlotSource, removeFromArray, removeUnusedReference, reorderArray, restoreParkedReference, setSlotUrl, swapFrameSlots, type ReferenceWriteContext } from './controls/referenceWrites'
import {
  type ArchetypeArraySlot,
  applyArchetypeVariantSwitch,
  applyHumanModeChoice,
  archetypeModeArraySlots,
  archetypeModeSlots,
  archetypeModeSourceVideoSlot,
  archetypeVariantChoices,
  currentArchetypeVariant,
  effectiveArchetypeMode,
  readArchetypeArray,
  referenceSlotStorage,
} from './controls/archetypeMeta'
import {
  archetypeModeChoices,
  archetypeModeSlotReachByKey,
  archetypeVariantAxisIsLive,
} from './controls/channelModeReach'
import {
  NARROWED_MODE_GUIDANCE_DISMISSED_META_KEY,
  referencesSectionIsEmpty,
  useNarrowedModeGuidance,
  withoutTextModes,
} from './controls/narrowedModeGuidance'
import NarrowedModeGuidanceNote from './controls/NarrowedModeGuidanceNote'
import { resolveReferencePlacement, firstFrameTaggedSlot } from '../runner/referenceSlots'
import { useChannelCreateBodies, type VendorMappingsReader } from './controls/useChannelCreateBody'
import { translateModelDisplayText } from '../../../i18n/modelDisplayText'
import { modeTransportFor, specializeArchetypeForVariant } from '../../../../electron/shared/modelArchetypes'
import ModeBar from './controls/ModeBar'
import { modePresentationTexts, presentGenerationModes } from './controls/generationModePresentation'
import { readModePreference } from './controls/modePreference'
import AssetReference, { type AssetSlot } from '../../assets/AssetReference'
import { parameterChipOptions } from './primaryParameterChips'
import QuantitySelect from './controls/QuantitySelect'
import referenceRowTail from './controls/referenceRowTail'
import { FIRST_LAST_HINT_DISMISSED_META_KEY, computeReferenceRowModel, firstLastAmbiguityTarget } from './controls/referenceRowModel'
import type { AssetRef, AssetKind } from '../../assets/assetTypes'
import { pickNodeSlotReference } from './nodeSlotReferencePick'
import InlineParameterBar from './InlineParameterBar'
import { composerHeadlineSummary } from './composerHeadlineSummary'
import { useNodeModelAutoSelect } from './useNodeModelAutoSelect'
import { resolveArchetypeForOption, resolveRenderedControls } from './nodeModelArchetype'
import { buildAspectRatioNodePatch } from './nodeSizing'
import { ASPECT_EXPLICIT_META_KEY } from './aspectExplicit'
import { parseAspectRatioValue } from '../../../../electron/shared/aspectRatioValue'
import { buildNodeModelChangePatch } from './buildNodeModelChangePatch'
import { isAspectRatioControl, parameterControlChangePatch } from './controls/parameterControlModel'

type NodeParameterControlsProps = {
  node: GenerationCanvasNode
  section?: 'all' | 'mode' | 'references' | 'parameters' | 'quantity' | 'model' | 'controls'
  /** 点参考 tile → 在描述框光标处插入 @ 引用 chip(主路径,由 composer 注入 editor 命令)。 */
  onInsertMention?: (url: string) => void
  /** 以下三件由生成框各算一份往下传（2026-10-16 可疑点 f / g）：控件不自己订整表、不各算一遍模型清单。 */
  graph: ComposerGraph; modelOptionsState: ModelOptionsState; readMappings: VendorMappingsReader
}

export default function NodeParameterControls({
  node,
  section = 'all',
  onInsertMention,
  graph, modelOptionsState, readMappings,
}: NodeParameterControlsProps): JSX.Element | null {
  const openProjectId = useOpenProjectId()
  const reportFeedback = React.useCallback((message: string) => {
    notify({ identity: `NodeParameterControls:${node.id}`, reason: 'interaction', message, level: 'inline', present: setUploadError })
  }, [node.id])

  const { t } = useTranslation()
  const { nodes, edges } = graph
  // 写入面由宿主接住（付费确认卡走它自己的草稿账本，确认前不碰画布）——见 nodeWriteAccess。
  const { updateNode, latestNode, connectNodes: canConnect } = useNodeWriteAccess()
  const storeConnectNodes = useGenerationCanvasStore((state) => state.connectNodes)
  const storeDisconnectEdge = useGenerationCanvasStore((state) => state.disconnectEdge)
  const meta = React.useMemo<Record<string, unknown>>(() => node.meta || {}, [node.meta])
  const [uploadingSlotKey, setUploadingSlotKey] = React.useState('')
  const [uploadError, setUploadError] = React.useState('')
  const cancelReferencePick = React.useRef<(() => void) | undefined>(undefined)
  const [openSlotKey, setOpenSlotKey] = React.useState('')
  const [uploadingArrayKey, setUploadingArrayKey] = React.useState('')
  const isImageLike = isImageLikeGenerationNodeKind(node.kind)
  const isVideoLike = isVideoLikeGenerationNodeKind(node.kind)
  const isTextLike = getGenerationNodeExecutionKind(node.kind) === 'text'
  const isAudioLike = isAudioLikeGenerationNodeKind(node.kind)
  const isModel3dLike = isModel3dLikeGenerationNodeKind(node.kind)
  const isGenerationNode = isImageLike || isVideoLike || isTextLike || isAudioLike || isModel3dLike
  const ownsDerivedWrites = section === 'parameters' || section === 'all' // 系统纠偏写回只由这一份做（三份各跑一遍 = 可疑点 i 的级联）
  const modelOptions = modelOptionsState.options
  const modelCatalogStatus = deriveGenerationModelCatalogStatus(node.kind, modelOptionsState)

  const { modelKey: selectedModelValue, vendorKey: selectedModelVendor } = nodeSelectedModelAddress(meta)
  const selectedModelOption = findModelOptionByIdentifier(modelOptions, selectedModelValue, selectedModelVendor) || null
  const archetype = resolveArchetypeForOption(selectedModelOption)
  const declaredVariantChoices = archetype ? archetypeVariantChoices(archetype) : []
  const activeVariantId = archetype ? currentArchetypeVariant(archetype, meta)?.id || '' : ''
  const effectiveArchetype = archetype ? specializeArchetypeForVariant(archetype, activeVariantId) : null
  // 方式按这次的输入现算（modeForInputs，唯一 owner）：archMode = 图怎么摆（分段高亮、参考格子、容量）；
  // sendMode = 这次发什么（参数、型号变体轴）。两者只在一张输入都没收下时不同。
  const modeResolution = effectiveArchetype ? effectiveArchetypeMode(effectiveArchetype, node, graph) : null
  const archMode = modeResolution?.layout ?? null
  const sendMode = modeResolution?.mode ?? null
  // A point-pick belongs to the slot configuration that opened it.
  React.useEffect(() => () => cancelReferencePick.current?.(), [node.id, openProjectId, archMode?.id, node.meta, edges])
  const imageCatalogConfig = archetype ? null : buildEffectiveImageCatalogConfig(selectedModelOption?.meta)
  const renderedControls = resolveRenderedControls(selectedModelOption, meta, isImageLike, isVideoLike, { node, graph })

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
    modeBodySpecs, readMappings,
  )
  // （Runway 把 model 写死、且 veo3.1 / veo3.1_fast 本就是两个目录行）。惰性时整条不显示，别骗用户。
  const variantChoices = sendMode && !archetypeVariantAxisIsLive(modeBodies[sendMode.id]) ? [] : declaredVariantChoices
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
    nodeMeta: meta, readMappings,
  })

  // P1 单一真相源：所有 meta 增量 patch 都从 store 读**最新** meta 再 spread，绝不基于渲染快照 prop
  // `node.meta`（那是第二份真相源）。连边赋图 + 紧接改参数等「先后两次写」时，读快照会让后写覆盖前写
  // (lost-update 竞态)。updateNode 是整体替换 meta（Object.assign 浅替换），故必须在此处自己合并最新值。
  const getLatestMeta = (): Record<string, unknown> => latestNode(node.id)?.meta || {}

  const updateMeta = (patch: Record<string, unknown>, options?: CanvasMutationOptions) => {
    updateNode(node.id, {
      meta: sendMode ? normalizeConditionalParameters(sendMode.params, { ...getLatestMeta(), ...patch }) : { ...getLatestMeta(), ...patch },
    }, options)
  }

  // 条件参数纠偏只在「这次发的就是节点存着的那个方式」时写：方式因为放了 / 删了图现算成别的时不写回
  // （参数在发送时按现算方式收窄，删了图回到原来存的值）。
  const sendModeIsStored = Boolean(sendMode && effectiveArchetype && readModePreference(effectiveArchetype, meta)?.modeId === sendMode.id)
  React.useEffect(() => {
    if (!ownsDerivedWrites || !sendMode || !sendModeIsStored) return
    const latest = getLatestMeta()
    const next = normalizeConditionalParameters(sendMode.params, latest)
    if (next !== latest) updateMeta(next, { history: false })
    // The effect only writes when a conditional selection is invalid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendMode, sendModeIsStored, meta, ownsDerivedWrites])

  const updateAspectRatioMeta = (patch: Record<string, unknown>, targetRatio: number | null) => {
    const latest = latestNode(node.id)
    if (!latest) return
    const nextMeta = { ...(latest.meta || {}), ...patch }
    updateNode(
      node.id,
      buildAspectRatioNodePatch(latest, nextMeta, targetRatio),
    )
  }

  const handleModelChange = (value: string, vendor?: string) => {
    const state = useGenerationCanvasStore.getState()
    const current = latestNode(node.id) || node
    const change = buildNodeModelChangePatch({
      node: current,
      nodes: state.nodes,
      edges: state.edges,
      modelOptions,
      value,
      vendor,
    })
    updateNode(node.id, { meta: change.meta })
  }

  useNodeModelAutoSelect({
    node,
    modelOptions,
    selectedModelValue,
    selectedModelOption,
    archetype,
    isGenerationNode: isGenerationNode && ownsDerivedWrites,
    isImageLike,
    isVideoLike,
    updateNode,
  })

  // 视频比例的产品默认（首选 16:9、已连输入全竖 9:16）不在这里：它只在选模型 / 新卡自动选模型 / 连线这三个手势里铺
  // （唯一出处 videoAspectSeed.ts）。这里以前有个挂载 effect 按它「纠正」比例——Agent 写的 9:16 一点开就变 16:9
  // （2026-10-22 R-d2-defaults #1），打开节点不是改参数的手势，2026-10-22 删除。


  if (!isGenerationNode) return null

  const handleParameterControlChange = (control: ModelParameterControl, value: string) => {
    const parsed = parseControlInput(control, value)
    const patch = parameterControlChangePatch(control, value)
    if (isAspectRatioControl({ ...control, binding: 'parameter' })) {
      // 用户显式选过比例 → 打标记，连边联动不再自动改（用户选择优先于产品默认）。
      patch[ASPECT_EXPLICIT_META_KEY] = true
      updateAspectRatioMeta(patch, parseAspectRatioValue(patch.aspect_ratio ?? parsed))
      return
    }
    updateMeta(patch)
  }

  const handleCatalogControlChange = (control: DynamicCatalogControl, value: string) => {
    const isAspect = isAspectRatioControl(control)
    const patch: Record<string, unknown> = {
      ...defaultPatchForCatalogControl({ ...control, defaultValue: value }),
      ...(isAspect ? { [ASPECT_EXPLICIT_META_KEY]: true } : {}),
    }
    if (isAspect) {
      updateAspectRatioMeta(patch, parseAspectRatioValue(patch.aspect_ratio ?? value))
      return
    }
    updateMeta(patch)
  }

  // 人手选摆法（分段 / 「改成首尾帧」提示 / 声音方式栏，只有这三扇门写偏好）：只记偏好和「人手选的」，参考列表、参数都不动
  // （落槽 / 「未用到」由 resolveReferencePlacement 按现算的摆法推导，往返一张不少；参数在发送时按现算方式收窄）。
  const handleModeSwitch = (modeId: string) => {
    if (!archetype) return
    updateNode(node.id, { meta: applyHumanModeChoice(getLatestMeta(), archetype, modeId) })
    setOpenSlotKey('')
  }

  // 切型号变体：只改 variantId（正交轴，不动模式/参考值）。决定实际发请求的 model + 参数收窄。
  const handleVariantSwitch = (variantId: string) => {
    if (!archetype) return
    updateNode(node.id, { meta: applyArchetypeVariantSwitch(getLatestMeta(), archetype, variantId) })
    setOpenSlotKey('')
  }

  // ── C3 数组参考槽（全能参考，meta-only）：append / remove / 上传，写 node.meta[metaKey] 数组 ──
  const writeCtx: ReferenceWriteContext = {
    node, archMode, getImageUrlSlots: () => imageUrlSlots, latestNode, updateNode, getLatestMeta, updateMeta,
    storeConnectNodes, storeDisconnectEdge, closeSlot: () => setOpenSlotKey(''), feedback: (key, values) => reportFeedback(t(key, values)),
  }
  const handleArrayAdd = (slot: ArchetypeArraySlot, url: string) => addToArraySlot(writeCtx, slot, url)
  const handleArrayRemove = (metaKey: string, index: number) => removeFromArray(writeCtx, metaKey, index)
  const handleSlotAssignment = (slot: ImageUrlSlot, newSourceNodeId: string) => assignSlotSource(writeCtx, slot, newSourceNodeId)
  const setSingleFrameUrlMeta = (slot: ImageUrlSlot, url: string) => setSlotUrl(writeCtx, slot, url)
  // 三个「本地文件 → 槽 url」入口共用一条导入路径（controls/slotFileUploads）。写入仍归这里：
  // 数组走 handleArrayAdd 的唯一追加路径，单槽走 setSingleFrameUrlMeta 的断边+写 meta。
  const { handleArrayUpload, handleSourceVideoUpload, handleSlotUpload } = createSlotFileUploads({
    nodeId: node.id,
    t,
    onArrayAdd: handleArrayAdd,
    onSourceVideoUrl: (metaKey, url) => updateMeta({ [metaKey]: url }),
    onSingleFrameUrl: setSingleFrameUrlMeta,
    setUploadingArrayKey,
    setUploadingSlotKey,
    setUploadError,
  })
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
  // 生成方式怎么呈现（B3）：视频 = 参数面板顶部的分段（没有文生）；图片 = 不出现，由输入决定；声音 / 3D = 沿用旧的模式栏。
  const modePresentation = presentGenerationModes({
    archetype: effectiveArchetype ?? archetype,
    visibleChoices: modeChoices,
    activeModeId: archMode?.id || '',
    kind: isVideoLike ? 'video' : isImageLike ? 'image' : 'other',
    texts: modePresentationTexts(t),
  })
  const showModeBar = modePresentation.where === 'bar'
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
        // 尾帧可不填（档案里 last_frame 的 min = 0）：格下写「尾帧（可不填）」。
        optional: s.group === 'last_frame' && Boolean(archMode?.slots.some((slot) => slot.kind === 'last_frame' && slot.min === 0)),
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
  let firstFrameSlotKey: string | undefined
  // 槽位**已占用位置数**（含「连了边但源未生成」的 pending fill，它占位但 url 为空）。容量判断（能否再加/连）
  // 必须用它，而非「有 url 的显示图数」或「meta 数组长度」——否则被 pending 边占满的槽仍显示「+」、上传/连线
  // 写得进去却落不下（resolveReferenceSlots 没空位放）→「参考图上不去 / 连线连不上」（2026-06-25 真机存档定位）。
  const arrayOccupiedByKey = new Map<string, number>()
  // 参考行的「在用 / 未用到」：和请求组装同一个推导（resolveReferencePlacement → placeUploadedImages）。
  // 渠道只收得下单图的槽按 1 张算（与下面槽上限收窄同一份可达性），渠道压根发不出的槽按 0 张算——放不下的都淡显「未用到」。
  const referencePlacement = archMode
    ? resolveReferencePlacement(node, nodes, edges, {
      capOf: (slot) => {
        const storage = referenceSlotStorage(slot)
        const reach = storage ? slotReachByKey[storage.metaKey] : undefined
        return reach === 'none' ? 0 : reach === 'single' ? 1 : undefined
      },
    })
    : { slots: [], unused: [], parked: [] }
  if (archMode) {
    const resolvedSlots = referencePlacement.slots
    const taggedSlot = firstFrameTaggedSlot(resolvedSlots)
    for (const rs of resolvedSlots) {
      const storage = referenceSlotStorage({ kind: rs.slotKind })
      if (storage) {
        resolvedFillUrlsByMetaKey.set(
          storage.metaKey,
          rs.fills.map((f) => f.url).filter((u): u is string => Boolean(u)),
        )
        arrayOccupiedByKey.set(storage.metaKey, rs.fills.length)
        if (rs === taggedSlot) firstFrameSlotKey = storage.metaKey
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
      // 连边是改画布，只有握着连边权能的宿主（画布）才建边；付费确认卡只写它自己的参考槽（见 nodeWriteAccess）。
      const sourceNodeId = asset.origin.source === 'canvas' ? asset.origin.nodeId : undefined
      if (sourceNodeId && canConnect
        && resultPreviewUrl(useGenerationCanvasStore.getState().nodes.find(candidate => candidate.id === sourceNodeId)) === asset.renderUrl) handleSlotAssignment(img, sourceNodeId)
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
  const handleReorder = (slot: AssetSlot, from: number, to: number) => {
    if (slot.form === 'array') reorderArray(writeCtx, slot.key, from, to)
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

  // 数量：模型声明了「数量」这类参数（output_count / batch_size / n…）才有这个控件，住在底栏右边、紧挨生成钮左边
  // （B3：数量只在模型声明时显示）。它**搬家不是复制**：有了它，面板里就不再出现同一个参数（一功能一个家）。
  const quantityControl = isImageLike || isVideoLike
    ? renderedControls.find((control) => parameterControlRole(control) === 'quantity' && parameterChipOptions(control).length > 0)
    : undefined
  const panelRenderedControls = quantityControl ? renderedControls.filter((control) => control !== quantityControl) : renderedControls

  // section="quantity"：数量钮。「1 个 ▾」（视频）/「1 张 ▾」（图片）。
  if (section === 'quantity') {
    if (!quantityControl) return null
    const onChange = (next: string) => (isParameterControl(quantityControl)
      ? handleParameterControlChange(quantityControl, next) : handleCatalogControlChange(quantityControl, next))
    return <QuantitySelect control={quantityControl} meta={meta} isVideo={isVideoLike} onChange={onChange} />
  }

  // section="parameters"：底栏 = 模型芯片 + 变体 + 摘要 pill + 统一参数面板（实现见 InlineParameterBar）。
  // 摘要 pill + 面板（含比例小图形）：2026-09-11 04:30 用户纠正，同日 02:10 的逐参数 chip 节点这一处退回原样。
  if (section === 'parameters') {
    // 导入的 ComfyUI 工作流：参数名是作者随手起的（采样步数/帧率/Float (duration)…），
    // 把当前值串成 pill（`15 · 24`）没人认得出那是自己勾的东西。改成报名字+条数。
    // 判据取 meta.comfyWorkflowImport 是否存在——它只由导入流程写入，档案模型不会有。
    const workflowSummary = isImportedComfyWorkflowModel(selectedModelOption?.meta) && renderedControls.length > 0
      ? t('generationCommon.parameters.workflowParams', { count: panelRenderedControls.length })
      : undefined
    // v1.1 底栏：档案模型的 pill 只报「最影响结果和价格的两个值」（视频=比例+时长、图=比例+清晰度），
    // 其余参数一个不少、仍在同一块弹层里。走 summaryOverride 这条**已有的**缝（导入工作流那支
    // 在用同一个入口），不新造第二条摘要通路。工作流的口径优先——它连「值串出来没人认得」
    // 这个更基本的问题都还没解决，轮不到再挑两个。
    const summaryOverride = workflowSummary ?? composerHeadlineSummary({
      isImageLike,
      isVideoLike,
      controls: panelRenderedControls,
      meta,
      formatSeconds: (value) => t('generationCommon.composerBarV1.seconds', { value }),
      autoLabel: t('generationCommon.parameters.auto'),
    })
    return (
      <InlineParameterBar
        modelOptions={modelOptions}
        modelCatalogStatus={modelCatalogStatus}
        renderedControls={panelRenderedControls}
        selectedModelOption={selectedModelOption}
        archetype={archetype}
        meta={meta}
        onModelChange={handleModelChange}
        onCatalogControlChange={handleCatalogControlChange}
        onParameterControlChange={handleParameterControlChange}
        variantChoices={showVariantBar ? variantChoices : []}
        activeVariantId={activeVariantId}
        onVariantSelect={handleVariantSwitch}
        summaryOverride={summaryOverride}
        // 生成方式放在面板顶部（现有组件原样）：视频节点的分段在这里，图片没有，声音 / 3D 仍在参考区上方的模式栏。
        {...(modePresentation.where === 'panel' ? {
          modeChoices: modePresentation.choices,
          activeModeId: modePresentation.activeId,
          modeLabel: t('generationCommon.parameters.generationMode'),
          onModeSelect: handleModeSwitch,
        } : {})}
      />
    )
  }

  // section="mode"：「生成方式」分段单独成一行，住在参考区滚动口**之外**（2026-09-21 走查 01/07）。
  // 它决定下面有哪些参考槽，属于浮框「非收不可」的高度：放在滚动口里，卡片一压到最小高度它就被裁成半截、
  // 点不中；放在外面，它是卡片的固定内容，不随参考区滚动。
  if (section === 'mode') {
    return showModeBar ? <ModeBar choices={modeChoices} activeId={archMode?.id || ''} onSelect={handleModeSwitch} /> : null
  }

  // 模式分段切换要常驻（即便当前模式无参考槽，如纯文生）——有 modeBar / 数组槽 / 源视频槽都不空返回。
  // 处理类 ComfyUI 工作流（去背景/超分/补帧）图里没有提示词槽——诚实说一句，
  // 否则用户在下面的提示词框里打了字却毫无作用，只会以为是我们坏了（D4 缺口明着标）。
  const comfyTakesPrompt = comfyWorkflowTakesPrompt(selectedModelOption?.meta)
  const showNoPromptNote = section === 'references' && comfyTakesPrompt === false
  const guidance = withoutTextModes(modeGuidance, (effectiveArchetype ?? archetype)?.modes)
  // 指路提示**独立于模式栏存在**：最坏的一种（样张 D）恰恰是「只剩 1 个模式 → 整条模式栏不显示」，
  // 那时用户什么都看不到。它若跟着模式栏一起消失，最需要说话的场合反而哑了，所以它单独进空返回判据。
  const showModeGuidance = showReferences && Boolean(guidance)

  const potentialReferenceKinds = Array.from(new Set(effectiveArchetype?.modes.flatMap(mode => [
    ...archetypeModeSlots(mode).map(() => 'image' as AssetKind),
    ...archetypeModeArraySlots(mode).map(slot => slot.accept),
    ...(archetypeModeSourceVideoSlot(mode) ? ['video' as AssetKind] : []),
  ]) ?? (isImageLike || isVideoLike ? ['image' as AssetKind] : [])))
  // 模型任何方式都不收参考图（如只会文生图的模型）：参考行照样在，入口灰掉、悬停说原因（B3i）。
  const refsUnsupported = Boolean(effectiveArchetype) && (isImageLike || isVideoLike) && potentialReferenceKinds.length === 0
  const inputReferenceEntry = !assetSlots.length && canConnect && potentialReferenceKinds.length
    ? <NodeInputReferenceEntry nodeId={node.id} accept={potentialReferenceKinds} /> : null

  const { unusedUrls, parkedUrls, framesOnly, referenceInfos, arrayCount } = computeReferenceRowModel({
    node, nodes, edges, meta, assetSlots, assetValuesByKey, imageUrlSlots, arraySlots, refsUnsupported, showReferences,
    unusedUploads: referencePlacement.unused, parkedUploads: referencePlacement.parked,
    fallbackName: (kind) => t(kind === 'video' ? 'assetLibrary.referenceVideo' : kind === 'audio' ? 'assetLibrary.referenceAudio' : 'assetLibrary.referenceImage'),
  })

  const firstLastModeId = firstLastAmbiguityTarget({
    modes: (effectiveArchetype ?? archetype)?.modes, activeIntent: archMode?.intent, arraySlots, assetValuesByKey, arrayCount, meta, isVideo: isVideoLike,
  })

  const handleSwapFrames = () => {
    const first = imageUrlSlots.find((slot) => slot.group === 'first_frame')
    const last = imageUrlSlots.find((slot) => slot.group === 'last_frame')
    if (first && last) swapFrameSlots(writeCtx, first, last, assetValuesByKey, (slot) => parameterAssignments.find((assignment) => assignment.slot.key === slot.key)?.edge?.source)
  }

  const guidanceNote = showModeGuidance && guidance ? (
    <NarrowedModeGuidanceNote
      guidance={guidance}
      currentVendorName={selectedModelOption?.vendorName || selectedModelOption?.vendor || ''}
      // 复用**已有的** handleModelChange = 与用户手动换模型同一条状态写入路径（updateNode 带 meta patch
      // → pushEditBurstBarrier），因此天然被 Cmd+Z 覆盖，不新开第二条切换路径。
      onSwitch={handleModelChange}
      onDismiss={() => updateMeta({ [NARROWED_MODE_GUIDANCE_DISMISSED_META_KEY]: true })}
    />
  ) : null

  const tail = referenceRowTail(t, {
    refsUnsupported, unusedCount: unusedUrls.length, framesOnly, arrayCount, guidanceNote,
    onSwitchToFirstLast: firstLastModeId ? () => handleModeSwitch(firstLastModeId) : undefined,
    onDismissAmbiguity: () => updateMeta({ [FIRST_LAST_HINT_DISMISSED_META_KEY]: true }),
  })

  // 当前方式一个收图的槽都没有（文生，或渠道发不出这些槽）时，参考列表里的图照样要看得见——淡显「未用到」，
  // 不能「既不显示也不发送」（换到 Veo 3.1 文生、30 张参考一张都看不见，真机走查 2026-10-22 抓到）。
  if (
    section === 'references' &&
    !refsUnsupported &&
    unusedUrls.length === 0 &&
    referencesSectionIsEmpty({
      hasImageUrlSlots: imageUrlSlots.length > 0,
      hasArraySlots: arraySlots.length > 0,
      hasSourceVideoSlot: Boolean(sourceVideoSlot),
      showModeBar,
      showNoPromptNote,
      hasModeGuidance: showModeGuidance,
    })
  )
    return inputReferenceEntry

  const rootClassName = cn('generation-canvas-v2-node__ref-section', 'flex flex-col gap-1')
  const hasReferenceRow = showReferences && (assetSlots.length > 0 || refsUnsupported || unusedUrls.length > 0)

  return (
    <div className={rootClassName} aria-label={t('generationCommon.parameters.referencesAria')}>
      {section === 'all' && showModeBar ? (
        <ModeBar choices={modeChoices} activeId={archMode?.id || ''} onSelect={handleModeSwitch} />
      ) : null}

      {/* 没有参考行可挂时（只剩 1 个模式、没有槽），指路提示自己站一行；有参考行就进行尾。 */}
      {!hasReferenceRow && !inputReferenceEntry ? guidanceNote : null}

      {showReferences && !hasReferenceRow ? inputReferenceEntry : null}
      {hasReferenceRow ? (
        <AssetReference
          slots={assetSlots}
          remainingCapacity={archMode ? nodeReferenceCapacity(archMode, node, nodes, edges) : undefined}
          capacityMessage={archMode?.maxTotalReferences === undefined ? undefined : t('generationCommon.parameters.referenceTotal', { max: archMode.maxTotalReferences })}
          valuesByKey={assetValuesByKey}
          occupiedByKey={arrayOccupiedByKey}
          projectId={openProjectId}
          openSlotKey={openSlotKey}
          uploadingSlotKey={uploadingSlotKey || uploadingArrayKey}
          onTogglePicker={(key) => setOpenSlotKey((prev) => (prev === key ? '' : key))}
          onPickOnCanvas={(slots) => {
            setOpenSlotKey('')
            cancelReferencePick.current = pickNodeSlotReference({
              nodeId: node.id, slots, valuesByKey: assetValuesByKey, occupiedByKey: arrayOccupiedByKey,
              remainingCapacity: archMode ? nodeReferenceCapacity(archMode, node, nodes, edges) : Infinity,
              onPick: handleAssetPick,
            })
          }}
          onPick={handleAssetPick}
          onUpload={(slot, file) => {
            void handleAssetUpload(slot, file)
          }}
          onRemove={handleAssetRemove}
          onInsertMention={onInsertMention}
          onReorder={handleReorder}
          onBrowseAll={handleBrowseAll}
          firstFrameSlotKey={firstFrameSlotKey}
          {...(referenceInfos ? { referenceInfos } : {})}
          unusedUrls={unusedUrls}
          onRemoveUnused={(url) => removeUnusedReference(writeCtx, url)} parkedUrls={parkedUrls} onUseParked={(url) => restoreParkedReference(writeCtx, url)}
          {...(imageUrlSlots.length === 2 && imageUrlSlots[0]?.group === 'first_frame' && imageUrlSlots[1]?.group === 'last_frame' ? { onSwapFrames: handleSwapFrames } : {})}
          {...(refsUnsupported ? { disabledReason: t('assetLibrary.refRow.disabledReason') } : {})}
          {...(tail ? { tail } : {})}
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
