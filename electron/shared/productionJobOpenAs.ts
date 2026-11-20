// 一笔作业没收尾时算哪一种：「还在路上」还是「可能已扣钱、结果不明」。**唯一一张表**。
//
// 以前主进程里两份手抄的状态清单各判各的（`decideShotClaim` 的两个 Set、画布单镜的 `blockingReason`），
// 新长一个状态要记得改两处；渲染层放行「结果未知」时又自己列了一遍。现在都读这一张：
// `Record<ProductionJobStatus, …>` 让编译器拦——新状态没表态，类型检查当场红。
//
// 这张表只回答「没收尾的算哪种」。「供应商到底收没收下」按证据判，住 `productionSubmissionActions`，不在这里。
import type { ProductionJobStatus } from "../productionRun/productionRunTypes";

export type ProductionJobOpenAs = "in_flight" | "needs_reconcile";

const OPEN_AS: Readonly<Record<ProductionJobStatus, ProductionJobOpenAs | null>> = {
  planned: null,
  authorization_required: null,
  authorized: null,
  submit_intent_persisted: "in_flight",
  submitting: "in_flight",
  provider_accepted: "in_flight",
  polling: "in_flight",
  retry_wait: "in_flight",
  downloading: "in_flight",
  validating_technical: "in_flight",
  validating_content: "in_flight",
  ready: null,
  adopted: null,
  submission_unknown: "needs_reconcile",
  reconciling: "needs_reconcile",
  needs_attention: null,
  cancel_requested: null,
  cancelled_remote: null,
  detached: null,
  too_late: null,
};

/** 这笔作业没收尾时算哪一种；null = 已收尾或还没发（不占节点）。 */
export function productionJobOpenAs(status: ProductionJobStatus): ProductionJobOpenAs | null {
  return OPEN_AS[status] ?? null;
}
