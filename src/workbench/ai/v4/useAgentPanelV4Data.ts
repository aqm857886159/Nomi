import { formatV4Tokens } from './agentPanelV4UsageFormat'
// The lane owns conversation state; workbenchStore owns unsent input.
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { LanePendingApproval, LaneWorkspaceProjection } from '../../../../electron/shared/agentLane/laneContracts'
import { getCommittedProposal, subscribeCommittedProposal } from '../../generationCanvas/agent/proposalUndo'
import { undoableLaneToolCallId } from '../lane/laneReceiptUndo'
import { laneClient } from '../lane/laneClient'
import { laneInterventionSource, laneViewModel } from '../lane/laneViewModel'
import { humanizeToolFailure, readableToolName, readableToolSummary } from '../resident/residentToolDisplay'
import { projectV4Intervention } from './agentPanelV4Intervention'
import { useWorkbenchStore } from '../../workbenchStore'
import { listWorkbenchModelCatalogModels, listWorkbenchModelCatalogVendors, type ModelCatalogModelDto, type ModelCatalogVendorDto } from '../../api/modelCatalogApi'
import { listWorkbenchSkills, type SkillListItemDto } from '../../api/skillApi'
import { skillDisplayTitle } from '../../skillLibrary/skillDisplay'
import { onSkillLibraryChanged } from '../../skillLibrary/skillLibraryChanged'
import { decodeModelIdentity, encodeModelIdentity, filterUsableAssistantTextModels, labelForModel } from '../assistantModelIdentity'
import { getAssistantModelPref, setAssistantModelPref } from '../assistantModelPref'
import { useTimelinePlanRows, useTimelineSelectionChips } from '../resident/timelineAgentSurface'
import { useVendorPreferenceOrder } from '../../common/useVendorPreference'
import {
  getGenerationModelDefaults,
  loadGenerationModelDefaults,
  saveGenerationModelDefaults,
  subscribeGenerationModelDefaults,
  type GenerationDefaultTaskKind,
  type GenerationModelDefault,
  type GenerationModelDefaultMap,
} from '../../generationCanvas/model/generationModelDefaults'
import type { ResidentSurface } from '../resident/residentShellDisplay'
import { collapseV4Flow } from './agentPanelV4Collapse'
import { useV4Labels } from './agentPanelV4Labels'
import type { ContextUsage, InterventionData, QueueRowData, V4Chip, V4FlowItem } from './agentPanelV4Types'


export type AgentPanelV4Data = Readonly<{
  snapshot: LaneWorkspaceProjection
  activeThreadId: string | null
  flow: readonly V4FlowItem[]
  slot: InterventionData | undefined
  /**
   * 计划槽的两件交互状态 + 它们的写口。住在读侧，是因为「哪几行还勾着」是**投影的输入**
   * （`uncheckedPlanRows` → `planRowsOf`），不是壳的长相；两份状态放两个地方必然会漂。
   * 换一条待决（`toolCallId` 变）时整体归零：上一张卡取消掉的行，与这一张无关。
   */
  plan: Readonly<{
    /** 被取消勾选的行 label。 */
    unchecked: ReadonlySet<string>
    /** 还勾着的行 label（按清单原序）。全勾时 = 全部行。 */
    kept: readonly string[]
    collapsed: boolean
    toggleRow: (label: string, checked: boolean) => void
    toggleCollapsed: () => void
  }>
  queue: readonly QueueRowData[]
  context: ContextUsage
  /** 当前待决里排第一条的那个（介入槽渲染的就是它）。 */
  primaryPending: LanePendingApproval | undefined
  pendingRecords: readonly { call: LanePendingApproval }[]
  /** 有回合活着就是 running；composer 换成「停止」、占位文案改「将排队发送」。 */
  running: boolean
  models: readonly ModelCatalogModelDto[]
  /** 图片 / 视频目录（模型弹层的「图片默认 / 视频默认」两行读它）。 */
  generationModels: readonly ModelCatalogModelDto[]
  /** 供应商排序偏好（PR #535）：同名模型折成一行时留哪一家，按它。 */
  orderedVendorKeys: readonly string[]
  /** 「新建卡片默认模型」的当前值。Agent 帮你生成时用的就是它——弹层改的也是它，不另开一份偏好。 */
  generationDefaults: GenerationModelDefaultMap
  setGenerationDefault: (taskKind: GenerationDefaultTaskKind, identity: GenerationModelDefault | null) => void
  vendors: Readonly<Record<string, string>>
  selectedModel: ModelCatalogModelDto | undefined
  modelLabel: string
  skills: readonly SkillListItemDto[]
  /** composer 上方的活 chip（还没发出去的那些）。 */
  liveChips: readonly V4Chip[]
  reloadModels: () => void
  selectModel: (model: ModelCatalogModelDto) => void
}>

