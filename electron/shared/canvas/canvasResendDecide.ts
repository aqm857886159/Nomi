// 「失败后再发一次」这一问的两端形状：出口报意图和身份，主进程回它的判定（问 / 拒 / 照常发）。

/**
 * `production`：这个节点绑着的那一镜在哪个制作 Run（只是身份，作业和状态主进程自己读）；任务中心没有节点时带 `jobId`。
 * `resultUnknown`：出口看到的失败说结果不明——只能把卡上的话往更谨慎那边推，不能免掉问人。
 */
export type CanvasResendDecidePayload = {
  projectId: string;
  nodeId?: string;
  resend: boolean;
  initiator: string;
  resultUnknown?: boolean;
  production?: { runId: string; jobId?: string };
};

/** 主进程这一刻读到的这个节点没收尾的那几笔（和 canvas-open-runs 同一形状）：渲染层只拿来同步节点显示，不当许可。 */
export type CanvasOpenRunEntry = { runId: string; jobId?: string; reason: "in_flight" | "needs_reconcile"; hasTaskId: boolean; nodeId: string };

export type CanvasResendDecision =
  | { action: "send" }
  | { action: "refuse"; code: "node_generation_in_flight" }
  /**
   * 问人；人确认后只放行 `release` 列出的那几笔、带着号去提交。
   * `open` 只供同步节点显示：渲染层不许拿它算放行或要不要再问（放行只认号和 `release`）。
   */
  | { action: "ask"; decisionId: string; resultUnknown: boolean; release: Array<{ runId: string; jobId: string }>; readonly open: ReadonlyArray<Readonly<CanvasOpenRunEntry>> };
