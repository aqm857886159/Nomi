// 本地 ComfyUI「自定义 workflow 导入」后端（S3）。纯函数、零副作用、可单测。
// plan: docs/plan/2026-07-15-comfyui-custom-workflow.md
//
// 用户可粘贴 ComfyUI 保存的 workflow.json，或 Workflow → Export (API) 导出的 workflow_api.json。
// 本模块：① 校验是 API 格式（非 UI 保存格式，最常见坑）；② 自动识别可绑定的节点输入（提示词/首帧/输出/数值）；
// ③ 按用户确认的绑定，把对应 input 的 widget 值替成 {{request.prompt}} / {{request.params.X}} 注参占位；
// ④ 产出用户自有的 model+mapping（走普通 upsert，不进 curated → 不被 seedBuiltins reconcile 覆盖）。
//
// API 格式（实查 docs.comfy.org/development/api-development/workflow-api-format 2026-07）：节点 ID 为键，
// 每节点 { inputs:{…}, class_type, _meta:{title} }；inputs 值要么是直接 widget 值（可参数化），
// 要么是连线 [源节点ID, 输出槽] （不可参数化，保持不动）。
import { COMFYUI_VENDOR_KEY, type HttpOperation } from "./types";
import { desktopT } from "../i18n";
import type { ComfyObjectInfoIndex } from "../comfyuiObjectInfo";
import { normalizeWorkflowBinding } from "./comfyuiWorkflowBindingNormalize";
import { comfyOutputCandidates, resolveComfyWorkflowOutput, suggestedComfyOutput } from "./comfyuiWorkflowOutput";
import { resolveComfyWorkflowTaskKind } from "./comfyuiWorkflowTaskContract";

export { inputKeyOf, roleBoundInputKeys } from "./comfyuiWorkflowBindingNormalize";
export { normalizeWorkflowBinding };

export type ComfyNode = {
  class_type?: string;
  inputs?: Record<string, unknown>;
  _meta?: { title?: string; nomi_bound_media_input?: string };
};
export type ComfyGraph = Record<string, ComfyNode>;

/** 一个可绑定的节点输入（widget 值，非连线）。 */
export type NodeInputCandidate = {
  nodeId: string; inputKey: string; classType: string; title?: string; value: string | number | boolean;
  /** 媒体输入才有：这个槽收图还是收视频（LoadVideo.file 收视频，绝不能当首帧图发）。 */
  mediaKind?: "image" | "video";
};
/** kind="unsupported"：识别得出是输出节点，但产物类型（3D/音频/矢量）Nomi 存不下 → 明着标缺口（D4），不硬塞成图。 */
export type OutputNodeCandidate = { nodeId: string; classType: string; kind: "image" | "video" | "model3d" | "unsupported" };
export type WorkflowNumericParam = { nodeId: string; inputKey: string; paramKey: string; label: string; default: number };
export type WorkflowParamType = "number" | "text" | "boolean";
export type WorkflowParamBinding = {
  nodeId: string;
  inputKey: string;
  paramKey: string;
  label: string;
  type: WorkflowParamType;
  default: string | number | boolean;
};

/** 一个绑定的媒体输入。**任意条**——工作流声明几个，这里就有几条。
 *
 *  为什么是列表而不是「首帧/尾帧/源视频」三个固定角色（2026-08-20 改）：
 *  ComfyUI 官方模型里**根本没有这三个概念**——一张工作流就是 N 个 LoadImage 节点，
 *  每个节点一个 `image` widget 收文件名（官方 workflow API format + POST /upload/image 文档实测）。
 *  那三个角色是 Nomi 这侧从「视频生成」倒推出来的，套不住任意图：
 *  一张声明 3 个参考图的工作流，结构上最多只能绑到 2 个，且必须叫首帧/尾帧
 *  ——这就是群反馈「多参工作流只能连一张图」的根。改成按声明出条，几个就是几个。 */
export type WorkflowImageBinding = {
  nodeId: string;
  inputKey: string;
  /** → {{request.params.<paramKey>}}；老角色沿用 first_frame_url / last_frame_url / source_video_url，
   *  这样已存工作流的语义与画布的首帧/尾帧分组推断都不变。 */
  paramKey: string;
  /** 画布插槽上显示的名字，默认取节点标题 / 输入名。 */
  label: string;
  /** 收图还是收视频（LoadVideo.file 收视频，绝不能当首帧图发）。 */
  mediaKind: "image" | "video";
};

/** 绑定选择（自动建议或用户在 UI 里改）。 */
export type WorkflowBinding = {
  promptNodeId?: string; promptInputKey?: string;         // → {{request.prompt}}
  /** 媒体输入（任意条）。**消费侧只认这个**——下面三组老角色字段仅供 normalize 读时迁移。 */
  images?: WorkflowImageBinding[];
  /** @deprecated 读时由 normalizeWorkflowBinding 折进 images[]；写路径与消费路径都不要再用。 */
  firstFrameNodeId?: string; firstFrameInputKey?: string;
  /** @deprecated 同上。 */
  lastFrameNodeId?: string; lastFrameInputKey?: string;
  /** @deprecated 同上。 */
  sourceVideoNodeId?: string; sourceVideoInputKey?: string;
  outputNodeId?: string; outputKind?: "image" | "video" | "model3d";
  numeric?: WorkflowNumericParam[];                       // 旧字段：兼容已保存 workflow
  params?: WorkflowParamBinding[];                        // → {{request.params.comfy_X}}
};

