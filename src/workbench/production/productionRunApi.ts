import { getDesktopBridge } from '../../desktop/bridge'
import type { ProductionActionResult, RunCommand } from '../../../electron/productionRun/productionRunTypes'

export type { ProductionActionResult }

function bridge() {
  const value = getDesktopBridge()?.productionRuns
  if (!value) throw new Error('Production runs require the Electron desktop runtime')
  return value
}

export const productionRunApi = {
  list: (projectId: string) => bridge().list(projectId),
  read: (projectId: string, runId: string) => bridge().read(projectId, runId),
  createDraft: (input: Parameters<ReturnType<typeof bridge>['createDraft']>[0]) => bridge().createDraft(input),
  command: (projectId: string, runId: string, command: RunCommand) => bridge().command(projectId, runId, command),
  materializeStoryboard: (projectId: string, runId: string, artifactId: string, expectedVersion: number) => bridge().materializeStoryboard(projectId, runId, artifactId, expectedVersion),
  events: (projectId: string, runId: string, afterCursor: number) => bridge().events(projectId, runId, afterCursor),
  // P4 S6：返工一镜（同 Run 新 Job + 单镜确认 + 派发）；续拍已停批次。回结构化 { ok, code, message? }（渲染层 t() 翻译 code）。
  rework: (projectId: string, runId: string, shotId?: string): Promise<ProductionActionResult> => bridge().rework(projectId, runId, shotId) as Promise<ProductionActionResult>,
  resumeBatch: (projectId: string, runId: string, reason: 'budget' | 'manual'): Promise<ProductionActionResult> => bridge().resumeBatch(projectId, runId, reason) as Promise<ProductionActionResult>,
  // 2026-09-11 Agent 面板付费确认卡。读是投影（价格由宿主算），三个动作都回结构化 { ok, code }。
  pendingSpend: (projectId: string) => bridge().pendingSpend(projectId),
  reviseSpend: (input: { projectId: string; operationId: string; shotId?: string; patch: Record<string, unknown> }) => bridge().reviseSpend(input),
  discardSpend: (projectId: string, operationId: string) => bridge().discardSpend(projectId, operationId),
  confirmSpend: (projectId: string, operationId: string, shotIds?: readonly string[]) => bridge().confirmSpend(projectId, operationId, shotIds),
}
