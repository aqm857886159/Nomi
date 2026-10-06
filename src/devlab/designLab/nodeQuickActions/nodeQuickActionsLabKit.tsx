// 设计实验室 · 屏「画布 · 节点快捷动作（批次 1 样张）」的取景台与夹具。
//
// 每一格渲染的都是 `src/` 里的**生产组件本体**：快捷动作浮条（`quickActions/ImageQuickActionsToolbar`）、
// 浮条下拉（`nodes/ToolbarActionMenu` → `WorkbenchMenu`）、宫格点阵（`nodes/GridSplitPicker` → `AnchoredPopover`）、
// 「用这个节点生成…」（`quickActions/NodeDeriveMenu`）、节点右键菜单（`components/NodeContextMenu`），
// 派生后（新节点空闲）这一格用的是现役 `BaseGenerationNode`。菜单里没有价格（用户 10-05 拍板：官方额度上线后再做）。
//
// 唯一的占位是浮条那几格的**节点卡本身**（同 `videoDepth/videoDepthLabKit.tsx` 的理由：真卡会把
// 现役浮条一起渲出来，没法把新浮条挂上去）。卡的外壳类名与现役卡逐字相同。
//
// 打开下拉 / 悬停点阵都走**真实的点击与指针事件**（挂载后按一下触发钮），不给组件加「默认打开」的开关——
// 那会是只有实验室用的第二条打开路径，而且证明不了真实那条打得开。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconPlus } from '@tabler/icons-react'
import '../../../workbench/generationCanvas/styles/generationCanvas.css'
import BaseGenerationNode from '../../../workbench/generationCanvas/nodes/BaseGenerationNode'
import NodeContextMenu from '../../../workbench/generationCanvas/components/NodeContextMenu'
import ImageQuickActionsToolbar from '../../../workbench/generationCanvas/quickActions/ImageQuickActionsToolbar'
import { NodeDeriveMenu } from '../../../workbench/generationCanvas/quickActions/NodeDeriveMenu'
import { connectionCreateVerdictsForSource } from '../../../workbench/generationCanvas/agent/referenceEdgeCapability'
import { NODE_DERIVE_KINDS } from '../../../workbench/generationCanvas/quickActions/nodeDeriveMenuModel'
import { QUICK_ACTION_META_KEY } from '../../../workbench/generationCanvas/quickActions/deriveFromNode'
import type { GenerationCanvasNode } from '../../../workbench/generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import { holdDesignLabReady } from '../labReadyHold'
import { COMPOSER_CHUNK, installCatalogBridge } from '../nodeComposerBar/nodeComposerBarLabKit'
import { cn } from '../../../utils/cn'

export const QUICK_ACTIONS_CELL_WIDTH = 900
export const QUICK_ACTIONS_CELL_HEIGHT = 740

/** 340 = 图片节点注册默认宽；高按 16:9。浮条的宽要和真卡比，卡画小了浮条看着就「撑破」了。 */
const CARD = { width: 340, height: 191 } as const
/** 卡的位置：上方要留出「浮条 + 向上展开的菜单」的高度，菜单才不被取景框裁掉。 */
const CARD_TOP = 520
/** 右键 / 「+」菜单那几格：菜单往下开，卡放高一点。 */
const MENU_CARD_TOP = 140
/** 贴上沿：卡的上沿离舞台上沿 56px——头顶放不下浮条（被夹回舞台里），更放不下向上开的菜单。 */
const EDGE_CARD_TOP = 56
const SOURCE_TITLE = '雨夜街口 · 定场'

const svg = (body: string): string =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">${body}</svg>`)

/** 源图：雨夜街口（暖灯、积水、撑伞的人）。data URI：实验室不依赖机器上有什么素材。 */
export const STREET_FRAME = svg(`
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d2a44"/><stop offset="1" stop-color="#4a3a52"/></linearGradient></defs>
  <rect width="640" height="360" fill="url(#sky)"/>
  <rect x="40" y="80" width="120" height="200" fill="#2a2f3f"/><rect x="480" y="60" width="140" height="220" fill="#262b3a"/>
  <rect x="60" y="110" width="26" height="34" fill="#e8b45c"/><rect x="110" y="150" width="26" height="34" fill="#c98a4a"/>
  <rect x="505" y="100" width="30" height="36" fill="#d9a35a"/><rect x="560" y="160" width="30" height="36" fill="#7fb0c9"/>
  <rect y="280" width="640" height="80" fill="#1a1d27"/><ellipse cx="320" cy="312" rx="220" ry="18" fill="#3b4b6b" opacity=".6"/>
  <path d="M296 196 q24 -40 48 0 z" fill="#b8423a"/><rect x="318" y="196" width="4" height="40" fill="#222"/>
  <ellipse cx="320" cy="222" rx="11" ry="13" fill="#e2c39b"/><path d="M306 240 q14 -8 28 0 l5 42 h-38 z" fill="#2f3a52"/>`)

