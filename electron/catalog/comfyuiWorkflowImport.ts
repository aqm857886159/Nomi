// 本地 ComfyUI「自定义 workflow 导入」后端（S3）。纯函数、零副作用、可单测。
// plan: docs/plan/2026-07-15-comfyui-custom-workflow.md
//
// 用户在 ComfyUI 里跑通一条工作流 → 菜单 Workflow → Export (API) 导出 workflow_api.json → 粘进 Nomi。
// 本模块：① 校验是 API 格式（非 UI 保存格式，最常见坑）；② 自动识别可绑定的节点输入（提示词/首帧/输出/数值）；
// ③ 按用户确认的绑定，把对应 input 的 widget 值替成 {{request.prompt}} / {{request.params.X}} 注参占位；
// ④ 产出用户自有的 model+mapping（走普通 upsert，不进 curated → 不被 seedBuiltins reconcile 覆盖）。
//
// API 格式（实查 docs.comfy.org/development/api-development/workflow-api-format 2026-07）：节点 ID 为键，
// 每节点 { inputs:{…}, class_type, _meta:{title} }；inputs 值要么是直接 widget 值（可参数化），
// 要么是连线 [源节点ID, 输出槽] （不可参数化，保持不动）。
import { COMFYUI_VENDOR_KEY, type HttpOperation } from "./types";

export type ComfyNode = { class_type?: string; inputs?: Record<string, unknown>; _meta?: { title?: string } };
export type ComfyGraph = Record<string, ComfyNode>;

/** 一个可绑定的节点输入（widget 值，非连线）。 */
export type NodeInputCandidate = { nodeId: string; inputKey: string; classType: string; title?: string; value: string | number | boolean };
export type OutputNodeCandidate = { nodeId: string; classType: string; kind: "image" | "video" };
export type WorkflowNumericParam = { nodeId: string; inputKey: string; paramKey: string; label: string; default: number };

/** 绑定选择（自动建议或用户在 UI 里改）。 */
export type WorkflowBinding = {
  promptNodeId?: string; promptInputKey?: string;         // → {{request.prompt}}
  firstFrameNodeId?: string; firstFrameInputKey?: string; // → {{request.params.first_frame_url}}（S2 上传后是 ComfyUI 文件名）
  lastFrameNodeId?: string; lastFrameInputKey?: string;   // → {{request.params.last_frame_url}}
  outputNodeId?: string; outputKind?: "image" | "video";
  numeric: WorkflowNumericParam[];                        // → {{request.params.comfy_X}}
};

export type WorkflowAnalysis = {
  textInputs: NodeInputCandidate[];
  imageInputs: NodeInputCandidate[];
  outputNodes: OutputNodeCandidate[];
  numericInputs: NodeInputCandidate[];
  suggested: WorkflowBinding;
};

export type ParamControl = { key: string; label: string; type: "number" | "text" | "select"; default: number | string };
export type ImportedWorkflow = { templatedGraph: ComfyGraph; parameters: ParamControl[]; kind: "image" | "video"; taskKind: "text_to_image" | "image_edit" | "text_to_video" | "image_to_video" };
export type ComfyWorkflowImportDraft = { text: string; binding: WorkflowBinding };

