/**
 * 格式任务里一条模式的**格式完整性检查**。零网络：不向上游发任何请求。
 *
 * 2026-09-11 之前这里用真实 key 发一次真实生成（图片模型 = 一次付费出图）再验产物；那次删掉后还剩
 * 一步「凭据自检」（`GET /models` 判 key、判模型在不在清单里）。2026-11-17 用户拍板删掉验证整段
 * （D-1117-delete-verification），凭据自检一并删：它的唯一产出是「这把 key 行不行」的判断。
 * 现在只剩说明卡形状对不对（有没有可执行通道、声明异步却没给 query、改图模式没声明参考图槽）。
 * 过了就是「请求格式已就绪」；**第一次真实生成就是第一次碰供应商**，钱的闸在提交处看报价确认。
 *
 * 失败原因分成正交的两维（治「把我们的能力缺口报成未知的上游错误」）：
 *   - `errorCategory`：上游怎么拒绝我们（旧任务记录 / 超时兜底才有）。
 *   - `selfCheckReason`：**我们这边**缺什么（no_channel / async_without_query / reference_slot_missing）。
 *     渲染层据它说人话，不猜字符串。
 */
import type { Model, Vendor } from "../catalog/types";
import type { VendorErrorCategory } from "../vendor/vendorHttp";
import type { AdapterModeDraft } from "./types";
import type { CertificationSubmissionState } from "../integrationCertification/types";
import { checkAdapterModeContract, type AdapterSelfCheckReason } from "./selfCheck";

export type { AdapterSelfCheckReason } from "./selfCheck";

export type AdapterVerificationResult =
  | {
      ok: true;
      taskKind: AdapterModeDraft["taskKind"];
      requestSummary?: unknown;
      /** 格式检查从不让任何东西留在上游，永远是 settled。保留字段是因为 ledger 的持久形状要它。 */
      submissionState?: Extract<CertificationSubmissionState, "settled">;
    }
  | {
      ok: false;
      taskKind: AdapterModeDraft["taskKind"];
      /**
       * 只剩说明卡形状这一段。旧的 create/poll/result/verify_asset 随付费验证删了，
       * 「凭据」那一段随 D-1117-delete-verification 删了（旧记录里的 "credential" 只在持久形状里认）。
       */
      stage: "contract";
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

/** 一条模式的格式完整性检查：纯函数，零网络。异步签名只为对上 service 的依赖形状。 */
export async function verifyAdapterMode(input: {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  mode: AdapterModeDraft;
  signal?: AbortSignal;
}): Promise<AdapterVerificationResult> {
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
  return {
    ok: true,
    taskKind: input.mode.taskKind,
    requestSummary: {
      selfCheck: "contract",
      modelKey: input.model.modelKey,
      taskKind: input.mode.taskKind,
    },
    submissionState: "settled",
  };
}
