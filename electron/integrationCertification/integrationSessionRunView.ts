import { isTerminalAdapterStage } from "../providerAdapter/store";
import type { AdapterModeState } from "../providerAdapter/types";
import type { CanonicalHttpCertificationRun, ConnectionCertificationService } from "./service";

/**
 * 会话读到的**逐模型结论**。
 *
 * 2026-09-11 真机实证：6 个文本模型一起验证时整批卡死，`session.read` 只给得出一个
 * `blockingReason.code`（粗码），每个模型到底是 401 还是 404 还是超时——盘上有（run 的
 * `models[].modes[].error/httpStatus`），会话面上没有。驱动 Agent 和用户都只能重启试运气。
 * 这里把已经存在的那份原文投影到会话面上，不新造第二份真相。
 */
export type IntegrationModelResult = {
  modelKey: string;
  taskKind: string;
  state: AdapterModeState;
  attempts: number;
  stage?: string;
  /** 供应商回的原文（已脱敏），失败时才有。 */
  error?: string;
  httpStatus?: number;
  errorCategory?: string;
  reasonCode?: string;
  verifiedAt?: string;
};

/**
 * 会话面上的逐模型结论。`certification.get` 在测试替身里可能没实现，这里按能力判断——
 * 投影是只读路径，拿不到 run 就当没有，绝不因为看一眼状态把 `session.read` 弄崩。
 */
export function sessionModelResults(
  certification: Pick<ConnectionCertificationService, "get"> | undefined,
  session: { kind: string; childRunRef?: { runId: string } },
): IntegrationModelResult[] {
  if (session.kind !== "http-api-provider" || !session.childRunRef) return [];
  if (typeof certification?.get !== "function") return [];
  return modelResultsFromRun(certification.get(session.childRunRef.runId));
}

export function modelResultsFromRun(run: CanonicalHttpCertificationRun | undefined): IntegrationModelResult[] {
  if (!run?.models?.length) return [];
  return run.models.flatMap((model) =>
    model.modes.map((mode) => ({
      modelKey: model.modelKey,
      taskKind: mode.taskKind,
      state: mode.state,
      attempts: mode.attempts,
      ...(mode.stage ? { stage: mode.stage } : {}),
      ...(mode.error ? { error: mode.error } : {}),
      ...(mode.httpStatus ? { httpStatus: mode.httpStatus } : {}),
      ...(mode.errorCategory ? { errorCategory: mode.errorCategory } : {}),
      ...(mode.reasonCode ? { reasonCode: mode.reasonCode } : {}),
      ...(mode.verifiedAt ? { verifiedAt: mode.verifiedAt } : {}),
    })),
  );
}

/**
 * `certifying` / `committing` 阶段的逃生口。
 *
 * 以前这里直接 `throw new Error("Cannot cancel certification in progress")`——于是那次死锁
 * 里用户和驱动 Agent 双双没路可走：run 卡在中间态、会话跟着卡、cancel 被拒、只能重启 app。
 * 拒绝 cancel 的本意是「别在远端已经受理之后假装撤销了」，但它**把「撤销远端」和「放弃本地会话」
 * 混成了一件事**。拆开：先真的去撤 run（撤得掉就撤），撤不掉也要如实告诉调用方，
 * 而不是把人锁在一个没有出口的状态里。
 */
export function cancelCertifyingRun(
  certification: ConnectionCertificationService | undefined,
  session: { kind: string; childRunRef?: { runId: string } },
): { code: string } | undefined {
  // ComfyUI 的 certifying 是一个还在飞的本地 promise，没有可撤的 run；对它放行只会让
  // 「已取消」和随后 resolve 的「已完成」打架，所以那条路仍然拒绝。
  if (session.kind !== "http-api-provider" || !session.childRunRef || !certification)
    throw new Error("Cannot cancel certification in progress");
  const runId = session.childRunRef.runId;
  const after = certification.cancel(runId) ?? certification.get(runId);
  // 撤得掉就撤干净；远端已经受理（run 仍非终态）也要放人走，但**如实标注**，
  // 而不是像以前那样把人锁在一个没有出口的状态里。
  // 终态判断复用 providerAdapter 那一份（store.isTerminalAdapterStage），不在这里再列一遍成员。
  return !after || isTerminalAdapterStage(after.stage) ? undefined : { code: "certification_already_submitted" };
}
