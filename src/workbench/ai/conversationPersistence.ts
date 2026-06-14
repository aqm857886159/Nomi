// per-project AI 对话落盘接线层(harness S1b-3 起;2026-06-14 升会话历史)。
// 纯线程模型在 conversationThreads.ts;本层负责:① 订阅两面板 store 消息变化 → 同步进
// 活动线程 + 防抖回写;② IPC 读写;③ 项目切换载入;④ 暴露 UI 操作(新建/切换/删除/列表)
// 给面板与历史弹层。切项目前必须先 flushNow(旧 id),否则防抖窗口里的回写会写错项目文件。
import { getDesktopBridge } from '../../desktop/bridge'
import { seedWorkbenchAgentSession } from '../../api/desktopClient'
import { workbenchSessionKey } from './workbenchAgentRunner'
import { useWorkbenchStore } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import {
  getCommittedProposal,
  parseCommittedProposalRecord,
  setCommittedProposal,
  clearCommittedProposal,
  subscribeCommittedProposal,
} from '../generationCanvas/agent/proposalUndo'
import type { WorkbenchAiMessage } from './workbenchAiTypes'
import {
  type ConvArea,
  type ConversationThread,
  activateThread,
  getActiveThreadId,
  hydrateArea,
  listThreads,
  removeThread,
  serializeArea,
  startNewThread,
  syncActiveMessages,
} from './conversationThreads'

const WRITE_DEBOUNCE_MS = 1000

const now = (): number => Date.now()

// 面板 area ↔ store 投影适配器。活动线程的 messages 实时映射到这些字段(消费组件零改)。
const adapters: Record<ConvArea, {
  getMessages: () => WorkbenchAiMessage[]
  setMessages: (messages: WorkbenchAiMessage[]) => void
}> = {
  creation: {
    getMessages: () => useWorkbenchStore.getState().creationAiMessages,
    setMessages: (messages) => useWorkbenchStore.getState().setCreationAiMessages(messages),
  },
  generation: {
    getMessages: () => useGenerationCanvasStore.getState().generationAiMessages,
    setMessages: (messages) => useGenerationCanvasStore.getState().setGenerationAiMessages(messages),
  },
}

let getProjectIdProvider: () => string | null = () => null
function activeProjectId(): string | null {
  return getProjectIdProvider()
}

/** 把某 area 活动线程的气泡种回模型工作缓存(空→清);per-area 键,互不串。 */
function seedActiveModelMemory(area: ConvArea, messages: readonly WorkbenchAiMessage[]): void {
  void seedWorkbenchAgentSession(
    workbenchSessionKey(area),
    messages.map((message) => ({ role: message.role, content: message.content })),
  )
}

// ─── 历史弹层用的轻量响应式:线程结构变化时 bump,弹层 useSyncExternalStore 订阅 ───
let revision = 0
const listeners = new Set<() => void>()
function bump(): void {
  revision += 1
  for (const cb of listeners) cb()
}
export function getConversationsRevision(): number {
  return revision
}
export function subscribeConversations(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

// ───────────────────────────── 回写 ─────────────────────────────

function writeNow(projectId: string): void {
  const api = getDesktopBridge()?.conversations
  if (!api || !projectId) return
  void api
    .write(projectId, {
      creation: serializeArea(projectId, 'creation', now()),
      generation: serializeArea(projectId, 'generation', now()),
      // S6-5 事务回执随对话落盘(审计 A6):「整笔撤销」入口不被一次 reload 蒸发。
      committedProposal: getCommittedProposal(),
    })
    .catch(() => {})
}

let timer: ReturnType<typeof setTimeout> | null = null

/** 消息变化后的防抖回写;projectId 在冲刷时刻取(防切换期错绑)。 */
export function scheduleConversationsWrite(getProjectId: () => string | null): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    const projectId = getProjectId()
    if (projectId) writeNow(projectId)
  }, WRITE_DEBOUNCE_MS)
}

/** 切项目前调用:取消挂起防抖,把两面板当前 store 消息同步进模型,立即写给指定旧项目。 */
export function flushConversationsNow(projectId: string | null): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!projectId) return
  syncActiveMessages(projectId, 'creation', adapters.creation.getMessages(), now())
  syncActiveMessages(projectId, 'generation', adapters.generation.getMessages(), now())
  writeNow(projectId)
}

