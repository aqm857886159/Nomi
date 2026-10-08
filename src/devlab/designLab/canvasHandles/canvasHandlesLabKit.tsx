// 设计实验室 · 屏「画布 · 左右拉环与空节点『试试』（提案）」的取景台（D-handles 样张，等用户拍板）。
//
// 节点外壳、把手、浮条、生成框都是现役组件：挂在真的 React Flow 内核里（同 versionCardsFlowLabKit），
// 节点类型是生产 nodeTypes。提案只在三处落笔，全部在本文件里、生产代码一行没改：
//   1. 哪一侧有拉环：按 `inputVerdictsForTarget` / `connectionCreateVerdictsForSource`（连线判定那一个 owner）算，
//      算出「这一侧什么都接不上」就把那一侧的现役把手藏掉——实现时改 `resolveGenerationFlowConnectionAffordance`。
//   2. 点「+」出的两个菜单：右边是现役 `NodeDeriveMenu` 本体；左边「给它加输入」用同一个 `WorkbenchMenu` 原语、
//      同一套置灰 + 第二行原因，判据以本卡为**目标**算（修第 0 步实测到的方向反了）。
//   3. 空节点「试试」：替换现役空态那一句说明（把说明那一行藏掉，把列表挂进同一个空态的 action 位）。
// 空画布那一格挂的是现役 `GenerationCanvas` 本体（左缘工具条同框），只替换空态里的说明与「+ 新建」。
import React, { type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../../../workbench/generationCanvas/reactFlow/generationCanvasReactFlow.css'
import '../../../workbench/generationCanvas/styles/generationCanvas.css'
import { IconFolderOpen, IconPointer, IconUpload, IconWriting } from '../../../vendor/tablerIcons'
import { ActionCard, WorkbenchButton } from '../../../design'
import { WorkbenchMenu, type WorkbenchMenuIcon, type WorkbenchMenuNode } from '../../../design/menu'
import { nodeTypes, edgeTypes } from '../../../workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowNodes'
import { toGenerationFlowNodes } from '../../../workbench/generationCanvas/reactFlow/generationCanvasReactFlowAdapter'
import GenerationCanvas from '../../../workbench/generationCanvas/components/GenerationCanvas'
import { NodeDeriveMenu } from '../../../workbench/generationCanvas/quickActions/NodeDeriveMenu'
import { NODE_DERIVE_KINDS, type NodeDeriveKind } from '../../../workbench/generationCanvas/quickActions/nodeDeriveMenuModel'
import {
  connectionCreateVerdictsForSource,
  referenceAssetKindForNode,
  type ConnectionCreateVerdict,
} from '../../../workbench/generationCanvas/agent/referenceEdgeCapability'
import { getGenerationNodeIcon, getQuickAddGenerationNodePlugins } from '../../../workbench/generationCanvas/nodes/renderRegistry'
import { canvasResidentAddIntents } from '../../../workbench/generationCanvas/components/canvasToolbarModel'
import type { GenerationCanvasNode, GenerationNodeKind } from '../../../workbench/generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import { holdDesignLabReady } from '../labReadyHold'
import { COMPOSER_CHUNK, installCatalogBridge } from '../nodeComposerBar/nodeComposerBarLabKit'
import { STREET_FRAME } from '../nodeQuickActions/nodeQuickActionsLabKit'
import { useLabLocale } from '../versionCards/versionCardsFlowLabKit'

export const CANVAS_HANDLES_CELL_WIDTH = 1100
export const CANVAS_HANDLES_CELL_HEIGHT = 620

export type LabLocale = 'zh-CN' | 'en'
const noop = (): void => undefined

// ── 夹具 ─────────────────────────────────────────────────────────────────────

const PORTRAIT_FRAME = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#d9cfc0"/><rect y="250" width="640" height="110" fill="#b9a68c"/>
  <circle cx="320" cy="130" r="54" fill="#e6c3a0"/><path d="M226 330 q94 -150 188 0 z" fill="#5a6b7d"/>
  <path d="M266 110 q54 -80 108 0 q-8 -50 -54 -54 q-46 4 -54 54z" fill="#3a2b22"/></svg>`)

type Fixture = { id: string; kind: GenerationNodeKind; x: number; y: number; title: string; frame?: string; resultType?: 'image' | 'video'; width?: number; height?: number }

function fixtureNode(input: Fixture): GenerationCanvasNode {
  const result = input.frame
    ? { id: `${input.id}-r`, type: input.resultType ?? 'image', url: input.frame, thumbnailUrl: input.frame, createdAt: 1 }
    : undefined
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    categoryId: 'shots',
    position: { x: input.x, y: input.y },
    size: { width: input.width ?? 300, height: input.height ?? 169 },
    status: result ? 'success' : 'idle',
    prompt: '',
    ...(result ? { result, history: [result] } : {}),
    meta: input.kind === 'image' || input.kind === 'asset' ? { imageWidth: 640, imageHeight: 360, imageAspectRatio: 16 / 9 } : {},
  } as unknown as GenerationCanvasNode
}

/** 框外标签行的标题（按 id，中 / 英）。剪辑与文本卡的标题在卡头里自带，不在这张表里。 */
const TITLES: Record<string, [string, string]> = {
  'h-gen': ['镜头 1 · 雨夜街口', 'Shot 1 · Rainy street'],
  'h-asset': ['主角定妆照', 'Lead portrait'],
  'h-empty-image': ['镜头 2', 'Shot 2'],
  'h-empty-video': ['镜头 3', 'Shot 3'],
}

export const FIXTURES = {
  genImage: (x = 150, y = 150) => fixtureNode({ id: 'h-gen', kind: 'image', x, y, title: '', frame: STREET_FRAME }),
  asset: (x = 640, y = 150) => fixtureNode({ id: 'h-asset', kind: 'asset', x, y, title: '', frame: PORTRAIT_FRAME }),
  emptyImage: (x = 380, y = 110) => fixtureNode({ id: 'h-empty-image', kind: 'image', x, y, title: '', width: 340, height: 191 }),
  emptyVideo: (x = 380, y = 110) => fixtureNode({ id: 'h-empty-video', kind: 'video', x, y, title: '', width: 340, height: 191 }),
  emptyText: (x = 360, y = 120) => fixtureNode({ id: 'h-empty-text', kind: 'text', x, y, title: '', width: 320, height: 220 }),
  emptyClip: (x = 260, y = 140) => fixtureNode({ id: 'h-empty-clip', kind: 'clip', x, y, title: '', width: 560, height: 240 }),
}

// ── 提案 1/2 的判据：以本卡为**目标**问「能接进来什么」（复用连线判定那一个 owner，不另写种类表）────────

/** 候选输入种类 → 一张这一类的「探针」源节点；判据仍是 `connectionCreateVerdictsForSource`，只是把本卡的种类当成「新建的那一类」。 */
function probeSource(kind: NodeDeriveKind): GenerationCanvasNode {
  return { id: `probe-${kind}`, kind, title: '', categoryId: 'shots', position: { x: 0, y: 0 }, size: { width: 1, height: 1 }, status: 'idle', prompt: '', meta: {} } as unknown as GenerationCanvasNode
}

export type InputVerdict = { kind: NodeDeriveKind; ok: boolean; verdict: ConnectionCreateVerdict<GenerationNodeKind> }

/** 左「+」的判据（提案）：每一类能不能接进这张卡。实现时搬进 referenceEdgeCapability.ts，与右侧那份同文件。 */
export function inputVerdictsForTarget(target: GenerationCanvasNode): InputVerdict[] {
  return NODE_DERIVE_KINDS.map((kind) => {
    const verdict = connectionCreateVerdictsForSource(probeSource(kind), [target.kind])[0]
    return { kind, ok: verdict.ok, verdict }
  })
}

/**
 * 判据里认不出的「收输入」种类（**冲突点，交协调定**）：剪辑卡收视频是 ClipNode 自己读上游边，不走模型档案，
 * 所以 connectionCreateVerdictsForSource 判它「一类都收不进」。样张先按真实行为画左环；实现时这条事实要进
 * 节点种类定义（generationNodeKinds）的一个字段，不在这里留名单。
 */
const RECEIVES_WITHOUT_ARCHETYPE: ReadonlySet<GenerationNodeKind> = new Set<GenerationNodeKind>(['clip'])

/** 这张卡两侧各有没有拉环（提案 1）：这一侧一类都接不上 = 不画。 */
export function connectionSides(node: GenerationCanvasNode): { left: boolean; right: boolean } {
  return {
    left: RECEIVES_WITHOUT_ARCHETYPE.has(node.kind) || inputVerdictsForTarget(node).some((item) => item.ok),
    right: connectionCreateVerdictsForSource(node, NODE_DERIVE_KINDS).some((item) => item.ok),
  }
}

/** 菜单与原因里出现的种类名：只有这几类会出现（四类候选 + 有左环的目标），静态键，门岗查得到。 */
const KIND_LABEL_KEYS: Partial<Record<GenerationNodeKind, string>> = {
  image: 'canvas.nodeKinds.image',
  video: 'canvas.nodeKinds.video',
  audio: 'canvas.nodeKinds.audio',
  text: 'canvas.nodeKinds.text',
  clip: 'canvas.nodeKinds.clip',
}
const KIND_LABEL = (kind: GenerationNodeKind, t: TFunction): string => (KIND_LABEL_KEYS[kind] ? t(KIND_LABEL_KEYS[kind]!) : kind)
const ASSET_LABEL_KEYS = {
  image: 'generationCommon.quickActions.derive.assets.image',
  video: 'generationCommon.quickActions.derive.assets.video',
  audio: 'generationCommon.quickActions.derive.assets.audio',
} as const

function addInputReason(item: InputVerdict, target: GenerationCanvasNode, t: TFunction): string | undefined {
  if (item.ok) return undefined
  const asset = referenceAssetKindForNode(probeSource(item.kind))
  if (!asset) return t('generationCommon.quickActions.addInput.notAccepted', { target: KIND_LABEL(target.kind, t), source: KIND_LABEL(item.kind, t) })
  return t('generationCommon.quickActions.derive.noModelAccepts', {
    asset: t(ASSET_LABEL_KEYS[asset]),
    kind: KIND_LABEL(target.kind, t),
  })
}

/** 左「+」菜单「给它加输入」（提案 2）：四类与右菜单同序同图标、同一套置灰 + 第二行原因；下面一段是素材库与点选模式。 */
export function buildAddInputMenuItems(target: GenerationCanvasNode, t: TFunction): WorkbenchMenuNode[] {
  return [
    {
      kind: 'group',
      id: 'add-input',
      label: t('generationCommon.quickActions.addInput.title'),
      items: inputVerdictsForTarget(target).map((item) => {
        const reason = addInputReason(item, target, t)
        return {
          id: `add-input-${item.kind}`,
          label: KIND_LABEL(item.kind, t),
          icon: getGenerationNodeIcon(item.kind) as unknown as WorkbenchMenuIcon,
          disabled: !item.ok,
          ...(reason ? { description: reason, disabledReason: reason } : {}),
          onSelect: noop,
        }
      }),
    },
    { kind: 'separator', id: 'add-input-sep' },
    { id: 'add-input-assets', label: t('generationCommon.quickActions.addInput.fromAssets'), icon: IconFolderOpen as unknown as WorkbenchMenuIcon, onSelect: noop },
    { id: 'add-input-pick', label: t('generationCommon.quickActions.addInput.pickOnCanvas'), icon: IconPointer as unknown as WorkbenchMenuIcon, onSelect: noop },
  ]
}

// ── 提案 3：空节点「试试」——所有种类一个组件 ─────────────────────────────────────

export type TryKind = 'image' | 'video' | 'text'
type TryItem = { key: string; icon: GenerationNodeKind | 'write' }

const TRY_ITEMS: Record<TryKind, readonly TryItem[]> = {
  image: [{ key: 'generationCommon.nodeTry.image.text', icon: 'text' }, { key: 'generationCommon.nodeTry.image.reference', icon: 'image' }],
  video: [{ key: 'generationCommon.nodeTry.video.firstFrame', icon: 'image' }, { key: 'generationCommon.nodeTry.video.firstLast', icon: 'image' }, { key: 'generationCommon.nodeTry.video.text', icon: 'text' }],
  text: [{ key: 'generationCommon.nodeTry.text.write', icon: 'write' }, { key: 'generationCommon.nodeTry.text.toImage', icon: 'image' }, { key: 'generationCommon.nodeTry.text.toVideo', icon: 'video' }],
}

/** 「试试」列表：行的长相与 WorkbenchMenu 的项同一套（高 28、圆角、悬停 ink-05），只是摊在卡里。 */
export function NodeTryList({ kind }: { kind: TryKind }): JSX.Element {
  const { t } = useTranslation()
  return (
    <div data-node-try={kind} className="flex min-w-[11rem] flex-col gap-0.5 text-left">
      <span className="px-2 pb-0.5 text-micro text-nomi-ink-40">{t('generationCommon.nodeTry.label')}</span>
      {TRY_ITEMS[kind].map((item) => {
        const Icon = (item.icon === 'write' ? IconWriting : getGenerationNodeIcon(item.icon)) as unknown as (props: { size?: number; stroke?: number }) => JSX.Element
        return (
          <button
            key={item.key}
            type="button"
            className="inline-flex min-h-7 items-center gap-2 rounded-nomi px-2 text-caption text-nomi-ink-80 hover:bg-nomi-ink-05"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Icon size={14} stroke={1.7} />
            <span>{t(item.key)}</span>
          </button>
        )
      })}
    </div>
  )
}

/** 剪辑空态（提案）：只说一句「把视频节点连进来」，给一个「在画布上点选」（与自动引用同一个点选模式）。 */
function ClipEmptyProposal(): JSX.Element {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center gap-3" data-node-try="clip">
      <span className="text-caption text-nomi-ink-60">{t('generationCommon.nodeTry.clip.hint')}</span>
      <WorkbenchButton size="sm" onPointerDown={(event) => event.stopPropagation()}>
        <IconPointer size={14} stroke={1.7} />
        {t('generationCommon.quickActions.addInput.pickOnCanvas')}
      </WorkbenchButton>
    </span>
  )
}

// ── DOM 落笔：等真节点挂好再改（只藏不删，生产 DOM 结构不动）──────────────────────

/** 每帧试一次 `apply`，直到它说「挂好了」；期间按住实验室就绪旗。 */
function useWhenMounted(apply: (() => boolean) | null, deps: readonly unknown[]): void {
  React.useLayoutEffect(() => {
    if (!apply) return undefined
    const release = holdDesignLabReady('canvas-handles:dom')
    let frame = 0
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      if (apply()) { requestAnimationFrame(() => requestAnimationFrame(release)); return }
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => { cancelled = true; cancelAnimationFrame(frame); release() }
  }, deps)
}

const nodeEl = (root: HTMLElement | null, id: string): HTMLElement | null =>
  root?.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`) ?? null
