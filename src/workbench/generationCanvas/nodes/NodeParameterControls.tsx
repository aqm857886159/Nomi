import React from 'react'
import { cn } from '../../../utils/cn'
import { getDesktopActiveProjectId } from '../../../desktop/activeProject'
import { deriveGenerationModelCatalogStatus, findModelOptionByIdentifier, useGenerationModelOptionsState } from '../adapters/modelOptionsAdapter'
import { type ModelParameterControl } from '../../../config/modelCatalogMeta'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getGenerationNodeExecutionKind, isAudioLikeGenerationNodeKind, isImageLikeGenerationNodeKind, isVideoLikeGenerationNodeKind } from '../model/generationNodeKinds'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { importWorkbenchLocalAssetFile } from '../../api/assetUploadApi'
import {
  type DynamicCatalogControl,
  type ImageUrlSlot,
  assetUrl,
  buildEffectiveImageCatalogConfig,
  buildImageUrlSlots,
  buildModelControls,
  defaultPatchForCatalogControl,
  defaultPatchForControls,
  edgeModeForGroup,
  getEdgeSourceForSlot,
  getSlotNodeRef,
  getSlotThumbUrl,
  imageCatalogReferenceSlot,
  parseControlInput,
  readMeta,
  removePreviousControlParams,
  resultPreviewUrl,
} from './controls/parameterControlModel'
import {
  type ArchetypeArraySlot,
  appendArchetypeArrayValue,
  applyArchetypeModeSwitch,
  applyArchetypeVariantSwitch,
  archetypeModeArraySlots,
  archetypeModeChoices,
  archetypeModeSlots,
  archetypeModeSourceVideoSlot,
  archetypeVariantChoices,
  currentArchetypeMode,
  currentArchetypeVariant,
  readArchetypeArray,
  referenceSlotStorage,
} from './controls/archetypeMeta'
import { resolveReferenceSlots, decideArrayReferenceRemoval } from '../runner/referenceSlots'
import { specializeArchetypeForVariant } from '../../../config/modelArchetypes'
import ModeBar from './controls/ModeBar'
import AssetReference, { type AssetSlot } from '../../assets/AssetReference'
import type { AssetRef } from '../../assets/assetTypes'
import { moveArrayItem } from '../../assets/assetTypes'
import { removeMention } from '../../assets/promptMentions'
import { showInfoToast } from '../../../utils/showInfoToast'
import InlineParameterBar from './InlineParameterBar'
import { useNodeModelAutoSelect } from './useNodeModelAutoSelect'
import { resolveArchetypeForOption, resolveRenderedControls } from './nodeModelArchetype'
import { ASPECT_RATIO_KEYS, normalizeAspectRatioToWH } from './aspectRatio'

// 模块级常量：比例参数的 key 白名单（与 aspectRatio.ts 的 ASPECT_RATIO_KEYS 保持一致）。
const ASPECT_RATIO_KEY_SET = new Set<string>(ASPECT_RATIO_KEYS)

type NodeParameterControlsProps = {
  node: GenerationCanvasNode
  section?: 'all' | 'references' | 'parameters' | 'model' | 'controls'
  /** 点参考 tile → 在描述框光标处插入 @ 引用 chip(主路径,由 composer 注入 editor 命令)。 */
  onInsertMention?: (url: string) => void
}


