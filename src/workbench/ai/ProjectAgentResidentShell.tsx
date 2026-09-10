import { libraryGroup } from '../library/libraryGroups'
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
import { STORYBOARD_PLANNER_SKILL } from '../generationCanvas/agent/storyboardLauncher'
import { useWorkbenchStore } from '../workbenchStore'
import { useComposerAttachments, COMPOSER_ATTACHMENT_ACCEPT } from './composer/useComposerAttachments'
import { useResidentActivityStore } from './residentActivity'
import { TimelineAgentReceiptEffect } from './resident/TimelineAgentReceiptEffect'
import { useTimelinePlanPreview } from './resident/timelineAgentSurface'
import type { ResidentSurface } from './resident/residentShellDisplay'
import { AgentPanelV4Panel } from './v4/AgentPanelV4Panel'
import { flowScrollMemoryFor } from './v4/agentPanelV4ScrollMemory'
import { V4Intervention } from './v4/AgentPanelV4Cards'
import { V4CollapsedDock } from './v4/AgentPanelV4Dock'
import { useV4DockStatus } from './v4/agentPanelV4DockStatus'
import { AgentPanelV4Composer, V4ModelPopover, V4PermissionPopover, V4SkillPopover, type V4CommandRow } from './v4/AgentPanelV4Composer'
import { useAgentPanelV4Data } from './v4/useAgentPanelV4Data'
import { useAgentPanelV4Actions } from './v4/useAgentPanelV4Actions'
import { useAgentPanelSpendConfirm } from './v4/useAgentPanelSpendConfirm'
import { useAgentPanelAutoMode } from './v4/useAgentPanelAutoMode'
import { V4AutoModeBanner } from './v4/AgentPanelV4AutoMode'
import NodeGenerationComposer from '../generationCanvas/nodes/NodeGenerationComposer'
import { useShotVerifyFeedback } from './resident/useShotVerifyFeedback'
import { adoptLaneTaskCandidate } from './lane/laneTaskCandidateActions'
import { useV4Labels } from './v4/agentPanelV4Labels'
import { usePromptLibrary } from '../promptLibrary/usePromptLibrary'
import { useUserPrompts } from '../promptLibrary/useUserPrompts'
import { promptDisplayTitle } from '../promptLibrary/promptDisplay'
import { filterPrompts } from '../api/promptLibraryApi'
import type { ComposerPopover } from './v4/agentPanelV4Types'
import { buildV4ModelRows } from './v4/agentPanelV4ModelRows'
import { useAgentTraceDirectory } from '../../desktop/useAgentTraceDirectory'

/**
 * 面板尺寸只有真实 DOM 知道。v4 的积木按面板高度 derive composer 上限，所以必须量。
 *
 * 挂点是 **callback ref**，不是 `useRef` + `useEffect([ref])`。后者量的是「首次挂载时
 * `ref.current` 指的那个节点」，而这个组件收起时整棵子树换成另一棵（收起态的外壳没有这个挂点），
 * 展开时再换回来——ref 对象本身没变，effect 因此**永远不会重跑**，观察器一直盯着那个已经
 * 从文档里摘掉的旧节点。摘掉的节点浏览器报 0×0，于是收起那一刻 size 被写成 `{0,0}`；
 * 再展开时没有任何东西重新量它，面板就以 0×0 渲染——**一块空白的 Agent 面板**。
 * （2026-09-06 真机走查实测：外壳 339×745，面板 2×2，只剩两条边框。）
 *
 * callback ref 在节点每次换人时都跑一遍，观察器跟着换到新节点上——这才是「量的是当下这个盒子」。
 * 0×0 另外直接丢掉：一个真实布局里的面板不会是 0 宽 0 高，那个数只可能来自已经摘掉的节点。
 */
function usePanelSize(): Readonly<{ width: number; height: number; measure: (node: HTMLElement | null) => void }> {
  const [size, setSize] = React.useState({ width: 390, height: 620 })
  const [node, measure] = React.useState<HTMLElement | null>(null)
  React.useLayoutEffect(() => {
    if (!node) return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (!box || box.width === 0 || box.height === 0) return
      setSize({ width: Math.round(box.width), height: Math.round(box.height) })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])
  return { ...size, measure }
}