/** 老角色 → 固定 paramKey。迁移与「新绑的图该叫什么」都从这里取，别在别处重打字面量。 */
export const LEGACY_IMAGE_ROLE_PARAM_KEYS = {
  firstFrame: "first_frame_url",
  lastFrame: "last_frame_url",
  sourceVideo: "source_video_url",
} as const;

export type WorkflowAnalysis = {
  textInputs: NodeInputCandidate[];
  imageInputs: NodeInputCandidate[];
  outputNodes: OutputNodeCandidate[];
  numericInputs: NodeInputCandidate[];
  widgetInputs: NodeInputCandidate[];
  suggested: WorkflowBinding;
};

/** `image-url`：媒体输入槽。画布侧 looksLikeImageUrlControl 认这个 type，
 *  于是通用出槽器 buildImageUrlSlots 会**按条出槽**——声明几个就长几个，不再靠 key 名瞎猜。 */
export type ParamControl = { key: string; label: string; type: WorkflowParamType | "select" | "image-url"; mediaKind?: "image" | "video"; default: number | string | boolean; options?: string[] };
export type ImportedWorkflow = { templatedGraph: ComfyGraph; parameters: ParamControl[]; kind: "image" | "video" | "model3d"; taskKind: "text_to_image" | "image_edit" | "text_to_video" | "image_to_video" | "text_to_3d" | "image_to_3d" };
export type ComfyWorkflowImportDraft = { text: string; binding: WorkflowBinding; uiWorkflowText?: string };
/** (classType, inputKey) → 本机 combo 可选值（reconcile 顺手带出；导入/保存时烤进参数控件）。 */
export type WorkflowEnumOption = { classType: string; inputKey: string; options: string[] };

// 节点类型识别（R5：class_type 命名——CLIPTextEncode/LoadImage/VHS_VideoCombine/SaveVideo/SaveImage/
// WanVideoWrapper 系；宽松正则容社区变体）。
const TEXT_ENCODE_RE = /textencode|encode.*text|cliptext/i;
const LOAD_IMAGE_RE = /loadimage/i;
/** 视频输入节点（视频编辑/视频转视频工作流的入口）。语料实测 52 处，此前完全绑不上。 */
const LOAD_VIDEO_RE = /loadvideo|vhs_loadvideo/i;
/**
 * 载入节点「装文件名的那个输入键」。
 *
 * ⚠️ **别写死 `image`**：真机 /object_info 实测 `LoadVideo` 的键叫 **`file`**（不是 image），
 * 259 张忠实语料里 29 个 LoadVideo **全部**用 file、零个用 image。早先只认 `image`，
 * 等于加了 LOAD_VIDEO_RE 也白加——视频输入一个都绑不上（首帧识别率一直卡在 59% 的原因之一）。
 * 教训：节点输入键必须拿真服务器的 object_info 对，不能照着自己编的 fixture 写。
 */
const MEDIA_INPUT_KEYS = new Set(["image", "file", "video", "audio"]);
/**
 * 直接写在节点上的提示词键（云端 API 节点形态：prompt 就是节点自己的 widget，没有独立 CLIPTextEncode）。
 * 语料实测：154 张识别不出提示词的图里 112 张（73%）其实 prompt 字符串就摆在节点上——全部
 * ByteDance/Grok/Gemini/Kling/Runway 等云端节点工作流都踩这条。
 */
const INLINE_PROMPT_KEYS = new Set(["prompt", "positive_prompt", "text", "description"]);
/**
 * 明确**不是**正向提示词的键（命中 `*_prompt` 规则但语义相反/另有用途）。
 * 实测本机 ComfyUI 全量 object_info：negative_prompt 出现在 30 个节点类、system_prompt 9 个。
 */
const NON_POSITIVE_PROMPT_KEYS = new Set(["negative_prompt", "system_prompt"]);
/**
 * 「这个键名像不像正向提示词」——**按规则派生，不列白名单**（P2 修根因）。
 * 白名单追不完：实测真实键名有 prompt_text(3 类) / texture_prompt(2) / user_prompt / structured_prompt /
 * text_prompt / text_style_prompt……以后厂商还会造新的。规则=「叫 prompt/text/description，
 * 或以 _prompt 结尾、prompt_ 开头」，再减掉明确非正向的那几个。
 */
