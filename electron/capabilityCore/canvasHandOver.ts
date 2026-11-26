// 「把 Agent 那一次出价里的几镜交给画布」的主进程编排（D2 第③步：一台发动机）。
//
// ── 它在解决哪个真实摩擦 ──
//
// 以前面板付费卡和画布各有一台发动机：卡上点「生成」走制作流程自己的付费门 + 调度器，节点上点 ↑ 走画布单节点提交。
// 同一镜两条路，参数、并发、失败话术、收据各写一遍，卡上的参数编辑器还得把画布节点的生成框再搭一遍（两份参数）。
// 现在卡上点「生成」（手势）与「直接生成」档的策略都只做一件事：把这几镜交给画布，逐镜走画布单节点提交那一条路。
//
// ── 四步，只有第一步是决定 ──
//
//   ① 出价上记一笔交接（`generation.handover`，只有主进程写得出：渲染层的命令白名单里没有它）；
//   ② 还没落到画布上的先落（唯一准入点的落地器，和制作流程同一个）；
//   ③ 请渲染层按画布批量那一条路为每一镜开出同意（`production.hand-over-shots` → `consentCanvasShots` 带 production →
//      主进程把画布 Run 号绑到交接上）并开跑——只等同意开好，不等生成；
//   ④ 渲染层回话之后（或没回话），还没绑上的那几镜当场记成没发出去，原因照它说的（节点不在 / 本机判定发不出去 /
//      素材托管要先问人 / 窗口没了）。
// 之后每一镜的结局由画布那一侧写回（`appIntegrationCanvasShot` 的 settle），这里不再写。策略那一档还要等结局落定：
// 回合据此说「都交出去了」还是把卡退回给人（`waitForSettlement`）。
import { logWarn } from "../logging/logger";
import type { GenerationHandOverFailure, ProductionRun, RunCommand } from "../productionRun/productionRunTypes";
import { admitShotsForDispatch, landedNodeOf, type LandShotsOnCanvas } from "../productionRun/shotLandingAdmission";
import { currentPresentation, offerShots, type OfferShot } from "../shared/productionGenerationPresentation";
import { HAND_OVER_SHOTS_OP, type HandOverShotsReply, type HandOverShotsRequest } from "../shared/contracts/canvasHandOver";

/** 渲染层开同意那一步最多等多久（它只读节点、问素材托管、开同意，不等生成）。 */
export const HAND_OVER_RENDERER_TIMEOUT_MS = 30_000;
/** 策略那一档等交出去的每一镜落定（交到 / 没发出去）最多等多久；过了还在交的照「在交」算。 */
export const POLICY_SETTLEMENT_TIMEOUT_MS = 120_000;

type CanvasHandOverInput = Readonly<{
  projectId: string;
  runId: string;
  shotIds: readonly string[];
  by: "gesture" | "policy";
  /** 卡上摆过素材托管的披露、用户点的就是「生成」（手势那一档）。策略那一档恒 false：托管要问人，策略不代答。 */
}>;

/** 交出去的每一镜此刻的样子（只看这一次出价）。 */
type CanvasHandOverOutcome = Readonly<{
  /** 交到了供应商手里。 */
  accepted: readonly string[];
  /** 还在交（绑上了画布、派发还没结论）。 */
  pending: readonly string[];
  /** 没交到：没发出去 / 结果未知 / 被收回。 */
  failed: readonly string[];
}>;

type CanvasHandOverDeps = Readonly<{
  runs: Readonly<{
    read(projectId: string, runId: string): ProductionRun | null;
    execute(projectId: string, runId: string, command: RunCommand): unknown;
  }>;
  landShots: LandShotsOnCanvas;
  requestRenderer: (op: string, payload: unknown, timeoutMs: number) => Promise<unknown>;
  /** Run 账本的变更订阅（生产里是 `subscribeProductionRunChanges`）：策略那一档据此等交接落定。 */
  subscribe: (listener: (run: ProductionRun) => void) => () => void;
  now?: () => string;
}>;

function failureCodeOf(error: unknown): string {
  const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : undefined;
  if (code && /^[a-z][a-z0-9_]{2,63}$/.test(code)) return code;
  return error instanceof Error && error.name === "RendererUnavailableError" ? "renderer_unavailable" : "canvas_hand_over_failed";
}