const handleEl = (root: HTMLElement | null, id: string, side: 'left' | 'right'): HTMLElement | null =>
  nodeEl(root, id)?.querySelector<HTMLElement>(`.generation-canvas-react-flow__handle--source[data-side="${side}"]`) ?? null

// ── 节点取景台 ────────────────────────────────────────────────────────────────

export type HandlesStageProps = {
  locale?: LabLocale
  nodes: GenerationCanvasNode[]
  selectedId?: string
  /** true = 按提案画（只在接得上的一侧有拉环、空节点换成「试试」）；false = 现役原样，做对照。 */
  proposal?: boolean
  /** 点一下选中卡这一侧的「+」之后的样子。 */
  menu?: 'left' | 'right'
  width?: number
  height?: number
}

export function HandlesStage({ locale = 'zh-CN', nodes, selectedId, proposal = true, menu, width = CANVAS_HANDLES_CELL_WIDTH, height = CANVAS_HANDLES_CELL_HEIGHT }: HandlesStageProps): JSX.Element {
  React.useMemo(() => installCatalogBridge(), [])
  const { t } = useTranslation()
  const localeReady = useLabLocale(locale)
  const [chunkReady, setChunkReady] = React.useState(false)
  React.useEffect(() => {
    const release = holdDesignLabReady('canvas-handles:composer')
    void COMPOSER_CHUNK.then(() => { setChunkReady(true); release() })
    return release
  }, [])
  const [seeded, setSeeded] = React.useState(false)
  React.useLayoutEffect(() => {
    useWorkbenchStore.setState({ activeCategoryId: 'shots' })
    const zh = locale === 'zh-CN'
    useGenerationCanvasStore.setState({ nodes: nodes.map((node) => ({ ...node, title: node.title || (zh ? TITLES[node.id]?.[0] : TITLES[node.id]?.[1]) || '' })), edges: [], selectedNodeIds: selectedId ? [selectedId] : [] })
    setSeeded(true)
  }, [locale, nodes, selectedId])
  const liveNodes = useGenerationCanvasStore((state) => state.nodes)
  const selectedIds = React.useMemo(() => new Set(selectedId ? [selectedId] : []), [selectedId])
  const flowNodes = React.useMemo(() => toGenerationFlowNodes(liveNodes, selectedIds, false), [liveNodes, selectedIds])
  const ready = seeded && localeReady && chunkReady

  const rootRef = React.useRef<HTMLDivElement>(null)
  const [tryMounts, setTryMounts] = React.useState<{ id: string; el: HTMLElement; kind: TryKind | 'clip' }[]>([])
  const [menuPoint, setMenuPoint] = React.useState<{ x: number; y: number } | null>(null)

  useWhenMounted(ready ? () => {
    const root = rootRef.current
    if (!root) return false
    if (nodes.some((node) => !nodeEl(root, node.id))) return false
    const mounts: { id: string; el: HTMLElement; kind: TryKind | 'clip' }[] = []
    for (const node of nodes) {
      if (proposal) {
        const sides = connectionSides(node)
        for (const side of ['left', 'right'] as const) {
          const handle = handleEl(root, node.id, side)
          if (handle && !sides[side]) handle.style.visibility = 'hidden'
        }
      }
      if (!proposal || node.result) continue
      if (node.kind === 'clip') {
        const hint = [...nodeEl(root, node.id)!.querySelectorAll<HTMLElement>('div')].find((el) => el.textContent === t('generationCommon.nodeEmpty.clip.description'))
        if (!hint) return false
        if (!hint.querySelector('[data-try-mount]')) {
          hint.textContent = ''
          const mount = document.createElement('span')
          mount.dataset.tryMount = 'true'
          hint.appendChild(mount)
          mounts.push({ id: node.id, el: mount, kind: 'clip' })
        }
        continue
      }
      const empty = nodeEl(root, node.id)!.querySelector<HTMLElement>('[data-node-empty-state]')
      if (!empty) return false
      const kind: TryKind | null = node.kind === 'image' || node.kind === 'video' || node.kind === 'text' ? node.kind : null
      if (!kind || empty.querySelector('[data-try-mount]')) continue
      // 「试试」替换那一句说明，不叠加：标题 + 说明那两行藏掉（种类卡框外标签行和图标已经说了），列表挂进同一个空态的 action 位。
      const words = empty.querySelector<HTMLElement>(':scope > span:nth-child(2)')
      if (words) words.style.display = 'none'
      const mount = document.createElement('div')
      mount.dataset.tryMount = 'true'
      mount.className = 'pt-1'
      empty.appendChild(mount)
      mounts.push({ id: node.id, el: mount, kind })
    }
    setTryMounts(mounts)
    if (menu && selectedId) {
      const icon = handleEl(root, selectedId, menu)?.querySelector('.generation-canvas-react-flow__handle-icon')?.getBoundingClientRect()
      if (!icon || icon.width === 0) return false
      // 菜单锚在圈旁：左上角贴「+」圈的左下，往下开（左右两边同一个锚法）。
      setMenuPoint({ x: icon.left, y: icon.bottom + 6 })
    }
    return true
  } : null, [ready, proposal, menu, selectedId, nodes])

  const selectedNode = nodes.find((node) => node.id === selectedId)
  return (
    <div
      ref={rootRef}
      data-design-lab-stage="canvas-handles"
      className="relative overflow-hidden rounded-nomi border border-nomi-line"
      style={{ width, height }}
    >
      {ready ? (
        <ReactFlowProvider>
          <div className="generation-canvas-react-flow generation-canvas-v2__stage group/canvas relative h-full w-full bg-workbench-bg text-workbench-ink">
            <ReactFlow
              nodes={flowNodes}
              edges={[]}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              defaultViewport={{ x: 0, y: 0, zoom: 1 }}
              nodesDraggable={false}
              panOnDrag={false}
              zoomOnScroll={false}
              zoomOnDoubleClick={false}
              elevateNodesOnSelect={false}
              proOptions={{ hideAttribution: true }}
            />
          </div>
        </ReactFlowProvider>
      ) : null}
      {tryMounts.map((mount) => createPortal(mount.kind === 'clip' ? <ClipEmptyProposal /> : <NodeTryList kind={mount.kind} />, mount.el, mount.id))}
      {menuPoint && selectedNode && menu === 'right' ? (
        <NodeDeriveMenu verdicts={connectionCreateVerdictsForSource(selectedNode, NODE_DERIVE_KINDS)} point={menuPoint} onPick={noop} onClose={noop} />
      ) : null}
      {menuPoint && selectedNode && menu === 'left' ? (
        <WorkbenchMenu
          open
          onOpenChange={noop}
          point={menuPoint}
          items={buildAddInputMenuItems(selectedNode, t)}
          ariaLabel={t('generationCommon.quickActions.addInput.title')}
          data-testid="node-add-input-menu"
        />
      ) : null}
    </div>
  )
}