export function isPromptLikeKey(inputKey: string): boolean {
  const key = inputKey.toLowerCase();
  if (NON_POSITIVE_PROMPT_KEYS.has(key) || key.includes("negative")) return false;
  return INLINE_PROMPT_KEYS.has(key) || key.endsWith("_prompt") || key.startsWith("prompt_");
}
/** text-encode 类节点上可能承载提示词的键（含 Flux 双编码器 clip_l/t5xxl、音频的 tags/lyrics）。 */
const TEXT_ENCODE_TEXT_KEYS = new Set(["text", "prompt", "clip_l", "t5xxl", "tags", "lyrics"]);
/** 像文件名/路径的字符串不是提示词（防把 "xxx.safetensors"、"video/ComfyUI" 当提示词）。 */
const FILENAME_LIKE_RE = /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|png|jpg|jpeg|webp|mp4|webm|wav|mp3|flac|json|yaml|txt)$|^[\w-]+\/[\w-]+$/i;
const STRING_SOURCE_RE = /primitive.*string|string.*multiline|stringinput|textinput/i;
const SWITCH_RE = /switch/i;
const PREVIEW_ANY_RE = /previewany/i;
const STRING_CONCAT_RE = /string.*concat|concat.*string/i;
const TEXT_GENERATE_RE = /textgenerate/i;
// 常见可暴露的数值 widget（按优先序去重，避免一张 WAN 图几十个数值全暴露成噪音）。
const NUMERIC_PRIORITY = ["seed", "steps", "cfg", "denoise", "width", "height", "length", "frames", "num_frames", "fps", "frame_rate", "batch_size"];
export const NUMERIC_LABEL: Record<string, string> = {
  seed: "随机种子", steps: "采样步数", cfg: "CFG 强度", denoise: "重绘幅度", width: "宽度", height: "高度",
  length: "帧数/时长", frames: "帧数", num_frames: "帧数", fps: "帧率", frame_rate: "帧率", batch_size: "批量",
};
function isLink(v: unknown): v is [string, number] {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number";
}

function candidateFromInput(graph: ComfyGraph, nodeId: string, inputKey: string): NodeInputCandidate | undefined {
  const node = graph[nodeId];
  const value = node?.inputs?.[inputKey];
  if (!node || typeof value !== "string") return undefined;
  return { nodeId, inputKey, classType: node.class_type ?? "", title: node._meta?.title, value };
}

function resolveBooleanInput(graph: ComfyGraph, value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (!isLink(value)) return undefined;
  const node = graph[value[0]];
  const linkedValue = node?.inputs?.value;
  return typeof linkedValue === "boolean" ? linkedValue : undefined;
}

function resolveTextSourceFromInput(graph: ComfyGraph, value: unknown, visited: Set<string>): NodeInputCandidate | undefined {
  if (!isLink(value)) return undefined;
  return resolveTextSourceFromNode(graph, value[0], visited);
}

function resolveFirstTextSource(graph: ComfyGraph, nodeId: string, inputKeys: string[], visited: Set<string>): NodeInputCandidate | undefined {
  for (const inputKey of inputKeys) {
    const direct = candidateFromInput(graph, nodeId, inputKey);
    if (direct) return direct;
    const linked = resolveTextSourceFromInput(graph, graph[nodeId]?.inputs?.[inputKey], visited);
    if (linked) return linked;
  }
  return undefined;
}

function resolveTextSourceFromNode(graph: ComfyGraph, nodeId: string, visited: Set<string>): NodeInputCandidate | undefined {
  if (visited.has(nodeId)) return undefined;
  visited.add(nodeId);
  const node = graph[nodeId];
  const classType = node?.class_type ?? "";
  const inputs = node?.inputs;
  if (!node || !inputs || typeof inputs !== "object") return undefined;

  if (STRING_SOURCE_RE.test(classType)) return candidateFromInput(graph, nodeId, "value");

  if (SWITCH_RE.test(classType)) {
    const branch = resolveBooleanInput(graph, inputs.switch) === true ? "on_true" : "on_false";
    return (
      resolveTextSourceFromInput(graph, inputs[branch], visited)
      ?? resolveTextSourceFromInput(graph, inputs.on_false, visited)
      ?? resolveTextSourceFromInput(graph, inputs.on_true, visited)
    );
  }

  if (PREVIEW_ANY_RE.test(classType)) return resolveTextSourceFromInput(graph, inputs.source, visited);

  if (STRING_CONCAT_RE.test(classType)) {
    return resolveFirstTextSource(graph, nodeId, ["string_b", "string_a"], visited);
  }

  if (TEXT_GENERATE_RE.test(classType)) return resolveTextSourceFromInput(graph, inputs.prompt, visited);

  return resolveFirstTextSource(graph, nodeId, ["text", "prompt", "value", "string", "source"], visited);
}

function pushUniqueCandidate(candidates: NodeInputCandidate[], candidate: NodeInputCandidate | undefined): void {
  if (!candidate) return;
  if (candidates.some((c) => c.nodeId === candidate.nodeId && c.inputKey === candidate.inputKey)) return;
  candidates.push(candidate);
}

function pushScalarWidgetCandidate(candidates: NodeInputCandidate[], nodeId: string, node: ComfyNode, inputKey: string, value: unknown): void {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return;
  pushUniqueCandidate(candidates, { nodeId, inputKey, classType: node.class_type ?? "", title: node._meta?.title, value });
}

/** 解析 + 校验 workflow_api.json。非 API 格式（UI 保存格式）给明确可行动的提示。 */
export function parseComfyApiWorkflow(text: string): ComfyGraph {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(desktopT("comfyWorkflow.invalidJson"));
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error(desktopT("comfyWorkflow.invalidShape"));
  const obj = json as Record<string, unknown>;
  // UI 保存格式（nodes[]+links[]）≠ API 格式 → 明确提示（治「导错格式」最常见坑）。
  if (Array.isArray(obj.nodes) || Array.isArray(obj.links)) {
    throw new Error(desktopT("comfyWorkflow.uiFormat"));
  }
  const entries = Object.entries(obj);
  if (entries.length === 0) throw new Error(desktopT("comfyWorkflow.empty"));
  for (const [id, node] of entries) {
    if (!node || typeof node !== "object" || Array.isArray(node) || typeof (node as ComfyNode).class_type !== "string") {
      throw new Error(desktopT("comfyWorkflow.missingClassType", { id }));
    }
  }
  return obj as ComfyGraph;
}

