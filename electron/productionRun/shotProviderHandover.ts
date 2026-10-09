// 「生成剩下 N 张」一张一张交：上一张真的交到供应商手里（供应商受理）了，才批下一张（协调会话 10-09 拍板 B）。
//
// 为什么：× 是「停住还没交出去的那几张」。批准本身只是几次写盘，一口气就批完了——× 到达时剩下的早都批了，
// 等于 × 说了假话；卡上「正在发出 k/N」也不是真话（批了 ≠ 交了）。所以批内只等**受理**，不等生成完：
// 受理之后各张照常并行生成，每张多等的只是一次受理（通常几秒）。
//
// 这里只回答一件事：批过的这一镜，现在交到哪一步了。读的是耐久 Run（唯一真相），不另记状态。
import type { ProductionRun } from "./productionRunTypes";
import { isStoppedRunStatus } from "../shared/productionRunStop";
import { isUnsubmittedJobStatus, latestJobForShot } from "../shared/productionShotJobs";

export type ShotHandover =
  /** 供应商受理了（拿到了任务号）：可以批下一张。 */
  | "accepted"
  /** 交的那一下有了结论但没受理（当场被拒 / 没出门 / 结果未知要核对）：这一张交完了，照常往下批。 */
  | "settled_without_acceptance"
  /** 批了却没派出去，而且也不会再自己派了（Run 停了：急停 / 落地失败 / 同意过期）：这一批停在这里。 */
  | "not_dispatched"
  /** 等太久（派发迟迟没开始，或交的那一下一直没结论）：不再干等，这一批停在这里，如实说。 */
  | "timed_out";

type Phase = "waiting_dispatch" | "submitting" | Exclude<ShotHandover, "timed_out">;

/** 这一镜此刻交到哪一步（只读耐久 Run）。 */
export function shotHandoverPhase(run: ProductionRun | null, shotId: string | undefined): Phase {
  if (!run) return "not_dispatched";
  const job = shotId ? latestJobForShot(run, shotId) : run.jobs.at(-1);
  if (!job || isUnsubmittedJobStatus(job.status)) {
    // 还没开始交：Run 停着就不会再派了（派生对停着的 Run 不派新活）。
    return isStoppedRunStatus(run.status) ? "not_dispatched" : "waiting_dispatch";
  }
  // 交的那一下正在进行：停下也不打断它（钱可能已经花出去），等它有结论。
  if (job.status === "submit_intent_persisted" || job.status === "submitting") return "submitting";
  return job.providerTaskId ? "accepted" : "settled_without_acceptance";
}

export type AwaitShotHandoverOptions = Readonly<{
  readRun: () => ProductionRun | null;
  shotId: string | undefined;
  /** 批了以后迟迟没开始交（调度器没接上）最多等多久。 */
  dispatchStartLimitMs?: number;
  /** 交的那一下最多等多久才有结论。供应商自己的提交超时会先到；这只是兜底，不让卡永远「正在发出」。 */
  handoverLimitMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}>;

const DISPATCH_START_LIMIT_MS = 30_000;
const HANDOVER_LIMIT_MS = 300_000;
const POLL_MS = 100;

/** 等批过的这一镜交到供应商手里（或确定交不出去）。 */
export async function awaitShotHandover(options: AwaitShotHandoverOptions): Promise<ShotHandover> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = now();
  for (;;) {
    const phase = shotHandoverPhase(options.readRun(), options.shotId);
    if (phase !== "waiting_dispatch" && phase !== "submitting") return phase;
    const waited = now() - started;
    if (phase === "waiting_dispatch" && waited >= (options.dispatchStartLimitMs ?? DISPATCH_START_LIMIT_MS)) return "timed_out";
    if (waited >= (options.handoverLimitMs ?? HANDOVER_LIMIT_MS)) return "timed_out";
    await sleep(options.pollMs ?? POLL_MS);
  }
}
