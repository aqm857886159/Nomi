import React from 'react'
import { cn } from '../../../utils/cn'
import { getDesktopActiveProjectId } from '../../../desktop/activeProject'
import { deriveGenerationModelCatalogStatus, findModelOptionByIdentifier, useGenerationModelOptionsState } from '../adapters/modelOptionsAdapter'
import {
  parseModelParameterControls,
  type ModelParameterControl,
} from '../../../config/modelCatalogMeta'
import type { ModelOption } from '../../../config/models'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getGenerationNodeExecutionKind, isImageLikeGenerationNodeKind, isVideoLikeGenerationNodeKind } from '../model/generationNodeKinds'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { importWorkbenchLocalAssetFile } from '../../api/assetUploadApi'
import {
  type DynamicCatalogControl,
  type DynamicModelControl,
  type ImageUrlSlot,
  assetUrl,
  buildDynamicControls,
  buildEffectiveImageCatalogConfig,
  buildEffectiveVideoCatalogConfig,
  buildImageUrlSlots,
  buildModelControls,
  buildSettingsSummary,
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
  applyArchetypeModeSwitch,
  archetypeModeArraySlots,
  archetypeModeChoices,
  archetypeModeParams,
  archetypeModeSlots,
  archetypeModeSourceVideoSlot,
  currentArchetypeMode,
  ensureArchetypeNodeMeta,
  modeHasCharacterSlot,
  readArchetypeArray,
  resolveArchetypeForModel,
} from './controls/archetypeMeta'
import ModeBar from './controls/ModeBar'
import SettingsPopover from './controls/SettingsPopover'
import AssetReference, { type AssetSlot } from '../../assets/AssetReference'
import type { AssetRef } from '../../assets/assetTypes'
import { moveArrayItem } from '../../assets/assetTypes'
import { removeMention } from '../../assets/promptMentions'

type NodeParameterControlsProps = {
  node: GenerationCanvasNode
  section?: 'all' | 'references' | 'parameters' | 'model' | 'controls' | 'settings'
  // section="parameters" 的设置芯片：开合状态由父级（composer）持有，便于把弹层渲染在卡底（不被裁剪）。
  settingsOpen?: boolean
  onToggleSettings?: () => void
  /** 点参考 tile → 在描述框光标处插入 @ 引用 chip(主路径,由 composer 注入 editor 命令)。 */
  onInsertMention?: (url: string) => void
}

function chooseDefaultModelOption(
  options: readonly ModelOption[],
  isImageLike: boolean,
  isVideoLike: boolean,
): ModelOption | undefined {
  void isImageLike
  void isVideoLike
  return options[0]
}

function resolveArchetypeForOption(option: ModelOption | null) {
  return resolveArchetypeForModel({ modelKey: option?.modelKey, modelAlias: option?.modelAlias, meta: option?.meta })
}

/**
 * 底部参数行要渲染的控件 —— 认得档案的模型用**当前模式**的标量参数（随模式变，如 HappyHorse
 * i2v 无比例）；认不出的走现有 flat catalog 解析。hook 与组件共用此函数，保证「算宽度」与「实际渲染」
 * 一致（单一来源）。
 */
function resolveRenderedControls(
  option: ModelOption | null,
  meta: Record<string, unknown>,
  isImageLike: boolean,
  isVideoLike: boolean,
): DynamicModelControl[] {
  const archetype = resolveArchetypeForOption(option)
  if (archetype) {
    return buildDynamicControls({
      parameterControls: archetypeModeParams(currentArchetypeMode(archetype, meta)),
      imageCatalogConfig: null,
      videoCatalogConfig: null,
      isImageLike,
      isVideoLike,
    })
  }
  return buildDynamicControls({
    parameterControls: parseModelParameterControls(option?.meta),
    imageCatalogConfig: buildEffectiveImageCatalogConfig(option?.meta),
    videoCatalogConfig: buildEffectiveVideoCatalogConfig(option?.meta),
    isImageLike,
    isVideoLike,
  })
}

