// Declaration and certification compile one capability + wire fact before catalog writes.
import { createHash } from 'node:crypto';
import { stableProjectAgentJson } from '../shared/legacyAgentJson';
import type { AdapterModelDraft, AdapterModeDraft, AdapterModeResult } from './types';
import type { Mapping, ProfileKind } from '../catalog/types';
import { normalizeCustomCapabilityContract, parseCustomCapabilityContract, type CustomCapabilityContractV1 } from '../shared/customCapabilityContract';
import { modelKindForTaskKind } from '../shared/capabilityModeManifest';
import { consumedCanonicalKeys } from '../catalog/paramTranslate';
import { DERIVED_REFERENCE_CARRIER_KEYS, referenceKeyDeclarationFor } from '../shared/modelArchetypes/referenceKeys';
import type { ArchetypeReferenceSlot, ArchetypeTransportTaskKind, ModelParameterControl } from '../shared/videoCapabilities/types';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function capabilityFactDigest(value: unknown): string {
  return createHash('sha256').update(stableProjectAgentJson(JSON.parse(JSON.stringify(value ?? null)))).digest('hex');
}
export function declaredWireFact(row: Partial<Mapping>): Record<string, unknown> {
  return { taskKind: row.taskKind, modeId: row.modeId, enabled: row.enabled, create: row.create, query: row.query, result: row.result, delivery: row.delivery, abandon: row.abandon, statusMapping: row.statusMapping };
}
export type DeclaredMapping = Pick<Mapping, 'vendorKey' | 'modelKey' | 'taskKind' | 'name' | 'enabled' | 'create' | 'query' | 'result' | 'delivery' | 'abandon' | 'statusMapping'>;

/** Full replacement: no spread of old operations, which would keep removed result/query fields. */
export function mappingRowFromDeclaredMode(input: {
  vendorKey: string; modelKey: string; label: string; mode: AdapterModeDraft; enabled: boolean;
}): DeclaredMapping {
  const { mode } = input;
  return { vendorKey: input.vendorKey, modelKey: input.modelKey, taskKind: mode.taskKind, name: `${input.label} · ${mode.taskKind}`, enabled: input.enabled,
    create: mode.create, query: mode.query, result: mode.result, delivery: mode.delivery, abandon: mode.abandon, statusMapping: mode.statusMapping };
}
const TASK_LABELS: Partial<Record<ProfileKind, string>> = { text_to_video: '文生视频', image_to_video: '图生视频', text_to_image: '文生图', image_edit: '改图', text_to_audio: '语音', transcribe: '音频转写', text_to_3d: '文生3D', image_to_3d: '图生3D' };
// Stable model vocabulary already localized by the renderer's model-display boundary.
const REFERENCE_LABELS = { first_frame: '首帧', image_ref: '参考图' } as const;
const TASK_MODE_IDS: Partial<Record<ProfileKind, string>> = { text_to_video: 't2v', image_to_video: 'i2v', text_to_image: 'generate', image_edit: 'edit', text_to_audio: 'generate', transcribe: 'transcribe', text_to_3d: 'generate', image_to_3d: 'image' };

function fieldError(candidate: AdapterModelDraft, field: string, reason: string): never {
  throw new Error(`models.${candidate.modelKey}.${field}: ${reason}`);
}
function readsParameter(wire: string, key: string): boolean {
  return wire.includes(`request.${key}}}`) || wire.includes(`request.params.${key}}}`) || wire.includes(`request.extras.${key}}}`);
}

function modeReadsParameter(mode: AdapterModeDraft, key: string): boolean {
  if (mode.create.paramMap?.drops?.includes(key)) return false;
  const wire = JSON.stringify(mode.create);
  const rules = mode.create.paramMap?.rules || [];
  const bound = new Set(rules.filter((rule) => readsParameter(wire, rule.wire)).map((rule) => rule.wire));
  for (let pass = 0; pass < rules.length; pass += 1) {
    for (const source of consumedCanonicalKeys({ rules: rules.filter((rule) => bound.has(rule.wire)) })) bound.add(source);
  }
  return bound.has(key) || readsParameter(wire, key);
}

/** Declared controls/references live in the existing request.params channel, including legacy aliases. */
function projectDeclaredBindings<T>(value: T, keys: ReadonlySet<string>): T {
  if (typeof value === 'string') return value.replace(/{{\s*request\.([^{}]+?)\s*}}/g, (token, key: string) => keys.has(key.trim().replace(/^(params|extras)\./, '')) ? `{{request.params.${key.trim().replace(/^(params|extras)\./, '')}}}` : token) as T;
  if (Array.isArray(value)) return value.map((item) => projectDeclaredBindings(item, keys)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, projectDeclaredBindings(item, keys)])) as T;
  return value;
}

export type DeclaredModelProjection = { kind: AdapterModelDraft["kind"]; meta: Record<string, unknown>; mappings: DeclaredMapping[]; contract: CustomCapabilityContractV1 | null; taskKinds: ProfileKind[] };