/**
 * 找「正向提示词」目标：沿 positive 连线**一路追到底**的那个节点 id。
 *
 * ⚠️ 只走一跳会撞在中间节点上：WAN/LTX/Flux 这类图的链是
 * `KSampler.positive → WanImageToVideo.positive → CLIPTextEncode`，
 * 一跳只拿到 WanImageToVideo（它自己也有 positive），于是 byPositive 落空、
 * 掉进长度启发式 → **选中负向提示词**（负向几乎总比正向长一大串质量词）。
 * WAN2.2 内置模板就是这么把用户的提示词灌进反向槽的（单测抓到，语料里同型图 60+ 张）。
 */
function findPositiveTargetId(graph: ComfyGraph): string | undefined {
  let current: string | undefined;
  for (const node of Object.values(graph)) {
    if (isLink(node.inputs?.positive)) { current = (node.inputs.positive as [string, number])[0]; break; }
  }
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const next = graph[current]?.inputs?.positive;
    if (!isLink(next)) return current;
    current = next[0];
  }
  return current;
}

/** 这个候选是不是**负向**提示词（标题/键名说了算——负向绝不能当用户提示词的落点）。 */
function isNegativeCandidate(c: NodeInputCandidate): boolean {
  return /negative|负向|反向/i.test(`${c.title ?? ""} ${c.inputKey}`);
}

function candidateForNodeInput(candidates: NodeInputCandidate[], nodeId: string | undefined, inputKey: string): NodeInputCandidate | undefined {
  return candidates.find((c) => c.nodeId === nodeId && c.inputKey === inputKey);
}

function findLinkedInputTargetId(graph: ComfyGraph, inputKeys: string[]): string | undefined {
  for (const node of Object.values(graph)) {
    const inputs = node.inputs || {};
    for (const inputKey of inputKeys) {
      const value = inputs[inputKey];
      if (isLink(value)) return value[0];
    }
  }
  return undefined;
}

/**
 * 「这个字符串 widget 是不是提示词」——云端 API 节点（ByteDance/Grok/Gemini/Kling/Runway…）把 prompt
 * 直接写在自己节点上，没有独立 CLIPTextEncode 可追。判据保守：键名在白名单 + 非空 + 不像文件名/路径。
 * 不要求 TEXT_ENCODE_RE（那正是这类节点没有的）。
 */
function isInlinePromptWidget(classType: string, inputKey: string, value: string): boolean {
  if (!isPromptLikeKey(inputKey)) return false;
  const text = value.trim();
  if (!text || FILENAME_LIKE_RE.test(text)) return false;
  // 已被 TEXT_ENCODE 分支收过的不重复收（那条走连线追溯，语义更准）。
  return !TEXT_ENCODE_RE.test(classType) || inputKey === "positive_prompt" || inputKey === "description";
}

/**
 * 挑建议提示词：① 被 positive 连线指向的（语义最准）→ ② 排除负向后、键名像提示词的里挑最长
 * → ③ 第一个非负向 → ④ 兜底第一个。
 *
 * **负向必须先排除再谈长度**：负向提示词几乎总比正向长（一长串质量词），
 * 单纯按长度排序等于专挑负向。键名判定走 isPromptLikeKey（规则派生），
 * 厂商新造的 xxx_prompt 自动进候选，不必再改这里。
 */
function pickSuggestedPrompt(textInputs: NodeInputCandidate[], positiveId: string | undefined): NodeInputCandidate | undefined {
  const byPositive = textInputs.find((t) => t.nodeId === positiveId);
  if (byPositive) return byPositive;
  const positives = textInputs.filter((t) => !isNegativeCandidate(t));
  const promptish = positives
    .filter((t) => isPromptLikeKey(t.inputKey) && typeof t.value === "string")
    .sort((a, b) => String(b.value).length - String(a.value).length);
  return promptish[0] ?? positives[0] ?? textInputs[0];
}

