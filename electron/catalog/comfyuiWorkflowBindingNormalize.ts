import type {
  ComfyGraph,
  WorkflowBinding,
  WorkflowImageBinding,
  WorkflowParamBinding,
  WorkflowParamType,
} from "./comfyuiWorkflowImport";

const PARAM_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function inferParamType(value: string | number | boolean): WorkflowParamType {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "text";
}

function normalizeParamKey(raw: unknown, fallback: string): string {
  const clean = (value: unknown) => String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const makeIdentifier = (value: unknown) => {
    const cleaned = clean(value);
    if (!cleaned) return "";
    return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
  };
  const inComfyNamespace = (value: string) => value.startsWith("comfy_") ? value : `comfy_${value}`;
  const preferred = makeIdentifier(raw);
  if (PARAM_KEY_RE.test(preferred)) return inComfyNamespace(preferred);
  const safeFallback = makeIdentifier(fallback);
  return PARAM_KEY_RE.test(safeFallback) ? inComfyNamespace(safeFallback) : "comfy_param";
}

function normalizeParamType(value: unknown, fallbackValue: string | number | boolean): WorkflowParamType {
  return value === "number" || value === "text" || value === "boolean" ? value : inferParamType(fallbackValue);
}

export function inputKeyOf(nodeId: string, inputKey: string): string {
  return `${nodeId} ${inputKey}`;
}

export function roleBoundInputKeys(binding: WorkflowBinding): Set<string> {
  const keys = new Set<string>();
  if (binding.promptNodeId && binding.promptInputKey) {
    keys.add(inputKeyOf(binding.promptNodeId, binding.promptInputKey));
  }
  // 媒体输入已统一进 images[]（老角色由 normalizeWorkflowBinding 读时折进来），
  // 所以这里只需遍历它——参数绑定据此避开已被媒体占用的 input，不会重复绑同一个槽。
  for (const image of binding.images ?? []) {
    keys.add(inputKeyOf(image.nodeId, image.inputKey));
  }
  return keys;
}

function mediaKindOf(value: unknown, fallback: "image" | "video"): "image" | "video" {
  return value === "video" || value === "image" ? value : fallback;
}

/** 三个老角色的保留 paramKey。模板图里写死的就是它们，且画布靠 key 名推首帧/尾帧分组。 */
const RESERVED_IMAGE_PARAM_KEYS = new Set<string>(["first_frame_url", "last_frame_url", "source_video_url"]);

/**
 * 媒体参数键规范化。**必须幂等**——binding 会反复过这个函数（IPC 一次、落库一次、读出再一次），
 * 而 normalizeParamKey 会强行套上 `comfy_` 命名空间：直接用它会把已经规范好的
 * `first_frame_url` 在第二遍变成 `comfy_first_frame_url`，模板图里的占位当场对不上、图静默收不到素材。
 * 所以三个保留键原样放行；其余交给 normalizeParamKey（它对 `comfy_X` 已是幂等的）。
 */
function normalizeImageParamKey(raw: unknown, fallback: string): string {
  const text = String(raw ?? "").trim();
  if (RESERVED_IMAGE_PARAM_KEYS.has(text)) return text;
  return normalizeParamKey(raw, fallback);
}

/**
 * 媒体输入收敛：显式 `images[]` 优先，随后把 firstFrame/lastFrame/sourceVideo 三个老角色折进来。
 *
 * 老角色的 paramKey **必须**沿用 first_frame_url / last_frame_url / source_video_url：
 * 已存工作流的模板图里写的就是这些占位，且画布侧 inferImageUrlGroup 靠 key 名把它们
 * 分回首帧/尾帧组。换名字 = 老工作流的连边全部掉回「参考图」组，语义静默漂移。
 */
function normalizeImageBindings(
  source: Record<string, unknown>,
  normalized: WorkflowBinding,
  graph?: ComfyGraph,
): WorkflowImageBinding[] {
  const images: WorkflowImageBinding[] = [];
  const seenTargets = new Set<string>();
  const seenKeys = new Set<string>();

  const push = (nodeId: string, inputKey: string, paramKey: string, label: string, mediaKind: "image" | "video") => {
    const targetKey = inputKeyOf(nodeId, inputKey);
    if (seenTargets.has(targetKey) || seenKeys.has(paramKey)) return;
    // 有图就校验这个 input 真的存在且是标量 widget（连线口不是可填的槽）。
    if (graph && !isScalar(graph[nodeId]?.inputs?.[inputKey])) return;
    seenTargets.add(targetKey);
    seenKeys.add(paramKey);
    images.push({ nodeId, inputKey, paramKey, label, mediaKind });
  };

  for (const raw of Array.isArray(source.images) ? source.images : []) {
    if (!isRecord(raw)) continue;
    const nodeId = nonEmptyString(raw.nodeId);
    const inputKey = nonEmptyString(raw.inputKey);
    if (!nodeId || !inputKey) continue;
    const mediaKind = mediaKindOf(raw.mediaKind, "image");
    const fallbackKey = `comfy_${mediaKind}_${images.length + 1}`;
    const baseKey = normalizeImageParamKey(raw.paramKey, fallbackKey);
    let paramKey = baseKey;
    let suffix = 2;
    while (seenKeys.has(paramKey)) paramKey = `${baseKey}_${suffix++}`;
    push(nodeId, inputKey, paramKey, nonEmptyString(raw.label) ?? inputKey, mediaKind);
  }

  const legacyRoles: Array<[keyof WorkflowBinding, keyof WorkflowBinding, string, "image" | "video"]> = [
    ["firstFrameNodeId", "firstFrameInputKey", "first_frame_url", "image"],
    ["lastFrameNodeId", "lastFrameInputKey", "last_frame_url", "image"],
    ["sourceVideoNodeId", "sourceVideoInputKey", "source_video_url", "video"],
  ];
  for (const [nodeField, inputField, paramKey, mediaKind] of legacyRoles) {
    const nodeId = normalized[nodeField];
    const inputKey = normalized[inputField];
    if (typeof nodeId !== "string" || typeof inputKey !== "string") continue;
    push(nodeId, inputKey, paramKey, inputKey, mediaKind);
  }

  return images;
}

