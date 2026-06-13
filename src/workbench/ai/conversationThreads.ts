// 会话线程模型(2026-06-14 会话历史,plan docs/plan/2026-06-14-conversation-history.md)。
// 纯模型:per-project × per-area 的「活动线程 + 归档线程」,是对话气泡的唯一真相源。
// messages 仍由面板经 store 写入(流式),接线层(conversationPersistence)把 store 变化
// 同步进活动线程;本模块只管线程结构 / 标题派生 / 序列化与迁灌,不碰 React/store。
import type { WorkbenchAiMessage } from './workbenchAiTypes'
import type { PersistedConversationArea, PersistedThread } from '../../desktop/bridge'

export type ConvArea = 'creation' | 'generation'

export type ConversationThread = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: WorkbenchAiMessage[]
}

type AreaModel = {
  activeId: string
  threads: Map<string, ConversationThread>
}
type ProjectModel = Record<ConvArea, AreaModel>

const MAX_THREADS = 30

// per-project 模型。Map 按 projectId 寻址,切项目无需 swap(各项目一条记录)。
const projects = new Map<string, ProjectModel>()

function newId(): string {
  // crypto.randomUUID 在 renderer 可用;不依赖 Date.now 以便测试可注入。
  return `thread-${crypto.randomUUID()}`
}

function freshThread(now: number): ConversationThread {
  return { id: newId(), title: '', createdAt: now, updatedAt: now, messages: [] }
}

function emptyArea(now: number): AreaModel {
  const thread = freshThread(now)
  return { activeId: thread.id, threads: new Map([[thread.id, thread]]) }
}

function ensureProject(projectId: string, now: number): ProjectModel {
  let model = projects.get(projectId)
  if (!model) {
    model = { creation: emptyArea(now), generation: emptyArea(now) }
    projects.set(projectId, model)
  }
  return model
}

function ensureArea(projectId: string, area: ConvArea, now: number): AreaModel {
  return ensureProject(projectId, now)[area]
}

/** 首条「实质」user 文本派生标题(跳过寒暄/极短),截断到 24 字;无则空串。 */
const GREETING = /^(在吗|你好|hi|hello|嗨|哈喽|帮我看|帮我看下|帮我看一下|看一下|看看)[\s，,。.!！?？~]*$/i
export function deriveThreadTitle(messages: readonly WorkbenchAiMessage[]): string {
  for (const message of messages) {
    if (message.role !== 'user') continue
    const text = (message.content || '').trim()
    if (text.length < 2 || GREETING.test(text)) continue
    return text.slice(0, 24)
  }
  // 全是寒暄/无实质:退而取第一条 user 任意文本
  const firstUser = messages.find((m) => m.role === 'user')
  return (firstUser?.content || '').trim().slice(0, 24)
}

/** 该线程的展示标题:显式 title 优先,否则实时从 messages 派生(空线程→'新对话')。 */
export function threadDisplayTitle(thread: ConversationThread): string {
  if (thread.title.trim()) return thread.title.trim()
  const derived = deriveThreadTitle(thread.messages)
  return derived || '新对话'
}

function getActive(area: AreaModel): ConversationThread {
  return area.threads.get(area.activeId) as ConversationThread
}

