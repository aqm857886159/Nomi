// 性质测试：发给供应商的图片 / 视频 / 音频地址 ⊆ 界面上正在用的那些（2026-10-22 线上错花钱热修）。
//
// 复盘：#1269 线的 docs/audit/2026-10-22-composer-reference-slots-direction.md 末节「main 上是否已存在」；
// 设计卡：docs/plan/2026-10-22-reference-leak-hotfix.md。
//
// 串的是生产里真走的那几段，不起界面、不起 Electron、不花钱：
//   界面「在用」  = resolveReferenceSlots（参考区真用的函数）
//   换方式 / 换模型 = applyArchetypeModeSwitch / buildNodeModelChangePatch + ensureArchetypeNodeMeta（main 上的真入口）
//   渲染层发送    = resolveGenerationReferences → buildCatalogTaskRequest
//   主进程        = 和 runtime.runTask 同顺序：assertNoReferenceResidueBeforeSend（拒发）→ applyHeadlessParamDefaults → buildProfileHttpRequest
//                  （通用中转用 NEWAPI_* op，APIMart 用 APIMART_*_MODELS 的 mapping，「内置」用 applyBuiltinSeeds 种下的全部供应商真 mapping）
//
// 两层尺子分开量：
//   ① 模板参数层（buildCatalogTaskRequest → taskTemplateParams，不经主进程剥除）——量的是**渲染层**有没有守住契约；
//      渲染层那步「当前方式没声明的参考键显式置 undefined」被删，这一层立刻红。
//   ② 真请求体（中转 / APIMart / 内置全部供应商）——量的是**最后上线的字节**。
// 主进程拒发（assertNoReferenceResidueBeforeSend，协调 10-22 定）另有一组用例：绕过渲染层、把节点 meta 原样塞进 extras，
// 主进程在花钱之前拒，一个字节都不发；渲染层正常组出来的请求永远不会被拒（全档案 × 每个方式）。
//
// 「哪些键算参考键」不信 GENERIC_REFERENCE_KEYS 自己说的：另做一份普查（bodyReferenceKeyCensus）——内置目录里每条请求体读的
// 每个参数键，减去声明过的非参考参数，剩下的就是请求体实际读的参考键。普查结果必须全在键表里（键表完整性），夹带格也逐个塞图。
// 新请求体多读一个键而没人归类，这里先红（条件 2，2026-10-23）。
//
// 设 NOMI_REFLEAK_REPORT=<文件> 时把每层的漏格数和每格「在用且发出」写进去（修前 / 修后对账用）。
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ModelOption } from '../../../config/models'
import {
  MODEL_ARCHETYPES,
  resolveArchetypeForModel,
  type ArchetypeMode,
  type ModelArchetype,
} from '../../../../electron/shared/modelArchetypes'
import { applyHeadlessParamDefaults, taskTemplateParams } from '../../../../electron/catalog/taskParams'
import { modelReferenceSelection } from '../../../../electron/catalog/modelCatalogListing'
import { findReferenceResidue } from '../../../../electron/catalog/archetypeInput'
import { assertNoReferenceResidueBeforeSend } from '../../../../electron/tasks/referenceResidueGuard'
import { matchNomiErrorCode } from '../../../../electron/shared/nomiErrorCodes'
import { buildProfileHttpRequest } from '../../../../electron/catalog/profileHttpRequest'
import {
  NEWAPI_IMAGE_CREATE_OP,
  NEWAPI_VIDEO_CREATE_OP,
  newapiImageEditProfileForModel,
} from '../../../../electron/catalog/newapiTransport'
import { APIMART_VIDEO_MODELS } from '../../../../electron/catalog/apimartVideos'
import { APIMART_IMAGE_MODELS } from '../../../../electron/catalog/apimartImages'
import { selectTaskMapping, type CatalogState, type HttpOperation, type Model, type Vendor } from '../../../../electron/catalog/types'
import { applyBuiltinSeeds } from '../../../../electron/catalog/seedBuiltins'
import { wireReferencedParamKeys } from '../../../../electron/catalog/paramTranslate'
import { DEFAULT_SLOT_INPUT_KEY } from '../../../../electron/catalog/referenceReachability'
import { ARCHETYPE_WIRE_DEFAULTS } from '../../../../electron/catalog/archetypeWireDefaults.generated'
import { GENERIC_REFERENCE_KEYS } from '../../../../electron/shared/modelArchetypes/referenceKeys'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { createGenerationNode } from '../model/graphOps'
import { buildNodeModelChangePatch } from '../nodes/buildNodeModelChangePatch'
import { applyArchetypeModeSwitch, ensureArchetypeNodeMeta } from '../nodes/controls/archetypeMeta'
import { computeReferenceRowModel } from '../nodes/controls/referenceRowModel'
import { archetypeModeArraySlots, archetypeModeSlots, currentArchetypeMode, referenceSlotStorage } from '../nodes/controls/archetypeMeta'
import { normalizeReferenceListMeta, readParkedReferences } from '../nodes/controls/referenceList'
import { metaWithParkedRestored } from '../nodes/controls/referenceWrites'
import { buildCatalogTaskRequest } from './catalogTaskActions'
import { resolveGenerationReferences } from './generationReferenceResolver'
import { resolveReferencePlacement, resolveReferenceSlots } from './referenceSlots'

const REF = 'nomi-local://ref/'
const img = (name: string) => `${REF}${name}.png`
const imgs = (count: number, prefix = 'u', from = 1) => Array.from({ length: count }, (_, i) => img(`${prefix}${from + i}`))
const vid = (name: string) => `${REF}${name}.mp4`
const aud = (name: string) => `${REF}${name}.mp3`

type Graph = { node: GenerationCanvasNode; nodes: GenerationCanvasNode[]; edges: GenerationCanvasEdge[] }

function nodeKindFor(archetype: ModelArchetype): GenerationCanvasNode['kind'] {
  if (archetype.kind === 'image') return 'image'
  if (archetype.kind === 'audio') return 'audio'
  if (archetype.kind === 'model3d') return 'model3d' as GenerationCanvasNode['kind']
  return 'video'
}

function graphOn(archetype: ModelArchetype, modelKey: string, vendor: string, modeId: string, meta: Record<string, unknown>): Graph {
  const base = createGenerationNode({ id: 'n', kind: nodeKindFor(archetype), prompt: '一个镜头' })
  const node = { ...base, meta: { modelKey, modelVendor: vendor, vendor, archetype: { id: archetype.id, modeId }, ...meta } }
  return { node, nodes: [node], edges: [] }
}

/** 切方式：main 上 NodeParameterControls 走的就是 applyArchetypeModeSwitch（图留在原存储键里）。 */
function switchMode(graph: Graph, archetype: ModelArchetype, modeId: string): Graph {
  const node = { ...graph.node, meta: applyArchetypeModeSwitch(graph.node.meta || {}, archetype, modeId) }
  return { ...graph, node, nodes: graph.nodes.map((n) => (n.id === node.id ? node : n)) }
}

const option = (modelKey: string, vendor: string): ModelOption =>
  ({ value: modelKey, modelKey, vendor, label: modelKey, kind: 'video' } as ModelOption)

/** 换模型：模型菜单的 buildNodeModelChangePatch + 界面 effect 紧接着做的 ensureArchetypeNodeMeta。 */
function swapModel(graph: Graph, toModelKey: string, vendor: string): { graph: Graph; archetype: ModelArchetype } {
  const from = String(graph.node.meta?.modelKey)
  const { meta } = buildNodeModelChangePatch({
    node: graph.node, nodes: graph.nodes, edges: graph.edges,
    modelOptions: [option(from, vendor), option(toModelKey, vendor)], value: toModelKey, vendor,
  })
  const archetype = resolveArchetypeForModel({ modelKey: toModelKey, vendorKey: vendor, meta: {} })!
  const ensured = ensureArchetypeNodeMeta(meta, archetype) ?? meta
  const node = { ...graph.node, meta: ensured }
  return { graph: { ...graph, node, nodes: graph.nodes.map((n) => (n.id === node.id ? node : n)) }, archetype }
}

function inUse(graph: Graph): Set<string> {
  return new Set(resolveReferenceSlots(graph.node, graph.nodes, graph.edges)
    .flatMap((slot) => slot.fills.map((fill) => fill.url).filter((url): url is string => Boolean(url))))
}

/** 生成钮可不可点：当前方式每个必填槽（min ≥ 1）都至少有一张在用。 */
function clickable(graph: Graph, mode: ArchetypeMode): boolean {
  const slots = resolveReferenceSlots(graph.node, graph.nodes, graph.edges)
  return mode.slots.every((declared) => declared.min < 1
    || slots.some((slot) => slot.slotKind === declared.kind && slot.fills.some((fill) => Boolean(fill.url))))
}

function rendererRequest(graph: Graph) {
  const references = resolveGenerationReferences(graph.node, { nodes: graph.nodes, edges: graph.edges })
  return buildCatalogTaskRequest(graph.node, { references }).request
}

/** 一个值里出现的全部参考地址 → 它挂在哪些键下。 */
function urlsIn(root: unknown): Map<string, string[]> {
  const found = new Map<string, string[]>()
  const walk = (value: unknown, key: string) => {
    if (typeof value === 'string') {
      if (value.startsWith(REF)) found.set(value, [...(found.get(value) ?? []), key])
    } else if (Array.isArray(value)) value.forEach((item) => walk(item, key))
    else if (value && typeof value === 'object') Object.entries(value).forEach(([k, item]) => walk(item, key || k))
  }
  if (root && typeof root === 'object' && !Array.isArray(root)) Object.entries(root).forEach(([key, value]) => walk(value, key))
  else walk(root, '')
  return found
}