export function useAgentPanelV4Data(surface: ResidentSurface): AgentPanelV4Data {
  const { t, i18n } = useTranslation()
  const labels = useV4Labels()
  const snapshot = React.useSyncExternalStore(laneClient.subscribe, laneClient.workspace, laneClient.workspace)
  const committedProposal = React.useSyncExternalStore(subscribeCommittedProposal, getCommittedProposal, getCommittedProposal)
  const undoableToolCallId = undoableLaneToolCallId(snapshot.active.parts, committedProposal)
  const activeThreadId = snapshot.lanes.find((lane) => lane.laneName === snapshot.active.lane)?.sessionId ?? null
  const primaryPending = snapshot.active.pending
  const pendingRecords = React.useMemo(() => primaryPending ? [{ call: primaryPending }] : [], [primaryPending])
  const [models, setModels] = React.useState<readonly ModelCatalogModelDto[]>([])
  const [vendors, setVendors] = React.useState<Readonly<Record<string, string>>>({})
  const [selectedModelId, setSelectedModelId] = React.useState(() => {
    const pref = getAssistantModelPref()
    return pref ? `${pref.vendorKey}:${pref.modelKey}` : ''
  })
  const [skills, setSkills] = React.useState<readonly SkillListItemDto[]>([])
  const [generationModels, setGenerationModels] = React.useState<readonly ModelCatalogModelDto[]>([])
  const orderedVendorKeys = useVendorPreferenceOrder()
  // 「新建卡片默认模型」已经有一个 owner（`generationModelDefaults`，设置页那四行读写的也是它）。
  // 弹层接的是同一份，不是第二份偏好——否则「Agent 生成时用哪个模型」会有两个答案。
  const generationDefaults = React.useSyncExternalStore(
    subscribeGenerationModelDefaults,
    getGenerationModelDefaults,
    getGenerationModelDefaults,
  )
  React.useEffect(() => {
    void loadGenerationModelDefaults().catch(() => undefined)
  }, [])

  const reloadModels = React.useCallback(() => {
    let alive = true
    void Promise.all([
      listWorkbenchModelCatalogVendors(),
      listWorkbenchModelCatalogModels({ kind: 'text', enabled: true }),
      listWorkbenchModelCatalogModels({ kind: 'image', enabled: true }),
      listWorkbenchModelCatalogModels({ kind: 'video', enabled: true }),
    ])
      .then(([vendorRows, modelRows, imageRows, videoRows]: [ModelCatalogVendorDto[], ModelCatalogModelDto[], ModelCatalogModelDto[], ModelCatalogModelDto[]]) => {
        if (!alive) return
        setGenerationModels(Object.freeze([...imageRows, ...videoRows]))
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
        if (!alive) return
        setModels([])
        setGenerationModels([])
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

  const reloadSkills = React.useCallback(() => {
    try {
      setSkills(listWorkbenchSkills())
    } catch {
      setSkills([])
    }
  }, [])

  React.useEffect(() => {
    reloadSkills()
    // 技能库是**盘上**的共享状态，这个面板只是它的第二个读者。没有这条失效信号时，
    // 用户在左边技能库里刚导进来的技能，右边 `/` 菜单里一个字都没有——导进来了却用不上。
    return onSkillLibraryChanged(reloadSkills)
  }, [reloadSkills])

  const selectedModel = models.find((model) => encodeModelIdentity(model) === selectedModelId)
    ?? models.find((model) => model.vendorKey === snapshot.active.model?.provider
      && (model.modelKey === snapshot.active.model.modelId || model.modelAlias === snapshot.active.model.modelId))
  const modelLabel = selectedModel
    ? labelForModel(selectedModel, [...models], vendors)
    // 没选模型时说实话。写一个型号名当占位是最糟的一种「默认」：用户以为已经在用它了。
    : t('agentPanelV4.modelUnset')

  const timeline = useWorkbenchStore((state) => state.timeline)
  const selectedClipIds = useWorkbenchStore((state) => state.selectedTimelineClipIds)
  const selectedTextClipId = useWorkbenchStore((state) => state.selectedTextClipId)
  const activeSkill = useWorkbenchStore((state) => state.creationActiveSkill)
  const selectedLibraryPrompt = useWorkbenchStore((state) => state.selectedLibraryPrompt)
  const attachments = useWorkbenchStore((state) => state.projectAgentAttachments)
  const timelineSelection = useTimelineSelectionChips(surface, timeline, selectedClipIds, selectedTextClipId)

  const view = React.useMemo(() => laneViewModel(snapshot.active, {
    toolLabel: (name, args) => readableToolName(t, name, args),
    toolSummary: (name, args) => readableToolSummary(t, name, args),
    toolFailure: (text) => humanizeToolFailure(t, text) ?? text,
    thinkingLabel: t('agentPanelV4.thinkingLabel'),
    formatTokens: formatV4Tokens,
    formatCost: (amount) => t('agentPanelV4.costUsd', { amount: amount.toFixed(2) }),
    retryLabel: (attempt, maxAttempts) => t('agentPanelV4.retrying', { attempt, maxAttempts }),
    unknown: t('agentPanelV4.contextUnknown'),
    free: t('agentPanelV4.contextCostFree'),
    taskTitle: t('agentPanelV4.taskRun'),
    formatStages: (done, total) => t('agentPanelV4.taskStages', { done, total }),
    formatMoney: (currency, amount) => t('agentPanelV4.money', { currency, amount: amount.toFixed(2) }),
    taskUnknown: t('agentPanelV4.taskUnknown'),
    // 名字与 `/` 菜单、技能库画廊同一个 owner（`skillDisplayTitle`）：菜单里选的是「分镜规划」，
    // 气泡上就得也叫「分镜规划」。库里查不到就原样印 key——用户确实挂过它，只是这台机器上
    // 现在没有这份技能；把 chip 藏掉等于抹掉他做过的操作。
    skillLabel: (key) => {
      const found = skills.find((skill) => skill.name === key)
      return found ? skillDisplayTitle(found, i18n.language) : key
    },
    // 封面与名字同一份目录、同一次查：气泡里那颗 chip 和 composer 上那颗（`liveChips`）
    // 因此长得一样，用户挂上去看见什么、发出去还是什么。
    skillMedia: (key) => {
      const found = skills.find((skill) => skill.name === key)
      return found ? { cover: found.cover, preview: found.preview } : undefined
    },
  }, undoableToolCallId), [snapshot.active, i18n.language, skills, t, undoableToolCallId])
  const flow = React.useMemo(() => {
    const items = [...view.items]
    const last = items.at(-1)
    if (view.retry || (view.running && !primaryPending && (!last || last.kind === 'user'))) {
      items.push({ kind: 'thinking', label: view.retry ?? t('agentPanelV4.thinkingLabel'), meta: '' })
    }
    return collapseV4Flow(items, t)
  }, [view.items, view.retry, view.running, primaryPending, t])
  const planRows = useTimelinePlanRows(primaryPending?.toolName, primaryPending?.args, timeline, t)
  const [planState, setPlanState] = React.useState<{ forCallId: string | null; unchecked: ReadonlySet<string>; collapsed: boolean }>(
    { forCallId: null, unchecked: new Set(), collapsed: false },
  )
  // 归零绑在 `toolCallId` 上而不是「卡消失了就清」：同一张卡在面板/收起坞之间来回换外壳时
  // 组件会重挂，用后者会把用户刚取消掉的几行悄悄勾回来。
  const planCallId = primaryPending?.toolCallId ?? null
  const plan = React.useMemo(() => {
    const fresh = planState.forCallId !== planCallId
    const unchecked: ReadonlySet<string> = fresh ? new Set<string>() : planState.unchecked
    return {
      unchecked,
      collapsed: fresh ? false : planState.collapsed,
      toggleRow: (label: string, checked: boolean) => setPlanState((current) => {
        const base = current.forCallId === planCallId ? current : { forCallId: planCallId, unchecked: new Set<string>(), collapsed: false }
        const next = new Set(base.unchecked)
        if (checked) next.delete(label); else next.add(label)
        return { forCallId: planCallId, unchecked: next, collapsed: base.collapsed }
      }),
      toggleCollapsed: () => setPlanState((current) => {
        const base = current.forCallId === planCallId ? current : { forCallId: planCallId, unchecked: new Set<string>(), collapsed: false }
        return { ...base, forCallId: planCallId, collapsed: !base.collapsed }
      }),
    }
  }, [planCallId, planState])
  const slot = primaryPending ? projectV4Intervention({
    ...laneInterventionSource(primaryPending),
    ...(planRows.length ? { planLines: planRows } : {}),
    uncheckedPlanRows: plan.unchecked,
  }, labels.interventionCopy, t) : undefined
  const queue = view.queues.map((entry) => ({
    title: entry.text || t('agentPanelV4.queueUntitled'),
    status: 'queued' as const,
    actions: [t('agentPanelV4.queueDelete')],
  }))
  const context = view.usage

  const liveChips = React.useMemo(() => {
    const chips: V4Chip[] = []
    for (const attachment of attachments) chips.push({ kind: 'file', label: attachment.fileName })
    if (activeSkill) {
      const skill = skills.find(s => s.name === activeSkill.key)
      chips.push({ kind: 'skill', label: activeSkill.name, cover: skill?.cover, preview: skill?.preview, description: skill?.description ?? undefined })
    } else if (selectedLibraryPrompt) chips.push({ kind: 'skill', label: selectedLibraryPrompt.title, cover: selectedLibraryPrompt.mediaType === 'image' ? selectedLibraryPrompt.mediaUrl : undefined, preview: selectedLibraryPrompt.mediaUrl ? { url: selectedLibraryPrompt.mediaUrl, type: selectedLibraryPrompt.mediaType } : undefined, description: selectedLibraryPrompt.prompt })
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
  }, [activeSkill, selectedLibraryPrompt, skills, attachments, t, timelineSelection])

  return {
    snapshot,
    activeThreadId,
    flow,
    slot,
    plan: { ...plan, kept: (slot?.plan ?? []).filter((row) => row.checked).map((row) => row.label) },
    queue,
    context,
    primaryPending,
    pendingRecords,
    running: view.running,
    models,
    generationModels,
    orderedVendorKeys,
    generationDefaults,
    setGenerationDefault: (taskKind, identity) => {
      const next: GenerationModelDefaultMap = { ...getGenerationModelDefaults() }
      if (identity) next[taskKind] = identity
      else delete next[taskKind]
      void saveGenerationModelDefaults(next).catch(() => undefined)
    },
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
