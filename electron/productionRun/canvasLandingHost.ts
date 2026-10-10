// 画布落地的**宿主装配**（从 appIntegration 拆出，守 800 行门岗 · R9）。
//
// 这里只做一件事：把「一个 Run → 落成画布占位/组/回填 result，并把 shotId→nodeId 写回 Run」这条链装配成可调用的口子，
// 让能力核那边保持是接线而不是实现。派发前的那一次（landBeforeDispatch）失败如实抛——由唯一准入点
// shotLandingAdmission 判这一镜能不能派（架构③ 先落节点、再发请求）；其余投影失败只记 warn。
//
// 四个落地时机共用同一条链、同一个 operationId（`canvas-landing:{runId}`）：
//   ① 画布 agent 建/改草稿（landDraftOnCanvas）——用户当场看见，不必等重开项目；
//      （文稿来源的草稿走不到这里：它的方案住在项目记录里，由用户点「放入画布」或确认付费才落。）
//   ② 派发前落地（landBeforeDispatch，准入点调；不再 best-effort）；③ 打开项目补齐（reconcile）；
//   ④ Run 每一次耐久变化之后（followRunChange）——派发、供应商受理、出片落盘、失败、预算触顶、急停……
//      每一次状态转移都经过仓库的同一个 execute，所以这里挂在它的事件旁路上，而不是在每个转移点各补一次投递。
//      2026-09-25 之前只有「出片」那一下会投递（pushShotResultToRenderer），「在生成」那一段由渲染层自己轮询
//      一份 Run 快照另画一套；两份真相各判各的，供应商早出片了节点还在转。
// 共用是刻意的（P1 一个家）：几条各写一份的话，任何一份漏了幂等章就会堆出重复节点。
// 同一个 Run 的落地**逐个排队**：并发的两次 materialize 都会看见「节点还没建」，然后各建一份。
import { buildMaterializeShotsPayload, landCanvasForRun, landCanvasForRunOrThrow, materializeShotsSignature, runHasBeenOnCanvas, type CanvasLandingDeps } from "./multiShotCanvasLanding";
import type { ProductionRun } from "./productionRunTypes";
import { ProductionRunRevisionConflictError } from "./productionRunRepository";
import type { DraftCanvasLanding } from "../shared/agentLane/draftCanvasLanding";
import { openProjectLease, type LandingProjectAccess, type LandingProjectLease } from "./landingProjectAccess";

export type CanvasLandingHostDeps = {
  /** 读 Run（读不到 / 已消失 → 静默不落）。 */
  readRun: (projectId: string, runId: string) => ProductionRun | null | undefined;
  /** 执行一条 durable Run 命令（这里只用来写 plan.bind-shot-nodes）。 */
  command: (projectId: string, runId: string, command: Record<string, unknown>) => Promise<unknown>;
  /** 向渲染层发一次窄 RPC（项目没开 / 窗口不可用时会抛：投影记 warn 吞掉，派发前落地如实抛）。 */
  requestRenderer: (op: string, payload: unknown, timeoutMs: number) => Promise<unknown>;
  resolveProjectRoot: (projectId: string) => string | null;
  /** 该项目此刻是不是打开着的（草稿投影只在项目开着时落，其余交给 reconcile 补齐）。 */
  isProjectOpen: (projectId: string) => boolean;
  /**
   * 派发前落地要的项目还没打开时，在不打扰用户的前提下打开它（只有隐藏主窗口那一种，见 landingProjectAccess）；
   * 打不开就抛（用户可见的窗口开着别的项目 / 没有渲染层）。不给 = 只认已经打开的项目。
   */
  openProjectForLanding?: LandingProjectAccess;
};

export type CanvasLandingHost = {
  /**
   * 派发前落地（唯一准入点 `admitShotsForDispatch` 的落地器）：把这个 Run 没落的镜落成画布节点并写回绑定。
   * **失败就抛**（项目打不开 / 渲染层不在 / 落地报错）——抛了这一镜就不派。文稿来源的计划也真建节点（确认 = 放到画布）。
   */
  landBeforeDispatch: (projectId: string, runId: string) => Promise<void>;
  /** 草稿账本的投影钩子：agent 一建/一改草稿就投影一次。永不 await（落地不得阻断草稿命令）。 */
  landDraftOnCanvas: (projectId: string, runId: string) => void;
  /**
   * Run 一次耐久变化之后调（挂在仓库 execute 的事件旁路上）。**只跟落过画布的 Run**
   * （有节点绑定，或记过 detached——见 runHasBeenOnCanvas）——还没落过的由 ①②③ 负责建节点，
   * 跟随者只负责让已有节点跟上 Run 的真实状态。
   * 投影指纹没变（比如只是又轮询了一次）就不去打扰渲染层。永不抛、永不阻塞调用方。
   */
  followRunChange: (run: ProductionRun) => void;
  /**
   * 打开项目时的画布对账（每一个未取消的 Run 都走它）：只让画布上已有、认得出是同一镜的节点对上它——补结果、
   * 纠正 detached 记录——**绝不新建节点**；认不出来的什么都不做，记一条日志。不看上一次投影的指纹
   * （渲染层刚从磁盘装载）。没落过画布的 Run 不碰。永不抛。
   * 以前这里对未结束的 Run 走整份落地：带老 Run 的项目一打开就凭空多出一份节点（#966 CI，canvas-shortcuts C19）。
   */
  reconcileExistingCanvas: (projectId: string, runId: string) => Promise<boolean>;
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
  /**
   * 草稿一建 / 一改之后，**落地落完了**再回「这份草稿此刻在画布上吗」——回执（`draft_shots`）只渲染它。
   * 事实取自落地之后读到的 Run 账本（有没有节点绑定），不是回执自己猜：落没落、落成哪几个节点。永不抛。
   */
  draftLandingOutcome: (projectId: string, runId: string) => Promise<DraftCanvasLanding | undefined>;
};

