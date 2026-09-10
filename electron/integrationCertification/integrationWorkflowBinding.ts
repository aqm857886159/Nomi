// ComfyUI workflow 绑定的**入站净化**（从 integrationSession 抽出，2026-09-10）。
//
// 它和会话状态机是两件事：状态机管 owner / revision / 阶段 / 收据，这里只管
// 「外部交进来的这坨 JSON 里，哪些键、哪些形状是允许的」。抽出来是为了让那份被当作
// 一个安全边界评审的状态机文件不再夹带一百多行纯解析代码。
import type { WorkflowBinding, WorkflowEnumOption } from "../catalog/comfyuiWorkflowImport";

export function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid object");
}
export function workflowString(value: unknown, name: string, max = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new Error(`Invalid ${name}`);
  return value;
}
export function rejectWorkflowKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find(
    (key) => key === "__proto__" || key === "prototype" || key === "constructor" || !allowedSet.has(key),
  );
  if (unknown) throw new Error(`Unexpected ${name} field: ${unknown}`);
}
export function sanitizeWorkflowBinding(value: unknown): WorkflowBinding | undefined {
  if (value === undefined) return undefined;
  assertRecord(value);
  rejectWorkflowKeys(
    value,
    [
      "promptNodeId",
      "promptInputKey",
      "firstFrameNodeId",
      "firstFrameInputKey",
      "lastFrameNodeId",
      "lastFrameInputKey",
      "sourceVideoNodeId",
      "sourceVideoInputKey",
      "outputNodeId",
      "outputKind",
      "images",
      "numeric",
      "params",
    ],
    "workflow binding",
  );
  const result: WorkflowBinding = {};
  for (const key of [
    "promptNodeId",
    "promptInputKey",
    "firstFrameNodeId",
    "firstFrameInputKey",
    "lastFrameNodeId",
    "lastFrameInputKey",
    "sourceVideoNodeId",
    "sourceVideoInputKey",
    "outputNodeId",
  ] as const) {
    if (value[key] !== undefined) result[key] = workflowString(value[key], key);
  }
  if (value.outputKind !== undefined) {
    if (!new Set(["image", "video", "model3d"]).has(String(value.outputKind))) throw new Error("Invalid outputKind");
    result.outputKind = value.outputKind as NonNullable<WorkflowBinding["outputKind"]>;
  }
  if (value.images !== undefined) {
    if (!Array.isArray(value.images) || value.images.length > 64) throw new Error("Invalid workflow media bindings");
    result.images = value.images.map((raw) => {
      assertRecord(raw);
      rejectWorkflowKeys(raw, ["nodeId", "inputKey", "paramKey", "label", "mediaKind"], "workflow media binding");
      if (raw.mediaKind !== "image" && raw.mediaKind !== "video") throw new Error("Invalid workflow media kind");
      return {
        nodeId: workflowString(raw.nodeId, "media nodeId"),
        inputKey: workflowString(raw.inputKey, "media inputKey"),
        paramKey: workflowString(raw.paramKey, "media paramKey"),
        label: workflowString(raw.label, "media label", 1_000),
        mediaKind: raw.mediaKind,
      };
    });
  }
  if (value.numeric !== undefined) {
    if (!Array.isArray(value.numeric) || value.numeric.length > 256) throw new Error("Invalid numeric bindings");
    result.numeric = value.numeric.map((raw) => {
      assertRecord(raw);
      rejectWorkflowKeys(raw, ["nodeId", "inputKey", "paramKey", "label", "default"], "numeric binding");
      if (typeof raw.default !== "number" || !Number.isFinite(raw.default)) throw new Error("Invalid numeric default");
      return {
        nodeId: workflowString(raw.nodeId, "numeric nodeId"),
        inputKey: workflowString(raw.inputKey, "numeric inputKey"),
        paramKey: workflowString(raw.paramKey, "numeric paramKey"),
        label: workflowString(raw.label, "numeric label", 1_000),
        default: raw.default,
      };
    });
  }
  if (value.params !== undefined) {
    if (!Array.isArray(value.params) || value.params.length > 256) throw new Error("Invalid parameter bindings");
    result.params = value.params.map((raw) => {
      assertRecord(raw);
      rejectWorkflowKeys(raw, ["nodeId", "inputKey", "paramKey", "label", "type", "default"], "parameter binding");
      if (!new Set(["number", "text", "boolean"]).has(String(raw.type))) throw new Error("Invalid parameter type");
      if (
        (raw.type === "number" && (typeof raw.default !== "number" || !Number.isFinite(raw.default))) ||
        (raw.type === "text" && (typeof raw.default !== "string" || raw.default.length > 64 * 1024)) ||
        (raw.type === "boolean" && typeof raw.default !== "boolean")
      )
        throw new Error("Invalid parameter default");
      return {
        nodeId: workflowString(raw.nodeId, "parameter nodeId"),
        inputKey: workflowString(raw.inputKey, "parameter inputKey"),
        paramKey: workflowString(raw.paramKey, "parameter paramKey"),
        label: workflowString(raw.label, "parameter label", 1_000),
        type: raw.type as "number" | "text" | "boolean",
        default: raw.default as string | number | boolean,
      };
    });
  }
  return result;
}
export function sanitizeWorkflowEnumOptions(value: unknown): WorkflowEnumOption[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 256) throw new Error("Invalid workflow enum options");
  return value.map((raw) => {
    assertRecord(raw);
    rejectWorkflowKeys(raw, ["classType", "inputKey", "options"], "workflow enum option");
    if (!Array.isArray(raw.options) || raw.options.length > 2_000) throw new Error("Invalid workflow enum values");
    return {
      classType: workflowString(raw.classType, "enum classType"),
      inputKey: workflowString(raw.inputKey, "enum inputKey"),
      options: raw.options.map((option) => workflowString(option, "enum value", 8_192)),
    };
  });
}
