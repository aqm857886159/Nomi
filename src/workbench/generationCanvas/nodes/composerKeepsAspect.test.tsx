/**
 * 打开节点（生成框挂载）**不改**节点上的比例（2026-10-22 R-d2-defaults #1）：
 *
 * 以前 NodeParameterControls 有个挂载 effect，按「视频首选 16:9、已连输入全竖 9:16」（用户 2026-07-17）去「纠正」比例，
 * 它不认 Agent 写的值：Agent 写 9:16，一点开节点就变 16:9，之后在节点上点生成发的就是 16:9（报告真组件挂载复现过
 * Kling / Veo 9:16→16:9、Seedance 2.5 21:9→16:9）。现在这条默认只在选模型 / 新卡自动选模型 / 连线三个手势里铺
 * （唯一出处 videoAspectSeed）。这里用 composerMountBudget 同一套 react-reconciler 渲染器真挂 NodeGenerationComposer：
 *   · Agent 落地的节点（真 buildPlannedNodeMeta 造 meta）挂载后 meta 一个字不变；
 *   · Agent 没写比例（档案默认）、旧项目没标记的节点：同样不变；
 *   · 用户手建的新视频卡：挂载时自动选模型那一笔就带上 16:9（有竖图输入则 9:16），仍然最多 1 次 store 写。
 * 同一套渲染器还钉「明确选过」标记的两个用户写口：生成框底栏的比例控件（档案控件 / 目录控件）上选比例，
 * 要记 aspect_ratio_user_set（桩拿到的 props 就是真组件交给底栏的那一套，回调是真的）——连线时用户选过的比例不被产品默认覆盖。
 */
import React, { type JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReactTestRenderer } from '../../ai/v4/testReactRenderer'

/** 真组件交给底栏的那一套：渲染出来的控件，以及用户在控件上选值的两个回调（档案控件 / 目录控件）。 */
type BarProps = {
  renderedControls: Array<{ key: string; binding?: string }>
  onParameterControlChange: (control: unknown, value: string) => void
  onCatalogControlChange: (control: unknown, value: string) => void
}

const probe = vi.hoisted(() => ({
  /** 每一次桌面桥调用（订阅类 on* 不算 IO，单独记）。 */
  io: [] as string[],
  listeners: [] as string[],
  editorRenders: 0,
  editorCreates: 0,
  leafRenders: 0,
  /** 底栏最近一次拿到的 props。 */
  bar: null as unknown as BarProps | null,
}))

vi.mock('../../common/useNomiRichTextEditor', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    useNomiTiptapEditor: () => {
      const created = ReactActual.useRef(false)
      if (!created.current) { created.current = true; probe.editorCreates += 1 }
      probe.editorRenders += 1
      return null
    },
  }
})

// 和真的 react-i18next 一样：同一语言下 t 是同一个引用（每次渲染新建 t 会让依赖它的 effect 每次都重跑）。
const translation = vi.hoisted(() => ({ t: (key: string) => key, i18n: { language: 'zh-CN', resolvedLanguage: 'zh-CN' } }))
vi.mock('react-i18next', async () => ({
  ...(await vi.importActual<typeof import('react-i18next')>('react-i18next')),
  useTranslation: () => translation,
}))

// 画布缩放来自 React Flow 的 transform；这里没有 ReactFlowProvider，钉成 1。
vi.mock('../reactFlow/canvasViewportScale', () => ({ useCanvasLiveZoom: () => 1 }))

// 只把「要真 DOM / Mantine 主题」的纯展示叶子换成计数桩：它们拿到的数据（模型清单、参数、参考槽）全是现役链路算出来的。
vi.mock('./InlineParameterBar', () => ({ default: (props: BarProps) => { probe.leafRenders += 1; probe.bar = props; return null } }))
vi.mock('../../assets/AssetReference', () => ({ default: () => { probe.leafRenders += 1; return null } }))
vi.mock('./NodeEffectRecommendations', () => ({ NodeEffectRecommendations: () => null }))
vi.mock('../../../design/tooltip', () => {
  const pass = ({ children }: { children?: unknown }) => children ?? null
  return { Tooltip: pass, TooltipContent: () => null, TooltipProvider: pass, TooltipTrigger: pass }
})

