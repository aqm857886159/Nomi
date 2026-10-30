/** Model trials claim the shared durable Run submission before minting any spend authorization. */
import { readCatalog } from "../../catalog/catalogStore";
import { selectTaskMapping, type ProfileKind } from "../../catalog/types";
import type { ProjectAgentApprovalPolicy } from "../../shared/agentCapabilities/capabilityApprovalPolicy";
import { spendDecisionByPolicy } from "../../shared/agentCapabilities/directGenerationBrakes";
import { quoteSpendLine } from "../../spendQuote";
import path from "node:path";
import { getSettingsRoot } from "../../settings/settingsRoot";
import { createSubmissionIntent, type SubmissionIntentReceipt } from "../../productionRun/submissionIntent";
import { mintSpendGrant, isSpendAuthorizationError } from "../../spendGrant";
import { sanitizedAdapterJson, redactAdapterSecrets } from "../../providerAdapter/redaction";
import type { FetchTaskResultFn, RunTaskFn } from "../core";
import { pollTaskToTerminal } from "../pollTaskToTerminal";
import { isTerminalTaskStatus } from "../../shared/taskStatus";
import { billableRequests, noBlast, unverified, type OnboardingFailure, type OnboardingResult } from "./envelope";

/**
 * 试跑最多花 40 秒，**提交和等待共用这一份**。试跑是**一次 MCP 工具调用**，外部宿主有工具超时
 * （例如 Codex 默认 60 秒）：挂太久会被客户端断开，AI 看到的是断线而不是结果，然后重试、重复扣费。
 * 40 秒留出 20 秒余量给返回。到点：
 *   · 提交还没回 → `submission_unknown`（可能已提交，不要重试）。**绝不中止那次请求**：掐断它会让
 *     「到底提交了没有」变成真正的未知；它在后台跑完，拿到任务号就由 `runTask` 记进任务缓存。
 *   · 已提交、等不到终态 → `still_processing`（已收费、不要重试），任务本身不受影响。
 */
export const TRY_MODEL_WAIT_BUDGET_MS = 40_000;

type Raced<T> = { kind: "done"; value: T } | { kind: "failed"; error: unknown } | { kind: "budget" };

/** 赛跑但不取消：到点只是不再等，`promise` 照常跑完（晚到的结果与错误在这里被吞掉，不会变成未处理拒绝）。 */
function raceBudget<T>(promise: Promise<T>, budgetMs: number): Promise<Raced<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ kind: "budget" }), Math.max(0, budgetMs));
    promise.then(
      (value) => { clearTimeout(timer); resolve({ kind: "done", value }); },
      (error: unknown) => { clearTimeout(timer); resolve({ kind: "failed", error }); },
    );
  });
}

