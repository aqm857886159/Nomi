/**
 * P4 — 多镜批 scheduler 的晚绑定重踢插槽（§3.2 检查点审批入口修复）。
 *
 * 为什么要一个插槽：anchor_checkpoint 决议后必须有人重踢批次 scheduler（生产不设 anchorAutoReleaseMs，
 * 门决了批次不会自己醒）。重踢的正确层级是 productionRunService 的 post-decide 钩子——freeze/sample/shot
 * 门的 driveGeneration 重踢都住在那里，任何入口（MCP dispatcher / 渲染层 IPC / 未来的检查点卡）的
 * gate.decide 都经 service.command，钩子统一触发，「入口忘了踢」整族消失。但 scheduler 的构造依赖
 * appIntegration 的 provider/submission 接线（service 层够不着），而 service 单例可能先于
 * startCapabilityCore 创建 → 构造期注入不可行，只能晚绑定。appIntegration 在 kickSchedulerForRun
 * 定义处注册进来（与它自有的模块级 hook slot 同 idiom）。
 */

import { logWarn } from "../logging/logger";

type BatchSchedulerKicker = (projectId: string, runId: string) => void;

let registered: BatchSchedulerKicker | null = null;

/** appIntegration 启动时注册真 kicker；测试注册桩后用 null 还原。 */
export function registerBatchSchedulerKicker(kicker: BatchSchedulerKicker | null): void {
  registered = kicker;
}

/**
 * 给该 Run 的批次 scheduler 一个 tick（best-effort：未注册 = 静默跳过，异常只 warn 不上抛——
 * 决议本身已 durable 落库，错过的 tick 由打开项目时的 reconcile 钩子补上）。
 */
export function kickBatchSchedulerForRun(projectId: string, runId: string): void {
  if (!registered) return;
  try {
    registered(projectId, runId);
  } catch (error) {
    logWarn("production-run", "batch-scheduler-kick-failed", undefined, error);
  }
}
