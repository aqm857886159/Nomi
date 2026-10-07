/**
 * 试跑一次（F3）。**这是这条路上唯一花钱的动作**，也是唯一能把
 * `unverified: model_produces_output` 消掉的证据。
 *
 * ── 为什么非有它不可 ─────────────────────────────────────────────────────────────
 * 写代码的人每次都能接进来，第四件本事是「跑一下，看供应商吐的真话，再改」。今天 MCP 这条路
 * 上没有这一步，于是 AI 只能盲改：它拿到的永远是我们归一化后的分类码，看不到上游原文。
 * 先查别人也指向同一处：Coze 的插件导入把「Debug 页真跑一次、跑通才能 Done」做成了必经步骤。
 *
 * ── 它走哪条执行器、钱谁把关 ─────────────────────────────────────────────────────
 * 执行器 = `runtime.runTask`，**和用户在画布上点一下生成是同一条**（vendor 无关，按
 * `selectTaskMapping` 派发）。刻意不走 Run 路径：那条今天只认 APIMart 一家。
 * 钱闸也是那一条：`spendGrant` → 渲染层报价确认卡。这里铸的令牌**不带报价**，所以
 * `assertAndConsumeQuotedSpend` 一定会走到 `confirm()`——也就是一定会去问用户。
 * 模型调得动这个工具，但结不了这笔账：确认按钮在用户自己的 Nomi 窗口里。
 * Nomi 窗口不在（纯 headless 宿主）时，这一跳**诚实失败**，不偷偷放行。
 *
 * ── 回传什么 ────────────────────────────────────────────────────────────────────
 * 供应商的原始响应**脱敏后原样**回传（`sanitizedAdapterJson`）。不改写、不翻译、不只给分类码：
 * 那正是 AI 自己收敛所需要的东西。脱敏是硬的——`redactAdapterSecrets` 是全仓同一份。
 */
import { readCatalog } from "../../catalog/catalogStore";
import { selectTaskMapping, type ProfileKind } from "../../catalog/types";
import { spendDecidedByPolicy, type ProjectAgentApprovalPolicy } from "../../shared/agentCapabilities/capabilityApprovalPolicy";
import { quoteSpendLine } from "../../spendQuote";
import { isTransportLevelFailure, outboundRequestWasNeverWritten } from "../../outboundDispatchEvidence";
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

/**
 * 提交失败但**不是供应商给的 HTTP 回复**：连接层断了 / 超时（供应商是否已收下不知道）。
 * 供应商明确回了状态码或逻辑错误码（`structured.httpStatus` / `logicalCode`）就是它的答复，不在此列。
 * 「没写出去」的证据只认 `outboundRequestWasNeverWritten`，调用方先问它，这里不再另写判据。
 */
function connectionLevelFailure(error: unknown): boolean {
  if (isTransportLevelFailure(error)) return true;
  const structured = (error as { structured?: { category?: unknown; httpStatus?: unknown; logicalCode?: unknown } } | null)?.structured;
  if (!structured || structured.httpStatus != null || structured.logicalCode != null) return false;
  return structured.category === "network" || structured.category === "timeout";
}