function submissionUnknown(why: string): OnboardingFailure {
  return {
    ok: false, code: "submission_unknown",
    message: `Whether the provider accepted this test generation is UNKNOWN: ${why} It may already have been submitted and charged. This is NOT a failure and NOT proof that nothing was sent.`,
    nextAction: "Do NOT retry and do NOT call nomi_try_model again for this model now: that could submit and charge a second job. Tell the user the test may already be running; they can look for it in the provider's own console. If a task id turns up, nomi_read target=task shows its state. Repeated calls return the original order; a new attempt requires explicit user confirmation.",
  };
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** 没给提示词时用的那一句：短、中性、任何模型都答得出来。 */
const NEUTRAL_PROMPT = "A single red apple on a plain white table, soft daylight";

export type TryModelDeps = {
  runTask: RunTaskFn;
  /**
   * 异步供应商提交后「查到终态」用的那一条（与画布 / headless 生成同源：`runtime.fetchTaskResult`）。
   * 缺席时遇到 queued 只会如实说「已提交、仍在处理」，**不会**判失败。
   */
  fetchTaskResult?: FetchTaskResultFn;
  /** 试跑最多等多久（毫秒）。只能往小调（测试用），封顶 `TRY_MODEL_WAIT_BUDGET_MS`。 */
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  /**
   * 用户此刻选的审批档位（宿主持有的那一份快照，与 `generationTransportAdapters` 读的是同一份）。
   *
   * **这一跳不自己回答「该不该问人」**：替用户代答付费全仓只有一个入口 `spendDecisionByPolicy`
   * （`shared/agentCapabilities/directGenerationBrakes.ts`，2026-10-16 协调拍板：试跑也走它，不另开旁路）。
   * 首次试跑按档位请求授权；显式新单总是问人。Agent 调 `nomi_try_model` 不是
   * 用户的一次点击，所以这里**不**伪造一份「用户同意过」的输入——请求批准档照旧弹卡问人。
   * 是否弹卡由**档位**决定，不由入口决定——同一个用户在「全自动」下从画布点一下生成不弹卡，
   * 那么他让自己的 AI 试跑一个刚接进来的模型也不该弹卡。
   *
   * 缺席 = 按默认档走 = 照旧弹卡（与 `decideByPolicyAfterDraft` 的「不猜档位」逐字同义）。
   */
  approvalPolicy?: () => ProjectAgentApprovalPolicy | undefined;
};

export async function tryModel(
  deps: TryModelDeps,
  args: Record<string, unknown>,
): Promise<OnboardingResult | OnboardingFailure> {
  const vendorKey = text(args.vendorKey);
  const modelKey = text(args.modelKey);
  const intent = createSubmissionIntent({ root: path.join(getSettingsRoot(), "app-executions"), scope: ["model-trial", vendorKey, modelKey] });
  const previous = intent.read();
  if (previous && (!text(args.newAttemptOf) && !previous.allowedActions.includes("retry") || text(args.newAttemptOf) && text(args.newAttemptOf) !== previous.attemptId)) {
    return observeIntent(deps, intent, previous);
  }
  const catalog = readCatalog();
  const vendor = catalog.vendors.find((row) => row.key === vendorKey);
  const model = catalog.models.find((row) => row.vendorKey === vendorKey && row.modelKey === modelKey);
  if (!vendor || !model) {
    return {
      ok: false, code: "not_found",
      message: `Nomi has no model ${modelKey || "(missing modelKey)"} on connection ${vendorKey || "(missing vendorKey)"}.`,
      nextAction: "Call nomi_read target=models and use the exact vendor and model ids it returns, or submit the declaration first.",
    };
  }
  const declaredKinds = catalog.mappings
    .filter((mapping) => mapping.enabled && mapping.vendorKey === vendorKey && mapping.modelKey === modelKey)
    .map((mapping) => mapping.taskKind);
  const taskKind = (text(args.taskKind) || declaredKinds[0] || "") as ProfileKind;
  if (!taskKind) {
    return {
      ok: false, code: "needs_input",
      message: `Nothing is declared for ${modelKey}, so there is no mode to try.`,
      needs: ["a submitted declaration for this model"],
      nextAction: "Send the card with action=submit_declaration first; nomi_read target=onboarding_kit has the schema and two examples.",
    };
  }
  if (!selectTaskMapping(catalog.mappings, vendorKey, taskKind, modelKey)) {
    return {
      ok: false, code: "not_found",
      message: `${modelKey} has no enabled ${taskKind} mode on ${vendorKey}. Declared modes: ${declaredKinds.join(", ") || "none"}.`,
      nextAction: "Pass one of the declared taskKinds, or add that mode to the card and submit it again.",
    };
  }
  if (!catalog.apiKeysByVendor[vendorKey]?.apiKey) {
    return {
      ok: false, code: "needs_input",
      message: `${vendor.name} has no saved key, so nothing can be sent.`,
      needs: ["an API key on this connection"],
      nextAction: "Either call connect_provider with this vendorKey so the user pastes it on Nomi's own page, or, if the user handed you the key, call action=set_key.",
    };
  }

  const startedAt = Date.now();
  const params = (args.params && typeof args.params === "object" && !Array.isArray(args.params))
    ? (args.params as Record<string, unknown>) : {};
  let claimed: ReturnType<typeof intent.claim>;
  try {
    claimed = intent.claim({ vendor: vendorKey, model: modelKey, kind: taskKind,
      prompt: text(args.prompt) || NEUTRAL_PROMPT, params,
      spendDecidedBy: !text(args.newAttemptOf) && spendDecisionByPolicy(deps.approvalPolicy?.(), undefined).decided ? "policy:full_auto" : "user" }, text(args.newAttemptOf) || undefined);
  } catch (error) {
    const current = intent.read();
    if (current) return observeIntent(deps, intent, current);
    return submissionUnknown(redactAdapterSecrets(String(error), 300));
  }
  if (!claimed.owned) return observeIntent(deps, intent, claimed.receipt);
  const policyAnswers = !(claimed.explicitNew && claimed.receipt.newAttemptRequiresUserConfirmation)
    && claimed.receipt.request?.spendDecidedBy === "policy:full_auto";
  const nodeId = `${claimed.receipt.intentId}:${claimed.receipt.attemptId}`;
  const quoted = quoteSpendLine({ vendorKey, modelKey, parameters: params });
  // A new-order request always shows the existing human confirmation, including in full-auto.
  // Both this permission and the Agent receipt derive from the same persisted claim.
  const grantId = mintSpendGrant({ nodeIds: [nodeId], maxAttemptsPerNode: 1, ttlMs: 30 * 60 * 1000,
    ...(policyAnswers ? { quote: { lines: [quoted], amount: quoted.amount } } : {}) });
  const budgetMs = Math.min(deps.pollTimeoutMs ?? TRY_MODEL_WAIT_BUDGET_MS, TRY_MODEL_WAIT_BUDGET_MS);
  const submitted = await raceBudget(intent.submit(claimed, async () => {
    const result = await deps.runTask({ vendor: vendorKey, request: { kind: taskKind,
      prompt: text(args.prompt) || NEUTRAL_PROMPT,
      extras: { ...params, modelKey, modelAlias: modelKey, nodeId, grantId } } });
    return JSON.parse(redactAdapterSecrets(JSON.stringify(result), Number.MAX_SAFE_INTEGER)) as typeof result;
  }).then(() => intent.read(claimed.job.jobId)!), budgetMs);
  if (submitted.kind === "budget") return withSubmission(submissionUnknown("The submit request is still in flight."), intent.read(claimed.job.jobId)!);
  if (submitted.kind === "failed") {
    const current = intent.read(claimed.job.jobId)!;
    const cause = (submitted.error as { cause?: unknown })?.cause;
    if (isSpendAuthorizationError(cause) || /RendererUnavailable|Nomi 窗口/.test(current.errorMessage ?? "")) {
      return withSubmission({ ok: false, code: "needs_input", message: "The user has not confirmed this submission in Nomi.",
        nextAction: "Open Nomi and confirm the generation card before requesting this trial again." }, current);
    }
    if (current.accepted !== "not_sent") return withSubmission(submissionUnknown(redactAdapterSecrets(String(submitted.error), 300)), current);
    return withSubmission({ ok: false, code: "provider_failed", message: `Nothing was sent or the provider explicitly rejected the submission: ${redactAdapterSecrets(String(submitted.error), 512)}`,
      nextAction: current.allowedActions.includes("retry") ? "It is safe to retry once; fix the named problem first." : "The retry budget is exhausted. Ask the user before requesting a new attempt." }, current);
  }
  return observeIntent(deps, intent, submitted.value, Math.max(0, budgetMs - (Date.now() - startedAt)));
}

function withSubmission<T extends OnboardingResult | OnboardingFailure>(result: T, receipt: SubmissionIntentReceipt): T {
  return { ...result, submission: { protocol: "try-model-intent-lock", intentId: receipt.intentId, attemptId: receipt.attemptId, phase: receipt.phase,
    accepted: receipt.accepted, allowedActions: receipt.allowedActions, newAttemptRequiresUserConfirmation: receipt.newAttemptRequiresUserConfirmation },
    ...(receipt.taskId ? { taskId: receipt.taskId } : {}) };
}

async function observeIntent(deps: TryModelDeps, intent: ReturnType<typeof createSubmissionIntent>, receipt: SubmissionIntentReceipt, remainingBudget?: number): Promise<OnboardingResult | OnboardingFailure> {
  if (!receipt.result || !receipt.request) {
    if (receipt.accepted === "not_sent") return withSubmission({ ok: false, code: "provider_failed",
      message: "The previous submission was not sent or was explicitly rejected.", nextAction: receipt.allowedActions.includes("retry") ? "A bounded retry is available." : "Ask the user to authorize a new attempt." }, receipt);
    return withSubmission(submissionUnknown("The original submission has no completed receipt yet; repeated calls return this same order."), receipt);
  }
  const { vendor: vendorKey, model: modelKey, kind: taskKind, prompt } = receipt.request;
  const policyAnswers = receipt.request.spendDecidedBy === "policy:full_auto";
  const startedAt = Date.now();
  const budgetMs = remainingBudget ?? Math.min(deps.pollTimeoutMs ?? TRY_MODEL_WAIT_BUDGET_MS, TRY_MODEL_WAIT_BUDGET_MS);
  let result = receipt.result as Awaited<ReturnType<RunTaskFn>>;
  // 异步供应商：提交即收费，首次返回只有 queued 没有产物。**这不是失败**——
  // 等到终态（同一条查询链路），等不到就如实说「仍在处理」，绝不报 provider_failed（否则 AI 会重试再花一次钱）。
  const taskId = typeof result.id === "string" ? result.id : "";
  if (result.status && !isTerminalTaskStatus(result.status)) {
    const polled = deps.fetchTaskResult
      ? await pollTaskToTerminal({
          initial: result,
          fetch: deps.fetchTaskResult,
          vendor: vendorKey,
          taskKind,
          prompt,
          modelKey,
          timeoutMs: Math.max(0, budgetMs - (Date.now() - startedAt)),
          intervalMs: deps.pollIntervalMs ?? (taskKind === "text_to_video" || taskKind === "image_to_video" ? 3000 : 1500),
        })
      : { result, ended: "timeout" as const, waitedMs: 0 };
    result = polled.result;
    if (polled.ended !== "terminal") {
      intent.recordResult(receipt.attemptId, JSON.parse(redactAdapterSecrets(JSON.stringify(result), Number.MAX_SAFE_INTEGER)));
      return withSubmission({
        ok: false, code: "still_processing",
        message: `The provider accepted this test generation${taskId ? ` (task ${taskId})` : ""} and it is still processing (status=${result.status || "queued"}). The charge for it has already been made. This is NOT a failure.`,
        ...(taskId ? { taskId } : {}),
        evidence: { bodyExcerpt: sanitizedAdapterJson(result.raw).slice(0, 512) },
        nextAction: `Do NOT retry and do NOT call nomi_try_model again for this model now: that would submit and charge a second job. Tell the user the test is submitted and still running${taskId ? `, with task id ${taskId}` : ""}, then check it with nomi_read target=task taskId=${taskId || "(the task id)"}: that only looks, it never submits or charges. Request a new attempt only after asking the user.`,
      }, intent.read(receipt.attemptId)!);
    }
  }

  if (receipt.phase !== "succeeded") intent.recordResult(receipt.attemptId, JSON.parse(redactAdapterSecrets(JSON.stringify(result), Number.MAX_SAFE_INTEGER)));
  const vendor = readCatalog().vendors.find((row) => row.key === vendorKey);
  const model = readCatalog().models.find((row) => row.vendorKey === vendorKey && row.modelKey === modelKey);
  const assets = Array.isArray(result.assets) ? result.assets : [];
  const succeeded = result.status === "succeeded" && assets.length > 0;
  const origin = new URL(String(vendor?.baseUrlHint || "https://invalid.invalid")).origin;
  const upstream = sanitizedAdapterJson(result.raw).slice(0, 20_000);
  if (!succeeded) {
    return withSubmission({
      ok: false, code: "provider_failed",
      message: `The provider did not produce anything: status=${result.status || "unknown"}${result.error ? `, ${redactAdapterSecrets(result.error, 300)}` : ""}.`,
      evidence: { bodyExcerpt: upstream.slice(0, 512) },
      nextAction: "The provider's own response is in evidence.bodyExcerpt. Fix the field it points at and submit the whole card again, request a new attempt only after the user confirms.",
    }, intent.read(receipt.attemptId)!);
  }
  return withSubmission({
    ok: true,
    vendorKey,
    state: {
      vendorKey,
      modelKey,
      taskKind,
      status: result.status,
      /** 这笔钱是用户在 Nomi 窗口里按的，还是「全自动」档位代答的（与 Run 侧收据同一套说法）。 */
      spendDecidedBy: policyAnswers ? "policy:full_auto" : "user",
      assets: assets.map((asset) => ({ type: asset.type, url: asset.url })),
      /** 上游原文（脱敏后原样）。AI 自己收敛靠的就是这一段，不是我们的分类码。 */
      providerResponse: upstream,
    },
    // 跑出产物了 → `model_produces_output` 这一格消掉；上传通道仍然没被证明过。
    unverified: unverified("asset_upload_works"),
    changes: [{ state: "S11.5", summary: `${modelKey} produced one artifact on ${taskKind}.` }],
    blastRadius: { ...noBlast(), outboundRequests: billableRequests(origin) },
    // 账本上分得清这笔是谁点的头：策略代答，还是用户在窗口里按的。
    nextAction: {
      kind: "none",
      userSees: `${model?.labelZh || modelKey} produced an artifact. It is usable in Nomi's model pickers now.`,
    },
  }, intent.read(receipt.attemptId)!);
}
