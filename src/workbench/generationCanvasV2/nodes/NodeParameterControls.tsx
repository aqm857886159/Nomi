import React from 'react'
import { cn } from '../../../utils/cn'
import { deriveGenerationModelCatalogStatus, findModelOptionByIdentifier, useGenerationModelOptionsState } from '../adapters/modelOptionsAdapter'
import {
  parseModelParameterControls,
  type ModelParameterControl,
} from '../../../config/modelCatalogMeta'
import type { ModelOption } from '../../../config/models'
import { WorkbenchButton } from '../../../design'
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
  currentArchetypeMode,
  ensureArchetypeNodeMeta,
  modeHasCharacterSlot,
  readArchetypeArray,
  resolveArchetypeForModel,
} from './controls/archetypeMeta'
import ModeBar from './controls/ModeBar'
import ReferenceSlots from './controls/ReferenceSlots'
import SettingsPopover from './controls/SettingsPopover'

type NodeParameterControlsProps = {
  node: GenerationCanvasNode
  section?: 'all' | 'references' | 'parameters' | 'model' | 'controls' | 'settings'
  // section="parameters" 的设置芯片：开合状态由父级（composer）持有，便于把弹层渲染在卡底（不被裁剪）。
  settingsOpen?: boolean
  onToggleSettings?: () => void
}