/** 宫格类预设派生出来的图：3×3 机位联系表（每格同一个人，换机位）。 */
export const GRID_FRAME = svg(Array.from({ length: 9 }, (_, i) => {
  const x = (i % 3) * 213 + 2
  const y = Math.floor(i / 3) * 120 + 2
  const shift = (i % 3) * 18 - 18
  return `<rect x="${x}" y="${y}" width="209" height="116" fill="${i % 2 ? '#2a2f44' : '#323850'}"/>
    <rect x="${x}" y="${y + 92}" width="209" height="24" fill="#1a1d27"/>
    <ellipse cx="${x + 104 + shift}" cy="${y + 52}" rx="10" ry="12" fill="#e2c39b"/>
    <path d="M${x + 92 + shift} ${y + 70} q12 -7 24 0 l4 26 h-32 z" fill="#2f3a52"/>`
}).join(''))

function sourceNode(over: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode {
  return {
    id: 'qa-source',
    kind: 'image',
    title: SOURCE_TITLE,
    categoryId: 'shots',
    position: { x: 0, y: 0 },
    size: { ...CARD },
    status: 'success',
    meta: { modelKey: 'gpt-image-2', modelVendor: 'apimart', imageWidth: 1280, imageHeight: 720 },
    result: { id: 'qa-source-r', type: 'image', url: STREET_FRAME, createdAt: 1 },
    ...over,
  } as GenerationCanvasNode
}

// ── 舞台 ─────────────────────────────────────────────────────────────────────

function useCanvasStores(nodes: readonly GenerationCanvasNode[], edges: { id: string; source: string; target: string }[] = []): boolean {
  const [ready, setReady] = React.useState(false)
  React.useLayoutEffect(() => {
    useWorkbenchStore.setState({ activeCategoryId: 'shots' })
    useGenerationCanvasStore.setState({ nodes: [...nodes], edges: edges.map((edge) => ({ ...edge, mode: 'reference' })) as never, selectedNodeIds: [] })
    setReady(true)
  }, [edges, nodes])
  return ready
}

function Stage({ width = QUICK_ACTIONS_CELL_WIDTH, height = QUICK_ACTIONS_CELL_HEIGHT, children }: { width?: number; height?: number; children: React.ReactNode }): JSX.Element {
  return (
    <div
      data-design-lab-stage="node-quick-actions"
      className="relative overflow-hidden rounded-nomi border border-nomi-line"
      style={{ width, height }}
    >
      {/* 真画布的舞台类：点阵底色 + 浮条「左右夹住、太窄就折行」的测量都认它。 */}
      <div className="generation-canvas-v2__stage group/canvas">{children}</div>
    </div>
  )
}

/** 节点卡（骨架，外壳类名与现役卡逐字相同）。浮条渲染在卡的定位祖先里——现役外壳是 `bottom: calc(100% + 40px)`。 */
function Card({ left, top = CARD_TOP, frame, title, toolbar, zoom = 1 }: { left: number; top?: number; frame: string; title: string; toolbar?: React.ReactNode; zoom?: number }): JSX.Element {
  // 缩放：真画布里卡片在 React Flow 的视口里被整体 scale(zoom)，浮条再反向 scale(1/zoom)，净缩放是 1。
  // 实验室没有视口，就把卡片自己按 zoom 缩（贴左上角缩），浮条的反向缩放才有东西可抵消。
  return (
    <div className="group/node absolute" style={{ left, top, width: CARD.width, height: CARD.height, ...(zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: 'top left' } : {}) }}>
      {toolbar}
      <div className={cn('generation-canvas-v2-node__preview', 'relative h-full w-full overflow-hidden rounded-nomi shadow-nomi-md ring-1 ring-inset ring-nomi-accent bg-nomi-ink-05')}>
        <img src={frame} alt="" className="h-full w-full object-cover" />
      </div>
      <span className="absolute left-[10px] top-[10px] z-[3] rounded-nomi-sm bg-nomi-paper/[0.82] px-2 py-[3px] text-micro font-medium text-nomi-ink-80 backdrop-blur-[8px]">
        {title}
      </span>
    </div>
  )
}

