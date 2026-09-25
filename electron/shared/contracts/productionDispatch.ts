// 「这一笔生成，用户点过头、真的交给执行了没有」——唯一的判据（2026-09-24）。
//
// 为什么要有它：Agent 按「先别生成」建的草稿（`draft_shots`）落到画布上以后，节点写着「排队中 · 第 1/1」、
// 右上角任务按钮亮着 1。盘上实查：Run 是 draft、0 个 job、0 道门、账本 0、供应商 0 次请求。
// 每个界面各自拿一个代理量猜「在不在排队」——占位节点猜「没有 job = 还没轮到」，任务中心猜
// 「没终止 = 在跑」——于是一份还没点头的草稿被说成了在排队花钱。真相其实早就在：
// 调度器那句「authorization_required is still waiting for a human」，和计划的 `submitted`。
// 这里把它收成一份：「一镜在哪一段」（`electron/shared/productionShotPhase.ts`）、任务中心、任务卡、Run 摘要、调度器都读它。
//
// 住在中立契约层：主进程（Run 摘要、调度器）和渲染层（画布节点）都要问这一句，渲染层不许 import
// `electron/productionRun/` 的实现（`check:boundaries`）。
import type { ProductionJobStatus, ProductionRun } from "../../productionRun/productionRunTypes";

/**
 * 每个 job 状态在「派出去了没有」这件事上归哪一档。写成 `Record<ProductionJobStatus, …>` 是为了让编译器拦：
 * 状态机里新长一个状态而这里没归档，类型检查当场红——不会静默落进「在跑」那一档（R17）。
 * - `awaiting_human`：job 存在，但还停在人工门前，供应商那边什么都没发生；
 * - `live`：过了人工门、还没落定（在排队 / 在提交 / 供应商在跑 / 在对账）；
 * - `settled`：已落定（成了 / 失败待处理 / 撤掉 / 太迟）——证明「派出过」，不证明「现在还在跑」。
 */
export const JOB_DISPATCH_PHASE: Readonly<Record<ProductionJobStatus, "awaiting_human" | "live" | "settled">> = {
  planned: "awaiting_human",
  authorization_required: "awaiting_human",
  authorized: "live",
  submit_intent_persisted: "live",
  submitting: "live",
  provider_accepted: "live",
  polling: "live",
  retry_wait: "live",
  downloading: "live",
  validating_technical: "live",
  validating_content: "live",
  submission_unknown: "live",
  reconciling: "live",
  cancel_requested: "live",
  ready: "settled",
  adopted: "settled",
  needs_attention: "settled",
  cancelled_remote: "settled",
  detached: "settled",
  too_late: "settled",
};

/** 这个 job 是不是还停在人工门前（用户还没点头）。 */
export function jobAwaitsHuman(status: ProductionJobStatus): boolean {
  return JOB_DISPATCH_PHASE[status] === "awaiting_human";
}

/**
 * 这一轮请求用户点过头、已经交给执行了吗。
 *
 * 两个事实任一成立即是：计划已 `submitted`；或者有一个 job 已经过了人工门、还没落定
 * （单镜在「批准 → 供应商受理」之间 Run 仍是 draft，那一段靠这一条认出来）。
 * 上一批留下的已落定 job 不算——同一份计划重新出价后（`presentGenerationPlan` 把 Run 放回 draft），
 * 那份新请求在用户点头之前仍然是「没派出」。
 */
export function isCurrentRequestDispatched(run: Pick<ProductionRun, "generationPlan" | "jobs">): boolean {
  if (run.generationPlan?.state === "submitted") return true;
  return run.jobs.some((job) => JOB_DISPATCH_PHASE[job.status] === "live");
}

/**
 * 这一镜在已经交给执行的范围里吗。给**还没有 job** 的镜用：
 * 在范围里 = 真的在排队（批次会自己轮到它）；不在 = 用户还没点头（草稿 / 报价卡在等 / 没点头就取消），
 * 或者这镜没被勾进这一批。单镜计划只有一镜（调用方已按候选 id 认过），计划提交了就在；多镜看 `included`。
 */
export function isShotInDispatchedScope(run: Pick<ProductionRun, "generationPlan">, shotId: string): boolean {
  const plan = run.generationPlan;
  if (!plan || plan.state !== "submitted") return false;
  if (!plan.shots?.length) return true;
  const shot = plan.shots.find((candidate) => candidate.shotId === shotId);
  return Boolean(shot && shot.included !== false);
}
