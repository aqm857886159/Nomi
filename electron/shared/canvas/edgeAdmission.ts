// 「这条边合不合法」的唯一规则——中立契约层，渲染层 store、主进程 headless 写图、盘上外部写入共用。
//
// 为什么住这里而不是 `src/.../referenceEdgeCapability.ts`：这条规则要在**主进程**里裁决 MCP / headless 写进来的边
// （主进程不能 import 渲染层，见 check:boundaries）。以前规则只在渲染层，store 的手动连线、Agent 工具会过它，
// MCP 整图写回、粘贴、拖动复制不会——同一类「非法边」从没拦的门里写进来（视频 / 声音 → 文本卡，2026-10-10 复审）。
// 现在：规则一份（本文件）；渲染层 `referenceEdgeCapability` 从这里 re-export，不另存。
//
// 只管**新建**：已经存在的旧边（老项目）照常加载、显示、能断开，这里不回头删它们。
import { resolveArchetypeForModel, type ArchetypeReferenceSlotKind, type ModelArchetype } from '../modelArchetypes'
import { SLOT_ACCEPTS, type ReferenceAssetKind } from '../modelArchetypes/anchorPolicy'
import { NODE_EXECUTION_KIND_BY_NODE_KIND } from './nodeExecutionKinds'

export type EdgeAdmissionMode = 'reference' | 'first_frame' | 'last_frame' | 'style_ref' | 'character_ref' | 'composition_ref'

/** 这一类节点的连线两端——「收不收输入 / 有没有能被下游引用的产出」的唯一 owner（渲染层注册表读它，不再各写一份）。 */
export type NodeKindConnects = { input: 'models' | readonly ReferenceAssetKind[] | false; output: boolean }

export const NODE_KIND_CONNECTS = {
  shot_table: { input: false, output: false },
  // 文本卡左环收**文字和图**（2026-10-09 拍板）：图在素材列表里（看图写描述），文字不在列表里——文字上下文走 isTextPromptEdge。
  text: { input: ['image'], output: true },
  character: { input: 'models', output: true },
  scene: { input: 'models', output: true },
  image: { input: 'models', output: true },
  keyframe: { input: 'models', output: true },
  video: { input: 'models', output: true },
  audio: { input: 'models', output: true },
  clip: { input: ['image', 'video'], output: false },
  shot: { input: false, output: false },
  output: { input: false, output: false },
  panorama: { input: false, output: true },
  director: { input: ['image'], output: true },
  whiteboard: { input: false, output: true },
  model3d: { input: 'models', output: false },
  asset: { input: false, output: true },
  'agent-artifact': { input: false, output: false },
} as const satisfies Record<string, NodeKindConnects>

/** 边的一端：只读种类、模型身份（meta）、产物类型——渲染层节点与盘上 JSON 节点都满足。 */
export type EdgeEndpoint = { kind: string; meta?: unknown; result?: { type?: string } | null }

/** `target_takes_no_input`：目标这一类节点根本不收输入（上传素材 / 文本……，见 `NODE_KIND_CONNECTS`）。 */
export type EdgeSkipReason = 'dangling' | 'source_not_referenceable' | 'unsupported_reference' | 'target_takes_no_input'

export type EdgeCapabilityResult = { ok: true } | { ok: false; reason: EdgeSkipReason }

function connectsOf(kind: string): NodeKindConnects | null {
  return Object.prototype.hasOwnProperty.call(NODE_KIND_CONNECTS, kind) ? NODE_KIND_CONNECTS[kind as keyof typeof NODE_KIND_CONNECTS] : null
}

const executionKindOf = (kind: string) => NODE_EXECUTION_KIND_BY_NODE_KIND[kind]

/**
 * 源节点能给出哪种可参考资产。先问种类定义「有没有能给下游用的产出」（`connects.output`，唯一 owner）——
 * 没有 → null；有 → 按执行语义 derive：可执行视频→video、图片→image、音频→audio；
 * 文本的产出是给下游的**提示词上下文**、不是参考素材 → null（文本边走 isTextPromptEdge）；
 * 不执行但有产出的种类（素材 / 全景 / 导演台 / 画板）看产物 result.type（素材一个种类同时承载图、视频、音频；无产物默认 image）。
 */
