import { customCapabilityArchetypeForModel } from './customCapabilityContract';
import { parseModelParameterControlsAtomic } from '../modelParameterControls';
import { resolveComfyWorkflowTaskKind } from '../../catalog/comfyuiWorkflowTaskContract';
import type { ModelArchetype, ArchetypeReferenceSlot } from './types';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function hasComfyWorkflowDeclaration(meta: unknown): boolean {
  return Object.prototype.hasOwnProperty.call(record(meta), 'comfyWorkflowImport');
}

/** Imported graph declarations own their capability identity, never the workflow name. */
export function comfyWorkflowArchetypeForModel(model: { modelKey?: string | null; meta?: unknown }): ModelArchetype | null {
  const meta = record(model.meta);
  if (!hasComfyWorkflowDeclaration(meta)) return null;
  const custom = customCapabilityArchetypeForModel(model);
  const binding = record(record(meta.comfyWorkflowImport).binding);
  const output = binding.outputKind;
  const validOutput = output === 'image' || output === 'video' || output === 'model3d';
  const kind = validOutput ? output : 'video';
  const controls = parseModelParameterControlsAtomic(meta);
  // A valid graph declaration owns its required loaders and transport. A generic
  // custom profile cannot turn that graph into text-only generation.
  if ((!validOutput || controls === null) && custom) return custom;
  const media = controls?.filter(control => control.type === 'image-url' || control.mediaKind !== undefined) ?? [];
  const taskKind = resolveComfyWorkflowTaskKind(kind, media);
  const modelKey = model.modelKey ?? '';
  const slots: ArchetypeReferenceSlot[] = media.map(control => ({
    kind: control.mediaKind === 'video' ? 'video_ref' : control.mediaKind === 'audio' ? 'audio_ref' : 'image_ref',
    label: control.label, min: 1, max: 1, inputKey: control.key, asArray: false,
  }));
  return {
    id: `comfy-workflow-${modelKey}`, family: 'comfy-workflow', label: modelKey,
    kind, defaultModeId: taskKind, transportTaskKind: taskKind, identifierPatterns: [modelKey],
    modes: validOutput && controls ? [{
      id: taskKind, intent: media.length ? 'single' : 'text', vendorTerm: taskKind,
      hint: 'Imported workflow: declared inputs and output only.', slots,
      params: controls.filter(control => !media.includes(control)), promptRequired: false, transportTaskKind: taskKind,
    }] : [],
  };
}
