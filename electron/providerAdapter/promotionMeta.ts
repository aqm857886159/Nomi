// Declaration and certification compile one capability + wire fact before catalog writes.
import { createHash } from 'node:crypto';
import { stableProjectAgentJson } from '../shared/legacyAgentJson';
import type { AdapterModelDraft, AdapterModeDraft, AdapterModeResult } from './types';
import type { Mapping, ProfileKind } from '../catalog/types';
import { normalizeCustomCapabilityContract, parseCustomCapabilityContract, type CustomCapabilityContractV1 } from '../shared/customCapabilityContract';
import { modelKindForTaskKind } from '../shared/capabilityModeManifest';
import { consumedCanonicalKeys, wireReferencedParamKeys } from '../catalog/paramTranslate';
import { MODEL_ARCHETYPES } from '../shared/modelArchetypes';
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
const REFERENCE_LABELS = { first_frame: '首帧', image_ref: '参考图', video_ref: '参考视频', audio_ref: '参考音频' } as const;
const TASK_MODE_IDS: Partial<Record<ProfileKind, string>> = { text_to_video: 't2v', image_to_video: 'i2v', text_to_image: 'generate', image_edit: 'edit', text_to_audio: 'generate', transcribe: 'transcribe', text_to_3d: 'generate', image_to_3d: 'image' };

function fieldError(candidate: AdapterModelDraft, field: string, reason: string): never {
  throw new Error(`models.${candidate.modelKey}.${field}: ${reason}`);
}
function readsParameter(wire: string, key: string): boolean {
  return [...wire.matchAll(/{{\s*request\.(?:(?:params|extras)\.)?([^{}]+?)\s*}}/g)].some((m) => m[1].trim() === key || (m[1].trim().startsWith(`${key}.`) && /^\.\d+$/.test(m[1].trim().slice(key.length))));
}

function modeReadsParameter(mode: AdapterModeDraft, key: string): boolean {
  if (mode.create.paramMap?.drops?.includes(key)) return false;
  const wire = JSON.stringify(mode.create);
  const direct = new Set(wireReferencedParamKeys({ ...mode.create, body: mode.create.multipart?.fields ?? mode.create.body }));
  const rules = mode.create.paramMap?.rules || [];
  const bound = new Set(rules.filter((rule) => readsParameter(wire, rule.wire)).map((rule) => rule.wire));
  for (let pass = 0; pass < rules.length; pass += 1) {
    for (const source of consumedCanonicalKeys({ rules: rules.filter((rule) => bound.has(rule.wire)) })) bound.add(source);
  }
  return bound.has(key) || direct.has(key) || readsParameter(wire, key);
}

/** Declared controls/references live in the existing request.params channel, including legacy aliases. */
function projectDeclaredBindings<T>(value: T, keys: ReadonlySet<string>): T {
  if (typeof value === 'string') return value.replace(/{{\s*request\.([^{}]+?)\s*}}/g, (token, key: string) => keys.has(key.trim().replace(/^(params|extras)\./, '')) ? `{{request.params.${key.trim().replace(/^(params|extras)\./, '')}}}` : token) as T;
  if (Array.isArray(value)) return value.map((item) => projectDeclaredBindings(item, keys)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, projectDeclaredBindings(item, keys)])) as T;
  return value;
}