export function referenceAssetKindForNode(node: EdgeEndpoint): ReferenceAssetKind | null {
  if (!connectsOf(node.kind)?.output) return null
  const exec = executionKindOf(node.kind)
  if (exec === 'video') return 'video'
  if (exec === 'image') return 'image'
  if (exec === 'audio') return 'audio'
  if (exec) return null
  if (node.result?.type === 'video') return 'video'
  if (node.result?.type === 'audio') return 'audio'
  return 'image'
}

/**
 * 文本节点的通用 reference 出边不是“参考素材”，而是下游生成 prompt 的上下文补充。
 * 只允许喂给图片/视频/3D 生成节点（吃 prompt 的媒体生成面）；口径与 projectConnectedTextInputs 的目标判定一致，改必同改。
 */
export function isTextPromptEdge(source: EdgeEndpoint, target: EdgeEndpoint, mode: EdgeAdmissionMode | undefined = 'reference'): boolean {
  if ((mode ?? 'reference') !== 'reference' || source.kind !== 'text') return false
  const targetExec = executionKindOf(target.kind)
  // 文本接文本：上一段文字当下一个文本节点加工时的背景（加工框「扩写 / 翻译 / 拆成多条」的输入）。
  return targetExec === 'image' || targetExec === 'video' || targetExec === 'model3d' || targetExec === 'text'
}

/**
 * 边语义 → 它要落到目标模型的哪些参考槽(任一满足即可)。通用 reference 接受任意槽。
 * first_frame 同时认 `image_ref`：i2v 模型的「首帧输入槽」声明不统一，两者都能消费 keyframe→video 的首帧边。
 */
export const EDGE_MODE_SLOTS: Record<EdgeAdmissionMode, readonly ArchetypeReferenceSlotKind[]> = {
  // 顺序即偏好（preferredSlotKinds）：视频先参考视频 / 源视频，最后才退成首帧接力。
  reference: ['image_ref', 'video_ref', 'source_video', 'first_frame', 'last_frame', 'audio_ref'],
  first_frame: ['first_frame', 'image_ref'],
  last_frame: ['last_frame'],
  style_ref: ['image_ref'],
  character_ref: ['image_ref'],
  composition_ref: ['image_ref'],
}

/**
 * 从节点 meta 解析模型档案 —— 一律走发送路径同一个解析器 `resolveArchetypeForModel`（它自己读 meta 里的显式 id 并做 legacyIds 迁移，
 * 不在这里就地读 `meta.archetype.id`：那条捷径跳过迁移，同一节点两条路径认到两个档案，2026-09-08 修过）。
 */
export function archetypeForNode(node: EdgeEndpoint): ModelArchetype | null {
  const meta = node.meta
  if (!meta || typeof meta !== 'object') return null
  const record = meta as Record<string, unknown>
  const modelKey = typeof record.modelKey === 'string' ? record.modelKey : ''
  const modelVendor = record.modelVendor
  return resolveArchetypeForModel({
    modelKey,
    vendorKey: typeof modelVendor === 'string' ? modelVendor : null,
    meta,
  })
}

/** 目标模型跨所有模式声明过的参考槽种类(union);无档案 → null(放行,不校验)。 */
function targetSlotKinds(node: EdgeEndpoint): Set<ArchetypeReferenceSlotKind> | null {
  const archetype = archetypeForNode(node)
  if (!archetype) return null
  const set = new Set<ArchetypeReferenceSlotKind>()
  for (const mode of archetype.modes) for (const slot of mode.slots) set.add(slot.kind)
  return set
}

/**
 * 只看「种类」的那一半（不解析模型档案，便宜）：目标收不收输入、源有没有可参考产出、素材列表型目标收不收这种素材。
 * 生成类目标（`input: 'models'`）在这里一律放行，是否真有槽收它由 validateReferenceEdge 往下看档案。
 * 执行侧（resolveGenerationReferences）用它忽略旧项目里的非法旧边——每次渲染都会调，不能每次解析档案。
 */
