// 常驻 Agent 面板的容器。
//
// 它现在只做三件事：把宿主接线（读侧 `useAgentPanelV4Data` / 写侧 `useAgentPanelV4Actions`）
// 接到 v4 的积木上、量出面板尺寸、把几个跨面桥（分镜启动器、时间轴计划预览、收起状态）留在原地。
// 长相一件都不在这里——那 9 个积木住在 `src/workbench/ai/v4/`，由 57 张设计实验室基线钉住。
//
// 之前这里是 760 行：投影、嗅探、弹层、队列行、审批按钮全在一个组件里，
// 「宿主真相怎么变成一行收据」这件事只能靠截图证明。拆开之后那部分是纯函数、有单测；
// 这里剩下的都是**只有真实运行时才有的东西**（DOM 尺寸、事件桥、文件选择器）。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../utils/cn'
import type { AgentToolProfile } from '../../../electron/shared/projectAgentContracts'
import { useWorkbenchStore } from '../workbenchStore'
import { useComposerAttachments, COMPOSER_ATTACHMENT_ACCEPT } from './composer/useComposerAttachments'
import { useResidentActivityStore } from './residentActivity'
import { TimelineAgentReceiptEffect } from './resident/TimelineAgentReceiptEffect'
import { useTimelinePlanPreview } from './resident/timelineAgentSurface'
import type { ResidentSurface } from './resident/residentShellDisplay'
import { AgentPanelV4Panel } from './v4/AgentPanelV4Panel'
import { V4Intervention } from './v4/AgentPanelV4Cards'
import { V4CollapsedDock, V4CollapsedRail } from './v4/AgentPanelV4Dock'
import { AgentPanelV4Composer, V4ModelPopover, V4PermissionPopover, V4SkillPopover, type V4CommandRow, type V4ModelRow } from './v4/AgentPanelV4Composer'
import { useAgentPanelV4Data } from './v4/useAgentPanelV4Data'
import { useAgentPanelV4Actions } from './v4/useAgentPanelV4Actions'
import { useV4Labels } from './v4/agentPanelV4Labels'
import { usePromptLibrary } from '../promptLibrary/usePromptLibrary'
import { useUserPrompts } from '../promptLibrary/useUserPrompts'
import { promptDisplayTitle } from '../promptLibrary/promptDisplay'
import { filterPrompts } from '../api/promptLibraryApi'
import type { ComposerPopover } from './v4/agentPanelV4Types'
import { chatModelChoices } from './v4/agentPanelV4ModelRows'
import { encodeModelIdentity } from './assistantModelIdentity'
import { buildDefaultModelOptions } from '../settings/defaultGenerationModelOptions'

/** 面板尺寸只有真实 DOM 知道。v4 的积木按面板高度 derive composer 上限，所以必须量。 */
function usePanelSize(ref: React.RefObject<HTMLElement>): Readonly<{ width: number; height: number }> {
  const [size, setSize] = React.useState({ width: 390, height: 620 })
  React.useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (!box) return
      // 面板宽度是用户拖出来的，高度跟着工作区。两个数都取整：小数宽度会让
      // `data-height` 每一帧都不同，视觉基线因此随机翻红。
      setSize({ width: Math.round(box.width), height: Math.round(box.height) })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  return size
}

