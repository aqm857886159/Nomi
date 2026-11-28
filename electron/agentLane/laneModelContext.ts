import { MODEL_ANCHOR_GUIDANCE } from '../shared/agentCapabilities/availableModels'
import type { AgentModelEntry } from '../shared/agentCapabilities/availableModels'
import { modelCatalogReadSpec } from '../shared/agentCapabilities/modelFacingToolRegistry'
import { modelHandleOf } from '../shared/agentCapabilities/modelHandle'
import type { LaneComposerContext } from '../shared/agentLane/laneDesktopContracts'
import { readAspectRatioGeometry } from '../shared/aspectRatioValue'
import type { GenerationDefaultTaskKind } from '../shared/contracts/generationModelDefaultsContract'

/** 完整模型目录住在哪个动词上：与 lane 装配的是同一个（`modelCatalogReadSpec`）。 */
const MODEL_CATALOG_READ_VERB = modelCatalogReadSpec().name

/**
 * 用户在设置里按任务声明的默认模型（此刻真能用的那几条）。**唯一的主人**是主进程的
 * `createGenerationDefaultModelResolver`（读设置 + 目录 + 可用性闸）；这里只是把它读出来的事实原样交给模型，
 * 不自己解释、不留副本。缺席的任务 = 用户没设，或设了但此刻用不了。
 */
export type LaneDeclaredDefaults = Readonly<Partial<Record<GenerationDefaultTaskKind, Readonly<{ vendor: string; modelId: string }>>>>

const DEFAULT_LINE: ReadonlyArray<readonly [GenerationDefaultTaskKind, string]> = [
  ['text_to_image', '图片默认（文生图）'], ['image_edit', '图片默认（改图 / 带参考图）'],
  ['text_to_video', '视频默认（文生视频）'], ['image_to_video', '视频默认（图生视频）'],
]

const ASPECT_PARAM_KEYS = new Set(['aspect_ratio', 'aspectRatio', 'ratio', 'size', 'image_size', 'imageSize', 'video_size', 'videoSize'])
const SLOT_KIND_LABEL: Readonly<Record<string, string>> = {
  image_ref: '图',
  first_frame: '首帧',
  last_frame: '尾帧',
  video_ref: '视频',
  audio_ref: '音频',
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y !== 0) { const t = x % y; x = y; y = t }
  return x || 1
}

function ratioTokenOf(raw: string): { label: string; pixelMapped: boolean } | null {
  const trimmed = raw.trim()
  if (/^\d+\s*:\s*\d+$/.test(trimmed)) {
    const [wRaw, hRaw] = trimmed.split(':').map((n) => Number(n.trim()))
    if ((wRaw ?? 0) >= 64 && (hRaw ?? 0) >= 64) {
      const d = gcd(wRaw!, hRaw!)
      return { label: `${wRaw! / d}:${hRaw! / d}`, pixelMapped: true }
    }
    return { label: trimmed.replace(/\s+/g, ''), pixelMapped: false }
  }
  const geom = readAspectRatioGeometry(trimmed)
  if (!geom) return null
  const d = gcd(geom.width, geom.height)
  return { label: `${geom.width / d}:${geom.height / d}`, pixelMapped: true }
}

/** 为已声明的默认生成模型提取紧凑首轮规格（合法比例、时长、清晰度、参考槽上限），严禁裸露小写下划线内部键名。 */
function formatModelCapabilityBrief(entry: AgentModelEntry): string {
  const defaultMode = entry.modes.find((m) => m.modeId === entry.defaultModeId) ?? entry.modes[0]
  const ratios: string[] = []
  let pixelMapped = false
  let defaultRatioLabel: string | undefined
  if (defaultMode) {
    for (const p of defaultMode.params) {
      if (!ASPECT_PARAM_KEYS.has(p.key) || p.defaultValue === undefined) continue
      const defTok = ratioTokenOf(String(p.defaultValue))
      if (defTok) { defaultRatioLabel = defTok.label; break }
    }
  }
  for (const mode of entry.modes) {
    for (const param of mode.params) {
      if (!ASPECT_PARAM_KEYS.has(param.key) || !param.options?.length) continue
      for (const opt of param.options) {
        const tok = ratioTokenOf(String(opt.value))
        if (!tok) continue
        if (tok.pixelMapped) pixelMapped = true
        if (!ratios.includes(tok.label)) ratios.push(tok.label)
      }
    }
  }

  let durationSpec = ''
  for (const mode of entry.modes) {
    const dur = mode.params.find((p) => p.key === 'duration' || p.key === 'durationSeconds')
    if (!dur) continue
    if (dur.options?.length) {
      const opts = dur.options.map((o) => `${o.value}${String(o.value) === String(dur.defaultValue) ? '*' : ''}`).join('/')
      durationSpec = `${opts}s`
    } else if (dur.min !== undefined && dur.max !== undefined) {
      durationSpec = `${dur.min}-${dur.max}s${dur.defaultValue !== undefined ? `(默${dur.defaultValue}s)` : ''}`
    }
    if (durationSpec) break
  }

  const resolutions: string[] = []
  let defaultRes: string | undefined
  for (const mode of entry.modes) {
    const res = mode.params.find((p) => p.key === 'resolution')
    if (!res?.options?.length) continue
    if (defaultRes === undefined && res.defaultValue !== undefined) defaultRes = String(res.defaultValue)
    for (const opt of res.options) {
      const val = String(opt.value)
      if (!resolutions.includes(val)) resolutions.push(val)
    }
  }

  const hasAnySlots = entry.modes.some((m) => (m.slots?.length ?? 0) > 0)
  const slotParts = hasAnySlots || entry.modes.length > 1
    ? entry.modes.slice(0, 4).map((m) => {
        if (!m.slots?.length) return `${m.modeId}:无`
        const desc = m.slots.map((s) => `${SLOT_KIND_LABEL[s.kind] ?? s.label}≤${s.max ?? 1}`).join('+')
        return `${m.modeId}:${desc}`
      })
    : []

  const segments: string[] = []
  if (ratios.length) {
    const shownRatios = ratios.slice(0, 6)
    const rendered = shownRatios.map((r) => `${r}${r === defaultRatioLabel ? '*' : ''}`).join(',')
    const overflow = ratios.length > shownRatios.length ? `,+${ratios.length - shownRatios.length}` : ''
    segments.push(`比例 ${rendered}${overflow}${pixelMapped ? '(像素档)' : ''}`)
  }
  if (durationSpec) segments.push(`时长 ${durationSpec}`)
  if (resolutions.length) {
    segments.push(`清晰度 ${resolutions.slice(0, 4).map((r) => `${r}${r === defaultRes ? '*' : ''}`).join(',')}`)
  }
  if (slotParts.length) segments.push(`参考 ${slotParts.join(',')}`)
  return segments.length ? `${modelHandleOf(entry)}：${segments.join(' | ')}` : ''
}

