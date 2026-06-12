import React from 'react'
import { cn } from '../../../utils/cn'
import { WorkbenchButton } from '../../../design'
import { summarizeAgentPlan, type AgentPlanSummary, type PlannedNode } from './agentPlanSummary'
import { listAvailableModelsForAgent, type AgentModelEntry } from '../agent/availableModels'

export { summarizeAgentPlan }

type AgentPlanCardProps = {
  plan: AgentPlanSummary
  /** S6-2 提议事务:确认 = 整批原子批准(create+connect 共一个 proposalId,中途失败补偿回滚)。 */
  approveCalls: (requests: { toolCallId: string; overrides?: Record<string, unknown> }[]) => void
  /** 拒绝单个 call(画布零痕迹)。 */
  rejectCall: (toolCallId: string) => void
  /** 时间线内嵌(方案三):去外框,导轨提供视觉结构;标题/计数由步骤头承担。 */
  flat?: boolean
}

// 从计划节点 + 可用模型清单算出要展示的「模型/比例/清晰度」chip 文案。
// 这些是 agent 配的、待用户过目的参数（簇 A「看全」）——modelKey 在则高亮「待你看」。
function nodeChipValues(node: PlannedNode, entryByKey: ReadonlyMap<string, AgentModelEntry>) {
  if (!node.modelKey) return null
  const params = node.params ?? {}
  const aspect =
    typeof params.aspect_ratio === 'string'
      ? params.aspect_ratio
      : typeof params.size === 'string'
        ? params.size
        : undefined
  const resolution = typeof params.resolution === 'string' ? params.resolution : undefined
  return {
    modelLabel: entryByKey.get(node.modelKey)?.label ?? node.modelKey,
    aspect,
    resolution,
  }
}

// 「待你看」高亮 chip——AI 配的、用户还没动过的参数（蓝底,跳出来,符合「创作者主权」）。
function PendingChip({ label, value }: { label?: string; value: string }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 h-6 px-2 rounded-full',
        'border border-nomi-accent bg-nomi-accent-soft text-nomi-accent text-[11px] font-medium',
      )}
    >
      {label ? <span className={cn('text-[10px] text-nomi-accent/70')}>{label}</span> : null}
      <span className={cn('truncate max-w-[120px]')}>{value}</span>
      <span className={cn('text-[9px] text-nomi-accent/60')}>▾</span>
    </span>
  )
}

/**
 * Aggregated "plan" preview card (簇 A · 计划—批准—执行事务的 ①②态).
 * AI 把 create_canvas_nodes (+ optional connect) 折叠成一张可确认的卡:每个镜头展示
 * 模型/比例/清晰度(agent 配的,「待你看」高亮) + prompt 常驻可编辑,一键确认整批落地。
 */