// ── 传输：和 runtime.runTask 同顺序渲染真请求体 ──────────────────────────────────────

/** 档案指针只在 model.meta 里（与目录行同形）：主进程第一闸 / 第三闸都从连接身份读它，不另传。 */
type Transport = { vendor: Vendor; model: Model; op: HttpOperation | null }

const LOOPBACK = 'http://127.0.0.1:9'

function relayTransport(modelKey: string, archetypeId: string, kind: string): Transport {
  const op = kind === 'text_to_video' || kind === 'image_to_video' ? NEWAPI_VIDEO_CREATE_OP
    : kind === 'text_to_image' ? NEWAPI_IMAGE_CREATE_OP
      : kind === 'image_edit' ? newapiImageEditProfileForModel(modelKey).operation
        : null
  return {
    vendor: { key: 'relay-test', name: 'relay', enabled: true, baseUrlHint: LOOPBACK, authType: 'bearer' } as Vendor,
    model: { modelKey, vendorKey: 'relay-test', labelZh: modelKey, kind: 'video', enabled: true, meta: { archetypeId } } as Model,
    op,
  }
}

type ApimartModel = { modelKey: string; archetypeId: string; mappings: Array<{ taskKind: string; create: HttpOperation; modeId?: string }> }
const APIMART_MODELS: ApimartModel[] = [...APIMART_VIDEO_MODELS, ...APIMART_IMAGE_MODELS] as ApimartModel[]

function apimartTransport(model: ApimartModel, kind: string, modeId: string): Transport {
  const bucket = model.mappings.filter((mapping) => mapping.taskKind === kind)
  const mapping = bucket.find((m) => m.modeId === modeId) ?? bucket.find((m) => !m.modeId) ?? null
  return {
    vendor: { key: 'apimart', name: 'APIMart', enabled: true, baseUrlHint: LOOPBACK, authType: 'bearer' } as Vendor,
    model: { modelKey: model.modelKey, vendorKey: 'apimart', labelZh: model.modelKey, kind: 'video', enabled: true, meta: { archetypeId: model.archetypeId } } as Model,
    op: mapping?.create ?? null,
  }
}

/**
 * 主进程那一段：runTask 里 extras 的处理顺序原样照搬，然后渲染出要发的 HTTP 请求。op 为空 = 这家没有这条路（不发）。
 * 主进程拒发（带着没在用的参考）= 什么都没发 → 返回 null，和「这家没有这条路」一样，一个字节都不上线。
 */
function wire(transport: Transport, request: { kind: string; prompt: string; extras?: Record<string, unknown> }) {
  if (!transport.op) return null
  let guarded: Record<string, unknown> | undefined
  try {
    guarded = assertNoReferenceResidueBeforeSend(structuredClone(request.extras ?? {}) as never, 'property-test') as Record<string, unknown> | undefined
  } catch (error) {
    if (matchNomiErrorCode(String((error as Error).message)) === 'reference-not-in-use') return null
    throw error
  }
  const extras = applyHeadlessParamDefaults(guarded, modelReferenceSelection(transport.vendor.key, transport.model, request.kind),
    transport.op.defaultParams, transport.op.body)
  const built = buildProfileHttpRequest({
    vendor: transport.vendor, model: transport.model, apiKey: 'k',
    request: { ...request, extras } as never, operation: transport.op,
  })
  return { body: built.body, query: built.query, url: built.url, method: built.method, headers: built.headers }
}

// ── 内置目录：applyBuiltinSeeds 种下的全部供应商真 mapping（kie / fal / runway / volcengine / agnes / minimax …）──────────

const SEEDED: CatalogState = applyBuiltinSeeds({ version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} } as unknown as CatalogState, '2026-10-23T00:00:00.000Z').state

/** 和 runtime.findTaskMapping 同一个选择器（selectTaskMapping）：精确模型 > 通用，按方式再挑。找不到 = 这家没有这条路。 */
function seededTransport(modelKey: string, vendorKey: string, archetypeId: string, kind: string, modeId: string): Transport {
  const vendor = SEEDED.vendors.find((candidate) => candidate.key === vendorKey)
  const model = SEEDED.models.find((candidate) => candidate.vendorKey === vendorKey && candidate.modelKey === modelKey)
  const mapping = vendor && model ? selectTaskMapping(SEEDED.mappings, vendorKey, kind as never, modelKey, modeId) : null
  return {
    vendor: { ...(vendor ?? { key: vendorKey, name: vendorKey, enabled: true }), baseUrlHint: LOOPBACK } as Vendor,
    model: (model ?? { modelKey, vendorKey, labelZh: modelKey, kind: 'video', enabled: true, meta: { archetypeId } }) as Model,
    op: mapping?.create ?? null,
  }
}

// ── 请求体实际读的参考键（普查，独立于 GENERIC_REFERENCE_KEYS 的推导）──────────────────────────────────
//
// 内置目录每条 mapping 请求体读的每个参数键（wireReferencedParamKeys：body + 进程 args），先减去**声明过的非参考参数**：
//   档案参数 / vendorParams / fixedParams、档案 wire 默认、mapping defaultParams、paramMap 的 wire 键、进程 fileParams 的 expose 键
//   （物化时一定覆盖）、taskTemplateParams 一定会算出来的键；再减去下面这张台账里「档案没声明的供应商标量」。
// 剩下的就是请求体实际读的参考键。新请求体多读一个键而没人归类 → 键表完整性那条先红：说清它是参考（进档案声明）还是标量（进台账）。

/** 档案没声明、内置请求体里有的供应商标量参数（不是参考素材）。每条写理由；台账不留死条目（下面有一条断言）。 */
const UNDECLARED_SCALAR_BODY_KEYS: Readonly<Record<string, string>> = {
  num_images: 'fal 图片接口的出图张数（整数）；档案没有数量参数',
  bitrate_mode: 'fal Seedance 2.5 的码率档位（枚举，官方默认 standard）',
  enable_safety_checker: 'fal 的安全审查开关（布尔）',
  enable_texture: 'fal hitem3d 是否出贴图（布尔）',
  end_user_id: 'fal Seedance 2.5 的终端用户标识（供应商侧风控用的 id，不是素材）',
  export_format: 'fal hitem3d 的导出格式（枚举）',
  face_count: 'fal hitem3d 的面数（整数）',
  prompt_expansion_mode: 'fal MiniMax H3-Max 的提示词扩写档位（枚举）',
  shading: 'fal hitem3d 的着色方式（枚举）',
  shot_type: 'fal Kling V3 Pro 的镜头类型（枚举）',
}

/** 声明过的非参考参数键（来源见上）。 */
function declaredScalarKeys(): Set<string> {
  // 探针照真实调用带一个连接身份（画布 / headless / 自定义调用 / 音频都带着连接进来）：线上 model 由唯一 owner
  // resolveWireModel 在 taskTemplateParams 最后一步写入，是标量；不带身份的探针拿不到这个键，会把它错归成参考键。
  const keys = new Set<string>(Object.keys(taskTemplateParams({ extras: {} }, { vendorKey: 'census', modelKey: 'census' })))
  for (const archetype of MODEL_ARCHETYPES) {
    for (const mode of archetype.modes) {
      for (const param of mode.params ?? []) keys.add(param.key)
      for (const params of Object.values(mode.vendorParams ?? {})) for (const param of params) keys.add(param.key)
      for (const key of Object.keys(mode.fixedParams ?? {})) keys.add(key)
    }
  }
  for (const byKind of Object.values(ARCHETYPE_WIRE_DEFAULTS)) for (const byVendor of Object.values(byKind)) for (const defaults of Object.values(byVendor)) for (const key of Object.keys(defaults)) keys.add(key)
  for (const mapping of SEEDED.mappings) {
    for (const key of Object.keys(mapping.create.defaultParams ?? {})) keys.add(key)
    for (const rule of mapping.create.paramMap?.rules ?? []) keys.add(rule.wire)
    for (const file of mapping.create.process?.fileParams ?? []) keys.add(file.expose)
  }
  return keys
}

/** 普查：请求体实际读的参考键 → 在哪几条 mapping 里读到（vendor/model/taskKind）。 */
function bodyReferenceKeyCensus(): Map<string, string[]> {
  const scalars = declaredScalarKeys()
  const census = new Map<string, string[]>()
  for (const mapping of SEEDED.mappings) {
    for (const key of wireReferencedParamKeys(mapping.create)) {
      if (scalars.has(key) || key in UNDECLARED_SCALAR_BODY_KEYS) continue
      census.set(key, [...(census.get(key) ?? []), `${mapping.vendorKey}/${mapping.modelKey ?? '*'}/${mapping.taskKind}`])
    }
  }
  return census
}
const REFERENCE_KEY_CENSUS = bodyReferenceKeyCensus()

// ── 格子：每个档案从「放满」起切到它的每个方式 ──────────────────────────────────────

type Start = 'refs' | 'frames' | 'media'
type Cell = { label: string; archetype: ModelArchetype; mode: ArchetypeMode; graph: Graph; modelKey: string }

const slotCap = (mode: ArchetypeMode, kind: string) => {
  const slot = mode.slots.find((s) => s.kind === kind)
  return slot ? Math.min(slot.max ?? 9, 9) : 0
}

