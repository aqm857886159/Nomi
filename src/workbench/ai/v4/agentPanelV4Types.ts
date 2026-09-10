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
import type { ProjectAgentApprovalPolicy } from '../../../../electron/shared/agentCapabilities/capabilityApprovalPolicy';
import type { LaneTaskCandidate, LaneTaskStatus } from '../../../../electron/shared/agentLane/laneContracts'

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

/**
 * 任务卡五态（定稿 Vocabulary 板 ④）。**owner 在中立契约层**，这里只是它在 v4 词表里的名字。
 *
 * 为什么 owner 在那边而不是这边：这五个词现在是**跨进程**的——主进程从 ProductionRun 领域
 * join 出来的事实里就带着它（`LaneTaskFacts.status`），渲染层照着画。两侧各写一份字面量
 * union，就得再写一张两份之间的映射表，而那张表正是 R14.1 要横扫的「同一语义两份定义」；
 * 而且 `electron/` 不许 import `src/`（`check:boundaries`），所以能容下这个 owner 的只有
 * `electron/shared/`。名字留在这里，是因为 v4 的组件按 `V4*` 这套词表读。
 */
export type V4TaskStatus = LaneTaskStatus

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
export type V4Chip = Readonly<{ kind: V4ChipKind; label: string; description?: string; cover?: string; preview?: { url: string; type: 'image' | 'video' } }>

export type ToolReceipt = Readonly<{
  /** Exact call identity for row actions; never an authorization record. */
  toolCallId?: string
  /** Host identity for turn timing; never displayed. */
  turnId?: string
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

export type TaskCandidate = Readonly<{ tag: string; pending?: boolean } & Partial<LaneTaskCandidate>>

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

export type PlanRow = Readonly<{ label: string; detail?: string; technical?: string; checked: boolean }>

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
  /**
   * 付费卡的**价格行**（形态 9 · B-02「逐项单价 + 合计」）。
   *
   * 为什么它是一个字段而不是几个散字段：这一行说的是**同一件事**——「这次要花多少、怎么算出来的」。
   * 拆成 breakdown/total/unavailable 三个平级可选字段，第一个把 total 填了却忘了 breakdown 的人
   * 就会渲出一个没有来路的数字，而那正是付费卡最不该有的东西。
   *
   * `total` 缺 = **这次算不出价格**（中转/自建端点没有价目是常态）。那时渲的是 `unavailable` 那句话，
   * 绝不落成 `¥0`——印 0 等于对用户说「这次免费」，是三种可能里唯一错得离谱的那一种。
   *
   * 2026-09-10 用户拍板：参数在卡上可改，所以这一行必须**随参数原地刷新**。数只有一个产地
   * （报价），这里只负责印。
   */
  price?: Readonly<{
    /** 怎么算出来的（「4 段 × 3s · 标准画质 · ¥0.10/秒」）。 */
    breakdown: string
    /** 合计的标签（「合计」）。它必须有地方放：合计紧跟算式时，两个 ¥ 数字挨着会读不出谁是谁
     *  （现役 P0 件 11 的病灶就是这个标签无处安放，见 09-06 不一致清单 B5）。 */
    totalLabel?: string
    /** 合计。缺 = 算不出。 */
    total?: string
    /** 算不出时印的那句话（现役是「暂时算不出价格」）。 */
    unavailable?: string
    /** 批量时逐项摊开的那几行。空 = 不出这个折叠口。 */
    perItem?: readonly Readonly<{ label: string; amount: string }>[]
    /** 折叠口那句话（「逐镜 4」）。 */
    perItemLabel?: string
  }>
  /**
   * 卡顶右侧的翻页器（`‹ 2/4 ›`）。
   *
   * 一批要生成的镜头**一镜一张卡**（2026-09-10 用户拍板：「后面还有卡就左右翻」）。
   * 为什么不摊成 4 张卡竖着排：那样提示词框会把转录顶到几屏之外，而用户此刻要做的
   * 只有一件事——逐条看过去。翻页把「同一件事的第 N 项」压在同一个位置上，
   * 眼睛不用重新找。缺省 = 只有一项，不渲染翻页器。
   *
   * 2026-09-10 v3：翻页器从槽头搬到**动作行**，因为它现在还决定主按钮上印的那个数
   * （`scope` 在「逐镜」时印这一页的价，在「全部」时印合计）。改一个数的控件，
   * 得和那个数放在同一处。
   */
  pager?: Readonly<{
    index: number
    total: number
    /**
     * 范围切换：这一镜，还是全部。
     *
     * v2 把「全部生成 ¥1.20」做成动作行上的**第二颗文字按钮**，v3 拿掉了——
     * 2026-09-10 拍板的按钮规则是「一屏一个主动作、批量不是第二颗文字按钮」。
     * 批量本来也不是第二个决定，它是同一个决定（生成）的**范围**；
     * 范围该长成一个切换，切完主按钮自己改口。缺省 = 单镜卡，不渲染。
     */
    scope?: Readonly<{
      value: 'each' | 'all'
      eachLabel: string
      allLabel: string
      ariaLabel: string
    }>
    /**
     * 键盘翻页提示（「←→」这种极小字）。
     *
     * 卡聚焦时左右方向键翻页；提示只用两个箭头字符，占不到 20px——
     * 写成一整句「按左右键翻页」就是让用户多读一行（D1）。
     */
    keyHint?: string
  }>
  /**
   * 槽头不画那颗 icon。
   *
   * 2026-09-10 用户拍板：切「全自动」那张确认卡标题左边的对勾要删掉。
   * 它是 `approval-reversible` 档统一的「可撤销」记号，而这张卡的标题是一句**问句**
   * （「切到全自动？」）——问句前面顶着一个 ✓ 读起来像「已经切好了」，
   * 记号和它要说的事正好相反。
   */
  hideIcon?: true
  /** 「不要」之后渐进披露的拒绝原因输入。 */
  reasonPlaceholder?: string
  confirmLabel?: string
  /** 第二动作（「改一下」「换模型」「去配置」）。 */
  alternateLabel?: string
}>

