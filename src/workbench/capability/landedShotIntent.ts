// 一镜的「起草意图」落到画布节点之后怎么跟着 Agent 改稿走（D2 第③步）。
//
// ── 为什么有这个文件 ──
//
// 节点是镜头参数的唯一 owner：卡只读节点，发出也只读节点。以前候选一变新，落地就用「档案默认 ⊕ 候选」把整个节点
// 盖掉（`rebindLandedShots`，2026-10-22 落地默认值核查）：用户在节点上改过的时长、声音、比例，Agent 一改提示词就全回去了。
// 可直接删掉它也不行——Agent 改稿（`draft_shots` 带 shotId）今天就靠这一步落到节点上，删了「把第二段改成竖版」会静默不生效。
//
// 所以换成：落地那一刻在节点上记下「这一次是从起草写进来的哪几样」的指纹；候选再变新时，**只把 Agent 这次真改了的那几样**
// 写进节点（模型身份、方式、变体、参数逐键，提示词、标题、参考），Agent 没碰的键一个不动——不管用户在节点上改没改过。
// 参考的增删走画布那一条规则（`planReferenceProjection`：画布上已有的图连真边，其余进节点那一份参考列表）。
//
// 指纹只存比较用的摘要（参考存地址，删一张要知道删的是哪张），不存第二份参数：发出永远读节点本身。
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { buildPlannedNodeMeta } from '../generationCanvas/agent/plannedNodeMeta'
import type { AgentModelEntry } from '../generationCanvas/agent/availableModels'
import { CANDIDATE_META_KEYS, plannedInputFromCandidate, type LandedShotCandidate } from '../generationCanvas/agent/candidateNodeMeta'
import { generationCanvasTools } from '../generationCanvas/agent/generationCanvasTools'
import { planReferenceProjection, type CandidateReferenceInput } from '../generationCanvas/model/referenceInputSlots'
import { readReferenceList, removeFromReferenceList, withReferenceList } from '../generationCanvas/nodes/controls/referenceList'
import { resultUrl } from '../generationCanvas/runner/referenceUrl'
import { ASPECT_EXPLICIT_META_KEY } from '../generationCanvas/nodes/aspectExplicit'
import { stableHash } from '../adoption/adoptionProposalKey'

/** 一镜从起草写进节点的那一份意图：候选（模型身份 / 方式 / 变体 / 参数 / 参考）+ 提示词 + 标题。 */
export type LandedShotIntent = Readonly<{ candidate?: LandedShotCandidate; prompt?: string; title?: string }>

/** 节点上记着的指纹：字段 → 摘要；参考另存地址（删一张要知道是哪张）。 */
type IntentStamp = Readonly<{ fields: Readonly<Record<string, string>>; references: readonly string[] }>

const MODEL_IDENTITY_META_KEYS = ['modelKey', 'modelLabel', 'archetype', 'modelVendor', 'vendor'] as const

function fingerprint(value: unknown): string {
  return stableHash(JSON.stringify(value ?? null))
}

function referenceKey(reference: CandidateReferenceInput): string {
  return `${reference.url}\u0000${reference.kind}\u0000${reference.role ?? ''}`
}

/** 这一份意图的指纹（起草没写的字段不进来：没写 = 档案默认，不是 Agent 的选择）。 */
export function intentStampOf(intent: LandedShotIntent): IntentStamp {
  const fields: Record<string, string> = {}
  const candidate = intent.candidate
  if (candidate?.modelKey) fields.model = fingerprint([candidate.vendor ?? '', candidate.modelKey])
  if (candidate?.modeId) fields.modeId = fingerprint(candidate.modeId)
  if (candidate?.variantId) fields.variantId = fingerprint(candidate.variantId)
  for (const [key, value] of Object.entries(candidate?.parameters ?? {})) fields[`param:${key}`] = fingerprint(value)
  if (typeof intent.prompt === 'string') fields.prompt = fingerprint(intent.prompt)
  const title = intent.title?.trim()
  if (title) fields.title = fingerprint(title)
  return { fields, references: (candidate?.references ?? []).map(referenceKey) }
}

/** 写进节点 meta 的那一格（字符串：meta 会随请求过 IPC，不放嵌套对象）。 */
export function intentStampMeta(intent: LandedShotIntent): Record<string, string> {
  return { [CANDIDATE_META_KEYS.candidateIntent]: JSON.stringify(intentStampOf(intent)) }
}

