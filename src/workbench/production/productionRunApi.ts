import { getDesktopBridge } from '../../desktop/bridge'
import type { ProductionActionResult, ProductionShotActionFailure, ProductionShotActionResult, RunCommand } from '../../../electron/productionRun/productionRunTypes'
import type { PendingSpendActionIdentity, PendingSpendHandOverInput } from '../../desktop/productionRunBridgeTypes'

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
  // Agent 面板付费卡的动作（D2 第③步），都回结构化 { ok, code }。卡本身随对话投影推过来，这里没有读口。
  /** 「生成」/「全部生成（N）」/「生成剩下 N 段」/「再试一次」：这几镜交给画布。 */
  handOverSpend: (input: PendingSpendHandOverInput) => bridge().handOverSpend(input),
  discardSpend: (projectId: string, operationId: string, quoteId: string, identity?: PendingSpendActionIdentity) => bridge().discardSpend(projectId, operationId, quoteId, identity),
  /** 「不生成 ×」：这一镜不生成。 */
  removeSpendShot: (projectId: string, operationId: string, quoteId: string, shotId: string, identity?: PendingSpendActionIdentity) => bridge().removeSpendShot(projectId, operationId, quoteId, shotId, identity),
  /** 「不生成 ×」再点一次：这一镜回到卡上。 */
  restoreSpendShot: (projectId: string, operationId: string, quoteId: string, shotId: string, identity?: PendingSpendActionIdentity) => bridge().restoreSpendShot(projectId, operationId, quoteId, shotId, identity),
}
