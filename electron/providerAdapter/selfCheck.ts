/**
 * 接一个模型时的**免费自检**：鉴权 + 拉模型列表 + 说明卡形状对不对。
 *
 * 2026-09-11 用户拍板：接模型只留两条路（已适配供应商填 key、AI/MCP 接入），并且
 * **删掉所有会花用户钱的自动逻辑**。在这之前，一个模型能不能在画布上用，唯一的凭证是
 * 「一次成功的付费真实生成」——一个图片模型一轮验证 2 次付费出图，自动修复 2 轮 × 全量回归
 * 最坏 6 次，失败了钱照扣、模型还会从画布上消失（见 docs/plan/2026-09-11-model-onboarding-flow.md）。
 *
 * 现在的判据分成两句能各自说清的话：
 *  - **鉴权 + 存在**：`GET /models`（或 `/v1/models`）。零成本、是 OpenAI 兼容面的事实标准。
 *    它证明的是「地址对、key 对」，**不是**「这个模型点了一定能出片」——apimart 对合法 key 恒 401、
 *    minimax 回 200 却连最小生成都跑不通，两个方向的反例都在 validateCandidateCredential 的注释里。
 *    所以 401/403 才判死；404/405（这家根本没有列表端点）**不判死**，如实记「这家没法自检」。
 *  - **形状**：说明卡自己内部一致吗（有没有 create、声明异步却没有 query、改图模式却没声明参考图槽）。
 *    这一类缺陷是**我们这边的**，不是上游拒绝了用户，必须与「上游拒绝」分成两个维度回报，
 *    否则就会像 09-11 群反馈那样，把 Nomi 的能力缺口甩成一串英文 + 「你自己接」。
 *
 * 真正的试跑是**第一次真实生成**（钱的闸已经在提交处看报价确认）。自检通过的模型进模型框、标「未试跑」。
 */
import type { AiSdkProviderKind, Model, Vendor } from "../catalog/types";
import { authHeaders, authQueryParams } from "../ai/requestPipeline";
import { fetchModelList, readExtraHeaders } from "../ai/onboarding/modelListProbe";
import { isJsonRecord, mergeHeadersCaseInsensitive } from "../jsonUtils";
import { providerProxyUrl } from "../providerNetwork";
import { redactAdapterSecrets } from "./redaction";
import { modeDeliveryDefect } from "../catalog/transportDelivery";
import type { AdapterModeDraft } from "./types";

/** 自检拿不下结论时的结构化原因。**这是「我们这边」的维度**，与上游 errorCategory 正交。 */
export type AdapterSelfCheckReason =
  /** 上游明确拒绝了这把 key（401/403）。 */
  | "credential_rejected"
  /** 连不上这个地址（DNS/超时/代理）。 */
  | "endpoint_unreachable"
  /** 这条模式根本没有可执行的调用通道（如中转上的 3D）。 */
  | "no_channel"
  /** 说明卡声明了异步交付却没给查询端点——**我们缺一条 query**，不是用户填错了。 */
  | "async_without_query"
  /** 改图 / 图生视频这类模式没声明参考图槽，探针与生产都不知道参考图往哪塞。 */
  | "reference_slot_missing";

export type AdapterCredentialProbe =
  | {
      ok: true;
      /** 上游列出的模型 id；空数组 = 这家没有可用的列表端点（`listed` 为 false）。 */
      modelIds: readonly string[];
      listed: boolean;
    }
  | { ok: false; reason: Extract<AdapterSelfCheckReason, "credential_rejected" | "endpoint_unreachable">; error: string; httpStatus?: number };

export type AdapterSelfCheckDependencies = {
  fetchModelList?: typeof fetchModelList;
};

/**
 * 一次自检一次探测：结论对同一条连接下的所有模型都一样，调用方（service.verifyDraft）
 * 只跑一次再把结果分发给每个模式，别按模式各打一次。
 */
