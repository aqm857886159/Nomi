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
 * `certifying` / `committing` 阶段的逃生口。**这个函数不允许抛异常**——它一抛，
 * `IntegrationSessionService.cancel` 就跟着抛，用户和驱动 Agent 就都没有出口了。
 *
 * 以前这里直接 `throw new Error("Cannot cancel certification in progress")`。第一轮修复
 * （2026-09-11）只给「已经拿到 childRunRef 的 HTTP 会话」开了口，剩下三种状态照旧抛：
 *   1. `comfyui-workflow` 会话——本地那条免费自检没有 run 可撤；
 *   2. HTTP 会话在「`certifying` 已落盘、`startHttp` 还没返回」这个窗口里——还没有 childRunRef；
 *   3. run 记录已被删（连接被删）而会话还引用着它。
 * 拒绝 cancel 的本意是「别在远端已经受理之后假装撤销了」，但它**把「撤销远端」和
 * 「放弃本地会话」混成了一件事**。拆开：能撤的真去撤；撤不掉、或压根没有可撤的东西，
 * 一样放人走，只是**如实标注**为什么。
 *
 * 「放弃本地会话之后，那个还在飞的 promise 迟到 resolve 会不会把会话复活成 completed？」
 * 这个担心是对的，但它的解法是「终态不许被覆写」（`integrationSession.start` 里的
 * `sealedAfterAward` 守卫），不是「不给用户出口」。
 */
export function cancelCertifyingRun(
  certification: ConnectionCertificationService | undefined,
  session: { kind: string; childRunRef?: { runId: string } },
): { code: string } | undefined {
  // 没有可撤的 run（ComfyUI 的本地 promise / 还没拿到 childRunRef）：会话照样放人走。
  // 标注的是**事实**——本地放弃了，但那一步可能还在跑完——而不是一个静默兜底。
  if (session.kind !== "http-api-provider" || !session.childRunRef || !certification)
    return { code: "certification_abandoned_locally" };
  const runId = session.childRunRef.runId;
  const after = certification.cancel(runId) ?? certification.get(runId);
  // run 记录已经不在了（连接被删）= 没有远端在受理，干净取消。
  // 撤得掉就撤干净；远端已经受理（run 仍非终态）也要放人走，但**如实标注**。
  // 终态判断复用 providerAdapter 那一份（store.isTerminalAdapterStage），不在这里再列一遍成员。
  return !after || isTerminalAdapterStage(after.stage) ? undefined : { code: "certification_already_submitted" };
}