/** Per-mode controls are produced by a native importer, not inferred by promotion. */
export type CapabilityModelDraft = Omit<AdapterModelDraft, 'modes'> & { modes: Array<AdapterModeDraft & { controls?: ModelParameterControl[]; referenceSlots?: ArchetypeReferenceSlot[] }> };
/** Normalize explicitly declared media controls through the existing slot families. */
function normalizeControlReferences(mode: CapabilityModelDraft['modes'][number], candidate: AdapterModelDraft): CapabilityModelDraft['modes'][number] {
  const media = (mode.controls || []).filter((p) => p.type === 'image-url');
  if (!media.length) return mode;
  const referenceTask = ['image_to_video', 'image_edit', 'image_to_3d'].includes(mode.taskKind);
  if (referenceTask && (!mode.referenceParam || !mode.referenceShape)) fieldError(candidate, `modes.${mode.taskKind}.referenceParam`, 'required image input must be named with its shape');
  if (referenceTask && !media.some((p) => p.key === mode.referenceParam && (p.mediaKind || 'image') === 'image')) fieldError(candidate, `modes.${mode.taskKind}.referenceParam`, 'required image binding is absent from controls');
  const slots: ArchetypeReferenceSlot[] = [];
  const replacements = new Map<string, string>();
  const groups = [
    { media: 'image', kind: 'image_ref', key: 'referenceImages' },
    { media: 'video', kind: 'video_ref', key: 'referenceVideoUrls' },
    { media: 'audio', kind: 'audio_ref', key: 'referenceAudioUrls' },
  ] as const;
  for (const group of groups) {
    const inputs = media.filter((p) => (p.mediaKind || 'image') === group.media);
    if (!inputs.length) continue;
    if (group.media === 'image' && inputs.length === 1) slots.push({ kind: candidate.kind === 'video' ? 'first_frame' : 'image_ref', label: inputs[0].label, min: 1, max: 1, inputKey: inputs[0].key, asArray: false });
    else {
      slots.push({ kind: group.kind, label: REFERENCE_LABELS[group.kind], min: inputs.length, max: inputs.length, inputKey: group.key, asArray: true });
      inputs.forEach((input, index) => replacements.set(input.key, `${group.key}.${index}`));
    }
  }
  const remap = (value: unknown): unknown => {
    if (typeof value === 'string') return value.replace(/{{\s*request\.params\.([^{}]+?)\s*}}/g, (token, key: string) => replacements.has(key.trim()) ? `{{request.params.${replacements.get(key.trim())}}}` : token);
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item)]));
    return value;
  };
  const mediaKeys = new Set(media.map((p) => p.key));
  const create = { ...mode.create, body: remap(mode.create.body), defaultParams: Object.fromEntries(Object.entries(mode.create.defaultParams || {}).filter(([key]) => !mediaKeys.has(key))) };
  const reference = slots.find((slot) => slot.kind === 'first_frame' || slot.kind === 'image_ref');
  return { ...mode, create, controls: mode.controls!.filter((p) => p.type !== 'image-url'), referenceSlots: slots,
    ...(reference ? { referenceParam: reference.inputKey, referenceShape: reference.asArray ? 'array' : 'single' } : {}) };
}

/**
 * Wire names -> the Nomi parameter keys that stand for them (the first one is the key the hint shows).
 * A parameter is declared under Nomi's neutral key and the vendor's own field name stays in the wire, reading it:
 * `"seconds": "{{request.params.duration}}"`. The card schema has no `paramMap`, so this is the only way a card can pass;
 * the rejection text, the kit's worked examples and the "follow the hint verbatim" test all read this table.
 */
export const NEUTRAL_PARAMETER_ALIASES: Readonly<Record<string, readonly string[]>> = {
  seconds: ['duration'], duration_seconds: ['duration'], video_resolution: ['resolution'], image_size: ['resolution', 'aspect_ratio'], size: ['resolution', 'aspect_ratio'],
};

/** The AI door shows the first 600 characters of a rejection (`rejectionsFromError`); the key list is the part allowed to be cut, and says so. */
const REJECTION_TEXT_BUDGET = 600;

/** As many keys as fit in `room` characters, with an ellipsis when some were left out. */
function fitKeyList(keys: readonly string[], room: number): string {
  const all = keys.join(', ');
  if (all.length <= room) return all;
  const shown: string[] = [];
  let used = 0;
  for (const key of keys) {
    const next = used + key.length + (shown.length ? 2 : 0);
    if (next > room - 3) break;
    shown.push(key);
    used = next;
  }
  return shown.length ? `${shown.join(', ')}, …` : '…';
}

const isWireName = (key: string): boolean => Object.prototype.hasOwnProperty.call(NEUTRAL_PARAMETER_ALIASES, key);