// Number of controls that render in the bottom value row for this node: the
// model selector (always one) + every dynamic control the selected model
// exposes. BaseGenerationNode uses this to widen the composer so the controls
// stay readable when a model has many params, instead of squishing into
// slivers. Model-agnostic — driven entirely by the catalog meta.
export function useNodeParameterControlCount(node: GenerationCanvasNode): number {
  const modelOptionsState = useGenerationModelOptionsState(node.kind)
  const modelOptions = modelOptionsState.options
  const isImageLike = isImageLikeGenerationNodeKind(node.kind)
  const isVideoLike = isVideoLikeGenerationNodeKind(node.kind)
  if (!isImageLike && !isVideoLike) return 0
  const meta = node.meta || {}
  const selectedModelValue = readMeta(meta, 'modelKey') || readMeta(meta, 'modelAlias') || readMeta(meta, 'imageModel') || readMeta(meta, 'videoModel')
  const selectedModelOption = findModelOptionByIdentifier(modelOptions, selectedModelValue) || null
  return resolveRenderedControls(selectedModelOption, meta, isImageLike, isVideoLike).length + 1
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
  const meta = node.meta || {}
  const [uploadingSlotKey, setUploadingSlotKey] = React.useState('')
  const [uploadError, setUploadError] = React.useState('')
  const [openSlotKey, setOpenSlotKey] = React.useState('')
  // C3 数组参考槽（全能参考）：哪个槽的「+ 添加」菜单展开 + 哪个槽正在上传。
  const [openArraySlotKey, setOpenArraySlotKey] = React.useState('')
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
    setOpenArraySlotKey('')
  }

  // ── C3 数组参考槽（全能参考，meta-only）：append / remove / 上传，写 node.meta[metaKey] 数组 ──
  const setArrayValue = (metaKey: string, next: string[]) => updateMeta({ [metaKey]: next })
  const handleArrayAdd = (slot: ArchetypeArraySlot, url: string) => {
    const trimmed = url.trim()
    if (!trimmed) return
    const current = readArchetypeArray(node.meta || {}, slot.metaKey)
    if (current.includes(trimmed) || current.length >= slot.max) return
    setArrayValue(slot.metaKey, [...current, trimmed])
    setOpenArraySlotKey('')
  }
  const handleArrayRemove = (metaKey: string, index: number) => {
    const current = readArchetypeArray(node.meta || {}, metaKey)
    setArrayValue(metaKey, current.filter((_, i) => i !== index))
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
      const patch: Record<string, unknown> = {
        [slot.key]: url,
        [slot.key + '_nodeRef']: null,
      }
      if (slot.group === 'first_frame') { patch.firstFrameUrl = url; patch.firstFrameRef = null }
      if (slot.group === 'last_frame') { patch.lastFrameUrl = url; patch.lastFrameRef = null }
      if (slot.group === 'reference') { patch.referenceImages = [url]; patch.referenceImageUrl = url; patch.referenceImageRef = null }
      updateNode(node.id, { meta: { ...(useGenerationCanvasStore.getState().nodes.find((n) => n.id === node.id)?.meta || meta), ...patch } })
      setOpenSlotKey('')
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
  const activeSlots = imageUrlSlots
  const modeChoices = archetype ? archetypeModeChoices(archetype) : []
  const showModeBar = modeChoices.length > 1
  const candidateImageNodes = nodes.filter((item) => item.id !== node.id && isImageLikeGenerationNodeKind(item.kind))
  // C3 数组参考槽（全能参考）：当前模式声明的数组槽 + 各自当前 URL 列表。
  const arraySlots: ArchetypeArraySlot[] = archMode ? archetypeModeArraySlots(archMode) : []
  const arrayValuesByKey: Record<string, string[]> = Object.fromEntries(
    arraySlots.map((slot) => [slot.metaKey, readArchetypeArray(meta, slot.metaKey)]),
  )
  const arrayCandidates = candidateImageNodes
    .map((item) => ({ id: item.id, title: item.title, url: resultPreviewUrl(item) }))
    .filter((item) => item.url)
  // U2：当前模式含角色图槽且已放图 → 在 prompt 旁提示「用 character1.. 指代」。
  const showCharacterCue = Boolean(archMode && modeHasCharacterSlot(archMode) && (arrayValuesByKey.referenceImageUrls?.length || 0) > 0)
  const showReferences = section === 'all' || section === 'references'

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
            'inline-flex items-center gap-1.5 h-7 px-3 rounded-full border border-nomi-accent/30',
            'bg-nomi-accent-soft text-nomi-accent font-medium text-[12px]',
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
        <div className={cn('inline-flex items-center gap-1.5 min-w-0')}>
          <div className={cn('relative inline-flex items-center')}>
            <select
              className={cn(
                'appearance-none h-7 max-w-[164px] pl-3 pr-7 rounded-full',
                'border border-nomi-line bg-nomi-paper text-nomi-ink-80 font-[inherit] text-[12px]',
                'cursor-pointer outline-0 focus:border-nomi-accent truncate',
              )}
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23a8a29e' stroke-width='2'><path d='M6 9l6 6 6-6'/></svg>\")",
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 10px center',
              }}
              aria-label="模型"
              value={selectedModelOption?.value || ''}
              onChange={(event) => handleModelChange(event.target.value)}
            >
              <option value="">选择模型</option>
              {modelOptions.map((option) => (
                <option key={option.value || 'auto'} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          {selectedModelOption ? (
            <span
              className={cn(
                'shrink-0 text-[11px] leading-none px-1.5 py-[3px] rounded-full',
                archetype ? 'bg-nomi-accent-soft text-nomi-accent' : 'bg-nomi-ink-10 text-nomi-ink-60',
              )}
              title={archetype ? '认得这个模型 · 用内置模板' : '未识别 · 通用回退（按接入文档原样展示）'}
            >{archetype ? '模板' : '通用'}</span>
          ) : null}
        </div>
        {renderedControls.length > 0 && onToggleSettings ? (
          <button
            type="button"
            data-open={settingsOpen ? 'true' : 'false'}
            aria-expanded={settingsOpen}
            className={cn(
              'inline-flex items-center gap-1.5 h-7 px-3 rounded-full min-w-0',
              'border border-nomi-line bg-nomi-paper text-nomi-ink-80 font-[inherit] text-[12px] cursor-pointer',
              'hover:border-nomi-ink-20',
              'data-[open=true]:border-nomi-accent data-[open=true]:text-nomi-accent data-[open=true]:bg-nomi-accent-soft',
            )}
            aria-label="生成设置"
            onClick={(event) => { event.stopPropagation(); onToggleSettings() }}
          >
            <span className="truncate">{buildSettingsSummary(renderedControls, meta) || '设置'}</span>
            <span className={cn('shrink-0 text-nomi-ink-40 text-[11px]')}>▾</span>
          </button>
        ) : null}
      </div>
    )
  }

  // 模式分段切换要常驻（即便当前模式无参考槽，如纯文生）——有 modeBar 或数组槽时都不空返回。
  if (section === 'references' && imageUrlSlots.length === 0 && arraySlots.length === 0 && !showModeBar) return null

  // 走到这里只剩 section="references"（parameters/settings 已提前 return；旧的 all/model/controls 网格
  // 渲染随设置弹层落地而删除——参数现在进设置弹层，模型进底栏芯片，不再有这套裸值网格，Rule 1/12）。
  const rootClassName = cn('generation-canvas-v2-node__ref-section', 'flex flex-col gap-[5px]')

  return (
    <div className={rootClassName} aria-label="参考素材">
      {showReferences && showModeBar ? (
        <ModeBar choices={modeChoices} activeId={archMode?.id || ''} onSelect={handleModeSwitch} />
      ) : null}

      {showReferences && imageUrlSlots.length > 0 ? (
        <div className={cn('generation-canvas-v2-node__ref-pickers', 'flex gap-[5px]')}>
          {activeSlots.map((slot) => {
            const edgeSource = getEdgeSourceForSlot(slot.group, edges, node.id)
            const metaRef = getSlotNodeRef(meta, slot.key)
            const nodeRef = edgeSource || metaRef
            const thumbNode = nodeRef ? nodes.find((n) => n.id === nodeRef) : undefined
            const thumbUrl = (thumbNode ? resultPreviewUrl(thumbNode) : null) || getSlotThumbUrl(meta, slot.key, nodes)
            const isEdgeConnected = Boolean(edgeSource)
            const isOpen = openSlotKey === slot.key
            return (
              <div key={slot.key} className={cn('generation-canvas-v2-node__ref-picker', 'relative grid flex-none gap-[3px] justify-items-center')}>
                <WorkbenchButton
                  className={cn(
                    'generation-canvas-v2-node__ref-thumb',
                    'relative w-9 h-9 p-0 rounded-[5px]',
                    'border border-dashed border-nomi-line-soft',
                    'bg-nomi-ink-05 text-nomi-ink-30 overflow-hidden',
                    'flex items-center justify-center cursor-pointer',
                    'data-[filled=true]:border-solid data-[filled=true]:border-nomi-line',
                    'data-[edge=true]:border-solid data-[edge=true]:border-[oklch(0.6_0.14_250)] data-[edge=true]:shadow-[0_0_0_1px_oklch(0.6_0.14_250)]',
                  )}
                  aria-label={slot.label}
                  data-filled={thumbUrl ? 'true' : 'false'}
                  data-edge={isEdgeConnected ? 'true' : 'false'}
                  title={slot.label}
                  onClick={() => setOpenSlotKey(isOpen ? '' : slot.key)}
                >
                  {thumbUrl ? (
                    <img className={cn('w-full h-full object-cover')} src={thumbUrl} alt={slot.label} />
                  ) : (
                    <span className={cn('text-nomi-ink-30 text-[16px] leading-none select-none pointer-events-none')}>+</span>
                  )}
                </WorkbenchButton>
                {isOpen ? (
                  <div
                    className={cn(
                      'generation-canvas-v2-node__ref-menu',
                      'absolute top-[42px] left-0 z-[3]',
                      'grid grid-cols-[repeat(4,32px)] gap-1 w-max max-w-[148px] p-[5px]',
                      'border border-nomi-line-soft rounded-[7px]',
                      'bg-nomi-paper shadow-nomi-lg',
                    )}
                    role="menu"
                    aria-label={`${slot.label}来源`}
                  >
                    <label className={cn(
                      'generation-canvas-v2-node__ref-menu-item',
                      'relative flex items-center justify-center w-8 h-8 p-0',
                      'border-0 rounded-[5px] bg-nomi-ink-05 text-nomi-ink-40',
                      'font-[inherit] overflow-hidden cursor-pointer',
                    )}>
                      <span className={cn('text-nomi-ink-30 text-[16px] leading-none select-none pointer-events-none')}>{uploadingSlotKey === slot.key ? '…' : '+'}</span>
                      <input
                        className={cn('absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-default')}
                        aria-label={`${slot.label}本地图像`}
                        type="file"
                        accept="image/*"
                        disabled={Boolean(uploadingSlotKey)}
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0] || null
                          void handleSlotUpload(slot, file)
                          event.currentTarget.value = ''
                        }}
                      />
                    </label>
                    {candidateImageNodes.map((item) => {
                      const itemUrl = resultPreviewUrl(item)
                      if (!itemUrl) return null
                      return (
                        <WorkbenchButton
                          key={item.id}
                          className={cn(
                            'generation-canvas-v2-node__ref-menu-item',
                            'relative flex items-center justify-center w-8 h-8 p-0',
                            'border-0 rounded-[5px] bg-nomi-ink-05 text-nomi-ink-40',
                            'font-[inherit] overflow-hidden cursor-pointer',
                          )}
                          aria-label={item.title}
                          onClick={() => handleSlotAssignment(slot, item.id)}
                        >
                          <img className={cn('w-full h-full object-cover')} src={itemUrl} alt={item.title} />
                        </WorkbenchButton>
                      )
                    })}
                    {nodeRef ? (
                      <WorkbenchButton
                        className={cn(
                          'generation-canvas-v2-node__ref-menu-item',
                          'relative flex items-center justify-center w-8 h-8 p-0',
                          'border-0 rounded-[5px] bg-nomi-ink-05',
                          'text-workbench-danger text-[15px]',
                          'font-[inherit] overflow-hidden cursor-pointer',
                        )}
                        aria-label="清除参考图"
                        onClick={() => handleSlotAssignment(slot, '')}
                      >
                        ×
                      </WorkbenchButton>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {showReferences && arraySlots.length > 0 ? (
        <ReferenceSlots
          slots={arraySlots}
          valuesByKey={arrayValuesByKey}
          candidates={arrayCandidates}
          openKey={openArraySlotKey}
          uploadingKey={uploadingArrayKey}
          onToggleMenu={(metaKey) => setOpenArraySlotKey((prev) => (prev === metaKey ? '' : metaKey))}
          onPickNode={(metaKey, url) => { const slot = arraySlots.find((s) => s.metaKey === metaKey); if (slot) handleArrayAdd(slot, url) }}
          onUpload={(slot, file) => { void handleArrayUpload(slot, file) }}
          onRemove={handleArrayRemove}
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
