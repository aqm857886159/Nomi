// 设计实验室 · Agent 面板 v4 · **Vocabulary 板**（8 个积木 × 各自的状态）
//
// 取景框是 `Piece`：这一组每一格只渲**那一个积木**，因为定稿 Vocabulary 板画的就是
// 单件的状态阵列。整块面板归 `03-flow.tsx`。
//
// 顺序有意义：`labStates.mjs` 按本屏目录里 `NN-*.tsx` 的文件名排序解析，汇总口按同样顺序拼接，
// 走查再拿活页面的 `window.__designLabStates` 与解析结果逐项比对——三者对不上当场红。
import React, { type JSX } from 'react'
import type { LaneSnapshot } from '@earendil-works/pi-agent-core'
import { IconBrowser, IconSettings } from '../../../../vendor/tablerIcons'
import { V4Intervention, V4Queue, V4TaskCard } from '../../../../workbench/ai/v4/AgentPanelV4Cards'
import { V4ContextRing } from '../../../../workbench/ai/v4/AgentPanelV4Context'
import { AgentTopbarChip } from '../../../../ui/app-shell/AgentTopbarChip'
import { agentTopbarChipBadge } from '../../../../ui/app-shell/agentTopbarChipBadge'
import { TooltipProvider } from '../../../../design'
import { dockStatusLabel, type V4DockStatus } from '../../../../workbench/ai/v4/agentPanelV4DockStatus'
import { V4AssistantMessage, V4Thinking, V4UserBubble } from '../../../../workbench/ai/v4/AgentPanelV4Message'
import { V4ErrorBar, V4ToolReceipt } from '../../../../workbench/ai/v4/AgentPanelV4Receipt'
import { V4FlowRow } from '../../../../workbench/ai/v4/AgentPanelV4Panel'
import { useV4Labels } from '../../../../workbench/ai/v4/agentPanelV4Labels'
import type { ToolReceipt, V4AssistantStatus } from '../../../../workbench/ai/v4/agentPanelV4Types'
import { formatMoney } from '../../../../workbench/ai/v4/formatMoney'
import { Piece, useV4Fixtures, useV4Locale, V4_LAB_SLOT_HANDLERS } from '../agentPanelV4LabKit'
import type { LaneViewModelLabels } from '../../../../workbench/ai/lane/laneViewModel'
import { providerFailureText } from '../../../../workbench/ai/lane/laneCommandFailure'
import { laneDrivenReceipt, laneSnapshotQuestionAnswered, laneSnapshotToolDenied, laneSnapshotToolRunning } from '../laneDrivenFixtures'
import type { LabState } from '../../labScreen'


function UserCell({ withChip }: { withChip: boolean }): JSX.Element {
  const fx = useV4Fixtures()
  return (
    <Piece>
      <V4UserBubble
        text={withChip ? fx.t('agentPanelV4.fixtureUserRestyle') : fx.t('agentPanelV4.fixtureUserTrim')}
        chips={withChip ? [fx.chips.attachment] : undefined}
      />
    </Piece>
  )
}

function AssistantCell({ status }: { status: V4AssistantStatus }): JSX.Element {
  const fx = useV4Fixtures()
  const labels = useV4Labels()
  const text =
    status === 'streaming'
      ? fx.t('agentPanelV4.fixtureAssistantThinking')
      : status === 'interrupted'
        ? fx.t('agentPanelV4.fixtureAssistantInterrupted')
        : fx.t('agentPanelV4.fixtureAssistantAsk')
  return (
    <Piece>
      {/* 取景要看见完成态那两颗钮，而组件从 2026-09-14 起「接了才画」——所以这里把三个动作
          显式接成空操作。实验室是**取景台**，它要证明的是这一格长什么样；「宿主没接会怎样」
          由 `agentPanelV4Blocks.test.ts` 断言，不靠这一格的缺省来表达。 */}
      <V4AssistantMessage
        text={text}
        status={status}
        labels={labels.assistant}
        onCopy={() => undefined}
        onRetry={() => undefined}
        onContinue={() => undefined}
      />
    </Piece>
  )
}

