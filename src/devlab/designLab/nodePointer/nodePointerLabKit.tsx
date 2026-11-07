// 设计实验室 · 屏「指向元素」（NodePointer 板 A1–A5，2026-10-23 D2 第②步）的取景台。
//
// 格子里挂的全是生产件：指向元素（NodePointer / NodePointerGroup / NodePointerReturnToChat）读**现役**画布 store、
// 制作投影缓存、分镜方案；左边 / 背后的画布节点是生产 BaseGenerationNode，外部高亮用画布外壳的同一个类函数
// （externalHighlightShellClass），悬停读的是同一个 nodeExternalHighlightStore——实验室里没有 React Flow 投影，
// 所以「悬停 → 节点亮」这里直接读 store（真画布那一头走投影，单测 + 对焦走查各钉一遍）。
// 对话面板、Agent 那一句话、画布点阵是取景用的布景（样张同款），不是生产件。
// 「生成中」那一格不带开始时间：状态条只说「生成中」（节点自己那一句），截图不随墙钟变；不去冻全局时钟——
// 画布节点的结果图走延迟加载队列，队列按 Date.now 判空闲，冻住它图就永远排着。
import React, { type JSX } from 'react'
import { cn } from '../../../utils/cn'
import type { GenerationCanvasNode } from '../../../workbench/generationCanvas/model/generationCanvasTypes'
import type { StoryboardDesign } from '../../../workbench/workbenchTypes'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import { useNodeExternalHighlightStore } from '../../../workbench/generationCanvas/store/nodeExternalHighlightStore'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import { useProductionCanvasLandingStore } from '../../../workbench/production/productionCanvasLandingStore'
import BaseGenerationNode from '../../../workbench/generationCanvas/nodes/BaseGenerationNode'
import { resolveNodeVisualSize } from '../../../workbench/generationCanvas/nodes/nodeSizing'
import { externalHighlightShellClass, type ExternalNodeHighlight } from '../../../workbench/generationCanvas/reactFlow/generationCanvasReactFlowAdapter'
import { NodePointer } from '../../../workbench/ai/pointer/NodePointer'
import { NodePointerGroup, NodePointerReturnToChat } from '../../../workbench/ai/pointer/NodePointerGroup'
import type { NodePointerSubject } from '../../../workbench/ai/pointer/nodePointerModel'
import { useNodePointerStore } from '../../../workbench/ai/pointer/nodePointerStore'
import { AgentBallFace } from '../../../ui/app-shell/shell/AgentBallFace'
import { LabCanvasNodeHost, LabCanvasViewport } from '../labCanvasViewport'
import { LabLocaleGate } from '../labLocaleGate'
import { holdDesignLabReady } from '../labReadyHold'
import { installCatalogBridge } from '../nodeComposerBar/nodeComposerBarLabKit'
import { preloadModelOptions } from '../../../config/modelCatalogCache'
import { shotArt } from '../generationList/generationListArt'

export const NODE_POINTER_CELL_WIDTH = 1240
export const NODE_POINTER_CELL_HEIGHT = 780

type Locale = 'zh-CN' | 'en'
const L = (locale: Locale, zh: string, en: string): string => (locale === 'en' ? en : zh)

const RUN_ID = 'lab-node-pointer-run'
const STOPPED_RUN_ID = 'lab-node-pointer-stopped'
export const DESIGN_ID = 'lab-node-pointer-design'
export const DOCUMENT_ID = 'lab-node-pointer-doc'

const VIDEO_META = (ratio: string, duration: number, extra: Record<string, unknown> = {}) => ({
  modelKey: 'seedance-2', modelVendor: 'apimart', aspect_ratio: ratio, duration, resolution: '480p', ...extra,
})
const shot = (shotId: string) => ({ storyboardDesignId: DESIGN_ID, shotId })
const poster = (seed: number, ratio: '16:9' | '9:16', tone: string) => ({ id: `art-${seed}`, type: 'video' as const, url: '/fixtures/node-label-video.mp4', thumbnailUrl: shotArt(seed, ratio, tone), createdAt: 1 })

function node(partial: Partial<GenerationCanvasNode> & Pick<GenerationCanvasNode, 'id'>): GenerationCanvasNode {
  return { kind: 'video', title: '', prompt: '', position: { x: 0, y: 0 }, status: 'idle', categoryId: 'shots', ...partial } as GenerationCanvasNode
}