function startFor(archetype: ModelArchetype, start: Start): { mode: ArchetypeMode; meta: Record<string, unknown> } | null {
  if (start === 'refs') {
    const mode = [...archetype.modes].sort((a, b) => slotCap(b, 'image_ref') - slotCap(a, 'image_ref'))[0]
    if (!mode || slotCap(mode, 'image_ref') === 0) return null
    return { mode, meta: { referenceImageUrls: imgs(slotCap(mode, 'image_ref')) } }
  }
  if (start === 'frames') {
    const mode = archetype.modes.find((m) => m.slots.some((s) => s.kind === 'first_frame') && m.slots.some((s) => s.kind === 'last_frame'))
    if (!mode) return null
    return { mode, meta: { firstFrameUrl: img('first'), lastFrameUrl: img('last') } }
  }
  const media = (m: ArchetypeMode) => slotCap(m, 'video_ref') + slotCap(m, 'audio_ref') + (m.slots.some((s) => s.kind === 'source_video') ? 1 : 0)
  const mode = [...archetype.modes].sort((a, b) => media(b) - media(a))[0]
  if (!mode || media(mode) === 0) return null
  return {
    mode,
    meta: {
      ...(slotCap(mode, 'image_ref') ? { referenceImageUrls: imgs(slotCap(mode, 'image_ref')) } : {}),
      ...(slotCap(mode, 'video_ref') ? { referenceVideoUrls: Array.from({ length: slotCap(mode, 'video_ref') }, (_, i) => vid(`v${i + 1}`)) } : {}),
      ...(slotCap(mode, 'audio_ref') ? { referenceAudioUrls: Array.from({ length: slotCap(mode, 'audio_ref') }, (_, i) => aud(`a${i + 1}`)) } : {}),
      ...(mode.slots.some((s) => s.kind === 'source_video') ? { sourceVideoUrl: vid('source') } : {}),
    },
  }
}

/**
 * 别名键：MCP canvas.write 的 metadata 原样进 meta、旧工程、参数槽写回都会留下这些键。界面一个都不显示。
 * 只放「请求构造之前没有任何一层会把它们认成当前方式的槽值」的组合：首 / 尾帧别名和 referenceImages /
 * upstreamResultUrls 会被 resolveGenerationReferences 抬成首帧 / 参考（那是另一类问题，见设计卡「残余风险」），
 * 所以只在当前方式**没有**对应槽时放。
 */
/**
 * 普查出来的参考键里，下面那张手列别名之外的（`image_urls`、`first_frame_image`、`image_with_roles`、`video_list`、`mask_url`…）：
 * 每个键塞一张没在用的图，数组形的键塞一个数组。上传图住的那几个键（参考列表 + 旧的按槽存的键 + 视频 / 音频 / 源视频）
 * 是「用户放进来的图」不是夹带，语义另有测试（参考列表那一组），这里不碰。
 */
const UPLOAD_STORAGE_KEYS = new Set([
  'referenceImageUrls', 'firstFrameUrl', 'first_frame_url', 'lastFrameUrl', 'last_frame_url', 'referenceImageUrl', 'referenceImages',
  'sourceVideoUrl', 'referenceVideoUrls', 'referenceAudioUrls',
])
/**
 * 一张没在用的图塞进某个参考键时长什么样。`object`：照这个键真实的值形状造（`image_with_roles` 是 `[{url, role}]`，
 * 火山 content 是 `{type, image_url:{url}, role}`）——MCP metadata 照抄一份 archetypeInput 进 meta 就是这个样子；
 * `plain`：字符串，数组形的键给数组。
 */
function strayValueFor(key: string, tag: string, shape: 'plain' | 'object'): unknown {
  const url = /video/i.test(key) ? vid(`${tag}-${key}`) : /audio|voice/i.test(key) ? aud(`${tag}-${key}`) : img(`${tag}-${key}`)
  if (shape === 'object') {
    if (/with_roles$/.test(key)) return [{ url, role: 'reference_image' }]
    if (/_contents$/.test(key)) return [{ type: 'image_url', image_url: { url }, role: 'reference_image' }]
    if (/_content$/.test(key)) return { type: 'image_url', image_url: { url }, role: 'first_frame' }
  }
  return /(s|_list|_ids)$/.test(key) ? [url] : url
}
/** 普查出来的参考键（上传图住的那几个除外），按这个键真实的值形状各塞一张没在用的图。 */
const CENSUS_STRAY_KEYS = [...REFERENCE_KEY_CENSUS.keys()].filter((key) => !UPLOAD_STORAGE_KEYS.has(key)).sort()
function censusStrayMeta(): Record<string, unknown> {
  return Object.fromEntries(CENSUS_STRAY_KEYS.map((key) => [key, strayValueFor(key, 'census', 'object')]))
}

function aliasMetaFor(mode: ArchetypeMode): Record<string, unknown> {
  const has = (kind: string) => mode.slots.some((slot) => slot.kind === kind)
  return {
    ...censusStrayMeta(),
    image_url: img('alias-image_url'), imageUrl: img('alias-imageUrl'), referenceImageUrl: img('alias-referenceImageUrl'),
    reference_images: [img('alias-reference_images')], reference_image_urls: [img('alias-reference_image_urls')],
    video_url: vid('alias-video_url'), source_video_url: vid('alias-source_video_url'),
    reference_video_urls: [vid('alias-reference_video_urls')], reference_audio_urls: [aud('alias-reference_audio_urls')],
    ...(has('first_frame') ? {} : { first_frame_url: img('alias-first_frame_url') }),
    ...(has('last_frame') ? {} : { last_frame_url: img('alias-last_frame_url') }),
    ...(has('first_frame') || has('image_ref') ? {} : { referenceImages: [img('alias-referenceImages')], upstreamResultUrls: [img('alias-upstream')] }),
    ...(has('source_video') ? {} : { sourceVideoUrl: vid('alias-sourceVideoUrl') }),
    ...(has('video_ref') ? {} : { referenceVideoUrls: [vid('alias-referenceVideoUrls')] }),
    ...(has('audio_ref') ? {} : { referenceAudioUrls: [aud('alias-referenceAudioUrls')] }),
  }
}

function aliasCellsFor(archetypes: Array<{ archetype: ModelArchetype; modelKey: string; vendor: string }>): Cell[] {
  return archetypes.flatMap(({ archetype, modelKey, vendor }) => archetype.modes.map((mode) => ({
    label: `${archetype.id}: aliases@${mode.id}`, archetype, mode, modelKey,
    graph: graphOn(archetype, modelKey, vendor, mode.id, aliasMetaFor(mode)),
  })))
}

function cellsFor(archetypes: Array<{ archetype: ModelArchetype; modelKey: string; vendor: string }>, start: Start): Cell[] {
  const cells: Cell[] = []
  for (const { archetype, modelKey, vendor } of archetypes) {
    const begin = startFor(archetype, start)
    if (!begin) continue
    const graph = graphOn(archetype, modelKey, vendor, begin.mode.id, begin.meta)
    for (const mode of archetype.modes) {
      cells.push({
        label: `${archetype.id}: ${begin.mode.id}→${mode.id}`,
        archetype, mode, modelKey,
        graph: mode.id === begin.mode.id ? graph : switchMode(graph, archetype, mode.id),
      })
    }
  }
  return cells
}

const imageOrVideo = MODEL_ARCHETYPES
  .filter((a) => a.kind === 'video' || a.kind === 'image')
  .map((archetype) => ({ archetype, modelKey: archetype.identifierPatterns[0]!, vendor: 'apimart' }))
const everyArchetype = MODEL_ARCHETYPES.map((archetype) => ({ archetype, modelKey: archetype.identifierPatterns[0]!, vendor: 'apimart' }))
const apimartArchetypes = APIMART_MODELS.flatMap((model) => {
  const archetype = resolveArchetypeForModel({ modelKey: model.modelKey, vendorKey: 'apimart', meta: { archetypeId: model.archetypeId } })
  return archetype && archetype.id === model.archetypeId ? [{ archetype, modelKey: model.modelKey, vendor: 'apimart', model }] : []
})
/** 内置目录里每个认得出档案的视频 / 图片模型行（同一个档案经几家接入就有几行）。 */
const seededArchetypes = SEEDED.models.flatMap((model) => {
  const archetype = resolveArchetypeForModel({ modelKey: model.modelKey, vendorKey: model.vendorKey, meta: model.meta as Record<string, unknown> | undefined })
  return archetype && (archetype.kind === 'video' || archetype.kind === 'image') ? [{ archetype, modelKey: model.modelKey, vendor: model.vendorKey }] : []
})

type Layer = 'params' | 'relay' | 'apimart' | 'seeded' | 'relay-bypass' | 'apimart-bypass' | 'seeded-bypass'

/** 绕过渲染层的入口长什么样：节点 meta 原样进 extras，只带上渲染层那份按当前方式打好的 archetypeInput。 */
function bypassRenderer(graph: Graph, request: ReturnType<typeof rendererRequest>) {
  return { ...request, extras: { ...graph.node.meta, archetypeInput: request.extras?.archetypeInput ?? {} } }
}
/** skipped：内置这一行的请求体渲染不了（进程型 / 本测试不模拟的传输），如实计数，不算过也不算漏。 */
type CellResult = { label: string; leaked: string[]; clickable: boolean; sentInUse: string[]; skipped?: string }