function ThinkingCell(): JSX.Element {
  const fx = useV4Fixtures()
  return (
    <Piece>
      <V4Thinking label={fx.t('agentPanelV4.fixtureThinking')} meta={fx.t('agentPanelV4.fixtureThinkingMeta')} />
    </Piece>
  )
}

/**
 * 折叠层的两条产出（`agentPanelV4Collapse.ts`）：一行 `tool-group` + 一条 `process`。
 * 渲的是**生产组件**——实验室这一格与真面板走同一个 `V4FlowRow` 派发。
 */
function RetryStretchCell({ only }: { only: 'group' | 'process' }): JSX.Element {
  const fx = useV4Fixtures()
  const item = fx.retryStretch[only === 'group' ? 0 : 1]
  return (
    <Piece>
      <V4FlowRow item={item} darkMode={false} />
    </Piece>
  )
}

function ReceiptCell({ pick, errorBar }: { pick: keyof ReturnType<typeof useV4Fixtures>['receipts']; errorBar?: boolean }): JSX.Element {
  const fx = useV4Fixtures()
  const labels = useV4Labels()
  const receipt = fx.receipts[pick] as ToolReceipt
  return (
    <Piece>
      <V4ToolReceipt receipt={receipt} statusLabel={labels.toolStatus[receipt.status]} undoLabel={labels.task.undo} />
      {errorBar ? (
        <V4ErrorBar reason={fx.t('agentPanelV4.fixtureVendorFailure')} action={fx.t('agentPanelV4.fixtureRetryOtherModel')} />
      ) : null}
    </Piece>
  )
}

/**
 * 由 `LaneSnapshot` 驱动的两格（探针 P6）：收据不是手写的，是 pi 转录 → `projectLaneSnapshot`
 * → `laneViewModel` 真跑出来的。可见文字仍由实验室给（`toolLabel` 等，R15），和其它格同一份词条。
 * 「完成」那一格没接：它的摘要（「3 段 · 9.0s」）与用时（「0.4s」）今天的投影给不出来
 * （摘要要按能力渲染、用时要转录时间戳过桥），接上去就是一张不该被录进基线的红——
 * 见 `laneDrivenFixtures.test.ts` 钉住的缺口清单。
 */
/**
 * 两层投影要的那份词表。**抽出来是因为它有第二个消费者了**（反问答完那一行）——
 * 原地再抄一份就是同一份词表两个主人，而「类型要求穷尽」这条护栏的价值正好会被抄漏抵消。
 */
export function labViewModelLabels(fx: ReturnType<typeof useV4Fixtures>, toolLabel: string): LaneViewModelLabels {
  return {
    toolLabel: () => toolLabel,
    toolSummary: () => undefined,
    toolFailure: () => undefined,
    toolFailureDetail: (failure) => failure.code,
    assistantFailure: (text, facts) => providerFailureText(text, fx.t, facts),
    assistantRecovered: fx.t('agentPanelV4.errorRecovered'),
    thinkingLabel: fx.t('agentPanelV4.thinkingLabel'),
    formatTokens: (value) => String(value),
    formatCost: (usd) => `$${usd.toFixed(2)}`,
    // 三行的两个占位词。这一格只画工具收据，花费/上下文行不进画面；占位词走已有的 contextUnknown，
    // 「免费」那句不预放死键（3b 的裁决），这里同样借占位符——它在这一格永远不会被渲染。
    // 3c 的重试行：两个数由调用方填（语序问题），这一格永不渲染重试行，给最朴素的形状。
    retryLabel: (attempt, maxAttempts) => `${attempt}/${maxAttempts}`,
    unknown: fx.t('agentPanelV4.contextUnknown'),
    // 任务卡的四个词条。这一格只画工具收据，一条 task 段都没有，所以它们永远不会被渲染——
    // 但类型要求穷尽，而穷尽正是它的价值：哪天这一格接上任务卡，缺的那句话是编译错误，
    // 不是画面上的一块空白。
    taskTitle: fx.t('agentPanelV4.taskRun'),
    formatStages: (done, total) => fx.t('agentPanelV4.taskStages', { done, total }),
    formatMoney: (currency, amount) => formatMoney(fx.locale, currency, amount),
    taskUnknown: fx.t('agentPanelV4.taskUnknown'),
    attachmentUnavailable: fx.t('agentPanelV4.attachmentUnavailable'),
    answered: fx.t('agentPanelV4.questionAnswered'),
    // 技能名。这一格的转录里一条用户消息都没有，所以永远查不到它——但类型要求穷尽，
    // 哪天这一格接上带技能的那一轮，缺的那句话是编译错误，不是画面上的一块空白。
    skillLabel: (key) => key,
  }
}