/** 分镜方案：节点的「镜 NN」从这里派生（和画布、列表同一个口）。付费卡那一屏也用它。 */
export function design(locale: Locale): StoryboardDesign {
  const shots = Array.from({ length: 12 }, (_, index) => ({ shotId: `s${index + 1}`, index: index + 1, shotKind: 'video' as const, durationSec: 4, anchorIds: [], prompt: '' }))
  return { id: DESIGN_ID, documentId: DOCUMENT_ID, title: L(locale, '纸船', 'Paper boat'), committed: true, status: 'draft', createdAt: 1, updatedAt: 1, sourceDocumentUpdatedAt: 1, plan: { title: '', anchors: [], shots } }
}

/** 画布上这一屏要的全部节点（每个状态一个，外加组指向 / 竖版用的几个）。 */
function labNodes(locale: Locale): GenerationCanvasNode[] {
  const running = { status: 'running' as const }
  return [
    node({ id: 'np-await', title: L(locale, '纸船出发', 'Paper boat departs'), meta: { ...VIDEO_META('16:9', 4), ...shot('s1'), productionRunId: RUN_ID } }),
    node({ id: 'np-queued', title: L(locale, '越过落叶', 'Past the leaves'), meta: { ...VIDEO_META('16:9', 5), ...shot('s2'), productionRunId: RUN_ID } }),
    node({ id: 'np-gen', title: L(locale, '越过落叶', 'Past the leaves'), ...running, meta: { ...VIDEO_META('16:9', 5), ...shot('s2') } }),
    // 画布那一张要真画出结果图：无头 Chromium 不解 H.264，这一格的结果给成首帧图（指向元素读的也正是这一张）。
    node({ id: 'np-done', title: L(locale, '纸船出发', 'Paper boat departs'), status: 'success', result: { id: 'art-done', type: 'image', url: shotArt(1, '16:9', '#c9d6dc|#93a9b8'), createdAt: 1 }, meta: { ...VIDEO_META('16:9', 4), ...shot('s1') } }),
    node({ id: 'np-failed', title: L(locale, '漂向远处', 'Drifting away'), status: 'error', error: 'fetch failed', meta: { ...VIDEO_META('16:9', 4), ...shot('s3') } }),
    node({ id: 'np-reflect', title: L(locale, '水面倒影', 'Reflections'), status: 'success', result: poster(4, '16:9', '#3d4f5c|#c7a46a'), meta: { ...VIDEO_META('16:9', 4), ...shot('s4') } }),
    node({ id: 'np-stopped', title: L(locale, '雨停之后', 'After the rain'), meta: { ...VIDEO_META('16:9', 4), ...shot('s6'), productionRunId: STOPPED_RUN_ID } }),
    node({ id: 'np-recoverable', title: L(locale, '桥下', 'Under the bridge'), status: 'recoverable', meta: { ...VIDEO_META('16:9', 4), ...shot('s7') } }),
    node({ id: 'np-draft-1', title: L(locale, '纸船出发', 'Paper boat departs'), meta: { ...VIDEO_META('16:9', 4), ...shot('s1') } }),
    node({ id: 'np-draft-2', title: L(locale, '越过落叶', 'Past the leaves'), meta: { ...VIDEO_META('16:9', 5), ...shot('s2') } }),
    node({ id: 'np-draft-3', title: L(locale, '漂向远处', 'Drifting away'), meta: { ...VIDEO_META('16:9', 4), ...shot('s3') } }),
    node({ id: 'np-control', kind: 'image', title: L(locale, '参考 · 水洼', 'Reference · Puddle'), status: 'success', result: { id: 'art-control', type: 'image', url: shotArt(6, '16:9', '#8da6a8|#d8c7a4'), createdAt: 1 } }),
    // 窄窗口第 ① 步用的同一批镜头（还没点过：「已定位」是全局的一项，① 不能跟着 ③ 一起标）。
    node({ id: 'np-narrow-1', title: L(locale, '纸船出发', 'Paper boat departs'), meta: { ...VIDEO_META('16:9', 4), ...shot('s1') } }),
    node({ id: 'np-narrow-2', title: L(locale, '越过落叶', 'Past the leaves'), meta: { ...VIDEO_META('16:9', 5), ...shot('s2') } }),
    node({ id: 'np-narrow-3', title: L(locale, '漂向远处', 'Drifting away'), meta: { ...VIDEO_META('16:9', 4), ...shot('s3') } }),
    node({ id: 'np-tall-done', title: L(locale, '越过落叶', 'Past the leaves'), status: 'success', result: poster(2, '9:16', '#8f86c2|#5c66a3'), meta: { ...VIDEO_META('9:16', 5), ...shot('s2') } }),
    node({ id: 'np-tall-draft', title: L(locale, '漂向远处', 'Drifting away'), meta: { ...VIDEO_META('9:16', 4), ...shot('s3') } }),
    node({ id: 'np-long', title: L(locale, '纸船出发后在河湾里转了一个很大的弯', 'The paper boat drifts around a very wide river bend'), status: 'success', result: poster(5, '16:9', '#c9d6dc|#93a9b8'), meta: { ...VIDEO_META('16:9', 4), ...shot('s8') } }),
    ...Array.from({ length: 5 }, (_, index) => node({
      id: `np-five-${index + 1}`,
      title: [L(locale, '纸船出发', 'Paper boat departs'), L(locale, '越过落叶', 'Past the leaves'), L(locale, '漂向远处', 'Drifting away'), L(locale, '水面倒影', 'Reflections'), L(locale, '日出', 'Sunrise')][index],
      status: 'success',
      result: poster(index + 1, '16:9', ['#c9d6dc|#93a9b8', '#3d4f5c|#c7a46a', '#a8b9a0|#5d7a63', '#3d4f5c|#c7a46a', '#e7c9a1|#c47e5a'][index]),
      meta: { ...VIDEO_META('16:9', 4), ...shot(`s${index + 1}`) },
    })),
  ]
}

