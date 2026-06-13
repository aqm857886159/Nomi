// conversations.json 的纯数据层(净化 + v1→v2 迁移)。无 electron 依赖,可单测。
// IPC 注册在 conversationsIpc.ts(fs/ipcMain 那层)。
export type PersistedMessage = { id: string; role: string; content: string }
export type PersistedThread = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: PersistedMessage[]
}
export type PersistedArea = { activeId: string | null; threads: PersistedThread[] }
export type PersistedConversations = {
  v: 2
  creation: PersistedArea
  generation: PersistedArea
  /** S6-5 事务回执(审计 A6):整笔撤销入口随对话落盘,reload 后仍可撤销。形状由渲染层校验。 */
  committedProposal?: unknown
}

const MAX_MESSAGES = 200
const MAX_THREADS = 30

/** 回执只做最小形状检(proposalId 必须是非空 string),完整校验在渲染层 parse。 */
export function sanitizeCommittedProposal(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const proposalId = (value as Record<string, unknown>).proposalId
  return typeof proposalId === 'string' && proposalId ? value : null
}

export function sanitizeMessages(value: unknown): PersistedMessage[] {
  if (!Array.isArray(value)) return []
  const out: PersistedMessage[] = []
  for (const item of value.slice(-MAX_MESSAGES)) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    if (typeof rec.id !== 'string' || typeof rec.role !== 'string' || typeof rec.content !== 'string') continue
    out.push({ id: rec.id, role: rec.role, content: rec.content })
  }
  return out
}

function sanitizeThread(value: unknown): PersistedThread | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const rec = value as Record<string, unknown>
  if (typeof rec.id !== 'string' || !rec.id) return null
  const createdAt = Number.isFinite(rec.createdAt) ? (rec.createdAt as number) : 0
  const updatedAt = Number.isFinite(rec.updatedAt) ? (rec.updatedAt as number) : createdAt
  return {
    id: rec.id,
    title: typeof rec.title === 'string' ? rec.title : '',
    createdAt,
    updatedAt,
    messages: sanitizeMessages(rec.messages),
  }
}

/** 线程列表:净化 + 按 updatedAt 倒序裁到 MAX_THREADS(留最新);activeId 须指向留下的线程。 */
export function sanitizeArea(value: unknown): PersistedArea {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { activeId: null, threads: [] }
  const rec = value as Record<string, unknown>
  const threads: PersistedThread[] = []
  if (Array.isArray(rec.threads)) {
    for (const item of rec.threads) {
      const thread = sanitizeThread(item)
      if (thread) threads.push(thread)
    }
  }
  threads.sort((a, b) => b.updatedAt - a.updatedAt)
  const kept = threads.slice(0, MAX_THREADS)
  const activeId = typeof rec.activeId === 'string' && kept.some((t) => t.id === rec.activeId) ? rec.activeId : null
  return { activeId, threads: kept }
}

/** v1 单条消息数组 → 一条 thread(非空才包);供迁移用。时间戳用迁移时刻。 */
function migrateLegacyMessages(value: unknown, now: number): PersistedArea {
  const messages = sanitizeMessages(value)
  if (messages.length === 0) return { activeId: null, threads: [] }
  const id = `thread-${now}-${Math.round(messages.length)}`
  const firstUser = messages.find((m) => m.role === 'user')
  const title = (firstUser?.content || '').slice(0, 24)
  return { activeId: id, threads: [{ id, title, createdAt: now, updatedAt: now, messages }] }
}

/** 任意磁盘原始内容 → v2(v1 迁移 / v2 净化 / 缺失或损坏 → 空)。 */
export function normalizeToV2(raw: unknown, now: number): PersistedConversations {
  const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (rec.v === 2) {
    return {
      v: 2,
      creation: sanitizeArea(rec.creation),
      generation: sanitizeArea(rec.generation),
      committedProposal: sanitizeCommittedProposal(rec.committedProposal),
    }
  }
  // v1(或无 v 标):旧单线程包成一条 thread。
  return {
    v: 2,
    creation: migrateLegacyMessages(rec.creationMessages, now),
    generation: migrateLegacyMessages(rec.generationMessages, now),
    committedProposal: sanitizeCommittedProposal(rec.committedProposal),
  }
}
