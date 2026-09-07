// Agent 面板 v4 · 写侧：面板上每一个能按的东西，最终都走到这里的一个命令。
//
// 一条纪律贯穿本文件：**每个命令都在同一条错误带上报错**。现役面板里线程命令曾经是裸
// `void promise`，宿主拒绝就变成一个未处理的 rejection——用户点了「删除会话」，什么都没发生，
// 也没有任何提示。`run()` 是那条统一的出口。
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentsChatResponseDto } from '../../../api/desktopClient'
import type { AgentToolProfile } from '../../../../electron/shared/projectAgentContracts'
import { isProjectAgentLiveStatus } from '../../../../electron/shared/projectAgentContracts'
import type { DocumentAnchorRef, PreconditionSet, TargetRef } from '../../../../electron/shared/capabilityTargeting'
import { useWorkbenchStore } from '../../workbenchStore'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { timelineRevision } from '../../timeline/kernel/timelineKernel'
import type { CreationDocumentTools } from '../../workbenchTypes'
import { runWorkbenchAgent, type ToolCallEvent } from '../workbenchAgentRunner'
import { projectAgentProjectionStore } from '../projectAgentProjectionStore'
import {
  interruptProjectAgentTurn,
  steerProjectAgentTurn,
  stopProjectAgentTurn,
} from '../projectAgentTurnCommands'
import {
  activateProjectAgentThread,
  createProjectAgentThread,
  deleteProjectAgentQueueItem,
  moveProjectAgentQueueItem,
  removeProjectAgentThread,
} from '../projectAgentUiCommands'
import { projectAgentAttachmentClaims } from '../projectAgentAttachments'
import { attachmentPayloads } from '../resident/agentItemHelpers'
import { buildResidentContextSnapshot, mergeResidentContextHandles, type AgentContextSnapshot } from '../resident/residentContextSnapshot'
import { composeResidentSystemPrompt } from '../resident/residentPromptSelection'
import { friendlyError, surfaceLabel, type ResidentSurface } from '../resident/residentShellDisplay'
import { residentToolProjectionScope, readResidentToolProjections, writeResidentToolProjections } from '../resident/residentToolProjection'
import { residentToolProjectionForCall as toolProjectionForCall } from '../resident/residentToolDisplay'
import { buildStaticAgentSystemPrompt } from '../../generationCanvas/agent/generationCanvasAgentClient'
import { getCreationAiMode } from '../../creation/creationAiModes'
import { runProposalUndo, useCommittedProposal } from '../../generationCanvas/agent/proposalUndo'
import { agentPanelV4PendingTools, pendingToolKey, projectBindingKey } from './agentPanelV4PendingTools'
import { canStopAskingFor } from './agentPanelV4Intervention'
import type { PermissionTier } from './agentPanelV4Types'
import { approvalPolicyForTier } from './agentPanelV4Logic'
import type { AgentPanelV4Data } from './useAgentPanelV4Data'
import type { LibraryPrompt } from '../../api/promptLibraryApi'
import { promptDisplayTitle } from '../../promptLibrary/promptDisplay'
import { resolveCapabilityEffectClass } from '../../../../electron/shared/agentCapabilities/registry'

const isDocumentSurface = (surface: ResidentSurface): boolean => surface === 'creation' || surface === 'storyboard'

type ResidentSendContext = Readonly<{
  snapshot: AgentContextSnapshot
  activeDocumentId: string
  selectedNodeIds: readonly string[]
  selectedClipIds: readonly string[]
  documentState?: Readonly<{ revision: number; contentHash: string; anchor: DocumentAnchorRef }>
}>

/**
 * 在 enqueue **前的同一个同步回合里**把所有域选中读一遍。
 * composer 绝不能发一个「用户打字期间已经变了的」渲染期选中：这份快照由纯构造器冻结，
 * 随请求一起走。
 */