export function assertNeutralDeclarationParameters(candidate: AdapterModelDraft): void {
  if (candidate.kind === 'text') return;
  const registered = new Set(MODEL_ARCHETYPES.filter((a) => a.kind === candidate.kind).flatMap((a) => a.modes.flatMap((m) => m.params.map((p) => p.key))));
  // A wire name is refused below even when some model registers it, so it is not offered as a key.
  const offered = [...registered].filter((key) => !isWireName(key)).sort();
  for (const p of candidate.parameters || []) {
    const alias = isWireName(p.key);
    const neutral = alias ? NEUTRAL_PARAMETER_ALIASES[p.key].filter((key) => registered.has(key)) : [];
    if (neutral.length) fieldError(candidate, `parameters.${p.key}`, `"${p.key}" is the wire name, not a Nomi parameter key: use ${neutral.map((key) => `"${key}"`).join(' or ')} as the parameter key and let the wire field read it, e.g. "${p.key}": "{{request.params.${neutral[0]}}}"`);
    if (alias || !registered.has(p.key)) {
      const head = `"${p.key}" is not a Nomi parameter key. Use a Nomi key and let the wire field read it ("${p.key}": "{{request.params.<nomi key>}}"), or drop it and write a fixed value in the wire. ${candidate.kind} keys: `;
      fieldError(candidate, `parameters.${p.key}`, head + fitKeyList(offered, REJECTION_TEXT_BUDGET - `models.${candidate.modelKey}.parameters.${p.key}: `.length - head.length));
    }
  }
}

export type DeclaredModelProjection = { kind: AdapterModelDraft["kind"]; meta: Record<string, unknown>; mappings: DeclaredMapping[]; contract: CustomCapabilityContractV1 | null; taskKinds: ProfileKind[] };

