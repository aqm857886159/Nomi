import React from 'react'
import type { Editor } from '@tiptap/react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { IconFileText } from '../../../vendor/tablerIcons'
import { NomiLoadingMark } from '../../../design'
import { cn } from '../../../utils/cn'
import { getDesktopActiveProjectId } from '../../../desktop/activeProject'
import {
  readBrowserPromptLibraryItems,
  type BrowserPromptLibraryItem,
} from '../../../ui/browser/assets/browserAssetLibraryStorage'
import PromptEditor from '../../assets/PromptEditor'
import { promptToContent } from '../../assets/promptEditorContent'
import { resolveReferenceSlots } from '../runner/referenceSlots'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { canRunGenerationNode, confirmAndRunNode, regenerateNodeInPlace } from '../runner/generationRunController'
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
  isVideoLikeGenerationNodeKind,
} from '../model/generationNodeKinds'
import { resolveArchetypeForModel } from '../../../config/modelArchetypes'
import { currentArchetypeMode } from './controls/archetypeMeta'
import { getTextGenMode, type TextGenMode } from '../runner/textActions'

// C5 P2：文本节点的三种生成模式。
const TEXT_GEN_MODES: { value: TextGenMode; label: string }[] = [
  { value: 'append', label: '续写' },
  { value: 'rewrite', label: '改写' },
  { value: 'replace', label: '重写' },
]
const TEXT_MODE_PLACEHOLDER: Record<TextGenMode, string> = {
  append: '续写要求…（留空＝直接接着往下写）',
  rewrite: '改写要求…（先在正文里选中要改的文字）',
  replace: '重写要求…（替换整篇）',
}

// 翻转滞回带（屏幕 px）：已翻上后要等下方明显够放才切回朝下，杜绝边界反复横跳（用户反馈①）。
const FLIP_HYSTERESIS = 48
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

function floatingComposerLayout(width: number, _height: number, kind: GenerationCanvasNode['kind']): FloatingComposerLayout {
  // 宽度不再在这里算——它**内容驱动**（CSS `w-fit` + `min-w/max-w` 边界，见卡 className），
  // 跟着该模型实际的参数横排自然撑开，参数少则窄、多则宽、触上限在卡内换行（绝不绑节点比例、不钉死常数）。
  //
  // 高度同理**内容驱动**，不再绑节点高（旧 `height*0.72` 是 bug 根因：小节点 → 矮卡，
  // 「参考区 + 3 行提示词 + 底栏」放不下，overflow-hidden 把底栏的生成钮裁到卡外，修③④）。
  // 卡片在 flex-col 里自然按内容长高；只有一个可伸缩区（提示词 flex-1 overflow-auto），
  // 底栏 shrink-0 永远贴底可见。这里给一个宽松上限：内容超过它时只有提示词内部滚动，底栏不动。
  const maxHeight = kind === 'video' ? 460 : 400
  const gap = width >= 420 ? 14 : 10
  return { maxHeight, gap }
}

type BrowserPromptPickerPopoverProps = {
  items: BrowserPromptLibraryItem[]
  position: PromptPickerPosition | null
  onSelect: (item: BrowserPromptLibraryItem) => void
  setNodeRef: (node: HTMLDivElement | null) => void
}

