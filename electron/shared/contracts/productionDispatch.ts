// 「这一笔生成，用户点过头、真的交给执行了没有」——唯一的判据（2026-09-24）。
//
// 为什么要有它：Agent 按「先别生成」建的草稿（`draft_shots`）落到画布上以后，节点写着「排队中 · 第 1/1」、
// 右上角任务按钮亮着 1。盘上实查：Run 是 draft、0 个 job、0 道门、账本 0、供应商 0 次请求。
// 每个界面各自拿一个代理量猜「在不在排队」——占位节点猜「没有 job = 还没轮到」，任务中心猜
// 「没终止 = 在跑」——于是一份还没点头的草稿被说成了在排队花钱。真相其实早就在：
// 调度器那句「authorization_required is still waiting for a human」，和计划的 `submitted`。
// 这里把它收成一份，三个进程侧的消费者都读它（占位节点 / 任务中心 / 调度器）。
//
// 住在中立契约层：主进程（Run 摘要、调度器）和渲染层（画布节点）都要问这一句，渲染层不许 import
// `electron/productionRun/` 的实现（`check:boundaries`）。
import type { ProductionJobStatus, ProductionRun } from "../../productionRun/productionRunTypes";

/** 还在等人点头的 job：它们存在，但还没有任何供应商那边的工作。 */
const AWAITING_HUMAN: ReadonlySet<ProductionJobStatus> = new Set<ProductionJobStatus>(["planned", "authorization_required"]);

/** 已经落定的 job：成了 / 失败待处理 / 撤掉 / 太迟。它们证明「派出过」，不证明「现在还在跑」。 */
const SETTLED: ReadonlySet<ProductionJobStatus> = new Set<ProductionJobStatus>([
  "ready", "adopted", "needs_attention", "cancelled_remote", "detached", "too_late",
]);

/** 这个 job 是不是还停在人工门前（用户还没点头）。 */
export function jobAwaitsHuman(status: ProductionJobStatus): boolean {
  return AWAITING_HUMAN.has(status);
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
  return run.jobs.some((job) => !AWAITING_HUMAN.has(job.status) && !SETTLED.has(job.status));
}

/**
 * 这个画布节点对应的镜，在已经交给执行的范围里吗。给**还没有 job** 的节点用：
 * 在范围里 = 真的在排队（批次会自己轮到它）；不在 = 用户还没点头，或者这镜没被勾进这一批。
 *
 * 多镜计划按 `shots[].nodeId` 找镜、看 `included`；单镜计划按顶层 `nodeId`。
 */
export function isNodeInDispatchedScope(run: Pick<ProductionRun, "generationPlan">, nodeId: string): boolean {
  const plan = run.generationPlan;
  if (!plan || plan.state !== "submitted") return false;
  if (!plan.shots?.length) return plan.nodeId === nodeId;
  const shot = plan.shots.find((candidate) => candidate.nodeId === nodeId);
  return Boolean(shot && shot.included !== false);
}
