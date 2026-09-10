// 设计实验室 · 屏「画布 · 节点生成浮框底栏」的取景台与夹具。
//
// 这一屏要回答的问题只有一个（2026-09-10 用户拍板的三类归位）：
//   生成浮框底栏现在挤成一行：图片节点 7 件（锁 / 更多▾ / 模型 / 参数 chip / 优化 / ×N / 生成），
//   视频节点 9 件（再加变体、运镜）。实测卡宽被撑到 768px、参数 chip 截断成「1080p · 16:…」、
//   「运镜 · 推近 中」这句长文字白占一格（证据：composer-bar-before-video.png）。按 §1.5「先分组 → 去重 → 归位 → 最后才收纳」
//   把它拆成三类：A（决定出什么、花多少）· B（帮我写提示词）· 锁。
//
//   v1.1（2026-09-10 21:20 用户看过 v1 后定）：B 簇**不挂在提示词行尾**——挂那儿会让人以为
//   提示词要写到它下面去（用户原话）。改成缩小一号的纯 icon，和 A 类**并进同一条底栏**：
//   `[模型 ▾] [参数 ▾] · [🎥 运镜] [✦ 效果] [✨ 优化] · [×N ▾] [↑]`，提示词区右端一件控件都不留。
//
// 两种格子的证据强度**不一样，且必须说清**（LabState.mirrors 记的就是这件事）：
//   · `before-*`：渲染的是**现役 NodeGenerationComposer 本体**（经 BaseGenerationNode 挂载），
//     底栏那一行是真的，不是照着画的。
//   · `v1-*`：这是**样张**。底栏与参考区仍是现役组件（NodeParameterControls / InlineParameterBar /
//     PromptEditor / NomiSelect / GENERATE_BUTTON_CLASS / ToolbarDivider），**排布**是新的；B 簇那三颗 icon 用的是
//     现役 `WorkbenchIconButton` 原子 + 现役图标，但它们此刻只是触发器外观——真实实现是给
//     NodePromptOptimizer / NodeCameraMoveControl / useNodeEffectChips 的**触发器**换成这个外观，
//     弹层与逻辑一行不动。本分支不接线，故这里不 import 那三个组件的触发器（import 了也仍是带文字的老外观，
//     摆上去等于给用户看一个假的 v1）。
//
// 模型目录：实验室没有 Electron 桥，`useModelOptions` 会 catch 成空 → 参数 chip 退化成
// 「配置模型」按钮，整屏就白画了。所以这里按 findReference 那一屏的既有手法装一个**只读桥**，
// 喂真实档案认得的 modelKey（seedance-2 / gpt-image-2），参数控件因此是档案 derive 出来的真货
// （比例 / 时长 / 清晰度 / 生成音频），不是在这里手打的选项表。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconSparkles, IconVideo } from '@tabler/icons-react'

import {
  NomiLogoMark,
  NomiSelect,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  WorkbenchIconButton,
} from '../../../design'
import { cn } from '../../../utils/cn'
import PromptEditor from '../../../workbench/assets/PromptEditor'
import BaseGenerationNode from '../../../workbench/generationCanvas/nodes/BaseGenerationNode'
import NodeParameterControls from '../../../workbench/generationCanvas/nodes/NodeParameterControls'
import InlineParameterBar from '../../../workbench/generationCanvas/nodes/InlineParameterBar'
import { GENERATE_BUTTON_CLASS } from '../../../workbench/generationCanvas/nodes/nodeComposerStyles'
import { NodeLockBadge } from '../../../workbench/generationCanvas/nodes/NodeLockBadge'
import {
  FloatingToolbarShell,
  ToolbarDivider,
  ToolbarDuplicateVariantButton,
  ToolbarProvenanceButton,
} from '../../../workbench/generationCanvas/nodes/NodeFloatingToolbar'
import {
  GENERATION_VARIANT_COUNTS,
  parseGenerationVariantCount,
  type GenerationVariantCount,
} from '../../../workbench/generationCanvas/nodes/generationVariantCount'
import { resolveRenderedControls } from '../../../workbench/generationCanvas/nodes/nodeModelArchetype'
import {
  catalogControlInitialValue,
  controlInitialValue,
  controlValueToString,
  isParameterControl,
  nodeSelectedModelAddress,
  optionLabel,
  optionValue,
  type DynamicModelControl,
} from '../../../workbench/generationCanvas/nodes/controls/parameterControlModel'
import {
  findModelOptionByIdentifier,
  requiredModeForGenerationNode,
  useGenerationModelOptionsState,
} from '../../../workbench/generationCanvas/adapters/modelOptionsAdapter'
import {
  getGenerationNodePromptPlaceholder,
  isImageLikeGenerationNodeKind,
  isVideoLikeGenerationNodeKind,
} from '../../../workbench/generationCanvas/model/generationNodeKinds'
import type { GenerationCanvasNode } from '../../../workbench/generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import type { CameraMove, CameraSpeed } from '../../../workbench/generationCanvas/nodes/scene3d/cameraMoveVocab'