/** 扫全图，识别可绑定输入 + 给出建议绑定。 */
export function analyzeComfyWorkflow(graph: ComfyGraph): WorkflowAnalysis {
  const textInputs: NodeInputCandidate[] = [];
  const imageInputs: NodeInputCandidate[] = [];
  const numericInputs: NodeInputCandidate[] = [];
  const widgetInputs: NodeInputCandidate[] = [];
  const outputNodes = comfyOutputCandidates(graph);

  for (const [nodeId, node] of Object.entries(graph)) {
    const classType = node.class_type ?? "";
    const inputs = node.inputs && typeof node.inputs === "object" ? node.inputs : {};
    for (const [inputKey, value] of Object.entries(inputs)) {
      // 提示词**从连线进来**时追到可注入的源头。判据用 isPromptLikeKey（规则派生），**不限节点类型**——
      // 早先这里卡了 TEXT_ENCODE_RE，等于「只有 CLIPTextEncode 系的连线提示词才追」。于是任何把 prompt
      // 做成输入槽的节点（云端 API 节点、以及 ComfyUI 0.30 子图把 prompt 提升成子图入参后的形态）
      // 都会掉到下面 `isLink → continue`，提示词节点整个识别不出来，只能由用户手动指。
      // 实例：MiniMax H3 官方模板把整条管线打包进子图，prompt 提升到子图边界 →
      // 展开后落在 MiniMaxH3ImageToVideo.prompt 这个**连线**输入上（非 text-encode 类）。
      if (isPromptLikeKey(inputKey) && isLink(value)) {
        pushUniqueCandidate(textInputs, resolveTextSourceFromInput(graph, value, new Set([nodeId])));
        continue;
      }
      if (isLink(value)) continue; // 连线不可参数化；提示词连线已在上方追溯到可注入源
      const isMediaInput =
        typeof value === "string" &&
        MEDIA_INPUT_KEYS.has(inputKey) &&
        (LOAD_IMAGE_RE.test(classType) || LOAD_VIDEO_RE.test(classType));
      if (!isMediaInput) {
        pushScalarWidgetCandidate(widgetInputs, nodeId, node, inputKey, value);
      }
      if (typeof value === "string" && TEXT_ENCODE_RE.test(classType) && TEXT_ENCODE_TEXT_KEYS.has(inputKey)) {
        // text-encode 变体的多文本键：CLIPTextEncodeFlux 的 clip_l/t5xxl、TextEncodeAceStepAudio 的 tags/lyrics。
        textInputs.push({ nodeId, inputKey, classType, title: node._meta?.title, value });
      } else if (typeof value === "string" && STRING_SOURCE_RE.test(classType) && inputKey === "value" && value.trim()) {
        // 独立字符串节点（PrimitiveStringMultiline 等）直接摆着提示词、没连去 text-encode 的情形。
        textInputs.push({ nodeId, inputKey, classType, title: node._meta?.title, value });
      } else if (typeof value === "string" && isInlinePromptWidget(classType, inputKey, value)) {
        // 云端 API 节点形态：prompt 直接是节点自己的 widget（没有独立 CLIPTextEncode 可追）。
        textInputs.push({ nodeId, inputKey, classType, title: node._meta?.title, value });
      } else if (isMediaInput) {
        const mediaKind = LOAD_VIDEO_RE.test(classType) ? ("video" as const) : ("image" as const);
        imageInputs.push({ nodeId, inputKey, classType, title: node._meta?.title, value: value as string, mediaKind });
      } else if (typeof value === "number" && NUMERIC_PRIORITY.includes(inputKey)) {
        numericInputs.push({ nodeId, inputKey, classType, title: node._meta?.title, value });
      }
    }
  }

  const positiveId = findPositiveTargetId(graph);
  const suggestedPrompt = pickSuggestedPrompt(textInputs, positiveId);
  // ⚠️ widgetInputs 是**完整**的标量池，故意不在这里摘掉提示词。
  //
  // 2026-08-03 那版在这里 splice 掉「被建议当提示词的那一个」，治了症状没治根：候选池被钉死在
  // 分析那一刻的建议上。用户一旦自己改提示词绑定（自动认错时他一定会改），新选中的那个还留在
  // 参数池里、原先被摘走的那个也回不来——这正是用户 2026-08-11 又报一次的形态。
  // 根因是「谁该被排除」取决于**当前绑定**，不是分析时的一次性猜测，所以排除必须由消费方按
  // 当前 binding 现算（渲染层 comfyuiParamCandidates.ts），这里只负责给全量事实。
  // 真正的correctness兜底在 buildImportedWorkflow：同一个输入既当提示词又当参数时，
  // 参数占位会把 {{request.prompt}} 覆盖掉（用户的提示词静默丢失），那里结构性拒掉。
  const startImageId = findLinkedInputTargetId(graph, ["start_image", "first_image", "first_frame", "image", "video"]);
  const endImageId = findLinkedInputTargetId(graph, ["end_image", "last_image", "last_frame"]);
  // 视频输入（LoadVideo.file）另立一槽 —— 它收的是**视频**，绝不能当首帧图发出去
  //（补帧/视频超分/视频去背景这类「视频进视频出」的工作流入口，语料 29 张）。
  const videoInputs = imageInputs.filter((i) => i.mediaKind === "video");
  const stillInputs = imageInputs.filter((i) => i.mediaKind !== "video");
  const suggestedSourceVideo = videoInputs[0];
  // 只有图里明确声明了 start/end，或确实只有一个/两个静态输入时才给首尾语义。
  // 三张以上的 LoadImage 通常是角色/风格/构图等多参引用；把第一张擅自叫「首帧」会让
  // 画布把通用参考误投到 first_frame_url，正是用户反馈的「多参被压成一张」的另一种变体。
  const suggestedFirstFrame = candidateForNodeInput(stillInputs, startImageId, "image")
    ?? (stillInputs.length <= 2 ? stillInputs[0] : undefined);
  const suggestedLastFrame = candidateForNodeInput(stillInputs, endImageId, "image")
    ?? (stillInputs.length === 2 ? stillInputs[1] : undefined);
  const suggestedImageTargets = new Set<string>();
  const suggestedImages: WorkflowImageBinding[] = [];
  for (let index = 0; index < imageInputs.length; index += 1) {
    const candidate = imageInputs[index];
    const target = `${candidate.nodeId} ${candidate.inputKey}`;
    if (suggestedImageTargets.has(target)) continue;
    suggestedImageTargets.add(target);
    const isSourceVideo = candidate.nodeId === suggestedSourceVideo?.nodeId && candidate.inputKey === suggestedSourceVideo.inputKey;
    const isFirstFrame = candidate.nodeId === suggestedFirstFrame?.nodeId && candidate.inputKey === suggestedFirstFrame.inputKey;
    const isLastFrame = candidate.nodeId === suggestedLastFrame?.nodeId && candidate.inputKey === suggestedLastFrame.inputKey;
    const paramKey = isSourceVideo
      ? LEGACY_IMAGE_ROLE_PARAM_KEYS.sourceVideo
      : isFirstFrame
        ? LEGACY_IMAGE_ROLE_PARAM_KEYS.firstFrame
        : isLastFrame
          ? LEGACY_IMAGE_ROLE_PARAM_KEYS.lastFrame
          : `comfy_${candidate.mediaKind ?? "image"}_${index + 1}`;
    suggestedImages.push({
      nodeId: candidate.nodeId,
      inputKey: candidate.inputKey,
      paramKey,
      label: candidate.title?.trim() || candidate.inputKey,
      mediaKind: candidate.mediaKind ?? "image",
    });
  }
  const suggestedOutput = suggestedComfyOutput(outputNodes);
  // 建议数值参数：按优先序每个 inputKey 只取第一个（去重，clean）。
  const seenKey = new Set<string>();
  const suggestedNumeric: WorkflowNumericParam[] = [];
  const suggestedParams: WorkflowParamBinding[] = [];
  for (const key of NUMERIC_PRIORITY) {
    const hit = numericInputs.find((n) => n.inputKey === key);
    if (hit && !seenKey.has(key)) {
      seenKey.add(key);
      const param = { nodeId: hit.nodeId, inputKey: key, paramKey: `comfy_${key}`, label: NUMERIC_LABEL[key] ?? key, default: hit.value as number };
      suggestedNumeric.push(param);
      suggestedParams.push({ ...param, type: "number" });
    }
  }

  return {
    textInputs, imageInputs, outputNodes, numericInputs, widgetInputs,
    suggested: {
      promptNodeId: suggestedPrompt?.nodeId, promptInputKey: suggestedPrompt?.inputKey,
      images: suggestedImages,
      firstFrameNodeId: suggestedFirstFrame?.nodeId, firstFrameInputKey: suggestedFirstFrame?.inputKey,
      lastFrameNodeId: suggestedLastFrame?.nodeId, lastFrameInputKey: suggestedLastFrame?.inputKey,
      sourceVideoNodeId: suggestedSourceVideo?.nodeId, sourceVideoInputKey: suggestedSourceVideo?.inputKey,
      outputNodeId: suggestedOutput?.outputNodeId, outputKind: suggestedOutput?.outputKind,
      numeric: suggestedNumeric,
      params: suggestedParams,
    },
  };
}