function LaneReceiptCell({ lane }: { lane: (rejectReason: string) => LaneSnapshot }): JSX.Element {
  const fx = useV4Fixtures()
  const labels = useV4Labels()
  const receipt = laneDrivenReceipt(
    lane(fx.t('agentPanelV4.slotRejectSample')),
    labViewModelLabels(fx, fx.t('agentPanelV4.fixtureReadTimeline')),
  )
  return (
    <Piece>
      <V4ToolReceipt receipt={receipt} statusLabel={labels.toolStatus[receipt.status]} undoLabel={labels.task.undo} />
    </Piece>
  )
}

function TaskCell({ pick }: { pick: keyof ReturnType<typeof useV4Fixtures>['tasks'] }): JSX.Element {
  const fx = useV4Fixtures()
  const labels = useV4Labels()
  return (
    <Piece>
      <V4TaskCard task={fx.tasks[pick]} labels={labels.task} />
    </Piece>
  )
}

function SlotCell({ pick }: { pick: keyof ReturnType<typeof useV4Fixtures>['slots'] }): JSX.Element {
  const fx = useV4Fixtures()
  const labels = useV4Labels()
  return (
    <Piece>
      <V4Intervention {...V4_LAB_SLOT_HANDLERS} data={fx.slots[pick]} labels={labels.intervention} />
    </Piece>
  )
}

function PlanCell({ locale }: { locale: 'zh-CN' | 'en' }): JSX.Element {
  const ready = useV4Locale(locale)
  const fx = useV4Fixtures()
  const labels = useV4Labels()
  if (!ready) return <Piece><div /></Piece>
  return (
    <Piece>
      <V4Intervention {...V4_LAB_SLOT_HANDLERS} data={fx.slots.plan} labels={labels.intervention} />
    </Piece>
  )
}

/**
 * 反问卡的三态（2026-09-21 拍板补画）。同一张卡、同一个组件——**差别只在数据**：
 * 待答（选项 + 空的那一行）· 正在自己作答（那一行里有字）· 熔断转提问（多一句「试了 3 次」）。
 * 答完之后长什么样不在这里：它已经不是一张卡了，是对话流里的一行收据（见下一格）。
 */
type QuestionPick =
  | 'question' | 'questionRetry' | 'questionFree' | 'questionTwo' | 'questionFourMixed'
  | 'questionLabelsOnly' | 'questionMissingParam' | 'questionThree' | 'questionMulti'

function QuestionSlotCell({ pick, draft }: { pick: QuestionPick; draft?: boolean }): JSX.Element {
  const fx = useV4Fixtures()
  const labels = useV4Labels()
  const data = draft ? { ...fx.slots[pick], answerDraft: fx.t('agentPanelV4.slotQuestionTyped') } : fx.slots[pick]
  return (
    <Piece>
      <V4Intervention {...V4_LAB_SLOT_HANDLERS} data={data} labels={labels.intervention} />
    </Piece>
  )
}

