// Lane D 生成质量评测维度(对标 VBench / VBench-I2V)。把「质量」拆成解耦维度逐维 1-5 打分,
// 而非单一分(VBench 核心思路:disentangled dimensions + 锚点)。VLM 看真实生成产物打分。
// 图:文图对齐 / 美学 / 成像质量;视频(I2V):再加主体一致 / 运动平滑 / 时序稳定 / 动态程度。
import { normalizeDimensionScore, postChatJson } from "./judge.mjs";

export const IMAGE_DIMENSIONS = [
  { key: "alignment", name: "文图对齐", desc: "图像主体/场景/动作是否符合提示词", anchors: { 5: "完全符合", 3: "主体对但细节偏", 1: "明显跑题" } },
  { key: "aesthetic", name: "美学质量", desc: "构图/色彩/光影的视觉质量", anchors: { 5: "构图色彩俱佳", 3: "中规中矩", 1: "构图混乱/配色差" } },
  { key: "imaging", name: "成像质量", desc: "清晰度 + 无伪影/无肢体崩坏/无文字乱码", anchors: { 5: "干净无硬伤", 3: "轻微瑕疵", 1: "肢体崩坏/乱码/重影等硬伤" } },
];

export const VIDEO_DIMENSIONS = [
  { key: "alignment", name: "文图对齐", desc: "画面与提示词是否一致", anchors: { 5: "完全符合", 3: "主体对但细节偏", 1: "明显跑题" } },
  { key: "subject_consistency", name: "主体一致", desc: "主体外观跨帧是否稳定(决定像不像一个片子)", anchors: { 5: "跨帧稳定", 3: "偶有漂移", 1: "主体明显变形/变身" } },
  { key: "motion_smoothness", name: "运动平滑", desc: "运动是否自然连贯、无跳变", anchors: { 5: "流畅自然", 3: "略生硬", 1: "卡顿/瞬移/抽搐" } },
  { key: "temporal_stability", name: "时序稳定", desc: "无闪烁、无无故突变", anchors: { 5: "稳定", 3: "轻微闪烁", 1: "明显闪烁/画面突变" } },
  { key: "dynamic_degree", name: "动态程度", desc: "是否有合理运动量(不是一张静止图)", anchors: { 5: "运动量恰当", 3: "偏静", 1: "几乎静止" } },
];

export function dimensionsFor(kind) {
  return kind === "video" ? VIDEO_DIMENSIONS : IMAGE_DIMENSIONS;
}

function buildRubricBlock(dims) {
  return dims
    .map((d) => `- ${d.key}「${d.name}」：${d.desc}\n    5档：${d.anchors[5]} ｜ 3档：${d.anchors[3]} ｜ 1档：${d.anchors[1]}`)
    .join("\n");
}

/**
 * VLM 给一个生成产物按维度 1-5 打分。images=base64 数据 URL 数组(图传 1 张;视频传抽样帧)。
 * 返回 { scores:{维度:1-5}, normalized:{维度:0-1}, qualityScore:0-1, reason }。解析失败冒泡。
 */
export async function scoreAssetWithVlm(cfg, { kind, prompt, images, model }) {
  const dims = dimensionsFor(kind);
  const keys = dims.map((d) => d.key);
  const intro = kind === "video"
    ? `下面是同一段生成视频的 ${images.length} 个抽样帧(按时间顺序)。逐维度按 Rubric 给整段视频打分(1-5 档)。`
    : "下面是一张生成图片。逐维度按 Rubric 打分(1-5 档)。";
  const content = [
    { type: "text", text: `${intro}\n提示词：${prompt || "(未知)"}\n<Rubric 逐维度 1-5 档>\n${buildRubricBlock(dims)}\n只输出 JSON: {"reason": string, "scores": {${keys.map((k) => `"${k}": 1-5`).join(", ")}}}。打分铁律:拿不准给保守(偏低)分;不要被高分辨率本身唬住,硬伤就低分。` },
    ...images.map((url) => ({ type: "image_url", image_url: { url } })),
  ];
  const parsed = await postChatJson(cfg, { model: model || cfg.visionModel || cfg.model, temperature: 0, stream: false, response_format: { type: "json_object" }, messages: [{ role: "user", content }] });
  if (!parsed.scores || typeof parsed.scores !== "object") throw new Error(`VLM 输出缺 scores: ${JSON.stringify(parsed).slice(0, 120)}`);
  const scores = {};
  const normalized = {};
  for (const d of dims) {
    const raw = Number(parsed.scores[d.key]);
    if (!Number.isFinite(raw)) throw new Error(`VLM 输出缺维度 ${d.key}`);
    scores[d.key] = Math.max(1, Math.min(5, raw));
    normalized[d.key] = normalizeDimensionScore(scores[d.key]);
  }
  const qualityScore = +(keys.reduce((s, k) => s + normalized[k], 0) / keys.length).toFixed(3);
  return { scores, normalized, qualityScore, reason: String(parsed.reason || "") };
}