function BrowserPromptPickerPopover({
  items,
  position,
  onSelect,
  setNodeRef,
}: BrowserPromptPickerPopoverProps): React.ReactPortal | null {
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
      aria-label="素材盒提示词"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseLeave={() => setHoveredPromptId(null)}
    >
      <div className="max-h-[310px] overflow-hidden rounded-nomi bg-nomi-paper shadow-nomi-lg">
        <div className="min-w-0 overflow-y-auto py-1">
          {items.length === 0 ? (
            <div className="grid min-h-24 place-items-center px-4 text-center text-caption text-nomi-ink-40">
              素材盒暂无可用提示词
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
                  'text-nomi-ink-70 hover:bg-nomi-ink-05 hover:text-nomi-ink',
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
                  <span className="grid size-8 place-items-center rounded-nomi-sm bg-nomi-bg text-nomi-ink-35">
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
              <div className="overflow-hidden rounded-nomi-sm bg-nomi-bg/70 px-2 py-1.5 text-caption leading-snug text-nomi-ink-70 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:6] [overflow-wrap:anywhere]">
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
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const status = node.status || 'idle'
  const isGenerating = status === 'queued' || status === 'running'
  const hasResult = Boolean(node.result?.url)
  const nodeExecutionKind = getGenerationNodeExecutionKind(node.kind)
  // v0.7.2 perf: 用 boolean primitive 订阅 canGenerate
  const canGenerate = useGenerationCanvasStore((state) =>
    canRunGenerationNode(node, { nodes: state.nodes, edges: state.edges }),
  ) && !isGenerating
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
      meta,
    })
    return archetype ? currentArchetypeMode(archetype, meta) : null
  }, [isAudioKind, node.meta])
  const audioIsTranscribe = audioMode?.transportTaskKind === 'transcribe'
  const textGenMode = getTextGenMode(node)
  const hasPromptPickerButton = Boolean(nodeExecutionKind) && !audioIsTranscribe && !isTextKind
  // 持有 prompt 编辑器实例,供「点参考 tile → 在光标处插入 chip」(@ 内联引用主路径)。
  const [promptEditor, setPromptEditor] = React.useState<Editor | null>(null)
  const [promptPickerOpen, setPromptPickerOpen] = React.useState(false)
  const [promptPickerItems, setPromptPickerItems] = React.useState<BrowserPromptLibraryItem[]>([])
  const [promptPickerPosition, setPromptPickerPosition] = React.useState<PromptPickerPosition | null>(null)
  const promptPickerButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const promptPickerPopoverRef = React.useRef<HTMLDivElement | null>(null)
  const insertMention = React.useCallback((url: string) => {
    if (promptEditor && !promptEditor.isDestroyed) promptEditor.commands.insertAssetMention(url)
  }, [promptEditor])
  // 拖文件到卡 → 加为参考（捷径 A）。仅当当前模式有数组参考槽时接管拖拽。
  const { acceptsDrop, isDragOver, isUploading, dropHandlers } = useNodeAssetDrop(node)
  // @ 候选 = 当前模式 image_ref 槽的有序填充（连线在前+上传，option 2 单源），与面板编号①②③、
  // 发送的 reference_image 数组同一口径——连线进来的参考图也在候选里、能被 @（此前只读 meta 漏掉边）。
  const mentionNodes = useGenerationCanvasStore((state) => state.nodes)
  const mentionEdges = useGenerationCanvasStore((state) => state.edges)
  const mentionCandidates = React.useMemo(() => {
    const imageSlot = resolveReferenceSlots(node, mentionNodes, mentionEdges).find((s) => s.slotKind === 'image_ref')
    return imageSlot ? imageSlot.fills.flatMap((f) => (f.url ? [f.url] : [])) : []
  }, [node, mentionNodes, mentionEdges])

  const loadPromptPickerItems = React.useCallback((): BrowserPromptLibraryItem[] => {
    const items = readBrowserPromptLibraryItems(getDesktopActiveProjectId())
    setPromptPickerItems(items)
    return items
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
    (item: BrowserPromptLibraryItem): void => {
      if (node.locked) return
      if (promptEditor && !promptEditor.isDestroyed) {
        promptEditor.commands.setContent(promptToContent(item.prompt))
        promptEditor.commands.focus('end')
      }
      updateNode(node.id, { prompt: item.prompt })
      setPromptPickerOpen(false)
      void persistActiveWorkbenchProjectNow().catch(() => {})
    },
    [node.id, node.locked, promptEditor, updateNode],
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
    // 已有结果的「重新生成」原地回填：新图进当前节点堆叠并设为主图，不再复制新节点。
    if (hasResult) await regenerateNodeInPlace(node.id)
    else await confirmAndRunNode(node.id)
  }

  // 遮挡防线（audit 2026-06-12 bug C）：composer 默认朝下展开时，靠近画布底部的节点
  // 会把参数行/生成钮伸进时间轴的屏幕区域，被盖住点不到（elementFromPoint 实证）。
  // 屏幕坐标下实测节点上下可用空间，决定是否翻转朝上。
  // 订阅 zoom/offset/node.position：平移、缩放、拖节点都会重算。
  // 用户反馈①：默认稳定朝下，仅「下方真放不下且上方更宽裕」才翻上；已翻上后要等下方
  // 明显够放（+滞回带 FLIP_HYSTERESIS）才切回 → 杜绝节点贴边界时反复横跳。
  // 面板已反向缩放成恒定屏幕尺寸（见 anchor transform），故所需高度≈ offsetHeight（不再 ×zoom）。
  const canvasZoom = useGenerationCanvasStore((state) => state.canvasZoom)
  const canvasOffset = useGenerationCanvasStore((state) => state.canvasOffset)
  const anchorRef = React.useRef<HTMLDivElement>(null)
  const [flipUp, setFlipUp] = React.useState(false)
  // 翻上时要避让的「节点上方图片编辑工具条」高度（节点坐标系 px）。否则参数框会压住那条
  // 浮动工具条（用户反馈：浮动条看不见/遮挡）。无工具条（如未生成、视频节点）则为 0。
  const [aboveClearance, setAboveClearance] = React.useState(0)
  // 横向视口夹取（屏幕 px）：内容驱动的卡变宽后，靠画布左右边的节点会让卡溢出视口被裁（用户反馈
  // 2026-06-16「参数遮挡/很丑」）。算出卡左右沿对 stage 视口的越界量，整体平移把它拉回视口内
  // （卡比视口还宽时左对齐——参数从左起，优先露出左侧）。与竖向 flip 同源：都按屏幕几何避让。
  const [shiftX, setShiftX] = React.useState(0)
  React.useLayoutEffect(() => {
    const anchor = anchorRef.current
    const stage = anchor?.closest('.generation-canvas-v2__stage')
    const nodeEl = anchor?.parentElement
    if (!anchor || !stage || !nodeEl) return
    const recompute = () => {
      const stageRect = stage.getBoundingClientRect()
      const nodeRect = nodeEl.getBoundingClientRect()
      const neededScreenHeight = (anchor.offsetHeight || 280) + composerLayout.gap * canvasZoom
      const spaceBelow = stageRect.bottom - nodeRect.bottom
      const spaceAbove = nodeRect.top - stageRect.top
      setFlipUp((prev) =>
        prev
          ? !(spaceBelow > neededScreenHeight + FLIP_HYSTERESIS)
          : spaceBelow < neededScreenHeight && spaceAbove > spaceBelow,
      )
      // 工具条也恒定屏幕尺寸（counter-scaled）→ 实测其屏幕高换回节点坐标（/zoom）+ 它距节点的 18px。
      const toolbarEl = nodeEl.querySelector('.generation-canvas-v2-node__panorama-toolbar')
      const toolbarScreenH = toolbarEl ? toolbarEl.getBoundingClientRect().height : 0
      setAboveClearance(toolbarScreenH > 0 ? toolbarScreenH / (canvasZoom || 1) + 18 : 0)
      // 横向夹取：卡净 scale=1（画布 scale(zoom)×卡 counter-scale(1/zoom)）→ 屏幕宽 = offsetWidth。
      // 默认锚在节点中心（left-1/2 + translateX(-50%)）。算越界，整体平移回视口内。
      const MARGIN = 12
      const cardScreenW = anchor.offsetWidth
      const centerX = nodeRect.left + nodeRect.width / 2
      const wouldLeft = centerX - cardScreenW / 2
      const wouldRight = centerX + cardScreenW / 2
      const minLeft = stageRect.left + MARGIN
      const maxRight = stageRect.right - MARGIN
      let next = 0
      if (wouldRight > maxRight) next = maxRight - wouldRight // 右溢出 → 左移（负）
      if (wouldLeft + next < minLeft) next = minLeft - wouldLeft // 左溢出（或比视口宽）→ 左对齐
      setShiftX(Math.round(next))
    }
    recompute()
    // 卡宽随模型/参数变（model 切换不在下方 deps 里）→ ResizeObserver 兜住宽度变化重算横向夹取。
    const ro = new ResizeObserver(recompute)
    ro.observe(anchor)
    return () => ro.disconnect()
  }, [canvasZoom, canvasOffset, node.position?.x, node.position?.y, visualSize.width, visualSize.height, composerLayout.gap, node.result?.url])

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
      className={cn('generation-canvas-v2-node__composer', 'absolute left-1/2 z-[8] w-max')}
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
      }}
      onPointerDown={(event) => event.stopPropagation()}
      {...(acceptsDrop ? dropHandlers : {})}
    >
      <div
        className={cn(
          'generation-canvas-v2-node__composer-card',
          'relative flex flex-col gap-2.5 p-3 min-h-[150px] min-w-[360px] max-w-[880px] w-max',
          // 宽度内容驱动（w-max）：按底栏一行(锁+参数+生成钮)的真实宽长开，参数少则窄、多则宽，不塌不爆、不换行。
          // max-w-[880px] 兜底：现有最宽是 apimart Seedance 7 控件(model+变体+比例+清晰度+时长+seed+生成音频)
          // ≈810px，880 留头不触发截断；纯防极端（防 omni 模式参考槽行等异常撑爆）。实测 2026-06-16 校准。
          'border border-nomi-line rounded-nomi bg-nomi-paper overflow-hidden shadow-nomi-md',
          'transition-[outline-color] duration-150',
          isDragOver && 'outline-2 outline-dashed outline-nomi-accent outline-offset-[-2px]',
        )}
        style={{ maxHeight: composerLayout.maxHeight }}
      >
      {hasPromptPickerButton ? (
        <>
          <button
            ref={promptPickerButtonRef}
            type="button"
            className={cn(
              'absolute right-3 top-3 z-[2] inline-flex h-7 items-center gap-1.5 rounded-nomi-sm border-0 bg-transparent px-2',
              'cursor-pointer text-nomi-ink-45 transition-[background,color,transform] duration-[var(--nomi-transition-fast)]',
              'hover:-translate-y-0.5 hover:bg-nomi-ink-05 hover:text-nomi-accent',
              promptPickerOpen && 'bg-nomi-ink-05 text-nomi-accent',
              node.locked && 'cursor-not-allowed opacity-45 hover:translate-y-0 hover:bg-transparent hover:text-nomi-ink-45',
            )}
            aria-label="打开素材盒提示词"
            aria-haspopup="menu"
            aria-expanded={promptPickerOpen}
            title="素材盒提示词"
            disabled={node.locked}
            onClick={togglePromptPicker}
          >
            <IconFileText size={15} stroke={1.8} aria-hidden="true" />
            <span className="text-caption font-medium leading-none">提示词</span>
          </button>
          <AnimatePresence initial={false}>
            {promptPickerOpen ? (
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
        </>
      ) : null}
      {/* 参考区：图像/视频的参考槽，以及声音的「配音生成/转写」模式切换 + 转写的音频参考槽。 */}
      {isImageLikeGenerationNodeKind(node.kind) || isVideoLikeGenerationNodeKind(node.kind) || isAudioKind ? (
        <>
          <NodeParameterControls node={node} section="references" onInsertMention={insertMention} />
          {/* 样张 v4 .divider：参考区与描述之间一条极淡分隔线 */}
          <div className={cn('h-px bg-nomi-line-soft')} />
        </>
      ) : null}
      {isTextKind ? (
        <div className={cn('flex items-center gap-1')} role="group" aria-label="生成模式">
          {TEXT_GEN_MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              data-active={textGenMode === option.value ? 'true' : 'false'}
              onClick={(event) => {
                event.stopPropagation()
                updateNode(node.id, { meta: { ...(node.meta || {}), textGenMode: option.value } })
              }}
              className={cn(
                'h-[22px] rounded-full px-2.5 text-micro font-medium',
                'text-nomi-ink-60 hover:bg-nomi-ink-05',
                'data-[active=true]:bg-nomi-accent-soft data-[active=true]:text-nomi-accent',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {/* 长 prompt 在编辑器内部滚动/换行；底栏永远贴底（卡宽确定，提示词在卡宽内自然换行，不撑爆）。 */}
      {/* 提示词至少 3 行高（min-h-[72px]）——参考区/底栏再多也不把它挤成 1 行（修③）；超长时本区滚动。 */}
      {/* 转写模式无台词输入（音频参考即输入）——隐藏 prompt，避免误导。 */}
      {audioIsTranscribe || isTextKind ? null : (
        // w-0 min-w-full：填满卡宽但**贡献 0** 到 max-content（长 prompt 在卡宽内换行，不把卡撑爆 → 卡宽由底栏定）。
        <div className={cn('relative flex-1 min-h-[72px] w-0 min-w-full')}>
          <div className="min-h-[72px] overflow-auto">
            <PromptEditor
              className={cn('min-h-[72px]')}
              value={node.prompt || ''}
              placeholder={isTextKind ? TEXT_MODE_PLACEHOLDER[textGenMode] : getGenerationNodePromptPlaceholder(node.kind)}
              editable={!node.locked}
              onChange={(next) => updateNode(node.id, { prompt: next })}
              onBlur={() => { void persistActiveWorkbenchProjectNow().catch(() => {}) }}
              onReady={setPromptEditor}
              mentionCandidates={mentionCandidates}
            />
          </div>
        </div>
      )}
      {/* 底栏铺满卡宽（w-full）：生成钮 ml-auto 永远贴右。底栏恒单行——参数已主次分层（最常调的内联、
          其余收进 InlineParameterBar 的「更多」弹层，方案 B），不会再横排超长/截断/换行（D2 根治）。 */}
      <div className={cn('flex items-center gap-2 mt-auto pt-1 shrink-0 w-full')}>
        {/* 锁从节点卡片移到这里（编辑面板底栏）：卡片预览保持干净，锁定/解锁在选中编辑时就近可达。
            selected 恒为真（composer 只在选中时挂载）→ 始终可见：未锁=描边开锁、已锁=实心锁。 */}
        <NodeLockBadge nodeId={node.id} locked={node.locked} selected />
        <NodeParameterControls node={node} section="parameters" />
        {/* 手动运镜（B1）：视频镜头才有 video_ref 槽——运镜芯片仅对 video-like 节点显示（AI 工具 create_camera_move 的第二道门，共用同一产路）。 */}
        {isVideoLikeGenerationNodeKind(node.kind) && !node.locked ? (
          <NodeCameraMoveControl node={node} />
        ) : null}
        {(nodeExecutionKind === 'image' || nodeExecutionKind === 'video') && !node.locked ? (
          <NodePromptOptimizer node={node} isVideo={nodeExecutionKind === 'video'} />
        ) : null}
        {(() => {
          const disabledReason = !canGenerateNow && !isGenerating
            ? nodeExecutionKind === 'video'
              ? acceptsDrop
                ? '需要先添加参考素材（拖入 / 连线 / 点 +）'
                : '需要先连接一个图片节点作为首帧'
              : nodeExecutionKind === 'image'
                ? acceptsDrop
                  ? '图生图需要参考图（拖入 / 连线 / 点 +），或切回「文生图」'
                  : '图生图需要参考图：请连接图片节点或添加参考，或切回「文生图」'
                : `「${node.kind}」类型暂不支持直接生成`
            : undefined
          const title = disabledReason
            ?? (isGenerating ? '生成中…' : hasPendingRefs ? '先生成参考，再生成本镜' : hasResult ? '重新生成' : '生成')
          return (
            <span title={title} style={{ display: 'contents' }}>
              {/* 原生 button：避开 WorkbenchButton(Mantine)对 radius/bg 的覆盖,确保样张 v4 的深色圆形主行动钮。
                  ml-auto：把生成钮推到底栏最右 = 卡片右下角（卡宽恒定 → 屏幕位置锁死）。 */}
              <button
                type="button"
                className={cn(GENERATE_BUTTON_CLASS, 'ml-auto')}
                aria-label={hasResult ? '重新生成' : '生成素材'}
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
            {isUploading ? <NomiLoadingMark size={14} label="上传中" /> : null}
            {isUploading ? '上传中…' : '松手添加为参考'}
          </span>
        </div>
      ) : null}
    </div>
  )
}