/**
 * 答完那一行收据。**不是手写的**：`laneSnapshotQuestionAnswered` 造一段真转录
 * （提问工具 → 用户带话的 deny），`laneViewModel` 真跑一遍，取出它投影出来的那一行。
 * 所以这一格证得了一件事——协议上那次是 `output-denied`，而用户看到的是「已回答 · 他的答案」，
 * 不红、不打 ×。
 */
function QuestionAnsweredCell(): JSX.Element {
  const fx = useV4Fixtures()
  const labels = useV4Labels()
  // 收据那一行印的就是**那句问题**——反问卡的身份是它问了什么，不是一句「需要你定一下」
  // （那句套话随整件还原一起删了）。所以这里和上面那张卡取同一个字符串。
  const askedQuestion = fx.t('agentPanelV4.slotQuestionRetryTitle')
  const receipt = laneDrivenReceipt(
    laneSnapshotQuestionAnswered(askedQuestion, fx.t('agentPanelV4.slotOptionAsReference')),
    labViewModelLabels(fx, askedQuestion),
  )
  return (
    <Piece>
      <V4ToolReceipt receipt={receipt} statusLabel={labels.toolStatus[receipt.status]} />
    </Piece>
  )
}

function QueueCell({ pick }: { pick: keyof ReturnType<typeof useV4Fixtures>['queues'] }): JSX.Element {
  const fx = useV4Fixtures()
  const labels = useV4Labels()
  return (
    <Piece>
      <V4Queue rows={fx.queues[pick]} labels={labels.queue} />
    </Piece>
  )
}

function ContextCell({ expanded, unknownWindow }: { expanded: boolean; unknownWindow?: boolean }): JSX.Element {
  const fx = useV4Fixtures()
  const labels = useV4Labels()
  // 分母未知那一格：真实目录里的对话模型多半没写 contextWindow（2026-09-06 打包版实测 21/21 都没有）。
  const usage = unknownWindow ? { ...fx.context, max: undefined } : fx.context
  return (
    <Piece>
      {/* 展开态的卡是绝对定位的，给它留出下方空间才截得到整张。 */}
      <div style={{ height: expanded ? 260 : 24 }}>
        <V4ContextRing usage={usage} labels={labels.context} expanded={expanded} />
      </div>
    </Piece>
  )
}

/**
 * 角标的两个邻居（浏览器 / 设置）。取景框的视口是 1440，落在现役 `max-[1600px]` 断点里，
 * 所以它们在真机上就是 30px 图标方块——照抄那一档，才比得出「角标和它们等高」这件事。
 */
function NeighborGhostButton({ icon }: { icon: React.ReactNode }): JSX.Element {
  return (
    <span
      className="grid size-[30px] place-items-center rounded-[var(--nomi-radius-sm)] border border-transparent text-[var(--nomi-ink-80)]"
      aria-hidden="true"
    >
      {icon}
    </span>
  )
}

/**
 * ⑦ 收起坞 · **顶栏那一格角标**（09-01 定稿 §11.2 收起态 · 样张「屏 E · B①」）。
 *
 * 取景框里垫一条顶栏色的横条并把角标放进去，是因为这颗钮的对错只有**在它的邻居旁边**才看得出来：
 * 它必须和「浏览器 / 设置」同高（30px）、同圆角、同 ghost 底。裸着截一颗 logo，
 * 高矮不一致这种最刺眼的毛病恰好是看不出来的那种。
 *
 * 五档状态各一格，但**长相只有两种**（点 / 数字）——这正是要被截下来钉住的事：
 * 一格 8px 的角标分不出五种意思，分档的活儿归 tooltip 那句人话。
 */