/**
 * 对话流里的一条 = 一个积木。壳不认识内容，只按 `kind` 派发。
 *
 * `suggestion` 是**缺参数**那一档的家（2026-09-06 拍板 ④）：它不是第九个积木，
 * 而是「助手文本 + 一排选项 chip」两件已有件的组合——缺参数不该占用介入槽，
 * 那个槽是给「要不要让我做」这类问题的，而缺参数只是 Nomi 少问了一句话。
 * 用户点 chip 或直接在 composer 里回答，两条路都回填同一个参数。
 */
export type V4FlowItem =
  | { kind: 'user'; text: string; chips?: readonly V4Chip[] }
  | { kind: 'assistant'; text: string; status: V4AssistantStatus; continuationEntryId?: string }
  | { kind: 'thinking'; label: string; meta: string; text?: string; streaming?: boolean }
  | { kind: 'tool'; receipt: ToolReceipt }
  // 同一个工具连着调 N 次时，N 行收据折成的那一行（`agentPanelV4Collapse.ts` 是唯一产地）。
  // 它**不是**第九个积木：展开体里逐条渲染的就是普通的一行收据。
  | {
      kind: 'tool-group'
      label: string
      action: V4ActionFamily
      status: V4ToolStatus
      count: number
      /** 行尾那句「全部失败 / 3 次失败 / 全部完成」。 */
      trailing: string
      /** 第一条失败的原因短句。全成功时没有。 */
      reason?: string
      receipts: readonly ToolReceipt[]
    }
  // 反复试的过程里，模型说给自己听的那几段。收起态就是助手文本的一个状态。
  | { kind: 'process'; label: string; segments: readonly string[]; running?: boolean; toolCount?: number; retries?: number; elapsed?: string; details?: readonly { item: V4FlowItem; index: number }[] }
  | { kind: 'task'; task: TaskCardData }
  | { kind: 'suggestion'; text: string; options: readonly string[] }
  | { kind: 'error'; reason: string; action?: string }

export type QueueRowData = Readonly<{
  title: string
  status: 'queued' | 'running' | 'complete'
  /** 行尾动作（插队 / 删 / 立即中断）。 */
  actions?: readonly string[]
  destructiveAction?: string
}>

/**
 * 上下文环的数据。**每一项都可缺**——这是本类型最重要的一条。
 *
 * 现役面板头上那句「还能聊 ~40 轮」是 `Math.max(1, 40 - sessionTurns)`，一个写死的常数
 * 减法，不是任何真实用量。换掉它的意义就在于「印出来的数都是量出来的」，所以宿主没给的
 * 分项一律 `undefined` = **那一行不渲染**，不是 `?? 0`：
 *   - `max` 缺   → 环画灰、不给百分比（模型目录没写 contextWindow 就是没写）
 *   - `reasoning` 缺 → 供应商没报推理 token（多数不报），整行不出现
 *   - `cost` 缺  → 运行时对这个模型没有价目（中转/自建端点常见），不印 ¥0.00
 * 组件侧 `undefined` 一律「不渲染那一件」，单测钉死这条，防止以后有人拿 `?? 0` 糊回去。
 */
export type ContextUsage = Readonly<{
  used?: number
  max?: number
  input?: string
  output?: string
  reasoning?: string
  cache?: string
  cost?: string
}>

/**
 * 三档 → 合同两个字段。定稿 §2：「每步问」= 改动/花钱/计划都先问；「自动改」= 可撤销改动直接做、
 * 付费仍逐次问；「全自动」= **可撤销的改动都不问**。介入槽的「不再问 →」= 当场抬到下一档。
 *
 * ⚠️ **`spend` 这根轴三档都是 `confirm`**（2026-09-10 用户拍板：「钱的闸 = 每次提交看报价确认」，
 * 同时删掉了设置里的硬预算上限）。合同里两根轴本来就是**故意分开**的
 * （`capabilityApprovalPolicy.ts`：“kept independent deliberately”），把 `spend` 折进档位就等于
 * 让「全自动」顺手把付费也放行——而全自动的定义恰恰是「没人看着的时候连着做」，
 * 那正是最不该自动花钱的一刻。全自动免掉的只有 `reversible_local` 的逐次确认。
 *
 * 早先 `project` 档写的是 `within-budget`，配套的是一个「项目预算上限」设置；那条设置已删，
 * 于是 `within-budget` 变成了一张没有额度的通行证——留着它就是留一个只在账单上看得见的洞。
 */
export const PERMISSION_POLICIES: Readonly<Record<PermissionTier, ProjectAgentApprovalPolicy>> = {
  step: { mode: 'step', spend: 'confirm' },
  'safe-auto': { mode: 'safe-auto', spend: 'confirm' },
  project: { mode: 'project', spend: 'confirm' },
}

/** 档位顺序，用于「不再问 →」抬一档。 */
export const PERMISSION_TIERS: readonly PermissionTier[] = ['step', 'safe-auto', 'project']

/** 默认「自动改」（定稿 §2，与 DEFAULT_PROJECT_AGENT_APPROVAL_POLICY 同值）。 */
export const DEFAULT_PERMISSION_TIER: PermissionTier = 'safe-auto'
