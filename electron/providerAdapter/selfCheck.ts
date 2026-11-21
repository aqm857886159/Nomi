/**
 * 格式任务里的**格式完整性检查**：说明卡自己站不站得住。纯函数，零网络、零成本。
 *
 * 2026-09-11 用户拍板删掉所有会花钱的自动验证；2026-11-17 又拍板把「验证」整段删掉
 * （D-1117-delete-verification）：这里曾经还有一步「凭据自检」（`GET /models` 判 key 认不认、
 * 模型在不在清单里），它唯一的产出是「这把 key 行不行」的判断——和已删的验证同一种东西，一并删了。
 * key 被拒只在保存那一刻挡（F1：明确 401 / 403 不存新 key），之后第一次真实生成就是第一次碰供应商。
 *
 * 留下的这一步说的是**我们这边**缺什么（有没有可执行通道、声明异步却没给 query、改图模式没声明
 * 参考图槽），必须与「上游拒绝」分成两个维度回报，否则就会像 09-11 群反馈那样，把 Nomi 的能力缺口
 * 甩成一串英文 + 「你自己接」。结论只说「请求格式已就绪 / 还缺请求格式」。
 */
import type { Model } from "../catalog/types";
import { adapterModeDefect } from "./validator";
import type { AdapterModeDraft } from "./types";

/**
 * 格式检查拿不下结论时的结构化原因。**这是「我们这边」的维度**，与上游 errorCategory 正交。
 *
 * `credential_rejected` / `endpoint_unreachable` 是已删的凭据自检留下的值：旧任务记录里还存着，
 * 渲染层（adapterFailureAdvice）照旧能把它们说成人话；新任务只在「检查这一步没在时限内做完」时
 * 写 `endpoint_unreachable`（service.verifyDraft 的超时兜底），不再有代码写 `credential_rejected`。
 */
export type AdapterSelfCheckReason =
  /** 旧任务记录：上游明确拒绝了这把 key（401/403）。 */
  | "credential_rejected"
  /** 旧任务记录 / 检查超时兜底：没拿到结论。 */
  | "endpoint_unreachable"
  /** 这条模式根本没有可执行的调用通道（如中转上的 3D）。 */
  | "no_channel"
  /** 说明卡声明了异步交付却没给查询端点——**我们缺一条 query**，不是用户填错了。 */
  | "async_without_query"
  /** 改图 / 图生视频这类模式没声明参考图槽，探针与生产都不知道参考图往哪塞。 */
  | "reference_slot_missing";

export type AdapterContractCheck =
  | { ok: true }
  | { ok: false; reason: Extract<AdapterSelfCheckReason, "no_channel" | "async_without_query" | "reference_slot_missing">; error: string };

/**
 * 纯函数：这条模式的说明卡自己站得住吗。零网络、零成本。
 *
 * **不自己判**：缺陷由校验器的 `adapterModeDefect` 判，这里只把它的码转成「我们这边缺什么」的
 * 三个原因（渲染层 adapterFailureAdvice 认的就是这三个）。此前这里自己判了一遍「哪些 taskKind
 * 要参考槽」，用的是 `startsWith("image_to_")`，把运行期写死通道的 image_to_prompt 也算进去了——
 * 同一张卡，收件说合格、自检说有缺陷。
 */
export function checkAdapterModeContract(model: Model, mode: AdapterModeDraft): AdapterContractCheck {
  const defect = adapterModeDefect(model, mode);
  if (!defect) return { ok: true };
  // invalid_mode（kind 不配、映射键不认）在收件处就拒了，到这里只可能是绕过收件的旧数据：
  // 对用户来说就是「这条模式没有能用的通道」。
  const reason = defect.code === "invalid_mode" ? "no_channel" : defect.code;
  return { ok: false, reason, error: defect.message };
}
