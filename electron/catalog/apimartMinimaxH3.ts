// MiniMax-H3 的 APIMart 发送前契约护栏。
//
// APIMart 用字段自动路由：首/尾帧与多模态参考是两组互斥输入。模板层会按模式丢掉
// undefined，但存量节点/旧 mapping 仍可能把两组值都带到渲染后的 body；这里在扣费与
// HTTP 发送之间做最后一道、模型专属且可审计的校验。
import { registerRequestTransform } from "../tasks/requestTransforms";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasWireValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value != null;
}

export function normalizeMinimaxH3Body(body: unknown): unknown {
  if (!isRecord(body)) return body;

  const hasFrame = hasWireValue(body.first_frame_image) || hasWireValue(body.last_frame_image);
  const hasImageReference = hasWireValue(body.image_urls);
  const hasVideoReference = hasWireValue(body.video_urls);
  const hasAudioReference = hasWireValue(body.audio_urls);
  const hasReference = hasImageReference || hasVideoReference || hasAudioReference;

  if (hasFrame && hasReference) {
    throw new Error("MiniMax H3 请求参数冲突：首尾帧与参考素材不能同时使用，请只保留一组输入。");
  }
  if (!hasFrame && hasAudioReference && !hasImageReference && !hasVideoReference) {
    throw new Error("MiniMax H3 多模态参考中音频不能单独输入，请至少提供参考图或参考视频。");
  }

  const normalized = { ...body };
  // APIMart 文档规定 I2V 比例由输入图片决定，显式 aspect_ratio 会被忽略；不把旧模式残值发出去。
  if (hasFrame) delete normalized.aspect_ratio;
  // 可选 webhook 的空字符串不是有效地址，省略它而不是把空字段交给上游校验。
  if (typeof normalized.webhook === "string" && normalized.webhook.trim() === "") delete normalized.webhook;
  return normalized;
}

registerRequestTransform("apimart-minimax-h3", normalizeMinimaxH3Body);