/** 一条「引用了本机没有的文件/选项」记录（combo 枚举对不上：checkpoint/LoRA/VAE 文件名、采样器名…）。 */
export type MissingEnumValue = { nodeId: string; classType: string; title?: string; inputKey: string; value: string };
export type WorkflowReconcile = {
  /** 本机 ComfyUI 没装的节点类（缺自定义节点包，运行必失败）。 */
  unknownNodeTypes: string[];
  /** 输入值不在本机 combo 可选项里（多半 = 作者机器上的模型文件名，本机没这个文件）。 */
  missingEnumValues: MissingEnumValue[];
};

/**
 * 导入时对账（纯函数）：workflow 每个节点/每个标量输入 vs 本机 /object_info 能力索引。
 * 抄自 Krita AI Diffusion 的「清单 vs object_info」思路（generic 版：不需要预置清单，全图逐项核）——
 * 缺节点/缺模型是 ComfyUI 接入第一死因，在导入面板就说清，不等 /prompt 400 或 execution_error 再猜。
 */
export function reconcileComfyWorkflow(graph: ComfyGraph, index: ComfyObjectInfoIndex): WorkflowReconcile {
  const unknown = new Set<string>();
  const missingEnumValues: MissingEnumValue[] = [];
  for (const [nodeId, node] of Object.entries(graph)) {
    const classType = node.class_type ?? "";
    if (!index.classNames.has(classType)) {
      unknown.add(classType);
      continue; // 类都没有，枚举无从核对
    }
    const enums = index.enumsByClass.get(classType);
    if (!enums) continue;
    const inputs = node.inputs && typeof node.inputs === "object" ? node.inputs : {};
    for (const [inputKey, value] of Object.entries(inputs)) {
      if (typeof value !== "string" || !value.trim() || value.includes("{{")) continue; // 连线/空值/模板占位不核
      const options = enums.get(inputKey);
      if (!options || options.includes(value)) continue;
      missingEnumValues.push({ nodeId, classType, title: node._meta?.title, inputKey, value });
    }
  }
  return { unknownNodeTypes: [...unknown], missingEnumValues };
}

/** 单个 combo 选项列表烤入上限（2000 个 LoRA 的机器别把 catalog 撑爆；对账/报错不受此限）。 */
const ENUM_BAKE_CAP = 400;

/**
 * 收集「图里出现的 (classType, inputKey) → 本机 combo 可选值」（纯函数）。
 * reconcile 时顺手带出，导入/保存时经 buildImportedWorkflow 烤进参数控件——
 * checkpoint/LoRA 这类文件名参数在画布上变成列真实文件的下拉，不再手抄文件名拼错 400。
 */
