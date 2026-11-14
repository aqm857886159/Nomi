// 连线手势铺视频比例默认值（用户 2026-07-17 规则 + 2026-10-22 Q2 拍板）：
//   连线那一刻算（单连 / 多选成组连 / 组连线 / 节点进组物化 / 进程内 Agent 连线 / 外部 MCP 连线，全是同一个手势），
//   只改没被明确选过比例的视频节点，一次 ⌘Z 连同连线一起撤；用户选过的、Agent / 分镜写过的不改；断线、删上游不回头改。
// 模型目录只种最外面那次取数（seedModelCatalogForTests，按生成方式各种一份，和真目录一样），认档案 / 算控件 / 写 meta 全走现役代码。
import { beforeEach, describe, expect, it } from 'vitest'
import { useGenerationCanvasStore, __resetGenerationCanvasHistoryForTests } from './generationCanvasStore'
import type { GenerationCanvasEdge, GenerationCanvasEdgeMode, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { peekCatalogModelOptions, seedModelCatalogForTests } from '../../../config/modelCatalogCache'
import { toCatalogModelOptions } from '../../../config/modelOptionMappers'
import { APIMART_VIDEO_MODELS } from '../../../../electron/catalog/apimartVideos'
import { RUNWAY_OFFICIAL_MODELS } from '../../../../electron/catalog/runwayOfficial'
import { buildAgentModelEntries } from '../agent/availableModels'
import { buildModelEntryIndex, buildPlannedNodeMeta } from '../agent/plannedNodeMeta'
import { peekGenerationNodeModelOptions } from '../adapters/modelOptionsAdapter'
import { ASPECT_EXPLICIT_META_KEY } from '../nodes/aspectExplicit'
import { readNodeAspectRatio } from '../nodes/aspectRatio'
import { normalizeAspectRatioToWH } from '../../../../electron/shared/aspectRatioValue'
import { archetypeForNode } from '../agent/referenceEdgeCapability'
import { effectiveArchetypeMode } from '../nodes/controls/archetypeMeta'

// Kling 3.0：图连进来按「参考」边收（比例规则只看首帧 / 尾帧 / 参考三种输入，角色参考不算——2026-07-17 规则原样）。
const KLING = 'kling-v3'
// Seedance 2.5：比例控件叫 size、档案默认 adaptive；图连进来走全能参考的角色槽（character_ref 边）。
const SEEDANCE = 'doubao-seedance-2.5'
// 只发布「图生视频」的两个模型（目录种子里只有一条 image_to_video 映射，下面「前提」那条测试从种子本身核）。
const VIDU = 'viduq3'
const RUNWAY = 'gen4_turbo'
const T2V_ONLY_CATALOG = 't2v-only-catalog'
const H3 = 'MiniMax-H3'

/** 一个模型在目录种子里发布了哪几种生成方式（mapping 的 taskKind）——「只发布图生视频」是从这里算出来的，不手写。 */
const seededModes = (models: readonly { modelKey: string; mappings: readonly { taskKind: string }[] }[], modelKey: string): string[] =>
  [...new Set(models.find((model) => model.modelKey === modelKey)!.mappings.map((mapping) => mapping.taskKind))]

type CatalogRows = Parameters<typeof toCatalogModelOptions>[0]
const row = (modelKey: string, vendorKey: string, labelZh: string, publishedModes: string[]) =>
  ({ modelKey, vendorKey, labelZh, kind: 'video', enabled: true, published: true, publishedModes, availability: { usable: true } })
const ROWS = [
  row(KLING, 'apimart', 'Kling 3.0', ['text_to_video', 'image_to_video']),
  row(SEEDANCE, 'apimart', 'Seedance 2.5', ['text_to_video', 'image_to_video']),
  row(VIDU, 'apimart', 'Vidu Q3', seededModes(APIMART_VIDEO_MODELS, VIDU)),
  row(RUNWAY, 'runway', 'Runway Gen-4 Turbo', seededModes(RUNWAY_OFFICIAL_MODELS, RUNWAY)),
  { ...row(T2V_ONLY_CATALOG, 'apimart', 'T2V only catalog fixture', ['text_to_video']), meta: { video: { sizeOptions: ['16:9', '9:16'], defaultSize: '16:9' } } },
  row(H3, 'apimart', 'MiniMax H3', seededModes(APIMART_VIDEO_MODELS, H3)),
]
/** 与真目录同一个筛法（electron 给的 publishedModes 里有这种方式的行才进这份清单）。 */
const optionsFor = (mode: string) => toCatalogModelOptions(ROWS.filter((candidate) => candidate.publishedModes.includes(mode)) as CatalogRows)
const HEALTH = { ok: true, counts: { vendors: 2, enabledVendors: 2, models: 4, enabledModels: 4, mappings: 0, enabledMappings: 0, enabledApiKeys: 2 }, byKind: [], issues: [] }
const ENTRIES = buildModelEntryIndex(buildAgentModelEntries(toCatalogModelOptions(ROWS as CatalogRows)), ['apimart', 'runway'])

const state = () => useGenerationCanvasStore.getState()

function image(id: string, aspect: string): GenerationCanvasNode {
  return { id, title: id, kind: 'image', categoryId: 'shots', position: { x: 0, y: 0 }, meta: { aspect_ratio: aspect } }
}

/** 落地 / 手建后已经有模型的视频节点（meta 走落画布同一个构造器）。 */
function video(id: string, params: Record<string, unknown> = {}, modelKey = KLING, vendor = 'apimart'): GenerationCanvasNode {
  const meta = buildPlannedNodeMeta({ modelKey, vendor, params }, ENTRIES)
  if (!meta) throw new Error('fixture model not in the entry index')
  return { id, title: id, kind: 'video', categoryId: 'shots', position: { x: 600, y: 0 }, meta }
}

/** 这次真发的方式（方式按输入现算，节点上存着的只是偏好，2026-11-12）。 */
function sendModeOf(nodeId: string): string {
  const node = state().nodes.find((candidate) => candidate.id === nodeId)!
  return effectiveArchetypeMode(archetypeForNode(node)!, node, { nodes: state().nodes, edges: state().edges }).mode.id
}

function metaOf(nodeId: string): Record<string, unknown> {
  return (state().nodes.find((candidate) => candidate.id === nodeId)?.meta ?? {}) as Record<string, unknown>
}

function aspectOf(nodeId: string): string | null {
  const node = state().nodes.find((candidate) => candidate.id === nodeId)
  const ratio = node ? readNodeAspectRatio(node) : null
  if (!ratio) return null
  return normalizeAspectRatioToWH(ratio > 1 ? '16:9' : ratio < 1 ? '9:16' : '1:1')
}

function connect(sourceId: string, targetId: string, mode?: GenerationCanvasEdgeMode) {
  state().startConnection(sourceId, 'right')
  return state().connectToNode(targetId, mode ? { mode } : undefined)
}

beforeEach(() => {
  __resetGenerationCanvasHistoryForTests()
  seedModelCatalogForTests(HEALTH as Parameters<typeof seedModelCatalogForTests>[0], [
    { kind: 'video', requiredMode: 'text_to_video', options: optionsFor('text_to_video') },
    { kind: 'video', requiredMode: 'image_to_video', options: optionsFor('image_to_video') },
  ])
})

describe('连线那一刻铺视频比例默认值', () => {
  it('前提：没写比例的落地 / 手建节点是 16:9，且没有「明确选过」标记', () => {
    state().restoreSnapshot({ nodes: [video('v')], edges: [], groups: [] })
    expect(aspectOf('v')).toBe('16:9')
    expect(state().nodes[0].meta?.[ASPECT_EXPLICIT_META_KEY]).toBeUndefined()
  })

  it('连进一张竖图 → 9:16；一次 ⌘Z 连线与比例一起撤', () => {
    state().restoreSnapshot({ nodes: [image('tall', '9:16'), video('v')], edges: [], groups: [] })
    const before = state().readDocumentSnapshot()
    expect(connect('tall', 'v')).toMatchObject({ ok: true })
    expect(aspectOf('v')).toBe('9:16')
    state().undo()
    expect(state().readDocumentSnapshot()).toEqual(before)
  })

  it('连进横图 → 16:9（已经是首选，比例键不写）', () => {
    state().restoreSnapshot({ nodes: [image('wide', '16:9'), video('v')], edges: [], groups: [] })
    connect('wide', 'v')
    expect(aspectOf('v')).toBe('16:9')
    expect(state().nodes.find((node) => node.id === 'v')!.meta?.aspect_ratio).toBe('16:9')
  })

  it('横竖混连 → 16:9（只有全竖才 9:16）', () => {
    state().restoreSnapshot({ nodes: [image('tall', '9:16'), image('wide', '16:9'), video('v')], edges: [], groups: [] })
    connect('wide', 'v')
    connect('tall', 'v')
    expect(aspectOf('v')).toBe('16:9')
  })

  it('用户在比例控件上选过 → 连竖图不改', () => {
    const chosen = video('v')
    chosen.meta = { ...chosen.meta, [ASPECT_EXPLICIT_META_KEY]: true }
    state().restoreSnapshot({ nodes: [image('tall', '9:16'), chosen], edges: [], groups: [] })
    connect('tall', 'v')
    expect(aspectOf('v')).toBe('16:9')
  })

  it('Agent / 分镜落地写了合法比例 → 落地即记「明确选过」，连竖图不改', () => {
    const authored = video('v', { aspect_ratio: '16:9' })
    expect(authored.meta?.[ASPECT_EXPLICIT_META_KEY]).toBe(true)
    state().restoreSnapshot({ nodes: [image('tall', '9:16'), authored], edges: [], groups: [] })
    connect('tall', 'v')
    expect(aspectOf('v')).toBe('16:9')
  })

  it('断线、删上游 → 比例不回头改', () => {
    state().restoreSnapshot({ nodes: [image('tall', '9:16'), video('v')], edges: [], groups: [] })
    connect('tall', 'v')
    expect(aspectOf('v')).toBe('9:16')
    state().disconnectEdge(state().edges[0].id)
    expect(state().edges).toHaveLength(0)
    expect(aspectOf('v')).toBe('9:16')
    connect('tall', 'v')
    state().selectNodes(['tall'])
    state().deleteSelectedNodes()
    expect(state().nodes.some((node) => node.id === 'tall')).toBe(false)
    expect(aspectOf('v')).toBe('9:16')
  })

  it('组连线（用户 10-22：和逐张连是同一个手势）：一组竖图连到视频节点 → 9:16，一次 ⌘Z 全撤', () => {
    state().restoreSnapshot({ nodes: [image('tall-a', '9:16'), image('tall-b', '9:16'), video('v')], edges: [], groups: [] })
    const group = state().createGroup('shots', 'refs', { nodeIds: ['tall-a', 'tall-b'] })
    expect(group).toBeTruthy()
    state().startGroupConnection(group!.id, 'right')
    const outcome = state().connectToNode('v')
    expect(outcome).toMatchObject({ ok: true })
    expect(state().edges.length).toBe(2)
    expect(aspectOf('v')).toBe('9:16')
    // 一次 ⌘Z：组连线的边与跟着变的比例一起回去。不比整份快照：建组 + 组连线之后撤一次本来就回不到建组后的整份快照
    // （改前没有任何模型时同样如此，与本条无关）。
    state().undo()
    expect(state().edges).toHaveLength(0)
    expect(aspectOf('v')).toBe('16:9')
  })
})

// 模型清单的取法和生成框一样：按节点**当前生成方式**取。改前这里用的是种类的默认方式（文生视频），
// 只发布「图生视频」的模型在那份清单里找不到，07-17 规则在它们身上连线时静默不生效（V-ratio 阻断 1）。
describe('连线时查模型目录：按节点当前生成方式（只发布「图生视频」的模型）', () => {
  it('前提：Vidu Q3、Runway Gen-4 Turbo 在目录种子里只发布「图生视频」一种方式', () => {
    expect(seededModes(APIMART_VIDEO_MODELS, VIDU)).toEqual(['image_to_video'])
    expect(seededModes(RUNWAY_OFFICIAL_MODELS, RUNWAY)).toEqual(['image_to_video'])
  })

  it('默认（文生视频）那份清单里没有它们；节点此刻（图生视频）要问的那份里有', () => {
    state().restoreSnapshot({ nodes: [video('vidu', {}, VIDU), video('runway', {}, RUNWAY, 'runway')], edges: [], groups: [] })
    const defaults = (peekCatalogModelOptions('video') ?? []).map((option) => option.value)
    expect(defaults).not.toContain(VIDU)
    expect(defaults).not.toContain(RUNWAY)
    for (const [id, modelKey] of [['vidu', VIDU], ['runway', RUNWAY]] as const) {
      const node = state().nodes.find((candidate) => candidate.id === id)!
      expect((peekGenerationNodeModelOptions(node, state()) ?? []).map((option) => option.value)).toContain(modelKey)
    }
  })

  it('节点停在只发布「图生视频」的 Vidu Q3 上，连一张竖图 → 9:16', () => {
    state().restoreSnapshot({ nodes: [image('tall', '9:16'), video('v', {}, VIDU)], edges: [], groups: [] })
    expect(aspectOf('v')).toBe('16:9')
    connect('tall', 'v')
    expect(aspectOf('v')).toBe('9:16')
  })

  it('Runway Gen-4 Turbo 连竖图 → 720:1280，没连图 → 1280:720', () => {
    state().restoreSnapshot({ nodes: [image('tall', '9:16'), video('v', {}, RUNWAY, 'runway')], edges: [], groups: [] })
    expect(metaOf('v').aspect_ratio).toBe('1280:720')
    connect('tall', 'v')
    expect(metaOf('v').aspect_ratio).toBe('720:1280')
    state().restoreSnapshot({ nodes: [video('v', {}, RUNWAY, 'runway')], edges: [], groups: [] })
    expect(metaOf('v').aspect_ratio).toBe('1280:720')
  })

  it('只发布文生视频的目录模型连参考图 → 当前生成方式清单找不到它，不改比例', () => {
    const node: GenerationCanvasNode = {
      id: 't2v-only', title: 't2v-only', kind: 'video', categoryId: 'shots', position: { x: 600, y: 0 },
      meta: { modelKey: T2V_ONLY_CATALOG, modelVendor: 'apimart', vendor: 'apimart', aspect_ratio: '16:9' },
    }
    const source = { ...image('tall', '9:16'), result: { type: 'image' as const, url: 'https://example.com/tall.png' } }
    state().restoreSnapshot({ nodes: [source, node], edges: [], groups: [] })
    const base = state().readDocumentSnapshot()
    state().applyExternalGraph({ base, next: { ...base, edges: [{ id: 'ref', source: 'tall', target: 't2v-only', mode: 'reference' }] } })
    expect(metaOf('t2v-only').aspect_ratio).toBe('16:9')
  })

  it('按连进来的输入现算方式，再按这个方式算比例（M18 顺序）', () => {
    const node = video('h3', {}, H3)
    node.meta = { ...node.meta, archetype: { ...(node.meta?.archetype as Record<string, unknown>), modeId: 'first' } }
    const source: GenerationCanvasNode = {
      id: 'tall', title: 'tall', kind: 'audio', categoryId: 'shots', position: { x: 0, y: 0 },
      meta: { aspect_ratio: '9:16' }, result: { id: 'source-result', type: 'audio', url: 'https://example.com/tall.mp3', createdAt: 0 },
    }
    state().restoreSnapshot({ nodes: [source, node], edges: [], groups: [] })
    expect(connect('tall', 'h3', 'reference')).toMatchObject({ ok: true })
    expect(sendModeOf('h3')).toBe('ref')
    expect(metaOf('h3').aspect_ratio).toBe('9:16')
  })
})

// P2「入口全写成测试」：derive 的每一个调用点各有一条，删掉任何一个调用都红。
describe('每一扇连线入口都经同一个派生口', () => {
  it('进程内 Agent 连线 / 3D 站位 / @提及 / 自动引用（store.connectNodes，不带 mode）：竖图连进视频节点 → 9:16', () => {
    state().restoreSnapshot({ nodes: [image('tall', '9:16'), video('v')], edges: [], groups: [] })
    state().connectNodes('tall', 'v')
    expect(state().edges).toHaveLength(1)
    expect(aspectOf('v')).toBe('9:16')
  })

  it('多选成组连（选中两张竖图，拖线连到视频节点）：两条边、9:16；一次 ⌘Z 回到连线前', () => {
    state().restoreSnapshot({ nodes: [image('tall-a', '9:16'), image('tall-b', '9:16'), video('v')], edges: [], groups: [] })
    const before = state().readDocumentSnapshot()
    state().selectNodes(['tall-a', 'tall-b'])
    expect(connect('tall-a', 'v')).toMatchObject({ ok: true })
    expect(state().edges).toHaveLength(2)
    expect(aspectOf('v')).toBe('9:16')
    state().undo()
    expect(state().readDocumentSnapshot()).toEqual(before)
  })

  it('节点进组物化组连线（组已连着竖图，视频节点进组）：→ 9:16；一次 ⌘Z 边和比例一起回去', () => {
    state().restoreSnapshot({ nodes: [image('tall', '9:16'), image('member', '16:9'), video('v')], edges: [], groups: [] })
    const group = state().createGroup('shots', 'refs', { nodeIds: ['member'] })
    expect(group).toBeTruthy()
    state().startConnection('tall', 'right')
    expect(state().connectToGroup(group!.id)).toMatchObject({ ok: true })
    expect(aspectOf('v')).toBe('16:9') // 还没进组
    state().moveNodeToGroup('v', group!.id)
    expect(state().edges.some((edge) => edge.source === 'tall' && edge.target === 'v' && edge.viaGroupId === group!.id)).toBe(true)
    expect(aspectOf('v')).toBe('9:16')
    state().undo()
    expect(state().edges.some((edge) => edge.target === 'v')).toBe(false)
    expect(aspectOf('v')).toBe('16:9')
  })
})

// 比例规则只数首帧 / 尾帧 / 参考三种输入（判据 nodes/aspectRatio.isAspectInputEdgeMode）。连的是别的边（角色参考……），
// 输入集合没变，不该拿它把一个比例本来是档案默认的节点改成 16:9（V-ratio 建议 2）。
describe('只有新边属于比例规则会数的输入才重算比例', () => {
  it('没写比例的 Seedance 2.5（档案默认 adaptive）连一条角色参考边 → 仍是 adaptive，meta 里不冒出 aspect_ratio', () => {
    state().restoreSnapshot({ nodes: [image('tall', '9:16'), video('s', {}, SEEDANCE)], edges: [], groups: [] })
    expect(metaOf('s').size).toBe('adaptive')
    connect('tall', 's')
    expect(state().edges.map((edge) => edge.mode)).toEqual(['character_ref'])
    expect(metaOf('s').size).toBe('adaptive')
    expect(metaOf('s').aspect_ratio).toBeUndefined()
  })

  // 方式按输入现算（2026-11-12）：一条首帧边按首帧发；APIMart Seedance 2.5 的首帧方式没有比例档（画面跟首帧走），
  // 这一格不该写比例。会数的输入照常重算的那半由 Kling 那几条（参考 / 首帧边都有比例档）守。
  it('同一个 Seedance 2.5 连的是首帧边 → 按首帧发；首帧方式没有比例档，比例跟首帧走、不写', () => {
    state().restoreSnapshot({ nodes: [image('tall', '9:16'), video('s', {}, SEEDANCE)], edges: [], groups: [] })
    connect('tall', 's', 'first_frame')
    expect(state().edges.map((edge) => edge.mode)).toEqual(['first_frame'])
    expect(sendModeOf('s')).toBe('first')
    expect(metaOf('s').aspect_ratio).toBeUndefined()
  })

  it('Kling 3.0 连一条竖图首帧边 → 按首帧发，比例照常按输入重算（9:16）', () => {
    state().restoreSnapshot({ nodes: [image('tall', '9:16'), video('v')], edges: [], groups: [] })
    connect('tall', 'v', 'first_frame')
    expect(sendModeOf('v')).toBe('i2v')
    expect(aspectOf('v')).toBe('9:16')
  })
})

// 外部 MCP 的 connect_canvas_edges / create_canvas_nodes(edges)：主进程算好整张图 → canvas.apply → applyExternalGraph。
// 协调 2026-10-23 裁定：外部 Agent 连线算连线手势，口径同进程内 Agent 连线（新边过总闸后走同一个 deriveTargetAfterConnect）；
// 撤销沿用 applyExternalGraph 现有口径（一次写入一个撤销步）。项目没打开、主进程直接写盘那条路这次不做（见根因合同 residual_risks）。
describe('外部 MCP 连线（applyExternalGraph）', () => {
  const tallToV: GenerationCanvasEdge = { id: 'ext-edge', source: 'tall', target: 'v', mode: 'reference' }

  function externalWrite(edge: GenerationCanvasEdge, restoredEdgeIds?: string[]) {
    const base = state().readDocumentSnapshot()
    state().applyExternalGraph({ base, next: { ...base, edges: [...base.edges, edge] }, ...(restoredEdgeIds ? { restoredEdgeIds } : {}) })
  }

  it('外部写入一条竖图边 → 没明确选过比例的视频节点变 9:16；一次 ⌘Z 边和比例一起回去，重做一起回来', () => {
    state().restoreSnapshot({ nodes: [image('tall', '9:16'), video('v')], edges: [], groups: [] })
    const before = state().readDocumentSnapshot()
    externalWrite(tallToV)
    expect(state().edges.map((edge) => edge.id)).toEqual(['ext-edge'])
    expect(aspectOf('v')).toBe('9:16')
    // 和进程内 Agent 连线同一口径：方式按输入现算（Kling 连了参考 → 图生）。
    expect(sendModeOf('v')).toBe('i2v')
    state().undo()
    expect(state().readDocumentSnapshot()).toEqual(before)
    state().redo()
    expect(state().edges.map((edge) => edge.id)).toEqual(['ext-edge'])
    expect(aspectOf('v')).toBe('9:16')
  })

  it('明确选过比例的视频节点不变', () => {
    const chosen = video('v')
    chosen.meta = { ...chosen.meta, [ASPECT_EXPLICIT_META_KEY]: true }
    state().restoreSnapshot({ nodes: [image('tall', '9:16'), chosen], edges: [], groups: [] })
    externalWrite(tallToV)
    expect(state().edges).toHaveLength(1)
    expect(aspectOf('v')).toBe('16:9')
  })

  it('放回（restoredEdgeIds，撤销一次删除）的边不是连线：比例不动', () => {
    state().restoreSnapshot({ nodes: [image('tall', '9:16'), video('v')], edges: [], groups: [] })
    externalWrite(tallToV, ['ext-edge'])
    expect(state().edges.map((edge) => edge.id)).toEqual(['ext-edge'])
    expect(aspectOf('v')).toBe('16:9')
  })
})