function DockCell({ status, pendingCount = 0, unreadCount = 0 }: {
  status: V4DockStatus
  pendingCount?: number
  unreadCount?: number
}): JSX.Element {
  const labels = useV4Labels()
  const tooltip = `${labels.dock.open} · ${dockStatusLabel(status, pendingCount, labels.dock)}`
  return (
    <Piece>
      <TooltipProvider delayDuration={250} disableHoverableContent>
        <div className="flex items-center justify-end gap-2.5 rounded-nomi-sm border border-nomi-line-soft bg-nomi-paper px-2.5 py-1.5">
          <NeighborGhostButton icon={<IconBrowser size={15} stroke={1.8} />} />
          {/* 分隔线**只有左边这一条**，右边没有——真机就是这样：分隔线是「创作辅助」那一组
              自己的收尾（`NomiAppBar.tsx` 的 assist 组末尾），而「配置」组开头不带分隔线。
              摆两条会在接触表上凭空造出一条真机没有的竖线，拍板人看到的就不是他将来看到的那个顶栏。 */}
          <span className="h-[18px] w-px bg-workbench-border" aria-hidden="true" />
          <AgentTopbarChip
            reason="resident-collapsed"
            label="Nomi"
            tooltip={tooltip}
            status={status}
            badge={agentTopbarChipBadge(unreadCount, pendingCount, status === 'failed')}
            onOpen={() => undefined}
          />
          <NeighborGhostButton icon={<IconSettings size={15} stroke={1.8} />} />
        </div>
      </TooltipProvider>
    </Piece>
  )
}

