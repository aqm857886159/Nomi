// 项目记忆的渲染层客户端(harness S9):取数(bridge IPC)+ prompt 注入段格式化(预算裁剪)。
// 提炼/缓存/墓碑全在主进程 projectMemory.ts——这里只消费。
import { getDesktopBridge } from '../../../desktop/bridge'
import { getCanvasEventsProjectId } from '../events/canvasEventEmitter'

export type MemoryFactView = {
  id: string
  text: string
  kind: 'character' | 'style' | 'brand' | 'preference' | 'constraint'
  origin: 'auto' | 'user'
  sourceSeqs: number[]
  pinned: boolean
  updatedAt: string
}

const isFact = (value: unknown): value is MemoryFactView => {
  const record = value as MemoryFactView
  return Boolean(record && typeof record.id === 'string' && typeof record.text === 'string')
}

export async function fetchProjectMemoryFacts(): Promise<MemoryFactView[]> {
  const projectId = getCanvasEventsProjectId()
  const api = getDesktopBridge()?.memory
  if (!projectId || !api) return []
  try {
    const result = await api.get(projectId)
    return Array.isArray(result?.facts) ? result.facts.filter(isFact) : []
  } catch {
    return []
  }
}

export async function updateProjectMemoryFact(factId: string, patch: { text?: string; pinned?: boolean }): Promise<MemoryFactView[]> {
  const projectId = getCanvasEventsProjectId()
  const api = getDesktopBridge()?.memory
  if (!projectId || !api) return []
  const result = await api.update(projectId, factId, patch)
  return Array.isArray(result?.facts) ? result.facts.filter(isFact) : []
}

export async function removeProjectMemoryFact(factId: string): Promise<MemoryFactView[]> {
  const projectId = getCanvasEventsProjectId()
  const api = getDesktopBridge()?.memory
  if (!projectId || !api) return []
  const result = await api.remove(projectId, factId)
  return Array.isArray(result?.facts) ? result.facts.filter(isFact) : []
}

/** 用户确认记住一条软偏好（提议态「记住」/手动加）→ 写成 origin:user 事实，下次注入两个助手。 */
export async function addProjectMemoryFact(text: string, kind = 'preference'): Promise<MemoryFactView[]> {
  const projectId = getCanvasEventsProjectId()
  const api = getDesktopBridge()?.memory
  if (!projectId || !api?.add || !text.trim()) return []
  const result = await api.add(projectId, text.trim(), kind)
  return Array.isArray(result?.facts) ? result.facts.filter(isFact) : []
}
