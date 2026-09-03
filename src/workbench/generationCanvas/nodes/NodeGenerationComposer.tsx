import React from 'react'
import { useTranslation } from 'react-i18next'
import type { Editor } from '@tiptap/react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { IconFileText } from '../../../vendor/tablerIcons'
import { NomiLoadingMark, NomiSelect } from '../../../design'
import { cn } from '../../../utils/cn'
import { fetchUserPrompts, type PromptMediaType, type PromptReferenceImage } from '../../api/promptLibraryApi'
import PromptEditor from '../../assets/PromptEditor'
import { promptToContent } from '../../assets/promptEditorContent'
import { useAllProjectAssets } from '../../assets/useAllProjectAssets'
import { useNodeMentionSource } from './useNodeMentionSource'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { canRunGenerationNode, confirmAndRunNode, confirmAndRunNodeVariants, regenerateNodeInPlace, unmetReferenceDependencyForNode } from '../runner/generationRunController'
import type { UnmetReferenceDependency } from './controls/referenceDependency'
import { collectUngeneratedReferenceAncestors } from '../runner/referenceAncestors'
import { buildDependencyWaves } from '../runner/dependencyWaves'
import { useBatchPlanPreviewStore } from '../components/batchPlanPreview'
import NodeParameterControls from './NodeParameterControls'
import { GENERATE_BUTTON_CLASS } from './nodeComposerStyles'
import { NodeLockBadge } from './NodeLockBadge'
import NodeCameraMoveControl from './NodeCameraMoveControl'
import { NodePromptOptimizer } from './NodePromptOptimizer'
import { useNodeAssetDrop } from './useNodeAssetDrop'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import {
  getGenerationNodeExecutionKind,
  getGenerationNodePromptPlaceholder,
  isAudioLikeGenerationNodeKind,
  isImageLikeGenerationNodeKind,
  isModel3dLikeGenerationNodeKind,
  isVideoLikeGenerationNodeKind,
} from '../model/generationNodeKinds'
import { resolveArchetypeForModel } from '../../../config/modelArchetypes'
import { applyArchetypeModeSwitch, currentArchetypeMode } from './controls/archetypeMeta'
import { archetypeForNode, resolveModeForReferenceDemand } from '../agent/referenceEdgeCapability'
import { addAssetUrlToNode } from './nodeAssetWrite'
import { toast } from '../../../ui/toast'
import { getTextGenMode, type TextGenMode } from '../runner/textActions'
import {
  GENERATION_VARIANT_COUNTS,
  parseGenerationVariantCount,
  type GenerationVariantCount,
} from './generationVariantCount'
import { useComposerViewportPlacement } from './useComposerViewportPlacement'
import { COMPOSER_MIN_USABLE_HEIGHT } from './nodeSizing'
import {
  findModelOptionByIdentifier,
  requiredModeForGenerationNode,
  useGenerationModelOptionsState,
} from '../adapters/modelOptionsAdapter'
import { nodeSelectedModelAddress } from './controls/parameterControlModel'
import { comfyWorkflowTakesPrompt } from '../runner/promptRequirement'

// C5 P2：文本节点的三种生成模式（label 由 composer.append/rewrite/replace 在渲染处翻译）。
const TEXT_GEN_MODES: { value: TextGenMode; labelKey: string }[] = [
  { value: 'append', labelKey: 'composer.append' },
  { value: 'rewrite', labelKey: 'composer.rewrite' },
  { value: 'replace', labelKey: 'composer.replace' },
]
const TEXT_MODE_PLACEHOLDER_KEY: Record<TextGenMode, string> = {
  append: 'composer.appendPlaceholder',
  rewrite: 'composer.rewritePlaceholder',
  replace: 'composer.replacePlaceholder',
}

const PROMPT_PICKER_WIDTH = 245
const PROMPT_PICKER_MIN_WIDTH = 240
const PROMPT_PICKER_MAX_HEIGHT = 310
const PROMPT_PICKER_MARGIN = 12
const PROMPT_PICKER_PREVIEW_WIDTH = 296
const PROMPT_PICKER_PREVIEW_GAP = 4
const PROMPT_PICKER_PREVIEW_MAX_HEIGHT = 380

type PromptPickerPosition = {
  left: number
  top: number
  width: number
}

// 生成节点的浮动 composer：references + 提示词 + 参数 + 生成/重新生成按钮。
// 从 BaseGenerationNode 抽出（A1.5 接缝）：只有「生成类」节点挂它，素材节点不挂。
// 所有生成相关依赖（runner / NodeParameterControls / 布局计算）都收在这里，壳保持 kind 无关。

type Props = {
  node: GenerationCanvasNode
  visualSize: { width: number; height: number }
}

type FloatingComposerLayout = {
  maxHeight: number
  gap: number
}