import NodeGenerationComposer from './NodeGenerationComposer'
import { installComposerBridge, type BridgeAnswers } from './composerBridgeTestUtils'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { selectCanvasNodeById } from '../store/canvasNodeGenerationIndex'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { notifyModelOptionsRefresh } from '../../../config/modelCatalogCache'
import { resetGenerationModelDefaultsForTest } from '../model/generationModelDefaults'
import { toCatalogModelOptions } from '../../../config/modelOptionMappers'
import { buildAgentModelEntries } from '../agent/availableModels'
import { buildModelEntryIndex, buildPlannedNodeMeta } from '../agent/plannedNodeMeta'
import { ASPECT_EXPLICIT_META_KEY } from './aspectExplicit'
import { readNodeAspectRatio } from './aspectRatio'
import { ASPECT_RATIO_META_KEYS } from '../../../../electron/shared/aspectRatioValue'

const VENDORS = [{ key: 'apimart', name: 'APIMart', enabled: true, hasApiKey: true, authType: 'bearer' }]
const usable = { usable: true }
const MODELS = [
  { modelKey: 'gpt-image-2', vendorKey: 'apimart', labelZh: 'GPT Image 2', kind: 'image', enabled: true, published: true, publishedModes: ['text_to_image', 'image_edit'], availability: usable },
  { modelKey: 'kling-v3', vendorKey: 'apimart', labelZh: 'Kling 3.0', kind: 'video', enabled: true, published: true, publishedModes: ['text_to_video', 'image_to_video'], availability: usable },
  { modelKey: 'veo3.1-fast', vendorKey: 'apimart', labelZh: 'Veo 3.1', kind: 'video', enabled: true, published: true, publishedModes: ['text_to_video', 'image_to_video'], availability: usable },
  { modelKey: 'doubao-seedance-2.5', vendorKey: 'apimart', labelZh: 'Seedance 2.5', kind: 'video', enabled: true, published: true, publishedModes: ['text_to_video', 'image_to_video'], availability: usable },
  // 认不出档案的自接模型：画幅控件来自目录自己声明的 video.sizeOptions（目录控件，不是档案控件）。
  { modelKey: 'custom-catalog-video', vendorKey: 'apimart', labelZh: 'Custom Video', kind: 'video', enabled: true, published: true, publishedModes: ['text_to_video', 'image_to_video'], availability: usable, meta: { video: { sizeOptions: ['16:9', '9:16'], defaultSize: '16:9' } } },
]
const HEALTH = { ok: true, counts: { vendors: 1, enabledVendors: 1, models: 2, enabledModels: 2, mappings: 0, enabledMappings: 0, enabledApiKeys: 1 }, byKind: [], issues: [] }
const PROJECTS = [{ id: 'project-a', name: 'A' }, { id: 'project-b', name: 'B' }, { id: 'project-c', name: 'C' }]

/** 每个方法的应答；没登记的方法照样记账、回 undefined。 */
/** 和本文件有关的数据；生成框挂上时都会读的那些口由共用假桥答（composerBridgeTestUtils）。 */
const ANSWERS: BridgeAnswers = {
  'modelCatalog.listVendors': () => VENDORS,
  'modelCatalog.listModels': (params) => MODELS.filter((row) => !(params as { kind?: string } | undefined)?.kind || row.kind === (params as { kind: string }).kind),
  'modelCatalog.health': () => HEALTH,
  'projects.listAsync': async () => PROJECTS,
  'assets.list': async (payload) => ({
    items: [{ id: `${(payload as { projectId: string }).projectId}-a1`, projectId: (payload as { projectId: string }).projectId, name: 'a1.png', createdAt: '2026-10-01', updatedAt: '2026-10-01', data: { relativePath: 'assets/a1.png', mediaType: 'image' } }],
    cursor: null,
  }),
}

const ENTRIES = buildModelEntryIndex(buildAgentModelEntries(toCatalogModelOptions(MODELS as Parameters<typeof toCatalogModelOptions>[0])), ['apimart'])

/**
 * Agent 起草后落到画布的节点 meta：与落地线同一个构造器（buildPlannedNodeMeta）。宿主归一后的候选一定带变体
 * （落地线带上它是 #1288），所以有变体的模型这里也带——否则挂载时「补变体」那一笔写会混进比例的断言里。
 */
