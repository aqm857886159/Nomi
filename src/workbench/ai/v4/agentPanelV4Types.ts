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
import type { PlanRow } from '../../shared/PlanRows'
import type { LaneAssistantFault } from '../../../../electron/shared/agentLane/laneAssistantFault'
import type { V4AskQuestion } from './agentPanelV4AskModel'
import type { V4QuestionOption } from './agentPanelV4Question'

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
   * 「本该出现一张确认卡，但它没有渲染出来」（2026-09-12）。
   *
   * 它不是一种审批档，是**那条链断了的样子**。宿主投影、工具结果、系统提示词里那句
   * 「此动作会向用户确认」——任何一处**声称**有一张卡在等用户，而槽里什么都没画出来，
   * 就渲这一张，把断在哪里写在脸上。以前那些地方一律 `return undefined`，于是用户
   * 看到的是「模型说请在确认卡里批准」+ 一片空白，只能去猜是不是坏了（2026-09-11 真实反馈）。
   */
  | 'missing-card'

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
export type V4Chip = Readonly<{ reference?: { url: string; kind:'image'|'video'|'audio'; index:number }; id?: string; kind: V4ChipKind; label: string; description?: string; cover?: string; preview?: { url: string; type: 'image' | 'video' } }>

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
  /** 展开体：给人看的回包正文（没有原始入参 / JSON，见 laneViewModel）。只有「还有内容可看」才带 ›。 */
  output?: string
  expanded?: boolean
  /** 可撤销的改动在行尾多一个「撤销」。 */
  undoable?: boolean
  /**
   * 这一行是**答完的反问**（`laneViewModel` 是唯一产地）。
   *
   * 协议上它仍然是 `output-denied`（lane 只有准 / 不准，带话的 deny 是今天唯一能把一句话
   * 原样送回模型的路），但用户没有拒绝任何东西——他回答了一个问题。所以这一行不红、
   * 不打 ×，读作「已回答 · <他的答案>」。加一个 `V4ToolStatus` 成员会让那个 union 偏离
   * 它登记在案的外部参照（AI Elements 七态），而这一行要改的本来就只是**怎么读**。
   */
  answered?: true
  /**
   * 宿主确定性给出的一句提示（不是模型说的）：今天只有 3D-BOX 补丁覆盖了用户手调时的
   * 「这次改动覆盖了你在镜头 2 的手调，可撤销」（useDirectorPatchNotices 是唯一产地）。
   * 它画在这一行流水**外面**，收起的过程行也照样看得见。
   */
  notice?: string
  /**
   * 这一行是 `generate` 交出去的那一次出价（工具结果信封里的 `operationId`，`laneViewModel` 是唯一产地）。
   * 卡关掉以后，收据下面挂那几镜的组指向（实时读节点，点了照样定位；SpendCardQ1 板 card.done），画在流水行外面、
   * 不随过程行收起。卡还开着时不挂（那几镜在卡上）。
   */
  generation?: Readonly<{ operationId: string }>
}>

export type TaskCandidate = Readonly<{ tag: string; pending?: boolean } & Partial<LaneTaskCandidate>>

/**
 * 任务卡。**没有金额位**（2026-10-27）：设计系统「钱只印一处」，界面不印合计数量或金额。
 * 定稿板上卡头的「预估」胶囊和卡尾的「已花」两个字段随之删了——车道这一路印出来的是账本合计，
 * 只加已知价、实付从不回写，卡尾那个数恒为零。
 */
export type TaskCardData = Readonly<{
  title: string
  action: V4ActionFamily
  status: V4TaskStatus
  /** 卡头右端的计数 / 用时。 */
  trailing?: string
  /** 提示词摘录，最多 2 行。 */
  excerpt?: string
  /** 参数 chip（模型 / 画幅 / 分辨率）。 */
  params?: readonly string[]
  progress?: number
  candidates?: readonly TaskCandidate[]
  /** 失败时的一句话原因 + 一个动作。 */
  error?: string
  errorAction?: string
  footnote?: string
  undoable?: boolean
}>

