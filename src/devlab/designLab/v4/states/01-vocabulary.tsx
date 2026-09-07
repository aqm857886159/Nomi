// 设计实验室 · Agent 面板 v4 · **Vocabulary 板**（8 个积木 × 各自的状态）
//
// 取景框是 `Piece`：这一组每一格只渲**那一个积木**，因为定稿 Vocabulary 板画的就是
// 单件的状态阵列。整块面板归 `03-flow.tsx`。
//
// 顺序有意义：`labStates.mjs` 按本屏目录里 `NN-*.tsx` 的文件名排序解析，汇总口按同样顺序拼接，
// 走查再拿活页面的 `window.__designLabStates` 与解析结果逐项比对——三者对不上当场红。
import React from 'react'
import { V4Intervention, V4Queue, V4TaskCard } from '../../../../workbench/ai/v4/AgentPanelV4Cards'
import { V4ContextRing } from '../../../../workbench/ai/v4/AgentPanelV4Context'
import { V4CollapsedRail } from '../../../../workbench/ai/v4/AgentPanelV4Dock'
import { V4AssistantMessage, V4Thinking, V4UserBubble } from '../../../../workbench/ai/v4/AgentPanelV4Message'
import { V4ErrorBar, V4ToolReceipt } from '../../../../workbench/ai/v4/AgentPanelV4Receipt'
import { V4FlowRow } from '../../../../workbench/ai/v4/AgentPanelV4Panel'
import { useV4Labels } from '../../../../workbench/ai/v4/agentPanelV4Labels'
import type { ToolReceipt, V4AssistantStatus } from '../../../../workbench/ai/v4/agentPanelV4Types'
import { Piece, useV4Fixtures } from '../agentPanelV4LabKit'
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
      <V4AssistantMessage text={text} status={status} labels={labels.assistant} />
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
      <V4Intervention data={fx.slots[pick]} labels={labels.intervention} />
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

function DockCell(): JSX.Element {
  const labels = useV4Labels()
  // rail 本身**就是** 32px 宽（定稿 ⑦）。裸着截会被走查的「舞台没渲染出来」判据（宽 < 40）
  // 误报成渲染失败，所以放进同一个 `Piece` 取景框里，左边留出它在真机里贴着的那块内容区。
  return (
    <Piece>
      <div className="flex" style={{ height: 120 }}>
        <div className="flex-1 rounded-nomi-sm bg-nomi-ink-05" aria-hidden="true" />
        <V4CollapsedRail running labels={labels.dock} />
      </div>
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
    render: () => <ReceiptCell pick="running" />,
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
    render: () => <ReceiptCell pick="denied" />,
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
    name: '⑤ 介入槽 · 反问（一行文字 + 选项 chip）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <SlotCell pick="question" />,
  },
  {
    id: 'v4-intervention-plan',
    name: '⑤ 介入槽 · 计划（就地勾选表）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <SlotCell pick="plan" />,
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
    id: 'v4-dock-rail',
    name: '⑦ 收起坞 · 32px rail（带运行状态点）',
    source: '2026-09-06-agent-panel-v4.md · Vocabulary 板',
    coverage: 'component-only',
    render: () => <DockCell />,
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
