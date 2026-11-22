import type {
  CreateProductionRunInput,
  ProductionActionResult,
  ProductionShotActionResult,
  ProductionRun,
  ProductionRunSummary,
  RunCommand,
  RunCommandResult,
  RunEvent,
} from "../../electron/productionRun/productionRunTypes";
import type { MaterializeStoryboardResult } from "../../electron/productionRun/productionRunService";
import type { GenerationHandOverFailure, PendingSpendConfirm, PendingSpendRead, PendingSpendShot } from "../../electron/shared/contracts/pendingSpendConfirm";

export type { GenerationHandOverFailure, PendingSpendConfirm, PendingSpendRead, PendingSpendShot };
export type PendingSpendActionIdentity = Readonly<{ presentationId?: string; presentationEpoch?: number; planVersion?: number }>;

export type ProductionRunProjection = ProductionRun & { storyboardReferenceUrls?: Readonly<Record<string,string>> };

export type DesktopProductionRunBridge = {
  list: (projectId: string) => Promise<ProductionRunSummary[]>;
  read: (projectId: string, runId: string) => Promise<ProductionRunProjection | null>;
  createDraft: (input: Pick<CreateProductionRunInput, "projectId" | "playbook" | "origin">) => Promise<ProductionRunProjection>;
  command: (projectId: string, runId: string, command: RunCommand) => Promise<RunCommandResult>;
  materializeStoryboard: (projectId: string, runId: string, artifactId: string, expectedVersion: number) => Promise<MaterializeStoryboardResult>;
  events: (projectId: string, runId: string, afterCursor: number) => Promise<RunEvent[]>;
  // P4 S6：返工一镜 / 续拍已停批次。回结构化结果（渲染层 t() 翻译 code；绝不含密钥）。
  rework: (projectId: string, runId: string, shotId?: string) => Promise<ProductionShotActionResult>;
  resumeBatch: (projectId: string, runId: string) => Promise<ProductionShotActionResult>;
  /**
   * Agent 面板付费卡的动作通道（D2 第③步）。卡本身随对话投影推过来（`LaneWorkspaceProjection.spend`，2026-10-05），
   * 渲染层没有去拉它的第二条路；卡上没有参数（一镜要发什么只住在画布节点上），所以也没有「改参数」。
   */
  /** 「生成」/「全部生成（N）」/「生成剩下 N 段」/「再试一次」：这几镜交给画布，逐镜走画布单节点提交。 */
  handOverSpend: (input: { projectId: string; operationId: string; quoteId: string; shotIds: readonly string[] } & PendingSpendActionIdentity) => Promise<ProductionActionResult>;
  discardSpend: (projectId: string, operationId: string, quoteId: string, identity?: PendingSpendActionIdentity) => Promise<ProductionActionResult>;
  /** 「不生成 ×」：这一镜不生成。 */
  removeSpendShot: (projectId: string, operationId: string, quoteId: string, shotId: string, identity?: PendingSpendActionIdentity) => Promise<ProductionActionResult>;
  /** 「不生成 ×」再点一次：这一镜回到卡上。 */
  restoreSpendShot: (projectId: string, operationId: string, quoteId: string, shotId: string, identity?: PendingSpendActionIdentity) => Promise<ProductionActionResult>;
};