/** Kind, product modes, controls, required slots and wire are compiled together for every writer. */
export function projectDeclaredModel(candidate: CapabilityModelDraft, vendorKey: string, published?: readonly ProfileKind[]): DeclaredModelProjection {
  if (published?.some((taskKind) => !candidate.modes.some((mode) => mode.taskKind === taskKind))) fieldError(candidate, "modes", "verified taskKind is absent from the declaration");
  const parameterKeys = [...new Set([...(candidate.parameters || []).map((p) => p.key), ...candidate.modes.flatMap((m) => (m.controls || []).map((p) => p.key))])];
  for (const key of parameterKeys) if (candidate.kind !== 'text' && key.includes('.')) fieldError(candidate, `parameters.${key}`, 'nested parameter paths cannot be projected as a flat control');
  const normalizedModes = candidate.modes.map((mode) => normalizeControlReferences(mode, candidate)).map((mode) => ({ ...mode, create: projectDeclaredBindings(mode.create, new Set([...parameterKeys, ...(mode.referenceParam ? [mode.referenceParam] : [])])) }));
  const modes = normalizedModes.filter((mode) => !published || published.includes(mode.taskKind));
  if (!modes.length) fieldError(candidate, 'modes', 'no published mode');
  if (new Set(modes.map((m) => m.taskKind)).size !== modes.length) fieldError(candidate, 'modes', 'duplicate taskKind');
  const declaredParams: ModelParameterControl[] = (candidate.parameters || []).map((p) => ({ key: p.key, label: p.label, type: p.type, options: p.options || [], ...(p.default !== undefined ? { defaultValue: p.default } : {}), ...(p.min !== undefined ? { min: p.min } : {}), ...(p.max !== undefined ? { max: p.max } : {}) }));
  const params = [...new Map([...declaredParams, ...modes.flatMap((m) => m.controls || [])].map((p) => [p.key, p])).values()];
  for (const p of params) {
    if (candidate.kind !== 'text' && !normalizedModes.some((m) => modeReadsParameter(m, p.key))) fieldError(candidate, `parameters.${p.key}`, 'parameter has no request binding in create');
  }
  if (candidate.kind === 'text' && modes.some((mode) => modelKindForTaskKind(mode.taskKind))) fieldError(candidate, 'modes.taskKind', 'media taskKind cannot use the native text channel');
  const capabilityModes = candidate.kind === 'text' ? [] : modes.map((mode) => {
    if (modelKindForTaskKind(mode.taskKind) !== candidate.kind) fieldError(candidate, `modes.${mode.taskKind}.taskKind`, 'Nomi cannot project this taskKind for the declared kind');
    const wire = JSON.stringify(mode.create);
    const reference = ['image_to_video', 'image_edit', 'image_to_3d'].includes(mode.taskKind);
    const slots: ArchetypeReferenceSlot[] = mode.referenceSlots ? structuredClone(mode.referenceSlots) : [];
    if (reference) {
      if (!mode.referenceParam) fieldError(candidate, `modes.${mode.taskKind}.referenceParam`, 'required image input must be named');
      if (!mode.referenceShape) fieldError(candidate, `modes.${mode.taskKind}.referenceShape`, 'required image input shape must be explicit');
      if (mode.referenceParam.includes('.')) fieldError(candidate, `modes.${mode.taskKind}.referenceParam`, 'nested reference paths cannot be projected as an input slot');
      if (!readsParameter(wire, mode.referenceParam) && ![...DERIVED_REFERENCE_CARRIER_KEYS].some((key) => readsParameter(wire, key))) fieldError(candidate, `modes.${mode.taskKind}.referenceParam`, 'create does not read the declared reference parameter');
      const single = mode.referenceShape === 'single';
      if (mode.referenceSlots && !slots.some((slot) => slot.inputKey === mode.referenceParam && slot.min >= 1 && slot.asArray === !single)) fieldError(candidate, `modes.${mode.taskKind}.referenceSlots`, 'required reference metadata disagrees with slots');
      if (!mode.referenceSlots) slots.push({ kind: single && candidate.kind === 'video' ? 'first_frame' : 'image_ref', label: REFERENCE_LABELS[single && candidate.kind === 'video' ? 'first_frame' : 'image_ref'], min: 1, ...(single ? { max: 1 } : {}), inputKey: mode.referenceParam, asArray: !single });
    } else if (mode.referenceParam || mode.referenceShape) {
      fieldError(candidate, `modes.${mode.taskKind}.referenceParam`, 'this task cannot express the declared reference role');
    }
    for (const slot of slots) if (!slot.inputKey || (!readsParameter(wire, slot.inputKey) && !(slot.inputKey === mode.referenceParam && [...DERIVED_REFERENCE_CARRIER_KEYS].some((key) => readsParameter(wire, key))))) fieldError(candidate, `modes.${mode.taskKind}.referenceSlots`, 'every reference slot must have a create binding');
    const additionalReferences = [...wire.matchAll(/{{\s*request\.(?:(?:params|extras)\.)?([A-Za-z0-9_.-]+)\s*}}/g)].map((match) => match[1]).filter((key) => referenceKeyDeclarationFor(key) && key !== mode.referenceParam && !slots.some((slot) => key === slot.inputKey || key.startsWith(`${slot.inputKey}.`)) && !mode.controls?.some((p) => p.key === key && p.type === 'image-url') && !(reference && DERIVED_REFERENCE_CARRIER_KEYS.has(key)));
    if (additionalReferences.length) fieldError(candidate, `modes.${mode.taskKind}.create`, `undeclared reference roles: ${[...new Set(additionalReferences)].join(', ')}`);
    return { id: TASK_MODE_IDS[mode.taskKind] || mode.taskKind, intent: reference ? 'single' as const : 'text' as const, vendorTerm: TASK_LABELS[mode.taskKind] || mode.taskKind, hint: '', promptRequired: mode.taskKind !== 'transcribe', transportTaskKind: mode.taskKind as ArchetypeTransportTaskKind, slots, params: (mode.controls || params).filter((p) => p.key !== mode.referenceParam && modeReadsParameter(mode, p.key)) };
  });
  const contract = candidate.kind === 'text' ? null : normalizeCustomCapabilityContract({ version: 1, kind: candidate.kind, defaultModeId: capabilityModes[0].id, transportTaskKind: modes[0].taskKind, modes: capabilityModes });
  if (candidate.kind !== 'text' && !contract) fieldError(candidate, 'parameters/modes/slots', 'capability shape cannot be represented safely');
  const mappings = candidate.kind === 'text' ? [] : normalizedModes.map((mode) => {
    const controls = (mode.controls || params).filter((p) => modeReadsParameter(mode, p.key));
    const defaults = Object.fromEntries(controls.filter((p) => p.defaultValue !== undefined).map((p) => [p.key, p.defaultValue]));
    const wireDefaults = mode.create.defaultParams || {};
    for (const [key, value] of Object.entries(defaults)) if (key in wireDefaults && wireDefaults[key] !== value) fieldError(candidate, `modes.${mode.taskKind}.create.defaultParams.${key}`, 'wire default conflicts with the visible capability default');
    const create = Object.keys(defaults).length ? { ...mode.create, defaultParams: { ...wireDefaults, ...defaults } } : mode.create;
    return mappingRowFromDeclaredMode({ vendorKey, modelKey: candidate.modelKey, label: candidate.labelZh, mode: { ...mode, create }, enabled: !published || published.includes(mode.taskKind) });
  });
  const ownership = { version: 1, hasMediaContract: Boolean(contract), capabilityDigest: capabilityFactDigest(contract), wireDigests: Object.fromEntries(mappings.map((row) => [row.taskKind, capabilityFactDigest(declaredWireFact(row))])) };
  return { kind: candidate.kind, contract, mappings, taskKinds: candidate.kind === 'text' && !published ? [...new Set<ProfileKind>(['chat', ...modes.map((m) => m.taskKind)])] : modes.map((m) => m.taskKind), meta: { customCapabilityContract: contract || undefined, parameters: candidate.parameters || params.map(({ defaultValue, options, ...p }) => ({ ...p, default: defaultValue, ...(options.length ? { options: options.map((o) => o.value) } : {}) })), declarationProjection: ownership } };
}

