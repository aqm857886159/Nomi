import { getDesktopBridge } from '../../desktop/bridge'
import type { ProductionActionResult, ProductionShotActionFailure, ProductionShotActionResult, RunCommand } from '../../../electron/productionRun/productionRunTypes'

export type { ProductionActionResult, ProductionShotActionFailure, ProductionShotActionResult }

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
  // P4 S6：返工一镜（同 Run 新 Job + 单镜确认 + 派发）；续拍已停批次。回结构化结果（没做成带语义码 failure，渲染层按码翻译）。
  rework: (projectId: string, runId: string, shotId?: string): Promise<ProductionShotActionResult> => bridge().rework(projectId, runId, shotId),
  resumeBatch: (projectId: string, runId: string): Promise<ProductionShotActionResult> => bridge().resumeBatch(projectId, runId),
  // 2026-09-11 Agent 面板付费确认卡的动作，都回结构化 { ok, code }。卡本身随对话投影推过来，这里没有读口。
  reviseSpend: (input: { projectId: string; operationId: string; quoteId: string; shotId?: string; patch: Record<string, unknown> }) => bridge().reviseSpend(input),
  discardSpend: (projectId: string, operationId: string, quoteId: string) => bridge().discardSpend(projectId, operationId, quoteId),
  /** 付费卡上「生成这张 / 这段」：只批这一镜。 */
  confirmSpend: (projectId: string, operationId: string, quoteId: string, shotId?: string) => bridge().confirmSpend(projectId, operationId, quoteId, shotId),
  /** 付费卡上「去掉这张 / 这段」：这一镜不生成。 */
  removeSpendShot: (projectId: string, operationId: string, quoteId: string, shotId: string) => bridge().removeSpendShot(projectId, operationId, quoteId, shotId),
  confirmSpendRemaining: (projectId: string, operationId: string, quoteId: string, shotIds: readonly string[]) => bridge().confirmSpendRemaining(projectId, operationId, quoteId, shotIds),
}
