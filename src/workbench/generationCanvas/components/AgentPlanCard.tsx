import React from 'react'
import { cn } from '../../../utils/cn'
import { WorkbenchButton } from '../../../design'
import {
  isRelayEdge,
  planNodeLayer,
  summarizeAgentPlan,
  type AgentPlanLayer,
  type AgentPlanSummary,
  type PlannedEdge,
  type PlannedNode,
} from './agentPlanSummary'
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

const LAYER_LABEL: Record<AgentPlanLayer, string> = {
  reference: '参考',
  keyframe: '关键帧',
  video: '视频',
}

const edgeKey = (edge: PlannedEdge): string => `${edge.sourceClientId}→${edge.targetClientId}`

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
        'border border-nomi-accent bg-nomi-accent-soft text-nomi-accent text-micro font-medium',
      )}
    >
      {label ? <span className={cn('text-micro text-nomi-accent/70')}>{label}</span> : null}
      {/* 只如实展示 AI 配的值(改值去节点/画布)——曾有假下拉 ▾ 暗示可点开改选项实则无交互,已删(诚实)。 */}
      <span className={cn('truncate max-w-[120px]')}>{value}</span>
    </span>
  )
}

/** 节点行（分组/平铺共用）：标题 + 引用 chip + prompt（默认一行预览，点行展开编辑）。 */
function PlanNodeRow({
  node,
  index,
  numbered,
  refTitles,
  chips,
  prompt,
  onPromptChange,
}: {
  node: PlannedNode
  index: number
  numbered: boolean
  refTitles: string[]
  chips: ReturnType<typeof nodeChipValues>
  prompt: string
  onPromptChange: (value: string) => void
}): JSX.Element {
  const [expanded, setExpanded] = React.useState(false)
  return (
    <li
      className={cn('flex flex-col gap-[6px] p-2 rounded-nomi-sm bg-nomi-paper border border-nomi-line-soft')}
      data-plan-node-id={node.clientId}
    >
      <button
        type="button"
        className={cn('flex items-center gap-2 min-w-0 border-0 bg-transparent p-0 text-left cursor-pointer')}
        aria-expanded={expanded}
        aria-label={`${node.title}（点击${expanded ? '收起' : '编辑'}提示词）`}
        onClick={() => setExpanded((current) => !current)}
      >
        {numbered ? (
          <span className={cn(
            'inline-grid place-items-center w-5 h-5 rounded-full bg-nomi-ink text-nomi-paper text-micro font-medium shrink-0',
          )}>{index + 1}</span>
        ) : null}
        <span className={cn('text-nomi-ink text-body-sm font-medium truncate')}>{node.title}</span>
        {refTitles.length > 0 ? (
          <span className={cn('ml-auto inline-flex items-center gap-1 shrink-0')} data-plan-node-refs="true">
            {refTitles.map((title) => (
              <span
                key={title}
                className={cn('inline-flex items-center h-[18px] px-[7px] rounded-full bg-nomi-ink-05 text-nomi-ink-60 text-micro font-semibold')}
              >
                {title}
              </span>
            ))}
          </span>
        ) : null}
      </button>

      {chips ? (
        <div className={cn('flex items-center gap-[6px] flex-wrap', numbered && 'pl-7')} data-plan-node-chips="true">
          <PendingChip value={chips.modelLabel} />
          {chips.aspect ? <PendingChip label="比例" value={chips.aspect} /> : null}
          {chips.resolution ? <PendingChip label="清晰度" value={chips.resolution} /> : null}
        </div>
      ) : null}

      {expanded ? (
        <textarea
          className={cn(
            'w-full min-h-[46px] p-2 rounded-nomi-sm',
            'border border-nomi-line-soft bg-nomi-paper text-nomi-ink-80 text-caption leading-[1.5] resize-y outline-0',
            'hover:border-nomi-line focus:border-nomi-accent focus:text-nomi-ink',
            numbered && 'ml-7 w-[calc(100%-1.75rem)]',
          )}
          aria-label={`编辑「${node.title}」的提示词`}
          value={prompt}
          autoFocus
          onChange={(event) => onPromptChange(event.target.value)}
        />
      ) : (
        <div
          className={cn('text-nomi-ink-60 text-caption overflow-hidden text-ellipsis whitespace-nowrap', numbered && 'pl-7')}
          aria-hidden="true"
        >
          {prompt}
        </div>
      )}
    </li>
  )
}