// ── 空画布：现役 GenerationCanvas 本体，只把「说明 + 新建」换成一排任务卡 ─────────────────

type IntentIcon = (props: { size?: number; stroke?: number }) => JSX.Element
const QUICK_ADD = getQuickAddGenerationNodePlugins()

/** 一排任务卡 = 左缘常驻那几样（`canvasResidentAddIntents`，同一张意图表），不新增种类。 */
function EmptyCanvasTasks(): JSX.Element {
  const { t } = useTranslation()
  return (
    <div data-empty-canvas-tasks="true" className="mt-2 flex w-max gap-2">
      {canvasResidentAddIntents().map((intent) => {
        const Icon = (intent.kind ? QUICK_ADD.find((item) => item.kind === intent.kind)?.icon : IconUpload) as unknown as IntentIcon
        const label = intent.kind ? KIND_LABEL(intent.kind, t) : t('canvas.importFileAction')
        return (
          <ActionCard
            key={intent.id}
            icon={<Icon size={18} stroke={1.7} />}
            title={label}
            description=""
            aria-label={intent.kind ? t('canvas.addNode', { type: label }) : label}
            className="h-14 w-auto min-w-[112px] gap-2.5 px-3 [&>span:first-child]:size-8"
          />
        )
      })}
    </div>
  )
}