export type DeclaredRouteConflictReason = 'unowned' | 'edited' | 'independent_mode' | 'capability_edited' | 'capability_authored';
type RouteEndpoint = { method: string; path: string };
export type DeclaredRouteConflict = { modelKey: string; reason: DeclaredRouteConflictReason; taskKind?: ProfileKind; modeId?: string; current?: RouteEndpoint; declared?: RouteEndpoint };

function conflictMessage(conflict: DeclaredRouteConflict): string {
  const at = conflict.taskKind ? `mappings.${conflict.taskKind}` : 'customCapabilityContract';
  const why = {
    unowned: 'unowned wire conflicts with declaration replacement; independent mappings are preserved',
    independent_mode: 'unowned wire conflicts with declaration replacement; independent mappings are preserved',
    edited: 'independently edited wire conflicts with declaration replacement',
    capability_edited: 'independently edited capability conflicts with declaration replacement',
    capability_authored: 'user-authored capability conflicts with declaration replacement',
  }[conflict.reason];
  return `models.${conflict.modelKey}.${at}: ${why}`;
}

/** A refused replacement names every conflict at once, so a caller can say what is in the way and offer an exit. */
export class DeclaredRouteConflictError extends Error {
  readonly vendorKey: string;
  readonly conflicts: readonly DeclaredRouteConflict[];
  constructor(vendorKey: string, conflicts: readonly DeclaredRouteConflict[]) {
    super(conflicts.map(conflictMessage).join('; '));
    this.name = 'DeclaredRouteConflictError';
    this.vendorKey = vendorKey;
    this.conflicts = conflicts;
  }
}

/** What goes on the wire. The enabled switch is not wire: promotion itself toggles it when it switches sources. */
const wireDigest = (row: Partial<Mapping>) => capabilityFactDigest({ ...declaredWireFact(row), enabled: undefined });
const ownedByDigest = (row: Mapping, digest: unknown) => [true, false].some((enabled) => capabilityFactDigest(declaredWireFact({ ...row, enabled })) === digest);
const endpointOf = (row: Partial<Mapping> | undefined): RouteEndpoint | undefined => row?.create ? { method: row.create.method, path: row.create.path } : undefined;