function captureSendContext(surface: ResidentSurface, creationDocumentTools: CreationDocumentTools | null): ResidentSendContext {
  const workbench = useWorkbenchStore.getState()
  const canvas = useGenerationCanvasStore.getState()
  const activeDocumentId = workbench.activeDocumentId
  const document = workbench.workbenchDocuments.find((item) => item.id === activeDocumentId)
  // 编辑器桥只在创作面活着时权威。生成/预览面可能在编辑器拆掉之后仍然挂着面板，
  // 在那里探这座桥会让一次本来合法的发送失败，或者抓到一个陈旧的锚点。
  const documentState = isDocumentSurface(surface) ? creationDocumentTools?.readState() : undefined
  const selectedNodeIds = surface === 'generation' ? Object.freeze([...canvas.selectedNodeIds]) : Object.freeze([])
  const selectedClipIds = surface === 'preview' ? Object.freeze([...workbench.selectedTimelineClipIds]) : Object.freeze([])
  const snapshot = buildResidentContextSnapshot({
    document: document
      ? {
          id: document.id,
          revision: documentState?.revision ?? workbench.persistRevision,
          anchor: documentState?.anchor ?? { kind: 'whole-document' },
          title: document.title,
        }
      : null,
    canvas: surface === 'generation'
      ? { revision: canvas.persistRevision, nodes: canvas.nodes, selectedNodeIds }
      : null,
    timeline: surface === 'preview'
      ? {
          revision: timelineRevision(workbench.timeline),
          fps: workbench.timeline.fps,
          clips: workbench.timeline.tracks.flatMap((track) => track.clips),
          selectedClipIds,
        }
      : null,
  })
  return Object.freeze({ snapshot, activeDocumentId, selectedNodeIds, selectedClipIds, ...(documentState ? { documentState } : {}) })
}

export type AgentPanelV4Actions = Readonly<{
  error: string
  clearError: () => void
  send: (text: string, options?: { toolProfile?: AgentToolProfile; displayText?: string }) => Promise<void>
  stop: () => void
  /** 「继续」：给还活着的回合追加一句指令，不打断它。 */
  steer: (instruction: string) => void
  approve: () => void
  reject: (reason?: string) => void
  /** 「不再问 →」= 这一个能力以后不再问（`approvalScope: 'always'`），不动项目策略。 */
  stopAsking: () => void
  answerOption: (option: string) => void
  queueAction: (rowIndex: number, action: string) => void
  queueInterrupt: (rowIndex: number) => void
  newThread: () => void
  activateThread: (threadId: string) => void
  removeThread: (threadId: string) => void
  undoLastProposal: () => void
  selectedLibraryPrompt: LibraryPrompt | null
  setSelectedLibraryPrompt: (prompt: LibraryPrompt | null) => void
  permission: PermissionTier
  setPermission: (tier: PermissionTier) => void
}>