/** 取景框：一格里要同时装下「节点卡 + 它上面的浮条 + 它下面的浮框」，三者的关系才是这一屏要看的东西。 */
export const NODE_COMPOSER_BAR_CELL_WIDTH = 900
export const NODE_COMPOSER_BAR_CELL_HEIGHT = 720

const NODE_WIDTH = 340
const NODE_HEIGHT = 192
const NODE_LEFT = 28
// 节点上方要留出**浮条的位置**（它挂在 bottom-[calc(100%+40px)]）——留少了，
// v1 的第一件主张「锁回到浮条」就直接被取景框裁掉，看不见。
const NODE_TOP = 96
/** 浮框与节点底边的间距 —— 与现役 composer 的 `floatingComposerLayout().gap` 同一个数。 */
const COMPOSER_GAP = 14
type BarKind = 'video' | 'image'

/**
 * 预热现役 composer 的 lazy chunk。
 *
 * BaseGenerationNode 用 `lazyWithChunkBoundary` 挂 NodeGenerationComposer，而实验室的「就绪旗」
 * （markReady 的两帧 rAF）**不等这个 chunk**——旗举起来了、走查照常截图，截到的是一张只有节点卡、
 * 没有浮框的图。它还是**间歇性**的（chunk 先到就正常），所以不是「等久一点」能解决的东西：
 * 这里把 chunk 变成舞台自己的前置条件，加载完再挂节点，就绪旗自然落在它后面。
 */
const COMPOSER_CHUNK = import('../../../workbench/generationCanvas/nodes/NodeGenerationComposer')

// ── 只读目录桥 ────────────────────────────────────────────────────────────────
// 两个真实存在的档案模型。modelKey 必须是档案认得的串，否则 resolveArchetypeForModel 落空、
// 参数控件退回「flat catalog 解析」——那时屏幕上就没有比例/时长了，而它正是这一屏的主角。
const CATALOG_MODELS = [
  {
    modelKey: 'seedance-2',
    // 别删 alias：现役 useNodeModelAutoSelect 会把节点 meta 的 modelKey 改写成**档案要的请求别名**
    // （seedance-2 → bytedance/seedance-2）。目录行不带这个别名，回头就认不出自己刚选的那个模型，
    // 参数 chip 退化成「选择模型」——真机目录带 alias，夹具也必须带，否则这一格是假的。
    modelAlias: 'bytedance/seedance-2',
    vendorKey: 'apimart',
    labelZh: 'Seedance 2',
    kind: 'video',
    enabled: true,
    published: true,
    publishedModes: ['text_to_video', 'image_to_video'],
    createdAt: '2026-09-10',
    updatedAt: '2026-09-10',
  },
  {
    modelKey: 'gpt-image-2',
    vendorKey: 'apimart',
    labelZh: 'GPT Image 2',
    kind: 'image',
    enabled: true,
    published: true,
    publishedModes: ['text_to_image', 'image_edit'],
    createdAt: '2026-09-10',
    updatedAt: '2026-09-10',
  },
]

const CATALOG_VENDORS = [
  {
    key: 'apimart',
    name: 'APIMart',
    enabled: true,
    hasApiKey: true,
    authType: 'bearer',
    createdAt: '2026-09-10',
    updatedAt: '2026-09-10',
  },
]

function installCatalogBridge(): void {
  ;(window as unknown as { nomiDesktop: unknown }).nomiDesktop = {
    modelCatalog: {
      listVendors: () => CATALOG_VENDORS,
      listModels: (params?: { kind?: string }) =>
        CATALOG_MODELS.filter((model) => !params?.kind || model.kind === params.kind),
      health: () => ({
        ok: true,
        counts: { vendors: 1, enabledVendors: 1, models: CATALOG_MODELS.length, enabledModels: CATALOG_MODELS.length, mappings: 0, enabledMappings: 0, enabledApiKeys: 1 },
        byKind: [],
        issues: [],
      }),
    },
  }
}