export default function ProjectAgentResidentShell({ surface }: { surface: ResidentSurface }): JSX.Element {
  const { t } = useTranslation()
  const labels = useV4Labels()
  const rootRef = React.useRef<HTMLDivElement>(null)
  const size = usePanelSize(rootRef)
  const collapsed = useWorkbenchStore((state) => state.projectAgentDockCollapsed)
  const setCollapsed = useWorkbenchStore((state) => state.setProjectAgentDockCollapsed)
  const draft = useWorkbenchStore((state) => state.projectAgentDraft)
  const setDraft = useWorkbenchStore((state) => state.setProjectAgentDraft)
  const attachments = useWorkbenchStore((state) => state.projectAgentAttachments)
  const setAttachments = useWorkbenchStore((state) => state.setProjectAgentAttachments)
  const activeSkill = useWorkbenchStore((state) => state.creationActiveSkill)
  const setActiveSkill = useWorkbenchStore((state) => state.setCreationActiveSkill)
  const setStoryboardPlannerLauncher = useWorkbenchStore((state) => state.setStoryboardPlannerLauncher)
  const timeline = useWorkbenchStore((state) => state.timeline)

  const data = useAgentPanelV4Data(surface)
  const actions = useAgentPanelV4Actions(surface, data)
  const [popover, setPopover] = React.useState<ComposerPopover | null>(null)
  const [threadsOpen, setThreadsOpen] = React.useState(false)
  const [commandQuery, setCommandQuery] = React.useState('')
  const attachmentApi = useComposerAttachments({ attachments, setAttachments, onError: () => undefined })
  const promptLibrary = usePromptLibrary(popover === 'skill')
  const userPromptLibrary = useUserPrompts(popover === 'skill')
  const timelinePlanPreviewPortal = useTimelinePlanPreview(
    surface,
    data.pendingRecords,
    timeline,
    t('agentResident.timelinePlanPreview'),
  )

  // 常驻 Agent 是分镜启动器的**唯一** owner。桥只在创作面活着，切面时立刻摘掉，
  // 免得一个隐藏的创作坞在之后接到点击。
  React.useEffect(() => {
    if (surface !== 'creation') return
    const launch = (displayPrompt?: string): void => {
      void actions.send(t('agentResident.storyboardRequest'), {
        toolProfile: 'storyboard' as AgentToolProfile,
        ...(displayPrompt ? { displayText: displayPrompt } : {}),
      })
    }
    setStoryboardPlannerLauncher(launch)
    return () => setStoryboardPlannerLauncher(null)
  }, [actions, setStoryboardPlannerLauncher, surface, t])

  // 收起后那颗状态点读的是同一份判据（`residentActivity` 只是它的投影口，
  // 图标条不在这棵子树里，够不着回合状态）。
  const publishActivity = useResidentActivityStore((state) => state.setResidentActivity)
  const activityTone = data.running
    ? 'bg-nomi-accent'
    : data.primaryPending ? 'bg-nomi-warning' : 'bg-nomi-ink-30'
  const activityLabel = data.running
    ? labels.queue.running
    : data.primaryPending ? t('agentPanelV4.waitingApproval') : t('agentPanelV4.ready')
  React.useEffect(() => {
    publishActivity(activityTone, activityLabel)
  }, [activityLabel, activityTone, publishActivity])

  /**
   * 错误条 / 失败任务卡上那个动作钮。
   *
   * 旧面板走的是一个自定义事件（`nomi-agent-write-retry`）：异常卡派发、常驻壳监听、
   * 监听里把重试那句话填进 composer。异常卡随 v4 接线删掉之后，那个事件就只剩监听方——
   * 一个永远打不开的入口。这里把同一件事改成**直接调用**：动作就长在渲染它的那一行旁边，
   * 没有中间人，也就不会有「监听还在、派发没了」这种半截接线。
   * 填进 composer 而不是直接重发：重试要花钱，该由用户按下发送。
   */
  const recoverFromFailure = React.useCallback((index: number) => {
    const item = data.flow[index]
    const hint = item?.kind === 'error' ? item.action : undefined
    actions.clearError()
    setDraft(hint || t('agentResident.editPlanPrompt'))
  }, [actions, data.flow, setDraft, t])

  const submit = React.useCallback(() => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    void actions.send(text)
  }, [actions, draft, setDraft])

  /**
   * 空态起手 chip：把那句话填进 composer 并把光标交给用户——**不发送**。
   *
   * 发送要花钱、要动项目，第一句话该由他自己按下去；chip 只负责替他省掉「不知道该说什么」。
   * 聚焦走一个 token + effect，而不是在回调里直接 `focus()`：那一刻 `value` 还是旧的，
   * 光标会落在字符串开头，用户接着打字就插在句首。effect 跑在同一次提交的 DOM 之后，
   * 新句子已经在框里，才好把插入点放到末尾。
   */
  const composerInputRef = React.useRef<HTMLTextAreaElement>(null)
  const [starterFocusToken, setStarterFocusToken] = React.useState(0)
  React.useEffect(() => {
    if (!starterFocusToken) return
    const node = composerInputRef.current
    if (!node) return
    node.focus()
    node.setSelectionRange(node.value.length, node.value.length)
  }, [starterFocusToken])
  const startFromStarter = React.useCallback((prompt: string) => {
    setDraft(prompt)
    setStarterFocusToken((token) => token + 1)
  }, [setDraft])

  /**
   * 模型弹层 = **每类一行**，不是「每个型号一行」（2026-09-06 定稿 ⑤ + 打包版实测）。
   *
   * 生产版此前把整个文本模型目录摊成 17 行、每行标签都写「对话」、一个下拉都没有，
   * 也没有图片/视频那两行——等于把「选型」这件事整个推回给用户，还顺手把
   * `key={row.slot}` 全撞在一起。
   *
   * 三行各接**已有的** owner，不新开偏好：
   *   对话 → `assistantModelPref`（`data.selectModel`）
   *   图片 → `generationModelDefaults.text_to_image`
   *   视频 → `generationModelDefaults.text_to_video`
   * 「音频默认」定稿里有、仓库里没有：`GENERATION_DEFAULT_TASK_KINDS` 只有图/视频四个 taskKind，
   * 也没有任何 audio 生成节点或解析器。画一个存不下去的下拉，比少画一行更糟——
   * 这一格待用户拍板（PR 正文里单独标出）。
   */
  const generationOptions = React.useMemo(
    () => buildDefaultModelOptions(
      data.generationModels,
      (vendorKey) => data.vendors[vendorKey] ?? vendorKey,
      t('agentPanelV4.modelAuto'),
    ),
    [data.generationModels, data.vendors, t],
  )

  const modelRows: readonly V4ModelRow[] = React.useMemo(() => {
    const rows: V4ModelRow[] = []
    const chatChoices = chatModelChoices(
      data.models,
      data.vendors,
      data.orderedVendorKeys,
      encodeModelIdentity,
      (cost) => t('agentPanelV4.modelCredits', { cost }),
    )
    const selectedChat = data.selectedModel ? encodeModelIdentity(data.selectedModel) : ''
    rows.push({
      slot: t('agentPanelV4.modelChat'),
      name: data.modelLabel,
      ...(chatChoices.length
        ? {
            options: chatChoices.map((choice) => ({
              value: choice.value,
              label: choice.label,
              ...(choice.trailing ? { trailing: choice.trailing } : {}),
            })),
            selectedValue: selectedChat,
            onChange: (value: string) => {
              const model = data.models.find((candidate) => encodeModelIdentity(candidate) === value)
              if (model) data.selectModel(model)
            },
          }
        : { empty: t('agentPanelV4.modelNone') }),
    })
    for (const [slot, taskKind] of [
      [t('agentPanelV4.imageDefault'), 'text_to_image'],
      [t('agentPanelV4.videoDefault'), 'text_to_video'],
    ] as const) {
      const options = generationOptions.optionsByKind[taskKind]
      const current = data.generationDefaults[taskKind]
      const selectedValue = current ? generationOptions.encode(current) : ''
      const label = options.find((option) => option.value === selectedValue)?.label
      rows.push({
        slot,
        // 目录里已经没有这个模型了：说「已不可用」，别继续印一个按不动的名字。
        name: label ?? (current ? t('agentPanelV4.modelGone') : t('agentPanelV4.modelAuto')),
        // options[0] 恒为「自动选」那一条，所以 >1 才叫「有得选」。
        ...(options.length > 1
          ? {
              options,
              selectedValue: selectedValue ?? '',
              onChange: (value: string) => data.setGenerationDefault(taskKind, generationOptions.decode(value)),
            }
          : { empty: t('agentPanelV4.modelNone') }),
      })
    }
    return Object.freeze(rows)
  }, [data, generationOptions, t])

  const commandRows: readonly V4CommandRow[] = React.useMemo(() => {
    const query = commandQuery.trim()
    const skillRows: V4CommandRow[] = data.skills
      .filter((skill) => !query || `${skill.label} ${skill.name}`.toLowerCase().includes(query.toLowerCase()))
      // 自己导进来的排在内置前面。用户刚把一个技能弄进 Nomi，下一秒来这里找它——
      // 让他先滚过四个他没装过的内置技能才看见自己那个，是把「我刚做的事」排在最后。
      .sort((a, b) => (a.origin === b.origin ? 0 : a.origin === 'user' ? -1 : 1))
      .map((skill) => ({
        id: `skill:${skill.name}`,
        name: skill.label,
        command: `/${skill.name}`,
        desc: skill.description ?? skill.stageLabels.join(' · '),
        section: t('agentPanelV4.sectionSkills'),
        selected: activeSkill?.key === skill.name,
      }))
    // ⑤ 提示词库并进同一个 `/` 菜单。两段各有名字，搜索一次搜两段——
    // 用户那一刻想的是「给这次对话装一套说法」，不是「这算技能还是提示词」。
    const promptRows: V4CommandRow[] = [...promptLibrary.items, ...userPromptLibrary.items]
      .filter((prompt) => filterPrompts([prompt], 'all', query).length > 0)
      .map((prompt) => ({
        id: `prompt:${prompt.id}`,
        name: promptDisplayTitle(prompt),
        command: `/${prompt.id}`,
        desc: prompt.prompt.slice(0, 60),
        section: t('agentPanelV4.sectionPrompts'),
        // 提示词库本来就有封面（`mediaUrl` = 首图），此前在这里被整包丢掉，
        // 于是每一行都退化成同一个白块。有图就把图给它。
        ...(prompt.mediaUrl ? { cover: prompt.mediaUrl } : {}),
        selected: actions.selectedLibraryPrompt?.id === prompt.id,
      }))
    return Object.freeze([...skillRows, ...promptRows])
  }, [actions.selectedLibraryPrompt, activeSkill, commandQuery, data.skills, promptLibrary.items, t, userPromptLibrary.items])

  const composerPopover = popover === 'model'
    ? <V4ModelPopover rows={modelRows} onOpenLibrary={() => { window.dispatchEvent(new Event('nomi-open-model-catalog')); setPopover(null) }} />
    : popover === 'skill'
      ? (
        <V4SkillPopover
          rows={commandRows}
          categories={[t('agentPanelV4.skillAll'), t('agentPanelV4.sectionSkills'), t('agentPanelV4.sectionPrompts')]}
          query={commandQuery}
          onQueryChange={setCommandQuery}
          onSelect={(row) => {
            if (row.id.startsWith('skill:')) {
              const key = row.id.slice('skill:'.length)
              // 技能与提示词互斥：一次对话只装一套说法。两个都挂上时模型收到两段
              // 互相打架的系统提示，产出会比不装还差。
              actions.setSelectedLibraryPrompt(null)
              setActiveSkill(activeSkill?.key === key ? null : { key, name: row.name })
            } else {
              const id = row.id.slice('prompt:'.length)
              const prompt = [...promptLibrary.items, ...userPromptLibrary.items].find((item) => item.id === id)
              setActiveSkill(null)
              actions.setSelectedLibraryPrompt(prompt ?? null)
            }
            setPopover(null)
          }}
          onManage={() => { window.dispatchEvent(new Event('nomi-focus-skill-library')); setPopover(null) }}
        />
      )
      : popover === 'permission'
        ? <V4PermissionPopover permission={actions.permission} onSelect={(tier) => { actions.setPermission(tier); setPopover(null) }} />
        : undefined

  // 收起 = 藏起**对话流**，不是藏起对话（定稿 Collapsed 板）。同一个 composer 掉到画面下沿
  // 居中，介入槽跟着它——这样一份编辑计划仍然读得到、批得下，不必把整列还给面板。
  // 只留一条图标条、把 composer 也收走，才是真的把对话中断了。
  if (collapsed) {
    return (
      <section
        id="project-agent-resident"
        className="pointer-events-none relative h-full w-full overflow-visible"
        aria-label={t('agentResident.aria')}
        data-agent-resident="true"
        data-agent-surface={surface}
        data-agent-collapsed="true"
      >
        <TimelineAgentReceiptEffect />
        {timelinePlanPreviewPortal}
        <V4CollapsedDock>
          {data.slot ? (
            <V4Intervention
              data={data.slot}
              labels={labels.intervention}
              onConfirm={actions.approve}
              onReject={actions.reject}
              onEscalate={actions.stopAsking}
              onOption={(option) => actions.answerOption(option)}
            />
          ) : null}
          <AgentPanelV4Composer
            dock
            panelHeight={size.height}
            mode={data.running ? 'running' : data.liveChips.length ? 'reference' : 'idle'}
            permission={actions.permission}
            chips={data.liveChips}
            value={draft}
            onValueChange={setDraft}
            onSubmit={submit}
            onStop={actions.stop}
            onAddFile={() => attachmentApi.inputRef.current?.click()}
            modelLabel={data.modelLabel}
            skillSelected={Boolean(activeSkill || actions.selectedLibraryPrompt)}
          />
        </V4CollapsedDock>
        <div className="pointer-events-auto absolute right-0 top-0 h-full">
          <V4CollapsedRail running={data.running} labels={labels.dock} onOpen={() => setCollapsed(false)} onAdjust={() => setCollapsed(false)} />
        </div>
      </section>
    )
  }

  return (
    <div
      ref={rootRef}
      id="project-agent-resident"
      className="relative isolate flex h-full min-h-0 w-full min-w-0 flex-col bg-[var(--workbench-ai-panel-bg)] text-nomi-ink"
      aria-label={t('agentResident.aria')}
      data-agent-resident="true"
      data-agent-panel="true"
      data-agent-surface={surface}
      data-agent-approval-mode={actions.permission}
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape') {
          setPopover(null)
          setThreadsOpen(false)
        }
      }}
    >
      <TimelineAgentReceiptEffect />
      {timelinePlanPreviewPortal}
      <input
        ref={attachmentApi.inputRef}
        type="file"
        multiple
        accept={COMPOSER_ATTACHMENT_ACCEPT}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={attachmentApi.onInputChange}
      />
      {actions.error ? (
        <div className="shrink-0 px-3 pt-1 text-micro text-workbench-danger" role="alert" data-agent-error="true">
          {actions.error}
        </div>
      ) : null}
      <AgentPanelV4Panel
        width={size.width}
        height={actions.error ? size.height - 20 : size.height}
        flow={data.flow}
        surface={surface}
        onStarter={startFromStarter}
        slot={data.slot}
        queue={data.queue}
        context={data.context}
        onHistory={() => setThreadsOpen((value) => !value)}
        onCollapse={() => setCollapsed(true)}
        flowHandlers={{
          onCopy: (text) => { void navigator.clipboard?.writeText(text) },
          onContinue: () => actions.steer(draft.trim() || t('agentResident.editPlanPrompt')),
          onUndoTool: actions.undoLastProposal,
          onUndoTask: actions.undoLastProposal,
          onErrorAction: recoverFromFailure,
          onSuggestion: (_index, option) => actions.answerOption(option),
        }}
        slotHandlers={{
          onConfirm: actions.approve,
          onReject: actions.reject,
          onEscalate: actions.stopAsking,
          onOption: (option) => actions.answerOption(option),
          onAlternate: () => window.dispatchEvent(new Event('nomi-open-model-catalog')),
        }}
        queueHandlers={{
          onAction: actions.queueAction,
          onDestructiveAction: actions.queueInterrupt,
        }}
        composer={{
          mode: data.running ? 'running' : data.liveChips.length ? 'reference' : 'idle',
          permission: actions.permission,
          chips: data.liveChips,
          value: draft,
          onValueChange: setDraft,
          onSubmit: submit,
          onStop: actions.stop,
          onAddFile: () => attachmentApi.inputRef.current?.click(),
          inputRef: composerInputRef,
          onRemoveChip: (chip) => {
            if (chip.kind === 'skill') setActiveSkill(null)
            else if (chip.kind === 'file') {
              const match = attachments.find((item) => item.fileName === chip.label)
              if (match) attachmentApi.removeAttachment(match.id)
            }
            // clip chip 指的是时间轴上的真实选中：它的「移除」是在时间轴上取消选中，
            // 不是从一个附件列表里删一行。面板不代替用户操作另一个面。
          },
          modelLabel: data.modelLabel,
          skillSelected: Boolean(activeSkill || actions.selectedLibraryPrompt),
          openPopover: popover,
          onTogglePopover: (next) => setPopover((current) => (current === next ? null : next)),
          ...(composerPopover ? { popover: composerPopover } : {}),
        }}
      />
      {threadsOpen ? (
        <div
          className="absolute right-2 top-10 z-50 w-[280px] rounded-nomi border border-nomi-line bg-nomi-paper p-1 shadow-nomi-lg"
          data-agent-thread-menu="true"
          role="menu"
        >
          <div className="flex items-center justify-between px-2 py-1 text-micro text-nomi-ink-60">
            <span>{t('agentResident.threads')}</span>
            <button type="button" className="text-nomi-accent" onClick={() => { actions.newThread(); setThreadsOpen(false) }}>
              {t('agentResident.newThread')}
            </button>
          </div>
          {(data.snapshot?.threads ?? []).map((thread) => (
            <div
              key={thread.threadId}
              className={cn('flex items-center gap-1 rounded-nomi-sm px-2 py-1', thread.threadId === data.activeThreadId && 'bg-nomi-accent-soft')}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-caption"
                onClick={() => { actions.activateThread(thread.threadId); setThreadsOpen(false) }}
              >
                {thread.title || t('agentResident.untitledThread')}
              </button>
              <button
                type="button"
                className="grid size-7 place-items-center rounded-nomi-sm hover:bg-nomi-ink-10"
                aria-label={t('agentResident.removeThread')}
                onClick={() => actions.removeThread(thread.threadId)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
