// 中转生图路由回退（2026-07-24 真实报错定案：y7api.top POST /v1/images/generations 403
// "Image generation is not enabled for this group"）。
//
// one-api/new-api 系中转的令牌「分组」常只在 /v1/chat/completions 路由上开图模型，OpenAI images
// 端点被 403/404 类拒——但同一模型走 chat 多模态能出图（拉取式接入的改图口径本就是它，
// NEWAPI_IMAGE_EDIT_OP；t2i 复用同 op：chat_image_parts 为空时 content 只剩 text 项）。
// 这正是「接入测试/他软件能出图、Nomi 画布报未开启生图功能」的另一条腿（第一条腿=档案投影
// 吞标准参考键，已修于 4dd0be1f）。
//
// 回退三条件（全中才回退，一次为限）：
//  ① 失败 op 打的是 OpenAI images 端点（/v1/images/generations|edits）——kie/apimart/火山等
//     自家路径不同，永不误回退；
//  ② 状态码是**确定性拒绝** 403/404/405：请求被路由层拒、未创建任务、未扣费——换路由重发
//     不违「重试绝不包住付费提交」铁律。超时/5xx/歧义一律不重发（可能已扣费）；
//  ③ 上游原话命中「路由/分组未开通」类窄短语——403 也可能是 key 无效/配额，那些不该换路由。
import type { HttpOperation } from "./types";
import { NEWAPI_IMAGE_EDIT_OP } from "./newapiTransport";
import { VendorRequestError } from "../vendor/vendorHttp";

const OPENAI_IMAGE_PATHS = new Set(["/v1/images/generations", "/v1/images/edits"]);
const DEFINITIVE_REJECT_STATUS = new Set([403, 404, 405]);

/** 「生图路由/分组未开通」窄匹配（一并供渲染层文案分类复用语义，短语保持窄避免误吞普通 403）。 */
export function matchesImageRouteDisabledText(text: string): boolean {
  const lower = String(text || "").toLowerCase();
  if (lower.includes("not enabled for this group")) return true;
  if (lower.includes("image generation is not enabled")) return true;
  if (lower.includes("images api is not enabled") || lower.includes("endpoint is disabled")) return true;
  if (
    (lower.includes("分组") || lower.includes("group")) &&
    (lower.includes("未开通") || lower.includes("无权限") || lower.includes("not enabled") || lower.includes("no permission"))
  ) {
    return true;
  }
  return false;
}

/**
 * 判定是否可回退 + 给出回退 op。返回 null = 不回退（调用方原样抛错）。
 * 404/405 无需文案命中（路由不存在本身就是信号）；403 必须命中窄短语。
 */
export function chatImageFallbackOperation(
  error: unknown,
  operation: HttpOperation,
  taskKind: string,
): HttpOperation | null {
  if (!(error instanceof VendorRequestError)) return null;
  if (taskKind !== "text_to_image" && taskKind !== "image_edit") return null;
  if (!OPENAI_IMAGE_PATHS.has(String(operation.path || ""))) return null;
  const status = error.structured?.httpStatus;
  if (typeof status !== "number" || !DEFINITIVE_REJECT_STATUS.has(status)) return null;
  if (status === 403 && !matchesImageRouteDisabledText(`${error.structured?.upstreamMsg || ""} ${error.message}`)) {
    return null;
  }
  return NEWAPI_IMAGE_EDIT_OP;
}
