// 样片（先出低清样片、满意再拿样片号出成片）在节点上的事实：全部从结果的来历现算，节点上不另存一份。
// 「这一版是不是样片、样片号是多少、什么时候出的、出过几次高清」都读结果自己的来历（provenance）和运行记录；
// 老项目、普通模型出的结果读不出样片档案 → 不是样片（没有节点下方那一行）。
import { getArchetypeById } from '../../../../electron/shared/modelArchetypes/builtInCatalog'
import type { ModelArchetype } from '../../../../electron/shared/modelArchetypes/types'
import { SAMPLE_FINAL_MODE_ID } from '../../../../electron/shared/videoCapabilities/sampleMode'
import type { GenerationCanvasNode, GenerationNodeResult } from './generationCanvasTypes'

type SampleArchetype = ModelArchetype & { sampleOf: NonNullable<ModelArchetype['sampleOf']> }

export type SampleFacts = {
  /** 样片号 = 样片那次的供应商任务号（出高清只带它）。 */
  draftTaskId: string
  /** 样片发给的那一家、那一行（出高清照它发，不看节点现在选着谁）。 */
  vendorKey: string
  modelKey: string
  archetype: SampleArchetype
  /** 样片任务创建的时刻：能证明的最早时刻（这次运行开始 / 来历时刻 / 落地时刻取最早；缓存复用的结果来历是原任务的）。 */
  createdAt: number
  /** 样片当时冻结的请求参数（约价用：时长、音频等计价项取样片那次的）。 */
  extras: Record<string, unknown>
  /** 样片那次的任务种类（约价用）。 */
  taskKind: string
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function frozenExtras(result: GenerationNodeResult | null | undefined): Record<string, unknown> | null {
  return record(record(result?.provenance?.params)?.extras)
}

function frozenSelection(extras: Record<string, unknown> | null): { id: string; modeId: string } | null {
  const selection = record(extras?.archetype)
  const id = text(selection?.id)
  return id ? { id, modeId: text(selection?.modeId) } : null
}

/** 这一版是从样片出来的高清版（出高清方式 + 带着样片号）。 */
export function isSampleFinalResult(result: GenerationNodeResult | null | undefined): boolean {
  const extras = frozenExtras(result)
  return frozenSelection(extras)?.modeId === SAMPLE_FINAL_MODE_ID && Boolean(text(extras?.draft_task_id))
}

/** 这一版若是样片，给出它的事实；不是样片（普通模型、老项目、高清版、没任务号）→ null。 */
export function sampleFactsOf(node: Pick<GenerationCanvasNode, 'runs'>, result: GenerationNodeResult | null | undefined): SampleFacts | null {
  if (!result || result.type !== 'video') return null
  const draftTaskId = text(result.taskId)
  const extras = frozenExtras(result)
  const selection = frozenSelection(extras)
  if (!draftTaskId || !extras || !selection || selection.modeId === SAMPLE_FINAL_MODE_ID) return null
  const archetype = getArchetypeById(selection.id)
  if (!archetype?.sampleOf) return null
  const vendorKey = text(result.provenance?.provider) || text(extras.modelVendor) || text(extras.vendor)
  const modelKey = text(extras.modelKey) || text(result.model)
  if (!vendorKey || !modelKey) return null
  const run = node.runs?.find((candidate) => candidate.resultId === result.id)
  const moments = [run?.startedAt, result.provenance?.timestamp, result.createdAt]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
  if (!moments.length) return null
  return {
    draftTaskId,
    vendorKey,
    modelKey,
    archetype: archetype as SampleArchetype,
    createdAt: Math.min(...moments),
    extras,
    taskKind: text(result.taskKind) || text(archetype.sampleOf.final.transportTaskKind) || 'text_to_video',
  }
}

/** 节点版本栈里（当前版 + 历史）从这条样片出过的高清版。 */
export function finalsMadeFrom(node: Pick<GenerationCanvasNode, 'result' | 'history'>, draftTaskId: string): GenerationNodeResult[] {
  const seen = new Set<string>()
  const out: GenerationNodeResult[] = []
  for (const result of [node.result, ...(node.history ?? [])]) {
    if (!result || seen.has(result.id)) continue
    seen.add(result.id)
    if (isSampleFinalResult(result) && text(frozenExtras(result)?.draft_task_id) === draftTaskId) out.push(result)
  }
  return out
}

/** 节点版本栈里按样片号找回那条样片（出高清时控制器据此定身份，不看节点现在选着谁）。 */
export function sampleByTaskId(node: Pick<GenerationCanvasNode, 'result' | 'history' | 'runs'>, draftTaskId: string): SampleFacts | null {
  for (const result of [node.result, ...(node.history ?? [])]) {
    const facts = sampleFactsOf(node, result)
    if (facts && facts.draftTaskId === draftTaskId) return facts
  }
  return null
}

/**
 * 节点眼下占着显示的那次是不是出高清（唯一的判断处：等待面、状态条、失败卡、节点下方那一行都读它）。
 * - `active`：在路上。准入前只有进度带着样片号（记录还没写），准入后记录的 attempt 也记着；
 * - `failed`：最近一次运行就是出高清、没成（节点的失败卡让给下方那一行，按钮还是「出高清」，再点即重试）。
 * 普通发送、老记录（没有样片号）→ null：节点照今天的通用状态画。
 */
export type SampleFinalRun = { draftTaskId: string; phase: 'active' } | { draftTaskId: string; phase: 'failed'; error: string }

export function sampleFinalRunOf(node: Pick<GenerationCanvasNode, 'status' | 'error' | 'progress' | 'runs'>): SampleFinalRun | null {
  if (node.status === 'queued' || node.status === 'running') {
    const live = node.runs?.find((run) => run.status === 'queued' || run.status === 'running')
    const draftTaskId = text(node.progress?.draftTaskId) || text(live?.attempt?.draftTaskId)
    return draftTaskId ? { draftTaskId, phase: 'active' } : null
  }
  if (node.status === 'error') {
    const latest = node.runs?.[0]
    const draftTaskId = latest?.status === 'error' ? text(latest.attempt?.draftTaskId) : ''
    return draftTaskId ? { draftTaskId, phase: 'failed', error: node.error || latest?.error || '' } : null
  }
  return null
}

export type SampleExpiry =
  | { kind: 'days' | 'hours' | 'minutes'; count: number; warning: boolean }
  | { kind: 'expired'; warning: false }

const HOUR_MS = 3_600_000
/** 剩不到这么久换提醒色。 */
export const SAMPLE_EXPIRY_WARNING_MS = 2 * HOUR_MS

/**
 * 还剩多久（协调裁定 C-D3）：≥24 小时按天（向下取整）、1–24 小时按小时（向下取整）、
 * 不到 1 小时按分钟（向上取整，不出 0）；不到 2 小时换提醒色；到点 = 已过期。档案没写有效期 → null（不显示剩余时间）。
 */
export function sampleExpiry(createdAt: number, ttlHours: number | undefined, now: number): SampleExpiry | null {
  if (typeof ttlHours !== 'number' || !Number.isFinite(ttlHours) || ttlHours <= 0) return null
  const remaining = createdAt + ttlHours * HOUR_MS - now
  if (remaining <= 0) return { kind: 'expired', warning: false }
  const warning = remaining < SAMPLE_EXPIRY_WARNING_MS
  if (remaining >= 24 * HOUR_MS) return { kind: 'days', count: Math.floor(remaining / (24 * HOUR_MS)), warning }
  if (remaining >= HOUR_MS) return { kind: 'hours', count: Math.floor(remaining / HOUR_MS), warning }
  return { kind: 'minutes', count: Math.max(1, Math.ceil(remaining / 60_000)), warning }
}

/** 出高清那一次要发的：样片号 + 目标清晰度（只能是档案里的成片清晰度）。 */
export type SampleFinalRequest = { draftTaskId: string; resolution: string }

/**
 * 出高清那一次被执行的节点：身份换成样片那一行（不看节点现在选着谁），提示词清空、参考不带，
 * 参数只有样片号和目标清晰度，方式是档案的出高清方式。只活在这一次运行里，不写回节点。
 */
export function sampleFinalExecutionNode(node: GenerationCanvasNode, sample: SampleFacts, request: SampleFinalRequest): GenerationCanvasNode {
  return {
    ...node,
    prompt: '',
    references: [],
    meta: {
      modelKey: sample.modelKey,
      modelAlias: sample.modelKey,
      modelVendor: sample.vendorKey,
      vendor: sample.vendorKey,
      archetype: { id: sample.archetype.id, modeId: sample.archetype.sampleOf.final.id },
      draft_task_id: request.draftTaskId,
      resolution: request.resolution,
    },
  }
}