/** 纯函数：一份 Run + 项目开没开着 → 它此刻在画布上的真实状态。 */
export function draftCanvasLandingOfRun(run: ProductionRun, projectOpen: boolean): DraftCanvasLanding | undefined {
  const plan = run.generationPlan;
  if (!plan) return undefined;
  const shots = plan.shots && plan.shots.length > 0
    ? plan.shots.map((shot) => ({ shotId: shot.shotId, nodeId: shot.nodeId }))
    : [{ shotId: plan.candidate.candidateId, nodeId: plan.nodeId }];
  const nodes = shots.flatMap((shot) => shot.nodeId ? [{ shotId: shot.shotId, nodeId: shot.nodeId }] : []);
  if (nodes.length > 0) return { state: "placed", nodes, shotCount: shots.length };
  if (run.origin.sourceDocument) return { state: "not_placed", reason: "document_plan" };
  return { state: "not_placed", reason: projectOpen ? "not_landed" : "project_closed" };
}

/** 写回撞上了并发写入（仓库的乐观并发检查）。按错误类型认，不读原话。 */
function isRevisionConflict(error: unknown): boolean {
  return error instanceof ProductionRunRevisionConflictError;
}

/** Run 里这一镜是不是记着 detached（单镜计划的地址是候选 id，与落地投影同一条约定）。 */
function shotIsDetached(run: ProductionRun, shotId: string): boolean {
  const plan = run.generationPlan;
  if (!plan) return false;
  if (!plan.shots || plan.shots.length === 0) return plan.canvasDetached === true && plan.candidate.candidateId === shotId;
  return plan.shots.some((shot) => shot.shotId === shotId && shot.canvasDetached === true);
}

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
  const runLanding = (projectId: string, runId: string): Promise<boolean> =>
    enqueue(runKey(projectId, runId), () => landOnce(projectId, runId, false));
  /** 一份落地依赖：渲染层、项目根、计划名，以及把绑定写回 Run 的那条命令。投影与派发前落地共用（P1 一个家）。 */
  const landingDeps = (projectId: string, landing: ProductionRun): CanvasLandingDeps => ({
    requestRenderer: deps.requestRenderer,
    projectRoot: deps.resolveProjectRoot(projectId),
    planName: landing.authoring?.title ?? landing.brief?.goal,
    bindShotNodes: async (boundProjectId, boundRunId, expectedRevision, bindings) => {
      // 命令号按「绑到哪」去重：同一份绑定反复落地只记一次。可一镜被记过 detached 之后又回报「节点还在」，
      // 那是一次**新的**纠正——绑定串和当初一字不差，按旧号会被仓库的幂等重放原样吞掉，detached 永远纠正不回来
      // （S1-5）。所以纠正带上它纠正的那个 revision，号放在绑定串前面，截断也截不掉。
      const reattach = bindings.some((binding) => shotIsDetached(landing, binding.shotId));
      const kind = reattach ? `reattach-${expectedRevision}` : "bind";
      // 落节点要等渲染层（真 I/O），这段时间里 Run 常被别的写入推进（批下一张、派发一张）。绑定是幂等的事实写回：
      // 撞上 revision 冲突就按最新的 Run 重写一次——不能把并发写入误判成「没落下」（那几镜会停在 landing_failed
      // 再也不派；#1139 第二轮走查 12 张只发出 9 张）。命令号不随 revision 变，已经写进去的那一份按幂等原样认。
      let revision = expectedRevision;
      for (let attempt = 0; ; attempt += 1) {
        try {
          await deps.command(boundProjectId, boundRunId, {
            commandId: `canvas-landing:${boundRunId}:${kind}:${bindings.map((binding) => `${binding.shotId}=${binding.nodeId}`).join(",")}`.slice(0, 200),
            expectedRevision: revision,
            type: "plan.bind-shot-nodes",
            payload: { bindings },
            issuedAt: new Date().toISOString(),
          });
          return;
        } catch (error) {
          const latest = attempt < 4 && isRevisionConflict(error) ? deps.readRun(boundProjectId, boundRunId) : undefined;
          if (!latest) throw error;
          revision = latest.revision;
        }
      }
    },
  });
  const landOnce = async (projectId: string, runId: string, existingOnly: boolean, reportUnmatched = false): Promise<boolean> => {
    let run: ProductionRun | null | undefined;
    try {
      run = deps.readRun(projectId, runId);
    } catch {
      return false;
    }
    if (!run) return false;
    // 投影（草稿 / 跟随 / 对账）不替用户把文稿来源的计划放到画布上：那是用户点「放到画布」或确认付费那一下的事
    // （后者走 landBeforeDispatch，10-08 拍板「确认即落」）。已经落过的照常对账，免得重开项目把节点晾着。
    // 这道闸在投影上没有旁路：旁路就是「Agent 替你拟了方案」和「Agent 改了你的画布」的区别。
    if (run.origin.sourceDocument && !runHasBeenOnCanvas(run)) return false;
    const signature = signatureOf(run, projectId);
    const landed = await landCanvasForRun(run, {
      ...landingDeps(projectId, run),
      ...(existingOnly ? { existingOnly: true } : {}),
      ...(reportUnmatched ? { reportUnmatched: true } : {}),
    });
    if (landed && signature) projectedSignature.set(runKey(projectId, runId), signature);
    return landed;
  };
  // 已排进队、还没开始的那一次跟随：同一段时间里的多次变化并成一次（开始时摘掉，之后的变化会再排一次）。
  const pendingFollows = new Set<string>();
  const followRunChange = (run: ProductionRun): void => {
    if (!run.generationPlan) return;
    const key = runKey(run.projectId, run.runId);
    if (!runHasBeenOnCanvas(run) || !deps.isProjectOpen(run.projectId)) {
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
      return landOnce(current.projectId, current.runId, true);
    }));
  };
  const landBeforeDispatch = async (projectId: string, runId: string): Promise<void> => {
    // 项目访问租约（#1139 B2）：项目本来就开着 → 租约只看它还开着；没开 → 只在隐藏主窗口里替 Agent 打开（landingProjectAccess）。
    let lease: LandingProjectLease;
    if (deps.isProjectOpen(projectId)) lease = openProjectLease(projectId, () => (deps.isProjectOpen(projectId) ? projectId : null));
    else if (deps.openProjectForLanding) lease = await deps.openProjectForLanding(projectId);
    else throw Object.assign(new Error(`landing_project_not_open: ${projectId}`), { code: "landing_project_not_open" });
    const work = enqueue(runKey(projectId, runId), async () => {
      // 主进程 host 栅栏：排到队之后、请渲染层落地之前再核一次租约（等队期间窗口可能被叫出来、项目可能换了）。
      lease.assertCurrent();
      const run = deps.readRun(projectId, runId);
      if (!run) throw new Error(`Production run not found: ${runId}`);
      const signature = signatureOf(run, projectId);
      // isCurrent 在发 materialize 之前、写回绑定之前各核一次（landCanvasForRunOrThrow）；渲染层自己再按报文里的
      // projectId 核一次它认下的项目（materializeShots 的 binding 栅栏）。
      const landed = await landCanvasForRunOrThrow(run, { ...landingDeps(projectId, run), placeDocumentPlan: true, isCurrent: lease.isCurrent });
      // 写回绑定之后再核一次（第二轮复审遗漏 1）：bind 的 await 期间窗口被叫出来 / 项目换了，这一趟就不算落好——
      // 抛出去，准入点把这几镜记成没落下（这一趟 0 派发、landing_failed）；节点已经在画布上，「继续」时直接认它再派。
      // 租约只管到「落地写完、绑定写回」为止：之后的派发不看窗口状态（节点已经在画布上，生成那一刻 = 落画布那一刻已经成立）。
      lease.assertCurrent();
      if (landed && signature) projectedSignature.set(runKey(projectId, runId), signature);
      return landed;
    });
    track(projectId, work);
    await work;
  };
  const reconcileExistingCanvas = (projectId: string, runId: string): Promise<boolean> => {
    const key = runKey(projectId, runId);
    const work = enqueue(key, async () => {
      let run: ProductionRun | null | undefined;
      try {
        run = deps.readRun(projectId, runId);
      } catch {
        return false;
      }
      if (!run || !runHasBeenOnCanvas(run)) return false;
      projectedSignature.delete(key);
      return landOnce(projectId, runId, true, true);
    });
    track(projectId, work);
    return work;
  };
  const settleLanding = async (projectId: string): Promise<void> => {
    // 等待期间可能又追加了一段（agent 连着改草稿）：等到这条链真的空掉为止。
    let pending = inFlightByProject.get(projectId);
    while (pending) {
      await pending;
      const next = inFlightByProject.get(projectId);
      pending = next === pending ? undefined : next;
    }
  };
  return {
    landBeforeDispatch,
    followRunChange,
    reconcileExistingCanvas,
    landDraftOnCanvas: (projectId, runId) => {
      if (!deps.isProjectOpen(projectId)) return;
      track(projectId, runLanding(projectId, runId));
    },
    draftLandingOutcome: async (projectId, runId) => {
      try {
        await settleLanding(projectId);
        const run = deps.readRun(projectId, runId);
        return run ? draftCanvasLandingOfRun(run, deps.isProjectOpen(projectId)) : undefined;
      } catch {
        return undefined;
      }
    },
    settleCanvasLanding: settleLanding,
  };
}