function landed(modelKey: string, params: Record<string, unknown>, variantId?: string): Record<string, unknown> {
  const meta = buildPlannedNodeMeta({ modelKey, vendor: 'apimart', params, ...(variantId ? { variantId } : {}) }, ENTRIES)
  if (!meta) throw new Error(`fixture model ${modelKey} is not in the entry index`)
  return meta
}

function videoNode(id: string, meta: Record<string, unknown>): GenerationCanvasNode {
  return { id, kind: 'video', title: id, position: { x: 0, y: 0 }, prompt: '雨夜街口', meta: { ...meta } }
}
const wideRef: GenerationCanvasNode = { id: 'wide', kind: 'image', title: 'wide', position: { x: -400, y: 0 }, meta: { aspect_ratio: '16:9' } }
const tallRef: GenerationCanvasNode = { id: 'tall', kind: 'image', title: 'tall', position: { x: -400, y: 300 }, meta: { aspect_ratio: '9:16' } }

const VISUAL_SIZE = { width: 340, height: 192 }
const noFeedback = (): void => undefined

function Host({ nodeId }: { nodeId: string }): JSX.Element | null {
  const node = useGenerationCanvasStore((state) => selectCanvasNodeById(state, nodeId))
  if (!node) return null
  return <NodeGenerationComposer node={node} visualSize={VISUAL_SIZE} onFeedback={noFeedback} />
}

async function settle(renderer: ReturnType<typeof createReactTestRenderer>): Promise<void> {
  for (let round = 0; round < 8; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    renderer.flushPassiveEffects()
  }
}

function metaOf(nodeId: string): Record<string, unknown> {
  return (useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)?.meta ?? {}) as Record<string, unknown>
}

function orientationOf(nodeId: string): 'landscape' | 'portrait' | 'square' | null {
  const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
  const ratio = node ? readNodeAspectRatio(node) : null
  return ratio === null ? null : ratio > 1 ? 'landscape' : ratio < 1 ? 'portrait' : 'square'
}