/** Kind, product modes, controls, required slots and wire are compiled together for every writer. */
export function projectDeclaredModel(candidate: AdapterModelDraft, vendorKey: string, published?: readonly ProfileKind[]): DeclaredModelProjection {
  if (published?.some((taskKind) => !candidate.modes.some((mode) => mode.taskKind === taskKind))) fieldError(candidate, "modes", "verified taskKind is absent from the declaration");
  const parameterKeys = (candidate.parameters || []).map((p) => p.key);
  for (const key of parameterKeys) if (candidate.kind !== 'text' && key.includes('.')) fieldError(candidate, `parameters.${key}`, 'nested parameter paths cannot be projected as a flat control');
  const normalizedModes = candidate.modes.map((mode) => ({ ...mode, create: projectDeclaredBindings(mode.create, new Set([...parameterKeys, ...(mode.referenceParam ? [mode.referenceParam] : [])])) }));
  const modes = normalizedModes.filter((mode) => !published || published.includes(mode.taskKind));
  if (!modes.length) fieldError(candidate, 'modes', 'no published mode');
  if (new Set(modes.map((m) => m.taskKind)).size !== modes.length) fieldError(candidate, 'modes', 'duplicate taskKind');
  const params: ModelParameterControl[] = (candidate.parameters || []).map((p) => ({ key: p.key, label: p.label, type: p.type, options: p.options || [], ...(p.default !== undefined ? { defaultValue: p.default } : {}), ...(p.min !== undefined ? { min: p.min } : {}), ...(p.max !== undefined ? { max: p.max } : {}) }));
  for (const p of params) {
    if (candidate.kind !== 'text' && !normalizedModes.some((m) => modeReadsParameter(m, p.key))) fieldError(candidate, `parameters.${p.key}`, 'parameter has no request binding in create');
  }
  if (candidate.kind === 'text' && modes.some((mode) => modelKindForTaskKind(mode.taskKind))) fieldError(candidate, 'modes.taskKind', 'media taskKind cannot use the native text channel');
  const capabilityModes = candidate.kind === 'text' ? [] : modes.map((mode) => {
    if (modelKindForTaskKind(mode.taskKind) !== candidate.kind) fieldError(candidate, `modes.${mode.taskKind}.taskKind`, 'Nomi cannot project this taskKind for the declared kind');
    const wire = JSON.stringify(mode.create);
    const reference = ['image_to_video', 'image_edit', 'image_to_3d'].includes(mode.taskKind);
    const slots: ArchetypeReferenceSlot[] = [];
    if (reference) {
      if (!mode.referenceParam) fieldError(candidate, `modes.${mode.taskKind}.referenceParam`, 'required image input must be named');
      if (!mode.referenceShape) fieldError(candidate, `modes.${mode.taskKind}.referenceShape`, 'required image input shape must be explicit');
      if (mode.referenceParam.includes('.')) fieldError(candidate, `modes.${mode.taskKind}.referenceParam`, 'nested reference paths cannot be projected as an input slot');
      if (!readsParameter(wire, mode.referenceParam) && ![...DERIVED_REFERENCE_CARRIER_KEYS].some((key) => readsParameter(wire, key))) fieldError(candidate, `modes.${mode.taskKind}.referenceParam`, 'create does not read the declared reference parameter');
      const single = mode.referenceShape === 'single';
      slots.push({ kind: single && candidate.kind === 'video' ? 'first_frame' : 'image_ref', label: REFERENCE_LABELS[single && candidate.kind === 'video' ? 'first_frame' : 'image_ref'], min: 1, ...(single ? { max: 1 } : {}), inputKey: mode.referenceParam, asArray: !single });
    } else if (mode.referenceParam || mode.referenceShape) {
      fieldError(candidate, `modes.${mode.taskKind}.referenceParam`, 'this task cannot express the declared reference role');
    }
    const additionalReferences = [...wire.matchAll(/{{request\.params\.([A-Za-z0-9_.-]+)}}/g)].map((match) => match[1]).filter((key) => referenceKeyDeclarationFor(key) && key !== mode.referenceParam && !(reference && DERIVED_REFERENCE_CARRIER_KEYS.has(key)));
    if (additionalReferences.length) fieldError(candidate, `modes.${mode.taskKind}.create`, `undeclared reference roles: ${[...new Set(additionalReferences)].join(', ')}`);
    return { id: TASK_MODE_IDS[mode.taskKind] || mode.taskKind, intent: reference ? 'single' as const : 'text' as const, vendorTerm: TASK_LABELS[mode.taskKind] || mode.taskKind, hint: '', promptRequired: mode.taskKind !== 'transcribe', transportTaskKind: mode.taskKind as ArchetypeTransportTaskKind, slots, params: params.filter((p) => modeReadsParameter(mode, p.key)) };
  });
  const contract = candidate.kind === 'text' ? null : normalizeCustomCapabilityContract({ version: 1, kind: candidate.kind, defaultModeId: capabilityModes[0].id, transportTaskKind: modes[0].taskKind, modes: capabilityModes });
  if (candidate.kind !== 'text' && !contract) fieldError(candidate, 'parameters/modes/slots', 'capability shape cannot be represented safely');
  const mappings = candidate.kind === 'text' ? [] : normalizedModes.map((mode) => {
    const controls = params.filter((p) => modeReadsParameter(mode, p.key));
    const defaults = Object.fromEntries(controls.filter((p) => p.defaultValue !== undefined).map((p) => [p.key, p.defaultValue]));
    const wireDefaults = mode.create.defaultParams || {};
    for (const [key, value] of Object.entries(defaults)) if (key in wireDefaults && wireDefaults[key] !== value) fieldError(candidate, `modes.${mode.taskKind}.create.defaultParams.${key}`, 'wire default conflicts with the visible capability default');
    const create = Object.keys(defaults).length ? { ...mode.create, defaultParams: { ...wireDefaults, ...defaults } } : mode.create;
    return mappingRowFromDeclaredMode({ vendorKey, modelKey: candidate.modelKey, label: candidate.labelZh, mode: { ...mode, create }, enabled: !published || published.includes(mode.taskKind) });
  });
  const ownership = { version: 1, hasMediaContract: Boolean(contract), capabilityDigest: capabilityFactDigest(contract), wireDigests: Object.fromEntries(mappings.map((row) => [row.taskKind, capabilityFactDigest(declaredWireFact(row))])) };
  return { kind: candidate.kind, contract, mappings, taskKinds: candidate.kind === 'text' && !published ? [...new Set<ProfileKind>(['chat', ...modes.map((m) => m.taskKind)])] : modes.map((m) => m.taskKind), meta: { customCapabilityContract: contract || undefined, parameters: candidate.parameters || [], declarationProjection: ownership } };
}