export function useAgentPanelV4Actions(surface: ResidentSurface, data: AgentPanelV4Data): AgentPanelV4Actions {
  const { t } = useTranslation()
  const [error, setError] = React.useState('')
  const [selectedLibraryPrompt, setSelectedLibraryPrompt] = React.useState<LibraryPrompt | null>(null)
  const setDraft = useWorkbenchStore((state) => state.setProjectAgentDraft)
  const attachments = useWorkbenchStore((state) => state.projectAgentAttachments)
  const setAttachments = useWorkbenchStore((state) => state.setProjectAgentAttachments)
  const approvalPolicy = useWorkbenchStore((state) => state.projectAgentApprovalPolicy)
  const setApprovalPolicy = useWorkbenchStore((state) => state.setProjectAgentApprovalPolicy)
  const creationDocumentTools = useWorkbenchStore((state) => state.creationDocumentTools)
  const activeSkill = useWorkbenchStore((state) => state.creationActiveSkill)
  const creationAiModeId = useWorkbenchStore((state) => state.creationAiModeId)
  const committedProposal = useCommittedProposal()
  const { snapshot, primaryPending, runningTurnId, queue } = data

  const run = React.useCallback((command: () => Promise<unknown>) => {
    void command().catch((caught: unknown) => setError(friendlyError(caught, t)))
  }, [t])

  // 三档 → 合同两字段。档位本身住在 workbench store（跟着项目走），
  // 这里只做映射；映射表是 `PERMISSION_POLICIES`，不在这里第二次写死。
  const permission: PermissionTier = approvalPolicy.mode
  const setPermission = React.useCallback((tier: PermissionTier) => {
    setApprovalPolicy(approvalPolicyForTier(tier))
  }, [setApprovalPolicy])

  const send = React.useCallback(async (rawText: string, options?: { toolProfile?: AgentToolProfile; displayText?: string }) => {
    const text = rawText.trim()
    if (!text || !snapshot) return
    setError('')
    if (attachments.some((item) => item.status === 'uploading')) {
      setError(t('creationAi.attachmentsUploading'))
      return
    }
    const turnId = `turn-resident-${globalThis.crypto.randomUUID()}`
    let sendContext: ResidentSendContext
    try {
      sendContext = captureSendContext(surface, creationDocumentTools)
    } catch (caught) {
      setError(friendlyError(caught, t))
      return
    }
    const surfaceContext = surfaceLabel(t, surface)
    const contextDetail = surface === 'generation'
      ? t('agentResident.contextNodes', { count: sendContext.selectedNodeIds.length })
      : surface === 'preview'
        ? t('agentResident.contextClips', { count: sendContext.selectedClipIds.length })
        : t('agentResident.currentDocument')
    const capability = isDocumentSurface(surface) ? 'creation-editor' as const : 'canvas-agent' as const
    const skillKey = activeSkill?.key
      ?? (surface === 'storyboard' ? 'workbench.storyboard.planner'
        : surface === 'creation' ? 'workbench.creation.general'
          : surface === 'preview' ? 'workbench.timeline.editor'
            : 'workbench-generation')
    let target: TargetRef
    let preconditions: PreconditionSet | undefined
    if (isDocumentSurface(surface)) {
      const state = sendContext.documentState
      target = { kind: 'document', documentId: sendContext.activeDocumentId, anchor: state?.anchor ?? { kind: 'whole-document' } }
      if (state) preconditions = { document: { revision: state.revision, contentHash: state.contentHash } }
    } else if (surface === 'preview') {
      target = { kind: 'timeline', clipIds: Object.freeze([...sendContext.selectedClipIds]) }
    } else {
      target = { kind: 'canvas', nodeIds: Object.freeze([...sendContext.selectedNodeIds]) }
    }
    const contextSnapshot = mergeResidentContextHandles(sendContext.snapshot, [])
    const bindingKey = projectBindingKey(snapshot.binding)
    /**
     * 收据正文缓存的作用域**要在写的那一刻读**，不能用发送前捕获的那份快照。
     *
     * 2026-09-06 真机走查抓到：一条对话的第一次发送发生在线程建好之前，
     * 那一刻 `snapshot.activeThreadId` 还是 null，于是 scope 是空串、
     * `cacheProjection` 直接 return——整个会话的收据正文一条都没落盘。
     * 界面上看不出来：旧版收据的「输入/输出」读的是按入参重算的**工具描述**，
     * 缓存空不空长得一模一样。用户 2026-09-06 展开「修改文稿」看到两遍
     * 「将内容写入当前文稿」，根子有一半在这里。
     */
    const activeThreadId = (): string =>
      projectAgentProjectionStore.getState().snapshot?.activeThreadId ?? snapshot.activeThreadId ?? ''
    /**
     * 终态到达：把每条调用的展示投影落盘。收据的正文在宿主那边是 ref-only，
     * 不在这里存一份，下次打开面板展开收据就是空的。
     *
     * **结果和错误一起落**（2026-09-06 真机使用抓到）：这里以前只传 `(toolName, args, status)`，
     * 于是投影是按入参重算的一段描述——收据「输出」栏印的是「这次打算做什么」，
     * 而失败那一路一个字的原因都没有。`record.error` / `record.result` 本来就在回执里，白丢。
     */
    const cacheTerminalProjections = (response: AgentsChatResponseDto): void => {
      const threadId = activeThreadId()
      for (const record of response.toolCalls) {
        const status = record.status === 'ok' ? 'done' as const
          : record.status === 'cancelled' ? 'stopped' as const
            : record.status === 'denied' ? 'declined' as const
              : 'failed' as const
        // 终态重写这一条时别把开头存下的正文偏移量抹掉——它只到达过一次。
        const offset = previousOffset(bindingKey, threadId, turnId, record.toolCallId)
        cacheProjection(bindingKey, threadId, turnId, record.toolCallId, {
          ...toolProjectionForCall(t, record.toolName, record.args, status, {
            ...(record.result !== undefined ? { result: record.result } : {}),
            ...(record.error ? { error: record.error } : {}),
          }),
          ...(offset !== undefined ? { textOffset: offset } : {}),
        })
      }
    }
    setAttachments([])
    try {
      // 工作方式三档（Ask / 编辑选中 / Agent）已删（2026-09-06 拍板 ①）：
      // 范围由 composer 的「选中」chip 决定，不再是一个模式。回合一律按 `auto` 跑，
      // 而 `workMode` 在宿主侧保持它的默认值 `agent`——合同那句
      // 「Changing the work mode never widens approval」仍然成立，因为我们一根轴都没动。
      // 创作面**必须**带上它那一档的方法论提示词。旧面板从 `PROMPT_PRESETS`（随旧菜单删除）
      // 或 `getCreationAiMode()` 取；后者还在，是这条的正主。少了它，创作面的 Agent
      // 会从「按创作方法论干活」退化成一个通用聊天——界面上看不出来，产出会明显变差。
      const creationMode = getCreationAiMode(creationAiModeId)
      const surfaceSystemPrompt = surface === 'generation'
        ? buildStaticAgentSystemPrompt('agent')
        : surface === 'preview'
          ? buildStaticAgentSystemPrompt('agent', 'timeline')
          : isDocumentSurface(surface) && !activeSkill
            ? creationMode.prompt
            : undefined
      const systemPrompt = composeResidentSystemPrompt(surfaceSystemPrompt, activeSkill ? null : selectedLibraryPrompt)
      const response = await runWorkbenchAgent({
        turnId,
        prompt: `${surfaceContext}\n${contextDetail}\n\n${text}`,
        ...(systemPrompt ? { systemPrompt } : {}),
        displayPrompt: options?.displayText ?? text,
        capability,
        ...(options?.toolProfile ? { toolProfile: options.toolProfile } : surface === 'preview' ? { toolProfile: 'timeline' as const } : {}),
        projectId: snapshot.binding.projectId,
        selectedNodeIds: surface === 'generation' ? sendContext.selectedNodeIds : undefined,
        target,
        ...(preconditions ? { preconditions } : {}),
        originSurface: {
          surfaceId: 'project-agent-resident',
          kind: isDocumentSurface(surface) ? 'document' : surface === 'generation' ? 'canvas' : 'preview',
        },
        mode: 'auto',
        approvalPolicy,
        skillKey,
        // 人话名字，不是 key：它会进提示词（`buildSkillSystemPrompt` 的 `skillName:` 那行），
        // 印一个 `workbench.creation.general` 给模型看没有任何信息量。
        skillName: activeSkill?.name ?? (selectedLibraryPrompt ? promptDisplayTitle(selectedLibraryPrompt) : creationMode.title),
        contextSnapshot,
        attachmentClaims: projectAgentAttachmentClaims(attachments.filter((item) => item.status === 'ready')),
        attachments: attachmentPayloads(attachments),
        onToolCall: (call: ToolCallEvent) => {
          agentPanelV4PendingTools.register(call, bindingKey)
          // 「这次调用发生时，本回合的正文已经写到哪儿了」——把整回合合并成一条的助手正文
          // 切回原位就靠它。宿主只在**要审批**的那条路上算这个锚（`assistantTextAnchor`），
          // 「自动改」档下的安全改动是 silent 放行的，一个锚都没有；而用户日常就在那一档。
          // 所以拿不到锚时自己量一次：这一刻的快照里，本回合的助手正文有多长。
          // 宿主的锚优先——它是权威，只是不总在。
          const anchoredOffset = call.assistantTextAnchor?.textOffset ?? liveAssistantTextLength(call.turnId)
          cacheProjection(bindingKey, activeThreadId(), call.turnId, call.toolCallId, {
            ...toolProjectionForCall(t, call.toolName, call.args, 'proposed'),
            ...(anchoredOffset !== undefined ? { textOffset: anchoredOffset } : {}),
          })
        },
      })
      cacheTerminalProjections(response)
    } catch (caught) {
      // **失败的回合更要落收据正文**：那一路上「为什么失败」是用户唯一想知道的事。
      // 运行时在抛错时把回执挂在 error 上（`agentResponse`），正是为了这一步。
      const carried = (caught as { agentResponse?: AgentsChatResponseDto }).agentResponse
      if (carried) cacheTerminalProjections(carried)
      setError(friendlyError(caught, t))
    } finally {
      agentPanelV4PendingTools.clearTurn(turnId)
    }
  }, [activeSkill, approvalPolicy, attachments, creationAiModeId, creationDocumentTools, selectedLibraryPrompt, setAttachments, snapshot, surface, t])

  const decide = React.useCallback((ok: boolean, extra?: Record<string, unknown>) => {
    const pending = primaryPending
    if (!pending || pending.state !== 'pending') return
    const key = pendingToolKey(pending.call)
    if (!agentPanelV4PendingTools.beginResolving(key)) return
    void (async () => {
      try {
        // `denied: true` 不是可选的礼貌用词：运行时按它把这次调用记成 `denied`，
        // 宿主再把 `denied` 落成 `declined`（本轮同 PR 的契约改动），收据行尾才写得出
        // 「已拒绝 ×」而不是「失败 ⚠」。少这一个字段，用户点的「不要」就会在历史里
        // 变成「它自己坏了」——那是把用户的决定记成了系统故障。
        await pending.call.confirm({
          ok,
          ...(ok ? {} : { denied: true, message: t('agentPanelV4.reject') }),
          ...extra,
        })
        agentPanelV4PendingTools.settle(key, ok ? 'approved' : 'denied')
      } catch (caught) {
        setError(friendlyError(caught, t))
      } finally {
        agentPanelV4PendingTools.endResolving(key)
      }
    })()
  }, [primaryPending, t])

  return {
    error,
    clearError: () => setError(''),
    send,
    stop: () => {
      if (!runningTurnId) return
      // 停止是**两件事**：中断在跑的那次供应商请求，然后把记录标成已停止。
      // 只做第二件（现役的做法）会让模型继续跑到自己结束，用户看到「已停止」但还在扣时间。
      run(async () => {
        await interruptProjectAgentTurn(runningTurnId).catch(() => undefined)
        await stopProjectAgentTurn(runningTurnId)
      })
    },
    steer: (instruction) => {
      if (!runningTurnId || !instruction.trim()) return
      run(() => steerProjectAgentTurn(runningTurnId, instruction))
    },
    approve: () => decide(true),
    reject: (reason) => decide(false, reason ? { message: reason } : {}),
    stopAsking: () => {
      const pending = primaryPending
      if (!pending) return
      // ② 作用域是**这一个能力**：`approvalScope: 'always'` 与现役 `onApproveAlways` 同一条路，
      // 而且和它一样只对可撤销的改动开放。不动 `approvalPolicy`——那才是扩大授权面。
      if (!canStopAskingFor(resolveCapabilityEffectClass(pending.call.toolName, pending.call.args))) return
      decide(true, { approvalScope: 'always' as const })
    },
    answerOption: (option) => {
      // 反问的选项就是答案本身；缺参数的建议 chip 也走这条路——两者都只是「把话补上」。
      if (primaryPending && primaryPending.state === 'pending') decide(true, { message: option })
      else setDraft(option)
    },
    queueAction: (rowIndex, action) => {
      const entry = queueRowToItem(data, rowIndex)
      if (!entry) return
      if (action === t('agentPanelV4.queueDelete')) run(() => deleteProjectAgentQueueItem(entry.queueItemId))
      else run(() => moveProjectAgentQueueItem(entry.queueItemId, 'up'))
    },
    queueInterrupt: (rowIndex) => {
      const entry = queueRowToItem(data, rowIndex)
      if (!entry) return
      run(async () => {
        await interruptProjectAgentTurn(entry.turnId).catch(() => undefined)
        await stopProjectAgentTurn(entry.turnId)
      })
    },
    newThread: () => run(createProjectAgentThread),
    activateThread: (threadId) => run(() => activateProjectAgentThread(threadId)),
    removeThread: (threadId) => run(() => removeProjectAgentThread(threadId)),
    undoLastProposal: () => {
      if (!committedProposal) return
      run(() => runProposalUndo(committedProposal))
    },
    selectedLibraryPrompt,
    setSelectedLibraryPrompt,
    permission,
    setPermission,
  }

  function queueRowToItem(source: AgentPanelV4Data, rowIndex: number) {
    const live = source.snapshot?.queue.filter(
      (item) => item.threadId === source.activeThreadId && isProjectAgentLiveStatus(item.status),
    ) ?? []
    // 队列行的身份就是它的位置——`projectV4Queue` 按同一个数组同序产出，
    // 所以行序换得回队列项。两边的过滤条件必须是同一条，否则「删第 2 条」会删错人。
    return rowIndex < live.length && rowIndex < queue.length ? live[rowIndex] : undefined
  }
}