/** 挂载后按一下浮条上某颗下拉的触发钮（真实 click），可选再把指针移到点阵的某一格。下拉开出来才举就绪旗。 */
function useOpenOnMount(rootRef: React.RefObject<HTMLDivElement | null>, open?: 'more-effects' | 'refine' | 'grid', hoverCell?: string): void {
  React.useEffect(() => {
    if (!open) return undefined
    const release = holdDesignLabReady(`quick-actions:${open}`)
    let frame = 0
    let tries = 0
    const tick = (): void => {
      const trigger = rootRef.current?.querySelector<HTMLButtonElement>(`[data-toolbar-action-menu="${open}"]`)
      if (trigger && trigger.getAttribute('aria-expanded') !== 'true') trigger.click()
      const cell = hoverCell ? document.querySelector<HTMLElement>(`[data-grid-cell="${hoverCell}"]`) : null
      if (cell) cell.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      const opened = open === 'grid'
        ? Boolean(document.querySelector('[data-grid-split-picker]')) && (!hoverCell || Boolean(cell))
        : Boolean(document.querySelector(`[data-testid="toolbar-action-menu-${open}"]`))
      tries += 1
      if (opened && (!hoverCell || document.querySelector('[data-grid-split-size]')?.textContent)) {
        frame = requestAnimationFrame(() => release())
        return
      }
      if (tries > 120) { release(); return }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); release() }
  }, [hoverCell, open, rootRef])
}

export type ToolbarStageProps = {
  open?: 'more-effects' | 'refine' | 'grid'
  hoverCell?: string
  /** 这张卡是「多机位九宫格」派生出来的（浮条出「切成 9 张」）。 */
  derivedGrid?: boolean
  /** 窄画布（窗口小 / 右侧面板拉宽）：浮条按舞台宽折行，不裁切。 */
  stageWidth?: number
  /**
   * 节点贴着哪条边（边界态，2026-10-06 用户截图：节点靠画布上沿，「改图」菜单翻下来压住了浮条那一排）。
   * `top` = 卡的上沿离舞台上沿只有 56px，浮条被夹回舞台里、头顶放不下菜单；`bottom` / `left` / `right` 同理。
   */
  edge?: 'top' | 'bottom' | 'left' | 'right'
  /** 画布缩放（浮条反向缩放保持屏幕尺寸不变；菜单不许因此算错位置）。 */
  zoom?: number
  /** 这一格的界面语言（英文字长，浮条更宽、更容易折行）。 */
  locale?: 'zh-CN' | 'en'
  /**
   * 「高清」的三种处境（C 设计样张，2026-10-06）：`blocked` = 现在的死路（灰掉写原因）；`guide` = 没有放大模型但有路走
   * （不灰，第二行「还没有放大模型 · 点这里添加」，点了去添加）；`ready` = 目录里有放大模型，照常可点。
   */
  upscale?: 'blocked' | 'guide' | 'ready'
}

const noop = (): void => {}

/** 切到这一格要的语言；切完之前不举就绪旗（否则截到的是上一格的语言）。 */
function useLabLocale(locale: ToolbarStageProps['locale']): boolean {
  const { i18n } = useTranslation()
  const want = locale ?? 'zh-CN'
  const [applied, setApplied] = React.useState(i18n.language === want)
  React.useEffect(() => {
    if (i18n.language === want) { setApplied(true); return undefined }
    const release = holdDesignLabReady(`quick-actions:locale:${want}`)
    void i18n.changeLanguage(want).then(() => { setApplied(true); release() })
    return release
  }, [i18n, want])
  return applied
}

/** 画布缩放：浮条外壳从工作台 store 读当前分类的缩放。 */
function useLabZoom(zoom: number | undefined): void {
  React.useLayoutEffect(() => {
    if (zoom === undefined) return undefined
    const previous = useWorkbenchStore.getState().categoryViewports
    useWorkbenchStore.setState({ categoryViewports: { ...previous, shots: { x: 0, y: 0, zoom } } as never })
    return () => { useWorkbenchStore.setState({ categoryViewports: previous }) }
  }, [zoom])
}