describe('打开节点不改比例；新卡的比例默认值在自动选模型那一笔里', () => {
  let renderer: ReturnType<typeof createReactTestRenderer>

  beforeEach(() => {
    installComposerBridge(ANSWERS, probe)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false)
    notifyModelOptionsRefresh('all')
    resetGenerationModelDefaultsForTest()
    renderer = createReactTestRenderer()
  })

  afterEach(() => {
    renderer.close()
    vi.unstubAllGlobals()
  })

  /**
   * 先挂一张无关的**视频**卡把视频模型目录载好（真 App 里点节点那一刻目录早已载入；目录没载入时旧 effect 也不改，
   * 那样测不出它），再挂目标卡。
   */
  async function openNode(target: GenerationCanvasNode, extra: { nodes?: GenerationCanvasNode[]; edges?: GenerationCanvasEdge[] } = {}): Promise<{ before: Record<string, unknown>; writes: number }> {
    const warm = videoNode('warm', landed('kling-v3', {}))
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [wideRef, warm, ...(extra.nodes ?? []), target], edges: extra.edges ?? [], groups: [], selectedNodeIds: [target.id] })
    renderer.render(<Host nodeId="warm" />)
    await settle(renderer)
    renderer.render(null)
    await settle(renderer)
    const before = metaOf(target.id)
    let writes = 0
    const unsubscribe = useGenerationCanvasStore.subscribe(() => { writes += 1 })
    renderer.render(<Host nodeId={target.id} />)
    await settle(renderer)
    unsubscribe()
    return { before, writes }
  }

  it.each([
    ['kling-v3', { aspect_ratio: '9:16' }, undefined],
    ['veo3.1-fast', { aspect_ratio: '9:16' }, 'fast'],
    ['doubao-seedance-2.5', { aspect_ratio: '21:9' }, undefined],
  ] as const)('报告的格：Agent 落地的 %s %o，打开后 meta 一个字不变', async (modelKey, params, variantId) => {
    const meta = landed(modelKey, params, variantId)
    expect(ASPECT_RATIO_META_KEYS.some((key) => meta[key] === params.aspect_ratio), '落地节点就是 Agent 写的比例').toBe(true)
    const { before } = await openNode(videoNode('shot', meta))
    expect(metaOf('shot')).toEqual(before)
  })

  it('Agent 没写比例（落地 = 档案默认）：打开后不改', async () => {
    const { before } = await openNode(videoNode('shot', landed('doubao-seedance-2.5', {})))
    expect(before[ASPECT_EXPLICIT_META_KEY]).toBeUndefined()
    expect(metaOf('shot')).toEqual(before)
  })

  it('旧项目里没有「明确选过」标记、比例不是 16:9 的节点：打开后不改', async () => {
    const legacy = landed('kling-v3', { aspect_ratio: '9:16' })
    delete legacy[ASPECT_EXPLICIT_META_KEY]
    const { before } = await openNode(videoNode('shot', legacy))
    expect(metaOf('shot')).toEqual(before)
  })

  it('用户手建的新视频卡（没有输入）：自动选模型那一笔就是 16:9，最多 1 次 store 写', async () => {
    const { writes } = await openNode(videoNode('shot', {}))
    expect(metaOf('shot').modelKey).toBeTruthy()
    expect(orientationOf('shot')).toBe('landscape')
    expect(writes).toBeLessThanOrEqual(1)
  })

  it('新视频卡建的时候已经连着竖图：自动选模型那一笔就是 9:16', async () => {
    await openNode(videoNode('shot', {}), { nodes: [tallRef], edges: [{ id: 'tall-shot', source: 'tall', target: 'shot', mode: 'reference' }] })
    expect(metaOf('shot').modelKey).toBeTruthy()
    expect(orientationOf('shot')).toBe('portrait')
  })

  // 「明确选过」标记在生成框里的两个写口：用户在底栏比例控件上选值。标记是「用户选的比例连线时不被产品默认覆盖」的唯一防线，
  // 写口必须有测试钉住（V-ratio 阻断 2）。选完再连一张横图：没记标记的节点会被 07-17 规则改回 16:9，记了的不动。
  it('档案控件（Kling 的 aspect_ratio）上选 9:16 → 记明确选过；之后连一张横图，比例仍是 9:16', async () => {
    await openNode(videoNode('shot', landed('kling-v3', {})))
    expect(metaOf('shot')[ASPECT_EXPLICIT_META_KEY]).toBeUndefined()
    expect(orientationOf('shot')).toBe('landscape')
    const bar = probe.bar!
    const control = bar.renderedControls.find((candidate) => candidate.key === 'aspect_ratio')
    expect(control, '底栏渲染出了档案的比例控件').toBeTruthy()
    bar.onParameterControlChange(control, '9:16')
    await settle(renderer)
    expect(metaOf('shot')[ASPECT_EXPLICIT_META_KEY]).toBe(true)
    expect(orientationOf('shot')).toBe('portrait')
    useGenerationCanvasStore.getState().connectNodes('wide', 'shot')
    expect(useGenerationCanvasStore.getState().edges.map((edge) => edge.source)).toEqual(['wide'])
    expect(orientationOf('shot')).toBe('portrait')
  })

  it('目录控件（自接模型目录声明的画幅）上选 9:16 → 记明确选过；之后连一张横图，比例仍是 9:16', async () => {
    await openNode(videoNode('shot', {
      modelKey: 'custom-catalog-video', modelVendor: 'apimart', vendor: 'apimart', modelLabel: 'Custom Video', aspect_ratio: '16:9',
    }))
    expect(metaOf('shot')[ASPECT_EXPLICIT_META_KEY]).toBeUndefined()
    const bar = probe.bar!
    const control = bar.renderedControls.find((candidate) => candidate.binding === 'size')
    expect(control, '底栏渲染出了目录的画幅控件').toBeTruthy()
    bar.onCatalogControlChange(control, '9:16')
    await settle(renderer)
    expect(metaOf('shot')[ASPECT_EXPLICIT_META_KEY]).toBe(true)
    expect(orientationOf('shot')).toBe('portrait')
    useGenerationCanvasStore.getState().connectNodes('wide', 'shot')
    expect(useGenerationCanvasStore.getState().edges.map((edge) => edge.source)).toEqual(['wide'])
    expect(orientationOf('shot')).toBe('portrait')
  })
})