export default function NodeParameterControls({
  node,
  section = 'all',
  onInsertMention,
}: NodeParameterControlsProps): JSX.Element | null {
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const edges = useGenerationCanvasStore((state) => state.edges)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const updateEdgeMode = useGenerationCanvasStore((state) => state.updateEdgeMode)
  const storeConnectNodes = useGenerationCanvasStore((state) => state.connectNodes)
  const storeDisconnectEdge = useGenerationCanvasStore((state) => state.disconnectEdge)
  const modelOptionsState = useGenerationModelOptionsState(node.kind)
  const modelOptions = modelOptionsState.options
  const modelCatalogStatus = deriveGenerationModelCatalogStatus(node.kind, modelOptionsState)
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
  const isGenerationNode = isImageLike || isVideoLike || isTextLike || isAudioLike

  const selectedModelValue = readMeta(meta, 'modelKey') || readMeta(meta, 'modelAlias') || readMeta(meta, 'imageModel') || readMeta(meta, 'videoModel')
  const selectedModelOption = findModelOptionByIdentifier(modelOptions, selectedModelValue) || null
  // 认得的模型 → 内置档案（供应商无关）；驱动模式分段切换 + 当前模式的槽/参数。认不出 → null（走 flat）。
  const archetype = resolveArchetypeForOption(selectedModelOption)
  // 变体特化：选中变体可能收窄某 mode 的参数（如 Seedance fast 的 resolution 仅 480/720）——
  // 槽/参数全由特化后的档案派生，保证 UI 选项与发送一致。无 variants → 原样（零开销）。
  const variantChoices = archetype ? archetypeVariantChoices(archetype) : []
  const activeVariantId = archetype ? (currentArchetypeVariant(archetype, meta)?.id || '') : ''
  const effectiveArchetype = archetype ? specializeArchetypeForVariant(archetype, activeVariantId) : null
  const archMode = effectiveArchetype ? currentArchetypeMode(effectiveArchetype, meta) : null
  const imageCatalogConfig = archetype ? null : buildEffectiveImageCatalogConfig(selectedModelOption?.meta)
  const renderedControls = resolveRenderedControls(selectedModelOption, meta, isImageLike, isVideoLike)

  // P1 单一真相源：所有 meta 增量 patch 都从 store 读**最新** meta 再 spread，绝不基于渲染快照 prop
  // `node.meta`（那是第二份真相源）。连边赋图 + 紧接改参数等「先后两次写」时，读快照会让后写覆盖前写
  // (lost-update 竞态)。updateNode 是整体替换 meta（Object.assign 浅替换），故必须在此处自己合并最新值。
  const getLatestMeta = (): Record<string, unknown> =>
    useGenerationCanvasStore.getState().nodes.find((n) => n.id === node.id)?.meta || {}

  const updateMeta = (patch: Record<string, unknown>) => {
    updateNode(node.id, {
      meta: { ...getLatestMeta(), ...patch },
    })
  }

  const handleModelChange = (value: string) => {
    const nextOption = findModelOptionByIdentifier(modelOptions, value)
    const controls = buildModelControls(nextOption?.meta, isImageLike, isVideoLike)
    const defaultPatch = defaultPatchForControls(controls)
    updateNode(node.id, {
      meta: {
        ...removePreviousControlParams(getLatestMeta(), renderedControls),
        modelKey: nextOption?.modelKey || nextOption?.value || value || null,
        modelAlias: nextOption?.modelAlias || nextOption?.value || value || null,
        modelVendor: nextOption?.vendor || null,
        vendor: nextOption?.vendor || null,
        modelLabel: nextOption?.label || value || null,
        ...defaultPatch,
        ...(isVideoLike
          ? { videoModel: nextOption?.value || value || null, videoModelVendor: nextOption?.vendor || null }
          : { imageModel: nextOption?.value || value || null, imageModelVendor: nextOption?.vendor || null }),
      },
    })
  }

  useNodeModelAutoSelect({
    node,
    meta,
    modelOptions,
    selectedModelValue,
    selectedModelOption,
    archetype,
    isGenerationNode,
    isImageLike,
    isVideoLike,
    updateNode,
  })

  if (!isGenerationNode) return null

  const handleParameterControlChange = (control: ModelParameterControl, value: string) => {
    const parsed = parseControlInput(control, value)
    const patch: Record<string, unknown> = { [control.key]: parsed }
    // 跨键同步：凡写任意比例 key（aspect_ratio / size / ratio / image_size），
    // 同时把规范化后的 W:H 写进 aspect_ratio（最高优先级读取键）。
    // 防止旧模式遗留的 stale aspect_ratio 遮蔽当前模式的比例选择（如 t2i→改图后 image_size 被旧值盖住）。
    if (ASPECT_RATIO_KEY_SET.has(control.key)) {
      const wh = normalizeAspectRatioToWH(parsed)
      if (wh) patch.aspect_ratio = wh
    }
    updateMeta(patch)
  }

  const handleCatalogControlChange = (control: DynamicCatalogControl, value: string) => {
    updateMeta(defaultPatchForCatalogControl({ ...control, defaultValue: value }))
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
    const occupied = resolveReferenceSlots(node, nodes, edges)
      .find((rs) => referenceSlotStorage({ kind: rs.slotKind })?.metaKey === slot.metaKey)?.fills.length
    if (occupied != null && occupied >= slot.max) {
      showInfoToast(`参考已满（最多 ${slot.max} 个，含连线）`)
      return
    }
    // 单源去重/上限：与拖入/连线共用 appendArchetypeArrayValue（规则 1：不另开写路径）。
    // 读最新 meta 计算追加（避免基于渲染快照算出过期数组 → 覆盖刚连边写入的项）。
    const result = appendArchetypeArrayValue(getLatestMeta(), slot, url)
    if (result.status === 'full') { showInfoToast(`最多 ${slot.max} 个${slot.label}`); return } // 到上限:明确告知(对抗评审:别静默丢)
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
      const uploaded = await importWorkbenchLocalAssetFile(file, file.name || slot.label, { ownerNodeId: node.id, taskKind: 'image_edit' })
      const url = assetUrl(uploaded)
      if (!url) throw new Error('服务器没有返回素材 URL')
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
      const uploaded = await importWorkbenchLocalAssetFile(file, file.name || '源视频', { ownerNodeId: node.id, taskKind: 'image_edit' })
      const url = assetUrl(uploaded)
      if (!url) throw new Error('服务器没有返回视频 URL')
      updateMeta({ [metaKey]: url })
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setUploadingArrayKey('')
    }
  }
  const handleSlotAssignment = (slot: ImageUrlSlot, newSourceNodeId: string) => {
    const targetMode = edgeModeForGroup(slot.group)
    if (!newSourceNodeId) {
      const existingEdge = edges.find((e) => e.target === node.id && e.mode === targetMode)
      if (existingEdge) storeDisconnectEdge(existingEdge.id)
      const clearPatch: Record<string, unknown> = { [slot.key]: null, [slot.key + '_nodeRef']: null }
      if (slot.group === 'first_frame') { clearPatch.firstFrameUrl = null; clearPatch.firstFrameRef = null }
      if (slot.group === 'last_frame') { clearPatch.lastFrameUrl = null; clearPatch.lastFrameRef = null }
      if (slot.group === 'reference') { clearPatch.referenceImages = []; clearPatch.referenceImageUrl = null; clearPatch.referenceImageRef = null }
      updateNode(node.id, { meta: { ...getLatestMeta(), ...clearPatch } })
      setOpenSlotKey('')
      return
    }
    const existingFromSource = edges.find((e) => e.source === newSourceNodeId && e.target === node.id)
    if (existingFromSource) {
      if (existingFromSource.mode !== targetMode) updateEdgeMode(existingFromSource.id, targetMode)
    } else {
      storeConnectNodes(newSourceNodeId, node.id, targetMode)
    }
    const conflictEdge = edges.find((e) => e.target === node.id && e.mode === targetMode && e.source !== newSourceNodeId)
    if (conflictEdge) storeDisconnectEdge(conflictEdge.id)
    // S2 写收口：边即真相源——不再写 firstFrameUrl/firstFrameRef/referenceImages 等快照 meta。
    // 那份快照在连边时 resultPreviewUrl 还可能为空(源未生成)=陈旧,且与其它参数写入竞态(lost-update)；
    // 所有读取方(resolver firstFrameFromEdge、显示 getEdgeSourceForSlot/resolveReferenceSlots)都已边优先，
    // 快照纯冗余。源生成后 url 由边实时解析,不需回写。
    setOpenSlotKey('')
  }
  // 把单帧槽设成一个给定 URL（上传 / 选项目素材共用）：断开该组旧画布边(切到无源节点的 url)、写 flat meta。
  const setSingleFrameUrlMeta = (slot: ImageUrlSlot, url: string) => {
    const targetMode = edgeModeForGroup(slot.group)
    const existingEdge = edges.find((e) => e.target === node.id && e.mode === targetMode)
    if (existingEdge) storeDisconnectEdge(existingEdge.id)
    const latestMeta = getLatestMeta()
    const patch: Record<string, unknown> = { [slot.key]: url, [slot.key + '_nodeRef']: null }
    if (slot.group === 'first_frame') { patch.firstFrameUrl = url; patch.firstFrameRef = null }
    if (slot.group === 'last_frame') { patch.lastFrameUrl = url; patch.lastFrameRef = null }
    if (slot.group === 'reference') { patch.referenceImages = [url]; patch.referenceImageUrl = url; patch.referenceImageRef = null }
    updateNode(node.id, { meta: { ...latestMeta, ...patch } })
    setOpenSlotKey('')
  }
  const handleSlotUpload = async (slot: ImageUrlSlot, file: File | null | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setUploadError('只能选择图片文件')
      return
    }
    setUploadingSlotKey(slot.key)
    setUploadError('')
    try {
      const uploaded = await importWorkbenchLocalAssetFile(file, file.name || slot.label, {
        ownerNodeId: node.id,
        taskKind: 'image_edit',
      })
      const url = assetUrl(uploaded)
      if (!url) throw new Error('服务器没有返回图片 URL')
      setSingleFrameUrlMeta(slot, url)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setUploadingSlotKey('')
    }
  }

  const modelImageUrlSlots = [
    ...buildImageUrlSlots(selectedModelOption?.meta),
    ...imageCatalogReferenceSlot(imageCatalogConfig),
  ].filter((slot, index, slots) => slots.findIndex((item) => item.key === slot.key && item.group === slot.group) === index)
  // 认得档案 → 槽位严格由当前模式声明（首帧 / 首尾帧…，切模式即换整组，互斥 hide）。
  // 认不出 → 现有启发式槽 + 视频模型 首/尾帧 兜底。
  const imageUrlSlots: ImageUrlSlot[] = archMode
    ? archetypeModeSlots(archMode)
    : isVideoLike && modelImageUrlSlots.length === 0
      ? [
          { key: 'firstFrameUrl', label: '首帧', group: 'first_frame' },
          { key: 'lastFrameUrl', label: '尾帧', group: 'last_frame' },
        ]
      : modelImageUrlSlots
  const modeChoices = archetype ? archetypeModeChoices(archetype) : []
  const showModeBar = modeChoices.length > 1
  const showVariantBar = variantChoices.length > 1
  // 当前模式的数组参考槽（全能参考，meta-only）+ 源视频单槽（HappyHorse 视频编辑）。
  const arraySlots: ArchetypeArraySlot[] = archMode ? archetypeModeArraySlots(archMode) : []
  const sourceVideoSlot = archMode ? archetypeModeSourceVideoSlot(archMode) : null
  const showReferences = section === 'all' || section === 'references'

  // ── P1 统一参考槽：声明式 AssetSlot 列表 + 当前值 + 三类回调（单帧连边 / 数组 meta / 源视频 meta，复用上面已验证的写入逻辑）──
  const assetSlots: AssetSlot[] = [
    ...imageUrlSlots.map((s): AssetSlot => ({ key: s.key, label: s.label, accept: 'image', form: 'single', persistAsEdge: true, numbered: false, max: 1 })),
    ...arraySlots.map((s): AssetSlot => ({ key: s.metaKey, label: s.label, accept: s.accept, form: 'array', persistAsEdge: false, numbered: s.numbered, max: s.max, caption: s.caption })),
    ...(sourceVideoSlot ? [{ key: sourceVideoSlot.metaKey, label: sourceVideoSlot.label, accept: 'video', form: 'single', persistAsEdge: false, numbered: false, max: 1 } as AssetSlot] : []),
  ]
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
        resolvedFillUrlsByMetaKey.set(storage.metaKey, rs.fills.map((f) => f.url).filter((u): u is string => Boolean(u)))
        arrayOccupiedByKey.set(storage.metaKey, rs.fills.length)
      }
    }
  }
  const assetValuesByKey: Record<string, string | string[]> = {}
  for (const s of imageUrlSlots) {
    if (archMode && resolvedFillUrlsByMetaKey.has(s.key)) {
      assetValuesByKey[s.key] = resolvedFillUrlsByMetaKey.get(s.key)![0] || ''
      continue
    }
    const edgeSource = getEdgeSourceForSlot(s.group, edges, node.id)
    const nodeRef = edgeSource || getSlotNodeRef(meta, s.key)
    const thumbNode = nodeRef ? nodes.find((n) => n.id === nodeRef) : undefined
    assetValuesByKey[s.key] = (thumbNode ? resultPreviewUrl(thumbNode) : null) || getSlotThumbUrl(meta, s.key, nodes) || readMeta(meta, s.key) || ''
  }
  for (const s of arraySlots) assetValuesByKey[s.metaKey] = resolvedFillUrlsByMetaKey.get(s.metaKey) ?? readArchetypeArray(meta, s.metaKey)
  if (sourceVideoSlot) assetValuesByKey[sourceVideoSlot.metaKey] = resolvedFillUrlsByMetaKey.get(sourceVideoSlot.metaKey)?.[0] || readMeta(meta, sourceVideoSlot.metaKey) || ''

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
    if (slot.form === 'array') { handleArrayRemove(slot.key, index); return }
    if (slot.persistAsEdge) {
      const img = imageUrlSlots.find((i) => i.key === slot.key)
      if (img) handleSlotAssignment(img, '')
      return
    }
    updateMeta({ [slot.key]: null })
  }

  // section="parameters"：底栏 = 模型芯片 + 变体 + 最常调参数内联 + 「更多」弹层（主次分层，实现见 InlineParameterBar）。
  if (section === 'parameters') {
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
      />
    )
  }

  // 模式分段切换要常驻（即便当前模式无参考槽，如纯文生）——有 modeBar / 数组槽 / 源视频槽都不空返回。
  // 变体（型号）已从这里挪到底栏 InlineParameterBar 的小下拉（用户拍板：和模型并排在最下面），不再占顶部一排。
  if (section === 'references' && imageUrlSlots.length === 0 && arraySlots.length === 0 && !sourceVideoSlot && !showModeBar) return null

  // 走到这里只剩 section="references"（parameters/settings 已提前 return；旧的 all/model/controls 网格
  // 渲染随设置弹层落地而删除——参数现在进设置弹层，模型进底栏芯片，不再有这套裸值网格，Rule 1/12）。
  const rootClassName = cn('generation-canvas-v2-node__ref-section', 'flex flex-col gap-1')

  return (
    <div className={rootClassName} aria-label="参考素材">
      {showReferences && showModeBar ? (
        <ModeBar choices={modeChoices} activeId={archMode?.id || ''} onSelect={handleModeSwitch} />
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
          onUpload={(slot, file) => { void handleAssetUpload(slot, file) }}
          onRemove={handleAssetRemove}
          onInsertMention={onInsertMention}
          onReorder={handleReorder}
          onBrowseAll={handleBrowseAll}
        />
      ) : null}

      {showReferences && uploadError ? (
        <div className={cn('text-workbench-danger text-micro leading-tight')} role="alert">{uploadError}</div>
      ) : null}
    </div>
  )
}
