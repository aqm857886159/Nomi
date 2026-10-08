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
import type { PendingSpendConfirm, PendingSpendRead, PendingSpendRevised, PendingSpendShot } from "../../electron/shared/contracts/pendingSpendConfirm";

export type { PendingSpendConfirm, PendingSpendRead, PendingSpendRevised, PendingSpendShot };
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
   * 2026-09-11 Agent 面板付费确认卡的动作通道。卡本身（待决出价，价格由宿主按目录算）随对话投影推过来
   * （`LaneWorkspaceProjection.spend`，2026-10-05），渲染层没有去拉它的第二条路。
   * 改参数的回包带着宿主现算的那张卡（`pending`）：点下去那一刻拿它对账、封印。
   */
  reviseSpend: (input: { projectId: string; operationId: string; quoteId: string; shotId?: string; patch: Record<string, unknown> } & PendingSpendActionIdentity) => Promise<ProductionActionResult & PendingSpendRevised>;
  discardSpend: (projectId: string, operationId: string, quoteId: string, identity?: PendingSpendActionIdentity) => Promise<ProductionActionResult>;
  /** 付费卡上「生成这张 / 这段」：只批这一镜。 */
  confirmSpend: (projectId: string, operationId: string, quoteId: string, shotId?: string, identity?: PendingSpendActionIdentity) => Promise<ProductionActionResult>;
  /** 付费卡上「去掉这张 / 这段」：这一镜不生成。 */
  removeSpendShot: (projectId: string, operationId: string, quoteId: string, shotId: string, identity?: PendingSpendActionIdentity) => Promise<ProductionActionResult>;
  /** 付费卡上「生成剩下 N 张 / 段」：点名的这几张（= 卡上还没决定的全部）各批一份、各派一份。 */
  confirmSpendRemaining: (projectId: string, operationId: string, quoteId: string, shotIds: readonly string[], identity?: PendingSpendActionIdentity) => Promise<ProductionActionResult>;
};