export function EmptyCanvasStage({ locale = 'zh-CN', proposal = true }: { locale?: LabLocale; proposal?: boolean }): JSX.Element {
  React.useMemo(() => installCatalogBridge(), [])
  const localeReady = useLabLocale(locale)
  const [seeded, setSeeded] = React.useState(false)
  React.useLayoutEffect(() => {
    useWorkbenchStore.setState({ activeCategoryId: 'shots', categoryViewports: { shots: { zoom: 1, offset: { x: 0, y: 0 } } } as never })
    useGenerationCanvasStore.setState({ nodes: [], edges: [], selectedNodeIds: [], isReady: true })
    setSeeded(true)
  }, [])
  const rootRef = React.useRef<HTMLDivElement>(null)
  const [mount, setMount] = React.useState<HTMLElement | null>(null)
  useWhenMounted(seeded && localeReady ? () => {
    const strong = rootRef.current?.querySelector<HTMLElement>('.top-\\[44\\%\\] > strong')
    if (!strong) return false
    if (!proposal) return true
    const box = strong.parentElement!
    for (const child of [...box.children] as HTMLElement[]) if (child !== strong && !child.dataset.tryMount) child.style.display = 'none'
    if (!box.querySelector('[data-try-mount]')) {
      const el = document.createElement('div')
      el.dataset.tryMount = 'true'
      box.appendChild(el)
      setMount(el)
    }
    return true
  } : null, [seeded, localeReady, proposal])
  return (
    <div ref={rootRef} data-design-lab-stage="canvas-handles-empty" className="relative overflow-hidden rounded-nomi border border-nomi-line" style={{ width: CANVAS_HANDLES_CELL_WIDTH, height: CANVAS_HANDLES_CELL_HEIGHT }}>
      {seeded && localeReady ? <GenerationCanvas /> : null}
      {mount ? createPortal(<EmptyCanvasTasks />, mount) : null}
    </div>
  )
}
