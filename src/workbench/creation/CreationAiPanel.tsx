import React from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { IconCornerDownLeft, IconCursorText, IconFilePlus, IconMaximize, IconMinimize, IconPaperclip, IconPlayerStopFilled, IconReplace, IconSend2, IconX } from '@tabler/icons-react'
import { NomiLogoMark, NomiSelect, WorkbenchButton, WorkbenchIconButton } from '../../design'
import { cn } from '../../utils/cn'
import { runWorkbenchAgent, workbenchSessionKey, type ToolCallEvent } from '../ai/workbenchAgentRunner'
import { startNewConversation } from '../ai/conversationPersistence'
import { clearWorkbenchAgentSession } from '../../api/desktopClient'
import { AssistantMessageView, UserMessageBubble } from '../ai/AssistantMessageView'
import { NoTextModelRecoveryCard } from '../ai/NoTextModelRecoveryCard'
import { AssistantErrorCard } from '../ai/AssistantErrorCard'
import { useHasTextModel } from '../library/useHasTextModel'
import AssistantModelPicker from '../ai/AssistantModelPicker'
import StoryboardPlanCard from './storyboard/StoryboardPlanCard'
import StoryboardActionCard from './storyboard/StoryboardActionCard'
import { handleAiComposerKeyDown } from '../ai/aiComposerKeyboard'
import { extractStoryFromRequest, routeCreationIntent } from './creationIntentRouting'
import type { WorkbenchAiMessage } from '../ai/workbenchAiTypes'
import { WorkbenchAiHeaderActions } from '../ai/WorkbenchAiHeaderActions'
import ActiveSkillChip from '../ai/ActiveSkillChip'
import { importWorkbenchSkill, getAvailableSkillProviders, skillCapabilityFor, type SkillProviderKind } from '../api/skillApi'
import { MemoryFold } from '../generationCanvas/components/MemoryFold'
import { useWorkbenchStore } from '../workbenchStore'
import { runStoryboardPlanner } from '../generationCanvas/agent/runStoryboardPlanner'
import { requestFixationPlanning } from '../generationCanvas/agent/fixationLauncher'
import {
  buildCreationAiPrompt,
  CREATION_AI_MODES,
  extractWorkbenchDocumentText,
  getCreationAiMode,
  modeAllowsWriteTools,
  type CreationAiModeId,
} from './creationAiModes'
import { useTransientScrollingClass } from './useTransientScrollingClass'
import { isWriteTool, useCreationTurnStore, type PendingDocToolCall, type WriteToolName } from './creationTurnController'
import { readWindowUrlParam } from '../windowUrlParam'
import { AttachmentRail } from '../ai/composer/AttachmentRail'
import { StaleConversationDivider, useStaleConversationBoundary } from '../ai/staleConversationDivider'
import { AutoGrowTextarea } from '../ai/composer/AutoGrowTextarea'
import { COMPOSER_ATTACHMENT_ACCEPT, useComposerAttachments } from '../ai/composer/useComposerAttachments'
import { useRafCoalesce } from '../ai/useRafCoalesce'
import StoryboardNudge from './storyboard/StoryboardNudge'


// The creation agent's write tools map 1:1 to the editor's document mutations.
// Read tools auto-confirm without a card; write tools queue a confirmation card.
// 写工具名/类型/守卫/待批卡形态已收口到 creationTurnController（turn 控制器单一真相源）。
function writeToolLabelKey(name: WriteToolName): 'creationAi.writeTool.insert' | 'creationAi.writeTool.replace' | 'creationAi.writeTool.append' {
  if (name === 'insert_at_cursor') return 'creationAi.writeTool.insert'
  if (name === 'replace_selection') return 'creationAi.writeTool.replace'
  return 'creationAi.writeTool.append'
}


function readWorkbenchAiReplyText(response: unknown): string {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return ''
  const record = response as Record<string, unknown>
  const text = typeof record.text === 'string' ? record.text.trim() : ''
  if (text) return text
  const responseValue = record.response
  if (responseValue && typeof responseValue === 'object' && !Array.isArray(responseValue)) {
    const nestedText = (responseValue as Record<string, unknown>).text
    return typeof nestedText === 'string' ? nestedText.trim() : ''
  }
  return ''
}