/**
 * Aggregated "plan" preview card (簇 A · 计划—批准—执行事务的 ①②态).
 * T3 轨迹形态（定稿样张 2026-06-13-trajectory-plan-card.html）：≥2 层时按
 * 参考/关键帧/视频 分组渲染 + 尾帧接力勾选行（取消即从批准里剔除该边）；
 * 单层计划保持原编号平铺。一次「确认全部」原子批准。
 */
function AgentPlanCard({ plan, approveCalls, rejectCall, flat = false }: AgentPlanCardProps): JSX.Element {
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

  const nodeByClientId = React.useMemo(
    () => new Map(plan.nodes.map((node) => [node.clientId, node])),
    [plan.nodes],
  )
  const kindByClientId = React.useMemo(
    () => new Map(plan.nodes.map((node) => [node.clientId, node.kind])),
    [plan.nodes],
  )
  // 尾帧接力边（video→video first_frame）单独成区、可勾选；只针对 create 携带的边
  // （批准时 overrides.edges 只能覆盖 create 调用的参数,遗留 connect 调用原样通过）。
  const relayEdges = React.useMemo(
    () => plan.createEdges.filter((edge) => isRelayEdge(edge, kindByClientId)),
    [plan.createEdges, kindByClientId],
  )
  const [relayEnabled, setRelayEnabled] = React.useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    for (const edge of relayEdges) initial[edgeKey(edge)] = true
    return initial
  })

  // ≥2 个不同层 → 轨迹分组形态；否则保持原编号平铺（单层拆镜不变量）。
  const layers = plan.nodes.map(planNodeLayer)
  const layered = !layers.includes(null) && new Set(layers).size >= 2
  const groups: Array<{ layer: AgentPlanLayer; nodes: PlannedNode[] }> = layered
    ? (['reference', 'keyframe', 'video'] as AgentPlanLayer[])
        .map((layer) => ({ layer, nodes: plan.nodes.filter((node) => planNodeLayer(node) === layer) }))
        .filter((group) => group.nodes.length > 0)
    : []

  // 节点行右上的引用 chip：进入该节点的参考类边的源节点标题（轨迹形态才展示）。
  const refTitlesFor = React.useCallback((clientId: string): string[] => {
    if (!layered) return []
    return plan.edges
      .filter((edge) => edge.targetClientId === clientId && edge.mode !== 'first_frame' && nodeByClientId.has(edge.sourceClientId))
      .map((edge) => {
        const title = nodeByClientId.get(edge.sourceClientId)?.title || edge.sourceClientId
        // 「角色：男主」→「男主」——chip 空间小，留专名即可
        return title.replace(/^(角色|场景|道具)[：:]\s*/, '').slice(0, 8)
      })
  }, [layered, plan.edges, nodeByClientId])

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
    // 被勾掉的接力边从批准里剔除（用户拍板：接力可选不强加）；其余边原样保留。
    const keptEdges = plan.createEdges.filter(
      (edge) => !isRelayEdge(edge, kindByClientId) || relayEnabled[edgeKey(edge)] !== false,
    )
    // S6-2:create+connect 一笔事务批准——共一个 proposalId,connect 失败则 create 也回滚。
    approveCalls([
      {
        toolCallId: plan.createCallId,
        overrides: {
          nodes: patchedNodes,
          summary: plan.summary,
          ...(plan.createEdges.length ? { edges: keptEdges } : {}),
        },
      },
      ...(plan.connectCallId ? [{ toolCallId: plan.connectCallId }] : []),
    ])
  }, [editedPrompts, plan, approveCalls, kindByClientId, relayEnabled])

  const handleRejectAll = React.useCallback(() => {
    rejectCall(plan.createCallId)
    if (plan.connectCallId) {
      rejectCall(plan.connectCallId)
    }
  }, [plan, rejectCall])

  const renderRow = (node: PlannedNode, index: number, numbered: boolean) => (
    <PlanNodeRow
      key={node.clientId}
      node={node}
      index={index}
      numbered={numbered}
      refTitles={refTitlesFor(node.clientId)}
      chips={nodeChipValues(node, entryByKey)}
      prompt={editedPrompts[node.clientId] ?? node.prompt}
      onPromptChange={(value) => setEditedPrompts((current) => ({ ...current, [node.clientId]: value }))}
    />
  )

  return (
    <div
      className={cn(
        'flex flex-col gap-3',
        flat ? '' : 'p-3 rounded-nomi border border-nomi-accent-soft bg-nomi-accent-soft/40',
      )}
      data-agent-plan-card="true"
      aria-label="Agent 故事板计划卡片"
    >
      {/* 定稿样张：头部只留一行摘要（计数在组头、蓝底 chip 可点自明，不再解释）。 */}
      {flat ? null : <div className={cn('text-nomi-ink text-body font-medium leading-snug')}>{plan.summary}</div>}

      {layered ? (
        <div className={cn('flex flex-col gap-3')}>
          {groups.map((group) => (
            <section key={group.layer} className={cn('flex flex-col gap-[6px]')} data-plan-layer={group.layer}>
              <div className={cn('text-nomi-ink-60 text-micro font-semibold')}>
                {LAYER_LABEL[group.layer]} <span className={cn('text-nomi-ink-40 font-medium')}>×{group.nodes.length}</span>
              </div>
              <ol className={cn('flex flex-col gap-2 list-none p-0 m-0')}>
                {group.nodes.map((node, index) => renderRow(node, index, false))}
              </ol>
            </section>
          ))}

          {relayEdges.length > 0 ? (
            <section className={cn('flex flex-col gap-[6px]')} data-plan-layer="relay">
              <div className={cn('text-nomi-ink-60 text-micro font-semibold')}>
                尾帧接力 <span className={cn('text-nomi-ink-40 font-medium')}>可选</span>
              </div>
              {relayEdges.map((edge) => {
                const key = edgeKey(edge)
                const enabled = relayEnabled[key] !== false
                const shortTitle = (clientId: string) =>
                  (nodeByClientId.get(clientId)?.title || clientId).replace(/\s*视频.*$/, '')
                return (
                  <label
                    key={key}
                    className={cn('flex items-start gap-2 p-2 rounded-nomi-sm bg-nomi-paper border border-nomi-line-soft cursor-pointer')}
                    data-plan-relay-edge={key}
                  >
                    <input
                      type="checkbox"
                      className={cn('mt-[2px] accent-[var(--nomi-accent)]')}
                      checked={enabled}
                      aria-label={`启用 ${shortTitle(edge.sourceClientId)} 到 ${shortTitle(edge.targetClientId)} 尾帧接力`}
                      onChange={(event) => setRelayEnabled((current) => ({ ...current, [key]: event.target.checked }))}
                    />
                    <span className={cn('flex flex-col gap-[2px] min-w-0')}>
                      <span className={cn('text-caption font-semibold', enabled ? 'text-nomi-ink' : 'text-nomi-ink-40 line-through')}>
                        {shortTitle(edge.sourceClientId)} → {shortTitle(edge.targetClientId)}
                      </span>
                      <span className={cn('text-micro text-nomi-ink-40')}>
                        {enabled ? '尾帧接首帧，动作顺接' : '已取消，独立生成'}
                      </span>
                    </span>
                  </label>
                )
              })}
            </section>
          ) : null}
        </div>
      ) : (
        <ol className={cn('flex flex-col gap-2 list-none p-0 m-0')} aria-label="待确认的镜头列表">
          {plan.nodes.map((node, index) => renderRow(node, index, true))}
        </ol>
      )}

      {/* flex-wrap + shrink-0:窄面板放不下时整组优雅换行,不挤压(对齐 committed/deviation 几何修)。
          按钮走设计系统 variant(default/primary)+size md(=h-8,零尺寸变化),不再手搓 className。 */}
      <div className={cn('flex flex-wrap items-center justify-end gap-2')}>
        <WorkbenchButton className={cn('shrink-0')} variant="default" size="md" onClick={handleRejectAll}>
          全部拒绝
        </WorkbenchButton>
        <WorkbenchButton className={cn('shrink-0')} variant="primary" size="md" data-plan-confirm-all="true" onClick={handleConfirmAll}>
          确认全部
        </WorkbenchButton>
      </div>
    </div>
  )
}

// React.memo:流式吐字会每帧重渲染 AssistantTimeline,但本卡(8 节点行 + textarea)只随 plan/
// 回调变。props 全稳定(plan 经 useMemo、approveCalls/rejectCall 经 useCallback)→ 流式期间零重渲染。
export default React.memo(AgentPlanCard)