function audit(cells: Cell[], layer: Layer): CellResult[] {
  return cells.map(({ label: cellLabel, archetype, mode, graph, modelKey }) => {
    // 内置目录里同一个档案经几家接入：格名前面带上是哪一家。
    const label = layer.startsWith('seeded') ? `${String(graph.node.meta?.modelVendor)}/${cellLabel}` : cellLabel
    const shown = inUse(graph)
    const built = rendererRequest(graph)
    const request = layer.endsWith('-bypass') ? bypassRenderer(graph, built) : built
    let sent: Map<string, string[]>
    if (layer === 'params') sent = urlsIn(taskTemplateParams(request))
    else if (layer.startsWith('seeded')) {
      const transport = seededTransport(modelKey, String(graph.node.meta?.modelVendor), archetype.id, request.kind, mode.id)
      try {
        sent = urlsIn(wire(transport, request as never))
      } catch (error) {
        return { label, leaked: [], clickable: clickable(graph, mode), sentInUse: [], skipped: String((error as Error).message).slice(0, 80) }
      }
    } else {
      const transport = layer.startsWith('relay')
        ? relayTransport(modelKey, archetype.id, request.kind)
        : apimartTransport(apimartArchetypes.find((entry) => entry.modelKey === modelKey)!.model, request.kind, mode.id)
      try {
        sent = urlsIn(wire(transport, request as never))
      } catch (error) {
        return { label, leaked: [], clickable: clickable(graph, mode), sentInUse: [], skipped: String((error as Error).message).slice(0, 80) }
      }
    }
    const leaked = [...sent].filter(([url]) => !shown.has(url)).map(([url, keys]) => `${url.slice(REF.length)}←${[...new Set(keys)].join(',')}`)
    return { label, leaked, clickable: clickable(graph, mode), sentInUse: [...sent.keys()].filter((url) => shown.has(url)).sort() }
  })
}

/**
 * 主进程这道守逐键量：渲染层组好的（本来就干净、主进程不会拒的）请求，只在**一个**参考键下多夹带一张没在用的图
 * （值按这个键真实的形状造，含对象形），模拟「某个新入口漏清了这一个键」。每格一个键，别的键的拒发遮不住它。
 * 键：请求体直接读的普查键只在这条传输真读它时才量（读不到的键夹带了也上不了线）；主进程翻译读的标准键（不在普查里，
 * 如 imageUrl / referenceImages，会被翻成 image_url / reference_images）每格都量。上传图住的那几个键语义另测，不夹带。
 */
const PER_KEY_UNIVERSE = [...new Set([...CENSUS_STRAY_KEYS, ...[...GENERIC_REFERENCE_KEYS].filter((key) => !UPLOAD_STORAGE_KEYS.has(key))])].sort()
function bypassPerKey(cells: Cell[], family: 'relay' | 'apimart' | 'seeded'): CellResult[] {
  return cells.flatMap(({ label: cellLabel, archetype, mode, graph, modelKey }) => {
    const label = family === 'seeded' ? `${String(graph.node.meta?.modelVendor)}/${cellLabel}` : cellLabel
    const shown = inUse(graph)
    const request = rendererRequest(graph)
    const transport = family === 'relay' ? relayTransport(modelKey, archetype.id, request.kind)
      : family === 'apimart' ? apimartTransport(apimartArchetypes.find((entry) => entry.modelKey === modelKey)!.model, request.kind, mode.id)
        : seededTransport(modelKey, String(graph.node.meta?.modelVendor), archetype.id, request.kind, mode.id)
    if (!transport.op) return []
    const read = new Set(wireReferencedParamKeys(transport.op))
    return PER_KEY_UNIVERSE.filter((key) => read.has(key) || !REFERENCE_KEY_CENSUS.has(key)).map((key): CellResult => {
      const smuggled = { ...request, extras: { ...request.extras, [key]: strayValueFor(key, 'bypass', 'object') } }
      let sent: Map<string, string[]>
      try {
        sent = urlsIn(wire(transport, smuggled as never))
      } catch (error) {
        if (family !== 'seeded') throw error
        return { label: `${label} +${key}`, leaked: [], clickable: clickable(graph, mode), sentInUse: [], skipped: String((error as Error).message).slice(0, 80) }
      }
      const leaked = [...sent].filter(([url]) => !shown.has(url)).map(([url, keys]) => `${url.slice(REF.length)}←${[...new Set(keys)].join(',')}`)
      return { label: `${label} +${key}`, leaked, clickable: clickable(graph, mode), sentInUse: [...sent.keys()].filter((url) => shown.has(url)).sort() }
    })
  })
}

const summary = (results: CellResult[]) => ({
  cells: results.length,
  leakedCells: results.filter((r) => r.leaked.length).length,
  leakedClickable: results.filter((r) => r.leaked.length && r.clickable).length,
})
const leaksOf = (results: CellResult[]) => results.filter((r) => r.leaked.length).map((r) => `${r.label}: ${r.leaked.join(' ')}`)

const LAYERS = {
  'params/refs': () => audit(cellsFor(imageOrVideo, 'refs'), 'params'),
  'params/frames': () => audit(cellsFor(imageOrVideo, 'frames'), 'params'),
  'params/media': () => audit(cellsFor(everyArchetype, 'media'), 'params'),
  'params/aliases': () => audit(aliasCellsFor(everyArchetype), 'params'),
  'relay/aliases': () => audit(aliasCellsFor(imageOrVideo), 'relay'),
  'apimart/aliases': () => audit(aliasCellsFor(apimartArchetypes), 'apimart'),
  'relay/refs': () => audit(cellsFor(imageOrVideo, 'refs'), 'relay'),
  'relay/frames': () => audit(cellsFor(imageOrVideo.filter((a) => a.archetype.kind === 'video'), 'frames'), 'relay'),
  'relay/media': () => audit(cellsFor(imageOrVideo, 'media'), 'relay'),
  'apimart/refs': () => audit(cellsFor(apimartArchetypes, 'refs'), 'apimart'),
  'apimart/frames': () => audit(cellsFor(apimartArchetypes, 'frames'), 'apimart'),
  'apimart/media': () => audit(cellsFor(apimartArchetypes, 'media'), 'apimart'),
  // 主进程这道守单独量：渲染层整个被绕过（MCP / 将来新入口 / 渲染层回归），真请求体照样只有在用的。
  'relay/bypass': () => audit([...cellsFor(imageOrVideo, 'refs'), ...cellsFor(imageOrVideo, 'frames'), ...cellsFor(imageOrVideo, 'media'), ...aliasCellsFor(imageOrVideo)], 'relay-bypass'),
  'apimart/bypass': () => audit([...cellsFor(apimartArchetypes, 'refs'), ...cellsFor(apimartArchetypes, 'frames'), ...cellsFor(apimartArchetypes, 'media'), ...aliasCellsFor(apimartArchetypes)], 'apimart-bypass'),
  // 内置目录全部供应商的真 mapping（验收 r3 第 3 节第 3 条：kie / runninghub / fal / runway / volcengine … 此前只在 params 层量过）。
  'seeded/refs': () => audit(cellsFor(seededArchetypes, 'refs'), 'seeded'),
  'seeded/frames': () => audit(cellsFor(seededArchetypes, 'frames'), 'seeded'),
  'seeded/media': () => audit(cellsFor(seededArchetypes, 'media'), 'seeded'),
  'seeded/aliases': () => audit(aliasCellsFor(seededArchetypes), 'seeded'),
  'seeded/bypass': () => audit([...cellsFor(seededArchetypes, 'refs'), ...cellsFor(seededArchetypes, 'frames'), ...cellsFor(seededArchetypes, 'media'), ...aliasCellsFor(seededArchetypes)], 'seeded-bypass'),
  // 逐键：干净请求只漏清一个参考键（含对象形的值），主进程照样拦住。
  'relay/bypass-per-key': () => bypassPerKey([...cellsFor(imageOrVideo, 'refs'), ...cellsFor(imageOrVideo, 'frames'), ...cellsFor(imageOrVideo, 'media')], 'relay'),
  'apimart/bypass-per-key': () => bypassPerKey([...cellsFor(apimartArchetypes, 'refs'), ...cellsFor(apimartArchetypes, 'frames'), ...cellsFor(apimartArchetypes, 'media')], 'apimart'),
  'seeded/bypass-per-key': () => bypassPerKey([...cellsFor(seededArchetypes, 'refs'), ...cellsFor(seededArchetypes, 'frames'), ...cellsFor(seededArchetypes, 'media')], 'seeded'),
} as const

describe('性质：全部档案 × 每个方式，发出去的 ⊆ 界面在用', () => {
  const results = Object.fromEntries(Object.entries(LAYERS).map(([name, run]) => [name, run()])) as Record<keyof typeof LAYERS, CellResult[]>

  if (process.env.NOMI_REFLEAK_REPORT) {
    writeFileSync(process.env.NOMI_REFLEAK_REPORT, JSON.stringify(Object.fromEntries(Object.entries(results)
      .map(([name, cells]) => [name, { ...summary(cells), leaks: leaksOf(cells), sentInUse: Object.fromEntries(cells.map((c) => [c.label, c.sentInUse])) }])), null, 2))
  }

  it('覆盖面自检：收图档案 ≥ 20、方式格 ≥ 120；首尾帧起点、视频 / 音频起点、APIMart 都跑到了', () => {
    expect(new Set(results['params/refs'].map((r) => r.label.split(':')[0])).size).toBeGreaterThanOrEqual(20)
    expect(results['params/refs'].length).toBeGreaterThanOrEqual(120)
    expect(results['relay/frames'].length).toBeGreaterThanOrEqual(60)
    expect(results['params/media'].length).toBeGreaterThanOrEqual(30)
    expect(results['apimart/refs'].length).toBeGreaterThanOrEqual(40)
  })

  it('覆盖面自检（内置目录）：至少 8 家供应商、20 个档案真渲染出了请求体；渲染不了的只能是少数（理由如实列出）', () => {
    const seeded = [...results['seeded/refs'], ...results['seeded/frames'], ...results['seeded/media'], ...results['seeded/aliases']]
    const rendered = seeded.filter((r) => !r.skipped)
    expect(new Set(rendered.map((r) => r.label.split('/')[0])).size).toBeGreaterThanOrEqual(8)
    expect(new Set(rendered.map((r) => r.label.split('/').slice(1).join('/').split(':')[0])).size).toBeGreaterThanOrEqual(20)
    expect(rendered.length, `渲染不了的格：${[...new Set(seeded.filter((r) => r.skipped).map((r) => r.skipped))].join(' | ')}`).toBeGreaterThan(seeded.length * 0.8)
  })

  it('覆盖面自检（逐键夹带）：每种传输都量到了足够多的「格 × 键」', () => {
    expect(results['relay/bypass-per-key'].length).toBeGreaterThanOrEqual(2000)
    expect(results['apimart/bypass-per-key'].length).toBeGreaterThanOrEqual(800)
    expect(results['seeded/bypass-per-key'].filter((r) => !r.skipped).length).toBeGreaterThanOrEqual(4000)
  })

  it.each(Object.keys(LAYERS) as Array<keyof typeof LAYERS>)('%s：没有一格把界面上没在用的地址发出去', (name) => {
    expect(leaksOf(results[name])).toEqual([])
  })
})