export function QuickToolbarStage({ open, hoverCell, derivedGrid = false, stageWidth, edge, zoom, locale, upscale = 'blocked' }: ToolbarStageProps): JSX.Element {
  const { t } = useTranslation()
  const localeReady = useLabLocale(locale)
  useLabZoom(zoom)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const node = React.useMemo(() => sourceNode(derivedGrid ? {
    id: 'qa-derived',
    title: `${t('generationCommon.quickActions.actions.multiAngleGrid')} · ${SOURCE_TITLE}`,
    result: { id: 'qa-derived-r', type: 'image', url: GRID_FRAME, createdAt: 2 },
    meta: { modelKey: 'gpt-image-2', modelVendor: 'apimart', [QUICK_ACTION_META_KEY]: { id: 'multi-angle-grid', sourceNodeId: 'qa-source', grid: { rows: 3, cols: 3 } } },
  } : {}), [derivedGrid, t])
  const nodes = React.useMemo(() => [node], [node])
  const ready = useCanvasStores(nodes) && localeReady
  useOpenOnMount(rootRef, ready ? open : undefined, hoverCell)
  // 放大要的是一个「放大」能力的模型；夹具目录里没有 → 这一项灰掉并说原因（与价格无关）。
  const blocked = React.useMemo(() => (upscale === 'blocked' ? { upscale: t('generationCommon.quickActions.blocked.noUpscaleModel') } : {}), [t, upscale])
  const guides = React.useMemo(() => (upscale === 'guide' ? { upscale: { description: t('generationCommon.quickActions.guides.upscaleAdd'), onSelect: noop } } : undefined), [t, upscale])
  const width = stageWidth ?? QUICK_ACTIONS_CELL_WIDTH
  const left = edge === 'left' ? 8 : edge === 'right' ? width - CARD.width - 8 : Math.max(16, Math.round((width - CARD.width) / 2))
  const top = edge === 'top' ? EDGE_CARD_TOP : edge === 'bottom' ? QUICK_ACTIONS_CELL_HEIGHT - CARD.height - 8 : CARD_TOP
  const shared = {
    reportFeedback: noop, node, editGrid: null, imageOpBusy: false, onCrop: noop, onTransform: noop,
    onRemoveBackground: noop, onPreview: noop, onOpenProvenance: noop,
  }
  const toolbar = (
    <ImageQuickActionsToolbar
      {...shared}
      onGridSplit={noop}
      quickActionBlocked={blocked}
      quickActionGuides={guides}
      onQuickAction={noop}
    />
  )
  return (
    <Stage width={width}>
      <div ref={rootRef}>{ready ? <Card left={left} top={top} zoom={zoom} frame={node.result?.url ?? STREET_FRAME} title={node.title} toolbar={toolbar} /> : null}</div>
    </Stage>
  )
}

/** 节点右侧「+」圈点一下：用这个节点生成…（图片源 / 视频源各一格，看灰掉的项和原因）。 */
export function DeriveMenuStage({ sourceKind }: { sourceKind: 'image' | 'video' }): JSX.Element {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const node = React.useMemo(() => sourceNode(sourceKind === 'video'
    ? { kind: 'video', title: '雨夜街口 · 推近', result: { id: 'qa-v', type: 'video', url: '', thumbnailUrl: STREET_FRAME, createdAt: 1 } as never }
    : {}), [sourceKind])
  const nodes = React.useMemo(() => [node], [node])
  const ready = useCanvasStores(nodes)
  const [point, setPoint] = React.useState<{ x: number; y: number } | null>(null)
  React.useLayoutEffect(() => {
    if (!ready) return
    const card = rootRef.current?.querySelector('.generation-canvas-v2-node__preview')?.getBoundingClientRect()
    // 「+」圈在卡右缘外 28px、竖直居中（`generationCanvasReactFlowVisualContract.ts` 的 magnetic 档）。
    if (card) setPoint({ x: card.right + 28, y: card.top + card.height / 2 })
  }, [ready])
  return (
    <Stage>
      <div ref={rootRef}>
        {ready ? <Card left={160} top={MENU_CARD_TOP} frame={STREET_FRAME} title={node.title} /> : null}
        {ready && point ? (
          // 占位：真把手是 React Flow 的 Handle（离开画布内核渲染不出来），这里只标出「+」圈的位置。
          <span
            aria-hidden
            className="fixed inline-flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-nomi-accent bg-nomi-paper text-nomi-accent shadow-nomi-md"
            style={{ left: point.x, top: point.y }}
          >
            <IconPlus size={18} stroke={1.8} />
          </span>
        ) : null}
      </div>
      {point ? <NodeDeriveMenu verdicts={connectionCreateVerdictsForSource(node, NODE_DERIVE_KINDS)} point={{ x: point.x + 18, y: point.y - 12 }} onPick={noop} onClose={noop} /> : null}
    </Stage>
  )
}