/**
 * 用户眼里这个模型叫什么：渲染层随这条消息一起给的 `displayName`（卡上 / 模型框 / 设置里同一个名字），
 * 没给就退回目录的 `label`，再没有才是 modelId。**id 永远不当名字**——找不到名字时括号里照样把 id 标成 id。
 */
export function modelDisplayNameOf(context: Pick<LaneComposerContext, 'availableModels'>, vendor: string | null | undefined, modelId: string): string {
  const entry = (context.availableModels ?? []).find(item => item.modelId === modelId && (vendor === undefined || vendor === null || item.vendor === vendor))
  return entry?.displayName || entry?.label || modelId
}

/** 只有实时 resolver 的答案能声明缺省；目录增量 / 历史索引未读默认时不猜。 */
function formatDeclaredDefaults(defaults: LaneDeclaredDefaults | undefined, context: Pick<LaneComposerContext, 'availableModels'>): string[] {
  if (defaults === undefined) return []
  const lines = DEFAULT_LINE.map(([taskKind, label]) => {
    const declared = defaults[taskKind]
    return declared
      ? `${label}：${modelDisplayNameOf(context, declared.vendor, declared.modelId)}（${modelHandleOf(declared)}——仅供工具参数）`
      : `${label}：没有能用的已保存默认（含「自动选」）。`
  })
  const seenHandles = new Set<string>()
  const specLines: string[] = []
  for (const [taskKind] of DEFAULT_LINE) {
    const declared = defaults[taskKind]
    if (!declared) continue
    const handle = modelHandleOf(declared)
    if (seenHandles.has(handle)) continue
    seenHandles.add(handle)
    const entry = (context.availableModels ?? []).find((item) => item.modelId === declared.modelId && item.vendor === declared.vendor)
    if (!entry) continue
    const brief = formatModelCapabilityBrief(entry)
    if (brief) specLines.push(brief)
  }
  return [
    '用户的默认模型状态：',
    ...lines,
    ...specLines,
    '用户没点名模型时用默认；无默认从可用目录里挑并在回话里用显示名告诉用户挑了谁；以用户点名的为准；默认做不了先在回话里说清为什么换。只说它的显示名，不要念括号里的完整名字。',
  ]
}

function clipAmbientField(value: unknown, maxChars = 64): string {
  const str = String(value ?? '').replace(/\s+/g, ' ').trim()
  return str.length > maxChars ? `${str.slice(0, maxChars - 1)}…` : str
}

/**
 * 首轮活跃工作面与选中目标增量摘要（`contextSnapshot.handles` 由紧邻它的唯一 owner `formatAgentContextSnapshot` 负责投影与截断，这里不重复输出）。
 */