/**
 * 制作投影缓存里的两份 Run：一份在等你确认（镜 01，没有任务、出价开着）+ 排队（镜 02 第 1/3），一份停着（用户暂停）。
 * 阶段全由生产的 deriveProductionShotState 从这两份 Run 派生，实验室不替它判。
 */
function seedRuns(): void {
  const job = (shotId: string) => ({ jobId: `job-${shotId}`, stageId: 'generate', status: 'authorized', createdAt: '2026-10-23T11:59:00.000Z', metadata: { shotId } })
  const run = {
    id: RUN_ID, status: 'running', jobs: [job('q1'), job('q2'), job('q3')], gates: [],
    generationPlan: {
      nodeId: 'np-plan',
      shots: [{ shotId: 'a1', nodeId: 'np-await' }, { shotId: 'q1', nodeId: 'np-queued' }, { shotId: 'q2', nodeId: 'np-queued-2' }, { shotId: 'q3', nodeId: 'np-queued-3' }],
      presentations: [{ shotIds: ['a1'], fromGate: 0, closed: false }],
    },
  }
  const stopped = {
    id: STOPPED_RUN_ID, status: 'paused', stop: { reason: 'user_paused' }, jobs: [job('p1')], gates: [],
    generationPlan: { nodeId: 'np-plan-2', shots: [{ shotId: 'p1', nodeId: 'np-stopped' }], presentations: [] },
  }
  useProductionCanvasLandingStore.getState().setRuns('lab', { [RUN_ID]: run, [STOPPED_RUN_ID]: stopped } as never)
}

/**
 * 只读目录桥：沿用实验室共用的那一份（seedance-2 / gpt-image-2），再给每一行补上主进程投影会给的「能用」。
 * 共用夹具的行没带 `availability`，目录读法按 fail-closed 一律当不可用，摘要里的模型名就永远读不出来。
 */
export function installPointerCatalog(): void {
  installCatalogBridge()
  const catalog = (window as unknown as { nomiDesktop: { modelCatalog: { listModels: (params?: { kind?: string }) => Array<Record<string, unknown>> } } }).nomiDesktop.modelCatalog
  const listModels = catalog.listModels
  catalog.listModels = (params) => listModels(params).map((row) => ({ ...row, availability: { usable: true } }))
}

export type LabPointerScene = {
  located?: string | null
  /** 窄窗口收起后要回到的对话（画「回到对话」）。 */
  returnTo?: { nodeId: string; label: string } | null
  /** 悬停哪几个指向元素（CSS 选择器；实验室里替鼠标派一次 pointerover，悬停的样子由组件自己画）。 */
  hover?: readonly string[]
}