/** 裁到 MAX_THREADS:保留活动线程 + 其余按 updatedAt 倒序留最新。 */
function pruneThreads(area: AreaModel): void {
  if (area.threads.size <= MAX_THREADS) return
  const sorted = [...area.threads.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  const kept = new Set<string>([area.activeId])
  for (const thread of sorted) {
    if (kept.size >= MAX_THREADS) break
    kept.add(thread.id)
  }
  for (const id of [...area.threads.keys()]) {
    if (!kept.has(id)) area.threads.delete(id)
  }
}

// ───────────────────────────── 操作 ─────────────────────────────

/** 面板流式写入后:把 store 的活动消息同步进活动线程(+bump updatedAt,+空标题时派生)。 */
export function syncActiveMessages(
  projectId: string,
  area: ConvArea,
  messages: readonly WorkbenchAiMessage[],
  now: number,
): void {
  const thread = getActive(ensureArea(projectId, area, now))
  thread.messages = messages.slice()
  if (messages.length > 0) thread.updatedAt = now
  if (!thread.title.trim()) thread.title = deriveThreadTitle(messages)
}

/** 「新对话」:活动线程留在列表(归档),建一条空线程设为活动。返回新活动线程(空 messages)。 */
export function startNewThread(projectId: string, area: ConvArea, now: number): ConversationThread {
  const model = ensureArea(projectId, area, now)
  const current = getActive(model)
  // 当前活动为空(没聊过)→ 复用它,不堆叠空线程。
  if (current.messages.length === 0) return current
  const next = freshThread(now)
  model.threads.set(next.id, next)
  model.activeId = next.id
  pruneThreads(model)
  return next
}

/** 切到某线程:设为活动,返回其 messages 供接线层投影进 store。未知 id → 返回 null。 */
export function activateThread(projectId: string, area: ConvArea, threadId: string, now: number): ConversationThread | null {
  const model = ensureArea(projectId, area, now)
  const target = model.threads.get(threadId)
  if (!target) return null
  model.activeId = threadId
  return target
}

/** 删除某归档线程(不能删活动线程)。返回是否删除。 */
export function removeThread(projectId: string, area: ConvArea, threadId: string, now: number): boolean {
  const model = ensureArea(projectId, area, now)
  if (threadId === model.activeId) return false
  return model.threads.delete(threadId)
}

export function setThreadTitle(projectId: string, area: ConvArea, threadId: string, title: string, now: number): void {
  const thread = ensureArea(projectId, area, now).threads.get(threadId)
  if (thread) thread.title = title.slice(0, 24)
}

export function getActiveThreadId(projectId: string, area: ConvArea, now: number): string {
  return ensureArea(projectId, area, now).activeId
}

/** 列出线程(含活动),按 updatedAt 倒序——供历史弹层渲染。 */
export function listThreads(projectId: string, area: ConvArea, now: number): ConversationThread[] {
  return [...ensureArea(projectId, area, now).threads.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

// ──────────────────────── 序列化 / 迁灌 ────────────────────────

export function serializeArea(projectId: string, area: ConvArea, now: number): PersistedConversationArea {
  const model = ensureArea(projectId, area, now)
  const threads: PersistedThread[] = [...model.threads.values()].map((thread) => ({
    id: thread.id,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messages: thread.messages.map((m) => ({ id: m.id, role: m.role, content: m.content })),
  }))
  return { activeId: model.activeId, threads }
}

/** 从磁盘 area 迁灌进模型;返回活动线程 messages(接线层投影进 store)。空/无活动 → 建空线程。 */
export function hydrateArea(
  projectId: string,
  area: ConvArea,
  persisted: PersistedConversationArea | null | undefined,
  now: number,
): WorkbenchAiMessage[] {
  const model = ensureProject(projectId, now)
  const threads = new Map<string, ConversationThread>()
  for (const t of persisted?.threads ?? []) {
    if (!t || typeof t.id !== 'string' || !t.id) continue
    threads.set(t.id, {
      id: t.id,
      title: typeof t.title === 'string' ? t.title : '',
      createdAt: Number.isFinite(t.createdAt) ? t.createdAt : now,
      updatedAt: Number.isFinite(t.updatedAt) ? t.updatedAt : now,
      messages: (t.messages ?? []).map((m) => ({ id: m.id, role: m.role as WorkbenchAiMessage['role'], content: m.content })),
    })
  }
  let activeId = persisted?.activeId && threads.has(persisted.activeId) ? persisted.activeId : null
  if (!activeId) {
    // 无合法活动线程:有线程则取最新,否则建空。
    const newest = [...threads.values()].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (newest) {
      activeId = newest.id
    } else {
      const blank = freshThread(now)
      threads.set(blank.id, blank)
      activeId = blank.id
    }
  }
  model[area] = { activeId, threads }
  return (threads.get(activeId) as ConversationThread).messages.slice()
}

/** 测试用:清空全部模型。 */
export function __resetConversationThreadsForTests(): void {
  projects.clear()
}