export function formatLaneAmbientFocus(
  context: Pick<LaneComposerContext, 'target' | 'admissionSurface' | 'documentId' | 'contextSnapshot'>,
): string {
  const target = context.target as Record<string, unknown> | undefined
  const surface = context.admissionSurface ?? (typeof target?.kind === 'string' ? target.kind : undefined)
  if (!surface && !context.documentId && !target) return ''

  const parts: string[] = []
  if (surface) parts.push(`surface=${clipAmbientField(surface, 32)}`)
  if (context.documentId) parts.push(`documentId=${clipAmbientField(context.documentId, 64)}`)
  if (target) {
    const listIds = (raw: unknown, cap: number) =>
      Array.isArray(raw) ? raw.slice(0, cap).map((id) => clipAmbientField(id, 64)).filter(Boolean) : []
    const nodeIds = listIds(target.nodeIds, 12)
    if (nodeIds.length) parts.push(`selectedNodes=[${nodeIds.join(',')}]`)
    const groupIds = listIds(target.groupIds, 8)
    if (groupIds.length) parts.push(`selectedGroups=[${groupIds.join(',')}]`)
    const clipIds = listIds(target.clipIds, 12)
    if (clipIds.length) parts.push(`selectedClips=[${clipIds.join(',')}]`)
    const assetIds = listIds(target.assetIds, 12)
    if (assetIds.length) parts.push(`selectedAssets=[${assetIds.join(',')}]`)
    if (typeof target.nodeId === 'string' && typeof target.resultId === 'string') {
      parts.push(`selectedResult=${clipAmbientField(target.nodeId, 48)}/${clipAmbientField(target.resultId, 48)}`)
    }
    const anchor = target.anchor as { kind?: unknown } | undefined
    if (typeof anchor?.kind === 'string') parts.push(`documentAnchor=${clipAmbientField(anchor.kind, 32)}`)
  }
  return parts.length ? `[Nomi active workspace focus] ${parts.join(' · ')}` : ''
}

/** A discovery index, not a second model contract. Full modes/slots stay behind the catalog read verb. */
export function formatLaneModelIndex(context: LaneComposerContext, defaults?: LaneDeclaredDefaults): string {
  const selected = context.model;
  const entries = (context.availableModels ?? []).filter(entry => entry.kind === 'image' || entry.kind === 'video');
  const lines: string[] = [];
  let kind = '';
  for (const entry of entries.slice().sort((a, b) => a.kind.localeCompare(b.kind) || a.modelId.localeCompare(b.modelId)
    || (a.vendor ?? '').localeCompare(b.vendor ?? ''))) {
    if (entry.kind !== kind) { kind = entry.kind; lines.push(`[${kind}]`); }
    const byResolution = new Map<string, string[]>();
    for (const mode of entry.modes) {
      const resolution = mode.params.find(param => param.key === 'resolution')?.options?.map(option => option.value).join(',') ?? '';
      const names = byResolution.get(resolution) ?? [];
      names.push(`${mode.modeId}${mode.modeId === entry.defaultModeId ? '*' : ''}`);
      byResolution.set(resolution, names);
    }
    const modes = [...byResolution].map(([resolution, names]) => `${names.join(',')}${resolution ? `[${resolution}]` : ''}`).join('/');
    lines.push(`${modelHandleOf(entry)}${entry.displayName ? `（显示名：${entry.displayName}）` : ''}: ${modes}`);
  }
  const declaredLines = formatDeclaredDefaults(defaults, context);
  if (!lines.length && !selected && !declaredLines.length) return '';
  return [
    '可用模型索引（完整名字: modeId[resolution]；* 是默认模式，逗号并列模式共用同一档位；draft_shots 的 model 原样抄冒号前的完整名字）：',
    ...(selected ? [`text ${modelHandleOf({ modelId: selected.modelKey, vendor: selected.vendorKey })}（当前对话）`] : []),
    ...lines,
    ...MODEL_ANCHOR_GUIDANCE,
    `这里只列图片/视频任务。完整类别、参数、参考槽与各模式约束：${MODEL_CATALOG_READ_VERB}（可用 model 缩小）；使用未列参数或参考边前先查。不要猜档位或混用不同模式参数。对用户提到模型时只说显示名（索引里「显示名：」那一个），不要念完整名字。`,
    ...declaredLines,
  ].join('\n');
}

function identity(entry: AgentModelEntry): string { return JSON.stringify([entry.vendor, entry.modelId, entry.kind]) }

/** Pure adjacent-snapshot projection: reopening or projecting a message twice cannot consume its delta. */
export function formatLaneModelDelta(context: LaneComposerContext, previous?: LaneComposerContext): string {
  if (!previous) return '';
  const before = new Map((previous.availableModels ?? []).map(entry => [identity(entry), JSON.stringify(entry)]));
  const after = new Map((context.availableModels ?? []).map(entry => [identity(entry), entry]));
  const changed = [...after].filter(([key, entry]) => before.get(key) !== JSON.stringify(entry)).map(([, entry]) => entry);
  const removed = (previous.availableModels ?? []).filter(entry => !after.has(identity(entry)));
  if (!changed.length && !removed.length) return '';
  return ['本回合模型目录变化（覆盖之前的同名条目；失效模型不可再用）：',
    ...(changed.length ? [formatLaneModelIndex({ ...context, availableModels: changed }),
      ...changed.filter(entry => entry.kind !== 'image' && entry.kind !== 'video').map(entry => `新增/更新 ${entry.kind} ${modelHandleOf(entry)}`)] : []),
    ...removed.map(entry => `失效 ${entry.kind} ${modelHandleOf(entry)}`),
  ].filter(Boolean).join('\n');
}
