// 画布落地的**宿主装配**（从 appIntegration 拆出，守 800 行门岗 · R9）。
//
// 这里只做一件事：把「一个 Run → 落成画布占位/组/回填 result，并把 shotId→nodeId 写回 Run」
// 这条 best-effort 链装配成两个可调用的口子，让能力核那边保持是接线而不是实现。
//
// 三个落地时机共用同一条链、同一个 operationId（`canvas-landing:{runId}`）：
//   ① agent 建/改草稿（landDraftOnCanvas）——用户当场看见，不必等重开项目；
//   ② 付费确认即落；③ 打开项目补齐（reconcile）。
// 共用是刻意的（P1 一个家）：三条各写一份的话，任何一份漏了幂等章就会堆出重复节点。
import { landCanvasForRun } from "./multiShotCanvasLanding";
import type { ProductionRun } from "./productionRunTypes";

export type CanvasLandingHostDeps = {
  /** 读 Run（读不到 / 已消失 → 静默不落）。 */
  readRun: (projectId: string, runId: string) => ProductionRun | null | undefined;
  /** 执行一条 durable Run 命令（这里只用来写 plan.bind-shot-nodes）。 */
  command: (projectId: string, runId: string, command: Record<string, unknown>) => Promise<unknown>;
  /** 向渲染层发一次窄 RPC（项目没开 / 窗口不可用时会抛，由 landCanvasForRun 记 warn 吞掉）。 */
  requestRenderer: (op: string, payload: unknown, timeoutMs: number) => Promise<unknown>;
  resolveProjectRoot: (projectId: string) => string | null;
  previewSecret: () => string;
  /** 该项目此刻是不是打开着的（草稿投影只在项目开着时落，其余交给 reconcile 补齐）。 */
  isProjectOpen: (projectId: string) => boolean;
};

export type CanvasLandingHost = {
  /** 尽力把一个 Run 的镜落成画布占位/组/回填 result（**永不抛**）。 */
  landCanvasBestEffort: (projectId: string, runId: string, isCurrent?: () => boolean) => Promise<boolean>;
  /** 草稿账本的投影钩子：agent 一建/一改草稿就投影一次。永不 await（落地不得阻断草稿命令）。 */
  landDraftOnCanvas: (projectId: string, runId: string) => void;
  /**
   * 等这个项目上**Nomi 自己发起的**落地全部结束（永不抛；没有在飞的立即返回）。
   *
   * 为什么需要它：落地会写画布 → 项目落盘 → `project.revision` 前进，而付费授权信封盖的正是
   * `project.revision`（收据只在它描述的那份项目文档还是当前版本时有效，见
   * `capabilityCore/approvalReceiptRuntime.ts`）。草稿落地是 fire-and-forget，于是这次前进可能落在
   * 「封信封」与「用户点确认」之间——用户的批准被 Nomi 自己的投影作废，报「此确认已失效」。
   * 所以封信封前必须等自家在飞的投影落完。**用户自己改项目**仍然作废收据，那是 #722 要的语义，不动。
   */
  settleCanvasLanding: (projectId: string) => Promise<void>;
};

export function createCanvasLandingHost(deps: CanvasLandingHostDeps): CanvasLandingHost {
  // 每个项目一份「在飞的落地」聚合承诺。三个落地时机都登记（都会写项目文档），
  // settleCanvasLanding 只等它，不改任何一条链的执行顺序。
  const inFlightByProject = new Map<string, Promise<void>>();
  const track = (projectId: string, work: Promise<unknown>): void => {
    const entry = work.then(() => undefined, () => undefined);
    const previous = inFlightByProject.get(projectId);
    const merged = previous ? Promise.all([previous, entry]).then(() => undefined) : entry;
    inFlightByProject.set(projectId, merged);
    void merged.then(() => {
      if (inFlightByProject.get(projectId) === merged) inFlightByProject.delete(projectId);
    });
  };
  const runLanding = async (projectId: string, runId: string, isCurrent?: () => boolean): Promise<boolean> => {
    if (isCurrent && !isCurrent()) return false;
    let run: ProductionRun | null | undefined;
    try {
      run = deps.readRun(projectId, runId);
    } catch {
      return false;
    }
    if (!run) return false;
    return landCanvasForRun(run, {
      requestRenderer: deps.requestRenderer,
      projectRoot: deps.resolveProjectRoot(projectId),
      previewSecret: deps.previewSecret(),
      planName: run.brief?.goal,
      ...(isCurrent ? { isCurrent } : {}),
      bindShotNodes: async (boundProjectId, boundRunId, expectedRevision, bindings) => {
        await deps.command(boundProjectId, boundRunId, {
          commandId: `canvas-landing:${boundRunId}:bind:${bindings.map((binding) => `${binding.shotId}=${binding.nodeId}`).join(",")}`.slice(0, 200),
          expectedRevision,
          type: "plan.bind-shot-nodes",
          payload: { bindings },
          issuedAt: new Date().toISOString(),
        });
      },
    });
  };
  const landCanvasBestEffort = (projectId: string, runId: string, isCurrent?: () => boolean): Promise<boolean> => {
    const work = runLanding(projectId, runId, isCurrent);
    track(projectId, work);
    return work;
  };
  return {
    landCanvasBestEffort,
    landDraftOnCanvas: (projectId, runId) => {
      if (!deps.isProjectOpen(projectId)) return;
      void landCanvasBestEffort(projectId, runId);
    },
    settleCanvasLanding: async (projectId) => {
      // 等待期间可能又追加了一段（agent 连着改草稿）：等到这条链真的空掉为止。
      let pending = inFlightByProject.get(projectId);
      while (pending) {
        await pending;
        const next = inFlightByProject.get(projectId);
        pending = next === pending ? undefined : next;
      }
    },
  };
}