/** 一格的根：灌夹具、钉语言；子树（目录、结果图）落定才放旗。 */
export function NodePointerStage({ locale = 'zh-CN', scene = {}, children }: { locale?: Locale; scene?: LabPointerScene; children: React.ReactNode }): JSX.Element {
  React.useMemo(() => installPointerCatalog(), [])
  const [seeded, setSeeded] = React.useState(false)
  React.useLayoutEffect(() => {
    useWorkbenchStore.setState({ activeCategoryId: 'shots', storyboardDesignsByDocumentId: { [DOCUMENT_ID]: [design(locale)] } })
    // 先整写一次（画布「载入完」只由 restoreSnapshot 这一个写口举起），再放夹具节点：
    // restoreSnapshot 会把没有任务号的「生成中」收敛成空闲（重开防幽灵转圈），实验室要的正是那一格。
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] }, 'lab-node-pointer')
    useGenerationCanvasStore.setState({ nodes: labNodes(locale), edges: [], groups: [] })
    seedRuns()
    useNodeExternalHighlightStore.setState({ hoverNodeId: null, claims: [] })
    useNodePointerStore.setState({
      locatedNodeId: scene.located ?? null,
      returnTo: scene.returnTo ? { surface: 'generation', form: 'float', nodeId: scene.returnTo.nodeId, label: scene.returnTo.label } : null,
    })
    setSeeded(true)
  }, [locale, scene.located, scene.returnTo?.nodeId, scene.returnTo?.label])
  useLabSettled(seeded)
  return (
    <LabLocaleGate locale={locale}>
      <div data-design-lab-stage="node-pointer" className="relative overflow-hidden bg-nomi-bg p-6 text-nomi-ink" style={{ width: NODE_POINTER_CELL_WIDTH, height: NODE_POINTER_CELL_HEIGHT }}>
        {seeded ? <>{children}{scene.hover?.map((target) => <LabHover key={target} target={target} />)}</> : null}
      </div>
    </LabLocaleGate>
  )
}

/**
 * 截图前等两件异步的事落定：模型目录（摘要里的模型名）、画布节点的结果图 / 视频（延迟加载队列）。
 * 走就绪旗的持有登记，不靠墙钟等待；最多等约 10 秒（600 帧），等不到就照实截。
 */
export function useLabSettled(seeded: boolean): void {
  React.useEffect(() => {
    if (!seeded) return undefined
    const release = holdDesignLabReady('node-pointer:settled')
    let frames = 0
    let cancelled = false
    let catalogReady = false
    void preloadModelOptions('video').catch(() => undefined).finally(() => { catalogReady = true })
    const tick = () => {
      if (cancelled) return
      frames += 1
      // 每张结果图的锚点都走到 ready 才算（idle / queued / loading 都还没画出来）。
      const pending = document.querySelector('[data-lab-canvas-node] [data-node-media-state]:not([data-node-media-state="ready"])')
      if ((catalogReady && !pending && frames > 2) || frames > 600) { release(); return }
      window.requestAnimationFrame(tick)
    }
    window.requestAnimationFrame(tick)
    return () => { cancelled = true; release() }
  }, [seeded])
}

/** 替鼠标在某个指向元素上派一次 pointerover（React 的 onPointerEnter 就是从它来的）。 */
export function LabHover({ target }: { target: string }): null {
  React.useEffect(() => {
    const release = holdDesignLabReady(`node-pointer:hover:${target}`)
    const frame = window.requestAnimationFrame(() => {
      document.querySelector(target)?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
      window.requestAnimationFrame(release)
    })
    return () => { window.cancelAnimationFrame(frame); release() }
  }, [target])
  return null
}

/** 取景用的对话面板（样张同款布景：360 宽、纸底、细边、Agent 一句话）。 */
export function LabChatPanel({ text, width = 360, children, className }: { text: string; width?: number; children: React.ReactNode; className?: string }): JSX.Element {
  return (
    <div className={cn('flex flex-col gap-3 rounded-nomi-lg border border-nomi-line bg-nomi-paper p-4 shadow-nomi-lg', className)} style={{ width }}>
      <div className="font-serif text-body text-nomi-ink">Nomi</div>
      <p className="m-0 text-body-sm text-nomi-ink">{text}</p>
      {children}
    </div>
  )
}

/** 画布上的一张真节点（生产 BaseGenerationNode），外部高亮画在外壳上，和画布用同一个类函数；悬停读同一个 store。 */
export function LabCanvasNode({ nodeId, width, flash = false }: { nodeId: string; width?: number; flash?: boolean }): JSX.Element | null {
  const target = useGenerationCanvasStore((state) => state.nodes.find((candidate) => candidate.id === nodeId))
  const hovered = useNodeExternalHighlightStore((state) => state.hoverNodeId === nodeId)
  if (!target) return null
  const size = resolveNodeVisualSize(width ? { ...target, size: { width, height: Math.round(width * 9 / 16) } } : target)
  const highlight: ExternalNodeHighlight | null = flash ? 'flash' : hovered ? 'hover' : null
  return (
    <div className="relative" style={{ width: size.width, height: size.height + 72, paddingTop: 72 }} data-lab-canvas-node={nodeId}>
      <LabCanvasNodeHost width={size.width} height={size.height}>
        <div className={cn('generation-canvas-react-flow__node-shell size-full', externalHighlightShellClass(highlight))} data-external-highlight={highlight ?? undefined}>
          <BaseGenerationNode node={{ ...target, size: { width: size.width, height: size.height } }} selected={false} readOnly />
        </div>
      </LabCanvasNodeHost>
    </div>
  )
}