/** hydrate 后把磁盘上的会话列表迁灌进模型,并把各 area 活动线程气泡投影回面板。 */
export async function loadProjectConversations(projectId: string): Promise<void> {
  const api = getDesktopBridge()?.conversations
  if (!api) return
  try {
    const { ok, conversations } = await api.read(projectId)
    const stamp = now()
    const creationMessages = hydrateArea(projectId, 'creation', ok ? conversations?.creation : null, stamp)
    const generationMessages = hydrateArea(projectId, 'generation', ok ? conversations?.generation : null, stamp)
    adapters.creation.setMessages(creationMessages)
    adapters.generation.setMessages(generationMessages)
    // 打开项目即把活动线程气泡种回模型记忆——开门就能带记忆接着聊(气泡=UI 与模型记忆的统一真相源,
    // 也覆盖掉 'local' 桶里别的项目残留)。各 area 独立键,互不串。
    seedActiveModelMemory('creation', creationMessages)
    seedActiveModelMemory('generation', generationMessages)
    // 回执种回(仅内存槽为空时;损坏数据 parse 失败则宁缺勿错)。
    if (ok && !getCommittedProposal() && conversations?.committedProposal) {
      const record = parseCommittedProposalRecord(conversations.committedProposal)
      if (record) setCommittedProposal(record)
    }
    bump()
  } catch {
    /* 旁路:读失败不影响面板 */
  }
}

// ─────────────────────── UI 操作(面板 + 弹层) ───────────────────────

/** 「新对话」:当前线程归档(留列表),建空活动线程,清面板投影。generation 连带清整笔撤销入口。 */
export function startNewConversation(area: ConvArea): void {
  const projectId = activeProjectId()
  if (!projectId) return
  // 先把当前 store 消息同步进活动线程,再归档建新。
  syncActiveMessages(projectId, area, adapters[area].getMessages(), now())
  startNewThread(projectId, area, now())
  adapters[area].setMessages([])
  if (area === 'generation') clearCommittedProposal()
  bump()
  scheduleConversationsWrite(activeProjectId)
}

/** 切到某历史线程:把它的气泡投影回面板。generation 切线程清整笔撤销入口(引用旧线程节点)。 */
export function switchConversation(area: ConvArea, threadId: string): void {
  const projectId = activeProjectId()
  if (!projectId) return
  syncActiveMessages(projectId, area, adapters[area].getMessages(), now())
  const target = activateThread(projectId, area, threadId, now())
  if (!target) return
  adapters[area].setMessages(target.messages.slice())
  if (area === 'generation') clearCommittedProposal()
  // 翻回旧对话:把该线程气泡重建成模型工作缓存喂回去,使模型「记起」这段、无缝接着聊。
  seedActiveModelMemory(area, target.messages)
  bump()
  scheduleConversationsWrite(activeProjectId)
}

/** 删除某归档线程(不能删活动线程)。 */
export function deleteConversation(area: ConvArea, threadId: string): void {
  const projectId = activeProjectId()
  if (!projectId) return
  if (removeThread(projectId, area, threadId, now())) {
    bump()
    scheduleConversationsWrite(activeProjectId)
  }
}

/** 列出某面板的会话线程(含活动),倒序。供历史弹层渲染。 */
export function listConversations(area: ConvArea): ConversationThread[] {
  const projectId = activeProjectId()
  if (!projectId) return []
  return listThreads(projectId, area, now())
}

export function getActiveConversationId(area: ConvArea): string | null {
  const projectId = activeProjectId()
  if (!projectId) return null
  return getActiveThreadId(projectId, area, now())
}

// ─────────────────────────── 生命周期 ───────────────────────────

/** 订阅两面板消息变化 → 同步活动线程 + 防抖回写。返回解除函数。 */
export function initConversationPersistence(getProjectId: () => string | null): () => void {
  getProjectIdProvider = getProjectId
  const onChange = (area: ConvArea) => {
    const projectId = getProjectId()
    if (projectId) syncActiveMessages(projectId, area, adapters[area].getMessages(), now())
    scheduleConversationsWrite(getProjectId)
  }
  const unsubscribeWorkbench = useWorkbenchStore.subscribe((state) => state.creationAiMessages, () => onChange('creation'))
  const unsubscribeCanvas = useGenerationCanvasStore.subscribe((state) => state.generationAiMessages, () => onChange('generation'))
  const unsubscribeProposal = subscribeCommittedProposal(() => scheduleConversationsWrite(getProjectId))
  return () => {
    unsubscribeWorkbench()
    unsubscribeCanvas()
    unsubscribeProposal()
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
}