/** Reject independent edits before an atomic replacement; unchanged owned routes may be removed. */
export function assertDeclaredReplacementOwnership(input: { oldMeta: unknown; mappings: readonly Mapping[]; projection: DeclaredModelProjection }): void {
  const old = asRecord(input.oldMeta);
  const ownership = asRecord(old.declarationProjection);
  const oldDigests = asRecord(ownership.wireDigests);
  const contract = parseCustomCapabilityContract(old);
  if (ownership.version === 1 && capabilityFactDigest(contract) !== ownership.capabilityDigest) throw new Error('customCapabilityContract: independently edited capability conflicts with declaration replacement');
  if (contract && ownership.version !== 1 && capabilityFactDigest(contract) !== capabilityFactDigest(input.projection.contract)) throw new Error('customCapabilityContract: user-authored capability conflicts with declaration replacement');
  for (const row of input.mappings) {
    const ownedDigest = !row.modeId ? oldDigests[row.taskKind] : undefined;
    if (ownedDigest) {
      if (capabilityFactDigest(declaredWireFact(row)) !== ownedDigest) throw new Error(`mappings.${row.taskKind}: independently edited wire conflicts with declaration replacement`);
      continue;
    }
    const next = !row.modeId ? input.projection.mappings.find((item) => item.taskKind === row.taskKind) : undefined;
    if (next && capabilityFactDigest(declaredWireFact(row)) === capabilityFactDigest(declaredWireFact(next))) continue;
    throw new Error(`mappings.${row.taskKind}: unowned wire conflicts with declaration replacement; independent mappings are preserved`);
  }
}

export function adapterModelMetadataForPromotion(input: {
  oldMeta: Record<string, unknown>; candidate: AdapterModelDraft; modeResults: AdapterModeResult[];
  runId: string; revisionId: string; updatedAt: string; projection?: DeclaredModelProjection;
}): Record<string, unknown> {
  const verifiedModes = input.modeResults.filter((mode) => mode.state === 'verified');
  const failedModes = input.modeResults.filter((mode) => mode.state === 'failed');
  const oldAdapter = asRecord(input.oldMeta.adapter);
  if (!verifiedModes.length) return { ...input.oldMeta, adapter: { ...oldAdapter, state: 'failed', runId: input.runId, modes: input.modeResults, updatedAt: input.updatedAt } };
  const projection = input.projection || projectDeclaredModel(input.candidate, '', verifiedModes.map((m) => m.taskKind));
  const next = { ...input.oldMeta, ...projection.meta };
  delete next.declarationCapabilityIssue;
  return { ...next,
    adapter: { state: failedModes.length ? 'partial' : 'verified', runId: input.runId, activeRevision: input.revisionId,
      // A free self-check proves shape/credential only; generation remains untried.
      evidence: 'self-check', modes: input.modeResults, publicationModes: projection.taskKinds, updatedAt: input.updatedAt } };
}
