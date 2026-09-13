/**
 * 一条模式的**免费自检**。2026-09-11 用户拍板后，这里不再向上游发任何一次生成请求。
 *
 * 在这之前它做的是：用真实 key 发一次真实生成（图片模型 = 一次付费出图）→ 轮询 → 下载产物 →
 * 验真这是一张真图。一个图片模型两个模式 = 一轮 2 次付费出图，自动修复 2 轮 × 全量回归 = 最坏
 * 6 次；失败时那个已受理、已扣费、还在跑的任务被我们转身丢掉（旧 :302 手里明明有 remoteTaskId）。
 * 群反馈原话：「手动添加的模型都没法通过验证，还消耗积分」。
 * 全部诊断见 docs/plan/2026-09-11-model-onboarding-flow.md。
 *
 * 现在只剩两件零成本、且**在花钱之前就该知道**的事：
 *   ① 鉴权 + 这个模型在不在上游列出来的清单里（`GET /models`，一条连接只打一次）；
 *   ② 说明卡形状对不对（有没有可执行通道、声明异步却没给 query、改图模式没声明参考图槽）。
 * 过了就进画布模型框、标「未试跑」。**第一次真实生成就是试跑**，钱的闸在提交处看报价确认。
 *
 * 失败原因分成正交的两维（治「把我们的能力缺口报成未知的上游错误」）：
 *   - `errorCategory`：上游怎么拒绝我们（沿用 vendorHttp 在抛出点的查表结论）。
 *   - `selfCheckReason`：**我们这边**缺什么（credential_rejected / endpoint_unreachable /
 *     no_channel / async_without_query / reference_slot_missing）。渲染层据它说人话，不猜字符串。
 */
import type { Model, Vendor } from "../catalog/types";
import type { VendorErrorCategory } from "../vendor/vendorHttp";
import type { AdapterModeDraft } from "./types";
import type { CertificationSubmissionState } from "../integrationCertification/types";
import {
  checkAdapterModeContract,
  probeAdapterCredential,
  type AdapterCredentialProbe,
  type AdapterSelfCheckDependencies,
  type AdapterSelfCheckReason,
} from "./selfCheck";

export type { AdapterCredentialProbe, AdapterSelfCheckReason } from "./selfCheck";
export { probeAdapterCredential } from "./selfCheck";

export type AdapterVerificationResult =
  | {
      ok: true;
      taskKind: AdapterModeDraft["taskKind"];
      requestSummary?: unknown;
      /** 自检从不让任何东西留在上游，永远是 settled。保留字段是因为 ledger 的持久形状要它。 */
      submissionState?: Extract<CertificationSubmissionState, "settled">;
      /** 上游的模型清单里没有它。**不判死**（很多中转不把模型列全），只作为提示带给界面。 */
      modelNotListed?: boolean;
    }
  | {
      ok: false;
      taskKind: AdapterModeDraft["taskKind"];
      /** 自检只有两段：凭据、说明卡形状。旧的 create/poll/result/verify_asset 随付费验证一起删了。 */
      stage: "credential" | "contract";
      error: string;
      /**
       * 上游归类（401/403→auth、402→balance、429→quota…）。**在抛出点就已查表定好**，
       * 这里只是带出来，不重新判断。
       */
      errorCategory?: VendorErrorCategory;
      httpStatus?: number;
      /** 「我们这边缺什么」这一维。与 errorCategory 正交，界面据它给修复路径而不是甩英文原文。 */
      selfCheckReason: AdapterSelfCheckReason;
      requestSummary?: unknown;
      submissionState?: Extract<CertificationSubmissionState, "settled">;
    };

export type AdapterVerifierDependencies = AdapterSelfCheckDependencies;

/** 上游拒绝的归类：自检只碰得到鉴权这一种确定的拒绝。 */
function categoryFor(reason: AdapterSelfCheckReason): VendorErrorCategory | undefined {
  if (reason === "credential_rejected") return "auth";
  if (reason === "endpoint_unreachable") return "network";
  return undefined;
}

/**
 * 一条模式的自检。`credential` 由调用方**一条连接只探一次**再分发进来（结论对这条连接下的
 * 所有模型都一样，按模式各打一次纯属白打）；不给就在这里现探。
 */
export async function verifyAdapterMode(
  input: {
    vendor: Vendor;
    model: Model;
    apiKey: string;
    mode: AdapterModeDraft;
    credential?: AdapterCredentialProbe;
    signal?: AbortSignal;
  },
  dependencies: AdapterVerifierDependencies = {},
): Promise<AdapterVerificationResult> {
  // 形状先判：纯函数、零网络，而且它的结论与凭据无关——凭据没问题也救不了一张缺 query 的说明卡。
  const contract = checkAdapterModeContract(input.model, input.mode);
  if (!contract.ok) {
    return {
      ok: false,
      taskKind: input.mode.taskKind,
      stage: "contract",
      error: contract.error,
      selfCheckReason: contract.reason,
      submissionState: "settled",
    };
  }
  const credential = input.credential
    || await probeAdapterCredential(
      { vendor: input.vendor, apiKey: input.apiKey, ...(input.signal ? { signal: input.signal } : {}) },
      dependencies,
    );
  if (!credential.ok) {
    return {
      ok: false,
      taskKind: input.mode.taskKind,
      stage: "credential",
      error: credential.error,
      selfCheckReason: credential.reason,
      ...(categoryFor(credential.reason) ? { errorCategory: categoryFor(credential.reason) } : {}),
      ...(credential.httpStatus ? { httpStatus: credential.httpStatus } : {}),
      submissionState: "settled",
    };
  }
  const listedModels = new Set(credential.modelIds);
  const modelNotListed = credential.listed && listedModels.size > 0 && !listedModels.has(input.model.modelKey);
  return {
    ok: true,
    taskKind: input.mode.taskKind,
    requestSummary: {
      selfCheck: "credential+contract",
      modelKey: input.model.modelKey,
      taskKind: input.mode.taskKind,
      modelListed: credential.listed ? !modelNotListed : null,
    },
    submissionState: "settled",
    ...(modelNotListed ? { modelNotListed: true } : {}),
  };
}