export default function AgentPlanCard({ plan, approveCalls, rejectCall, flat = false }: AgentPlanCardProps): JSX.Element {
  const [editedPrompts, setEditedPrompts] = React.useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    plan.nodes.forEach((node) => { initial[node.clientId] = node.prompt })
    return initial
  })
  // 可用模型清单(把 modelKey 翻成模型名;chip 下拉改选项也用它,下一步)。
  const [entryByKey, setEntryByKey] = React.useState<ReadonlyMap<string, AgentModelEntry>>(new Map())
  React.useEffect(() => {
    let alive = true
    listAvailableModelsForAgent()
      .then((entries) => { if (alive) setEntryByKey(new Map(entries.map((e) => [e.modelKey, e]))) })
      .catch(() => { /* 清单拉取失败:chip 退回显示 modelKey,不阻断确认 */ })
    return () => { alive = false }
  }, [])

  const handleConfirmAll = React.useCallback(() => {
    const patchedNodes = plan.nodes.map((node) => ({
      clientId: node.clientId,
      kind: node.kind,
      title: node.title,
      prompt: editedPrompts[node.clientId] ?? node.prompt,
      ...(node.position ? { position: node.position } : {}),
      // bug①：把 agent 建议的模型/参数透传给执行层（确认后写入 node.meta）。
      ...(node.modelKey ? { modelKey: node.modelKey } : {}),
      ...(node.modeId ? { modeId: node.modeId } : {}),
      ...(node.params ? { params: node.params } : {}),
    }))
    // S6-2:create+connect 一笔事务批准——共一个 proposalId,connect 失败则 create 也回滚。
    approveCalls([
      { toolCallId: plan.createCallId, overrides: { nodes: patchedNodes, summary: plan.summary } },
      ...(plan.connectCallId ? [{ toolCallId: plan.connectCallId }] : []),
    ])
  }, [editedPrompts, plan, approveCalls])

  const handleRejectAll = React.useCallback(() => {
    rejectCall(plan.createCallId)
    if (plan.connectCallId) {
      rejectCall(plan.connectCallId)
    }
  }, [plan, rejectCall])

  return (
    <div
      className={cn(
        'flex flex-col gap-3',
        flat ? '' : 'p-3 rounded-nomi border border-nomi-accent-soft bg-nomi-accent-soft/40',
      )}
      data-agent-plan-card="true"
      aria-label="Agent 故事板计划卡片"
    >
      <div className={cn('flex flex-col gap-[2px]')}>
        {flat ? null : (
          <div className={cn('text-nomi-accent text-[11px] font-medium uppercase tracking-wider')}>
            Agent 故事板计划
          </div>
        )}
        {/* 时间线内嵌时步骤头已写「创建 N 个节点」,这里只留单行计数,不重复标题。 */}
        {flat ? null : <div className={cn('text-nomi-ink text-[14px] font-medium leading-snug')}>{plan.summary}</div>}
        <div className={cn('text-nomi-ink-60 text-[12px]')}>
          {plan.nodes.length} 个节点 · {plan.edges.length} 条引用边 · <span className={cn('text-nomi-accent')}>蓝底 = AI 配的待你看</span>
        </div>
      </div>

      <ol className={cn('flex flex-col gap-2 list-none p-0 m-0')} aria-label="待确认的镜头列表">
        {plan.nodes.map((node, index) => {
          const currentPrompt = editedPrompts[node.clientId] ?? node.prompt
          const chips = nodeChipValues(node, entryByKey)
          return (
            <li
              key={node.clientId}
              className={cn('flex flex-col gap-[6px] p-2 rounded-nomi-sm bg-nomi-paper border border-nomi-line-soft')}
              data-plan-node-id={node.clientId}
            >
              <div className={cn('flex items-center gap-2 min-w-0')}>
                <span className={cn(
                  'inline-grid place-items-center w-5 h-5 rounded-full bg-nomi-ink text-nomi-paper text-[11px] font-medium shrink-0',
                )}>{index + 1}</span>
                <span className={cn('text-nomi-ink text-[13px] font-medium truncate')}>{node.title}</span>
              </div>

              {chips ? (
                <div className={cn('flex items-center gap-[6px] flex-wrap pl-7')} data-plan-node-chips="true">
                  <PendingChip value={chips.modelLabel} />
                  {chips.aspect ? <PendingChip label="比例" value={chips.aspect} /> : null}
                  {chips.resolution ? <PendingChip label="清晰度" value={chips.resolution} /> : null}
                </div>
              ) : null}

              <textarea
                className={cn(
                  'ml-7 w-[calc(100%-1.75rem)] min-h-[46px] p-2 rounded-nomi-sm',
                  'border border-nomi-line-soft bg-nomi-paper text-nomi-ink-80 text-[12px] leading-[1.5] resize-y outline-0',
                  'hover:border-nomi-line focus:border-nomi-accent focus:text-nomi-ink',
                )}
                aria-label={`编辑第 ${index + 1} 个镜头的提示词`}
                value={currentPrompt}
                onChange={(event) => setEditedPrompts((current) => ({ ...current, [node.clientId]: event.target.value }))}
              />
            </li>
          )
        })}
      </ol>

      <div className={cn('flex items-center justify-end gap-2')}>
        <WorkbenchButton
          className={cn(
            'h-8 px-3 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-nomi-ink-80 text-[13px] cursor-pointer hover:bg-nomi-ink-05',
          )}
          onClick={handleRejectAll}
        >
          全部拒绝
        </WorkbenchButton>
        <WorkbenchButton
          className={cn(
            'h-8 px-3 rounded-nomi-sm border-0 bg-nomi-ink text-nomi-paper text-[13px] font-medium cursor-pointer hover:bg-nomi-accent',
          )}
          data-plan-confirm-all="true"
          onClick={handleConfirmAll}
        >
          确认全部 ({plan.nodes.length} 节点)
        </WorkbenchButton>
      </div>
    </div>
  )
}