export function collectGraphEnumOptions(graph: ComfyGraph, index: ComfyObjectInfoIndex): WorkflowEnumOption[] {
  const seen = new Set<string>();
  const out: WorkflowEnumOption[] = [];
  for (const node of Object.values(graph)) {
    const enums = index.enumsByClass.get(node.class_type ?? "");
    if (!enums) continue;
    const inputs = node.inputs && typeof node.inputs === "object" ? node.inputs : {};
    for (const [inputKey, value] of Object.entries(inputs)) {
      if (typeof value !== "string") continue; // combo widget 值必为字符串；连线/数值不核
      const options = enums.get(inputKey);
      if (!options || options.length === 0) continue;
      const key = `${node.class_type} ${inputKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ classType: node.class_type ?? "", inputKey, options: options.slice(0, ENUM_BAKE_CAP) });
    }
  }
  return out;
}

function setInput(graph: ComfyGraph, nodeId: string, inputKey: string, value: string): void {
  const node = graph[nodeId];
  if (node && node.inputs && typeof node.inputs === "object") node.inputs[inputKey] = value;
}

function setMediaInput(graph: ComfyGraph, nodeId: string, inputKey: string, value: string): void {
  const node = graph[nodeId];
  if (!node || !node.inputs || typeof node.inputs !== "object") return;
  node.inputs[inputKey] = value;
  node._meta = { ...node._meta, nomi_bound_media_input: inputKey };
}

/** 按绑定把 widget 值替成注参占位，产出 templated 图 + 参数控件 + kind + taskKind。
 *  enumOptions（可选，来自 reconcile）：文本型参数命中本机 combo → 烤成 select（画布下拉列真实文件名）。 */
export function buildImportedWorkflow(graph: ComfyGraph, binding: WorkflowBinding, enumOptions?: WorkflowEnumOption[]): ImportedWorkflow {
  const normalizedBinding = normalizeWorkflowBinding(binding, graph);
  const templated: ComfyGraph = JSON.parse(JSON.stringify(graph)); // 深拷贝（纯 JSON 图），不改原图
  if (normalizedBinding.promptNodeId && normalizedBinding.promptInputKey) {
    setInput(templated, normalizedBinding.promptNodeId, normalizedBinding.promptInputKey, "{{request.prompt}}");
  }
  const enumFor = new Map((enumOptions ?? []).map((e) => [`${e.classType} ${e.inputKey}`, e.options]));
  const parameters: ParamControl[] = [];
  // 媒体输入：声明几条就注几条参、出几个槽。
  // 值在运行时由 comfyui-upload 换成 ComfyUI 自己的文件名——本地 ComfyUI 的 LoadImage/LoadVideo
  // 只认它 input 目录里的文件名，不认公网 URL（官方 POST /upload/image 返回 {name} 正是此用途；
  // 视频同走这个端点，实测返回的文件名当场出现在 LoadVideo.file 的 combo 里）。
  // 把它们**推进 parameters[]** 是关键一步：画布侧通用出槽器 buildImageUrlSlots 读的就是这里，
  // 于是 N 条声明自动长出 N 个槽，不再需要任何「首帧/尾帧」特例。
  for (const image of normalizedBinding.images ?? []) {
    setMediaInput(templated, image.nodeId, image.inputKey, `{{request.params.${image.paramKey}}}`);
    parameters.push({ key: image.paramKey, label: image.label || image.inputKey, type: "image-url", mediaKind: image.mediaKind, default: "" });
  }
  for (const np of normalizedBinding.params ?? []) {
    const paramKey = np.paramKey;
    setInput(templated, np.nodeId, np.inputKey, `{{request.params.${paramKey}}}`);
    const defaultValue = np.default;
    const resolvedType = np.type;
    const options = resolvedType === "text" ? enumFor.get(`${graph[np.nodeId]?.class_type ?? ""} ${np.inputKey}`) : undefined;
    if (options && options.length > 0) {
      // default 不在本机选项里（离线导入的作者值）→ 前置保留，绝不静默丢用户值。
      const defaultText = String(defaultValue);
      parameters.push({
        key: paramKey, label: np.label || np.inputKey, type: "select", default: defaultValue,
        options: options.includes(defaultText) ? options : [defaultText, ...options],
      });
      continue;
    }
    parameters.push({ key: paramKey, label: np.label || np.inputKey, type: resolvedType, default: defaultValue });
  }
  const { outputKind } = resolveComfyWorkflowOutput(graph, normalizedBinding);
  // 视频输入**不进** taskKind 的判据：ProfileKind 没有 video_to_video，而画布侧 resolveTaskKind
  // 只按「有没有图输入」分 image_to_video/text_to_video。这里硬造一个新枚举，会让画布算出的 kind
  // 与 mapping 登记的对不上 → 选不到 mapping → 直接报「没有可用模型」。所以视频走「参考视频」通道
  // （连一条视频边 → extras.referenceVideoUrls → electron 派生 source_video_url），kind 仍按图输入分桶。
  const taskKind = resolveComfyWorkflowTaskKind(outputKind, normalizedBinding.images ?? []);
  return { templatedGraph: templated, parameters, kind: outputKind, taskKind };
}

/**
 * 产出用户自有 model + mapping（走普通 upsert，非 curated → 不被 reconcile 覆盖）。
 * create/query op 与 curated 文生图同构（/prompt 提交 + /history 轮询 + comfyui-history 变换）。
 */
export function buildComfyImportModelMapping(
  imported: ImportedWorkflow,
  opts: { modelKey: string; labelZh: string; draft?: ComfyWorkflowImportDraft; vendorKey?: string },
): { model: Record<string, unknown>; mapping: Record<string, unknown> } {
  // 多实例：工作流归属**哪一台** ComfyUI（缺省第一台）。地址由该 vendor 的 baseUrlHint 决定，
  // 故同一张图导到两台机器互不干扰、各按各的缺件情况跑。
  const vendorKey = opts.vendorKey || COMFYUI_VENDOR_KEY;
  let normalizedDraft: ComfyWorkflowImportDraft | undefined;
  if (opts.draft) {
    let draftGraph: ComfyGraph | undefined;
    try {
      draftGraph = parseComfyApiWorkflow(opts.draft.text);
    } catch {
      // 旧草稿可能残缺；仍收敛 binding 形状，不能把未校验的 payload 重新写回目录。
    }
    const normalizedBinding = normalizeWorkflowBinding(opts.draft.binding, draftGraph);
    normalizedDraft = {
      text: opts.draft.text,
      binding: {
        ...normalizedBinding,
        ...(draftGraph ? resolveComfyWorkflowOutput(draftGraph, normalizedBinding) : {}),
      },
      ...(opts.draft.uiWorkflowText ? { uiWorkflowText: opts.draft.uiWorkflowText } : {}),
    };
  }
  let uiWorkflow: Record<string, unknown> | null = null;
  if (normalizedDraft?.uiWorkflowText) {
    try {
      const parsed = JSON.parse(normalizedDraft.uiWorkflowText) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) uiWorkflow = parsed as Record<string, unknown>;
    } catch { /* 已保存草稿可能来自旧版本手改，坏元数据不影响 API prompt 执行 */ }
  }
  const create: HttpOperation = {
    method: "POST",
    path: "/prompt",
    headers: { "Content-Type": "application/json" },
    body: {
      prompt: imported.templatedGraph,
      client_id: "nomi",
      ...(normalizedDraft?.binding.outputNodeId ? { partial_execution_targets: [normalizedDraft.binding.outputNodeId] } : {}),
      ...(uiWorkflow ? { extra_data: { extra_pnginfo: { workflow: uiWorkflow } } } : {}),
    },
    response_mapping: { task_id: "prompt_id" },
    request_transform: "comfyui-prompt",
    defaultParams: Object.fromEntries(imported.parameters.map((p) => [p.key, p.default])),
  };
  const query: HttpOperation = {
    method: "GET",
    path: "/history/{{providerMeta.task_id}}",
    response_transform: "comfyui-history",
    // 各类产物读各自的键（runtime 的 mappedAssetValues 认 image_url/video_url/model_url）。
    response_mapping:
      imported.kind === "video"
        ? { video_url: "video_url", error_message: "error" }
        : imported.kind === "model3d"
          ? { model_url: "model_url", error_message: "error" }
          : { image_url: "image_url", error_message: "error" },
  };
  return {
    model: {
      modelKey: opts.modelKey,
      vendorKey,
      labelZh: opts.labelZh,
      kind: imported.kind,
      // Import is staging, not verification. Task 5 may promote it after a real output passes
      // the shared media certification boundary; a downloaded/status=success artifact alone is insufficient.
      enabled: false,
      meta: {
        parameters: imported.parameters,
        ...(normalizedDraft ? { comfyWorkflowImport: normalizedDraft } : {}),
      },
    },
    mapping: { vendorKey, taskKind: imported.taskKind, modelKey: opts.modelKey, name: opts.labelZh, enabled: false, create, query },
  };
}

/** slug 化标签成 modelKey 片段（ASCII 保底，中文/空白 → comfy-<时间戳>）。 */
export function slugifyModelKey(labelZh: string, uniq: string): string {
  const slug = String(labelZh || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 32);
  return `comfy-${slug || "workflow"}-${uniq}`;
}

/** 编排：解析 → 建图 → 建 model+mapping → upsert（注入 store 写函数，可测、无副作用耦合）。 */
export function importComfyWorkflow(
  payload: { text: string; binding: WorkflowBinding; labelZh: string; modelKey: string; enumOptions?: WorkflowEnumOption[]; vendorKey?: string; uiWorkflowText?: string },
  upsertModel: (model: Record<string, unknown>) => void,
  upsertMapping: (mapping: Record<string, unknown>) => void,
): { modelKey: string; kind: "image" | "video" | "model3d"; taskKind: string } {
  const graph = parseComfyApiWorkflow(payload.text);
  const normalizedBinding = normalizeWorkflowBinding(payload.binding, graph);
  const binding = {
    ...normalizedBinding,
    ...resolveComfyWorkflowOutput(graph, normalizedBinding),
  };
  const built = buildImportedWorkflow(graph, binding, payload.enumOptions);
  const { model, mapping } = buildComfyImportModelMapping(built, {
    modelKey: payload.modelKey,
    labelZh: payload.labelZh,
    draft: { text: payload.text, binding, ...(payload.uiWorkflowText ? { uiWorkflowText: payload.uiWorkflowText } : {}) },
    ...(payload.vendorKey ? { vendorKey: payload.vendorKey } : {}),
  });
  upsertModel(model);
  upsertMapping(mapping);
  return { modelKey: payload.modelKey, kind: built.kind, taskKind: built.taskKind };
}
