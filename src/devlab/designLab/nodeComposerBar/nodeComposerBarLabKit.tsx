// 设计实验室 · 屏「画布 · 节点生成浮框底栏」的取景台与夹具。
//
// 这一屏钉的是 2026-09-11 用户拍板、**已经上线**的底栏形态（v1.1）：
//
//   [模型 ▾] [参数 ▾]  │  [🎥] [✦] [✨]  │  [×N ▾] ……… [↑]
//      决定出什么/花多少      帮我写提示词         出几张 / 走
//
//   · A 类（模型 / 参数 chip 只报两个值 / ×N / 生成）留底栏第一段与第三段；
//   · B 类（运镜 / 效果 / 优化）收成中段一簇缩小一号的纯 icon，hover 出名字，运镜已选带激活点；
//   · 锁归位回节点右上浮条（它的作用对象是**这个节点**，不是这一次生成）。
//   方案与删除清单/卡点表：docs/design/2026-09-10-node-composer-bar-v1.md。
//
// 证据强度：**每一格都是现役 `NodeGenerationComposer` 本体**（经 BaseGenerationNode 挂载），
// 排布不是在这里画的——`coverage: 'shell'`。接线之前这一屏有两格 `before` 和六格
// `component-only` 样张；形态一上线，「现状」就是 v1.1 本身，再留一格顶着「现状 · 9 件挤一行」
// 的名字去渲染新底栏，那是一句会骗人的图注，所以同 commit 删掉（P1 加新必删旧）。
//
// 模型目录：实验室没有 Electron 桥，`useModelOptions` 会 catch 成空 → 参数 chip 退化成
// 「配置模型」按钮，整屏就白画了。所以这里按 findReference 那一屏的既有手法装一个**只读桥**，
// 喂真实档案认得的 modelKey（seedance-2 / gpt-image-2），参数 chip 上的两个值因此是档案
// derive 出来的真货（比例 / 时长 / 清晰度），不是在这里手打的一句文案。
import React from 'react'

import BaseGenerationNode from '../../../workbench/generationCanvas/nodes/BaseGenerationNode'
import type { GenerationCanvasNode } from '../../../workbench/generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'

/** 取景框：一格里要同时装下「节点卡 + 它上面的浮条 + 它下面的浮框」，三者的关系才是这一屏要看的东西。 */
export const NODE_COMPOSER_BAR_CELL_WIDTH = 900
export const NODE_COMPOSER_BAR_CELL_HEIGHT = 720

const NODE_WIDTH = 340
const NODE_HEIGHT = 192
const NODE_LEFT = 28
// 节点上方要留出**浮条的位置**（它挂在 bottom-[calc(100%+40px)]）——留少了，
// 「锁回到浮条」这件主张就直接被取景框裁掉，看不见。
const NODE_TOP = 96
export type BarKind = 'video' | 'image'

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
 * 一格 = 现役 BaseGenerationNode + NodeGenerationComposer 本体。三件事同时看：
 *   ① 锁在节点右上浮条（与「复制变体 / 生成记录」同一条）；
 *   ② 提示词区右端一件控件都没有；
 *   ③ 底栏一行三段且不换行：模型/参数 chip（两个值）· 运镜/效果/优化（缩小一号纯 icon，
 *      运镜已选带激活点）· ×N/生成。
 *
 * 刻意不套 `.generation-canvas-v2__stage`：套上会启用 useComposerViewportPlacement 的避让算法
 * （它按**屏幕坐标**算，取景一变位置就变），而这一屏要比的是底栏里有什么、挤不挤，不是浮框
 * 贴在哪一边。省掉它，浮框落在节点正下方的默认位，各格才可比。
 */
export function ComposerBarStage({ kind, cameraPicked = false }: { kind: BarKind; cameraPicked?: boolean }): JSX.Element {
  const fixture = React.useMemo(() => makeBarNode(kind, { cameraPicked }), [kind, cameraPicked])
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
