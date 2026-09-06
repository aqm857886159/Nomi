// Agent 面板 v4 · 积木与状态的词表
//
// 真相源是 `docs/design/2026-09-06-agent-panel-v4.md`（用户 2026-09-06 拍板）：
// **只有 8 个积木**（用户气泡 · 助手文本 · 一行收据 · 任务卡 · 介入槽 · 队列行 · 收起坞 · composer），
// 其余全是这 8 个的**状态**。所以这里的每个 union 都挂在某一个积木上，不另立第九种东西。
//
// 权限档**不新造词**：画布上的「每步问 / 自动改 / 全自动」直接就是仓库合同
// `ProjectAgentApprovalPolicy.mode` 的三个值，spend 由 mode derive（定稿表 §2）。
// 早先那版把三档做成中文字面量 union（'每步问' | '自动改' | '全自动'），
// 既违反 R15（可见文字必须走 i18n），又凭空多了一份要和合同对齐的词表。
import type { ProjectAgentApprovalPolicy } from '../../../../electron/shared/projectAgentContracts'

/** AI Elements Tool 的七态协议（vendor/aiElementsContract.ts 是它的外部参照）。 */
export type V4ToolStatus =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-denied'
  | 'output-error'

/** 助手文本三态（定稿 Vocabulary 板 ②）：流式光标 · 完成（hover 出动作）· 已中断。 */
export type V4AssistantStatus = 'streaming' | 'complete' | 'interrupted'

/** 任务卡五态（定稿 Vocabulary 板 ④）。 */
export type V4TaskStatus = 'queued' | 'running' | 'complete' | 'failed' | 'stopped'

/** 介入槽的内容体（定稿 Vocabulary 板 ⑤）：一个组件，kind 不同。 */
export type V4InterventionKind =
  | 'approval-irreversible'
  | 'approval-reversible'
  | 'reject-reason'
  | 'spend'
  | 'question'
  | 'plan'
  | 'credential'
  | 'deviation'

/**
 * 一行收据 / 任务卡 / 思考行的 icon 家族（定稿 Process 板「icon ↔ 动词」表）。
 * icon 标的是**动的那个对象**（文稿 / 时间轴 / 节点 / 图 / 视频 / 音频），不是工具名。
 */
export type V4ActionFamily =
  | 'think'
  | 'document'
  | 'timeline'
  | 'canvas'
  | 'search'
  | 'write'
  | 'image'
  | 'video'
  | 'audio'
  | 'edit'
  | 'transition'
  | 'skill'
  | 'plan'
  | 'export'
  | 'attachment'
  | 'layout'
  | 'spend'
  | 'credential'
  | 'question'

/** composer 的三种视图上下文（空闲 / 运行中排队 / 带引用 chip）。 */
export type ComposerMode = 'idle' | 'running' | 'reference'

/** 权限三档 = 合同里的 approvalPolicy.mode，不是第二份词表。 */
export type PermissionTier = ProjectAgentApprovalPolicy['mode']

/** composer 底栏可弹的三个层，一次只开一个。 */
export type ComposerPopover = 'model' | 'skill' | 'permission'

export type V4ChipKind = 'file' | 'skill' | 'clip'
export type V4Chip = Readonly<{ kind: V4ChipKind; label: string }>

export type ToolReceipt = Readonly<{
  /** 人话动词 + 对象，例如「读取时间轴」。 */
  label: string
  action: V4ActionFamily
  status: V4ToolStatus
  /** 行中摘要（「3 段 · 9.0s」）。 */
  summary?: string
  /** 行尾用时或原因。 */
  trailing?: string
  /** 展开体：输入 / 输出。只有「还有内容可看」才带 ›。 */
  input?: string
  output?: string
  expanded?: boolean
  /** 可撤销的改动在行尾多一个「撤销」。 */
  undoable?: boolean
}>

export type TaskCandidate = Readonly<{ tag: string; adopted?: boolean; pending?: boolean }>

export type TaskCardData = Readonly<{
  title: string
  action: V4ActionFamily
  status: V4TaskStatus
  /** 卡头右端的计数 / 用时 / 花费。 */
  trailing?: string
  /** 提示词摘录，最多 2 行。 */
  excerpt?: string
  /** 参数 chip（模型 / 画幅 / 分辨率 / 预估花费）。 */
  params?: readonly string[]
  cost?: string
  progress?: number
  candidates?: readonly TaskCandidate[]
  /** 失败时的一句话原因 + 一个动作。 */
  error?: string
  errorAction?: string
  footnote?: string
  /** 卡尾右端的第二个数（画布 FlowGeneration 板的「已花 ¥0.24」）。 */
  footnoteTrailing?: string
  undoable?: boolean
}>

export type PlanRow = Readonly<{ label: string; detail?: string; checked: boolean }>

export type InterventionData = Readonly<{
  kind: V4InterventionKind
  title: string
  /** 槽头右端的小字（「不可逆」「可撤销」「付费」「≈ ¥0.48」）。 */
  badge?: string
  summary?: string
  scope?: string
  params?: readonly string[]
  options?: readonly string[]
  selectedOption?: number
  plan?: readonly PlanRow[]
  /** 「不要」之后渐进披露的拒绝原因输入。 */
  reasonPlaceholder?: string
  confirmLabel?: string
  /** 第二动作（「改一下」「换模型」「去配置」）。 */
  alternateLabel?: string
}>

export type QueueRowData = Readonly<{
  title: string
  status: 'queued' | 'running' | 'complete'
  /** 行尾动作（插队 / 删 / 立即中断）。 */
  actions?: readonly string[]
  destructiveAction?: string
}>

export type ContextUsage = Readonly<{
  used: number
  max: number
  input: string
  output: string
  reasoning: string
  cache: string
  cost: string
}>

/**
 * 三档 → 合同两个字段。定稿 §2：「每步问」= 改动/花钱/计划都先问；「自动改」= 可撤销改动直接做、
 * 付费仍逐次问；「全自动」= 预算内都不问。介入槽的「不再问 →」= 当场抬到下一档。
 */
export const PERMISSION_POLICIES: Readonly<Record<PermissionTier, ProjectAgentApprovalPolicy>> = {
  step: { mode: 'step', spend: 'confirm' },
  'safe-auto': { mode: 'safe-auto', spend: 'confirm' },
  project: { mode: 'project', spend: 'within-budget' },
}

/** 档位顺序，用于「不再问 →」抬一档。 */
export const PERMISSION_TIERS: readonly PermissionTier[] = ['step', 'safe-auto', 'project']

/** 默认「自动改」（定稿 §2，与 DEFAULT_PROJECT_AGENT_APPROVAL_POLICY 同值）。 */
export const DEFAULT_PERMISSION_TIER: PermissionTier = 'safe-auto'