/** 节点右键菜单多一项「复制为变体」（带上游连线、不带结果）。 */
export function ContextMenuStage(): JSX.Element {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const nodes = React.useMemo(() => [sourceNode()], [])
  const ready = useCanvasStores(nodes)
  const [point, setPoint] = React.useState<{ x: number; y: number } | null>(null)
  React.useLayoutEffect(() => {
    if (!ready) return
    const card = rootRef.current?.querySelector('.generation-canvas-v2-node__preview')?.getBoundingClientRect()
    if (card) setPoint({ x: card.left + card.width * 0.62, y: card.top + card.height * 0.4 })
  }, [ready])
  return (
    <Stage>
      <div ref={rootRef} className="contents">{ready ? <Card left={160} top={MENU_CARD_TOP} frame={STREET_FRAME} title={SOURCE_TITLE} /> : null}</div>
      {point ? (
        <NodeContextMenu point={point} canPaste={false} canGroup={false} onAction={noop} onDuplicateVariant={noop} onClose={noop} />
      ) : null}
    </Stage>
  )
}

/**
 * 派生之后：源节点不变，右侧新节点（连着一条参考线、提示词已填好）**空闲**，等用户点它的 ↑ 才生成。
 * 两张都是现役 `BaseGenerationNode`；浮框（提示词 + ↑）只在节点被选中时才出，所以这一格把新节点选上来看它——
 * 真实流程里选中仍留在源节点（单测钉住），用户点开新节点才看到这块。
 */
export function DerivedIdleStage(): JSX.Element {
  const { t } = useTranslation()
  const derivedId = 'qa-derived'
  const source = React.useMemo(() => sourceNode({ position: { x: 0, y: 0 } }), [])
  const derived = React.useMemo((): GenerationCanvasNode => ({
    id: derivedId,
    kind: 'image',
    title: `${t('generationCommon.quickActions.actions.multiAngleGrid')} · ${SOURCE_TITLE}`,
    categoryId: 'shots',
    position: { x: 0, y: 0 },
    size: { ...CARD },
    status: 'idle',
    prompt: t('generationCommon.quickActions.labDerivedPrompt'),
    meta: { modelKey: 'gpt-image-2', modelVendor: 'apimart', [QUICK_ACTION_META_KEY]: { id: 'multi-angle-grid', sourceNodeId: 'qa-source', grid: { rows: 3, cols: 3 }, promptReady: true } },
  } as GenerationCanvasNode), [t])
  const nodes = React.useMemo(() => [source, derived], [derived, source])
  const edges = React.useMemo(() => [{ id: 'qa-edge', source: 'qa-source', target: derivedId }], [])
  React.useMemo(() => {
    installCatalogBridge()
    // 目录闸（keepUsableModelRows）要每行带 availability；composer-bar 夹具没带，这里补一层。
    const catalog = (window as unknown as { nomiDesktop: { modelCatalog: { listModels: (params?: unknown) => Array<Record<string, unknown>> } } }).nomiDesktop.modelCatalog
    const listModels = catalog.listModels
    catalog.listModels = (params) => listModels(params).map((row) => ({ ...row, availability: { usable: true } }))
  }, [])
  const [chunkReady, setChunkReady] = React.useState(false)
  React.useEffect(() => { void COMPOSER_CHUNK.then(() => setChunkReady(true)) }, [])
  const ready = useCanvasStores(nodes, edges) && chunkReady
  React.useLayoutEffect(() => {
    if (ready) useGenerationCanvasStore.setState({ selectedNodeIds: [derivedId] })
  }, [ready])
  const live = useGenerationCanvasStore((state) => state.nodes)
  const liveSource = live.find((node) => node.id === 'qa-source')
  const liveDerived = live.find((node) => node.id === derivedId)
  const left = 80
  const gap = 64
  return (
    <Stage width={1100} height={920}>
      {ready && liveSource && liveDerived ? (
        <>
          <svg className="absolute" style={{ left: left + CARD.width, top: CARD_TOP - 200 + CARD.height / 2, width: gap, height: 2 }} aria-hidden>
            <line x1="0" y1="1" x2={gap} y2="1" stroke="var(--nomi-line)" strokeWidth="2" />
          </svg>
          <div className="absolute" style={{ left, top: CARD_TOP - 200, width: CARD.width, height: CARD.height }}>
            <BaseGenerationNode node={liveSource} selected={false} />
          </div>
          <div className="absolute" style={{ left: left + CARD.width + gap, top: CARD_TOP - 200, width: CARD.width, height: CARD.height }}>
            <BaseGenerationNode node={liveDerived} selected />
          </div>
        </>
      ) : null}
    </Stage>
  )
}