export default function ProjectAgentResidentShell({ surface }: { surface: ResidentSurface }): JSX.Element {
  const { t, i18n } = useTranslation()
  const labels = useV4Labels()
  const trace = useAgentTraceDirectory()
  const size = usePanelSize()
  const collapsed = useWorkbenchStore((state) => state.projectAgentDockCollapsed)
  const dockHidden = useWorkbenchStore((state) => state.agentDockHidden)
  const setDockHidden = useWorkbenchStore((state) => state.setAgentDockHidden)
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
  // 付费确认卡（2026-09-11 P1）。它是介入槽的**第二个数据源**：lane 的工具审批答的是
  // 「要不要让我做这件事」，这一张答的是「要不要花这笔钱」——后者住在 ProductionRun 域里，
  // `LanePendingApproval` 上根本没有报价字段。两者同时在时钱优先：钱撤不回来。
  const spend = useAgentPanelSpendConfirm()
  const spendComposer = spend.pending && spend.node ? (
    <NodeGenerationComposer
      node={spend.node}
      visualSize={spend.node.size ?? { width: 340, height: 192 }}
      host="panel"
      onFeedback={() => undefined}
    />
  ) : null
  // 切到「全自动」要先问一句（换档本身可撤销，所以它就是介入槽的可撤销档）。
  const autoMode = useAgentPanelAutoMode(actions.permission, actions.setPermission)
  // 三个数据源同时有卡时的优先序：**换档 > 钱 > lane 的工具审批**。
  //
  // 换档卡排第一不是因为它更重要，是因为它是**用户刚刚那一下点击的直接回应**——
  // 点了「全自动」却什么都没出现，只会被读成「点坏了」，于是他再点一次。
  // 付费卡让位不会丢：它没有倒计时、永不因空闲超时（同行一致 + 09-01 定稿），
  // 答完档位它就回到原处，价格一个字都没变。
  // lane 的工具审批排最后，因为档位恰恰决定它以后还问不问。
  const activeSlot = autoMode.slot ?? spend.slot ?? data.slot
  const spendSlotHandlers = {
    onConfirm: spend.confirm,
    onReject: spend.discard,
    onPage: spend.setPage,
    onScope: spend.setScope,
  }
  const autoModeSlotHandlers = { onConfirm: autoMode.confirm, onReject: autoMode.cancel }
  const autoModeBanner = autoMode.bannerVisible ? (
    <V4AutoModeBanner
      label={t('agentPanelV4.permission.project')}
      note={t('agentPanelV4.autoModeBannerNote')}
      revertLabel={t('agentPanelV4.autoModeBannerRevert')}
      dismissLabel={t('agentPanelV4.autoModeBannerDismiss')}
      onRevert={() => actions.setPermission('safe-auto')}
      onDismiss={autoMode.dismissBanner}
    />
  ) : null
  const shotVerifyFeedback = useShotVerifyFeedback(surface, actions.send)
  /**
   * 「他读到哪儿了」得活在这棵子树之外（定稿 §11.2：点角标 = 原宽**原状态**还原）。
   *
   * 不放 `useRef`：收起时面板换挂点，连这个常驻壳自己都跟着重新挂载，ref 一起归零
   * （2026-09-06 真机走查实测：ref 版展开后 scrollTop 回到底 259.5，等于没记）。
   * 按线程记：位置属于那条对话，换项目/换线程各记各的，切回来还在原处。
   */
  const flowScroll = flowScrollMemoryFor(surface, data.activeThreadId)
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
      void actions.send([t('agentResident.storyboardRequest'), displayPrompt].filter(Boolean).join('\n\n'), {
        skillKey: STORYBOARD_PLANNER_SKILL.key,
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
   * 收起后 logo 上叠的那一格（2026-09-06 用户改）。
   *
   * 三个事实都从**已有的宿主投影**取，不新开一条真相：等待条数就是介入槽读的那批待决，
   * 失败看「最后一件事是不是坏的」——面板级错误带，或者流末尾那条 error。翻历史找旧失败
   * 会让一个早就被绕过去的错误永远在 logo 上挂着，那是假报警。
   */
  const dockPendingCount = data.primaryPending?.pendingCount ?? 0
  const dockStatus = useV4DockStatus({
    running: data.running,
    pendingCount: dockPendingCount,
    failed: Boolean(actions.error) || data.flow[data.flow.length - 1]?.kind === 'error',
  })

  /**
   * 收起期间攒下的**未读条数**（定稿 §11.2：数字徽标 = 未读条数）。
   *
   * 「未读」只能从**收起那一刻**起算，所以要记一个锚：收起时流里已经有多少条。
   * 锚在渲染中调整（React 官方那条「渲染期调整 state」的写法）而不是放进 effect——
   * effect 晚一帧，那一帧里锚还是 0，未读会先闪一个「整段对话都是新的」的大数字。
   *
   * 只数**新回复**和**工具跑完**两种：用户自己在下沿 composer 里敲的那句不算未读（他刚写的），
   * 思考条、任务卡这些是同一件事的过程，数进去只会把「有几件事等你」变成「界面动了几次」。
   * 待决另算一份加上去——它不在流里，而它恰恰是最该被数出来的那种未读。
   */
  const [unreadAnchor, setUnreadAnchor] = React.useState({ collapsed, at: data.flow.length })
  if (unreadAnchor.collapsed !== collapsed) setUnreadAnchor({ collapsed, at: data.flow.length })
  const dockUnreadCount = collapsed
    ? data.flow.slice(unreadAnchor.at).filter((item) => item.kind === 'assistant' || item.kind === 'tool').length + dockPendingCount
    : 0

  /**
   * 把这三个数投到顶栏那格角标去（09-01 定稿 §11.2：收起态的家是顶栏右簇「浏览器 / 设置」之间）。
   *
   * 为什么要投而不是就地渲：顶栏不在这棵子树里。之前那一版把 logo 画在内容区右上角——
   * 它跟着面板走，于是每换一个面落点就换一个地方，用户得重新找它。顶栏是唯一四个面都在的那条 chrome。
   *
   * 展开时报 `null`（不是报 `idle`）：`idle` 是「收着但没事」，`null` 是「压根没收起」——
   * 顶栏据此决定那一格出不出角标，两者不能混。卸载时也报 `null`，否则关掉项目后
   * 顶栏还挂着一颗指向已经不存在的面板的角标。
   */
  const publishDockBadge = useResidentActivityStore((state) => state.setResidentDockBadge)
  React.useEffect(() => {
    publishDockBadge(collapsed ? dockStatus : null, dockPendingCount, dockUnreadCount)
  }, [collapsed, dockPendingCount, dockStatus, dockUnreadCount, publishDockBadge])
  React.useEffect(() => () => useResidentActivityStore.getState().setResidentDockBadge(null, 0, 0), [])

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

  const submit = React.useCallback((choice: 'primary' | 'secondary' = 'primary') => {
    const text = draft.trim()
    if (!text) return
    void actions.send(text, { choice })
  }, [actions, draft])

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
  const modelRows = React.useMemo(() => buildV4ModelRows(data, t), [data, t])

  const commandRows: readonly V4CommandRow[] = React.useMemo(() => {
    const query = commandQuery.trim()
    const locale = i18n.language.startsWith('zh') ? 'zh-CN' : 'en'
    const skillRows: V4CommandRow[] = data.skills
      .filter((skill) => skill.curation?.kind !== 'effect' && (!query || `${skill.curation?.title[locale] ?? skill.label} ${skill.name}`.toLowerCase().includes(query.toLowerCase())))
      // 自己导进来的排在内置前面。用户刚把一个技能弄进 Nomi，下一秒来这里找它——
      // 让他先滚过四个他没装过的内置技能才看见自己那个，是把「我刚做的事」排在最后。
      .sort((a, b) => (a.origin === b.origin ? 0 : a.origin === 'user' ? -1 : 1))
      .map((skill) => ({
        id: `skill:${skill.name}`,
        group: libraryGroup(skill, i18n.language),
        name: skill.curation?.title[locale] ?? skill.label,
        command: `/${skill.name}`,
        desc: skill.curation?.summary[locale] ?? skill.description ?? skill.stageLabels.join(' · '),
        cover: skill.cover,
        preview: skill.preview,
        section: t('agentPanelV4.sectionSkills'),
        selected: activeSkill?.key === skill.name,
      }))
    // ⑤ 提示词库并进同一个 `/` 菜单。两段各有名字，搜索一次搜两段——
    // 用户那一刻想的是「给这次对话装一套说法」，不是「这算技能还是提示词」。
    const promptRows: V4CommandRow[] = [...promptLibrary.items, ...userPromptLibrary.items]
      .filter((prompt) => filterPrompts([prompt], 'all', query).length > 0)
      .map((prompt) => ({
        id: `prompt:${prompt.id}`,
        group: libraryGroup(prompt, i18n.language),
        name: promptDisplayTitle(prompt),
        command: `/${prompt.id}`,
        desc: prompt.prompt,
        section: prompt.curation?.kind === 'effect' ? t('libraries.gallery.effect') : t('agentPanelV4.sectionPrompts'),
        preview: prompt.mediaUrl ? { url: prompt.mediaUrl, type: prompt.mediaType } : undefined,
        // 提示词库本来就有封面（`mediaUrl` = 首图），此前在这里被整包丢掉，
        // 于是每一行都退化成同一个白块。有图就把图给它。
        ...(prompt.mediaType === 'image' && prompt.mediaUrl ? { cover: prompt.mediaUrl } : {}),
        selected: actions.selectedLibraryPrompt?.id === prompt.id,
      }))
    return Object.freeze([...skillRows, ...promptRows])
  }, [actions.selectedLibraryPrompt, activeSkill, commandQuery, data.skills, i18n.language, promptLibrary.items, t, userPromptLibrary.items])

  const composerPopover = popover === 'model'
    ? <V4ModelPopover rows={modelRows} onOpenLibrary={() => { window.dispatchEvent(new Event('nomi-open-model-catalog')); setPopover(null) }} />
    : popover === 'skill'
      ? (
        <V4SkillPopover
          rows={commandRows}
          categories={[t('agentPanelV4.skillAll'), t('agentPanelV4.sectionSkills'), t('agentPanelV4.sectionPrompts'), t('libraries.gallery.effect')]}
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
              actions.setSelectedLibraryPrompt(prompt ?? null)
            }
            setPopover(null)
          }}
          onManage={() => { window.dispatchEvent(new Event('nomi-focus-skill-library')); setPopover(null) }}
        />
      )
      : popover === 'permission'
        ? <V4PermissionPopover permission={actions.permission} onSelect={(tier) => { autoMode.request(tier); setPopover(null) }} />
        : undefined

  // 收起 = 藏起**对话流**，不是藏起对话（定稿 Collapsed 板）。同一个 composer 掉到画面下沿
  // 居中，介入槽跟着它——这样一份编辑计划仍然读得到、批得下，不必把整列还给面板。
  // 用户可独立关闭这条坞；关闭选择跨项目记住，提醒仍由顶栏角标承担。
  //
  // 叫回它的入口只有一个，而且**不在这里**：顶栏右簇「浏览器」与「设置」之间那一格
  // （`src/ui/app-shell/CollapsedAiChip.tsx`，09-01 定稿 §11.2）。收起态的家跟着 chrome 走、
  // 不跟着面板走——顶栏是唯一四个面都在的那条，切面时角标不挪窝。
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
        {!dockHidden && <V4CollapsedDock onClose={() => setDockHidden(true)}>
          {activeSlot ? (
            <V4Intervention
              data={activeSlot}
              labels={labels.intervention}
              {...(!autoMode.slot && spend.slot && spendComposer ? { composer: spendComposer } : {})}
              {...(autoMode.slot
                ? autoModeSlotHandlers
                : spend.slot
                  ? spendSlotHandlers
                  : {
                    onConfirm: actions.approve,
                    onReject: actions.reject,
                    onEscalate: actions.stopAsking,
                    onOption: (option: string) => actions.answerOption(option),
                  })}
            />
          ) : null}
          {autoModeBanner}
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
        </V4CollapsedDock>}
      </section>
    )
  }

  return (
    <div
      ref={size.measure}
      id="project-agent-resident"
      className="relative isolate flex h-full min-h-0 w-full min-w-0 flex-col text-nomi-ink"
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
        scrollMemory={flowScroll}
        width={size.width}
        height={actions.error ? size.height - 20 : size.height}
        legacy={data.snapshot.active.legacy}
        flow={data.flow}
        flowTail={shotVerifyFeedback}
        surface={surface}
        onStarter={startFromStarter}
        slot={activeSlot}
        {...(!autoMode.slot && spend.slot && spendComposer ? { slotComposer: spendComposer } : {})}
        {...(autoModeBanner ? { composerBanner: autoModeBanner } : {})}
        queue={data.queue}
        queueHint={t('agentPanelV4.queueHint')}
        context={data.context}
        onHistory={() => setThreadsOpen((value) => !value)}
        onCollapse={() => setCollapsed(true)}
        flowHandlers={{
          onCopy: (text) => { void navigator.clipboard?.writeText(text) },
          onContinue: (index) => {
            const item = data.flow[index]
            if (item?.kind !== 'assistant' || !item.continuationEntryId) return
            void actions.send(draft.trim() || t('agentPanelV4.continue'), { continueFromEntryId: item.continuationEntryId })
          },
          onUndoTool: actions.undoTool,
          onAdoptCandidate: (index, _tag, candidateIndex) => adoptLaneTaskCandidate(data.flow, index, candidateIndex, t),
          onErrorAction: recoverFromFailure,
          onSuggestion: (_index, option) => actions.answerOption(option),
        }}
        slotHandlers={autoMode.slot ? autoModeSlotHandlers : spend.slot ? spendSlotHandlers : {
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
          <div className="flex items-center gap-1.5 px-2 py-1 text-micro text-nomi-ink-60">
            <span>{t('agentResident.threads')}</span>
            <button type="button" className="text-nomi-accent" onClick={() => { actions.newThread(); setThreadsOpen(false) }}>
              {t('agentResident.newThread')}
            </button>
          </div>
          {data.snapshot.lanes.map((thread) => (
            <div
              key={thread.laneName}
              className={cn('flex items-center gap-1 rounded-nomi-sm px-2 py-1', thread.laneName === data.snapshot.active.lane && 'bg-nomi-accent-soft')}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-caption"
                onClick={() => { actions.activateThread(thread.laneName); setThreadsOpen(false) }}
              >
                {thread.laneName === 'main' ? t('agentResident.untitledThread') : thread.laneName}
              </button>
              <button
                type="button"
                className="grid size-7 place-items-center rounded-nomi-sm hover:bg-nomi-ink-10"
                aria-label={t('agentResident.removeThread')}
                onClick={() => actions.removeThread(thread.laneName)}
              >
                ×
              </button>
            </div>
          ))}
          {trace.available ? (
            <div className="mt-1 border-t border-nomi-line pt-1">
              <button
                type="button"
                role="menuitem"
                data-agent-trace-open="session"
                disabled={trace.busy}
                className="w-full rounded-nomi-sm px-2 py-2 text-left text-caption text-nomi-ink-60 hover:bg-nomi-ink-05 disabled:opacity-50"
                onClick={() => { void trace.open(data.snapshot.active.lane) }}
              >
                {t(trace.busy ? 'settings.general.trace.opening' : 'agentResident.viewTrace')}
              </button>
              {trace.message ? <p role="alert" className="px-2 py-1 text-caption text-nomi-ink-60">{trace.message}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
