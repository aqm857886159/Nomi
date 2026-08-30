import { isJsonRecord, nowIso, trim } from "../jsonUtils";
import { defaultCustomCallTaskKind, resolveCapabilityModeEvidence } from "../shared/capabilityModeManifest";
import type { CapabilityModeManifest } from "../shared/capabilityModeManifest";
import type { TaskRequest } from "../runtime";
import type { Mapping, Model, ProfileKind } from "./types";

export type ResolvedCustomCallExecution = {
  script: string;
  source: "mode" | "model";
  taskKind: ProfileKind;
  modeId?: string;
};

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function validModeStorageKey(value: string): boolean {
  return Boolean(value) && value !== "__proto__" && value !== "prototype" && value !== "constructor";
}

/**
 * customCall 的增量合并规则：undefined 保留全部，null 删除全部；对象里 script / modes 都是局部 patch。
 * 这样编辑一个模式不会误删通用 fallback 或其他模式，重拉模型（完全不带 customCall）也不会清用户数据。
 */
export function normalizeCustomCall(
  raw: unknown,
  existing: Model["customCall"] | undefined,
  updatedAt = nowIso(),
): Model["customCall"] | undefined {
  if (raw === null) return undefined;
  if (raw === undefined || !isJsonRecord(raw)) return existing;

  let script = existing?.script;
  if (hasOwn(raw, "script")) script = trim(raw.script) || undefined;

  let modes: NonNullable<Model["customCall"]>["modes"] = existing?.modes
    ? Object.fromEntries(Object.entries(existing.modes))
    : {};
  if (hasOwn(raw, "modes")) {
    if (raw.modes === null) {
      modes = {};
    } else if (isJsonRecord(raw.modes)) {
      for (const [rawModeId, entry] of Object.entries(raw.modes)) {
        const modeId = rawModeId.trim();
        if (!validModeStorageKey(modeId)) continue;
        const modeScript = isJsonRecord(entry) ? trim(entry.script) : "";
        if (!modeScript) delete modes[modeId];
        else modes[modeId] = { script: modeScript, updatedAt };
      }
    }
  }

  if (!script && Object.keys(modes).length === 0) return undefined;
  return {
    ...(script ? { script } : {}),
    ...(Object.keys(modes).length > 0 ? { modes } : {}),
    updatedAt,
  };
}

function requestArchetypeSelection(request: TaskRequest): { archetypeId: string; modeId: string } {
  const raw = request.extras?.archetype;
  if (!isJsonRecord(raw)) return { archetypeId: "", modeId: "" };
  return { archetypeId: trim(raw.id), modeId: trim(raw.modeId) };
}

/**
 * 只从模型档案 / 显式能力契约确认 modeId。供应商名、modelKey 关键词和“有没有参考图”都不能发明模式。
 * mapping 只提供已由 selectTaskMapping 选中的 transport taskKind；模式身份仍由 archetype 验证。
 */
function validatedModeId(manifest: CapabilityModeManifest | null, request: TaskRequest, taskKind: ProfileKind): string | undefined {
  if (!manifest) return undefined;

  const selected = requestArchetypeSelection(request);
  if (selected.archetypeId && selected.archetypeId !== manifest.archetypeId) return undefined;
  const requestedModeId = selected.modeId || (!selected.archetypeId ? manifest.defaultModeId : "");
  if (!requestedModeId) return undefined;
  return manifest.modes[requestedModeId] === taskKind ? requestedModeId : undefined;
}

export function resolveCustomCallExecution(
  model: Model,
  request: TaskRequest,
  mapping: Mapping | null,
): ResolvedCustomCallExecution | null {
  const customCall = model.customCall;
  if (!customCall) return null;
  const taskKind = mapping?.taskKind || request.kind;
  const resolution = resolveCapabilityModeEvidence(model);
  if (resolution.state === "invalid-explicit") return null;
  const manifest = resolution.state === "resolved" ? resolution.manifest : null;
  const selected = requestArchetypeSelection(request);
  const modeId = validatedModeId(manifest, request, taskKind);
  if ((selected.archetypeId || selected.modeId) && !modeId) return null;
  const modeScript = modeId ? trim(customCall.modes?.[modeId]?.script) : "";
  if (modeScript) return { script: modeScript, source: "mode", taskKind, modeId };
  const modelScript = trim(customCall.script);
  return modelScript && taskKind === defaultCustomCallTaskKind(model.kind)
    ? { script: modelScript, source: "model", taskKind, ...(modeId ? { modeId } : {}) }
    : null;
}