/**
 * 计划卡的一行。`group`：这一行所属的一组（「参考卡 2 张」「镜头 4 个」）——相邻行 group 不同时在它前面印一条小标题。
 * `aside`：同一行右端的灰色小字（模型名），不另起一行——单行一项，6 项不用滚。
 * 分镜表「生成剩余」的确认框用它们分阶段（参考卡先、镜头后）；别处不传 = 不分组，长相与以前一字不差。
 */
export type { PlanRow }

export type InterventionData = Readonly<{
  kind: V4InterventionKind
  title: string
  /** 槽头右端的小字（「不可逆」「可撤销」「付费」「≈ ¥0.48」）。 */
  badge?: string
  summary?: string
  scope?: string
  params?: readonly string[]
  /**
   * 反问的选项。**模型自己写**（标签 + 一句说明 + 可标推荐），形状与解析在
   * `agentPanelV4Question.ts`——那是这条交互的对外契约，不为某一种问题写死。
   */
  options?: readonly V4QuestionOption[]
  /**
   * 多题时的题目表（Approval Card 的「一张卡、若干题、一次一题」）。
   *
   * **缺席 = 一题**，由 `askCardQuestions()` 从 `title` / `options` / `summary` 摊成长度 1，
   * 页码因此自动不显示。今天永远缺席：对外契约（`electron/shared/agentCapabilities/askUser.ts`
   * 的 `askUserInputSchema`）一次只收一题，没有生产者写得出第二题。留着这个字段是因为
   * 卡的整件里本来就有多题，把它从组件里砍掉等于下次要多题时重拼一张卡。
   */
  questions?: readonly V4AskQuestion[]
  selectedOption?: number
  /**
   * 卡挂载时那一行里已经有的字。**缺席 = 空**，这也是生产侧唯一的取值。
   *
   * 它存在是为了让「正在打字」这一态在设计实验室里**画得出来**：那一行的值是组件自己的
   * state（它还没提交，不该进 store），而实验室是静态取景，没有手去敲键盘。同一个理由下
   * `reject-reason` 早就是一个独立 kind（把渐进披露的第二步固定下来），这一条是同一套做法。
   * 不拿它给用户预填答案——替他把话写好，他就只能顺着改（D1）。
   */
  answerDraft?: string
  plan?: readonly PlanRow[]
  /**
   * 付费卡的逐镜价格折叠（SpendCardQ1 板 card.per-shot，D5）：只在各镜价格不同时出现，展开每镜一行
   * （镜号 · 模型 · 比例 · 时长 + 那一镜的价）。各镜同价、或有一镜算不出时整块不出——合计金额哪里都不印。
   * 数只有一个产地（节点按画布批量估价同一个函数算出的价），这里只负责印。
   */
  price?: Readonly<{
    perItem: readonly Readonly<{ label: string; amount: string }>[]
    /** 折叠口那句话（「逐镜 · 3 镜」）。 */
    perItemLabel: string
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
  /** 主按钮前的图标：`locate` = 这一下是去画布上那个节点（付费卡「去改镜 N」「去看镜 N」，板 card.failure.go-edit）。 */
  confirmIcon?: 'locate'
  /** 第二动作（「改一下」「换模型」「去配置」）。 */
  alternateLabel?: string
  /**
   * 决定栏那颗文字否定钮换个说法（付费卡失败时是「先不发了」：收回剩下的出价，板 card.failure.decline）。
   * 缺席 = 「取消」。它做的事不变：拒绝 / 收回 / 停下。
   */
  dismissLabel?: string
  /**
   * 卡上的动作已经交出去、正在一段一段走（付费卡「正在发出 k/N 段」，板 card.progress）：动作行不再摆主按钮，
   * 只印这一句（怎么停下）+「取消」；标题前是转圈，卡不装成还在等人点（外框回到普通纸面）。
   */
  progress?: Readonly<{ hint: string }>
  /**
   * 这张卡在说一件没成的事（付费卡某一镜没发出去 / 参数被拒 / 结果不确定，板 card.failure）：标题前一个警示图标、外框换警示色。
   * 失败留在卡里，不弹第二张卡、不只靠一条会飘走的提示。
   */
  failed?: true
  /**
   * 卡上有一下动作正在路上（付费卡「生成」还没回来）：主按钮置灰——这一两秒里再点它本来就不会生效，
   * 置灰是让「不生效」看得见，而不是点了没反应。否定钮不在其中：它任何时候都能停。
   */
  actionsDisabled?: true
}>

/** 翻页器那一格（反问卡多题时的 `‹ 2/4 ›`）。只有一项时调用方不传，整行不渲染。 */
export type V4PagerState = Readonly<{ index: number; total: number }>

/**
 * 对话流里的一条 = 一个积木。壳不认识内容，只按 `kind` 派发。
 *
 * 这里**没有** `suggestion`（2026-09-21 按 P1 删）：它曾是「缺参数」想象中的第二个家
 * ——助手文本 + 一排 chip，长在对话流里。但缺参数 2026-09-12 起就走介入槽的反问卡了
 * （`interventionKindOf`），这一支从此**零生产者**：类型在、组件在、`AgentPanelV4Panel`
 * 里的分支也在，只是全仓没有任何一行代码构造得出它。反问已经有家了，这是第二份。
 */
export type V4FlowItem = { readonly identity?: string } & (
  | { kind: 'user'; text: string; chips?: readonly V4Chip[] }
  // 一回合**一个**气泡：模型一轮回复在传输上是「一条消息里的若干块」（text / tool-call / text…），
  // 一块一个气泡等于把一个人说的一段话切成三句话（`laneViewModel.mergeAssistantTextPerTurn` 是唯一产地）。
  // `skill` = 这一轮挂着的技能名，印在气泡头上当凭据；缺席 = 这一轮没挂技能，不是「不知道」。
  | { kind: 'assistant'; text: string; status: V4AssistantStatus; continuationEntryId?: string; retryInputEntryId?: string; skill?: string }
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
  | {
      kind: 'process'; label: string; segments: readonly string[]; running?: boolean; toolCount?: number; retries?: number; elapsed?: string
      /** 这一段里有**还没解决**的失败（只在回合落定后才为真）。带它的过程行默认展开——
       *  定稿要求「错误留在它那一行」，而收起的过程行会把那一行连同红条一起藏掉。 */
      failed?: true
      /** 回合**进行中**、这一步正在重来时，展开过程行才看见的那句灰字。 */
      retryNote?: string
      details?: readonly { item: V4FlowItem; index: number }[]
    }
  | { kind: 'task'; task: TaskCardData }
  | {
      kind: 'error'; reason: string; action?: string
      /** 错误已被自动重试化解：画成一行灰字，不是红卡。 */
      recovered?: true
      /** 服务商原始报文（只给 effect 记日志用，不进界面）与 pi 的「瞬时」判断。 */
      raw?: string
      transient?: true
      /** 看门狗 / pi 自己判的那几类（不是服务商原话）；在就不记「认不出」日志。 */
      fault?: LaneAssistantFault
    }
)

export type QueueRowData = Readonly<{
  title: string
  status: 'queued' | 'running' | 'complete' | 'draft'
  /** 行尾动作（插队 / 删 / 立即中断）。 */
  actions?: readonly string[]
  actionsDisabled?: boolean
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
 * 两档 → 合同的 `mode`（2026-10-12 用户拍板：请求批准 / 直接生成；旧「每步问 / 自动改 / 全自动」已删，
 * 旧值的迁移只在主进程 `normalizeAgentApprovalPolicySettings` 一处）。
 *
 * 档位只是「词 → 合同」的映射；谁来判「花钱要不要问」不在这里：带 Run 的入口只有
 * `directGenerationBrakes.spendDecisionByPolicy`（档位 + 两个刹车）。这里没有第二个答案。
 */
export const PERMISSION_POLICIES: Readonly<Record<PermissionTier, ProjectAgentApprovalPolicy>> = {
  request: { mode: 'request' },
  direct: { mode: 'direct' },
}

/** 档位顺序（面板上从左到右）。 */
export const PERMISSION_TIERS: readonly PermissionTier[] = ['request', 'direct']

/** 默认「请求批准」。 */
export const DEFAULT_PERMISSION_TIER: PermissionTier = 'request'
