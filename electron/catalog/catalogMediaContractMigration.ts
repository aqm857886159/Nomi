import { isJsonRecord } from "../jsonUtils";
import {
  analyzeComfyWorkflow,
  normalizeWorkflowBinding,
  parseComfyApiWorkflow,
  type ComfyGraph,
  type WorkflowBinding,
  type WorkflowImageBinding,
} from "./comfyuiWorkflowImport";
import type { CatalogState, Mapping, Model } from "./types";

function targetKey(binding: Pick<WorkflowImageBinding, "nodeId" | "inputKey">): string {
  return `${binding.nodeId} ${binding.inputKey}`;
}

function graphInput(graph: ComfyGraph, nodeId: string, inputKey: string): unknown {
  return graph[nodeId]?.inputs?.[inputKey];
}

type RawImageBinding = WorkflowImageBinding & Record<string, unknown>;

function rawImageBinding(value: unknown): RawImageBinding | null {
  if (!isJsonRecord(value)) return null;
  if (typeof value.nodeId !== "string" || typeof value.inputKey !== "string" || typeof value.paramKey !== "string") return null;
  return value as RawImageBinding;
}

function storedImageBindings(source: Record<string, unknown>): RawImageBinding[] {
  if (Array.isArray(source.images)) {
    return source.images.map(rawImageBinding).filter((value): value is RawImageBinding => Boolean(value));
  }
  const legacy: Array<[string, string, string, "image" | "video"]> = [
    ["firstFrameNodeId", "firstFrameInputKey", "first_frame_url", "image"],
    ["lastFrameNodeId", "lastFrameInputKey", "last_frame_url", "image"],
    ["sourceVideoNodeId", "sourceVideoInputKey", "source_video_url", "video"],
  ];
  return legacy.flatMap(([nodeField, inputField, paramKey, mediaKind]) => {
    const nodeId = source[nodeField];
    const inputKey = source[inputField];
    return typeof nodeId === "string" && typeof inputKey === "string"
      ? [{ nodeId, inputKey, paramKey, label: inputKey, mediaKind } as RawImageBinding]
      : [];
  });
}

type BindingReplacement = { invalid: RawImageBinding; replacement: WorkflowImageBinding };

function repairedComfyBinding(graph: ComfyGraph, source: Record<string, unknown>): {
  binding: WorkflowBinding;
  replacements: BindingReplacement[];
  unresolved: boolean;
} | null {
  const rawImages = storedImageBindings(source);
  const invalid = rawImages.filter((image) => typeof graphInput(graph, image.nodeId, image.inputKey) !== "string");
  if (invalid.length === 0) return null;

  const normalized = normalizeWorkflowBinding(source, graph);
  const occupied = new Set((normalized.images ?? []).map(targetKey));
  const available = (analyzeComfyWorkflow(graph).suggested.images ?? [])
    .filter((image) => !occupied.has(targetKey(image)));
  const used = new Set<string>();
  const replacements: BindingReplacement[] = [];
  for (const image of invalid) {
    const unused = available.filter((candidate) => !used.has(targetKey(candidate)));
    const sameKind = unused.filter((candidate) => candidate.mediaKind === image.mediaKind);
    const exact = sameKind.filter((candidate) => candidate.paramKey === image.paramKey);
    const replacement = exact.length === 1
      ? exact[0]
      : invalid.length === 1 && sameKind.length === 1
        ? sameKind[0]
        : undefined;
    if (!replacement) return { binding: normalizeWorkflowBinding(source, graph), replacements: [], unresolved: true };
    used.add(targetKey(replacement));
    replacements.push({ invalid: image, replacement: {
      ...replacement,
      paramKey: image.paramKey,
      label: typeof image.label === "string" && image.label.trim() ? image.label : replacement.label,
      mediaKind: image.mediaKind,
    } });
  }
  const replacementByTarget = new Map(replacements.map((entry) => [targetKey(entry.invalid), entry.replacement]));
  const repairedImages: WorkflowImageBinding[] = [];
  for (const image of rawImages) {
    if (typeof graphInput(graph, image.nodeId, image.inputKey) === "string") {
      repairedImages.push(image);
      continue;
    }
    const replacement = replacementByTarget.get(targetKey(image));
    if (replacement) repairedImages.push(replacement);
  }
  return { binding: normalizeWorkflowBinding({ ...source, images: repairedImages }, graph), replacements, unresolved: false };
}

