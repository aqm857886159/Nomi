// Agent 面板 v4 · 读侧：宿主快照 + 目录 + 域投影 → 面板要渲的四份数据。
//
// 分成读/写两个 hook 的理由：写侧（发送、审批、队列）要拿到当下的选中范围与草稿，
// 读侧只依赖宿主与目录。混在一个 760 行的组件里时，`sendTurn` 的依赖数组挂了 15 个值，
// 其中任何一个变化都会重建回调、进而重建 `onToolCall`——而 `onToolCall` 里注册的待决
// 是靠闭包捕获的 binding 认领的。读写分开之后，读侧重算不会碰写侧的闭包。
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ProjectAgentHostState } from '../../../../electron/shared/projectAgentContracts'
// 「这一条还活着吗」的判据只有一份，住在合同里。抄一份 `['drafting','proposed',…]`
// 到渲染层，就是让合同加一个活状态时这里安静地漏掉它。
import { isProjectAgentLiveStatus } from '../../../../electron/shared/projectAgentContracts'
import { resolveCapabilityEffectClass } from '../../../../electron/shared/agentCapabilities/registry'
import { useProjectAgentSnapshot } from '../useProjectAgentThreadMessages'
import { useWorkbenchStore } from '../../workbenchStore'
import { useProductionRunStore } from '../../production/productionRunStore'
import { useCommittedProposal } from '../../generationCanvas/agent/proposalUndo'
import { listWorkbenchModelCatalogModels, listWorkbenchModelCatalogVendors, type ModelCatalogModelDto, type ModelCatalogVendorDto } from '../../api/modelCatalogApi'
import { listWorkbenchSkills, type SkillListItemDto } from '../../api/skillApi'
import { decodeModelIdentity, encodeModelIdentity, filterUsableAssistantTextModels, labelForModel } from '../assistantModelIdentity'
import { getAssistantModelPref, setAssistantModelPref } from '../assistantModelPref'
import { residentToolProjectionKey, residentToolProjectionScope, readResidentToolProjections, type ResidentToolProjection } from '../resident/residentToolProjection'
import { useTimelinePlanRows, useTimelineSelectionChips } from '../resident/timelineAgentSurface'
import type { ResidentSurface } from '../resident/residentShellDisplay'
import { agentPanelV4PendingTools, projectBindingKey, toProjectionPendingTools, type V4PendingToolRecord } from './agentPanelV4PendingTools'
import { projectV4Context, projectV4Flow, projectV4Queue, toolKey, type V4TaskFacts } from './agentPanelV4Projection'
import { missingParamSuggestion, projectV4Intervention } from './agentPanelV4Intervention'
import { useV4Labels } from './agentPanelV4Labels'
import type { ContextUsage, InterventionData, QueueRowData, V4Chip, V4FlowItem, V4TaskStatus } from './agentPanelV4Types'


export type AgentPanelV4Data = Readonly<{
  snapshot: ProjectAgentHostState | null
  activeThreadId: string | null
  flow: readonly V4FlowItem[]
  slot: InterventionData | undefined
  queue: readonly QueueRowData[]
  context: ContextUsage
  /** 当前待决里排第一条的那个（介入槽渲染的就是它）。 */
  primaryPending: V4PendingToolRecord | undefined
  pendingRecords: readonly V4PendingToolRecord[]
  runningTurnId: string | undefined
  /** 有回合活着就是 running；composer 换成「停止」、占位文案改「将排队发送」。 */
  running: boolean
  models: readonly ModelCatalogModelDto[]
  vendors: Readonly<Record<string, string>>
  selectedModel: ModelCatalogModelDto | undefined
  modelLabel: string
  skills: readonly SkillListItemDto[]
  /** composer 上方的活 chip（还没发出去的那些）。 */
  liveChips: readonly V4Chip[]
  reloadModels: () => void
  selectModel: (model: ModelCatalogModelDto) => void
}>

