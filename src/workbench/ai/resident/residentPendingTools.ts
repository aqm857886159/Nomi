// 待确认工具的进程内注册表 —— 常驻壳的**状态管道**，与 UI 形态无关。
//
// 从 ProjectAgentResidentShell 抽出来：那个壳已顶到 800 行硬上限，而这一块是纯管道
// （Map/Set + 订阅通知），不含任何渲染决定。刻意选它而不是选 Popover/MenuRow 那些
// UI 原语——Agent 界面正在重做（docs/design/agent-ui-spec.generated.json），
// 动 UI 原语会和重做撞车，动管道不会。
import React from 'react'
import type { ProjectAgentStatus } from '../../../../electron/shared/projectAgentContracts'
import type { ToolCallEvent } from '../workbenchAgentRunner'
import { normalizeResidentToolProjection, residentToolProjectionKey, type ResidentToolProjection } from './residentToolProjection'
import type { ResidentApprovalState } from './ResidentUiPrimitives'

export type PendingTool = { call: ToolCallEvent; bindingKey: string; state: ResidentApprovalState }

export const residentPendingTools = new Map<string, PendingTool>()
export const residentToolArgs = new Map<string, unknown>()
/** Derived, redacted display data; never a second source of Host task truth. */
export const residentToolProjections = new Map<string, ResidentToolProjection>()
const residentPendingListeners = new Set<() => void>()
export const residentResolvingTools = new Set<string>()
export const pendingKey = (call: Pick<ToolCallEvent, 'turnId' | 'toolCallId'>): string => `${call.turnId}:${call.toolCallId}`
export const bindingKey = (binding: { immutableProjectUuid: string; projectGeneration: number }): string => `${binding.immutableProjectUuid}:${binding.projectGeneration}`
export const isLive = (status: ProjectAgentStatus): boolean => ['drafting', 'proposed', 'queued', 'running'].includes(status)
export const emitPending = (): void => residentPendingListeners.forEach((listener) => listener())

export function cacheResidentToolProjection(scope: string, turnId: string, toolCallId: string, projection: ResidentToolProjection): void {
  if (!scope) return
  residentToolProjections.set(residentToolProjectionKey(scope, turnId, toolCallId), normalizeResidentToolProjection(projection))
  emitPending()
}

export function clearResidentPendingTools(turnId: string): void {
  let changed = false
  for (const key of residentPendingTools.keys()) {
    if (!key.startsWith(`${turnId}:`)) continue
    residentPendingTools.delete(key)
    residentToolArgs.delete(key)
    residentResolvingTools.delete(key)
    changed = true
  }
  if (changed) emitPending()
}

export function useResidentPendingTools(key: string | null): PendingTool[] {
  const [, redraw] = React.useState(0)
  React.useEffect(() => { const listener = () => redraw((value) => value + 1); residentPendingListeners.add(listener); return () => { residentPendingListeners.delete(listener) } }, [])
  return key ? Array.from(residentPendingTools.values()).filter((item) => item.bindingKey === key) : []
}