describe('键表完整性：请求体实际读的参考键都在 GENERIC_REFERENCE_KEYS 里（条件 2，2026-10-23）', () => {
  it('普查覆盖面：内置 mapping ≥ 200 条、请求体实际读的参考键 ≥ 40 个', () => {
    expect(SEEDED.mappings.length).toBeGreaterThanOrEqual(200)
    expect(REFERENCE_KEY_CENSUS.size).toBeGreaterThanOrEqual(40)
  })

  it('请求体读的每个参考键都在键表里（渲染层先清、主进程拒发）；漏了的这里点名', () => {
    const missing = [...REFERENCE_KEY_CENSUS].filter(([key]) => !GENERIC_REFERENCE_KEYS.has(key))
      .map(([key, where]) => `${key} ← ${where.slice(0, 2).join(' | ')}${where.length > 2 ? ` (+${where.length - 2})` : ''}`)
    expect(missing).toEqual([])
  })

  it('台账不留死条目：每个「档案没声明的供应商标量」都真有内置请求体在读，且没有被档案声明过', () => {
    const read = new Set(SEEDED.mappings.flatMap((mapping) => wireReferencedParamKeys(mapping.create)))
    const scalars = declaredScalarKeys()
    expect(Object.keys(UNDECLARED_SCALAR_BODY_KEYS).filter((key) => !read.has(key) || scalars.has(key))).toEqual([])
  })

  it('档案声明的参数没有一个落进参考键表（否则渲染层会把真参数清掉、主进程会拒发）', () => {
    const params = new Set(MODEL_ARCHETYPES.flatMap((archetype) => archetype.modes.flatMap((mode) => [
      ...(mode.params ?? []).map((param) => param.key),
      ...Object.values(mode.vendorParams ?? {}).flatMap((list) => list.map((param) => param.key)),
    ])))
    expect([...params].filter((key) => GENERIC_REFERENCE_KEYS.has(key))).toEqual([])
  })

  it('参考槽缺省的 inputKey 都在键表里', () => {
    expect(Object.values(DEFAULT_SLOT_INPUT_KEY).filter((key) => !GENERIC_REFERENCE_KEYS.has(key))).toEqual([])
  })
})

// ── 线上四个场景（复盘表 1a–4）+ 没误伤 ───────────────────────────────────────────────

const archetypeOf = (modelKey: string, vendor = 'apimart') => resolveArchetypeForModel({ modelKey, vendorKey: vendor, meta: {} })!

function bodies(graph: Graph, modelKey = String(graph.node.meta?.modelKey)) {
  const archetype = resolveArchetypeForModel({ modelKey, vendorKey: 'apimart', meta: graph.node.meta })!
  const request = rendererRequest(graph)
  const modeId = (graph.node.meta?.archetype as { modeId?: string } | undefined)?.modeId ?? ''
  const apimart = APIMART_MODELS.find((model) => model.modelKey === modelKey)
  return {
    request,
    relay: wire(relayTransport(modelKey, archetype.id, request.kind), request as never),
    apimart: apimart ? wire(apimartTransport(apimart, request.kind, modeId), request as never) : null,
  }
}
const sentUrls = (built: unknown) => [...urlsIn(built).keys()].sort()

describe('场景 1：放过首帧 / 首尾帧 / 参考图后切到文生，请求里一张图都不带', () => {
  const seedance = archetypeOf('seedance-2')
  it.each([
    ['1a 首帧 1 张', 'first', { firstFrameUrl: img('f') }],
    ['1b 首尾帧 2 张', 'firstlast', { firstFrameUrl: img('f'), lastFrameUrl: img('l') }],
    ['1c 参考 3 张', 'omni', { referenceImageUrls: imgs(3) }],
  ] as const)('%s → 文生视频', (_name, fromMode, meta) => {
    const graph = switchMode(graphOn(seedance, 'seedance-2', 'apimart', fromMode, meta), seedance, 't2v')
    expect(inUse(graph).size).toBe(0)
    const { request, relay } = bodies(graph)
    expect(request.kind).toBe('text_to_video')
    expect(relay!.body).not.toHaveProperty('image')
    expect(sentUrls(relay)).toEqual([])
    expect(sentUrls(taskTemplateParams(request))).toEqual([])
  })

  it('APIMart Seedance 2.0：首尾帧 → 文生，body 不带图', () => {
    const archetype = archetypeOf('doubao-seedance-2.0')
    const graph = switchMode(graphOn(archetype, 'doubao-seedance-2.0', 'apimart', 'firstlast', { firstFrameUrl: img('f'), lastFrameUrl: img('l') }), archetype, 't2v')
    expect(sentUrls(bodies(graph).apimart)).toEqual([])
  })
})

describe('场景 2：参考 3 张切到首尾帧再放帧，APIMart image_urls 只带首、尾帧', () => {
  it('Seedance 2.0（APIMart）', () => {
    const archetype = archetypeOf('doubao-seedance-2.0')
    const switched = switchMode(graphOn(archetype, 'doubao-seedance-2.0', 'apimart', 'omni', { referenceImageUrls: imgs(3) }), archetype, 'firstlast')
    const node = { ...switched.node, meta: { ...switched.node.meta, firstFrameUrl: img('f'), lastFrameUrl: img('l') } }
    const graph = { node, nodes: [node], edges: [] }
    expect([...inUse(graph)].sort()).toEqual([img('f'), img('l')].sort())
    const { apimart, relay } = bodies(graph)
    expect(sentUrls(apimart)).toEqual([img('f'), img('l')].sort())
    expect(sentUrls(relay)).toEqual([img('f')])
  })
})

describe('场景 3：连 3 张图进 Seedance 2.0 首尾帧，参考区说用几张就发几张', () => {
  it('第 1、2 条依次落首帧、尾帧（参考区看得见、照发），第 3 条未用到、不发（用户 10-22 拍板 ⑪）', () => {
    const archetype = archetypeOf('doubao-seedance-2.0')
    const { node } = graphOn(archetype, 'doubao-seedance-2.0', 'apimart', 'firstlast', {})
    const sources = [1, 2, 3].map((i) => ({
      ...createGenerationNode({ id: `s${i}`, kind: 'image' }),
      result: { id: `r${i}`, type: 'image' as const, url: img(`e${i}`), createdAt: 0 },
    }))
    const edges = sources.map((source, order) => ({ id: `edge-${order}`, source: source.id, target: node.id, order })) as unknown as GenerationCanvasEdge[]
    const graph = { node, nodes: [node, ...sources] as GenerationCanvasNode[], edges }
    const shown = inUse(graph)
    const { apimart, relay } = bodies(graph)
    expect(sentUrls(apimart).filter((url) => !shown.has(url))).toEqual([])
    expect(sentUrls(relay).filter((url) => !shown.has(url))).toEqual([])
    expect([...shown].sort()).toEqual([img('e1'), img('e2')])
    expect(sentUrls(apimart)).toEqual([img('e1'), img('e2')])
    const frames = resolveReferenceSlots(graph.node, graph.nodes, graph.edges).map((slot) => [slot.slotKind, slot.fills.map((fill) => fill.url)])
    expect(frames).toEqual([['first_frame', [img('e1')]], ['last_frame', [img('e2')]]])
    expect(resolveGenerationReferences(graph.node, { nodes: graph.nodes, edges: graph.edges })).toMatchObject({ firstFrameUrl: img('e1'), lastFrameUrl: img('e2') })
  })

  it('两条参考连线进首尾帧（拖线不带语义 / character_ref 都一样）：首帧、尾帧各一条', () => {
    const archetype = archetypeOf('seedance-2')
    for (const mode of [undefined, 'reference', 'character_ref'] as const) {
      const { node } = graphOn(archetype, 'seedance-2', 'apimart', 'firstlast', {})
      const sources = [1, 2].map((i) => ({
        ...createGenerationNode({ id: `s${i}`, kind: 'image' }),
        result: { id: `r${i}`, type: 'image' as const, url: img(`m${i}`), createdAt: 0 },
      }))
      const edges = sources.map((source, order) => ({ id: `edge-${order}`, source: source.id, target: node.id, order, ...(mode ? { mode } : {}) })) as unknown as GenerationCanvasEdge[]
      const graph = { node, nodes: [node, ...sources] as GenerationCanvasNode[], edges }
      expect(resolveReferenceSlots(graph.node, graph.nodes, graph.edges).map((slot) => slot.fills.map((fill) => fill.url)), String(mode)).toEqual([[img('m1')], [img('m2')]])
    }
  })
})