export const V4_VOCABULARY_STATES: readonly LabState[] = [
  {
    id: 'v4-user-plain',
    name: '① 用户气泡 · 纯文本',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <UserCell withChip={false} />,
  },
  {
    id: 'v4-user-attachment',
    name: '① 用户气泡 · 附件 chip 在气泡内',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <UserCell withChip />,
  },
  {
    id: 'v4-assistant-streaming',
    name: '② 助手文本 · 流式（末尾方块光标）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <AssistantCell status="streaming" />,
  },
  {
    id: 'v4-assistant-complete',
    name: '② 助手文本 · 完成（hover 出复制/重来）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <AssistantCell status="complete" />,
  },
  {
    id: 'v4-assistant-interrupted',
    name: '② 助手文本 · 已中断（灰字 + 继续）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <AssistantCell status="interrupted" />,
  },
  {
    id: 'v4-assistant-thinking',
    name: '② 助手文本 · 思考行（shimmer + 秒数）',
    source: '2026-09-06-agent-panel-v4.md · Process 板时刻 2',
    coverage: 'component-only',
    render: () => <ThinkingCell />,
  },
  {
    id: 'v4-tool-input-streaming',
    name: '③ 收据 · input-streaming（进行中）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <LaneReceiptCell lane={laneSnapshotToolRunning} />,
  },
  {
    id: 'v4-tool-input-available',
    name: '③ 收据 · input-available',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <ReceiptCell pick="inputAvailable" />,
  },
  {
    id: 'v4-tool-approval-requested',
    name: '③ 收据 · approval-requested',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <ReceiptCell pick="approvalRequested" />,
  },
  {
    id: 'v4-tool-approval-responded',
    name: '③ 收据 · approval-responded',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <ReceiptCell pick="approvalResponded" />,
  },
  {
    id: 'v4-tool-output-available',
    name: '③ 收据 · 完成（摘要 + 用时 + ›）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <ReceiptCell pick="done" />,
  },
  {
    id: 'v4-tool-expanded',
    name: '③ 收据 · 展开（输入 / 输出）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <ReceiptCell pick="expanded" />,
  },
  {
    id: 'v4-tool-group-failed',
    name: '③ 收据 · 同名连调六次折成一行（含失败原因）',
    source: '2026-09-06 打包版真实使用 · 「从原稿重拆 10 镜」',
    coverage: 'component-only',
    render: () => <RetryStretchCell only="group" />,
  },
  {
    id: 'v4-process-folded',
    name: '② 助手文本 · 过程自述收起（只有最终回答摊开）',
    source: '2026-09-06-agent-panel-v4.md · 拍板 ⑦ 过程反馈按 Claude Code',
    coverage: 'component-only',
    render: () => <RetryStretchCell only="process" />,
  },
  {
    id: 'v4-tool-output-denied',
    name: '③ 收据 · output-denied（你点了不要）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <LaneReceiptCell lane={laneSnapshotToolDenied} />,
  },
  {
    id: 'v4-tool-output-error',
    name: '③ 收据 · 失败（原行变红 + 原因）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <ReceiptCell pick="error" />,
  },
  {
    id: 'v4-tool-skill',
    name: '③ 收据 · 载入技能',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <ReceiptCell pick="skill" />,
  },
  {
    id: 'v4-tool-attachment',
    name: '③ 收据 · 读取附件',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <ReceiptCell pick="attachment" />,
  },
  {
    id: 'v4-tool-layout-undo',
    name: '③ 收据 · 布局改动（行尾撤销）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <ReceiptCell pick="layout" />,
  },
  {
    id: 'v4-tool-video-failed',
    name: '③ 收据 · 生成失败 + 未扣费条',
    source: '2026-09-06-agent-panel-v4.md · Process 板时刻 5',
    coverage: 'component-only',
    render: () => <ReceiptCell pick="videoFailed" errorBar />,
  },
  {
    id: 'v4-tool-stopped',
    name: '③ 收据 · 打断（已停 · 已花）',
    source: '2026-09-06-agent-panel-v4.md · Process 板时刻 7',
    coverage: 'component-only',
    render: () => <ReceiptCell pick="stopped" />,
  },
  {
    id: 'v4-task-queued',
    name: '④ 任务卡 · 排队',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <TaskCell pick="queued" />,
  },
  {
    id: 'v4-task-running',
    name: '④ 任务卡 · 生成中（摘录 + 参数 + 进度）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <TaskCell pick="running" />,
  },
  {
    id: 'v4-task-complete',
    name: '④ 任务卡 · 完成（三候选，采用带角标）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <TaskCell pick="complete" />,
  },
  {
    id: 'v4-task-failed',
    name: '④ 任务卡 · 失败（未扣费 + 换模型重试）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <TaskCell pick="failed" />,
  },
  {
    id: 'v4-task-stopped',
    name: '④ 任务卡 · 已停止',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <TaskCell pick="stopped" />,
  },
  {
    id: 'v4-intervention-irreversible',
    name: '⑤ 介入槽 · 不可逆审批（无「不再问」）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <SlotCell pick="irreversible" />,
  },
  {
    id: 'v4-intervention-reversible',
    name: '⑤ 介入槽 · 可撤销（带「不再问 →」）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <SlotCell pick="reversible" />,
  },
  {
    id: 'v4-intervention-reject-reason',
    name: '⑤ 介入槽 · 拒绝原因（渐进披露）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <SlotCell pick="rejectReason" />,
  },
  {
    id: 'v4-intervention-spend',
    name: '⑤ 介入槽 · 付费（永远逐次问）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <SlotCell pick="spend" />,
  },
  {
    id: 'v4-intervention-question',
    name: '⑤ 介入槽 · 反问 · 待答（整行选项 + 末行自由作答）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板 ⑩｜2026-09-21 拍板 ⑤（卡内自由作答）',
    coverage: 'component-only',
    render: () => <QuestionSlotCell pick="question" />,
  },
  {
    id: 'v4-intervention-question-typing',
    name: '⑤ 介入槽 · 反问 · 自己作答中（卡内那一行里有字）',
    source: '2026-09-21 拍板 ⑤：自由作答放进卡里最后一行，不借用下方 composer',
    coverage: 'component-only',
    render: () => <QuestionSlotCell pick="question" draft />,
  },
  {
    id: 'v4-intervention-question-retry',
    name: '⑤ 介入槽 · 反问 · 熔断转提问（同一张卡的第三个生产者）',
    source: '2026-09-21 拍板 ④：同一字段路径连续 3 次 → 复用反问卡',
    coverage: 'component-only',
    render: () => <QuestionSlotCell pick="questionRetry" />,
  },
  {
    id: 'v4-intervention-question-answered',
    name: '③ 一行收据 · 反问答完（「已回答 · 他的答案」，不红不打 ×）',
    source: '2026-09-21 拍板 ⑤：提交后卡收起成一行收据',
    coverage: 'component-only',
    render: () => <QuestionAnsweredCell />,
  },
  // ── 反问卡的通用性（2026-09-21 用户原话：「只有那一种反问就离谱了」）──
  // 六格换六个题目、六种形状；同一个组件、同一份契约，差别全在数据。
  {
    id: 'v4-intervention-question-free',
    name: '⑤ 介入槽 · 反问 · 一个选项都没有（纯自由作答）',
    source: '2026-09-21 拍板：反问是通用能力，options 允许为空',
    coverage: 'component-only',
    render: () => <QuestionSlotCell pick="questionFree" />,
  },
  {
    id: 'v4-intervention-question-two-options',
    name: '⑤ 介入槽 · 反问 · 2 个选项（区间下界）',
    source: '2026-09-21 拍板：一次一题、2–4 个选项',
    coverage: 'component-only',
    render: () => <QuestionSlotCell pick="questionTwo" />,
  },
  {
    id: 'v4-intervention-question-four-mixed',
    name: '⑤ 介入槽 · 反问 · 4 个选项且长短不一（EN 有一条很长的说明）',
    source: '2026-09-21 拍板：标签 + 一句说明 + 可标推荐；EN 串长 1.5–2 倍',
    coverage: 'component-only',
    render: () => <QuestionSlotCell pick="questionFourMixed" />,
  },
  {
    id: 'v4-intervention-question-labels-only',
    name: '⑤ 介入槽 · 反问 · 只有标签没有说明（模型不写就没有）',
    source: '2026-09-21 拍板：description 缺席 = 不替它编',
    coverage: 'component-only',
    render: () => <QuestionSlotCell pick="questionLabelsOnly" />,
  },
  {
    id: 'v4-intervention-question-three',
    name: '⑤ 介入槽 · 反问 · 多题一张卡（第 1 题，左下 1/3）',
    source: 'Beautiful UI Approval Card 整件：一次一题、卡高随题滑动、左下页码',
    coverage: 'component-only',
    render: () => <QuestionSlotCell pick="questionThree" />,
  },
  {
    id: 'v4-intervention-question-multi',
    name: '⑤ 介入槽 · 反问 · 多选（标记是方的，等「继续」不自动前进）',
    source: 'Approval Card 的 type: "check"；单选点了就走、多选等按钮（2026-09-21 拍板）',
    coverage: 'component-only',
    render: () => <QuestionSlotCell pick="questionMulti" />,
  },
  {
    id: 'v4-intervention-question-missing-param',
    name: '⑤ 介入槽 · 反问 · 缺参数来源（同一张卡的第二个生产者）',
    source: '2026-09-12 缺参数并进反问格｜2026-09-21 拍板：宿主生产者不是唯一触发',
    coverage: 'component-only',
    render: () => <QuestionSlotCell pick="questionMissingParam" />,
  },
  {
    id: 'v4-intervention-plan',
    name: '⑤ 介入槽 · 计划（就地勾选表）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <SlotCell pick="plan" />,
  },
  {
    id: 'v4-intervention-plan-en',
    name: '⑤ 介入槽 · 计划（英文界面）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板｜2026-10-08 共享 PlanRows',
    coverage: 'component-only',
    render: () => <PlanCell locale="en" />,
  },
  {
    id: 'v4-intervention-plan-dark',
    name: '⑤ 介入槽 · 计划（暗色）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板｜2026-10-08 共享 PlanRows',
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <PlanCell locale="zh-CN" />,
  },
  {
    id: 'v4-intervention-plan-en-dark',
    name: '⑤ 介入槽 · 计划（英文暗色）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板｜2026-10-08 共享 PlanRows',
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <PlanCell locale="en" />,
  },
  {
    id: 'v4-intervention-credential',
    name: '⑤ 介入槽 · 缺凭证',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <SlotCell pick="credential" />,
  },
  {
    id: 'v4-intervention-deviation',
    name: '⑤ 介入槽 · 有出入（跳过 / 先生图）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <SlotCell pick="deviation" />,
  },
  {
    id: 'v4-queue-mixed',
    name: '⑥ 队列 · 进行中 + 排队（插队 / 删）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <QueueCell pick="mixed" />,
  },
  {
    id: 'v4-queue-interrupt',
    name: '⑥ 队列 · 完成划掉 + 立即中断',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <QueueCell pick="interrupt" />,
  },
  {
    id: 'v4-dock-logo',
    name: '⑦ 收起角标 · 顶栏那一格（空闲：什么都不叠）',
    source: '2026-09-01-agent-ui-final-redesign.md §11.2 · 样张屏 E · B① 收起态',
    coverage: 'component-only',
    render: () => <DockCell status="idle" />,
  },
  {
    id: 'v4-collapsed-running',
    name: '⑦ 收起角标 · 运行中来了一条新动静（蓝点 8px）',
    source: '2026-09-01-agent-ui-final-redesign.md §11.2 · 样张屏 E · B① 收起态',
    coverage: 'component-only',
    render: () => <DockCell status="running" unreadCount={1} />,
  },
  {
    id: 'v4-collapsed-needs-confirm',
    name: '⑦ 收起角标 · 待你确认（数字徽标 = 未读条数，含那条待决）',
    source: '2026-09-01-agent-ui-final-redesign.md §11.2 · 样张屏 E · B① 收起态',
    coverage: 'component-only',
    render: () => <DockCell status="needs-confirm" pendingCount={1} unreadCount={1} />,
  },
  {
    id: 'v4-collapsed-done',
    name: '⑦ 收起角标 · 刚做完，攒了 3 条未读（数字徽标）',
    source: '2026-09-01-agent-ui-final-redesign.md §11.2 · 样张屏 E · B① 收起态',
    coverage: 'component-only',
    render: () => <DockCell status="done" unreadCount={3} />,
  },
  {
    id: 'v4-collapsed-failed',
    name: '⑦ 收起角标 · 有一步没成（没有新消息也保底冒一颗点，坏消息在 tooltip 里说清）',
    source: '2026-09-01-agent-ui-final-redesign.md §11.2 · 样张屏 E · B① 收起态',
    coverage: 'component-only',
    render: () => <DockCell status="failed" />,
  },
  {
    id: 'v4-collapsed-dark',
    name: '⑦ 收起角标 · 暗色（token 翻转后，蓝点与数字仍要从纸面上跳出来）',
    source: '2026-09-01-agent-ui-final-redesign.md §11.2 · 样张屏 E · B① 收起态',
    coverage: 'component-only',
    // 暗色只能由这里钉（`LabState.scheme`）：暗色 token 挂在 `:root[data-mantine-color-scheme="dark"]`
    // 上，组件自己套个 class 翻不动它。这一格要看的正是**对比度**：accent 蓝点 8px 与
    // 纸色数字落在暗色顶栏上还认不认得出来——浅色那五格证明不了这件事。
    scheme: 'dark',
    render: () => <DockCell status="needs-confirm" pendingCount={2} unreadCount={2} />,
  },
  {
    id: 'v4-context-ring',
    name: '⑧ Context 环 · 收起',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <ContextCell expanded={false} />,
  },
  {
    id: 'v4-context-window-unknown',
    name: '⑧ Context · 窗口未知时不画环，改说「已用 62.4K」',
    source: '2026-09-06 打包版真实使用 · 目录里 21 个对话模型全都没写 contextWindow',
    coverage: 'component-only',
    render: () => <ContextCell expanded={false} unknownWindow />,
  },
  {
    id: 'v4-context-expanded',
    name: '⑧ Context 环 · 展开（真实 token + 花费）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <ContextCell expanded />,
  },
]