// ── 节点夹具 ─────────────────────────────────────────────────────────────────
// meta 里的参数值就是**现役参数控件读的那些键**（controlInitialValue 直接读 meta[control.key]），
// 所以 chip 上的「16:9 · 5s」是从这份夹具 derive 的，不是写死的一句文案。
export function makeBarNode(kind: BarKind, options: { cameraPicked?: boolean; locked?: boolean } = {}): GenerationCanvasNode {
  const shared = {
    id: `composer-bar-${kind}`,
    categoryId: 'shots',
    position: { x: 0, y: 0 },
    size: { width: NODE_WIDTH, height: NODE_HEIGHT },
    status: 'idle' as const,
    locked: options.locked ?? false,
  }
  if (kind === 'video') {
    return {
      ...shared,
      kind: 'video',
      title: '雨夜街口 · 推近',
      prompt: '雨夜的老街口，霓虹倒影铺在积水上，主角撑伞从画面右侧缓步走入。',
      meta: {
        modelKey: 'seedance-2',
        modelVendor: 'apimart',
        aspect_ratio: '16:9',
        duration: 5,
        resolution: '1080p',
        generate_audio: true,
        ...(options.cameraPicked ? { cameraMovePick: { move: 'push_in', speed: 'medium', shot: 'medium' } } : {}),
      },
    } as GenerationCanvasNode
  }
  return {
    ...shared,
    kind: 'image',
    title: '雨夜街口 · 定场',
    prompt: '雨夜老街口的定场画面，霓虹与积水，冷色调，电影感。',
    meta: {
      modelKey: 'gpt-image-2',
      modelVendor: 'apimart',
      aspect_ratio: '16:9',
      resolution: '2K',
    },
  } as GenerationCanvasNode
}

/** 把夹具灌进两个真 store（节点面所有组件都从这里读，不给它们喂 props 假数据）。 */
function useSeededNode(node: GenerationCanvasNode, selected: boolean): GenerationCanvasNode | undefined {
  React.useMemo(() => installCatalogBridge(), [])
  const [chunkReady, setChunkReady] = React.useState(false)
  React.useEffect(() => { void COMPOSER_CHUNK.then(() => setChunkReady(true)) }, [])
  const [ready, setReady] = React.useState(false)
  React.useLayoutEffect(() => {
    useWorkbenchStore.setState({ activeCategoryId: 'shots' })
    useWorkbenchStore.getState().rememberCategoryViewport('shots', { zoom: 1, offset: { x: 0, y: 0 } })
    useGenerationCanvasStore.setState({
      nodes: [node],
      edges: [],
      selectedNodeIds: selected ? [node.id] : [],
    })
    setReady(true)
  }, [node, selected])
  const live = useGenerationCanvasStore((state) => state.nodes.find((candidate) => candidate.id === node.id))
  return ready && chunkReady ? live : undefined
}

// ── A 类：参数 chip 上的「最影响结果 / 价格的两个值」 ─────────────────────────
// 规则本身就是 v1 的主张：视频 = 比例 + 时长，图 = 比例 + 清晰度；其余参数一个不少，
// 仍在这颗 chip 的弹层里。这里按**控件 key**挑，值与文案都从档案 derive（换模型照样说得对），
// 不是在样张里手打「16:9 · 5s」。
const HEADLINE_KEYS: Record<BarKind, readonly string[]> = {
  video: ['aspect_ratio', 'size', 'ratio', 'duration'],
  image: ['aspect_ratio', 'size', 'ratio', 'resolution'],
}

function controlDisplayValue(control: DynamicModelControl, meta: Record<string, unknown>): string {
  if (!isParameterControl(control)) {
    const value = catalogControlInitialValue(control, meta)
    const matched = control.options.find((option) => optionValue(option) === value)
    return matched ? optionLabel(matched) : value
  }
  const value = controlInitialValue(control, meta)
  const matched = control.options.find((option) => controlValueToString(option.value) === value)
  return matched ? matched.label : value
}

function useHeadlineSummary(kind: BarKind, controls: DynamicModelControl[], meta: Record<string, unknown>): string {
  const { t } = useTranslation()
  const wanted = HEADLINE_KEYS[kind]
  return controls
    .filter((control) => wanted.includes(control.key))
    .sort((a, b) => wanted.indexOf(a.key) - wanted.indexOf(b.key))
    .map((control) => {
      const text = controlDisplayValue(control, meta)
      if (!text) return ''
      return control.key === 'duration' ? t('generationCommon.composerBarV1.seconds', { value: text }) : text
    })
    .filter(Boolean)
    .join(' · ')
}