function promptProvesStaleBinding(mapping: Mapping, replacements: BindingReplacement[]): boolean {
  if (mapping.create?.request_transform !== "comfyui-prompt" || !isJsonRecord(mapping.create.body)) return false;
  const prompt = mapping.create.body.prompt;
  if (!isJsonRecord(prompt)) return false;
  return replacements.some(({ invalid }) => {
    const node = prompt[invalid.nodeId];
    return isJsonRecord(node) && isJsonRecord(node.inputs)
      && node.inputs[invalid.inputKey] === `{{request.params.${invalid.paramKey}}}`;
  });
}

function patchPromptNodeInput(prompt: Record<string, unknown>, nodeId: string, inputKey: string, value: unknown, bound: boolean): boolean {
  const current = prompt[nodeId];
  if (!isJsonRecord(current) || !isJsonRecord(current.inputs)) return false;
  const meta = isJsonRecord(current._meta) ? { ...current._meta } : {};
  if (bound) meta.nomi_bound_media_input = inputKey;
  else if (meta.nomi_bound_media_input === inputKey) delete meta.nomi_bound_media_input;
  prompt[nodeId] = { ...current, inputs: { ...current.inputs, [inputKey]: value }, ...(Object.keys(meta).length ? { _meta: meta } : {}) };
  if (Object.keys(meta).length === 0) delete (prompt[nodeId] as Record<string, unknown>)._meta;
  return true;
}

function patchStoredComfyMapping(mapping: Mapping, graph: ComfyGraph, replacements: BindingReplacement[]): Mapping | null {
  if (!isJsonRecord(mapping.create?.body) || !isJsonRecord(mapping.create.body.prompt)) return null;
  const prompt = structuredClone(mapping.create.body.prompt);
  for (const { invalid, replacement } of replacements) {
    const invalidNode = prompt[invalid.nodeId];
    if (!isJsonRecord(invalidNode) || !isJsonRecord(invalidNode.inputs)
      || invalidNode.inputs[invalid.inputKey] !== `{{request.params.${invalid.paramKey}}}`) return null;
    if (!patchPromptNodeInput(prompt, invalid.nodeId, invalid.inputKey, graphInput(graph, invalid.nodeId, invalid.inputKey), false)) return null;
    if (!patchPromptNodeInput(prompt, replacement.nodeId, replacement.inputKey, `{{request.params.${replacement.paramKey}}}`, true)) return null;
  }
  return { ...mapping, create: { ...mapping.create!, body: { ...mapping.create.body, prompt } } };
}

function migrateStoredComfyModel(model: Model, mappings: Mapping[]): {
  model: Model;
  mappings: Mapping[];
  changed: boolean;
  unresolved: boolean;
} {
  if (!isJsonRecord(model.meta) || !isJsonRecord(model.meta.comfyWorkflowImport)) {
    return { model, mappings, changed: false, unresolved: false };
  }
  const draft = model.meta.comfyWorkflowImport;
  if (typeof draft.text !== "string" || !isJsonRecord(draft.binding)) {
    return { model, mappings, changed: false, unresolved: false };
  }
  try {
    const graph = parseComfyApiWorkflow(draft.text);
    const repair = repairedComfyBinding(graph, draft.binding);
    if (!repair) return { model, mappings, changed: false, unresolved: false };
    if (repair.unresolved) return { model, mappings, changed: false, unresolved: true };
    let unresolved = false;
    const nextMappings = mappings.map((mapping) => {
      if (mapping.vendorKey !== model.vendorKey || mapping.modelKey !== model.modelKey || !promptProvesStaleBinding(mapping, repair.replacements)) {
        return mapping;
      }
      const patched = patchStoredComfyMapping(mapping, graph, repair.replacements);
      if (!patched) { unresolved = true; return mapping; }
      return patched;
    });
    if (unresolved) return { model, mappings, changed: false, unresolved: true };
    // 即便当前没有 executable mapping，修复草稿也能防止用户下次编辑时重新生成错绑。
    return {
      model: {
        ...model,
        meta: {
          ...model.meta,
          comfyWorkflowImport: { ...draft, binding: repair.binding },
        },
      },
      mappings: nextMappings,
      changed: true,
      unresolved: false,
    };
  } catch {
    return { model, mappings, changed: false, unresolved: false };
  }
}

/** v10 -> v11: repair only provable stored media-role violations; idempotent and preserves unrelated user data. */
export function migrateCatalogMediaContracts(state: CatalogState): { state: CatalogState; unresolved: boolean } {
  let mappings = state.mappings;
  let changed = false;
  let unresolved = false;
  const models = state.models.map((original) => {
    const comfy = migrateStoredComfyModel(original, mappings);
    unresolved ||= comfy.unresolved;
    if (comfy.changed) {
      mappings = comfy.mappings;
      changed = true;
    }
    return comfy.model;
  });
  return { state: changed ? { ...state, models, mappings } : state, unresolved };
}