// 节点类型识别（R5：class_type 命名——CLIPTextEncode/LoadImage/VHS_VideoCombine/SaveVideo/SaveImage/
// WanVideoWrapper 系；宽松正则容社区变体）。
const TEXT_ENCODE_RE = /textencode|encode.*text|cliptext/i;
const LOAD_IMAGE_RE = /loadimage/i;
const VIDEO_OUT_RE = /videocombine|savevideo|saveanimated|savewebp|createvideo/i;
const IMAGE_OUT_RE = /saveimage/i;
const STRING_SOURCE_RE = /primitive.*string|string.*multiline|stringinput|textinput/i;
const SWITCH_RE = /switch/i;
const PREVIEW_ANY_RE = /previewany/i;
const STRING_CONCAT_RE = /string.*concat|concat.*string/i;
const TEXT_GENERATE_RE = /textgenerate/i;
// 常见可暴露的数值 widget（按优先序去重，避免一张 WAN 图几十个数值全暴露成噪音）。
const NUMERIC_PRIORITY = ["seed", "steps", "cfg", "denoise", "width", "height", "length", "frames", "num_frames", "fps", "frame_rate", "batch_size"];
const NUMERIC_LABEL: Record<string, string> = {
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

/** 解析 + 校验 workflow_api.json。非 API 格式（UI 保存格式）给明确可行动的提示。 */
export function parseComfyApiWorkflow(text: string): ComfyGraph {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("不是合法 JSON —— 请粘贴 ComfyUI「Export (API)」导出的 workflow_api.json。");
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("workflow 格式不对（应是节点对象）。");
  const obj = json as Record<string, unknown>;
  // UI 保存格式（nodes[]+links[]）≠ API 格式 → 明确提示（治「导错格式」最常见坑）。
  if (Array.isArray(obj.nodes) || Array.isArray(obj.links)) {
    throw new Error("这是 ComfyUI 的「界面保存」格式，不是 API 格式。请在 ComfyUI 菜单 Workflow → Export (API) 导出后再粘贴。");
  }
  const entries = Object.entries(obj);
  if (entries.length === 0) throw new Error("workflow 是空的。");
  for (const [id, node] of entries) {
    if (!node || typeof node !== "object" || Array.isArray(node) || typeof (node as ComfyNode).class_type !== "string") {
      throw new Error(`节点 ${id} 缺 class_type —— 确认导出的是 API 格式（每个节点带 class_type + inputs）。`);
    }
  }
  return obj as ComfyGraph;
}

/** 找「正向提示词」目标：某节点的 positive 输入连到的那个 text-encode 节点 id。 */
function findPositiveTargetId(graph: ComfyGraph): string | undefined {
  for (const node of Object.values(graph)) {
    const pos = node.inputs?.positive;
    if (isLink(pos)) return pos[0];
  }
  return undefined;
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

/** 扫全图，识别可绑定输入 + 给出建议绑定。 */
export function analyzeComfyWorkflow(graph: ComfyGraph): WorkflowAnalysis {
  const textInputs: NodeInputCandidate[] = [];
  const imageInputs: NodeInputCandidate[] = [];
  const numericInputs: NodeInputCandidate[] = [];
  const outputNodes: OutputNodeCandidate[] = [];

  for (const [nodeId, node] of Object.entries(graph)) {
    const classType = node.class_type ?? "";
    const inputs = node.inputs && typeof node.inputs === "object" ? node.inputs : {};
    for (const [inputKey, value] of Object.entries(inputs)) {
      if (TEXT_ENCODE_RE.test(classType) && (inputKey === "text" || inputKey === "prompt") && isLink(value)) {
        pushUniqueCandidate(textInputs, resolveTextSourceFromInput(graph, value, new Set([nodeId])));
        continue;
      }
      if (isLink(value)) continue; // 连线不可参数化；提示词连线已在上方追溯到可注入源
      if (typeof value === "string" && TEXT_ENCODE_RE.test(classType) && (inputKey === "text" || inputKey === "prompt")) {
        textInputs.push({ nodeId, inputKey, classType, title: node._meta?.title, value });
      } else if (typeof value === "string" && LOAD_IMAGE_RE.test(classType) && inputKey === "image") {
        imageInputs.push({ nodeId, inputKey, classType, title: node._meta?.title, value });
      } else if (typeof value === "number" && NUMERIC_PRIORITY.includes(inputKey)) {
        numericInputs.push({ nodeId, inputKey, classType, title: node._meta?.title, value });
      }
    }
    if (VIDEO_OUT_RE.test(classType)) outputNodes.push({ nodeId, classType, kind: "video" });
    else if (IMAGE_OUT_RE.test(classType)) outputNodes.push({ nodeId, classType, kind: "image" });
  }

  const positiveId = findPositiveTargetId(graph);
  const suggestedPrompt = textInputs.find((t) => t.nodeId === positiveId) ?? textInputs[0];
  const startImageId = findLinkedInputTargetId(graph, ["start_image", "first_image", "first_frame", "image"]);
  const endImageId = findLinkedInputTargetId(graph, ["end_image", "last_image", "last_frame"]);
  const suggestedFirstFrame = candidateForNodeInput(imageInputs, startImageId, "image") ?? imageInputs[0];
  const suggestedLastFrame = candidateForNodeInput(imageInputs, endImageId, "image");
  // 视频输出优先（有视频节点就当视频工作流）；否则图片。
  const suggestedOutput = outputNodes.find((o) => o.kind === "video") ?? outputNodes[0];
  // 建议数值参数：按优先序每个 inputKey 只取第一个（去重，clean）。
  const seenKey = new Set<string>();
  const suggestedNumeric: WorkflowNumericParam[] = [];
  for (const key of NUMERIC_PRIORITY) {
    const hit = numericInputs.find((n) => n.inputKey === key);
    if (hit && !seenKey.has(key)) {
      seenKey.add(key);
      suggestedNumeric.push({ nodeId: hit.nodeId, inputKey: key, paramKey: `comfy_${key}`, label: NUMERIC_LABEL[key] ?? key, default: hit.value as number });
    }
  }

  return {
    textInputs, imageInputs, outputNodes, numericInputs,
    suggested: {
      promptNodeId: suggestedPrompt?.nodeId, promptInputKey: suggestedPrompt?.inputKey,
      firstFrameNodeId: suggestedFirstFrame?.nodeId, firstFrameInputKey: suggestedFirstFrame?.inputKey,
      lastFrameNodeId: suggestedLastFrame?.nodeId, lastFrameInputKey: suggestedLastFrame?.inputKey,
      outputNodeId: suggestedOutput?.nodeId, outputKind: suggestedOutput?.kind,
      numeric: suggestedNumeric,
    },
  };
}

function setInput(graph: ComfyGraph, nodeId: string, inputKey: string, value: string): void {
  const node = graph[nodeId];
  if (node && node.inputs && typeof node.inputs === "object") node.inputs[inputKey] = value;
}

/** 按绑定把 widget 值替成注参占位，产出 templated 图 + 参数控件 + kind + taskKind。 */
export function buildImportedWorkflow(graph: ComfyGraph, binding: WorkflowBinding): ImportedWorkflow {
  const templated: ComfyGraph = JSON.parse(JSON.stringify(graph)); // 深拷贝（纯 JSON 图），不改原图
  if (binding.promptNodeId && binding.promptInputKey) {
    setInput(templated, binding.promptNodeId, binding.promptInputKey, "{{request.prompt}}");
  }
  if (binding.firstFrameNodeId && binding.firstFrameInputKey) {
    // first_frame_url：S2 的 comfyui-upload 把本地首帧传进 ComfyUI 后，这个 param 里是 ComfyUI 的文件名。
    setInput(templated, binding.firstFrameNodeId, binding.firstFrameInputKey, "{{request.params.first_frame_url}}");
  }
  if (binding.lastFrameNodeId && binding.lastFrameInputKey) {
    setInput(templated, binding.lastFrameNodeId, binding.lastFrameInputKey, "{{request.params.last_frame_url}}");
  }
  const parameters: ParamControl[] = [];
  const seen = new Set<string>();
  for (const np of binding.numeric) {
    let paramKey = np.paramKey || `comfy_${np.inputKey}`;
    while (seen.has(paramKey)) paramKey = `${paramKey}_${np.nodeId}`; // 同名去重（两个 sampler 都有 seed）
    seen.add(paramKey);
    setInput(templated, np.nodeId, np.inputKey, `{{request.params.${paramKey}}}`);
    parameters.push({ key: paramKey, label: np.label || np.inputKey, type: "number", default: np.default });
  }
  const outputKind = binding.outputKind ?? "image";
  const hasFrameInput = Boolean(
    (binding.firstFrameNodeId && binding.firstFrameInputKey) ||
    (binding.lastFrameNodeId && binding.lastFrameInputKey),
  );
  const taskKind =
    outputKind === "video"
      ? hasFrameInput ? "image_to_video" : "text_to_video"
      : hasFrameInput ? "image_edit" : "text_to_image";
  return { templatedGraph: templated, parameters, kind: outputKind, taskKind };
}

/**
 * 产出用户自有 model + mapping（走普通 upsert，非 curated → 不被 reconcile 覆盖）。
 * create/query op 与 curated 文生图同构（/prompt 提交 + /history 轮询 + comfyui-history 变换）。
 */
export function buildComfyImportModelMapping(
  imported: ImportedWorkflow,
  opts: { modelKey: string; labelZh: string; draft?: ComfyWorkflowImportDraft },
): { model: Record<string, unknown>; mapping: Record<string, unknown> } {
  const create: HttpOperation = {
    method: "POST",
    path: "/prompt",
    headers: { "Content-Type": "application/json" },
    body: { prompt: imported.templatedGraph, client_id: "nomi" },
    response_mapping: { task_id: "prompt_id" },
    defaultParams: Object.fromEntries(imported.parameters.map((p) => [p.key, p.default])),
  };
  const query: HttpOperation = {
    method: "GET",
    path: "/history/{{providerMeta.task_id}}",
    response_transform: "comfyui-history",
    response_mapping:
      imported.kind === "video"
        ? { video_url: "video_url", error_message: "error" }
        : { image_url: "image_url", error_message: "error" },
  };
  return {
    model: {
      modelKey: opts.modelKey,
      vendorKey: COMFYUI_VENDOR_KEY,
      labelZh: opts.labelZh,
      kind: imported.kind,
      enabled: true,
      meta: {
        parameters: imported.parameters,
        ...(opts.draft ? { comfyWorkflowImport: opts.draft } : {}),
      },
    },
    mapping: { vendorKey: COMFYUI_VENDOR_KEY, taskKind: imported.taskKind, modelKey: opts.modelKey, name: opts.labelZh, create, query },
  };
}

/** slug 化标签成 modelKey 片段（ASCII 保底，中文/空白 → comfy-<时间戳>）。 */
export function slugifyModelKey(labelZh: string, uniq: string): string {
  const slug = String(labelZh || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 32);
  return `comfy-${slug || "workflow"}-${uniq}`;
}

/** 编排：解析 → 建图 → 建 model+mapping → upsert（注入 store 写函数，可测、无副作用耦合）。 */
export function importComfyWorkflow(
  payload: { text: string; binding: WorkflowBinding; labelZh: string; modelKey: string },
  upsertModel: (model: Record<string, unknown>) => void,
  upsertMapping: (mapping: Record<string, unknown>) => void,
): { modelKey: string; kind: "image" | "video"; taskKind: string } {
  const graph = parseComfyApiWorkflow(payload.text);
  const built = buildImportedWorkflow(graph, payload.binding);
  const { model, mapping } = buildComfyImportModelMapping(built, {
    modelKey: payload.modelKey,
    labelZh: payload.labelZh,
    draft: { text: payload.text, binding: payload.binding },
  });
  upsertModel(model);
  upsertMapping(mapping);
  return { modelKey: payload.modelKey, kind: built.kind, taskKind: built.taskKind };
}