/** 节点上记着的指纹；没有（这一版之前落的节点）→ null。 */
export function readIntentStamp(meta: Record<string, unknown> | undefined): IntentStamp | null {
  const raw = meta?.[CANDIDATE_META_KEYS.candidateIntent]
  if (typeof raw !== 'string' || !raw) return null
  try {
    const parsed = JSON.parse(raw) as { fields?: unknown; references?: unknown }
    const fields = parsed.fields && typeof parsed.fields === 'object' && !Array.isArray(parsed.fields)
      ? Object.fromEntries(Object.entries(parsed.fields as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : {}
    const references = Array.isArray(parsed.references) ? parsed.references.filter((item): item is string => typeof item === 'string') : []
    return { fields, references }
  } catch {
    return null
  }
}

/**
 * 这一版之前落的节点没有指纹（旧数据读时归一，唯一一处）：模型身份 / 方式 / 变体按节点**此刻**的值算——同一个模型
 * 不算换了模型；参数、提示词、标题、参考没有可比的旧值，按「Agent 这一次写出来的每一样都算改了」处理。
 * 起草从没写过的参数仍不碰，所以用户改过、Agent 从没写过的键照样留着。
 */
function legacyStampOf(meta: Record<string, unknown>): IntentStamp {
  const fields: Record<string, string> = {}
  const modelKey = typeof meta.modelKey === 'string' ? meta.modelKey : ''
  const vendor = typeof meta.modelVendor === 'string' ? meta.modelVendor : typeof meta.vendor === 'string' ? meta.vendor : ''
  if (modelKey) fields.model = fingerprint([vendor, modelKey])
  const archetype = meta.archetype && typeof meta.archetype === 'object' ? meta.archetype as { modeId?: unknown; variantId?: unknown } : {}
  if (typeof archetype.modeId === 'string' && archetype.modeId) fields.modeId = fingerprint(archetype.modeId)
  if (typeof archetype.variantId === 'string' && archetype.variantId) fields.variantId = fingerprint(archetype.variantId)
  return { fields, references: [] }
}

/** Agent 这一次改了哪几样：新指纹里与旧指纹不同的字段，加上旧指纹里有、新的没有的（Agent 删掉了那个参数）。 */
export function changedIntentFields(previous: IntentStamp | null, next: IntentStamp, meta: Record<string, unknown> = {}): Set<string> {
  if (!previous) {
    const legacy = legacyStampOf(meta)
    const identity = ['model', 'modeId', 'variantId'].filter((key) => key in next.fields && legacy.fields[key] !== next.fields[key])
    const rest = Object.keys(next.fields).filter((key) => !['model', 'modeId', 'variantId'].includes(key))
    return new Set([...identity, ...rest, ...(next.references.length ? ['references'] : [])])
  }
  const changed = new Set<string>()
  for (const key of new Set([...Object.keys(previous.fields), ...Object.keys(next.fields)])) {
    if (previous.fields[key] !== next.fields[key]) changed.add(key)
  }
  if (previous.references.join('\u0001') !== next.references.join('\u0001')) changed.add('references')
  return changed
}

type InTxn = <T>(fn: () => T) => T

/**
 * 把一组参考摆到节点上（首次落地与改稿共用）：画布上已经有的那张图连真边，其余进节点那一份参考列表，
 * 方式不写：发送时由唯一 owner `modeForInputs` 按放进来的输入现算（画布同一条规则）。只补不删。
 */
export function placeLandedReferences(nodeId: string, references: readonly CandidateReferenceInput[], inTxn: InTxn): void {
  if (references.length === 0) return
  const state = useGenerationCanvasStore.getState()
  const node = state.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return
  const plan = planReferenceProjection(node, references, state.nodes, state.edges)
  inTxn(() => {
    if (plan.meta) useGenerationCanvasStore.getState().updateNode(nodeId, { meta: plan.meta })
    if (plan.connect.length > 0) {
      generationCanvasTools.connect_nodes(plan.connect.map((edge) => ({ source: edge.sourceNodeId, target: nodeId, mode: edge.mode })))
    }
  })
}

/** Agent 删掉的那几张参考：节点自己列表里的拿掉，从画布上那张图连过来的边断开。用户自己加的不动（不在旧指纹里）。 */
function removeLandedReferences(nodeId: string, removed: readonly string[], inTxn: InTxn): void {
  if (removed.length === 0) return
  const urls = new Set(removed.map((key) => key.split('\u0000')[0]!))
  inTxn(() => {
    const store = useGenerationCanvasStore.getState()
    const node = store.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return
    const meta = { ...(node.meta ?? {}) } as Record<string, unknown>
    const list = readReferenceList(meta)
    const kept = [...urls].reduce((current, url) => removeFromReferenceList(current, url), list)
    if (kept.length !== list.length) store.updateNode(nodeId, { meta: withReferenceList(meta, kept) })
    const nodesById = new Map(store.nodes.map((candidate) => [candidate.id, candidate]))
    for (const edge of store.edges) {
      if (edge.target !== nodeId) continue
      const url = resultUrl(nodesById.get(edge.source)?.result)
      if (url && urls.has(url)) useGenerationCanvasStore.getState().disconnectEdge(edge.id)
    }
  })
}

/**
 * 候选变新了：把 Agent 这一次真改了的那几样写进已经落在画布上的节点（见文件头）。
 * 模型换了 → 按新模型整份铺（新模型的档案默认 ⊕ Agent 写的参数，与首次落地同一个构造器）；
 * 方式 / 变体换了 → 档案身份换成新的，当前值在新方式里不合法的参数取新方式的默认；
 * 参数改了 → 只写那几个键（非法值由构造器丢回默认）；Agent 删掉的参数回到默认。
 */
export function applyAgentRevision(
  nodeId: string,
  intent: LandedShotIntent,
  entryByKey: ReadonlyMap<string, AgentModelEntry>,
  stamp: Record<string, unknown>,
  inTxn: InTxn,
): void {
  const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return
  const currentMeta = (node.meta as Record<string, unknown> | undefined) ?? {}
  const next = intentStampOf(intent)
  const previous = readIntentStamp(currentMeta)
  const changed = changedIntentFields(previous, next, currentMeta)
  const input = plannedInputFromCandidate(intent.candidate)
  const full = input ? buildPlannedNodeMeta(input, entryByKey) : undefined
  const meta: Record<string, unknown> = { ...currentMeta }
  if (full && changed.has('model')) {
    Object.assign(meta, full)
  } else if (full) {
    const modeChanged = changed.has('modeId') || changed.has('variantId')
    if (modeChanged) meta.archetype = full.archetype
    for (const [key, value] of Object.entries(full)) {
      if ((MODEL_IDENTITY_META_KEYS as readonly string[]).includes(key) || key === ASPECT_EXPLICIT_META_KEY) continue
      // 新方式里这个键还没有值 → 取构造器给的（默认或 Agent 写的）。
      if (modeChanged && !(key in currentMeta)) meta[key] = value
      if (changed.has(`param:${key}`)) meta[key] = value
    }
    // Agent 删掉的参数，这个方式没有默认值 → 键也删掉（没写 = 档案默认；没有默认 = 不填）。
    for (const field of changed) {
      const key = field.startsWith('param:') ? field.slice('param:'.length) : ''
      if (key && !(key in full)) delete meta[key]
    }
    // Agent 写了合法比例 = 明确选过（与首次落地同一条，用户 2026-10-22 Q2）。
    if (full[ASPECT_EXPLICIT_META_KEY] === true && [...changed].some((field) => field.startsWith('param:'))) meta[ASPECT_EXPLICIT_META_KEY] = true
  }
  const title = intent.title?.trim()
  inTxn(() => useGenerationCanvasStore.getState().updateNode(nodeId, {
    ...(changed.has('prompt') && typeof intent.prompt === 'string' ? { prompt: intent.prompt } : {}),
    ...(changed.has('title') && title ? { title } : {}),
    meta: { ...meta, ...stamp, ...intentStampMeta(intent) },
  }))
  if (!changed.has('references')) return
  const before = new Set(previous?.references ?? [])
  const after = new Set(next.references)
  removeLandedReferences(nodeId, [...before].filter((key) => !after.has(key)), inTxn)
  const added = (intent.candidate?.references ?? []).filter((reference) => !before.has(referenceKey(reference)))
  placeLandedReferences(nodeId, added, inTxn)
}