/**
 * 这一刻本回合的助手正文有多长。
 *
 * 与宿主 `assistantTextAnchor` 同一个量，只是宿主只在审批那条路上算它——
 * 「自动改」档的安全改动是 silent 放行的，走不到那段代码。渲染层这边读的是同一份投影快照，
 * 量的是同一件事；拿不到（回合还没写过一个字）就返回 undefined，不填 0。
 * 填 0 会被下游当成「切在开头」，把整段回答折进过程行——那比不切更糟。
 */
function liveAssistantTextLength(turnId: string): number | undefined {
  const item = projectAgentProjectionStore.getState().snapshot?.items
    .find((candidate) => candidate.kind === 'assistant' && candidate.turnId === turnId)
  if (item?.kind !== 'assistant') return undefined
  return item.text.length || undefined
}

/** 上一次为这条调用存过的正文偏移量（终态改写时要保住它）。 */
function previousOffset(bindingKey: string, threadId: string, turnId: string, toolCallId: string): number | undefined {
  const scope = residentToolProjectionScope(bindingKey, threadId)
  if (!scope) return undefined
  return readResidentToolProjections(scope)[`${turnId}:${toolCallId}`]?.textOffset
}

function cacheProjection(
  bindingKey: string,
  threadId: string,
  turnId: string,
  toolCallId: string,
  projection: ReturnType<typeof toolProjectionForCall>,
): void {
  const scope = residentToolProjectionScope(bindingKey, threadId)
  if (!scope) return
  const persisted = new Map(Object.entries(readResidentToolProjections(scope)))
  persisted.set(`${turnId}:${toolCallId}`, projection)
  writeResidentToolProjections(scope, persisted)
}
