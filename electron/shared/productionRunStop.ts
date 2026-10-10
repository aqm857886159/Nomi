// 制作「停着没有、为什么停」的唯一读口（2026-09-29）。
//
// 为什么要它：以前各处从 Run 状态反推停下的原因——`needs_attention` 一律被说成「预算已用完 · 提额续拍」，
// 而今天根本没有价格，点进去额度全是 0（用户实见）。现在原因在停的那一刻由停它的一方写进 `run.status` 命令
// （reducer 落成 `run.stop`），界面、续拍入口只读这里。
//
// 「停着」的状态集也只在这里：认领判据、批次派生、画布小标以前各抄一份。
import type { ProductionRun, ProductionRunStatus, ProductionRunStopReason } from "../productionRun/productionRunTypes";

/** Run 停着：不再派新镜，已经交给供应商的照常收尾。 */
export function isStoppedRunStatus(status: ProductionRunStatus): boolean {
  switch (status) {
    case "pausing":
    case "paused":
    case "needs_attention":
    case "cancelled":
      return true;
    case "draft":
    case "awaiting_direction":
    case "awaiting_script_review":
    case "awaiting_storyboard_review":
    case "awaiting_contract":
    case "ready":
    case "running":
    case "awaiting_rough_cut_review":
    case "awaiting_export":
    case "exporting":
    case "completed":
      return false;
    default:
      return ((value: never) => value)(status);
  }
}

const STOP_REASONS: Readonly<Record<ProductionRunStopReason, true>> = {
  failed: true,
  user_paused: true,
  user_cancelled: true,
  restart_recovery: true,
  consent_expired: true,
  landing_failed: true,
};

/** 命令里带来的原因：只认这张表里的词，别的一律当作没给。 */
export function parseRunStopReason(value: unknown): ProductionRunStopReason | undefined {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(STOP_REASONS, value)
    ? (value as ProductionRunStopReason)
    : undefined;
}

/**
 * 读盘归一（`productionRunRepository.withReadDefaults` 调它）：盘上记的停下原因这一版已经不认识了——上一版的
 * `budget`（2026-10-01 删）——就当作没记原因，读出来是中性的「已停」（`unknown`），绝不再说成「预算已用完」。
 * 只改内存里的投影，不回写盘。
 */
export function normalizeLegacyStopReason<T extends Pick<ProductionRun, "stop">>(run: T): T {
  const reason = (run.stop as { reason?: unknown } | undefined)?.reason;
  if (!run.stop || parseRunStopReason(reason)) return run;
  const { stop: _dropped, ...rest } = run;
  return rest as T;
}

/**
 * 这次制作为什么停着。
 * - 没停：`null`；
 * - 停着、记了原因：那个原因；
 * - 停着、没记（上一版写下的 Run）：`"unknown"`——**绝不猜成预算**。
 */
export function runStopReason(run: Pick<ProductionRun, "status" | "stop">): ProductionRunStopReason | "unknown" | null {
  if (!isStoppedRunStatus(run.status)) return null;
  return run.stop?.reason ?? "unknown";
}