/** 把 IPC 或旧 catalog 中的 binding 收敛成唯一、可持久化的现代格式。 */
export function normalizeWorkflowBinding(binding: unknown, graph?: ComfyGraph): WorkflowBinding {
  const source = isRecord(binding) ? binding : {};
  const normalized: WorkflowBinding = {};
  const stringFields = [
    "promptNodeId", "promptInputKey",
    "firstFrameNodeId", "firstFrameInputKey",
    "lastFrameNodeId", "lastFrameInputKey",
    "sourceVideoNodeId", "sourceVideoInputKey",
    "outputNodeId",
  ] as const;
  for (const field of stringFields) {
    const value = nonEmptyString(source[field]);
    if (value) normalized[field] = value;
  }
  if (source.outputKind === "image" || source.outputKind === "video" || source.outputKind === "model3d") {
    normalized.outputKind = source.outputKind;
  }

  const roleFields = [
    ["promptNodeId", "promptInputKey"],
    ["firstFrameNodeId", "firstFrameInputKey"],
    ["lastFrameNodeId", "lastFrameInputKey"],
    ["sourceVideoNodeId", "sourceVideoInputKey"],
  ] as const;
  const seenRoleTargets = new Set<string>();
  for (const [nodeField, inputField] of roleFields) {
    const nodeId = normalized[nodeField];
    const inputKey = normalized[inputField];
    const graphValue = nodeId && inputKey ? graph?.[nodeId]?.inputs?.[inputKey] : undefined;
    const invalidTarget = Boolean(graph) && !isScalar(graphValue);
    const targetKey = nodeId && inputKey ? inputKeyOf(nodeId, inputKey) : "";
    if (!targetKey || invalidTarget || seenRoleTargets.has(targetKey)) {
      delete normalized[nodeField];
      delete normalized[inputField];
      continue;
    }
    seenRoleTargets.add(targetKey);
  }

  // 媒体输入收敛成 images[]：先吃显式声明的，再把三个老角色**折进来**（读时一次性迁移）。
  // 迁移后老角色字段即从产物里删掉——写路径与消费路径只认 images[]，不留并行版（P1）。
  normalized.images = normalizeImageBindings(source, normalized, graph);
  delete normalized.firstFrameNodeId; delete normalized.firstFrameInputKey;
  delete normalized.lastFrameNodeId; delete normalized.lastFrameInputKey;
  delete normalized.sourceVideoNodeId; delete normalized.sourceVideoInputKey;

  const hasParamsField = Object.prototype.hasOwnProperty.call(source, "params");
  const rawParams: unknown[] = hasParamsField
    ? Array.isArray(source.params) ? source.params : []
    : Array.isArray(source.numeric) ? source.numeric : [];
  const params: WorkflowParamBinding[] = [];
  const seenTargets = new Set<string>();
  const seenKeys = new Set<string>();
  const roleTargets = roleBoundInputKeys(normalized);

  for (const raw of rawParams) {
    if (!isRecord(raw)) continue;
    const nodeId = nonEmptyString(raw.nodeId);
    const inputKey = nonEmptyString(raw.inputKey);
    if (!nodeId || !inputKey) continue;

    const targetKey = inputKeyOf(nodeId, inputKey);
    if (seenTargets.has(targetKey) || roleTargets.has(targetKey)) continue;
    const graphHasTarget = graph
      ? Boolean(graph[nodeId]?.inputs && Object.prototype.hasOwnProperty.call(graph[nodeId].inputs, inputKey))
      : false;
    const graphValue = graphHasTarget ? graph?.[nodeId]?.inputs?.[inputKey] : undefined;
    if (graph && (!graphHasTarget || !isScalar(graphValue))) continue;

    const defaultValue = isScalar(raw.default) ? raw.default : isScalar(graphValue) ? graphValue : undefined;
    if (typeof defaultValue === "undefined") continue;

    const baseKey = normalizeParamKey(raw.paramKey, `comfy_${inputKey}`);
    let paramKey = baseKey;
    let suffix = 2;
    while (seenKeys.has(paramKey)) paramKey = `${baseKey}_${suffix++}`;

    seenTargets.add(targetKey);
    seenKeys.add(paramKey);
    params.push({
      nodeId,
      inputKey,
      paramKey,
      label: nonEmptyString(raw.label) ?? inputKey,
      type: hasParamsField ? normalizeParamType(raw.type, defaultValue) : "number",
      default: defaultValue,
    });
  }

  normalized.params = params;
  return normalized;
}