function floatingComposerLayout(_width: number, _height: number, kind: GenerationCanvasNode['kind']): FloatingComposerLayout {
  // 宽度不再在这里算——它**内容驱动**（CSS `w-fit` + `min-w/max-w` 边界，见卡 className），
  // 跟着该模型实际的参数横排自然撑开，参数少则窄、多则宽、触上限在卡内换行（绝不绑节点比例、不钉死常数）。
  //
  // 高度同理**内容驱动**，不再绑节点高（旧 `height*0.72` 是 bug 根因：小节点 → 矮卡，
  // 「参考区 + 3 行提示词 + 底栏」放不下，overflow-hidden 把底栏的生成钮裁到卡外，修③④）。
  // 卡片在 flex-col 里自然按内容长高；只有一个可伸缩区（提示词 flex-1 overflow-auto），
  // 底栏 shrink-0 永远贴底可见。这里给一个宽松上限：内容超过它时只有提示词内部滚动，底栏不动。
  const maxHeight = kind === 'video' ? 460 : 400
  // 连接间距是空间关系，不应随节点画幅宽度跨阈值跳变；否则 1:1 → 21:9 时即使底边
  // 锚点完全不动，composer 仍会被旧的 10px → 14px 分支推开，看起来像断开。
  const gap = 14
  return { maxHeight, gap }
}

// 提示词只此一家（素材面收敛 2026-07-22）：picker 读主提示词库「我的库」（原素材盒 localStorage 私账已并入）。
type PromptPickerItem = {
  id: string
  title: string
  prompt: string
  promptType: PromptMediaType
  referenceImages: PromptReferenceImage[]
}

type BrowserPromptPickerPopoverProps = {
  items: PromptPickerItem[]
  position: PromptPickerPosition | null
  onSelect: (item: PromptPickerItem) => void
  setNodeRef: (node: HTMLDivElement | null) => void
}