describe('场景 4：Seedance 5 张换到 Veo 3.1 / Kling 3.0 / Wan 2.7，按参考挑方式，发出去的只有在用的图', () => {
  it.each(['veo3.1', 'kling-3.0', 'wan2.7'])('→ %s', (toModelKey) => {
    const seedance = archetypeOf('seedance-2')
    const { graph } = swapModel(graphOn(seedance, 'seedance-2', 'apimart', 'omni', { referenceImageUrls: imgs(5) }), toModelKey, 'apimart')
    const shown = inUse(graph)
    const { request, relay } = bodies(graph, toModelKey)
    expect(sentUrls(relay).filter((url) => !shown.has(url))).toEqual([])
    expect(sentUrls(taskTemplateParams(request)).filter((url) => !shown.has(url))).toEqual([])
  })
})

describe('没误伤：当前方式声明了、界面在用的图照常发出', () => {
  it('首帧方式：中转 image = 首帧；APIMart（Hailuo 2.3）first_frame_image = 首帧', () => {
    const seedance = archetypeOf('seedance-2')
    expect(bodies(graphOn(seedance, 'seedance-2', 'apimart', 'first', { firstFrameUrl: img('f') })).relay!.body).toMatchObject({ image: img('f') })
    const hailuo = archetypeOf('MiniMax-Hailuo-2.3')
    const mode = hailuo.modes.find((m) => m.slots.some((s) => s.kind === 'first_frame'))!
    expect(sentUrls(bodies(graphOn(hailuo, 'MiniMax-Hailuo-2.3', 'apimart', mode.id, { firstFrameUrl: img('f') })).apimart)).toEqual([img('f')])
  })

  it('参考方式：APIMart Seedance 2.0 全能参考照发 3 张参考；中转 image = 第 1 张', () => {
    const archetype = archetypeOf('doubao-seedance-2.0')
    const { apimart, relay } = bodies(graphOn(archetype, 'doubao-seedance-2.0', 'apimart', 'omni', { referenceImageUrls: imgs(3) }))
    expect(sentUrls(apimart)).toEqual(imgs(3))
    expect((relay!.body as Record<string, unknown>).image).toBe(imgs(3)[0])
  })

  it('首尾帧方式：APIMart Seedance 2.0 两帧都发；中转 image = 首帧', () => {
    const archetype = archetypeOf('doubao-seedance-2.0')
    const { apimart, relay } = bodies(graphOn(archetype, 'doubao-seedance-2.0', 'apimart', 'firstlast', { firstFrameUrl: img('f'), lastFrameUrl: img('l') }))
    expect(sentUrls(apimart)).toEqual([img('f'), img('l')].sort())
    expect((relay!.body as Record<string, unknown>).image).toBe(img('f'))
  })

  it('改图方式：中转 chat 多模态照带参考图', () => {
    const banana = archetypeOf('nano-banana')
    const { relay } = bodies(graphOn(banana, 'nano-banana', 'apimart', 'edit', { referenceImageUrls: imgs(2) }))
    expect(sentUrls(relay)).toEqual(imgs(2))
  })

  it('参考方式超上限：只发前 max 张（Kling 3.0 图生上限 2）', () => {
    const kling = archetypeOf('kling-3.0')
    const graph = graphOn(kling, 'kling-3.0', 'apimart', 'i2v', { referenceImageUrls: imgs(4) })
    expect([...inUse(graph)].sort()).toEqual(imgs(2))
    expect(sentUrls(taskTemplateParams(rendererRequest(graph)))).toEqual(imgs(2))
  })
})

describe('主进程拒发：绕过渲染层，把节点 meta 原样塞进 extras，主进程在花钱之前拒', () => {
  it('文生方式残留首帧 + 参考：拒发（带机器码 reference-not-in-use），真请求体一个字节都没有', () => {
    const seedance = archetypeOf('seedance-2')
    const graph = graphOn(seedance, 'seedance-2', 'apimart', 't2v', { firstFrameUrl: img('stale'), referenceImageUrls: imgs(2), image_url: img('alias') })
    const request = rendererRequest(graph)
    // 模拟一个不经 buildReferenceExtras 的入口：节点 meta 原样进 extras，只留渲染层那份 archetypeInput。
    const raw = { ...request, extras: { ...graph.node.meta, archetypeInput: request.extras?.archetypeInput ?? {} } }
    expect(findReferenceResidue(raw.extras)).not.toEqual([])
    expect(() => assertNoReferenceResidueBeforeSend(raw.extras as never, 'test')).toThrow(/NOMI_ERR::reference-not-in-use::/)
    expect(wire(relayTransport('seedance-2', seedance.id, 'text_to_video'), raw as never)).toBeNull()
  })

  it('当前方式声明了的值照发（首尾帧方式的两帧不拒、不改）', () => {
    const archetype = archetypeOf('doubao-seedance-2.0')
    const request = rendererRequest(graphOn(archetype, 'doubao-seedance-2.0', 'apimart', 'firstlast', { firstFrameUrl: img('f'), lastFrameUrl: img('l') }))
    expect(assertNoReferenceResidueBeforeSend(structuredClone(request.extras!) as never, 'test')).toEqual(request.extras)
  })

  it('认得每一个请求体实际读的参考键，值是字符串、数组还是对象形（[{url, role}]、火山 content）都认', () => {
    const inUseExtras = { archetypeInput: { image_urls: [img('in-use')], model: 'm' } }
    const missed: string[] = []
    for (const key of [...new Set([...CENSUS_STRAY_KEYS, ...GENERIC_REFERENCE_KEYS])].sort()) {
      for (const shape of ['plain', 'object'] as const) {
        const extras = { ...inUseExtras, [key]: strayValueFor(key, `guard-${shape}`, shape) }
        if (!findReferenceResidue(extras as never).includes(key)) missed.push(`${key}(${shape})`)
      }
    }
    expect(missed).toEqual([])
  })

  it('和在用的是同一张图、或只是在用那几张换了个形状装着：不算残留', () => {
    const extras = {
      archetypeInput: { image_with_roles: [{ url: img('f'), role: 'first_frame' }, { url: img('l'), role: 'last_frame' }] },
      first_frame_image: img('f'), image_urls: [img('f'), img('l')],
      volcengine_first_image_content: { type: 'image_url', image_url: { url: img('f') }, role: 'first_frame' },
    }
    expect(findReferenceResidue(extras as never)).toEqual([])
  })

  it('没有档案投影（ComfyUI / 无档案 / headless 调用方显式给的参考）不查', () => {
    const extras = { referenceImages: imgs(2), firstFrameUrl: img('f'), modelKey: 'x' }
    expect(findReferenceResidue(extras)).toEqual([])
  })

  it('渲染层正常组出来的请求永远不被拒：全部档案 × 每个方式 × 参考 / 首尾帧 / 视频音频 / 别名四种起点', () => {
    const rejected: string[] = []
    for (const cell of [...cellsFor(imageOrVideo, 'refs'), ...cellsFor(imageOrVideo, 'frames'), ...cellsFor(everyArchetype, 'media'), ...aliasCellsFor(everyArchetype)]) {
      const residue = findReferenceResidue((rendererRequest(cell.graph).extras ?? {}) as never)
      if (residue.length) rejected.push(`${cell.label}: ${residue.join(',')}`)
    }
    expect(rejected).toEqual([])
  })
})

// ── 免费抓包：本机假上游（loopback）真收到的请求体 ─────────────────────────────────────
//
// 上面量的是渲染出来的请求；这里把它真的发到 127.0.0.1 上一个只记账的假上游，按**收到的字节**断言：
// 不该带的一张都不带，该带的一张不少（等号断言，两头都管）。设 NOMI_REFLEAK_EVIDENCE_DIR 时把每一份
// 收到的请求体落盘（docs/evidence/2026-10-22-reference-leak-hotfix/ 就是这么来的）。不花钱、不出本机。

type Received = { method: string; path: string; body: unknown }

