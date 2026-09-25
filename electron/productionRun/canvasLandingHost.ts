// 画布落地的**宿主装配**（从 appIntegration 拆出，守 800 行门岗 · R9）。
//
// 这里只做一件事：把「一个 Run → 落成画布占位/组/回填 result，并把 shotId→nodeId 写回 Run」
// 这条 best-effort 链装配成两个可调用的口子，让能力核那边保持是接线而不是实现。
//
// 四个落地时机共用同一条链、同一个 operationId（`canvas-landing:{runId}`）：
//   ① 画布 agent 建/改草稿（landDraftOnCanvas）——用户当场看见，不必等重开项目；
//      （文稿来源的草稿走不到这里：它的方案住在项目记录里，由用户点「放入画布」才落。）
//   ② 付费确认即落；③ 打开项目补齐（reconcile）；
//   ④ Run 每一次耐久变化之后（followRunChange）——派发、供应商受理、出片落盘、失败、预算触顶、急停……
//      每一次状态转移都经过仓库的同一个 execute，所以这里挂在它的事件旁路上，而不是在每个转移点各补一次投递。
//      2026-09-25 之前只有「出片」那一下会投递（pushShotResultToRenderer），「在生成」那一段由渲染层自己轮询
//      一份 Run 快照另画一套；两份真相各判各的，供应商早出片了节点还在转。
// 共用是刻意的（P1 一个家）：几条各写一份的话，任何一份漏了幂等章就会堆出重复节点。
// 同一个 Run 的落地**逐个排队**：并发的两次 materialize 都会看见「节点还没建」，然后各建一份。
import { buildMaterializeShotsPayload, landCanvasForRun, materializeShotsSignature } from "./multiShotCanvasLanding";
import type { ProductionRun } from "./productionRunTypes";

export type CanvasLandingHostDeps = {
  /** 读 Run（读不到 / 已消失 → 静默不落）。 */
  readRun: (projectId: string, runId: string) => ProductionRun | null | undefined;
  /** 执行一条 durable Run 命令（这里只用来写 plan.bind-shot-nodes）。 */
  command: (projectId: string, runId: string, command: Record<string, unknown>) => Promise<unknown>;
  /** 向渲染层发一次窄 RPC（项目没开 / 窗口不可用时会抛，由 landCanvasForRun 记 warn 吞掉）。 */
  requestRenderer: (op: string, payload: unknown, timeoutMs: number) => Promise<unknown>;
  resolveProjectRoot: (projectId: string) => string | null;
  /** 该项目此刻是不是打开着的（草稿投影只在项目开着时落，其余交给 reconcile 补齐）。 */
  isProjectOpen: (projectId: string) => boolean;
};