export default function NodeParameterControls({
  node,
  section = 'all',
  settingsOpen = false,
  onToggleSettings,
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
  const isGenerationNode = isImageLike || isVideoLike || isTextLike

  const selectedModelValue = readMeta(meta, 'modelKey') || readMeta(meta, 'modelAlias') || readMeta(meta, 'imageModel') || readMeta(meta, 'videoModel')
  const selectedModelOption = findModelOptionByIdentifier(modelOptions, selectedModelValue) || null
  // 认得的模型 → 内置档案（供应商无关）；驱动模式分段切换 + 当前模式的槽/参数。认不出 → null（走 flat）。
  const archetype = resolveArchetypeForOption(selectedModelOption)
  const archMode = archetype ? currentArchetypeMode(archetype, meta) : null
  const imageCatalogConfig = archetype ? null : buildEffectiveImageCatalogConfig(selectedModelOption?.meta)
  const renderedControls = resolveRenderedControls(selectedModelOption, meta, isImageLike, isVideoLike)

  const updateMeta = (patch: Record<string, unknown>) => {
    updateNode(node.id, {
      meta: { ...(node.meta || {}), ...patch },
    })
  }

  const handleModelChange = (value: string) => {
    const nextOption = findModelOptionByIdentifier(modelOptions, value)
    const controls = buildModelControls(nextOption?.meta, isImageLike, isVideoLike)
    const defaultPatch = defaultPatchForControls(controls)
    updateNode(node.id, {
      meta: {
        ...removePreviousControlParams(node.meta || {}, renderedControls),
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

  React.useEffect(() => {
    if (!isGenerationNode) return
    if (selectedModelValue) return
    const firstOption = chooseDefaultModelOption(modelOptions, isImageLike, isVideoLike)
    if (!firstOption?.value) return
    const defaultPatch = defaultPatchForControls(buildModelControls(firstOption.meta, isImageLike, isVideoLike))
    updateNode(node.id, {
      meta: {
        ...(node.meta || {}),
        modelKey: firstOption.modelKey || firstOption.value,
        modelAlias: firstOption.modelAlias || firstOption.value,
        modelVendor: firstOption.vendor || null,
        vendor: firstOption.vendor || null,
        modelLabel: firstOption.label,
        ...defaultPatch,
        ...(isVideoLike
          ? { videoModel: firstOption.value, videoModelVendor: firstOption.vendor || null }
          : { imageModel: firstOption.value, imageModelVendor: firstOption.vendor || null }),
      },
    })
  }, [isGenerationNode, isVideoLike, modelOptions, node.id, node.meta, selectedModelValue, updateNode])

  React.useEffect(() => {
    if (!isGenerationNode || !selectedModelOption) return
    const optionVendor = typeof selectedModelOption.vendor === 'string' ? selectedModelOption.vendor.trim() : ''
    const currentVendor =
      readMeta(meta, 'modelVendor') ||
      readMeta(meta, 'vendor') ||
      readMeta(meta, isVideoLike ? 'videoModelVendor' : 'imageModelVendor')
    if (!optionVendor || currentVendor === optionVendor) return
    updateNode(node.id, {
      meta: {
        ...(node.meta || {}),
        modelKey: selectedModelOption.modelKey || selectedModelOption.value,
        modelAlias: selectedModelOption.modelAlias || selectedModelOption.value,
        modelVendor: optionVendor,
        vendor: optionVendor,
        modelLabel: selectedModelOption.label,
        ...(isVideoLike
          ? { videoModel: selectedModelOption.value, videoModelVendor: optionVendor }
          : { imageModel: selectedModelOption.value, imageModelVendor: optionVendor }),
      },
    })
  }, [isGenerationNode, isVideoLike, meta, node.id, node.meta, selectedModelOption, updateNode])

  // 选到一个有内置档案的模型、还没有命名空间 meta 时，初始化 node.meta.archetype（落到默认模式）。
  // 幂等：已是该档案则 no-op，不会循环。
  React.useEffect(() => {
    if (!isGenerationNode || !archetype) return
    const patch = ensureArchetypeNodeMeta(node.meta || {}, archetype)
    if (patch) updateNode(node.id, { meta: patch })
  }, [isGenerationNode, archetype, node.id, node.meta, updateNode])

  if (!isGenerationNode) return null
  const handleParameterControlChange = (control: ModelParameterControl, value: string) => {
    updateMeta({ [control.key]: parseControlInput(control, value) })
  }

  const handleCatalogControlChange = (control: DynamicCatalogControl, value: string) => {
    updateMeta(defaultPatchForCatalogControl({ ...control, defaultValue: value }))
  }

  // 切生成方式：只改 modeId，参考值全局保留（切回照片还在）；互斥发生在传输投影。
  const handleModeSwitch = (modeId: string) => {
    if (!archetype) return
    updateNode(node.id, { meta: applyArchetypeModeSwitch(node.meta || {}, archetype, modeId) })
    setOpenSlotKey('')
  }

  // ── C3 数组参考槽（全能参考，meta-only）：append / remove / 上传，写 node.meta[metaKey] 数组 ──
  const setArrayValue = (metaKey: string, next: string[]) => updateMeta({ [metaKey]: next })
  const handleArrayAdd = (slot: ArchetypeArraySlot, url: string) => {
    const trimmed = url.trim()
    if (!trimmed) return
    const current = readArchetypeArray(node.meta || {}, slot.metaKey)
    if (current.includes(trimmed) || current.length >= slot.max) return
    setArrayValue(slot.metaKey, [...current, trimmed])
    setOpenSlotKey('')
  }
  const handleArrayRemove = (metaKey: string, index: number) => {
    const current = readArchetypeArray(node.meta || {}, metaKey)
    const removedUrl = current[index] // 必须在 filter 前取(对抗评审 must-fix:删后数组已变)
    const next = current.filter((_, i) => i !== index)
    // image 数组(= character 参考)删除时,同步抹掉描述框里指向它的 @ chip。
    // meta 删除 + prompt 改写**合并成单个 updateNode**(对抗评审 must-fix:保 undo 原子性 + 一次持久化;
    // 走与现有 meta 删除同一持久化路径,不会出现刷新后 chip 复活)。chip/@ 只服务 image 参考,其余照旧。
    if (metaKey === 'referenceImageUrls' && removedUrl) {
      const nextPrompt = removeMention(node.prompt || '', removedUrl)
      if (nextPrompt !== (node.prompt || '')) {
        updateNode(node.id, { meta: { ...(node.meta || {}), [metaKey]: next }, prompt: nextPrompt })
        return
      }
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
      updateNode(node.id, { meta: { ...meta, ...clearPatch } })
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
    const sourceNode = nodes.find((n) => n.id === newSourceNodeId)
    const url = resultPreviewUrl(sourceNode)
    const patch: Record<string, unknown> = { [slot.key]: url || null, [slot.key + '_nodeRef']: newSourceNodeId }
    if (slot.group === 'first_frame') { patch.firstFrameUrl = url || null; patch.firstFrameRef = newSourceNodeId }
    if (slot.group === 'last_frame') { patch.lastFrameUrl = url || null; patch.lastFrameRef = newSourceNodeId }
    if (slot.group === 'reference') { patch.referenceImages = url ? [url] : []; patch.referenceImageUrl = url || null; patch.referenceImageRef = newSourceNodeId }
    updateNode(node.id, { meta: { ...meta, ...patch } })
    setOpenSlotKey('')
  }
  // 把单帧槽设成一个给定 URL（上传 / 选项目素材共用）：断开该组旧画布边(切到无源节点的 url)、写 flat meta。
  const setSingleFrameUrlMeta = (slot: ImageUrlSlot, url: string) => {
    const targetMode = edgeModeForGroup(slot.group)
    const existingEdge = edges.find((e) => e.target === node.id && e.mode === targetMode)
    if (existingEdge) storeDisconnectEdge(existingEdge.id)
    const latestMeta = useGenerationCanvasStore.getState().nodes.find((n) => n.id === node.id)?.meta || meta
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
  // 当前模式的数组参考槽（全能参考，meta-only）+ 源视频单槽（HappyHorse 视频编辑）。
  const arraySlots: ArchetypeArraySlot[] = archMode ? archetypeModeArraySlots(archMode) : []
  const sourceVideoSlot = archMode ? archetypeModeSourceVideoSlot(archMode) : null
  // U2：当前模式含角色图槽且已放图 → 在 prompt 旁提示「用 character1.. 指代」。
  const showCharacterCue = Boolean(archMode && modeHasCharacterSlot(archMode) && readArchetypeArray(meta, 'referenceImageUrls').length > 0)
  const showReferences = section === 'all' || section === 'references'

  // ── P1 统一参考槽：声明式 AssetSlot 列表 + 当前值 + 三类回调（单帧连边 / 数组 meta / 源视频 meta，复用上面已验证的写入逻辑）──
  const assetSlots: AssetSlot[] = [
    ...imageUrlSlots.map((s): AssetSlot => ({ key: s.key, label: s.label, accept: 'image', form: 'single', persistAsEdge: true, numbered: false, max: 1 })),
    ...arraySlots.map((s): AssetSlot => ({ key: s.metaKey, label: s.label, accept: s.accept, form: 'array', persistAsEdge: false, numbered: s.numbered, max: s.max, caption: s.caption })),
    ...(sourceVideoSlot ? [{ key: sourceVideoSlot.metaKey, label: sourceVideoSlot.label, accept: 'video', form: 'single', persistAsEdge: false, numbered: false, max: 1 } as AssetSlot] : []),
  ]
  const assetValuesByKey: Record<string, string | string[]> = {}
  for (const s of imageUrlSlots) {
    const edgeSource = getEdgeSourceForSlot(s.group, edges, node.id)
    const nodeRef = edgeSource || getSlotNodeRef(meta, s.key)
    const thumbNode = nodeRef ? nodes.find((n) => n.id === nodeRef) : undefined
    assetValuesByKey[s.key] = (thumbNode ? resultPreviewUrl(thumbNode) : null) || getSlotThumbUrl(meta, s.key, nodes) || readMeta(meta, s.key) || ''
  }
  for (const s of arraySlots) assetValuesByKey[s.metaKey] = readArchetypeArray(meta, s.metaKey)
  if (sourceVideoSlot) assetValuesByKey[sourceVideoSlot.metaKey] = readMeta(meta, sourceVideoSlot.metaKey) || ''

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
    const arr = readArchetypeArray(node.meta || {}, slot.key)
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

  // section="settings"：设置弹层内容（标量参数，带标签）。开合由 composer 控制，渲染在卡底（不被裁剪）。
  if (section === 'settings') {
    if (renderedControls.length === 0) return null
    return (
      <SettingsPopover
        open
        controls={renderedControls}
        meta={meta}
        onParameterChange={handleParameterControlChange}
        onCatalogChange={handleCatalogControlChange}
      />
    )
  }

  // section="parameters"：底栏 = 模型芯片(带 模板/通用 徽标) + 设置芯片(摘要 + 开设置弹层)。标量参数不在这，进弹层。
  if (section === 'parameters') {
    if (modelOptions.length === 0) {
      return (
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 h-7 px-3 rounded-pill border border-nomi-accent/30',
            'bg-nomi-accent-soft text-nomi-accent font-medium text-caption',
            'hover:bg-nomi-accent hover:text-nomi-paper transition-colors cursor-pointer',
          )}
          aria-label="去配置模型"
          title="点击打开模型接入页"
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); window.dispatchEvent(new CustomEvent('nomi-open-model-catalog')) }}
        >
          <span className="truncate">{modelCatalogStatus.message}</span>
          <span className="shrink-0">去配置 →</span>
        </button>
      )
    }
    return (
      <div className={cn('generation-canvas-v2-node__params--parameters', 'flex flex-1 flex-nowrap items-center gap-2 min-w-0')}>
        {/* 模型芯片：一个 pill 内含 名称 + 模板/通用徽标 + 下拉箭头（样张 v4：徽标嵌在芯片内，不是独立 pill 夹在中间） */}
        <div className={cn('inline-flex items-center gap-1 h-7 pl-3 pr-2.5 rounded-pill border border-nomi-line bg-nomi-paper min-w-0 focus-within:border-nomi-accent')}>
          <select
            className={cn('appearance-none bg-transparent border-0 outline-0 text-caption text-nomi-ink-80 cursor-pointer truncate min-w-0 max-w-[150px]')}
            aria-label="模型"
            value={selectedModelOption?.value || ''}
            onChange={(event) => handleModelChange(event.target.value)}
          >
            <option value="">选择模型</option>
            {modelOptions.map((option) => (
              <option key={option.value || 'auto'} value={option.value}>{option.label}</option>
            ))}
          </select>
          {selectedModelOption ? (
            <span
              className={cn(
                'shrink-0 text-micro leading-none px-1.5 py-[1px] rounded-pill',
                archetype ? 'bg-nomi-accent-soft text-nomi-accent' : 'bg-nomi-ink-10 text-nomi-ink-60',
              )}
              title={archetype ? '认得这个模型 · 用内置模板' : '未识别 · 通用回退（按接入文档原样展示）'}
            >{archetype ? '模板' : '通用'}</span>
          ) : null}
          <span className={cn('shrink-0 text-nomi-ink-40 text-micro leading-none pointer-events-none')} aria-hidden>▾</span>
        </div>
        {renderedControls.length > 0 && onToggleSettings ? (
          <button
            type="button"
            data-open={settingsOpen ? 'true' : 'false'}
            aria-expanded={settingsOpen}
            className={cn(
              'inline-flex items-center gap-1.5 h-7 px-[10px] rounded-pill min-w-0',
              'border border-nomi-line bg-nomi-paper text-nomi-ink-80 font-[inherit] text-caption cursor-pointer',
              'hover:border-nomi-ink-20',
              'data-[open=true]:border-nomi-accent data-[open=true]:text-nomi-accent data-[open=true]:bg-nomi-accent-soft',
            )}
            aria-label="生成设置"
            onClick={(event) => { event.stopPropagation(); onToggleSettings() }}
          >
            <span className="truncate">{buildSettingsSummary(renderedControls, meta) || '设置'}</span>
            <span className={cn('shrink-0 text-nomi-ink-40 text-micro')}>▾</span>
          </button>
        ) : null}
      </div>
    )
  }

  // 模式分段切换要常驻（即便当前模式无参考槽，如纯文生）——有 modeBar / 数组槽 / 源视频槽都不空返回。
  if (section === 'references' && imageUrlSlots.length === 0 && arraySlots.length === 0 && !sourceVideoSlot && !showModeBar) return null

  // 走到这里只剩 section="references"（parameters/settings 已提前 return；旧的 all/model/controls 网格
  // 渲染随设置弹层落地而删除——参数现在进设置弹层，模型进底栏芯片，不再有这套裸值网格，Rule 1/12）。
  const rootClassName = cn('generation-canvas-v2-node__ref-section', 'flex flex-col gap-[5px]')

  return (
    <div className={rootClassName} aria-label="参考素材">
      {showReferences && showModeBar ? (
        <ModeBar choices={modeChoices} activeId={archMode?.id || ''} onSelect={handleModeSwitch} />
      ) : null}

      {showReferences && assetSlots.length > 0 ? (
        <AssetReference
          slots={assetSlots}
          valuesByKey={assetValuesByKey}
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

      {showReferences && showCharacterCue ? (
        <div className={cn('text-nomi-ink-60 text-[10.5px] leading-[1.35]')}>
          提示：在描述里用 <span className="text-nomi-accent">character1</span>、<span className="text-nomi-accent">character2</span>… 指代上面的角色图
        </div>
      ) : null}

      {showReferences && uploadError ? (
        <div className={cn('text-workbench-danger text-[10.5px] leading-[1.25]')} role="alert">{uploadError}</div>
      ) : null}
    </div>
  )
}