describe('免费抓包：本机假上游收到的请求体（四个场景 + 没误伤，中转 / APIMart 两种传输）', () => {
  let server: Server
  let base = ''
  const received: Received[] = []
  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        received.push({ method: req.method || '', path: req.url || '', body: raw ? JSON.parse(raw) : null })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ code: 200, data: [{ task_id: 'loopback-task' }], task_id: 'loopback-task' }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  })
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

  async function send(transport: Transport, request: ReturnType<typeof rendererRequest>): Promise<Received | null> {
    const built = wire({ ...transport, vendor: { ...transport.vendor, baseUrlHint: base } }, request as never)
    if (!built) return null
    const before = received.length
    await fetch(built.url, { method: built.method, headers: built.headers, body: JSON.stringify(built.body) })
    return received[before] ?? null
  }

  const seedance = () => archetypeOf('seedance-2')
  const apimartSeedance = () => archetypeOf('doubao-seedance-2.0')
  const hailuo = () => archetypeOf('MiniMax-Hailuo-2.3')
  const withFrames = (graph: Graph): Graph => {
    const node = { ...graph.node, meta: { ...graph.node.meta, firstFrameUrl: img('f'), lastFrameUrl: img('l') } }
    return { node, nodes: [node], edges: [] }
  }
  const threeEdges = (): Graph => {
    const { node } = graphOn(apimartSeedance(), 'doubao-seedance-2.0', 'apimart', 'firstlast', {})
    const sources = [1, 2, 3].map((i) => ({
      ...createGenerationNode({ id: `s${i}`, kind: 'image' }),
      result: { id: `r${i}`, type: 'image' as const, url: img(`e${i}`), createdAt: 0 },
    }))
    const edges = sources.map((source, order) => ({ id: `edge-${order}`, source: source.id, target: node.id, order })) as unknown as GenerationCanvasEdge[]
    return { node, nodes: [node, ...sources] as GenerationCanvasNode[], edges }
  }

  type LoopbackCase = [string, () => Graph, string, string[], string[] | null]
  // [名字, 图, 模型, 中转应收到的地址, APIMart 应收到的地址（null = APIMart 没有这条模型，不发）]
  const CASES: LoopbackCase[] = [
    ['S1a-中转-首帧切文生', () => switchMode(graphOn(seedance(), 'seedance-2', 'apimart', 'first', { firstFrameUrl: img('f') }), seedance(), 't2v'), 'seedance-2', [], null],
    ['S1b-中转-首尾帧切文生', () => switchMode(graphOn(seedance(), 'seedance-2', 'apimart', 'firstlast', { firstFrameUrl: img('f'), lastFrameUrl: img('l') }), seedance(), 't2v'), 'seedance-2', [], null],
    ['S1c-中转-参考3张切文生', () => switchMode(graphOn(seedance(), 'seedance-2', 'apimart', 'omni', { referenceImageUrls: imgs(3) }), seedance(), 't2v'), 'seedance-2', [], null],
    ['S1d-APIMart-首尾帧切文生', () => switchMode(graphOn(apimartSeedance(), 'doubao-seedance-2.0', 'apimart', 'firstlast', { firstFrameUrl: img('f'), lastFrameUrl: img('l') }), apimartSeedance(), 't2v'), 'doubao-seedance-2.0', [], []],
    ['S2-参考3张切首尾帧再放帧', () => withFrames(switchMode(graphOn(apimartSeedance(), 'doubao-seedance-2.0', 'apimart', 'omni', { referenceImageUrls: imgs(3) }), apimartSeedance(), 'firstlast')), 'doubao-seedance-2.0', [img('f')], [img('f'), img('l')].sort()],
    // 用户 10-22 拍板 ⑪：参考类连线和上传一样依次落首帧、尾帧——第 2 条落尾帧（生成前在尾帧格里看得见），第 3 条未用到、不发。
    ['S3-连3张进Seedance2.0首尾帧', threeEdges, 'doubao-seedance-2.0', [img('e1')], [img('e1'), img('e2')]],
    // #1269 参考图结构重写之后：换模型按参考挑方式（不再落文生），新方式在用的图照发——中转视频 body 只有一个 image 位，收第一张。
    ...['veo3.1', 'kling-3.0', 'wan2.7'].map((to): LoopbackCase => [`S4-5张换到${to}`, () => swapModel(graphOn(seedance(), 'seedance-2', 'apimart', 'omni', { referenceImageUrls: imgs(5) }), to, 'apimart').graph, to, [imgs(5)[0]!], null]),
    ['OK1-首帧方式照发首帧', () => graphOn(hailuo(), 'MiniMax-Hailuo-2.3', 'apimart', hailuo().modes.find((m) => m.slots.some((s) => s.kind === 'first_frame'))!.id, { firstFrameUrl: img('f') }), 'MiniMax-Hailuo-2.3', [img('f')], [img('f')]],
    ['OK2-参考方式照发参考数组', () => graphOn(apimartSeedance(), 'doubao-seedance-2.0', 'apimart', 'omni', { referenceImageUrls: imgs(3) }), 'doubao-seedance-2.0', [imgs(3)[0]], imgs(3)],
    ['OK3-首尾帧方式照发两帧', () => graphOn(apimartSeedance(), 'doubao-seedance-2.0', 'apimart', 'firstlast', { firstFrameUrl: img('f'), lastFrameUrl: img('l') }), 'doubao-seedance-2.0', [img('f')], [img('f'), img('l')].sort()],
  ]

  it.each(CASES)('%s', async (name, makeGraph, modelKey, relayExpected, apimartExpected) => {
    const graph = makeGraph()
    const request = rendererRequest(graph)
    const archetype = resolveArchetypeForModel({ modelKey, vendorKey: 'apimart', meta: graph.node.meta })!
    const modeId = (graph.node.meta?.archetype as { modeId?: string } | undefined)?.modeId ?? ''
    const apimart = APIMART_MODELS.find((model) => model.modelKey === modelKey)
    const relayGot = await send(relayTransport(modelKey, archetype.id, request.kind), request)
    const apimartGot = apimart ? await send(apimartTransport(apimart, request.kind, modeId), request) : null
    const dir = process.env.NOMI_REFLEAK_EVIDENCE_DIR
    if (dir) {
      mkdirSync(dir, { recursive: true })
      const shown = [...inUse(graph)].sort()
      for (const [transport, got] of [['relay', relayGot], ['apimart', apimartGot]] as const) {
        if (got) writeFileSync(join(dir, `${name}.${transport}.json`), `${JSON.stringify({ case: name, transport, kind: request.kind, inUse: shown, sent: sentUrls(got.body), received: got }, null, 2)}\n`)
      }
    }
    expect(relayGot).not.toBeNull()
    expect(sentUrls(relayGot!.body)).toEqual(relayExpected)
    if (apimartExpected) {
      expect(apimartGot).not.toBeNull()
      expect(sentUrls(apimartGot!.body)).toEqual(apimartExpected)
    }
  })
})

// ── #1269 参考图结构重写：节点上只存一份有序参考列表，换方式 / 换模型一张不丢 ────────────────────────
// 来历：方向检查 D-b1a-refslots 的特征测试（原 referenceInUseIsSent.characterization.test.ts，10 条 it.fails）。
// 「发出去的 ⊆ 在用」那 7 条与上面的性质 / 场景同一把尺子，并进上面；这里只留另一半性质：在用 ∪ 未用到 = 原来那一份。

/** 参考行淡显「未用到」的图：和 NodeParameterControls 一样，槽值和 unusedUploads 都取 resolveReferencePlacement。 */
function unusedOf(graph: Graph, archetype: ModelArchetype): string[] {
  const meta = graph.node.meta || {}
  const mode = currentArchetypeMode(archetype, meta)
  const placement = resolveReferencePlacement(graph.node, graph.nodes, graph.edges)
  const assetValuesByKey: Record<string, string[]> = {}
  for (const slot of placement.slots) {
    const storage = referenceSlotStorage({ kind: slot.slotKind })
    if (storage) assetValuesByKey[storage.metaKey] = slot.fills.map((fill) => fill.url).filter((url): url is string => Boolean(url))
  }
  return computeReferenceRowModel({
    node: graph.node, nodes: graph.nodes, edges: graph.edges, meta, assetSlots: [], assetValuesByKey,
    imageUrlSlots: archetypeModeSlots(mode), arraySlots: archetypeModeArraySlots(mode),
    refsUnsupported: false, unusedUploads: placement.unused, showReferences: false, fallbackName: () => '',
  }).unusedUrls
}
const everyReference = (graph: Graph, archetype: ModelArchetype) => new Set([...inUse(graph), ...unusedOf(graph, archetype)])
/** 照 NodeParameterControls.handleModeSwitch：旧数据先落规范形，再只改 modeId（参考列表不动）。 */
function switchModeLikeComposer(graph: Graph, archetype: ModelArchetype, modeId: string): Graph {
  const meta = graph.node.meta || {}
  const normalized = normalizeReferenceListMeta(meta, currentArchetypeMode(archetype, meta)) ?? meta
  return switchMode({ ...graph, node: { ...graph.node, meta: normalized }, nodes: graph.nodes.map((n) => (n.id === graph.node.id ? { ...n, meta: normalized } : n)) }, archetype, modeId)
}

describe('参考列表：换方式 / 换模型一张不丢（#1269 重写）', () => {
  const imageCap = (mode: ArchetypeMode) => mode.slots.find((slot) => slot.kind === 'image_ref')?.max ?? 0

  it('全部档案 × 每个方式：从收图最多的方式放满参考，切到每个方式后在用 ∪ 未用到 = 原来那一份', () => {
    const lost: string[] = []
    let cells = 0
    for (const archetype of MODEL_ARCHETYPES) {
      if (archetype.kind !== 'video' && archetype.kind !== 'image') continue
      const start = [...archetype.modes].sort((a, b) => imageCap(b) - imageCap(a))[0]
      if (!start || imageCap(start) === 0) continue
      const original = imgs(Math.min(imageCap(start), 9))
      const begin = graphOn(archetype, archetype.identifierPatterns[0]!, 'apimart', start.id, { referenceImageUrls: original })
      for (const mode of archetype.modes) {
        cells += 1
        const graph = mode.id === start.id ? begin : switchModeLikeComposer(begin, archetype, mode.id)
        const kept = everyReference(graph, archetype)
        const missing = original.filter((url) => !kept.has(url))
        if (missing.length) lost.push(`${archetype.id}/${mode.id}: 少了 ${missing.length} 张`)
      }
    }
    expect(cells).toBeGreaterThanOrEqual(60)
    expect(lost).toEqual([])
  })

  it('Seedance 3 张切到首尾帧：前两张落首帧 / 尾帧，第 3 张未用到；切回参考 3 张原样', () => {
    const seedance = archetypeOf('seedance-2')
    const start = graphOn(seedance, 'seedance-2', 'apimart', 'omni', { referenceImageUrls: imgs(3) })
    const firstLast = switchModeLikeComposer(start, seedance, 'firstlast')
    expect([...inUse(firstLast)]).toEqual(imgs(2))
    expect(unusedOf(firstLast, seedance)).toEqual(imgs(1, 'u', 3))
    expect([...inUse(switchModeLikeComposer(firstLast, seedance, 'omni'))]).toEqual(imgs(3))
  })

  it.each(['veo3.1', 'kling-3.0', 'wan2.7'])('Seedance 5 张换到 %s：一张不删（在用 ∪ 未用到 = 5 张），节点上的列表原样', (toModelKey) => {
    const seedance = archetypeOf('seedance-2')
    const { graph, archetype } = swapModel(graphOn(seedance, 'seedance-2', 'apimart', 'omni', { referenceImageUrls: imgs(5) }), toModelKey, 'apimart')
    expect(everyReference(graph, archetype)).toEqual(new Set(imgs(5)))
    expect(graph.node.meta?.referenceImageUrls).toEqual(imgs(5))
  })

  it('文生方式的残留首帧（旧工程 / MCP metadata）：读进参考列表、标未用到', () => {
    const seedance = archetypeOf('seedance-2')
    const graph = graphOn(seedance, 'seedance-2', 'apimart', 't2v', { firstFrameUrl: img('stale') })
    expect([...inUse(graph)]).toEqual([])
    expect(unusedOf(graph, seedance)).toEqual([img('stale')])
  })

  describe('换模型往返：30 张 → Veo 3.1 → 切回', () => {
    const thirty = () => {
      const archetype = archetypeOf('seedance-2.5')
      return graphOn(archetype, 'seedance-2.5', 'apimart', 'omni', { referenceImageUrls: imgs(30) })
    }
    it('起点：Seedance 2.5 参考方式 30 张都在用', () => {
      expect(inUse(thirty()).size).toBe(30)
    })
    it('停在 Veo 3.1：30 张都还在节点上（在用 ∪ 未用到），发出去的 ⊆ 在用', () => {
      const there = swapModel(thirty(), 'veo3.1', 'apimart')
      expect(everyReference(there.graph, there.archetype)).toEqual(new Set(imgs(30)))
      const shown = inUse(there.graph)
      expect(sentUrls(taskTemplateParams(rendererRequest(there.graph))).filter((url) => !shown.has(url))).toEqual([])
    })
    it('换过去再切回来，参考一张不少、顺序不变', () => {
      const back = swapModel(swapModel(thirty(), 'veo3.1', 'apimart').graph, 'seedance-2.5', 'apimart')
      expect([...inUse(back.graph)]).toEqual(imgs(30))
    })
  })
})