export type CanvasLandingHost = {
  /** 尽力把一个 Run 的镜落成画布占位/组/回填 result（**永不抛**）。 */
  landCanvasBestEffort: (projectId: string, runId: string, isCurrent?: () => boolean) => Promise<boolean>;
  /** 草稿账本的投影钩子：agent 一建/一改草稿就投影一次。永不 await（落地不得阻断草稿命令）。 */
  landDraftOnCanvas: (projectId: string, runId: string) => void;
  /**
   * Run 一次耐久变化之后调（挂在仓库 execute 的事件旁路上）。**只跟已经落在画布上的 Run**
   * （有节点绑定）——还没落过的由 ①②③ 负责建节点，跟随者只负责让已有节点跟上 Run 的真实状态。
   * 投影指纹没变（比如只是又轮询了一次）就不去打扰渲染层。永不抛、永不阻塞调用方。
   */
  followRunChange: (run: ProductionRun) => void;
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
  // 同一个 Run 的落地排成一队（见文件头）；以及每个 Run 最近一次成功投影的指纹（跟随者据此去重）。
  const chainByRun = new Map<string, Promise<unknown>>();
  const projectedSignature = new Map<string, string>();
  const runKey = (projectId: string, runId: string): string => `${projectId}\u0000${runId}`;
  const signatureOf = (run: ProductionRun, projectId: string): string | null => {
    const payload = buildMaterializeShotsPayload(run, { projectRoot: deps.resolveProjectRoot(projectId) });
    return payload ? materializeShotsSignature(payload) : null;
  };
  const enqueue = (key: string, work: () => Promise<boolean>): Promise<boolean> => {
    const previous = chainByRun.get(key) ?? Promise.resolve();
    const next = previous.then(work, work);
    const settled = next.then(() => undefined, () => undefined);
    chainByRun.set(key, settled);
    void settled.then(() => { if (chainByRun.get(key) === settled) chainByRun.delete(key); });
    return next;
  };
  const runLanding = (projectId: string, runId: string, isCurrent?: () => boolean): Promise<boolean> =>
    enqueue(runKey(projectId, runId), () => landOnce(projectId, runId, isCurrent, false));
  const landOnce = async (projectId: string, runId: string, isCurrent: (() => boolean) | undefined, existingOnly: boolean): Promise<boolean> => {
    if (isCurrent && !isCurrent()) return false;
    let run: ProductionRun | null | undefined;
    try {
      run = deps.readRun(projectId, runId);
    } catch {
      return false;
    }
    if (!run) return false;
    // Document-admitted plans land only after the user explicitly chooses
    // "put on canvas" — that gesture runs through the plan's own row actions, not through here.
    // Historical runs that already have a binding remain reconcilable so reopening a project
    // does not strand their nodes. **This gate has no bypass**: a bypass is the difference
    // between "the agent drafted a plan for you" and "the agent rearranged your canvas".
    const hasCanvasBinding = Boolean(run.generationPlan?.nodeId)
      || Boolean(run.generationPlan?.shots?.some((shot) => shot.nodeId));
    if (run.origin.sourceDocument && !hasCanvasBinding) return false;
    const signature = signatureOf(run, projectId);
    const landed = await landCanvasForRun(run, {
      requestRenderer: deps.requestRenderer,
      projectRoot: deps.resolveProjectRoot(projectId),
      planName: run.authoring?.title ?? run.brief?.goal,
      ...(existingOnly ? { existingOnly: true } : {}),
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
    if (landed && signature) projectedSignature.set(runKey(projectId, runId), signature);
    return landed;
  };
  // 已排进队、还没开始的那一次跟随：同一段时间里的多次变化并成一次（开始时摘掉，之后的变化会再排一次）。
  const pendingFollows = new Set<string>();
  const followRunChange = (run: ProductionRun): void => {
    const plan = run.generationPlan;
    if (!plan) return;
    const key = runKey(run.projectId, run.runId);
    const onCanvas = Boolean(plan.nodeId) || Boolean(plan.shots?.some((shot) => shot.nodeId));
    if (!onCanvas || !deps.isProjectOpen(run.projectId)) {
      // 项目关了：下次打开时由 ③ 整份补齐，这里的指纹不再代表渲染层手里那份。
      projectedSignature.delete(key);
      return;
    }
    // execute 的事件旁路是同步调的（可能还在 Run 锁里）：排进这个 Run 的落地队列（异步开始，出了这一拍），
    // 轮到它时再读一次最新的 Run、比一次指纹——没变就不打扰渲染层。
    if (pendingFollows.has(key)) return;
    pendingFollows.add(key);
    track(run.projectId, enqueue(key, async () => {
      pendingFollows.delete(key);
      let current: ProductionRun | null | undefined;
      try {
        current = deps.readRun(run.projectId, run.runId);
      } catch {
        return false;
      }
      if (!current || !deps.isProjectOpen(current.projectId)) return false;
      const signature = signatureOf(current, current.projectId);
      if (!signature || projectedSignature.get(key) === signature) return false;
      return landOnce(current.projectId, current.runId, undefined, true);
    }));
  };
  const landCanvasBestEffort = (projectId: string, runId: string, isCurrent?: () => boolean): Promise<boolean> => {
    const work = runLanding(projectId, runId, isCurrent);
    track(projectId, work);
    return work;
  };
  return {
    landCanvasBestEffort,
    followRunChange,
    landDraftOnCanvas: (projectId, runId) => {
      if (!deps.isProjectOpen(projectId)) return;
      track(projectId, runLanding(projectId, runId));
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