/**
 * 「已经等了几秒」。**只在真的有东西在跑时**才每秒跳一下——
 * 一个恒定的 setInterval 会让整块面板每秒重渲一次，包括没人在等的时候。
 * 它是定稿里那一行「4s · esc 打断」的数据源：转圈没有时间感，秒数才说明「没死」。
 */
function useElapsedSeconds(startedAt: string | undefined): number {
  const [seconds, setSeconds] = React.useState(0)
  React.useEffect(() => {
    if (!startedAt) {
      setSeconds(0)
      return
    }
    const started = Date.parse(startedAt)
    if (!Number.isFinite(started)) return
    const tick = (): void => setSeconds(Math.max(0, Math.round((Date.now() - started) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  return seconds
}

/** 「这个 job 还在动」的那批状态。列举而不是取反：新增一个状态时宁可它落进「排队」，
 *  也不要因为不认识就被当成「在跑」——一个永远转圈的卡比一个安静的卡更难解释。 */
const RUNNING_JOB_STATUSES: readonly string[] = [
  'submitting', 'provider_accepted', 'polling', 'retry_wait', 'downloading',
  'validating_technical', 'validating_content', 'reconciling',
]

/** ProductionRun 域投影 → 任务卡事实。拿不到 run 就返回空表，卡只剩标题。 */
function useTaskFacts(t: (key: string, options?: Record<string, unknown>) => string): ReadonlyMap<string, V4TaskFacts> {
  const run = useProductionRunStore((state) => state.run)
  return React.useMemo(() => {
    const map = new Map<string, V4TaskFacts>()
    if (!run) return map
    // ProductionRun 的状态词表有 15 个值，任务卡只有 5 个。映射按「用户看到的是什么」收：
    // `needs_attention` 是**失败**（它就是「有东西坏了，等你处理」），`pausing`/`paused` 是
    // 已停止，正在提交/轮询/下载/校验的那一串都是「生成中」。落不进去的一律排队——
    // 不给一个「完成」，那是唯一会骗人的方向。
    const status: V4TaskStatus =
      run.status === 'completed' ? 'complete'
        : run.status === 'cancelled' ? 'stopped'
          : run.status === 'pausing' || run.status === 'paused' ? 'stopped'
            : run.status === 'needs_attention' ? 'failed'
              : run.status === 'running' || run.status === 'exporting'
                || run.jobs.some((job) => RUNNING_JOB_STATUSES.includes(job.status)) ? 'running'
                : 'queued'
    const total = run.stages.length
    const done = run.stages.filter((stage) => stage.status === 'completed').length
    // 金额直接读 budget ledger 的汇总：`actual` 是已结算、`reserved` 是已预留。
    // 这两个数是真的记过账的，不是拿 token 乘一个我们自己编的费率。
    const money = (amount: number): string | undefined =>
      amount > 0 ? t('agentPanelV4.money', { currency: run.budget.currency, amount: amount.toFixed(2) }) : undefined
    map.set(run.runId, Object.freeze({
      status,
      ...(total > 0 ? { progress: Math.round((done / total) * 100), trailing: t('agentPanelV4.taskStages', { done, total }) } : {}),
      ...(money(run.budget.actual) ? { spent: money(run.budget.actual)! } : {}),
      ...(money(run.budget.reserved) ? { estimated: money(run.budget.reserved)! } : {}),
    }))
    return map
  }, [run, t])
}

export function useAgentPanelV4Data(surface: ResidentSurface): AgentPanelV4Data {
  const { t } = useTranslation()
  const labels = useV4Labels()
  const snapshot = useProjectAgentSnapshot()
  const activeThreadId = snapshot?.activeThreadId ?? null
  const binding = snapshot?.binding ?? null
  const bindingKey = binding ? projectBindingKey(binding) : null

  const pendingRecords = React.useSyncExternalStore(
    agentPanelV4PendingTools.subscribe,
    () => agentPanelV4PendingTools.listFor(bindingKey),
    () => agentPanelV4PendingTools.listFor(bindingKey),
  )

  const [models, setModels] = React.useState<readonly ModelCatalogModelDto[]>([])
  const [vendors, setVendors] = React.useState<Readonly<Record<string, string>>>({})
  const [selectedModelId, setSelectedModelId] = React.useState(() => {
    const pref = getAssistantModelPref()
    return pref ? `${pref.vendorKey}:${pref.modelKey}` : ''
  })
  const [skills, setSkills] = React.useState<readonly SkillListItemDto[]>([])

  const reloadModels = React.useCallback(() => {
    let alive = true
    void Promise.all([listWorkbenchModelCatalogVendors(), listWorkbenchModelCatalogModels({ kind: 'text', enabled: true })])
      .then(([vendorRows, modelRows]: [ModelCatalogVendorDto[], ModelCatalogModelDto[]]) => {
        if (!alive) return
        const usable = filterUsableAssistantTextModels(modelRows, vendorRows)
        setModels(usable)
        setVendors(Object.fromEntries(vendorRows.map((row) => [row.key, row.name])))
        const pref = getAssistantModelPref()
        const found = pref && usable.find((row) => row.vendorKey === pref.vendorKey && row.modelKey === pref.modelKey)
        if (found) setSelectedModelId(encodeModelIdentity(found))
        else {
          // 目录里已经没有这个模型了：清掉偏好，别让钮上继续显示一个按不动的名字。
          setAssistantModelPref(null)
          setSelectedModelId('')
        }
      })
      .catch(() => {
        if (alive) setModels([])
      })
    return () => {
      alive = false
    }
  }, [])

  React.useEffect(() => {
    const cancel = reloadModels()
    const onChange = (): void => {
      reloadModels()
    }
    window.addEventListener('nomi-model-catalog-changed', onChange)
    return () => {
      cancel?.()
      window.removeEventListener('nomi-model-catalog-changed', onChange)
    }
  }, [reloadModels])

  React.useEffect(() => {
    try {
      setSkills(listWorkbenchSkills())
    } catch {
      setSkills([])
    }
  }, [])

  const selectedModel = models.find((model) => encodeModelIdentity(model) === selectedModelId)
  const modelLabel = selectedModel
    ? labelForModel(selectedModel, [...models], vendors)
    // 没选模型时说实话。写一个型号名当占位是最糟的一种「默认」：用户以为已经在用它了。
    : t('agentPanelV4.modelUnset')

  const items = React.useMemo(
    () => snapshot?.items.filter((item) => item.threadId === activeThreadId) ?? [],
    [activeThreadId, snapshot],
  )
  const turns = React.useMemo(
    () => snapshot?.turns.filter((turn) => turn.threadId === activeThreadId) ?? [],
    [activeThreadId, snapshot],
  )
  const queueItems = React.useMemo(
    () => snapshot?.queue.filter((item) => item.threadId === activeThreadId) ?? [],
    [activeThreadId, snapshot],
  )
  const runningTurn = turns.find((turn) => turn.status === 'running')
  const liveTurn = turns.find((turn) => isProjectAgentLiveStatus(turn.status))

  // 会话内缓存的收据正文。终态 tool item 的结果是 ref-only（`resultRef`），
  // 正文只在这一次运行里存在过，所以要从 localStorage 把上次的读回来，
  // 否则冷启动后每条收据展开都是空的。
  const toolProjectionScope = bindingKey && activeThreadId ? residentToolProjectionScope(bindingKey, activeThreadId) : ''
  const toolProjections = React.useMemo(() => {
    const map = new Map<string, ResidentToolProjection>()
    if (!toolProjectionScope) return map
    for (const [callKey, projection] of Object.entries(readResidentToolProjections(toolProjectionScope))) {
      map.set(`${toolProjectionScope}:${callKey}`, projection)
    }
    // 投影层按 `turnId:toolCallId` 找，缓存按 `scope:turnId:toolCallId` 存。
    // 在这里剥掉 scope 前缀，别让投影层认识存储布局。
    const rekeyed = new Map<string, ResidentToolProjection>()
    for (const [key, value] of map) rekeyed.set(key.slice(toolProjectionScope.length + 1), value)
    return rekeyed
    // 依赖只有 scope：这份缓存是「上一次运行留下的收据正文」，它随线程/项目切换整批换，
    // 不随本次对话新增了几条 item 变化。早先把 `items.length` 挂进依赖是想「有新东西就重读」，
    // 但新收据的正文是**本次运行写进去的**，写完就已经在 store 里了，重读只是白读一遍 localStorage。
  }, [toolProjectionScope])

  const timeline = useWorkbenchStore((state) => state.timeline)
  const selectedClipIds = useWorkbenchStore((state) => state.selectedTimelineClipIds)
  const selectedTextClipId = useWorkbenchStore((state) => state.selectedTextClipId)
  const activeSkill = useWorkbenchStore((state) => state.creationActiveSkill)
  const attachments = useWorkbenchStore((state) => state.projectAgentAttachments)
  const timelineSelection = useTimelineSelectionChips(surface, timeline, selectedClipIds, selectedTextClipId)

  // 片段现在叫什么：只问当前时间轴。历史回合引用的那一段可能已经被删了，
  // 那时 `chipsForTurn` 会退回编号——不给一个已经不存在的名字。
  const clipLabels = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const track of timeline.tracks) for (const clip of track.clips) map.set(clip.id, clip.label || clip.id)
    for (const clip of timeline.textClips) map.set(clip.id, clip.text || clip.id)
    return map
  }, [timeline])
  const skillNames = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const skill of skills) map.set(skill.name, skill.label)
    if (activeSkill) map.set(activeSkill.key, activeSkill.name)
    return map
  }, [activeSkill, skills])

  // 撤销记录 → 宿主审批 → 那一次工具调用。三跳都在这里做完，投影层只接结果。
  // 少了中间那一跳（`hostApprovalId` → `proposalApprovals[].ref.toolCallId`）就只能靠猜，
  // 而猜错的代价是一个按下去没反应的「撤销」。
  const committedProposal = useCommittedProposal()
  const undoableToolKey = React.useMemo(() => {
    const approvalId = committedProposal?.hostApprovalId
    if (!approvalId || !snapshot) return undefined
    const approval = snapshot.proposalApprovals.find((candidate) => candidate.ref.approvalId === approvalId)
    return approval ? toolKey(approval.ref.turnId, approval.ref.toolCallId) : undefined
  }, [committedProposal?.hostApprovalId, snapshot])

  const taskFacts = useTaskFacts(t)
  const pendingTools = React.useMemo(() => toProjectionPendingTools(pendingRecords), [pendingRecords])
  const toolArgs = React.useMemo(() => {
    const map = new Map<string, unknown>()
    for (const record of pendingRecords) map.set(`${record.call.turnId}:${record.call.toolCallId}`, record.call.args)
    return map
  }, [pendingRecords])

  const primaryPending = pendingRecords.find((record) => record.state === 'pending')
  const suggestion = primaryPending ? missingParamSuggestion(primaryPending.call.args, t) : undefined
  const planRows = useTimelinePlanRows(primaryPending?.call.toolName, primaryPending?.call.args, timeline, t)
  const thinkingSeconds = useElapsedSeconds(liveTurn && !primaryPending ? liveTurn.createdAt : undefined)

  const flow = React.useMemo(() => {
    const base = projectV4Flow({
      items,
      turns,
      queue: queueItems,
      pendingTools,
      toolArgs,
      toolProjections,
      taskFacts,
      clipLabels,
      skillNames,
      ...(undoableToolKey ? { undoableToolKey } : {}),
      t,
    })
    const extra: V4FlowItem[] = []
    // 回合活着、还没有任何助手文字时，流末尾放一行「正在想…」。
    // 这一行是**唯一**在没有宿主记录时也会出现的东西，因为它表达的就是「宿主还没说话」。
    //
    // 但**等你确认的时候它不该出现**：那一刻在等的是用户，不是模型。
    // 一边浮着审批卡一边写「正在想…」，是在替 Nomi 撒一个很小但很讨厌的谎——
    // 用户会以为再等等它自己就好了。（2026-09-06 真机走查截图 04 抓到。）
    //
    // 秒数是这一行的**论点**：定稿写死了「4s · esc 打断」，理由是"转圈没有时间感，
    // 秒数才告诉用户没死"。只印「esc 打断」就把这一行的意义丢了。
    if (
      liveTurn
      && !primaryPending
      && !items.some((item) => item.kind === 'assistant' && item.turnId === liveTurn.turnId && item.text.trim())
    ) {
      extra.push({
        kind: 'thinking',
        label: t('agentPanelV4.thinkingLabel'),
        meta: `${thinkingSeconds}s · ${t('agentPanelV4.thinkingMeta')}`,
      })
    }
    // ④ 缺参数：一条提问 + 建议 chip，长在流里，不占介入槽。
    if (suggestion) extra.push({ kind: 'suggestion', text: suggestion.text, options: suggestion.options })
    return extra.length ? Object.freeze([...base, ...extra]) : base
  }, [clipLabels, items, liveTurn, pendingTools, primaryPending, queueItems, skillNames, suggestion, t, taskFacts, thinkingSeconds, toolArgs, toolProjections, turns, undoableToolKey])

  const slot = React.useMemo(() => {
    if (!primaryPending) return undefined
    return projectV4Intervention(
      {
        toolName: primaryPending.call.toolName,
        args: primaryPending.call.args,
        effectClass: resolveCapabilityEffectClass(primaryPending.call.toolName, primaryPending.call.args),
        pendingCount: pendingRecords.filter((record) => record.state === 'pending').length,
        ...(planRows.length ? { planLines: planRows.map((row) => ({ text: row.text, ...(row.technical ? { technical: row.technical } : {}) })) } : {}),
      },
      labels.interventionCopy,
      t,
    )
  }, [labels.interventionCopy, pendingRecords, planRows, primaryPending, t])

  const queue = React.useMemo(
    () => projectV4Queue({
      queue: queueItems.filter((item) => isProjectAgentLiveStatus(item.status)),
      items,
      labels: labels.queueActions,
    }),
    [items, labels.queueActions, queueItems],
  )

  const context = React.useMemo(
    () => projectV4Context({
      turns,
      ...(selectedModel?.contextWindow !== undefined ? { contextWindow: selectedModel.contextWindow } : {}),
      formatCost: (amount) => t('agentPanelV4.costUsd', { amount: amount.toFixed(2) }),
    }),
    [selectedModel?.contextWindow, t, turns],
  )

  const liveChips = React.useMemo(() => {
    const chips: V4Chip[] = []
    for (const attachment of attachments) chips.push({ kind: 'file', label: attachment.fileName })
    if (activeSkill) chips.push({ kind: 'skill', label: activeSkill.name })
    for (const selection of timelineSelection.selections) {
      // 时间轴片段的人话名字是 `label`；文本片段用它的正文。两者都可能是空串。
      const clip = selection.clip as { id: string; label?: string; text?: string }
      const label = clip.label || clip.text || clip.id
      chips.push({
        kind: 'clip',
        // 选中的那一段已经变了位置/长度：chip 上直接说「已变更」，别让用户以为还指着原来那段。
        label: timelineSelection.staleFor(clip.id) ? String(t('agentPanelV4.clipStale', { label })) : label,
      })
    }
    return Object.freeze(chips)
  }, [activeSkill, attachments, t, timelineSelection])

  return {
    snapshot,
    activeThreadId,
    flow,
    slot,
    queue,
    context,
    primaryPending,
    pendingRecords,
    runningTurnId: runningTurn?.turnId,
    running: Boolean(liveTurn),
    models,
    vendors,
    selectedModel,
    modelLabel,
    skills,
    liveChips,
    reloadModels,
    selectModel: (model) => {
      const value = encodeModelIdentity(model)
      setSelectedModelId(value)
      const identity = decodeModelIdentity(value)
      if (identity) setAssistantModelPref(identity)
    },
  }
}

export { residentToolProjectionKey }