// ── B 簇：底栏中段的三颗纯 icon（v1.1） ──────────────────────────────────────
// v1 把它挂在提示词框右上角，用户看完的判断是「感觉提示词要写到它下面去」——一簇带描边、
// 带阴影的浮层压在输入区上方，读起来像**这个框的表头**，而不是一组工具。v1.1 让它下到底栏、
// 缩到 `WorkbenchIconButton` 的**小号**规格（sm，设计系统里已有的一档，不新造尺寸），
// 用现役 ToolbarDivider 与左右两段分开：视觉重量降到底栏其它控件之下，提示词区回到「只有提示词」。
type ClusterItem = { id: string; icon: JSX.Element; label: string; active?: boolean; openTooltip?: boolean }

function PromptToolCluster({ items, ariaLabel }: { items: ClusterItem[]; ariaLabel: string }): JSX.Element {
  return (
    <TooltipProvider delayDuration={120}>
      <div
        role="group"
        aria-label={ariaLabel}
        data-prompt-tool-cluster="true"
        data-bar-segment="prompt-tools"
        className="inline-flex shrink-0 items-center gap-0.5"
      >
        {items.map((item) => (
          <Tooltip key={item.id} open={item.openTooltip || undefined}>
            <TooltipTrigger asChild>
              <span className="relative inline-flex">
                <WorkbenchIconButton size="sm" icon={item.icon} label={item.label} data-prompt-tool={item.id} />
                {item.active ? (
                  <span
                    aria-hidden
                    data-prompt-tool-active="true"
                    className="pointer-events-none absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-nomi-accent"
                  />
                ) : null}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">{item.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  )
}

function useClusterItems(node: GenerationCanvasNode, kind: BarKind, tooltipFor: string | null): ClusterItem[] {
  const { t } = useTranslation()
  const pick = (node.meta as Record<string, unknown> | undefined)?.cameraMovePick as
    | { move?: CameraMove; speed?: CameraSpeed }
    | undefined
  // 运镜已选时 tooltip 从**已选值**读（与现役芯片 chipSummary 同一口径：运镜 · 速度），未选时只说功能名。
  const cameraLabel = pick?.move && pick?.speed
    ? t('generationCommon.composerBarV1.cameraPicked', {
        move: t(`generationCommon.cameraMove.move.${pick.move}` as 'generationCommon.cameraMove.move.push_in'),
        speed: t(`generationCommon.cameraMove.${pick.speed}` as 'generationCommon.cameraMove.medium'),
      })
    : t('generationCommon.cameraMove.title')
  // 顺序就是 v1.1 那一句：模型和参数在前两个，然后是运镜 / 更多 / 优化。
  // 运镜排头是因为三者里只有它**带状态**（选过就带激活点），状态位紧挨分隔线更容易被扫到。
  const items: ClusterItem[] = []
  if (kind === 'video') {
    items.push({
      id: 'camera-move',
      icon: <IconVideo size={16} stroke={2} />,
      label: cameraLabel,
      active: Boolean(pick?.move),
      openTooltip: tooltipFor === 'camera-move',
    })
  }
  items.push({
    id: 'effects',
    icon: <IconSparkles size={16} stroke={2} />,
    label: t('generationCommon.composerBarV1.effects'),
    openTooltip: tooltipFor === 'effects',
  })
  items.push({
    id: 'optimize',
    icon: <NomiLogoMark size={16} />,
    label: t('generationCommon.optimizer.aria'),
    openTooltip: tooltipFor === 'optimize',
  })
  return items
}

// ── 舞台 ─────────────────────────────────────────────────────────────────────

function StageFrame({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      data-design-lab-stage="node-composer-bar"
      className="workbench-generation__canvas relative overflow-hidden rounded-nomi border border-nomi-line bg-[var(--workbench-surface)]"
      style={{ width: NODE_COMPOSER_BAR_CELL_WIDTH, height: NODE_COMPOSER_BAR_CELL_HEIGHT }}
    >
      {children}
    </div>
  )
}

/**
 * 现状（before）。渲染的是**现役** BaseGenerationNode + NodeGenerationComposer，
 * 底栏那一行 7 件是真的。刻意不套 `.generation-canvas-v2__stage`：套上会启用
 * useComposerViewportPlacement 的避让算法（它按**屏幕坐标**算，取景一变位置就变），
 * 而这一屏要比的是底栏里有什么、挤不挤，不是浮框贴在哪一边。省掉它，浮框落在
 * 节点正下方的默认位（left 0 / top 节点高 + gap），两格 before/after 才可比。
 */
export function ComposerBarBeforeStage({ kind }: { kind: BarKind }): JSX.Element {
  const fixture = React.useMemo(() => makeBarNode(kind), [kind])
  const node = useSeededNode(fixture, true)
  return (
    <StageFrame>
      {node ? (
        <div className="absolute" style={{ left: NODE_LEFT, top: NODE_TOP }}>
          <BaseGenerationNode node={node} selected />
        </div>
      ) : null}
    </StageFrame>
  )
}

/**
 * v1.1 样张。三件事同时看：
 *   ① 锁回到节点右上浮条（与「生成记录 / 复制变体」同一条，现役 FloatingToolbarShell + NodeLockBadge）；
 *   ② 提示词区右端**一件控件都没有**；
 *   ③ 底栏一行三段且**不换行**：模型 / 参数 chip（两个值）· 运镜 / 效果 / 优化（缩小一号纯 icon，
 *      运镜已选带激活点）· ×N / 生成。
 */
export function ComposerBarV1Stage({
  kind,
  cameraPicked = false,
  tooltipFor = null,
}: {
  kind: BarKind
  cameraPicked?: boolean
  tooltipFor?: string | null
}): JSX.Element {
  const fixture = React.useMemo(() => makeBarNode(kind, { cameraPicked }), [kind, cameraPicked])
  const node = useSeededNode(fixture, true)
  return (
    <StageFrame>
      {node ? (
        <div className="absolute" style={{ left: NODE_LEFT, top: NODE_TOP, width: NODE_WIDTH }}>
          {/* ① 锁归位：节点右上浮条。同一条上还站着现役的「复制变体 / 生成记录」，
              让人一眼看出锁是**回到了它的家族**，不是又新开一个角落。 */}
          <div className="relative" style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}>
            <FloatingToolbarShell ariaLabel="node-composer-bar-v1">
              <NodeLockBadge nodeId={node.id} locked={node.locked} selected />
              <ToolbarDivider />
              <ToolbarDuplicateVariantButton nodeId={node.id} />
              <ToolbarProvenanceButton onOpen={() => undefined} />
            </FloatingToolbarShell>
            {/* 节点卡是**占位块**（同 canvas-frame 那一屏的手法）：这一格要看的是浮条与浮框，
                节点内部形态另有它自己的屏，摆一张真卡只会把两件事混在一格里比。 */}
            <div
              aria-hidden
              className="h-full w-full rounded-nomi border border-nomi-line bg-nomi-ink-05 shadow-nomi-sm"
            />
          </div>
          <ComposerBarV1Card node={node} kind={kind} tooltipFor={tooltipFor} />
        </div>
      ) : null}
    </StageFrame>
  )
}

function ComposerBarV1Card({
  node,
  kind,
  tooltipFor,
}: {
  node: GenerationCanvasNode
  kind: BarKind
  tooltipFor: string | null
}): JSX.Element {
  const { t } = useTranslation()
  const [variantCount, setVariantCount] = React.useState<GenerationVariantCount>(1)
  const meta = (node.meta || {}) as Record<string, unknown>
  // 样张里的控件**真的能改东西**：改动写回 store 的这个节点，参数面板改一项、chip 与参考区
  // 立刻跟着变。空 handler 是承诺了做不到的事（check:controls C1），而且用户点开样张想验的
  // 恰恰是「点开 chip 之后那些参数还在不在」。写法与生产同规：先从 store 读最新 meta 再 spread，
  // 不拿闭包里那份旧的（防 lost-update）。
  const patchMeta = React.useCallback((patch: Record<string, unknown>): void => {
    const store = useGenerationCanvasStore.getState()
    const latest = store.nodes.find((candidate) => candidate.id === node.id)?.meta || {}
    store.updateNode(node.id, { meta: { ...latest, ...patch } })
  }, [node.id])
  const requiredMode = requiredModeForGenerationNode(node, { nodes: [node], edges: [] })
  const modelOptions = useGenerationModelOptionsState(node.kind, requiredMode).options
  const address = nodeSelectedModelAddress(meta)
  const selectedModelOption = findModelOptionByIdentifier(modelOptions, address.modelKey, address.vendorKey)
  const controls = resolveRenderedControls(
    selectedModelOption,
    meta,
    isImageLikeGenerationNodeKind(node.kind),
    isVideoLikeGenerationNodeKind(node.kind),
  )
  const headline = useHeadlineSummary(kind, controls, meta)
  const cluster = useClusterItems(node, kind, tooltipFor)

  return (
    <div
      data-composer-bar-v1-card
      // 宽度**内容驱动**，和现役 composer 卡同一套边界（w-max + min/max）——不在样张里挑一个数，
      // 否则「v1 之后卡变窄了多少」就是我选出来的，不是排布算出来的。
      className={cn(
        'relative flex w-max min-w-[360px] max-w-[880px] flex-col gap-1.5 p-3',
        'rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-md',
      )}
      style={{ marginTop: COMPOSER_GAP }}
    >
      {/* 参考区：现役组件，原样不动（本次归位不碰它）。 */}
      <div className="min-h-0 shrink-0 overflow-hidden border-b border-nomi-line-soft pb-1.5">
        <NodeParameterControls node={node} section="references" />
      </div>

      {/* ② 提示词区**只有提示词**（v1.1）。v1 在它右上角摆了 B 簇，用户读出来的是
          「提示词要写到它下面去」——一个浮在输入区上的带框小簇，位置语义压过了功能语义。
          这里既不留净空、也不留占位：这一格要证的就是「右端一件控件都没有」。 */}
      <div data-node-composer-prompt className="min-h-[72px] w-full">
        <PromptEditor
          className="min-h-[72px]"
          value={node.prompt || ''}
          placeholder={getGenerationNodePromptPlaceholder(node.kind)}
          onChange={(next) => useGenerationCanvasStore.getState().updateNode(node.id, { prompt: next })}
        />
      </div>

      {/* ③ 底栏（v1.1）：`[模型 ▾] [参数 ▾] · [🎥][✦][✨] · [×N ▾] [↑]`。
          `flex-nowrap` 是这条的硬承诺——三段全在一行，不换行。 */}
      <div data-composer-bar-v1-actions data-headline={headline} className="mt-auto flex w-full shrink-0 flex-nowrap items-center gap-2 pt-1">
        {/* 第一段 = 现役 InlineParameterBar：模型芯片 + 参数 chip。chip 文案走它**已有的**
            `summaryOverride` 缝（ComfyUI 工作流那一支在用同一个入口），v1 喂进去的是
            「最影响结果/价格的两个值」——不新造第二条摘要通路。点开仍是同一块全参数面板。 */}
        <div data-bar-segment="model-params" className="flex min-w-0 shrink items-center">
          <InlineParameterBar
            modelOptions={modelOptions}
            modelCatalogStatus={{ message: '' }}
            renderedControls={controls}
            selectedModelOption={selectedModelOption}
            archetype={null}
            meta={meta}
            onModelChange={(value, vendor) => patchMeta({ modelKey: value, modelVendor: vendor ?? null })}
            onCatalogControlChange={(control, value) => patchMeta({ [control.key]: value })}
            onParameterControlChange={(control, value) => patchMeta({ [control.key]: value })}
            summaryOverride={headline}
          />
        </div>
        {/* 分段线用现役 ToolbarDivider（节点浮条上的那一根），不另画一根：
            §1.5.3「分段要有名字」在这条一行的带子上只能靠分隔与分组名交代，
            而分隔线在本仓已经有一个 owner 了。 */}
        <ToolbarDivider />
        {/* 第二段 = B 簇：缩小一号的纯 icon，hover 出名字，运镜已选带激活点。 */}
        <PromptToolCluster items={cluster} ariaLabel={t('generationCommon.composerBarV1.promptTools')} />
        <ToolbarDivider />
        {/* 第三段 = 出几张 + 生成。 */}
        <div data-bar-segment="variants" className="flex shrink-0 items-center">
          <NomiSelect
            ariaLabel={t('generationCommon.composer.variantCountAria')}
            title={t('generationCommon.composer.variantCountTitle', { count: variantCount })}
            value={String(variantCount)}
            options={GENERATION_VARIANT_COUNTS.map((count) => ({
              value: String(count),
              label: t('generationCommon.composer.variantCountOption', { count }),
            }))}
            onChange={(value) => setVariantCount(parseGenerationVariantCount(value))}
          />
        </div>
        <button
          type="button"
          data-bar-segment="generate"
          className={cn(GENERATE_BUTTON_CLASS, 'ml-auto')}
          aria-label={t('generationCommon.composer.generateAsset')}
        >
          ↑
        </button>
      </div>
    </div>
  )
}