export default function CreationAiPanel({ onCollapse }: { onCollapse?: () => void } = {}): JSX.Element {
  const { t } = useTranslation()
  // 流式生命周期(sending/cancel/待批写卡/消息 id)收口到 turn 控制器,组件只读不持有 ——
  // 这样切项目/新对话/卸载能统一中止在途轮次(治串台),按钮态也随之复位。
  const sending = useCreationTurnStore((state) => state.sending)
  const pendingToolCalls = useCreationTurnStore((state) => state.pendingToolCalls)
  const turn = useCreationTurnStore
  // 流式吐字 rAF 合帧：把每 token 一次的整 messages 重渲合并到每帧最多一次（治掉字掉帧）。
  const { push: pushStreamFrame, cancel: cancelStreamFrame } = useRafCoalesce()
  // 项目记忆卡刷新键:每完成一轮(sending true→false)+1,触发记忆重取(本轮可能提炼新事实)。
  const [memoryRefreshKey, setMemoryRefreshKey] = React.useState(0)
  const prevSendingRef = React.useRef(sending)
  React.useEffect(() => {
    if (prevSendingRef.current && !sending) setMemoryRefreshKey((key) => key + 1)
    prevSendingRef.current = sending
  }, [sending])
  // 放大/全屏对话：把整块面板移到 body 级居中浮层（仿 Scene3D 全屏 portal）。
  const [expanded, setExpanded] = React.useState(false)
  // 注意:不在卸载时 abort。turn 状态已搬到控制器(模块级单例)+ 消息在 store,
  // 折叠/切 tab 会卸载本面板,但在途轮次应继续跑、重开面板时无缝接回(折叠续跑)。
  // 跨项目串台由 swapCreationAiProject→abandon 兜底,与面板卸载解耦。
  const messagesScrollRef = useTransientScrollingClass<HTMLDivElement>('workbench-scrollbar-visible')
  const workbenchDocument = useWorkbenchStore((state) => state.workbenchDocument)
  const documentTools = useWorkbenchStore((state) => state.creationDocumentTools)
  const selectedText = useWorkbenchStore((state) => state.creationSelectionText)
  const modeId = useWorkbenchStore((state) => state.creationAiModeId)
  const activeSkill = useWorkbenchStore((state) => state.creationActiveSkill)
  const setActiveSkill = useWorkbenchStore((state) => state.setCreationActiveSkill)
  const draft = useWorkbenchStore((state) => state.creationAiDraft)
  const messages = useWorkbenchStore((state) => state.creationAiMessages)
  // S1b 诚实分隔线:气泡有历史而 LLM 记忆为空 → 在历史末尾画「以上对话 AI 已不再记得」。
  const staleBoundaryId = useStaleConversationBoundary(messages.map((message) => message.id), 'creation')
  // Issue #9：agent 报错且目录里没有 enabled 文本模型 → 报错气泡换成「缺大脑」恢复卡（判真实状态非匹配串）。
  // recoveryShownIds：某条报错已进入恢复卡后「黏住」——一键启用使 hasTextModel 翻 true 也不卸载卡片，
  // 让它能展示自己的「大脑已就位」done 态，而不是露出旧报错文本。
  const { hasTextModel, refresh: refreshTextModel } = useHasTextModel()
  const [recoveryShownIds, setRecoveryShownIds] = React.useState<ReadonlySet<string>>(() => new Set())
  // resolvedActionIds：某张动作卡已被点过开跑 → 按钮置灰防重复触发（仿 recoveryShownIds 黏住态）。
  const [resolvedActionIds, setResolvedActionIds] = React.useState<ReadonlySet<string>>(() => new Set())
  const attachments = useWorkbenchStore((state) => state.creationAiAttachments)
  const error = useWorkbenchStore((state) => state.creationAiError)
  const setModeId = useWorkbenchStore((state) => state.setCreationAiModeId)
  const setDraft = useWorkbenchStore((state) => state.setCreationAiDraft)
  const setMessages = useWorkbenchStore((state) => state.setCreationAiMessages)
  const setAttachments = useWorkbenchStore((state) => state.setCreationAiAttachments)
  const setError = useWorkbenchStore((state) => state.setCreationAiError)
  const setWorkspaceMode = useWorkbenchStore((state) => state.setWorkspaceMode)

  const {
    isDragging,
    openFilePicker,
    inputRef,
    onInputChange,
    removeAttachment,
    clearAttachments,
    handlePaste,
    dragHandlers,
  } = useComposerAttachments({ attachments, setAttachments, onError: setError })

  // Keep a live ref so the tool-call handler always sees the freshest editor
  // tools without re-creating `send` on every editor remount.
  const documentToolsRef = React.useRef(documentTools)
  documentToolsRef.current = documentTools

  const activeMode = getCreationAiMode(modeId as CreationAiModeId)
  // 同理:send 是空依赖 useCallback（稳定），不能直接闭包 activeSkill/activeMode（会捕获首渲染的旧值
  // → 点「AI 写技能」后 send 永远看不到）。用 live ref 让 send 取最新的技能选择。
  const skillSelRef = React.useRef({ activeSkill, activeMode })
  skillSelRef.current = { activeSkill, activeMode }
  const documentText = React.useMemo(() => extractWorkbenchDocumentText(workbenchDocument), [workbenchDocument])

  const resolvePending = React.useCallback((
    toolCallId: string,
    decision: { ok: true; result?: unknown } | { ok: false; message?: string },
  ) => {
    turn.getState().resolvePendingToolCall(toolCallId, decision)
  }, [turn])

  // Run the actual editor mutation for an approved write tool, then resolve the
  // backend tool call so the agent loop can continue.
  const applyWriteTool = React.useCallback((call: PendingDocToolCall) => {
    const tools = documentToolsRef.current
    if (!tools) {
      resolvePending(call.toolCallId, { ok: false, message: 'editor_not_ready' })
      return
    }
    if (call.toolName === 'insert_at_cursor') tools.insertAtCursor(call.content)
    else if (call.toolName === 'replace_selection') tools.replaceSelection(call.content)
    else tools.appendToEnd(call.content)
    resolvePending(call.toolCallId, { ok: true, result: { applied: true } })
  }, [resolvePending])


  const writeToolIcon = React.useCallback((name: WriteToolName) => {
    if (name === 'insert_at_cursor') return <IconCursorText size={13} />
    if (name === 'replace_selection') return <IconReplace size={13} />
    return <IconFilePlus size={13} />
  }, [])

  const launchStoryboardPlanning = React.useCallback((displayPrompt: string = t('creationAi.storyboardCommand'), revisionRequest?: string, shotMode: 'image' | 'video' | 'image-video' = 'image') => {
    // P0-9 Slice 3：已有未落画布的方案 + 用户给了修改要求 → 进「改方案」模式（基于现方案改，不从头拆）。
    const store = useWorkbenchStore.getState()
    const currentPlan = store.storyboardPlan
    const isRevision = Boolean(currentPlan && !store.storyboardPlanCommitted && revisionRequest?.trim())
    const docStory = (selectedText || documentText).trim()
    // 编辑器为空但用户把故事打在了对话里 → 用对话正文，并补写进文稿（单一真相源），
    // 别让他把已经敲过的故事再搬一遍（D1）。裸命令抠不出故事则维持下面的提示。
    const chatStory = docStory ? '' : extractStoryFromRequest(displayPrompt)
    if (chatStory) documentToolsRef.current?.appendToEnd(chatStory)
    const storyText = docStory || chatStory
    if (!isRevision && !storyText) {
      setError(t('creationAi.writeStoryFirst'))
      return
    }
    const userId = turn.getState().nextMessageId('user')
    const assistantId = turn.getState().nextMessageId('assistant')
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', content: displayPrompt },
      { id: assistantId, role: 'assistant', content: isRevision ? t('creationAi.revisingPlan') : t('creationAi.planningStoryboard'), status: 'pending' as const },
    ])
    setDraft('')
    setError('')
    // 流程 A：就地跑规划师（不切到生成区）。产出 propose_storyboard_plan 落创作 store →
    // 主列展开分镜方案编辑器；规划阶段全程免费、不碰画布（runStoryboardPlanner 的 onToolCall 守卫）。
    const handle = turn.getState().begin()
    void (async () => {
      try {
        const { text } = await runStoryboardPlanner({
          // 首拆带分镜模式（图片/视频，动作卡上选，默认图片）；改方案不带——保留现方案每镜已定的 shotKind。
          ...(isRevision ? { currentPlan, revisionRequest } : { storyText, shotMode }),
          onContent: (streamed) => {
            if (!handle.isCurrent()) return
            pushStreamFrame(() =>
              setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: streamed || t('creationAi.planningShort'), status: 'streaming' as const } : m))),
            )
          },
          onCancelReady: (cancel) => turn.getState().attachCancel(handle.id, cancel),
        })
        if (!handle.isCurrent()) return // 轮次已被切项目/新对话作废:别把旧项目内容写进新项目
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: text || (isRevision ? t('creationAi.revisionComplete') : t('creationAi.planComplete')), status: 'done' as const } : m,
          ),
        )
      } catch (error: unknown) {
        if (!handle.isCurrent()) return
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: t('creationAi.planFailed', { message: error instanceof Error && error.message ? error.message : t('creationAi.unknownError') }), status: 'error' as const }
              : m,
          ),
        )
      } finally {
        cancelStreamFrame() // 终态已落定，丢弃任何挂起的流式合帧，别用过期文本盖掉终态
        turn.getState().finish(handle.id)
      }
    })()
  }, [cancelStreamFrame, documentText, pushStreamFrame, selectedText, setDraft, setError, setMessages, turn, t])

  // Tier2 定妆：把剧本交给 AI，按剧本为主要角色/场景建卡 + 注入身份板提示词（与拆镜头同构）。
  const launchFixationPlanning = React.useCallback((displayPrompt: string = t('creationAi.fixationCommand')) => {
    const storyText = (selectedText || documentText).trim()
    if (!storyText) {
      setError(t('creationAi.writeScriptFirst'))
      return
    }
    setMessages((prev) => [
      ...prev,
      { id: turn.getState().nextMessageId('user'), role: 'user', content: displayPrompt },
      { id: turn.getState().nextMessageId('assistant'), role: 'assistant', content: t('creationAi.fixationStarted'), status: 'done' as const },
    ])
    setDraft('')
    setError('')
    setWorkspaceMode('generation')
    window.setTimeout(() => {
      requestFixationPlanning({ storyText, source: 'creation-ai-panel' })
    }, 60)
  }, [documentText, selectedText, setDraft, setError, setMessages, setWorkspaceMode, turn, t])

  const send = React.useCallback(async (textOverride?: string) => {
    if (turn.getState().sending) return
    const userRequest = (textOverride ?? draft).trim()
    // 附件还在上传就发送 = 静默丢弃在途附件（clearAttachments 会连 uploading 一起清）。
    // 拦下并提示用户稍候,等就绪再发,绝不悄悄把用户附的文件吞掉。
    if (attachments.some((item) => item.status === 'uploading')) {
      setError(t('creationAi.attachmentsUploading'))
      return
    }
    const readyAttachments = attachments.filter((item) => item.status === 'ready' && item.url)
    if (!userRequest && !selectedText && !documentText && !readyAttachments.length) return
    // P0-9 Slice 3：方案审阅中（编辑器替换了文档编辑器，用户正盯着方案）→ 输入即视为对现方案的
    // 修改要求（「全部加负面词 / 统一冷调 / 第 3 镜改特写」等），交规划师基于现方案改、保留其余。
    if (useWorkbenchStore.getState().storyboardEditorOpen && userRequest) {
      launchStoryboardPlanning(userRequest, userRequest)
      return
    }
    // 对话驱动（删固定 chip，用户拍板 2026-06-13）：自然语言意图 → 甩给画布 agent。
    // 跳过意图路由的两种「用户已明确选了路」的情形（B1 分工讲清，2026-06-22）：
    //  ① 锁定了 active skill（如「AI 写技能」）；
    //  ② 选了「写分镜」模式 = 明确要在文稿里写**文字分镜稿**，别再劫持到「拆镜头→画布」规划师
    //     （规划师是结构化落画布路径；默认模式下说「拆镜头/分镜」才走它）。
    // 否则含「分镜/镜头」的输入会盖过用户明确选的模式/技能（这正是双路互劫的根因）。
    const skipIntentRouting = skillSelRef.current.activeSkill || skillSelRef.current.activeMode.id === 'storyboard'
    const intent = skipIntentRouting ? null : routeCreationIntent(userRequest)
    if (intent) {
      // 识别到跨面板意图 → 不再静默直接开跑，推一张可见的动作卡（治隐形）：
      // 用户看见「看起来你想拆镜头 → [按钮]」，点按钮才真正落画布。口径放宽后这里召回更高，
      // 误判只是多一张可忽略的卡、不会误触动作（点了才跑），所以放心放宽（治脆）。
      const userId = turn.getState().nextMessageId('user')
      const actionId = turn.getState().nextMessageId('assistant')
      setMessages((prev) => [
        ...prev,
        { id: userId, role: 'user', content: userRequest || (intent === 'storyboard' ? t('creationAi.storyboardCommand') : t('creationAi.fixationCommand')) },
        { id: actionId, role: 'assistant', content: '', status: 'done' as const, action: { kind: intent, prompt: userRequest } },
      ])
      setDraft('')
      setError('')
      return
    }
    const prompt = buildCreationAiPrompt({ mode: activeMode, userRequest })
    const displayPrompt = userRequest || (readyAttachments.length
      ? t('creationAi.attachmentPrompt')
      : t('creationAi.processDocument', { mode: t(`creationAi.mode.${activeMode.id}.label` as 'creationAi.mode.general.label') }))
    const attachmentPayload = readyAttachments.map((item) => ({
      url: item.url as string,
      contentType: item.contentType,
      fileName: item.fileName,
      kind: item.kind,
    }))
    const userMessage: WorkbenchAiMessage = {
      id: turn.getState().nextMessageId('user'),
      role: 'user',
      content: displayPrompt,
      ...(readyAttachments.length ? { attachments: readyAttachments } : {}),
    }
    const pendingId = turn.getState().nextMessageId('assistant')
    setMessages((prev) => [...prev, userMessage, { id: pendingId, role: 'assistant', content: '', status: 'pending' as const }])
    setDraft('')
    clearAttachments()
    setError('')
    const handle = turn.getState().begin()
    try {
      const response = await runWorkbenchAgent({
        prompt,
        displayPrompt,
        ...(attachmentPayload.length ? { attachments: attachmentPayload } : {}),
        sessionKey: workbenchSessionKey('creation'),
        projectId: readWindowUrlParam('projectId'),
        // 手动锁定的 active skill 优先（如「品牌宣传片」playbook）；否则回退创作模式推导。
        skillKey: skillSelRef.current.activeSkill ? skillSelRef.current.activeSkill.key : `workbench.creation.${skillSelRef.current.activeMode.id}`,
        skillName: skillSelRef.current.activeSkill
          ? skillSelRef.current.activeSkill.name
          : t(`creationAi.mode.${skillSelRef.current.activeMode.id}.title` as 'creationAi.mode.general.title'),
        onContent: (_delta, streamedText) => {
          if (!handle.isCurrent()) return
          pushStreamFrame(() =>
            setMessages((prev) => prev.map((message) => (
              message.id === pendingId ? { ...message, content: streamedText, status: 'streaming' as const } : message
            ))),
          )
        },
        onCancelReady: (cancel) => turn.getState().attachCancel(handle.id, cancel),
        onToolCall: (event: ToolCallEvent) => {
          // 轮次已被切项目/新对话/卸载作废:拒绝迟到的工具调用,绝不写进新项目。
          if (!handle.isCurrent()) {
            void event.confirm({ ok: false, message: 'creation turn abandoned' })
            return
          }
          // Read tools auto-execute against the live editor.
          if (event.toolName === 'read_full_text') {
            void event.confirm({ ok: true, result: { text: documentToolsRef.current?.readFullText() ?? '' } })
            return
          }
          if (event.toolName === 'read_selection') {
            void event.confirm({ ok: true, result: { text: documentToolsRef.current?.readSelectionText() ?? '' } })
            return
          }
          // author_skill：转写出一个 Nomi skill 并落地。低风险（存文本文件、可逆、不花钱）→
          // 自动落地，不弹确认卡；审阅靠「试跑一次」（用户拍板的 effect-first）。把能力差集喂回 LLM，
          // 让它在回复里诚实标缺口（缺哪个 provider）。
          if (event.toolName === 'author_skill') {
            const args = (event.args && typeof event.args === 'object') ? event.args as Record<string, unknown> : {}
            const manifest = args.manifest
            const dirName = typeof args.dirName === 'string' && args.dirName.trim() ? args.dirName : 'imported-skill'
            const skillMarkdown = typeof args.skillMarkdown === 'string' ? args.skillMarkdown : ''
            const pkg = {
              version: 'nomi-skill-v1' as const,
              exportedAt: Date.now(),
              dirName,
              files: { 'SKILL.md': skillMarkdown, 'skill.json': JSON.stringify(manifest ?? {}, null, 2) },
            }
            const res = importWorkbenchSkill(pkg)
            if (!res.ok) {
              void event.confirm({ ok: false, message: res.error ?? t('creationAi.skillSaveFailed') })
              return
            }
            const needed = (manifest && typeof manifest === 'object' && Array.isArray((manifest as Record<string, unknown>).requiredProviders))
              ? (manifest as { requiredProviders: SkillProviderKind[] }).requiredProviders
              : []
            void getAvailableSkillProviders()
              .then((available) => {
                const cap = skillCapabilityFor({ neededProviders: needed }, available)
                void event.confirm({ ok: true, result: { saved: true, skillName: res.skillName, dirName: res.dirName, missingProviders: cap.missing, satisfied: cap.satisfied } })
              })
              .catch(() => void event.confirm({ ok: true, result: { saved: true, skillName: res.skillName, dirName: res.dirName } }))
            return
          }
          // Write tools wait for explicit user approval through a card.
          if (isWriteTool(event.toolName)) {
            // 能力声明驱动能力执行(P4):chatOnly 模式(通用问答)不接受写文档工具——
            // 直接拒绝,不渲染写卡。prompt 软约束挡不住模型仍发 insert/replace/append,
            // 这里按模式能力声明硬挡,保证「不改文档」是真约束而非文字祈求。
            if (!modeAllowsWriteTools(activeMode)) {
              void event.confirm({ ok: false, message: 'chat-only mode does not write to the document' })
              return
            }
            const args = (event.args && typeof event.args === 'object') ? event.args as Record<string, unknown> : {}
            const content = typeof args.content === 'string' ? args.content : ''
            turn.getState().addPendingToolCall({
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              content,
              confirm: event.confirm,
            })
            return
          }
          void event.confirm({ ok: false, message: `unknown tool ${event.toolName}` })
        },
      })
      if (!handle.isCurrent()) return // 轮次已被作废:resolved 结果属于旧项目,丢弃不写
      // 用户主动「停止」→ 流层合成的取消结果(raw.cancelled)落「已取消」第三态,不混作完成。
      const cancelled = Boolean((response.raw as { cancelled?: unknown } | undefined)?.cancelled)
      const streamed = readWorkbenchAiReplyText(response)
      if (cancelled) {
        setMessages((prev) => prev.map((message) => (
          message.id === pendingId
            ? { ...message, content: streamed || t('creationAi.stopped'), status: 'cancelled' as const }
            : message
        )))
      } else {
        const base = streamed || t('creationAi.emptyResponse')
        // finishReason=length 且真有正文 = 这条被模型单次输出上限切断,标出来别当完整(空文本不标)。
        const truncated = response.finishReason === 'length' && streamed.trim() !== ''
        const reply = truncated
          ? t('creationAi.truncated', { text: base })
          : base
        setMessages((prev) => prev.map((message) => (
          message.id === pendingId
            ? { ...message, content: reply, status: 'done' as const }
            : message
        )))
      }
    } catch (err) {
      if (!handle.isCurrent()) return // 轮次已被作废:错误属于旧项目,丢弃不写
      const message = err instanceof Error ? err.message : t('creationAi.callFailed')
      // 不再 setError(底部红 banner)——agent 错误只在对话内渲成红色错误卡(避免上下双显);
      // 底部 banner 仅留给 composer 校验提示(「先写段故事」「附件还在上传」)。
      setMessages((prev) => prev.map((item) => (
        item.id === pendingId ? { ...item, content: `${t('creationAi.errorPrefix')}${message}`, status: 'error' as const } : item
      )))
    } finally {
      cancelStreamFrame() // 终态已落定，丢弃任何挂起的流式合帧，别用过期文本盖掉终态
      turn.getState().finish(handle.id)
    }
  }, [activeMode, activeSkill, attachments, cancelStreamFrame, clearAttachments, documentText, draft, launchStoryboardPlanning, launchFixationPlanning, pushStreamFrame, selectedText, setDraft, setError, setMessages, turn, t])

  // 通用创作动作，贴 Nomi 视频创作调性、不绑小说题材（旧的「悬疑开场/童话语气」在产品/宣传项目里调性错配）。
  const suggestions = React.useMemo(() => [
    t('creationAi.suggestion.opening'),
    t('creationAi.suggestion.visual'),
    t('creationAi.suggestion.storyboard'),
  ], [t])

  const handleNewConversation = React.useCallback(() => {
    // 新对话 = 抛弃在途轮次:中止流 + 作废 token(迟到回调不再写) + 拒绝清空待批写卡。
    turn.getState().abandon()
    // 会话历史:归档当前线程(不销毁),建空活动线程,清面板消息投影。
    startNewConversation('creation')
    // 清 session 态(draft/附件/error 不落盘,不入线程)。
    setDraft('')
    clearAttachments()
    setError('')
    // 新对话 = 该 area 模型上下文归零(创作/画布各一份键,互不影响)。
    void clearWorkbenchAgentSession(workbenchSessionKey('creation'))
  }, [clearAttachments, setDraft, setError, turn])

  const panelBody = (
    <aside
      className={cn(
        'workbench-creation-ai',
        'relative grid grid-cols-[minmax(0,1fr)] grid-rows-[44px_auto_minmax(0,1fr)_auto_auto]',
        '[grid-template-areas:"header"_"tools"_"messages"_"error"_"composer"]',
        'min-w-0 min-h-0 overflow-hidden',
        expanded && 'h-[86vh] w-[min(760px,92vw)] rounded-nomi-lg border border-nomi-line bg-nomi-paper shadow-nomi-lg',
      )}
      aria-label={t('creationAi.panelAria')}
      {...dragHandlers}
    >
      {isDragging ? (
        <div
          className={cn(
            'absolute inset-1.5 z-10 flex flex-col items-center justify-center gap-2 pointer-events-none',
            'rounded-nomi border-2 border-dashed border-nomi-accent bg-nomi-accent-soft',
            'text-body-sm font-semibold text-nomi-accent',
          )}
          aria-hidden="true"
        >
          <IconPaperclip size={26} stroke={1.5} />
          <div>{t('creationAi.dropAttachments')}</div>
          <div className={cn('text-micro font-normal text-nomi-ink-60')}>{t('creationAi.attachmentLimits')}</div>
        </div>
      ) : null}
      <header
        className={cn(
          'workbench-creation-ai__header',
          '[grid-area:header] flex items-center justify-between gap-[10px] min-w-0',
        )}
      >
        {/* 头部：Nomi 标 + 「助手」+ 动作（含 token 计数）。 */}
        <div className={cn('workbench-creation-ai__title', 'inline-flex items-center gap-2 min-w-0')}>
          <NomiLogoMark size={18} />
          {/* 审计 A14：与入口词「创作」一致，不再裸叫「助手」 */}
          <span className={cn('text-body-sm font-semibold text-nomi-ink')}>{t('creationAi.title')}</span>
        </div>
        <div className={cn('inline-flex items-center gap-2 ml-auto min-w-0')}>
          <ActiveSkillChip activeSkill={activeSkill} autoLabel={t(`creationAi.mode.${activeMode.id}.title` as 'creationAi.mode.general.title')} onSelect={setActiveSkill} />
          <WorkbenchAiHeaderActions
            area="creation"
            className={cn('inline-flex items-center flex-nowrap gap-1')}
            actionClassName={cn(
              'size-6 inline-grid place-items-center shrink-0',
              'p-0 border-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 cursor-pointer',
              'hover:bg-nomi-ink-05 hover:text-nomi-ink',
            )}
            onNewConversation={handleNewConversation}
          />
          <WorkbenchIconButton
            className={cn(
              'size-6 inline-grid place-items-center shrink-0',
              'p-0 border-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 cursor-pointer',
              'hover:bg-nomi-ink-05 hover:text-nomi-ink',
            )}
            label={expanded ? t('creationAi.shrink') : t('creationAi.expandConversation')}
            aria-label={expanded ? t('creationAi.shrinkAria') : t('creationAi.expandAria')}
            onClick={() => setExpanded((value) => !value)}
            icon={expanded ? <IconMinimize size={15} /> : <IconMaximize size={15} />}
          />
          {onCollapse ? (
            <WorkbenchIconButton
              className={cn(
                'size-6 inline-grid place-items-center shrink-0',
                'p-0 border-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 cursor-pointer',
                'hover:bg-nomi-ink-05 hover:text-nomi-ink',
              )}
              label={t('creationAi.collapse')}
              aria-label={t('creationAi.collapseAria')}
              onClick={onCollapse}
              icon={<IconX size={15} />}
            />
          ) : null}
        </div>
      </header>

      <div className={cn('[grid-area:tools] min-w-0')}>
        {/* 对齐画布助手:项目记忆「AI 记得 N 条」(N=0 不渲染);删工具条(与记忆条重复的灰杠)。 */}
        <MemoryFold refreshKey={memoryRefreshKey} />
        {/* 情景卡自动浮现：写好故事还没拆镜头时，把「拆成镜头」入口在对的时机端到眼前（治「没有可点入口」）。 */}
        <StoryboardNudge busy={sending} onRun={(shotMode) => launchStoryboardPlanning(t('creationAi.storyboardCommand'), undefined, shotMode)} />
      </div>

      <div
        ref={messagesScrollRef}
        className={cn(
          'workbench-creation-ai__messages',
          '[grid-area:messages] min-h-0 overflow-auto',
          'flex flex-col gap-3',
        )}
        aria-live="polite"
      >
        {messages.length === 0 && pendingToolCalls.length === 0 ? (
          <div className={cn(
            'flex h-full flex-col items-center justify-center gap-2',
            'max-w-[240px] mx-auto py-6 px-3 text-center',
          )}>
            <div className={cn('text-nomi-ink font-nomi-display text-title font-medium')}>{t('creationAi.inspirationTitle')}</div>
            <div className={cn('text-nomi-ink-60 text-body-sm leading-relaxed')}>
              {t('creationAi.inspirationDescription')}
            </div>
            <div className={cn('flex flex-col gap-1.5 w-full mt-2')}>
              {suggestions.map((suggestion) => (
                <WorkbenchButton
                  key={suggestion}
                  className={cn(
                    'w-full min-h-9 py-2 px-3 border border-transparent rounded-nomi',
                    'flex items-center justify-between gap-2 text-left font-normal',
                    'bg-nomi-ink-05 text-nomi-ink-80 cursor-pointer',
                    'hover:border-nomi-line hover:bg-nomi-paper hover:text-nomi-ink',
                  )}
                  onClick={() => void send(suggestion)}
                >
                  <span className={cn('min-w-0')}>{suggestion}</span>
                  <IconCornerDownLeft size={13} className={cn('shrink-0 text-nomi-ink-40')} />
                </WorkbenchButton>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <React.Fragment key={message.id}>
              {message.role === 'user' ? (
                <UserMessageBubble content={message.content} attachments={message.attachments} />
              ) : message.action ? (
                <StoryboardActionCard
                  kind={message.action.kind}
                  resolved={resolvedActionIds.has(message.id)}
                  onRun={(shotMode) => {
                    if (resolvedActionIds.has(message.id)) return
                    setResolvedActionIds((prev) => new Set(prev).add(message.id))
                    const prompt = message.action!.prompt
                    if (message.action!.kind === 'storyboard') launchStoryboardPlanning(prompt || t('creationAi.storyboardCommand'), undefined, shotMode)
                    else launchFixationPlanning(prompt || t('creationAi.fixationCommand'))
                  }}
                />
              ) : message.status === 'error' && (hasTextModel === false || recoveryShownIds.has(message.id)) ? (
                <NoTextModelRecoveryCard
                  onResolved={() => {
                    setRecoveryShownIds((prev) => new Set(prev).add(message.id))
                    refreshTextModel()
                  }}
                />
              ) : message.status === 'error' || message.content.startsWith(t('creationAi.errorPrefix')) ? (
                // 缺大脑(上一分支)外的一般错误 → 红色错误卡(人话+重试/去模型接入),与生成侧同一张卡。
                <AssistantErrorCard
                  error={message.content}
                  onRetry={() => {
                    const lastUser = [...messages].reverse().find((item) => item.role === 'user')
                    if (lastUser) void send(lastUser.content)
                  }}
                />
              ) : (
                <AssistantMessageView
                  content={message.status === 'pending' ? '' : message.content}
                  attachments={message.attachments}
                  streaming={message.status === 'pending' || message.status === 'streaming'}
                  pendingLabel={message.status === 'pending' ? message.content : undefined}
                  cancelled={message.status === 'cancelled'}
                />
              )}
              {message.id === staleBoundaryId ? <StaleConversationDivider /> : null}
            </React.Fragment>
          ))
        )}

        {pendingToolCalls.length > 0 ? (
          <div className={cn('workbench-creation-ai__tool-calls', 'flex flex-col gap-2 p-[10px_11px]')}>
            {pendingToolCalls.map((call) => (
              <div
                key={call.toolCallId}
                className={cn(
                  'workbench-creation-ai__tool-call',
                  'flex flex-col gap-2 p-3 rounded-nomi border border-nomi-accent-soft bg-nomi-accent-soft/40',
                )}
                data-tool-call-id={call.toolCallId}
              >
                <div className={cn('workbench-creation-ai__tool-call-head', 'inline-flex items-center gap-[6px] text-nomi-accent text-caption font-medium')}>
                  {writeToolIcon(call.toolName)}
                  {t(writeToolLabelKey(call.toolName))}
                </div>
                <div className={cn('workbench-creation-ai__tool-call-body', 'max-h-[160px] overflow-auto text-nomi-ink text-body-sm leading-[1.5] whitespace-pre-wrap')}>
                  {call.content || t('creationAi.emptyContent')}
                </div>
                <div className={cn('flex items-center justify-end gap-2 mt-1')}>
                  <WorkbenchButton
                    className={cn('h-7 px-3 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-nomi-ink-80 text-caption cursor-pointer hover:bg-nomi-ink-05')}
                    onClick={() => resolvePending(call.toolCallId, { ok: false, message: 'rejected by user' })}
                  >
                    {t('creationAi.reject')}
                  </WorkbenchButton>
                  <WorkbenchButton
                    className={cn('h-7 px-3 rounded-nomi-sm border-0 bg-nomi-ink text-nomi-paper text-caption cursor-pointer hover:bg-nomi-accent disabled:cursor-not-allowed disabled:opacity-45')}
                    data-primary="true"
                    disabled={!documentTools}
                    onClick={() => applyWriteTool(call)}
                  >
                    {t('creationAi.apply')}
                  </WorkbenchButton>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* 分镜方案卡片(回看链路):拆镜头产出常驻对话流尾部,自 storyboardPlan 自门控,null 不渲染。 */}
        <StoryboardPlanCard />
      </div>

      {error ? (
        <div
          className={cn(
            'workbench-creation-ai__error',
            '[grid-area:error] py-2 px-3 min-w-0',
            'border-t border-[color-mix(in_srgb,var(--workbench-danger)_16%,transparent)]',
            'bg-workbench-danger-soft text-workbench-danger',
            'text-caption leading-[1.45]',
          )}
        >
          {error}
        </div>
      ) : null}

      <footer className={cn('workbench-creation-ai__composer', '[grid-area:composer] min-w-0')}>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={COMPOSER_ATTACHMENT_ACCEPT}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={onInputChange}
        />
        <AttachmentRail attachments={attachments} onRemove={removeAttachment} className={cn('mb-2')} />
        <AutoGrowTextarea
          className={cn(
            // 与画布助手输入框同一套 Tailwind（不再走 workbench-ai.css 的 !important 覆写）。
            'min-h-14 px-2 py-2 rounded-nomi',
            'border border-nomi-line focus:border-nomi-accent',
            'bg-nomi-paper text-nomi-ink text-body-sm leading-[1.45]',
            'placeholder:text-nomi-ink-40',
          )}
          value={draft}
          placeholder={t('creationAi.placeholder')}
          aria-label={t('creationAi.inputAria')}
          // tour 锚点从已删的「拆镜头」chip 迁到输入框——引导改为「教用对话触发」。
          data-tour="storyboard-cta"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => handleAiComposerKeyDown(event, () => void send())}
          onPaste={handlePaste}
        />
        <div className={cn('workbench-creation-ai__actions', 'flex items-center justify-between')}>
          {/* 左侧：附件 + 模式 + 模型选择 */}
          <div className={cn('flex items-center gap-1.5 flex-1 min-w-0')}>
            <WorkbenchIconButton
              className={cn(
                'size-7 grid place-items-center shrink-0',
                'border-0 rounded-nomi-sm bg-transparent text-nomi-ink-60 cursor-pointer',
                'hover:bg-nomi-ink-05 hover:text-nomi-ink',
              )}
              label={t('creationAi.addAttachment')}
              aria-label={t('creationAi.addAttachmentAria')}
              onClick={openFilePicker}
              icon={<IconPaperclip size={16} />}
            />
            <NomiSelect
              ariaLabel={t('creationAi.modeAria')}
              leadingLabel={t('creationAi.modeLeading')}
              size="sm"
              title={t(`creationAi.mode.${activeMode.id}.description` as 'creationAi.mode.general.description')}
              value={activeMode.id}
              options={CREATION_AI_MODES.map((mode) => ({ value: mode.id, label: t(`creationAi.mode.${mode.id}.short` as 'creationAi.mode.general.short') }))}
              onChange={(value) => setModeId(value as CreationAiModeId)}
            />
            <AssistantModelPicker />
          </div>
          {/* 拆镜头 / 立角色卡 不再做固定执行 chip（用户拍板：对话驱动）——
              用户在输入框直接说「拆成 6 个镜头」「把这个故事做成视频」「给主角立张定妆卡」即可，
              意图由 send() 的 pattern 路由给画布 agent（发现性靠 placeholder + tour 引导）。 */}
          {sending ? (
            <WorkbenchIconButton
              className={cn(
                'size-7 grid place-items-center shrink-0',
                'border-0 rounded-full bg-nomi-ink text-nomi-paper cursor-pointer',
                'hover:enabled:bg-nomi-accent',
              )}
              label={t('creationAi.stop')}
              aria-label={t('creationAi.stopAria')}
              onClick={() => turn.getState().requestUserCancel()}
              icon={<IconPlayerStopFilled size={13} />}
            />
          ) : (
            <WorkbenchIconButton
              className={cn(
                'size-7 grid place-items-center shrink-0',
                'border-0 rounded-full bg-nomi-ink text-nomi-paper cursor-pointer',
                'hover:enabled:bg-nomi-accent',
                'disabled:bg-nomi-ink-20 disabled:text-nomi-ink-40 disabled:cursor-not-allowed',
              )}
              label={t('creationAi.send')}
              aria-label={t('creationAi.sendAria')}
              disabled={!draft.trim()}
              onClick={() => void send()}
              icon={<IconSend2 size={15} />}
            />
          )}
        </div>
      </footer>
    </aside>
  )

  if (!expanded || typeof document === 'undefined') return panelBody
  // portal 到 body 会脱离 .workbench-shell 作用域 → 所有 --workbench-* token 失效（面板背景/
  // 蒙层全透明）。带上 workbench-shell 类把 token 作用域接回来（同 Scene3D 全屏壳做法）。
  return createPortal(
    <div
      className={cn('workbench-shell', 'fixed inset-0 z-[200] grid place-items-center bg-[var(--workbench-backdrop)] p-4')}
      onClick={(event) => {
        if (event.target === event.currentTarget) setExpanded(false)
      }}
    >
      {panelBody}
    </div>,
    document.body,
  )
}