/** The ownership table. Facts only: never a vendor or model name, and no state of its own. */
function routeVerdict(row: Mapping, ownedDigest: unknown, next: DeclaredMapping | undefined, verifiedTaskKinds: readonly ProfileKind[] | undefined): 'replace' | 'keep' | DeclaredRouteConflictReason {
  if (row.modeId) return 'independent_mode';
  if (next && wireDigest(row) === wireDigest(next)) return 'replace';
  if (ownedDigest) return ownedByDigest(row, ownedDigest) ? 'replace' : 'edited';
  // A card is not evidence a route works, so only a certification run may adopt a route nobody owns.
  if (!verifiedTaskKinds) return 'unowned';
  return verifiedTaskKinds.includes(row.taskKind) ? 'replace' : 'keep';
}

function capabilityVerdict(oldMeta: Record<string, unknown>, projection: DeclaredModelProjection): DeclaredRouteConflictReason | null {
  const ownership = asRecord(oldMeta.declarationProjection);
  const contract = parseCustomCapabilityContract(oldMeta);
  if (ownership.version === 1) return capabilityFactDigest(contract) === ownership.capabilityDigest ? null : 'capability_edited';
  return contract && capabilityFactDigest(contract) !== capabilityFactDigest(projection.contract) ? 'capability_authored' : null;
}

/** A kept route is neither written over nor claimed: its digest would later read as an independent edit. */
function withoutKeptRoutes(projection: DeclaredModelProjection, kept: readonly Mapping[]): DeclaredModelProjection {
  const keptKinds = new Set<string>(kept.map((row) => row.taskKind));
  const ownership = asRecord(projection.meta.declarationProjection);
  const wireDigests = Object.fromEntries(Object.entries(asRecord(ownership.wireDigests)).filter(([taskKind]) => !keptKinds.has(taskKind)));
  return { ...projection, mappings: projection.mappings.filter((row) => !keptKinds.has(row.taskKind)), meta: { ...projection.meta, declarationProjection: { ...ownership, wireDigests } } };
}

export type DeclaredReplacementInput = {
  modelKey: string; oldMeta: unknown; mappings: readonly Mapping[]; projection: DeclaredModelProjection;
  /** Certification only: the modes this run proved. Absent = a declaration, which proves nothing about a route. */
  verifiedTaskKinds?: readonly ProfileKind[];
};
export type SettledDeclaredReplacement = { modelKey: string; projection: DeclaredModelProjection; keptRoutes: Mapping[] };

/**
 * One table for replacing a model's routes and capability, for every model of a write at once.
 * Refuses with every conflict, before any write; otherwise says what to write and which existing routes stay.
 */
export function assertDeclaredReplacementOwnership(vendorKey: string, inputs: readonly DeclaredReplacementInput[]): SettledDeclaredReplacement[] {
  const conflicts: DeclaredRouteConflict[] = [];
  const settled = inputs.map((input): SettledDeclaredReplacement => {
    const { modelKey, projection } = input;
    const old = asRecord(input.oldMeta);
    const capability = capabilityVerdict(old, projection);
    if (capability) conflicts.push({ modelKey, reason: capability });
    // A text model has no media route to replace; whatever rows it carries are not this write's business.
    if (projection.kind === 'text') return { modelKey, projection, keptRoutes: [...input.mappings] };
    const owned = asRecord(asRecord(old.declarationProjection).wireDigests);
    const keptRoutes: Mapping[] = [];
    for (const row of input.mappings) {
      const next = projection.mappings.find((item) => item.taskKind === row.taskKind);
      const verdict = routeVerdict(row, owned[row.taskKind], next, input.verifiedTaskKinds);
      if (verdict === 'keep') keptRoutes.push(row);
      else if (verdict !== 'replace') conflicts.push({ modelKey, reason: verdict, taskKind: row.taskKind, ...(row.modeId ? { modeId: row.modeId } : {}), current: endpointOf(row), ...(next ? { declared: endpointOf(next) } : {}) });
    }
    return { modelKey, projection: keptRoutes.length ? withoutKeptRoutes(projection, keptRoutes) : projection, keptRoutes };
  });
  if (conflicts.length) throw new DeclaredRouteConflictError(vendorKey, conflicts);
  return settled;
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
