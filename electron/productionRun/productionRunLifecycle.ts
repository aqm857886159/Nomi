// 制作 Run 生命周期的唯一 owner（2026-09-29）。三件事，都只住在这里：
//
//   ① 「为什么停」的唯一写口 `applyRunStatus`：`run.status` 命令把 Run 挪进停着的状态（pausing / paused /
//      needs_attention / cancelled）时，停它的一方必须在 `payload.reason` 里说原因，这里落成 `run.stop`；停着之间
//      的挪动（pausing → paused）沿用原来的原因；离开停着的状态就清掉。以前谁都不说，界面只好从 needs_attention
//      反推——于是一律说成「预算已用完 · 提额续拍」。读口只有一个：electron/shared/productionRunStop.ts 的 runStopReason。
//
//   ② 生命周期里唯一「自己发生」的一步 `settleRunLifecycle`：急停（pausing）之后，交给供应商的最后一件活收了尾，
//      Run 就落成 paused。它挂在仓库写入口上（productionRunRepository.executeUnlocked 每条命令之后判一次），不住在
//      任何驱动里——老驱动、多镜调度器、观察器、重开项目的恢复，谁让最后一件活收尾都一样，没有哪个驱动需要记得去调它。
//      以前是每个驱动各自在自己的循环尾巴上调 settlePauseIfQuiet；多镜调度器没调，批次急停后永远停在「暂停中」。
//
//   ③ 用户重做一镜时，哪些停下的原因随之解除 `retryLiftsStop`（穷举，新原因不表态类型检查就红）。
//
//   ④ 这个 Run 现在要不要有人驱动 `runWantsDriver`（2026-10-07）：停只是「不再派新的」，已经交给供应商、钱已花出的
//      那几件必须有人盯到收尾、把产物落进项目。以前「过一会儿再踢」、单镜「再问一次」、重开项目各按 Run 状态挑——
//      已暂停 / 已取消一律不管（#934 只给「暂停中」开了口子），于是取消后的慢镜头、已暂停里点「重新取回」的那一镜
//      钱花了、片出了，没人去取。现在三处都只问这里；派不派新活仍由调度派生按 Run 状态判，这里不管。
import type { ProductionCommandEffect } from "./productionRunReducer";
import type { ProductionRun, ProductionRunStatus, ProductionRunStopReason, RunCommand } from "./productionRunTypes";
import { transitionRun } from "./productionRunState";
import { isStoppedRunStatus, parseRunStopReason } from "../shared/productionRunStop";
import { isProductionJobInFlight, productionJobPhase } from "../shared/productionShotPhase";

function moveRun(current: ProductionRun, status: ProductionRunStatus, said: ProductionRunStopReason | undefined, now: string): ProductionCommandEffect {
  const next = transitionRun(current, status, now);
  if (!isStoppedRunStatus(status)) {
    const { stop: _previousStop, ...moving } = next;
    return { run: moving, eventType: "run.status.changed", message: status };
  }
  if (said) return { run: { ...next, stop: { reason: said, at: now } }, eventType: "run.status.changed", message: status };
  // 新停下必须说原因。停着之间的挪动（pausing → paused）沿用原来记下的那一个；上一版停下时没记的，照旧没记
  // （读作 unknown）——这里不替它编一个。
  if (!isStoppedRunStatus(current.status)) throw new Error(`run.status ${status} needs a stop reason (payload.reason)`);
  return { run: next, eventType: "run.status.changed", message: status };
}

/** `run.status` 命令的 reducer（productionRunReducer 转进来）。 */
export function applyRunStatus(current: ProductionRun, command: RunCommand, now: string): ProductionCommandEffect {
  const raw = command.payload.status;
  if (typeof raw !== "string" || !raw.trim()) throw new Error("Missing status");
  return moveRun(current, raw.trim() as ProductionRunStatus, parseRunStopReason(command.payload.reason), now);
}

/** 交给供应商、还在跑的那件活：钱已花出、收不回，只能等它收尾。与画布上「生成中」是同一个判据（productionJobPhase）。 */
export function isStillAtProvider(job: Pick<ProductionRun["jobs"][number], "status">): boolean {
  return productionJobPhase(job.status) === "generating";
}

/** 交给了供应商、拿着任务号还能去问的那几件（钱已花出，结论还没回来）。 */
export function hasWorkToWatch(run: Pick<ProductionRun, "jobs">): boolean {
  return run.jobs.some(isProductionJobInFlight);
}

/** 停稳了的 Run：不再派新活，也不会自己往前走。 */
const AT_REST: ReadonlySet<ProductionRunStatus> = new Set(["paused", "cancelled", "completed"]);

/**
 * 这个 Run 现在要不要有人驱动（批次调度器的重踢、重开项目、启动恢复 resumeUnfinishedRuns 都只问这里）。
 * 没停稳的要；停稳了的（已暂停 / 已取消 / 已完成）只在手上还有交给供应商、还没结论的活时要——只盯不派。
 * 「还没结论」按 isStillAtProvider 算（含还没拿到任务号的「提交中」：启动恢复要把它如实标成结果待核对）；
 * 能不能真去问供应商是另一回事，归 hasWorkToWatch。
 */
export function runWantsDriver(run: Pick<ProductionRun, "status" | "jobs">): boolean {
  return !AT_REST.has(run.status) || run.jobs.some(isStillAtProvider);
}

/**
 * 这一刻 Run 欠不欠一步生命周期收尾；欠就给出那一步（与命令同一次写入落盘）。
 * 今天只有一种：急停（pausing）而手上已经没有交给供应商的活 → paused（原因沿用急停时记下的）。
 */
export function settleRunLifecycle(run: ProductionRun, now: string): ProductionCommandEffect | null {
  if (run.status !== "pausing" || run.jobs.some(isStillAtProvider)) return null;
  return moveRun(run, "paused", undefined, now);
}

/**
 * `run.lifecycle.settle` 命令：把这一刻欠下的那一步补上。只给重开项目时的恢复用——上一版把多镜批次急停后留在
 * pausing、手上已经没有在跑的活，没有任何命令会再来经过写入口。不欠却发了它 = 调用方没先问 settleRunLifecycle。
 */
export function applyOwedLifecycleStep(current: ProductionRun, now: string): ProductionCommandEffect {
  const step = settleRunLifecycle(current, now);
  if (!step) throw new Error(`Production run ${current.runId} owes no lifecycle step`);
  return step;
}

/**
 * 用户重做一镜（新授权的一次尝试）时，这次停下能不能随之解除——解除了，停着的批次才会把这一镜派出去。
 * - `failed`：停就是因为有镜头没成，重做正是在处理它；
 * - `unknown`：上一版停下时没记原因。解除是安全的：新这一镜有自己的授权，其余镜头派不派仍各看批它的那一份；
 * - `consent_expired`：重做这一镜就是一次新的点头，它自己派得出去；别的镜同意仍过期，派到它们时会如实再停；
 * - `landing_failed`：没落上画布、没发请求；再来一次就是重落再派，落不下来会如实再停；
 * - `user_paused` / `user_cancelled`：用户自己停的，重做一镜不替他改主意；
 * - `restart_recovery`：要先核对重启前在跑的任务。
 */
export function retryLiftsStop(reason: ProductionRunStopReason | "unknown"): boolean {
  switch (reason) {
    case "failed":
    case "unknown":
    case "consent_expired":
    case "landing_failed":
      return true;
    case "user_paused":
    case "user_cancelled":
    case "restart_recovery":
      return false;
    default:
      return ((value: never) => value)(reason);
  }
}
