// MiniMax-H3 的 APIMart 发送前契约护栏。
//
// APIMart 用字段自动路由：首/尾帧与多模态参考是两组互斥输入。模板层会按模式丢掉
// undefined，但存量节点/旧 mapping 仍可能把两组值都带到渲染后的 body；这里在扣费与
// HTTP 发送前做模型专属且可审计的校验，并在真正发送前保留同一校验作纵深防御。
import { registerRequestTransform, type RequestTransformContext } from "../tasks/requestTransforms";
import { desktopT } from "../i18n";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasWireValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value != null;
}

function flatRequestHasMixedFrameAndReference(request: unknown): boolean {
  if (!isRecord(request) || !isRecord(request.extras)) return false;
  const extras = request.extras;
  const hasFrame = hasWireValue(extras.firstFrameUrl) || hasWireValue(extras.lastFrameUrl);
  const hasReference = [
    extras.referenceImages,
    extras.referenceImageUrls,
    extras.referenceVideoUrls,
    extras.referenceAudioUrls,
  ].some(hasWireValue);
  return hasFrame && hasReference;
}

/** Pure contract guard. It must stay free of localization, uploads, spend, and network effects. */
export function validateMinimaxH3Body(body: unknown, context?: RequestTransformContext): void {
  if (flatRequestHasMixedFrameAndReference(context?.request)) {
    throw new Error(desktopT("minimaxH3.mixedReferences"));
  }
  if (!isRecord(body)) return;
  // 参考合计与「音频不能单独输入」归发送前的通用一步（taskParams → crossFieldConstraints.validateModeConstraints，按档案声明判）；
  // 这里只剩 APIMart 字段自动路由特有的一条：首尾帧和参考素材两组不能同时出现。

  const hasFrame = hasWireValue(body.first_frame_image) || hasWireValue(body.last_frame_image);
  const hasReference = hasWireValue(body.image_urls) || hasWireValue(body.video_urls) || hasWireValue(body.audio_urls);
  if (hasFrame && hasReference) {
    throw new Error(desktopT("minimaxH3.mixedReferences"));
  }
}

export function normalizeMinimaxH3Body(body: unknown, context?: RequestTransformContext): unknown {
  validateMinimaxH3Body(body, context);
  if (!isRecord(body)) return body;

  const hasFrame = hasWireValue(body.first_frame_image) || hasWireValue(body.last_frame_image);

  const normalized = { ...body };
  // APIMart 文档规定 I2V 比例由输入图片决定，显式 aspect_ratio 会被忽略；不把旧模式残值发出去。
  if (hasFrame) delete normalized.aspect_ratio;
  // 可选 webhook 的空字符串不是有效地址，省略它而不是把空字段交给上游校验。
  if (typeof normalized.webhook === "string" && normalized.webhook.trim() === "") delete normalized.webhook;
  return normalized;
}

registerRequestTransform("apimart-minimax-h3", normalizeMinimaxH3Body, validateMinimaxH3Body);
