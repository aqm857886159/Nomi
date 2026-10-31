/**
 * 卡顿时间线的中立契约：行形状（白名单）、渲染层 → 主进程的报文形状、各处共用的门槛。
 * 渲染层（只依赖这里）、主进程时间线（写 / 读）、诊断包（读）都吃这一份。
 *
 * 隐私靠形状，不靠事后脱敏：每个字段的取值都是**封闭集合**（枚举 / 有界整数 / 布尔），
 * 没有任何一个字段装得下字符串，所以路径、提示词、项目名**没有位置可以进来**。
 * 页面和节点数档位直接取 `perf.session.summary` 那份取值表（`PERF_FIELD_VALUES`），口径同源、不另起一套。
 * 这份数据只写在用户本机；用户自己「导出诊断包」才会给到我们，不进遥测、不改告知范围。
 */
import { PERF_FIELD_VALUES } from './perfTelemetry'

export const STALL_ROW_KINDS = ['main-stall', 'window-unresponsive', 'window-responsive', 'renderer-long-frame', 'stall-summary'] as const
export type StallRowKind = (typeof STALL_ROW_KINDS)[number]

export type StallPage = (typeof PERF_FIELD_VALUES.page)[number]
export type StallNodes = (typeof PERF_FIELD_VALUES.nodes)[number]
/** 「当时在哪一页 / 有没有生成在跑 / 工程多大」——口径同 `readPerfScene()`，取值同 `PERF_FIELD_VALUES`。 */
export type StallScene = { page: StallPage; nodes: StallNodes; generating: boolean }

export type StallRow = {
  /** UTC ISO 时间。main-stall 精确到读数窗口末尾（10 秒一读）。 */
  t: string
  kind: StallRowKind
  /** 时长（毫秒，整数）。 */
  ms?: number
  /** main-stall：≥1000ms 标冻结。 */
  frozen?: boolean
  /** stall-summary：这一分钟内看到的行数（写下的加被限频略掉的）。 */
  count?: number
  page?: StallPage
  nodes?: StallNodes
  generating?: boolean
}

/** 每种行允许的字段：必有 + 可有。行里出现这之外的任何键，整行不合格。 */
export const STALL_ROW_FIELDS: Record<StallRowKind, { required: readonly (keyof StallRow)[]; optional: readonly (keyof StallRow)[] }> = {
  'main-stall': { required: ['t', 'kind', 'ms', 'frozen'], optional: ['page', 'nodes', 'generating'] },
  'window-unresponsive': { required: ['t', 'kind'], optional: ['page', 'nodes', 'generating'] },
  'window-responsive': { required: ['t', 'kind'], optional: ['ms', 'page', 'nodes', 'generating'] },
  'renderer-long-frame': { required: ['t', 'kind', 'ms', 'page', 'nodes', 'generating'], optional: [] },
  'stall-summary': { required: ['t', 'kind', 'ms', 'count'], optional: [] },
}

export const STALL_MAX_MS = 86_400_000
export const STALL_MAX_COUNT = 1_000_000
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

const isBoundedInt = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max

function fieldOk(key: keyof StallRow, value: unknown): boolean {
  switch (key) {
    case 't': return typeof value === 'string' && ISO_UTC.test(value) && Number.isFinite(Date.parse(value))
    case 'kind': return typeof value === 'string' && (STALL_ROW_KINDS as readonly string[]).includes(value)
    case 'ms': return isBoundedInt(value, STALL_MAX_MS)
    case 'count': return isBoundedInt(value, STALL_MAX_COUNT)
    case 'frozen': case 'generating': return typeof value === 'boolean'
    case 'page': return typeof value === 'string' && (PERF_FIELD_VALUES.page as readonly string[]).includes(value)
    case 'nodes': return typeof value === 'string' && (PERF_FIELD_VALUES.nodes as readonly string[]).includes(value)
    default: return false
  }
}

/** 白名单校验：键集合必须落在这一种行的「必有 + 可有」里、必有的都在、每个值都在封闭集合里。通过才给回同一个对象。 */
export function parseStallRow(raw: unknown): StallRow | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const kind = row.kind
  if (typeof kind !== 'string' || !(STALL_ROW_KINDS as readonly string[]).includes(kind)) return null
  const spec = STALL_ROW_FIELDS[kind as StallRowKind]
  const allowed = new Set<string>([...spec.required, ...spec.optional])
  for (const key of Object.keys(row)) {
    if (!allowed.has(key)) return null
    if (!fieldOk(key as keyof StallRow, row[key])) return null
  }
  if (!spec.required.every((key) => key in row)) return null
  return row as StallRow
}

// ── 渲染层 → 主进程（一条单向 IPC，批量，不等回话）────────────────────────────────────────────
export const STALL_REPORT_CHANNEL = 'nomi:diagnostics:stall-report'
/** 渲染层长帧进时间线的门槛（INP「良好」的边界）。 */
export const STALL_RENDERER_FRAME_MIN_MS = 200
/** 渲染层两批之间至少隔这么久；一批最多这么多帧（挑最长的）。 */
export const STALL_REPORT_MIN_GAP_MS = 30_000
export const STALL_REPORT_MAX_FRAMES = 20
/** 渲染层多久读一次场景（只在变了才发）。 */
export const STALL_SCENE_POLL_MS = 5_000

export type StallReportFrame = { endedAtMs: number; ms: number; scene: StallScene }
export type StallReport = { scene?: StallScene; longFrames?: StallReportFrame[] }