function BrowserPromptPickerPopover({
  items,
  position,
  onSelect,
  setNodeRef,
}: BrowserPromptPickerPopoverProps): React.ReactPortal | null {
  const { t } = useTranslation()
  const [hoveredPromptId, setHoveredPromptId] = React.useState<string | null>(null)
  const [previewTop, setPreviewTop] = React.useState(0)
  const [previewAnchorCenter, setPreviewAnchorCenter] = React.useState(0)
  const previewCardRef = React.useRef<HTMLElement | null>(null)
  const hoveredItem = hoveredPromptId ? items.find((item) => item.id === hoveredPromptId) ?? null : null
  const hoveredReferences = hoveredItem?.referenceImages ?? []
  const showHoveredPrompt = React.useCallback((id: string, row: HTMLElement): void => {
    setHoveredPromptId(id)
    const root = row.closest('[data-prompt-picker-root="true"]')
    const rootRect = root?.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    const anchorCenter = rootRect ? rowRect.top - rootRect.top + rowRect.height / 2 : rowRect.height / 2
    const nextItem = items.find((item) => item.id === id)
    const referenceCount = nextItem?.referenceImages.length ? 1 : 0
    const innerWidth = PROMPT_PICKER_PREVIEW_WIDTH - 16
    const promptPreviewHeight = nextItem?.prompt ? 118 : 0
    const estimatedHeight = Math.min(
      PROMPT_PICKER_PREVIEW_MAX_HEIGHT,
      16 + referenceCount * (innerWidth * 9 / 16) + promptPreviewHeight,
    )
    setPreviewAnchorCenter(anchorCenter)
    setPreviewTop(anchorCenter - estimatedHeight / 2)
  }, [items])
  React.useLayoutEffect(() => {
    if (hoveredReferences.length === 0) return
    const card = previewCardRef.current
    if (!card) return
    setPreviewTop(previewAnchorCenter - card.getBoundingClientRect().height / 2)
  }, [hoveredReferences.length, previewAnchorCenter])
  if (!position || typeof document === 'undefined') return null

  return createPortal(
    <motion.div
      ref={setNodeRef}
      data-prompt-picker-root="true"
      className="fixed z-[80] overflow-visible"
      style={{ left: position.left, top: position.top, width: position.width, transformOrigin: 'top right' }}
      initial={{ opacity: 0, y: -6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
      role="menu"
      aria-label={t('generationCommon.composer.promptLibrary')}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseLeave={() => setHoveredPromptId(null)}
    >
      <div className="max-h-[310px] overflow-hidden rounded-nomi bg-nomi-paper shadow-nomi-lg">
        <div className="min-w-0 overflow-y-auto py-1">
          {items.length === 0 ? (
            <div className="grid min-h-24 place-items-center px-4 text-center text-caption text-nomi-ink-40">
              {t('generationCommon.composer.emptyPromptLibrary')}
            </div>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={cn(
                  'grid w-full min-w-0 grid-cols-[32px_minmax(0,1fr)] items-center gap-2 border-0 bg-transparent px-2.5 py-1.5 text-left',
                  'cursor-pointer transition-colors duration-[var(--nomi-transition-fast)]',
                  'text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink',
                )}
                onMouseEnter={(event) => showHoveredPrompt(item.id, event.currentTarget)}
                onFocus={(event) => showHoveredPrompt(item.id, event.currentTarget)}
                onClick={() => onSelect(item)}
              >
                {item.referenceImages[0]?.url ? (
                  <img
                    src={item.referenceImages[0].url}
                    alt=""
                    draggable={false}
                    className="block size-8 rounded-nomi-sm object-cover"
                  />
                ) : (
                  <span className="grid size-8 place-items-center rounded-nomi-sm bg-nomi-bg text-nomi-ink-40">
                    <IconFileText size={15} stroke={1.6} aria-hidden="true" />
                  </span>
                )}
                <span className="block min-w-0 overflow-hidden whitespace-nowrap text-caption leading-none">
                  {item.prompt}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
      {hoveredReferences.length > 0 ? (
        <aside
          ref={previewCardRef}
          className="absolute left-full overflow-hidden rounded-nomi bg-nomi-paper p-2 shadow-nomi-lg"
          style={{
            top: previewTop,
            marginLeft: PROMPT_PICKER_PREVIEW_GAP,
            width: PROMPT_PICKER_PREVIEW_WIDTH,
            maxHeight: PROMPT_PICKER_PREVIEW_MAX_HEIGHT,
          }}
        >
          <div className="grid gap-2">
            {hoveredReferences.slice(0, 1).map((reference, index) => (
              <div
                key={`${reference.url}-${index}`}
                className="overflow-hidden rounded-nomi-sm bg-nomi-paper shadow-nomi-sm"
              >
                <img src={reference.url} alt="" draggable={false} className="block aspect-video w-full object-cover" />
              </div>
            ))}
            {hoveredItem?.prompt ? (
              <div className="overflow-hidden rounded-nomi-sm bg-nomi-bg/70 px-2 py-1.5 text-caption leading-snug text-nomi-ink-60 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:6] [overflow-wrap:anywhere]">
                {hoveredItem.prompt}
              </div>
            ) : null}
          </div>
        </aside>
      ) : null}
    </motion.div>,
    document.body,
  )
}

export default function NodeGenerationComposer({ node, visualSize }: Props): JSX.Element {
  const { t } = useTranslation()
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const status = node.status || 'idle'
  const isGenerating = status === 'queued' || status === 'running'
  const hasResult = Boolean(node.result?.url)
  const nodeExecutionKind = getGenerationNodeExecutionKind(node.kind)
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const edges = useGenerationCanvasStore((state) => state.edges)
  const requiredMode = requiredModeForGenerationNode(node, { nodes, edges })
  const modelOptions = useGenerationModelOptionsState(node.kind, requiredMode).options
  const selectedModelAddress = nodeSelectedModelAddress(node.meta || {})
  const selectedModelOption = findModelOptionByIdentifier(
    modelOptions,
    selectedModelAddress.modelKey,
    selectedModelAddress.vendorKey,
  )
  // 导入工作流是否接收提示词由保存下来的 binding 决定。明确不接收时，整组移除无效输入和动作；
  // null 表示非 ComfyUI 或目录尚未就绪，维持普通模型原有体验。
  const acceptsPrompt = comfyWorkflowTakesPrompt(selectedModelOption?.meta) !== false
  // v0.7.2 perf: 用 boolean primitive 订阅 canGenerate
  const canGenerate = useGenerationCanvasStore((state) =>
    canRunGenerationNode(node, { nodes: state.nodes, edges: state.edges }),
  ) && !isGenerating
  // 跨槽依赖未满足（档案 slot.requiresAnyOf；如 Seedance 2.0 只放了参考音频、缺图/视频）。
  // 与 canGenerate 同一个判定（unmetReferenceDependencyForNode），composer 不再按 node.kind 重猜原因。
  // 订阅**字符串**而非对象：对象选择器每帧新引用会破坏 v0.7.2 的 primitive 订阅防抖；
  // 文案仍留到渲染时用 t() 格式化，保证切语言能实时重渲。
  const unmetDependencyKey = useGenerationCanvasStore((state) =>
    JSON.stringify(unmetReferenceDependencyForNode(node, { nodes: state.nodes, edges: state.edges })),
  )
  const unmetDependency = React.useMemo(
    () => JSON.parse(unmetDependencyKey) as UnmetReferenceDependency | null,
    [unmetDependencyKey],
  )
  // 自动备齐参考（对话 2026-06-14）：本节点经参考边、尚未出图的上游 id（稳定 key 订阅防抖）。
  // 有则「生成」不裸跑，转而排依赖波次（参考先生成→本节点后生成）走批量确认条。
  const pendingRefKey = useGenerationCanvasStore((state) =>
    collectUngeneratedReferenceAncestors(node.id, { nodes: state.nodes, edges: state.edges }).join(','),
  )
  const hasPendingRefs = pendingRefKey.length > 0
  // 视频缺参考本会禁用「生成」；但若缺的是「连了线、只是还没生成」的上游 → 仍可点（去备齐），不禁用。
  const canGenerateNow = canGenerate || (hasPendingRefs && !isGenerating)
  const composerLayout = floatingComposerLayout(visualSize.width, visualSize.height, node.kind)
  const isTextKind = node.kind === 'text'
  // 声音节点：解析当前档案模式（配音 speech / 转写 transcribe），驱动「台词框 vs 音频参考槽」分流。
  const isAudioKind = isAudioLikeGenerationNodeKind(node.kind)
  const audioMode = React.useMemo(() => {
    if (!isAudioKind) return null
    const meta = node.meta || {}
    const archetype = resolveArchetypeForModel({
      modelKey: typeof meta.modelKey === 'string' ? meta.modelKey : undefined,
      modelAlias: typeof meta.modelAlias === 'string' ? meta.modelAlias : undefined,
      vendorKey: typeof meta.modelVendor === 'string' ? meta.modelVendor : typeof meta.vendor === 'string' ? meta.vendor : null,
      meta,
    })
    return archetype ? currentArchetypeMode(archetype, meta) : null
  }, [isAudioKind, node.meta])
  const audioIsTranscribe = audioMode?.transportTaskKind === 'transcribe'
  const textGenMode = getTextGenMode(node)
  const hasPromptPickerButton = Boolean(nodeExecutionKind) && acceptsPrompt && !audioIsTranscribe && !isTextKind
  const hasReferenceControls =
    isImageLikeGenerationNodeKind(node.kind) ||
    isVideoLikeGenerationNodeKind(node.kind) ||
    isAudioKind ||
    // 3D 的图生3D模式带 first_frame 参考槽——漏了它参考区整个不渲染，图生3D没法放参考（同族 kind 边界漏 3D）。
    isModel3dLikeGenerationNodeKind(node.kind)
  // 持有 prompt 编辑器实例,供「点参考 tile → 在光标处插入 chip」(@ 内联引用主路径)。
  const [promptEditor, setPromptEditor] = React.useState<Editor | null>(null)
  const [promptPickerOpen, setPromptPickerOpen] = React.useState(false)
  const [promptPickerItems, setPromptPickerItems] = React.useState<PromptPickerItem[]>([])
  // 变体张数是会话态、不落盘；显式列出 1–4，避免循环按钮让用户猜下一档。
  const [variantCount, setVariantCount] = React.useState<GenerationVariantCount>(1)
  const [promptPickerPosition, setPromptPickerPosition] = React.useState<PromptPickerPosition | null>(null)
  const promptPickerButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const promptPickerPopoverRef = React.useRef<HTMLDivElement | null>(null)
  // 拖文件到卡 → 加为参考（捷径 A）。仅当当前模式有数组参考槽时接管拖拽。
  const { acceptsDrop, isDragOver, isUploading, dropHandlers } = useNodeAssetDrop(node)
  // @ 候选 = 当前模式 image_ref 槽的有序填充（连线在前+上传，option 2 单源），与面板编号①②③、
  // 发送的 reference_image 数组同一口径——连线进来的参考图也在候选里、能被 @（此前只读 meta 漏掉边）。
  // 候选已扩到三组：当前参考 / 画布已出图节点 / 素材库。后两组选中会**先真的建立引用**再插 chip
  // （建边或落上传槽，都过能力校验闸），见 useNodeMentionSource。
  const { assets: projectAssets } = useAllProjectAssets()
  const mentionLibraryAssets = React.useMemo(
    () => projectAssets.flatMap((asset) => {
      if ((asset.kind !== 'image' && asset.kind !== 'video' && asset.kind !== 'audio') || !asset.renderUrl) return []
      return [{ id: asset.id, name: asset.name, url: asset.renderUrl, kind: asset.kind }]
    }),
    [projectAssets],
  )
  const { orderedReferenceUrls: mentionCandidates, orderedMediaReferences, mentionSearch, onMentionSelect } =
    useNodeMentionSource(node, mentionLibraryAssets)
  const insertMention = React.useCallback((url: string) => {
    if (!promptEditor || promptEditor.isDestroyed) return
    const reference = orderedMediaReferences.find((candidate) => candidate.url === url)
    promptEditor.commands.insertAssetMention(url, reference?.index, reference?.kind)
  }, [orderedMediaReferences, promptEditor])

  /**
   * 描述框 placeholder：**这张卡已经有参考图时**才在尾巴上挂一句「打 @ 可引用参考图」。
   *
   * 为什么挂条件而不是写死进每条 placeholder 文案：@ 只是键盘加速器（可发现的主路径是点参考 tile
   * 直接插 chip），没有参考图时打 @ 只会弹一个「没有可引用的图」的空面板——那句提示就成了误导。
   * 挂在 placeholder 上而不是新增一行常驻说明，是因为这个面已经拍板过「最少文字」（omni 样张 v4
   * 特意砍掉了三组标签/caption）：placeholder 一开始打字就消失，不占常驻预算。
   */
  const appendMentionHint = (base: string): string =>
    mentionCandidates.length > 0 ? `${base} · ${t('assetLibrary.mentionPlaceholderHint')}` : base

  const loadPromptPickerItems = React.useCallback((): void => {
    void fetchUserPrompts()
      .then((prompts) => {
        setPromptPickerItems(prompts.map((prompt) => ({
          id: prompt.id,
          title: prompt.title,
          prompt: prompt.prompt,
          promptType: prompt.promptType,
          referenceImages: prompt.referenceImages ?? [],
        })))
      })
      .catch(() => setPromptPickerItems([]))
  }, [])

  const updatePromptPickerPosition = React.useCallback((): void => {
    const button = promptPickerButtonRef.current
    if (!button || typeof window === 'undefined') return
    const rect = button.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const availableWidth = viewportWidth - PROMPT_PICKER_MARGIN * 2
    const width = Math.max(
      PROMPT_PICKER_MIN_WIDTH,
      Math.min(PROMPT_PICKER_WIDTH, availableWidth),
    )
    const maxLeft = viewportWidth - width - PROMPT_PICKER_MARGIN
    const left = Math.max(
      PROMPT_PICKER_MARGIN,
      Math.min(rect.right - width, maxLeft),
    )
    const belowTop = rect.bottom + 8
    const aboveTop = rect.top - PROMPT_PICKER_MAX_HEIGHT - 8
    const top = belowTop + PROMPT_PICKER_MAX_HEIGHT <= viewportHeight - PROMPT_PICKER_MARGIN
      ? belowTop
      : Math.max(PROMPT_PICKER_MARGIN, Math.min(aboveTop, viewportHeight - PROMPT_PICKER_MAX_HEIGHT - PROMPT_PICKER_MARGIN))
    setPromptPickerPosition({ left, top, width })
  }, [])

  React.useEffect(() => {
    if (!promptPickerOpen) return undefined
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (target && promptPickerButtonRef.current?.contains(target)) return
      if (target && promptPickerPopoverRef.current?.contains(target)) return
      setPromptPickerOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPromptPickerOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown, { capture: true })
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [promptPickerOpen])

  React.useLayoutEffect(() => {
    if (!promptPickerOpen || typeof window === 'undefined') return undefined
    updatePromptPickerPosition()
    const frame = window.requestAnimationFrame(updatePromptPickerPosition)
    const handleViewportChange = (): void => updatePromptPickerPosition()
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [promptPickerOpen, updatePromptPickerPosition])

  const togglePromptPicker = React.useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    if (promptPickerOpen) {
      setPromptPickerOpen(false)
      return
    }
    loadPromptPickerItems()
    updatePromptPickerPosition()
    setPromptPickerOpen(true)
  }, [loadPromptPickerItems, promptPickerOpen, updatePromptPickerPosition])

  const applyPromptPickerItem = React.useCallback(
    (item: PromptPickerItem): void => {
      if (node.locked) return
      if (promptEditor && !promptEditor.isDestroyed) {
        promptEditor.commands.setContent(promptToContent(item.prompt, mentionCandidates))
        promptEditor.commands.focus('end')
      }
      updateNode(node.id, { prompt: item.prompt })
      // 库 prompt 自带的参考图一并落地（此前只写 prompt，item.referenceImages 被静默丢弃——
      // 2026-07-28 群反馈「参考被丢」家族）。当前生成方式收不下 image_ref 先促到能收的模式
      // （与建边 auto-promote 同一把尺子），再走 addAssetUrlToNode 单源写入（去重/上限同一处）；
      // 模型任何模式都不吃图参考 → 诚实提示只应用了文本，不写死数据。
      const referenceUrls = item.referenceImages.map((reference) => reference.url).filter(Boolean)
      if (referenceUrls.length) {
        const state = useGenerationCanvasStore.getState()
        const target = state.nodes.find((candidate) => candidate.id === node.id)
        const archetype = target ? archetypeForNode(target) : null
        if (target && archetype) {
          const promotedModeId = resolveModeForReferenceDemand(
            archetype,
            (target.meta || {}) as Record<string, unknown>,
            [{ slots: ['image_ref'], asset: 'image' }],
          )
          if (promotedModeId) {
            state.updateNode(node.id, {
              meta: applyArchetypeModeSwitch((target.meta || {}) as Record<string, unknown>, archetype, promotedModeId),
            })
          }
        }
        const outcomes = referenceUrls.map((url) => addAssetUrlToNode(node.id, 'image', url))
        if (outcomes.every((outcome) => outcome.status === 'no-slot')) {
          toast(t('generationCommon.composer.promptReferenceUnsupported'), 'info')
        }
      }
      setPromptPickerOpen(false)
      void persistActiveWorkbenchProjectNow().catch(() => {})
    },
    [mentionCandidates, node.id, node.locked, promptEditor, t, updateNode],
  )

  const handleGenerate = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const state = useGenerationCanvasStore.getState()
    // 自动备齐参考：本节点有「连了线但还没出图」的上游 → 不裸跑，排依赖波次（参考先、本镜后）
    // 走批量确认条（确认前零调用零扣费；用户一眼看到先生成谁、再生成谁）。根治单节点生成绕过
    // 依赖、参考没回灌进镜头的整类问题（对话 2026-06-14）。
    const pendingRefs = collectUngeneratedReferenceAncestors(node.id, { nodes: state.nodes, edges: state.edges })
    if (pendingRefs.length > 0) {
      const plan = buildDependencyWaves([...pendingRefs, node.id], { nodes: state.nodes, edges: state.edges })
      useBatchPlanPreviewStore.getState().open(plan)
      return
    }
    if (!canRunGenerationNode(node, { nodes: state.nodes, edges: state.edges })) return
    // ×N 变体连发（样张拍板 2026-07-29）：一次确认按 N 张报成本，串行连跑，出图堆进本节点历史。
    if (variantCount > 1) {
      await confirmAndRunNodeVariants(node.id, variantCount)
      return
    }
    // 已有结果的「重新生成」原地回填：新图进当前节点堆叠并设为主图，不再复制新节点。
    if (hasResult) await regenerateNodeInPlace(node.id)
    else await confirmAndRunNode(node.id)
  }

  // 吃提示词的节点才有「最小可用高度」——不吃的（如某些 ComfyUI 工作流）本来就该按内容自然矮。
  const minUsableHeight = acceptsPrompt ? COMPOSER_MIN_USABLE_HEIGHT : 0
  const { anchorRef, canvasZoom, flipUp, aboveClearance, shiftX, maxHeight } = useComposerViewportPlacement({
    node,
    visualSize,
    gap: composerLayout.gap,
    preferredMaxHeight: composerLayout.maxHeight,
    minUsableHeight,
  })

  // 卡宽 = **内容驱动**（用户拍板 2026-06-16，推翻 06-13 的「按最宽模型恒定宽」）：
  // 卡片 **w-max**（max-content）跟着当前模型的「底栏一行」(锁+参数+生成钮)自然撑开。参数已主次分层
  // （最常调内联、其余收进 InlineParameterBar 的「更多」弹层，方案 B 2026-06-25），底栏恒单行，生成钮 ml-auto 贴右。
  // **为什么不能用 w-fit**：composer 是 absolute + left-1/2 锚在节点上，fit-content 的可用宽被节点框
  // (~300px) 卡死 → 塌回 min-content(min-w-360)、参数多就被挤截断（实测 2026-06-16 真机：card 卡 360）。
  // max-content 不吃可用宽约束，按内容真实宽长开。提示词/参考区用 w-0 min-w-full **只填不撑**(贡献 0 到
  // max-content，长 prompt 在卡宽内换行，不把卡撑爆)。max-w 兜底防极端。（离屏测量器已删，纯 CSS。）

  return (
    // 外层只做定位锚（不裁剪），宽度跟随内层卡（w-max 包住按内容长开的卡，便于 -translate-x-1/2 居中）。
    <div
      ref={anchorRef}
      className={cn(
        'generation-canvas-v2-node__composer',
        'absolute left-1/2 z-[8] w-max',
        // 画布拖动期间隐身（拖节点、拖选区/组框、拖画布平移都算；状态源=stage 的 data-dragging，见 canvasDraggingFlag）。
        // 刻意用 visibility 而非条件卸载：里面是 TipTap 编辑器实例，卸载 = 丢未提交的输入 +
        // 每次拖动重建编辑器（拖动是最高频动作）。
        'group-data-[dragging=true]/canvas:invisible',
      )}
      data-flipped={flipUp ? 'true' : 'false'}
      style={{
        // 用户反馈③：反向缩放抵消画布 scale(zoom) → 面板恒定屏幕尺寸（缩小画布只缩上面的卡片框，
        // 不缩这个参数框）。横向居中的 -translate-x-1/2 改写进 transform（否则被 scale 覆盖）。
        // transform-origin 贴住与节点相连的那条边（默认朝下=顶边、翻上=底边），缩放时锚点不漂移。
        // 最左的 translateX(shiftX px) 在屏幕空间生效（不被 scale 缩）→ 横向夹取把溢出视口的宽卡拉回。
        transform: `translateX(${shiftX}px) translateX(-50%) scale(${1 / (canvasZoom || 1)})`,
        transformOrigin: flipUp ? 'bottom center' : 'top center',
        ...(flipUp
          ? { bottom: `calc(100% + ${composerLayout.gap + aboveClearance}px)` }
          : { top: `calc(100% + ${composerLayout.gap}px)` }),
        cursor: 'default',
        userSelect: 'auto',
        touchAction: 'auto',
      }}
      onPointerDown={(event) => event.stopPropagation()}
      {...(acceptsDrop ? dropHandlers : {})}
    >
      <div
        className={cn(
          'generation-canvas-v2-node__composer-card',
          'relative flex flex-col gap-2.5 p-3 min-w-[360px] max-w-[880px] w-max',
          // 高度下限只由 style.minHeight 一处给（COMPOSER_MIN_USABLE_HEIGHT）：
          // 旧的 min-h-[150px] 与下面的 Math.min(150, maxHeight) 是两套魔数、且后者允许塌到不可用，已删（P1）。
          // 宽度内容驱动（w-max）：按底栏一行(锁+参数+生成钮)的真实宽长开，参数少则窄、多则宽，不塌不爆、不换行。
          // max-w-[880px] 兜底：现有最宽是 apimart Seedance 7 控件(model+变体+比例+清晰度+时长+seed+生成音频)
          // ≈810px，880 留头不触发截断；纯防极端（防 omni 模式参考槽行等异常撑爆）。实测 2026-06-16 校准。
          // 卡片本身 overflow-hidden（非 overflow-y-auto）：底栏靠 shrink-0 mt-auto 恒贴卡底可见、
          // 提示词只在内层 flex-1 滚动壳里滚（见下）。cutover 曾把这里改成 overflow-y-auto 想让「视口窄时
          // body 滚、底栏可达」，但那会解除对内层 flex 列「必须塞进卡片固定高」的压力 → flex-1 min-h-0 滚动壳
          // 塌成 0、72px 编辑器溢出到底栏上方与「生成参数」重叠、提示词区一个点都点不到（2026-09-01 smoke
          // click 恒被拦、本机 elementFromPoint 复现命中「生成参数」）。origin/main 的 overflow-hidden 本就
          // 让底栏恒可见 + 提示词内层滚，无此病，故恢复。
          'border border-nomi-line rounded-nomi bg-nomi-paper overflow-hidden shadow-nomi-md',
          'transition-[outline-color] duration-150',
          isDragOver && 'outline-2 outline-dashed outline-nomi-accent outline-offset-[-2px]',
        )}
        style={{
          maxHeight,
          minHeight: minUsableHeight,
          cursor: 'default',
          userSelect: 'auto',
          touchAction: 'auto',
        }}
      >
      {hasReferenceControls || hasPromptPickerButton ? (
        <div className={cn('flex w-0 min-w-full items-start gap-3')}>
          {hasReferenceControls ? (
            <div className={cn('min-w-0 flex-1')}>
              <NodeParameterControls node={node} section="references" onInsertMention={insertMention} />
            </div>
          ) : null}
          {hasPromptPickerButton ? (
            <button
              ref={promptPickerButtonRef}
              type="button"
              className={cn(
                'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-nomi-sm border-0 bg-transparent px-2',
                'cursor-pointer text-nomi-ink-40 transition-[background,color,transform] duration-[var(--nomi-transition-fast)]',
                'hover:-translate-y-0.5 hover:bg-nomi-ink-05 hover:text-nomi-accent',
                promptPickerOpen && 'bg-nomi-ink-05 text-nomi-accent',
                node.locked && 'cursor-not-allowed opacity-45 hover:translate-y-0 hover:bg-transparent hover:text-nomi-ink-40',
              )}
              aria-label={t('generationCommon.composer.openPromptLibrary')}
              aria-haspopup="menu"
              aria-expanded={promptPickerOpen}
              title={t('generationCommon.composer.promptLibrary')}
              disabled={node.locked}
              onClick={togglePromptPicker}
            >
              <IconFileText size={15} stroke={1.8} aria-hidden="true" />
              <span className="text-caption font-medium leading-none">{t('generationCommon.composer.prompt')}</span>
            </button>
          ) : null}
        </div>
      ) : null}
      <AnimatePresence initial={false}>
        {hasPromptPickerButton && promptPickerOpen ? (
          <BrowserPromptPickerPopover
            key="browser-prompt-picker"
            items={promptPickerItems}
            position={promptPickerPosition}
            onSelect={applyPromptPickerItem}
            setNodeRef={(popoverNode) => {
              promptPickerPopoverRef.current = popoverNode
            }}
          />
        ) : null}
      </AnimatePresence>
      {/* 参考区：图像/视频的参考槽，以及声音的「配音生成/转写」模式切换 + 转写的音频参考槽。 */}
      {hasReferenceControls ? (
        // 样张 v4 .divider：参考区与描述之间一条极淡分隔线
        <div className={cn('h-px bg-nomi-line-soft')} />
      ) : null}
      {isTextKind ? (
        <div
          className={cn('flex items-center gap-1')}
          role="group"
          aria-label={t('generationCommon.composer.generationMode')}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {TEXT_GEN_MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={textGenMode === option.value}
              data-active={textGenMode === option.value ? 'true' : 'false'}
              title={t(`generationCommon.${option.labelKey}`)}
              onClick={(event) => {
                event.stopPropagation()
                updateNode(node.id, { meta: { ...(node.meta || {}), textGenMode: option.value } })
              }}
              className={cn(
                'min-h-7 rounded-nomi-sm px-2.5 py-1 text-caption font-medium leading-none',
                'text-nomi-ink-60 hover:bg-nomi-ink-05',
                'data-[active=true]:bg-nomi-paper data-[active=true]:text-nomi-ink data-[active=true]:shadow-nomi-sm',
              )}
            >
              {t(`generationCommon.${option.labelKey}`)}
            </button>
          ))}
        </div>
      ) : null}
      {/* 长 prompt 在编辑器内部滚动/换行；底栏永远贴底（卡宽确定，提示词在卡宽内自然换行，不撑爆）。 */}
      {/* 空间充足时 PromptEditor 保持 3 行；视口收紧时外层允许缩到 0 并内部滚动，底栏始终可见。 */}
      {/* 转写模式无台词输入（音频参考即输入）——隐藏 prompt，避免误导。 */}
      {audioIsTranscribe || isTextKind || !acceptsPrompt ? null : (
        // w-0 min-w-full：填满卡宽但**贡献 0** 到 max-content（长 prompt 在卡宽内换行，不把卡撑爆 → 卡宽由底栏定）。
        // overflow-y-auto 直接挂在 flex-1 伸缩区上：该区高度被卡片 maxHeight 卡住后有界 → 超长 prompt 在本区内部
        // 滚动，底栏（shrink-0）永远贴底可见。外层必须 min-h-0，才能在视口高度不足时让出空间；
        // 内层 PromptEditor 的 min-h-[72px] 仍提供正常状态的 3 行高度，并成为本区的滚动内容。
        // ⚠️ 别再往里套「无高度约束的内层块 + overflow-y-auto」：那样内层块按内容长到全高、滚动永不触发，
        // 整片 prompt 下溢盖住底栏（= 截图里「文字太长盖住 选择模型/优化」的根因）。滚动容器必须自己有界。
        // 用 overflow-y-auto 而非 overflow-auto：卡宽已被 w-0 min-w-full 锁死、prompt 在卡宽内换行，横向永不溢出，明确关掉横向滚动条。
        <div
          className={cn('relative flex-1 min-h-0 w-0 min-w-full overflow-y-auto overscroll-contain')}
          style={{ cursor: node.locked ? 'default' : 'text', userSelect: node.locked ? 'auto' : 'text' }}
        >
          <PromptEditor
            className={cn('min-h-[72px]')}
            value={node.prompt || ''}
            placeholder={appendMentionHint(isTextKind ? t(`generationCommon.${TEXT_MODE_PLACEHOLDER_KEY[textGenMode]}`) : getGenerationNodePromptPlaceholder(node.kind))}
            editable={!node.locked}
            onChange={(next) => updateNode(node.id, { prompt: next })}
            onBlur={() => { void persistActiveWorkbenchProjectNow().catch(() => {}) }}
            onReady={setPromptEditor}
            mentionCandidates={mentionCandidates}
            mentionReferences={orderedMediaReferences}
            mentionSearch={mentionSearch}
            onMentionSelect={onMentionSelect}
          />
        </div>
      )}
      {/* 底栏铺满卡宽（w-full）：生成钮 ml-auto 永远贴右。底栏恒单行——参数已主次分层（最常调的内联、
          其余收进 InlineParameterBar 的「更多」弹层，方案 B），不会再横排超长/截断/换行（D2 根治）。 */}
      <div className={cn('flex items-center gap-2 mt-auto pt-1 shrink-0 w-full')}>
        {/* 锁从节点卡片移到这里（编辑面板底栏）：卡片预览保持干净，锁定/解锁在选中编辑时就近可达。
            selected 恒为真（composer 只在选中时挂载）→ 始终可见：未锁=描边开锁、已锁=实心锁。 */}
        <NodeLockBadge nodeId={node.id} locked={node.locked} selected />
        <NodeParameterControls
          node={node}
          section="parameters"
          composerAttachmentSide={flipUp ? 'top' : 'bottom'}
        />
        {/* 手动运镜（B1）：视频镜头才有 video_ref 槽——运镜芯片仅对 video-like 节点显示（AI 工具 create_camera_move 的第二道门，共用同一产路）。 */}
        {isVideoLikeGenerationNodeKind(node.kind) && !node.locked ? (
          <NodeCameraMoveControl node={node} />
        ) : null}
        {acceptsPrompt && (nodeExecutionKind === 'image' || nodeExecutionKind === 'video') && !node.locked ? (
          <NodePromptOptimizer node={node} isVideo={nodeExecutionKind === 'video'} />
        ) : null}
        {(nodeExecutionKind === 'image' || nodeExecutionKind === 'video') && !node.locked ? (
          <NomiSelect
            ariaLabel={t('generationCommon.composer.variantCountAria')}
            title={t('generationCommon.composer.variantCountTitle', { count: variantCount })}
            value={String(variantCount)}
            disabled={isGenerating}
            options={GENERATION_VARIANT_COUNTS.map((count) => ({
              value: String(count),
              label: t('generationCommon.composer.variantCountOption', { count }),
            }))}
            onChange={(value) => setVariantCount(parseGenerationVariantCount(value))}
          />
        ) : null}
        {(() => {
          const disabledReason = unmetDependency
            ? t('generationCommon.composer.referenceCompanionRequired', {
                slot: unmetDependency.slotLabel,
                companions: unmetDependency.companionLabels.join(t('generationCommon.composer.companionOr')),
              })
            : !canGenerateNow && !isGenerating
            ? nodeExecutionKind === 'video'
              ? acceptsDrop
                ? t('generationCommon.composer.videoReferenceRequired')
                : t('generationCommon.composer.videoFirstFrameRequired')
              : nodeExecutionKind === 'image'
                ? acceptsDrop
                  ? t('generationCommon.composer.imageReferenceRequired')
                  : t('generationCommon.composer.imageConnectionRequired')
                : nodeExecutionKind === 'model3d'
                  // 图生3D缺参考时的诚实原因——此前落到 unsupportedKind「暂不支持」，明明支持只是缺图（同族 kind 边界漏 3D）。
                  ? t('generationCommon.composer.model3dReferenceRequired')
                  : t('generationCommon.composer.unsupportedKind', { kind: node.kind })
            : undefined
          const title = disabledReason
            ?? (isGenerating
              ? t('generationCommon.composer.generating')
              : hasPendingRefs
                ? t('generationCommon.composer.generateReferencesFirst')
                : hasResult
                  ? t('generationCommon.composer.regenerate')
                  : t('generationCommon.composer.generate'))
          return (
            <span title={title} style={{ display: 'contents' }}>
              {/* 原生 button：避开 WorkbenchButton(Mantine)对 radius/bg 的覆盖,确保样张 v4 的深色圆形主行动钮。
                  ml-auto：把生成钮推到底栏最右 = 卡片右下角（卡宽恒定 → 屏幕位置锁死）。 */}
              <button
                type="button"
                className={cn(GENERATE_BUTTON_CLASS, 'ml-auto')}
                aria-label={hasResult ? t('generationCommon.composer.regenerate') : t('generationCommon.composer.generateAsset')}
                disabled={!canGenerateNow}
                onClick={handleGenerate}
              >
                {isGenerating ? '···' : '↑'}
              </button>
            </span>
          )
        })()}
      </div>
      </div>
      {isDragOver ? (
        <div
          className={cn(
            'generation-canvas-v2-node__composer-dropzone',
            'absolute inset-0 z-[10] flex items-center justify-center rounded-nomi',
            'bg-nomi-paper/[0.7] pointer-events-none',
          )}
          aria-hidden="true"
        >
          {/* pending 规范 #1:上传中统一品牌转圈,不再纯文字 */}
          <span className={cn('inline-flex items-center gap-1.5 text-caption text-nomi-ink-60')}>
            {isUploading ? <NomiLoadingMark size={14} label={t('generationCommon.composer.uploading')} /> : null}
            {isUploading ? t('generationCommon.composer.uploadingEllipsis') : t('generationCommon.composer.dropToAddReference')}
          </span>
        </div>
      ) : null}
    </div>
  )
}
