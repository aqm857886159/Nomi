// 请求参数构建（从 runtime.ts 抽出，评审 M5：可测 + 不喂大 runtime）。
// 把一个 TaskRequest 摊平成模板引擎要的 `{{request.params.*}}` 取值表——含标量、尺寸、时长、
// 以及档案驱动的参考输入（referenceInputParams）。**纯函数、依赖注入级别的纯**，故可零网络单测。
//
// 为什么单独成文件还配测试：duration 这种"数字被 firstString 吞成空串"的坑、omni 参考数组该不该进
// params 的坑，都只在"真实参数构建"里暴露，埋在 2500 行 runtime 里既测不到也容易回归。
import { firstString, type JsonRecord } from "../jsonUtils";
import { referenceInputParams } from "./archetypeInput";

/** taskTemplateParams 实际用到的 TaskRequest 子集（结构化，避免与 runtime 的 TaskRequest 循环依赖）。 */
export type TaskParamsInput = {
  extras?: Record<string, unknown>;
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  cfgScale?: number;
  negativePrompt?: string;
};

export function firstReferenceImage(request: TaskParamsInput): string {
  const extras = request.extras || {};
  const referenceImages = Array.isArray(extras.referenceImages) ? extras.referenceImages : [];
  return firstString(
    extras.image_url,
    extras.imageUrl,
    extras.firstFrameUrl,
    extras.lastFrameUrl,
    referenceImages[0],
  );
}

/**
 * wire 必填参数兜底（headless/MCP 路）：UI 经 NodeGenerationComposer 按档案填好 size/voice/model 等；
 * 但 MCP/CLI 的 generate 不经 UI、也不暴露 params，缺必填参 vendor 直接拒（火山缺 size→400 / apimart 缺
 * model→500 / 豆包缺 voice→「未选择音色」）。把 mapping.create.defaultParams 合并到 extras **之下**
 * （既有值优先）：UI 路已填故零影响，headless 路得到一份能成的请求。纯函数（可单测）。
 */
export function applyWireDefaults(
  extras: Record<string, unknown> | undefined,
  defaultParams: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!defaultParams) return extras;
  return { ...defaultParams, ...(extras || {}) };
}

export function taskTemplateParams(request: TaskParamsInput): JsonRecord {
  const extras = request.extras || {};
  const size = request.width && request.height ? `${request.width}x${request.height}` : firstString(extras.size, extras.aspectRatio);
  // duration 可能是数字（节点「5s」标量参数存的就是 number 5）——firstString 只认字符串会把它吞成 ""，
  // 导致 body 的 duration 为空（实测）。数字原样保留，字符串走 trim，缺省 ""。
  const durationRaw = extras.duration ?? extras.durationSeconds ?? extras.videoDuration;
  const duration = typeof durationRaw === "number" ? durationRaw : firstString(durationRaw);
  return {
    ...extras,
    size,
    n: extras.n ?? 1,
    width: request.width,
    height: request.height,
    seed: request.seed,
    steps: request.steps,
    cfgScale: request.cfgScale,
    cfg_scale: request.cfgScale,
    negative_prompt: request.negativePrompt,
    duration,
    image_url: firstReferenceImage(request),
    // 参考输入（单图首/尾帧 + 多参考数组）—— 构建逻辑在 electron/catalog/archetypeInput（M5）。
    ...referenceInputParams(extras),
    max_tokens: extras.maxTokens ?? extras.max_tokens,
  };
}