/** 画布缩小着看（窄窗口那几格）：布景按画布缩放缩一圈，节点卡本身照生产尺寸渲染。 */
export function LabCanvasZoomed({ zoom, children, className }: { zoom: number; children: React.ReactNode; className?: string }): JSX.Element {
  return <div className={cn('absolute origin-top-left', className)} style={{ transform: `scale(${zoom})` }}>{children}</div>
}

/** 画布那一块布景（点阵底）。 */
export function LabCanvasBackdrop({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }): JSX.Element {
  return (
    <LabCanvasViewport>
      <div className={cn('relative overflow-hidden rounded-nomi border border-nomi-line bg-workbench-bg bg-[radial-gradient(var(--nomi-ink-10)_1px,transparent_1px)] [background-size:16px_16px]', className)} style={style}>
        {children}
      </div>
    </LabCanvasViewport>
  )
}

export function LabCaption({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="mb-2 text-caption text-nomi-ink-60">{children}</div>
}

// ── 每一格用到的主体 ─────────────────────────────────────────────────────────────

export function subjects(locale: Locale) {
  const deleted: NodePointerSubject = { nodeId: 'np-gone', removed: true, fallbackLabel: { shot: L(locale, '镜 05', 'Shot 05'), title: L(locale, '日出', 'Sunrise') } }
  const unavailable: NodePointerSubject = { nodeId: 'np-not-here', fallbackLabel: { shot: L(locale, '镜 09', 'Shot 09'), title: L(locale, '远山', 'Far hills') } }
  return {
    await: { nodeId: 'np-await' } as NodePointerSubject,
    queued: { nodeId: 'np-queued' } as NodePointerSubject,
    gen: { nodeId: 'np-gen' } as NodePointerSubject,
    done: { nodeId: 'np-done' } as NodePointerSubject,
    failed: { nodeId: 'np-failed', outcome: L(locale, '没有发出去', 'Not sent') } as NodePointerSubject,
    stopped: { nodeId: 'np-stopped' } as NodePointerSubject,
    recoverable: { nodeId: 'np-recoverable' } as NodePointerSubject,
    long: { nodeId: 'np-long' } as NodePointerSubject,
    deleted,
    unavailable,
    drafts: ['np-draft-1', 'np-draft-2', 'np-draft-3'].map((nodeId) => ({ nodeId })) as NodePointerSubject[],
    narrowDrafts: ['np-narrow-1', 'np-narrow-2', 'np-narrow-3'].map((nodeId) => ({ nodeId })) as NodePointerSubject[],
    mixed: [{ nodeId: 'np-done' }, { nodeId: 'np-gen' }, { nodeId: 'np-failed' }] as NodePointerSubject[],
    five: Array.from({ length: 5 }, (_, index) => ({ nodeId: `np-five-${index + 1}` })) as NodePointerSubject[],
    four: Array.from({ length: 4 }, (_, index) => ({ nodeId: `np-five-${index + 1}` })) as NodePointerSubject[],
    portraitMix: [{ nodeId: 'np-done' }, { nodeId: 'np-tall-done' }, { nodeId: 'np-tall-draft' }] as NodePointerSubject[],
    tall: { nodeId: 'np-tall-done' } as NodePointerSubject,
  }
}

/** 一排单张 P1（宽 = 样张单卡宽）。 */
export function LabCardRow({ items, width = 180 }: { items: ReadonlyArray<{ caption: string; subject: NodePointerSubject }>; width?: number }): JSX.Element {
  return (
    <div className="flex items-start gap-4">
      {items.map(({ caption, subject }) => (
        <div key={`${caption}-${subject.nodeId}`} className="flex flex-col" style={{ width }}>
          <LabCaption>{caption}</LabCaption>
          <NodePointer subject={subject} />
        </div>
      ))}
    </div>
  )
}

export { NodePointer, NodePointerGroup, NodePointerReturnToChat, AgentBallFace, L }
export type { Locale }