export function validateEdgeKinds(source: EdgeEndpoint, target: EdgeEndpoint, mode: EdgeAdmissionMode | undefined): EdgeCapabilityResult {
  const input = connectsOf(target.kind)?.input ?? false
  if (input === false) return { ok: false, reason: 'target_takes_no_input' }
  if (isTextPromptEdge(source, target, mode)) return { ok: true }
  const asset = referenceAssetKindForNode(source)
  if (!asset) return { ok: false, reason: 'source_not_referenceable' }
  if (input !== 'models') return input.includes(asset) ? { ok: true } : { ok: false, reason: 'unsupported_reference' }
  return { ok: true }
}

/**
 * 这条参考边目标到底收不收——**新建**连线的总闸（手动拖线 / 点「+」/ 点选 / @ / Agent / 自动引用 / MCP 写图 / 粘贴都经它）。
 * 目标这一类不收输入（`input === false`：上传素材、文本……）或种类未知 → target_takes_no_input;
 * 文本→图片/视频的通用 reference 边作为 prompt 上下文放行;
 * 其余源无可参考资产（含未知种类）→ source_not_referenceable;
 * 目标自己读上游边（`input` 是素材列表：剪辑、导演台）→ 源资产在列表里才收，否则 unsupported_reference;
 * 目标声明了档案但任何模式都没有能消费「该 mode + 该源资产」的槽 → unsupported_reference;
 * 其余(含生成类目标还没选模型)→ ok。
 */
export function validateReferenceEdge(source: EdgeEndpoint, target: EdgeEndpoint, mode: EdgeAdmissionMode | undefined): EdgeCapabilityResult {
  const kinds = validateEdgeKinds(source, target, mode)
  if (!kinds.ok) return kinds
  const input = connectsOf(target.kind)?.input ?? false
  const asset = referenceAssetKindForNode(source)
  if (input !== 'models' || !asset || isTextPromptEdge(source, target, mode)) return kinds
  const slotKinds = targetSlotKinds(target)
  if (!slotKinds) return { ok: true }
  const required = EDGE_MODE_SLOTS[mode ?? 'reference']
  const satisfiable = required.some((slot) => slotKinds.has(slot) && SLOT_ACCEPTS[slot].includes(asset))
  return satisfiable ? { ok: true } : { ok: false, reason: 'unsupported_reference' }
}

export type EdgeLike = { id: string; source: string; target: string; mode?: string }
export type RejectedEdge<E extends EdgeLike = EdgeLike> = { edge: E; reason: EdgeSkipReason }

/**
 * 批量过闸：`next` 里 id 不在 `known` 的边是**新边**，逐条过 `judge`（默认 validateReferenceEdge）；
 * `known` 里已有的边原样保留（旧项目里的老非法边不删，只是不再能新建）。端点不在 nodes 里 → dangling。
 * 没有被拒的边时返回 `next` 本身（同一个引用，调用方可据此省掉一次写）。
 */
export function admitNewEdges<E extends EdgeLike>(input: Readonly<{
  nodes: readonly (EdgeEndpoint & { id: string })[]
  known: ReadonlySet<string>
  next: readonly E[]
}>): { edges: readonly E[]; rejected: RejectedEdge<E>[] } {
  const rejected: RejectedEdge<E>[] = []
  const byId = new Map(input.nodes.map((node) => [node.id, node]))
  const edges = input.next.filter((edge) => {
    if (input.known.has(edge.id)) return true
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    const verdict: EdgeCapabilityResult = source && target ? validateReferenceEdge(source, target, edge.mode as EdgeAdmissionMode | undefined) : { ok: false, reason: 'dangling' }
    if (verdict.ok) return true
    rejected.push({ edge, reason: verdict.reason })
    return false
  })
  return { edges: rejected.length ? edges : input.next, rejected }
}