// ── 旧工程残留（#1269 合并前条件 4，协调 10-23 定、已报用户）：旧界面看不见的图一律先放一边 ─────────────────────
// 判据只看 main 上旧参考区真实显示了什么：有首帧槽才显示 firstFrameUrl、有尾帧槽才显示 lastFrameUrl、有参考数组槽才显示
// referenceImageUrls；snake 别名、referenceImageUrl、referenceImages 从来不显示。看不见的那张：不在用、不发、参考行淡显「未用到」；
// 切到哪个方式都一样；用户点它一下（metaWithParkedRestored，和生成框 restoreParkedReference 同一个函数）才在用、才发。

describe('旧工程残留：旧界面看不见的图先放一边——不在用、不发；点回在用才发（全部档案 × 每个方式 × 每个旧键）', () => {
  const LEGACY_KEYS = ['firstFrameUrl', 'lastFrameUrl', 'first_frame_url', 'last_frame_url', 'referenceImageUrl', 'referenceImages', 'referenceImageUrls'] as const
  type LegacyKey = typeof LEGACY_KEYS[number]
  const legacyMetaFor = (key: LegacyKey): { stale: string; meta: Record<string, unknown> } => {
    const stale = img(`stale-${key}`)
    // referenceImageUrls 单独放和规范形长得一样（不算旧节点，见根因合同 residual_risks）：配一个旧帧键，节点才是旧工程。
    if (key === 'referenceImageUrls') return { stale, meta: { referenceImageUrls: [stale], firstFrameUrl: img('anchor-first') } }
    return { stale, meta: { [key]: key === 'referenceImages' ? [stale] : stale } }
  }
  const visibleInOldUi = (key: LegacyKey, mode: ArchetypeMode) => {
    const has = (kind: string) => mode.slots.some((slot) => slot.kind === kind)
    return (key === 'firstFrameUrl' && has('first_frame')) || (key === 'lastFrameUrl' && has('last_frame')) || (key === 'referenceImageUrls' && has('image_ref'))
  }
  const hidden = imageOrVideo.flatMap(({ archetype, modelKey }) => archetype.modes.flatMap((mode) => LEGACY_KEYS
    .filter((key) => !visibleInOldUi(key, mode))
    .map((key) => ({ archetype, modelKey, mode, key, ...legacyMetaFor(key) }))))
  const sentBy = (graph: Graph, archetype: ModelArchetype, modelKey: string) => {
    const request = rendererRequest(graph)
    return new Set([...urlsIn(taskTemplateParams(request)).keys(), ...urlsIn(wire(relayTransport(modelKey, archetype.id, request.kind), request as never)).keys()])
  }

  it('覆盖面：收图档案 × 方式 × 旧键里，旧界面看不见的格 ≥ 600', () => {
    expect(hidden.length).toBeGreaterThanOrEqual(600)
  })

  it('打开时：看不见的那张不在用、请求里没有（模板参数层 + 中转真请求体），参考行里淡显「未用到」、记作先放一边', () => {
    const wrong: string[] = []
    for (const { archetype, modelKey, mode, key, stale, meta } of hidden) {
      const graph = graphOn(archetype, modelKey, 'apimart', mode.id, meta)
      const label = `${archetype.id}/${mode.id}/${key}`
      if (inUse(graph).has(stale)) wrong.push(`${label}: 在用`)
      else if (sentBy(graph, archetype, modelKey).has(stale)) wrong.push(`${label}: 发出去了`)
      else if (!unusedOf(graph, archetype).includes(stale)) wrong.push(`${label}: 参考行里看不见`)
      else if (!resolveReferencePlacement(graph.node, graph.nodes, graph.edges).parked.includes(stale)) wrong.push(`${label}: 没记作先放一边`)
    }
    expect(wrong).toEqual([])
  })

  it('之后切到任何一个方式（生成框切方式，和 20 处改 modeId 的入口共用的 applyArchetypeModeSwitch）：照样不在用、不发', () => {
    const wrong: string[] = []
    for (const { archetype, modelKey, mode, key, stale, meta } of hidden) {
      const start = graphOn(archetype, modelKey, 'apimart', mode.id, meta)
      for (const next of archetype.modes) {
        if (next.id === mode.id) continue
        for (const [how, graph] of [['入口', switchMode(start, archetype, next.id)], ['生成框', switchModeLikeComposer(start, archetype, next.id)]] as const) {
          if (inUse(graph).has(stale) || sentBy(graph, archetype, modelKey).has(stale)) wrong.push(`${archetype.id}/${mode.id}→${next.id}/${key}（${how}）`)
        }
      }
    }
    expect(wrong).toEqual([])
  })

  it('点回在用：当前方式收得下它，点一下就在用、照发；收不下就不写（生成框说「已放满」）；在用 ∪ 未用到始终 = 原来那一份', () => {
    const wrong: string[] = []
    let restoredCount = 0
    for (const { archetype, modelKey, mode, key, stale, meta } of hidden) {
      const graph = graphOn(archetype, modelKey, 'apimart', mode.id, meta)
      const before = everyReference(graph, archetype)
      const restoredMeta = metaWithParkedRestored(graph.node, graph.nodes, graph.edges, stale, mode)
      const label = `${archetype.id}/${mode.id}/${key}`
      const takesImages = mode.slots.some((slot) => slot.kind === 'first_frame' || slot.kind === 'last_frame' || slot.kind === 'image_ref')
      if (!restoredMeta) {
        if (takesImages && key !== 'referenceImageUrls') wrong.push(`${label}: 收得下却没放回`)
        continue
      }
      restoredCount += 1
      const node = { ...graph.node, meta: restoredMeta }
      const after = { ...graph, node, nodes: graph.nodes.map((n) => (n.id === node.id ? node : n)) }
      if (!inUse(after).has(stale)) wrong.push(`${label}: 放回后不在用`)
      else if (!sentBy(after, archetype, modelKey).has(stale) && !mode.slots.every((slot) => slot.kind !== 'image_ref' && slot.kind !== 'first_frame')) {
        // 中转真请求体只有一个单图位：那一格让给了排在前面的图时，模板参数层仍要带它
        if (!urlsIn(taskTemplateParams(rendererRequest(after))).has(stale)) wrong.push(`${label}: 放回后没发`)
      }
      if (readParkedReferences(restoredMeta).includes(stale)) wrong.push(`${label}: 放回后还记着先放一边`)
      const kept = everyReference(after, archetype)
      if ([...before].some((url) => !kept.has(url))) wrong.push(`${label}: 放回后少了图`)
    }
    expect(restoredCount).toBeGreaterThanOrEqual(300)
    expect(wrong).toEqual([])
  })

  it('免费抓包：旧工程参考方式里残留的首帧（Seedance 2.0 APIMart 全能参考）——中转 / APIMart 收到的请求体都不带它；点回在用后照发', () => {
    const archetype = archetypeOf('doubao-seedance-2.0')
    const graph = graphOn(archetype, 'doubao-seedance-2.0', 'apimart', 'omni', { referenceImageUrls: imgs(2), firstFrameUrl: img('stale-first') })
    const { apimart, relay } = bodies(graph)
    expect(sentUrls(apimart)).toEqual(imgs(2))
    expect(sentUrls(relay)).not.toContain(img('stale-first'))
    const omni = archetype.modes.find((m) => m.id === 'omni')!
    const restored = metaWithParkedRestored(graph.node, graph.nodes, graph.edges, img('stale-first'), omni)!
    const node = { ...graph.node, meta: restored }
    expect(sentUrls(bodies({ node, nodes: [node], edges: [] }).apimart)).toEqual([...imgs(2), img('stale-first')].sort())
  })
})