export async function probeAdapterCredential(
  input: { vendor: Vendor; apiKey: string; signal?: AbortSignal },
  dependencies: AdapterSelfCheckDependencies = {},
): Promise<AdapterCredentialProbe> {
  const probe = dependencies.fetchModelList || fetchModelList;
  const vendor = input.vendor;
  const baseUrl = String(vendor.baseUrlHint || "").trim();
  const providerKind = (vendor.providerKind || "openai-compatible") as AiSdkProviderKind;
  const authType = vendor.authType || (providerKind === "anthropic" ? "x-api-key" : "bearer");
  // authType "none"（火山语音那类三头鉴权）没有可打的列表端点，也没有 key 可判——
  // 如实放行，把结论留给第一次真实生成的诚实报错。
  if (!baseUrl || authType === "none") return { ok: true, modelIds: [], listed: false };
  const headers = mergeHeadersCaseInsensitive(
    providerKind === "anthropic" ? { "anthropic-version": "2023-06-01" } : {},
    readExtraHeaders(isJsonRecord(vendor.meta) ? vendor.meta.extraHeaders : undefined),
    authHeaders(authType, input.apiKey, vendor.authHeader ?? undefined),
  );
  let result;
  try {
    result = await probe(providerKind, baseUrl, headers, input.signal || AbortSignal.timeout(15_000), {
      query: authQueryParams(authType, input.apiKey, vendor.authQueryParam ?? undefined),
      ...(providerProxyUrl(vendor) ? { proxyUrl: providerProxyUrl(vendor) as string } : {}),
    });
  } catch (error) {
    return {
      ok: false,
      reason: "endpoint_unreachable",
      error: redactAdapterSecrets(error instanceof Error ? error.message : String(error)),
    };
  }
  if (result.ok) return { ok: true, modelIds: result.models, listed: true };
  if (result.failureKind === "auth") {
    return {
      ok: false,
      reason: "credential_rejected",
      error: redactAdapterSecrets(result.error || "The provider rejected this API key"),
      ...(result.status ? { httpStatus: result.status } : {}),
    };
  }
  if (result.failureKind === "network") {
    return {
      ok: false,
      reason: "endpoint_unreachable",
      error: redactAdapterSecrets(result.error || "Could not reach the provider"),
    };
  }
  // unsupported / invalid_response / upstream / rate_limit：这家没有（或这一刻给不出）可信的列表端点。
  // 这**不是**「这把 key 不对」，判死会误杀一整类上游（Open WebUI 官方文档也明写验证失败 ≠ 不可用）。
  return { ok: true, modelIds: [], listed: false };
}

export type AdapterContractCheck =
  | { ok: true }
  | { ok: false; reason: Extract<AdapterSelfCheckReason, "no_channel" | "async_without_query" | "reference_slot_missing">; error: string };

/** 需要一张参考图才成立的模式：不声明槽位，参考图整条掉地（生产会被 imageEditGuardError 拒发）。 */
function requiresReferenceSlot(taskKind: string): boolean {
  return taskKind === "image_edit" || taskKind.startsWith("image_to_");
}

/** 纯函数：这条模式的说明卡自己站得住吗。零网络、零成本。 */
export function checkAdapterModeContract(model: Model, mode: AdapterModeDraft): AdapterContractCheck {
  const label = `${model.modelKey}/${mode.taskKind}`;
  if (!mode.create?.method || !mode.create?.path) {
    return { ok: false, reason: "no_channel", error: `${label} has no executable request channel` };
  }
  const delivery = modeDeliveryDefect(mode);
  if (delivery) {
    return { ok: false, reason: "async_without_query", error: `${label} ${delivery}` };
  }
  if (requiresReferenceSlot(mode.taskKind) && !mode.referenceParam) {
    return { ok: false, reason: "reference_slot_missing", error: `${label} does not declare where the reference image goes` };
  }
  return { ok: true };
}