function submissionUnknown(why: string): OnboardingFailure {
  return {
    ok: false, code: "submission_unknown",
    message: `Whether the provider accepted this test generation is UNKNOWN: ${why} It may already have been submitted and charged. This is NOT a failure and NOT proof that nothing was sent.`,
    nextAction: "Do NOT retry and do NOT call nomi_try_model again for this model now: that could submit and charge a second job. Tell the user the test may already be running; they can look for it in the provider's own console. If a task id turns up, nomi_read target=task shows its state. Only try again later if the user asks.",
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
   * **这一跳不自己回答「该不该问人」**：那个问题全仓只有 `spendDecidedByPolicy` 回答
   * （`shared/agentCapabilities/capabilityApprovalPolicy.ts:144`，2026-09-12 用户拍板的单一 owner）。
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
  const budgetMs = Math.min(deps.pollTimeoutMs ?? TRY_MODEL_WAIT_BUDGET_MS, TRY_MODEL_WAIT_BUDGET_MS);
  // 一个节点、一次机会：试跑不给重试预算。想再试一次就再调一次。
  const nodeId = `try-${vendorKey}-${Date.now()}`;
  // 档位代答（「全自动」）与逐次问人（其余档）的**区别只有一处**：令牌上带不带这次的报价。
  //   · 带 → `assertAndConsumeQuotedSpend` 认得出这笔就是已授权的那一笔，直接扣、直接发；
  //   · 不带 → 它一定会走到 `confirm()`，也就是一定会去问用户（报价卡在用户自己的 Nomi 窗口里，
  //     报价卡怎么说由渲染层负责，见 `src/workbench/ai/v4/agentPanelSpendCard.ts`：报不出价时卡上不说任何价格的话）。
  // 两条路都经同一个钱闸，这里没有第二套判据，也没有任何「跳过闸」的分支。
  const policyAnswers = spendDecidedByPolicy(deps.approvalPolicy?.());
  const quoted = quoteSpendLine({ vendorKey, modelKey, parameters: {} });
  const grantId = mintSpendGrant({
    nodeIds: [nodeId],
    maxAttemptsPerNode: 1,
    ttlMs: 30 * 60 * 1000,
    ...(policyAnswers ? { quote: { lines: [quoted], amount: quoted.amount } } : {}),
  });
  const params = (args.params && typeof args.params === "object" && !Array.isArray(args.params))
    ? (args.params as Record<string, unknown>)
    : {};
  // 提交与「剩余预算」赛跑：到点就回话，但**不中止**这次提交（见 TRY_MODEL_WAIT_BUDGET_MS）。
  const submitted = await raceBudget(
    (async () => deps.runTask({
      vendor: vendorKey,
      request: {
        kind: taskKind,
        prompt: text(args.prompt) || NEUTRAL_PROMPT,
        extras: { ...params, modelKey, modelAlias: modelKey, nodeId, grantId },
      },
    }))(),
    budgetMs,
  );
  if (submitted.kind === "budget") {
    // 提交还在路上：没有失败对象，拿不出「请求没写出去」的证据，只能说结果未知。
    return submissionUnknown("The provider has not answered the submit request within the time Nomi can wait inside one tool call.");
  }
  let result: Awaited<ReturnType<RunTaskFn>>;
  if (submitted.kind === "done") {
    result = submitted.value;
  } else {
    const error = submitted.error;
    const message = error instanceof Error ? error.message : String(error);
    if (isSpendAuthorizationError(error) || /RendererUnavailable|Nomi 窗口/.test(message)) {
      return {
        ok: false, code: "needs_input",
        message: "The user did not confirm this charge in Nomi, so nothing was sent.",
        needs: ["the user to confirm the cost in Nomi's own window"],
        nextAction: "Ask the user to open Nomi and confirm the generation card, then call nomi_try_model again. Nomi never spends the user's credit on a tool call alone.",
      };
    }
    if (outboundRequestWasNeverWritten(error)) {
      return {
        ok: false, code: "provider_failed",
        message: `The test generation was not submitted. Nothing was sent to the provider (the connection never opened), so no charge was made: ${redactAdapterSecrets(message, 600)}`,
        evidence: { bodyExcerpt: redactAdapterSecrets(message, 512) },
        nextAction: "It is safe to retry once the provider's address and network are reachable. If the address in the card is wrong, fix it and submit the card again first.",
      };
    }
    if (connectionLevelFailure(error)) return submissionUnknown(redactAdapterSecrets(message, 300));
    return {
      ok: false, code: "provider_failed",
      message: `The test generation failed before it produced anything: ${redactAdapterSecrets(message, 600)}`,
      evidence: { bodyExcerpt: redactAdapterSecrets(message, 512) },
      nextAction: "Read the message against the documentation URL the card declared for that mode, fix the field it names, and submit the card again.",
    };
  }

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
          prompt: text(args.prompt) || NEUTRAL_PROMPT,
          modelKey,
          timeoutMs: Math.max(0, budgetMs - (Date.now() - startedAt)),
          intervalMs: deps.pollIntervalMs ?? (taskKind === "text_to_video" || taskKind === "image_to_video" ? 3000 : 1500),
        })
      : { result, ended: "timeout" as const, waitedMs: 0 };
    result = polled.result;
    if (polled.ended !== "terminal") {
      return {
        ok: false, code: "still_processing",
        message: `The provider accepted this test generation${taskId ? ` (task ${taskId})` : ""} and it is still processing (status=${result.status || "queued"}). The charge for it has already been made. This is NOT a failure.`,
        ...(taskId ? { taskId } : {}),
        evidence: { bodyExcerpt: sanitizedAdapterJson(result.raw).slice(0, 512) },
        nextAction: `Do NOT retry and do NOT call nomi_try_model again for this model now: that would submit and charge a second job. Tell the user the test is submitted and still running${taskId ? `, with task id ${taskId}` : ""}, then check it with nomi_read target=task taskId=${taskId || "(the task id)"}: that only looks, it never submits or charges. Only try again later if the user asks.`,
      };
    }
  }

  const assets = Array.isArray(result.assets) ? result.assets : [];
  const succeeded = result.status === "succeeded" && assets.length > 0;
  const origin = new URL(String(vendor.baseUrlHint || "https://invalid.invalid")).origin;
  const upstream = sanitizedAdapterJson(result.raw).slice(0, 20_000);
  if (!succeeded) {
    return {
      ok: false, code: "provider_failed",
      message: `The provider did not produce anything: status=${result.status || "unknown"}${result.error ? `, ${redactAdapterSecrets(result.error, 300)}` : ""}.`,
      evidence: { bodyExcerpt: upstream.slice(0, 512) },
      nextAction: "The provider's own response is in evidence.bodyExcerpt. Fix the field it points at and submit the whole card again, then try once more.",
    };
  }
  return {
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
      userSees: `${model.labelZh || modelKey} produced an artifact. It is usable in Nomi's model pickers now.`,
    },
  };
}