function replyOf(value: unknown): HandOverShotsReply {
  const skipped = value && typeof value === "object" && Array.isArray((value as { skipped?: unknown }).skipped) ? (value as { skipped: unknown[] }).skipped : [];
  return {
    skipped: skipped.flatMap((entry) => {
      const record = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
      const failure = record.failure && typeof record.failure === "object" ? record.failure as Record<string, unknown> : {};
      const code = typeof failure.code === "string" && /^[a-z][a-z0-9_]{2,63}$/.test(failure.code) ? failure.code : "canvas_not_consented";
      return typeof record.shotId === "string" && record.shotId
        ? [{ shotId: record.shotId, failure: { kind: failure.kind === "parameter_rejected" ? "parameter_rejected" as const : "not_sent" as const, code } }]
        : [];
    }),
  };
}

function outcomeOf(shots: readonly OfferShot[], shotIds: readonly string[]): CanvasHandOverOutcome {
  const of = (predicate: (shot: OfferShot) => boolean) => shots.filter((shot) => shotIds.includes(shot.shotId) && predicate(shot)).map((shot) => shot.shotId);
  return {
    accepted: of((shot) => shot.state === "sent" || shot.state === "taken_by_canvas"),
    pending: of((shot) => shot.state === "handing_over"),
    failed: of((shot) => shot.state === "not_sent" || shot.state === "unknown" || shot.state === "undecided" || shot.state === "removed"),
  };
}

export function createCanvasHandOver(deps: CanvasHandOverDeps) {
  const now = deps.now ?? (() => new Date().toISOString());

  /** 对制作 Run 落一条命令（revision 冲突重读一次再来）。`build` 回 null = 不用写了。 */
  function executeOn(projectId: string, runId: string, build: (current: ProductionRun) => Omit<RunCommand, "expectedRevision"> | null): ProductionRun {
    for (let attempt = 0; ; attempt += 1) {
      const current = deps.runs.read(projectId, runId);
      if (!current) throw Object.assign(new Error(`generation_operation_not_found: ${runId}`), { code: "generation_operation_not_found" });
      const command = build(current);
      if (!command) return current;
      try {
        deps.runs.execute(projectId, runId, { ...command, expectedRevision: current.revision });
        return current;
      } catch (error) {
        if (attempt === 1 || !/revision conflict/i.test(error instanceof Error ? error.message : String(error))) throw error;
      }
    }
  }

  /** 还没绑上画布那一份同意的那几镜：当场记成没发出去（一下都没交）。 */
  function settleUnbound(before: ProductionRun, failures: ReadonlyMap<string, GenerationHandOverFailure>, fallback: GenerationHandOverFailure, shotIds: readonly string[]): void {
    const { projectId, runId, generationPlan } = before;
    const presentationCount = generationPlan?.presentations?.length;
    const firstEntry = currentPresentation(generationPlan)?.handOvers?.length ?? 0;
    for (const [offset, shotId] of shotIds.entries()) {
      const entry = firstEntry + offset;
      try {
        executeOn(projectId, runId, (current) => {
          // A late renderer reply belongs to the entries this dispatch appended, including across retries.
          if (current.generationPlan?.presentations?.length !== presentationCount) return null;
          const handOver = currentPresentation(current.generationPlan)?.handOvers?.[entry];
          if (!handOver || handOver.shotId !== shotId || handOver.settled || handOver.canvasRunId) return null;
          return {
            commandId: `generation.handover.unbound:${runId}:${presentationCount}:${entry}`,
            type: "generation.handover.settle",
            payload: { shotId, outcome: "not_sent", failure: failures.get(shotId) ?? fallback },
            issuedAt: now(),
          };
        });
      } catch (error) {
        logWarn("production-run", "canvas-hand-over-unbound-settle-failed", { runId }, error);
      }
    }
  }

  /**
   * 把这几镜交给画布（见文件头四步）。第①步不成就抛（卡上的内容刚变了 / 出价关了）：什么都没记、什么都没交。
   * 之后的每一步失败都不抛：落成那几镜「没发出去」，卡上照实说。返回时每一镜要么绑上了画布、要么已经落定。
   */
  async function handOver(input: CanvasHandOverInput): Promise<void> {
    const { projectId, runId } = input;
    const shotIds = [...new Set(input.shotIds)];
    const before = executeOn(projectId, runId, (current) => {
      const presentation = currentPresentation(current.generationPlan);
      return {
        commandId: `generation.handover:${runId}:${presentation?.presentationId ?? "none"}:${presentation?.handOvers?.length ?? 0}:${shotIds.join(",")}`.slice(0, 480),
        type: "generation.handover",
        payload: { shotIds, by: input.by },
        issuedAt: now(),
      };
    });
    const failures = new Map<string, GenerationHandOverFailure>();
    let fallback: GenerationHandOverFailure = { kind: "not_sent", code: "canvas_not_consented" };
    try {
      // ② 先落节点、再交（与制作流程同一个准入点；出价里的镜号就是落地地址，单镜 = 顶层候选 id）。落不下来的那几镜不交。
      const landing = await admitShotsForDispatch({ repository: deps.runs, land: deps.landShots, projectId, runId, shotIds });
      for (const shotId of landing.unlanded) failures.set(shotId, { kind: "not_sent", code: landing.landingFailure?.code ?? "canvas_landing_failed" });
      const run = deps.runs.read(projectId, runId);
      const targets = run ? shotIds.flatMap((shotId) => {
        const nodeId = failures.has(shotId) ? undefined : landedNodeOf(run, shotId);
        return nodeId ? [{ shotId, nodeId }] : [];
      }) : [];
      // ③ 渲染层按画布批量那一条路开同意（绑交接）并开跑；只等同意开好。
      if (targets.length > 0) {
        const request: HandOverShotsRequest = { projectId, runId, shots: targets };
        const reply = replyOf(await deps.requestRenderer(HAND_OVER_SHOTS_OP, request, HAND_OVER_RENDERER_TIMEOUT_MS));
        for (const skipped of reply.skipped ?? []) failures.set(skipped.shotId, skipped.failure);
      }
    } catch (error) {
      fallback = { kind: "not_sent", code: failureCodeOf(error) };
      logWarn("production-run", "canvas-hand-over-renderer-failed", { runId, code: fallback.code }, error);
    }
    // ④ 还没绑上的当场收尾。
    settleUnbound(before, failures, fallback, shotIds);
  }

  /** 交出去的这几镜此刻的样子（只看这一次出价）。读不到 Run = 全算没交到。 */
  function outcome(projectId: string, runId: string, shotIds: readonly string[]): CanvasHandOverOutcome {
    const run = deps.runs.read(projectId, runId);
    return run ? outcomeOf(offerShots(run), shotIds) : { accepted: [], pending: [], failed: [...shotIds] };
  }

  /**
   * 等这几镜都落定（交到 / 没交到）或等满 `timeoutMs`；`signal` 断了就不等了（回合被停：交出去的照常交完，结局照账本说）。
   * 订阅与读都是同步的，中间插不进一次账本写入。
   */
  function waitForSettlement(projectId: string, runId: string, shotIds: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<CanvasHandOverOutcome> {
    return new Promise((resolve) => {
      let done = false;
      let unsubscribe: () => void = () => undefined;
      const finish = (): void => {
        if (done) return;
        done = true;
        unsubscribe();
        clearTimeout(timer);
        signal?.removeEventListener("abort", finish);
        resolve(outcome(projectId, runId, shotIds));
      };
      // 先起计时器再订阅：订阅那一刻就可能同步回调到 finish，那时计时器已经在了。
      const timer = setTimeout(finish, timeoutMs);
      const check = (): void => { if (outcome(projectId, runId, shotIds).pending.length === 0) finish(); };
      unsubscribe = deps.subscribe((run) => { if (run.projectId === projectId && run.runId === runId) check(); });
      signal?.addEventListener("abort", finish, { once: true });
      check();
    });
  }

  return { handOver, outcome, waitForSettlement };
}

export type CanvasHandOver = ReturnType<typeof createCanvasHandOver>;
