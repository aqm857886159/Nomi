import fs from 'node:fs';
import { enModelDisplayText } from '../../src/i18n/locales/modelDisplayText';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { makeTempDir } from '../../scripts/_test-temp.mjs';
import { relayDeclaration } from '../../tests/ux/_relayVideoFixture.mjs';
import { registerDeclaredProvider } from './declaredProviderRegistration';
import { readCatalog, mutateCatalog } from './catalogStore';
import { adapterModelMetadataForPromotion, projectDeclaredModel } from '../providerAdapter/promotionMeta';
import { derivePublishedExecution } from '../shared/modelPublication';
import { agentModelEntriesFromCatalog } from './agentModelEntriesFromCatalog';
import type { CustomCapabilityContractV1 } from '../shared/customCapabilityContract';
import { assertDeclaredCapabilityForTask } from '../shared/modelAvailability';
import { runTask } from '../runtime';
import { buildOpenAiCompatibleDraft } from '../providerAdapter/builtinOpenAiCompatibleDraft';
import { defaultCatalog } from '../providerAdapter/serviceCatalog';
import type { ProviderAdapterDraft, ProviderAdapterRun } from '../providerAdapter/types';

let dir: string;
beforeEach(() => { dir = makeTempDir('capability-projection-'); vi.stubEnv('NOMI_SETTINGS_DIR', dir); });
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); });
const card = (id = 'opaque-gamma'): ProviderAdapterDraft => relayDeclaration('http://127.0.0.1:9000', { id }) as ProviderAdapterDraft;
function dual(id?: string) {
  const draft = card(id);
  draft.models[0].modes.push((relayDeclaration(draft.provider.baseUrl, { frameOnly: true }) as ProviderAdapterDraft).models[0].modes[0]);
  return draft;
}
describe('declared capability projection publication matrix', () => {
  it.each(['opaque-gamma', 'veo3.1-fast'])('registration and promotion preserve the same full fact for %s', (id) => {
    const draft = dual(id);
    const result = registerDeclaredProvider({ card: draft, vendorKey: 'relay' });
    const state = readCatalog();
    const model = state.models.find((m) => m.vendorKey === result.vendorKey && m.modelKey === id)!;
    const compiled = projectDeclaredModel(draft.models[0], result.vendorKey);
    const promoted = adapterModelMetadataForPromotion({ oldMeta: {}, candidate: draft.models[0], modeResults: draft.models[0].modes.map((m) => ({ taskKind: m.taskKind, state: 'verified', attempts: 1 })), runId: 'run', revisionId: 'rev', updatedAt: '', projection: compiled });
    expect(model.meta).toMatchObject(compiled.meta);
    expect(promoted).toMatchObject(compiled.meta);
    expect(compiled.contract?.modes[0].params).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'duration', defaultValue: 1 }), expect.objectContaining({ key: 'resolution', defaultValue: '360p' })]));
    expect(compiled.contract?.modes[1].slots).toEqual([{ kind: 'first_frame', label: '首帧', min: 1, max: 1, inputKey: 'image_url', asArray: false }]);
    for (const mode of compiled.contract!.modes) {
      expect(enModelDisplayText[mode.vendorTerm]).toBeTruthy();
      for (const slot of mode.slots) expect(enModelDisplayText[slot.label]).toBeTruthy();
    }
    expect(state.mappings.filter((m) => m.vendorKey === result.vendorKey)).toHaveLength(2);
    expect(agentModelEntriesFromCatalog(state).find((m) => m.entry.modelId === id)?.entry.modes.map((m) => m.modeId)).toEqual(['t2v', 'i2v']);
  });
  it('real certification publication and replacement keep the same controls, slots and full wire as registration', () => {
    const draft = dual();
    draft.provider.authType = 'none';
    draft.models[0].modes[0].abandon = { via: 'poll-to-completion' };
    const declared = registerDeclaredProvider({ card: draft, vendorKey: 'declared' });
    const declaredModel = readCatalog().models.find((m) => m.vendorKey === declared.vendorKey)!;
    function promote(runId: string, source: string) {
      const staged = defaultCatalog.stage({ vendorKey: source, catalogVendorKey: source, runId, vendorName: 'Certification', baseUrl: draft.provider.baseUrl, authType: 'none', providerKind: 'openai-compatible', apiKey: '', models: [{ modelKey: draft.models[0].modelKey, kind: 'video' }] });
      const modes = draft.models[0].modes.map((m) => ({ taskKind: m.taskKind, state: 'verified' as const, attempts: 1 }));
      const run: ProviderAdapterRun = { id: runId, vendorKey: staged.vendor.key, vendorName: 'Certification', connectionFingerprint: 'fixture', selectedModelKeys: [draft.models[0].modelKey], stage: 'completed', repairAttempt: 0, models: [{ modelKey: draft.models[0].modelKey, labelZh: 'Opaque', kind: 'video', modes }], sourceUrls: [], createdAt: '', updatedAt: '' };
      const verifiedModes = modes.map((m) => ({ modelKey: draft.models[0].modelKey, taskKind: m.taskKind }));
      expect(defaultCatalog.promote({ run, draft, verifiedModes, revision: { id: runId, vendorKey: staged.vendor.key, digest: runId, draft, verifiedModes, createdAt: '' } }).status).toBe('committed');
      return staged.vendor.key;
    }
    const certified = promote('certify-1', 'certified');
    const before = readCatalog();
    const certifiedModel = before.models.find((m) => m.vendorKey === certified)!;
    expect(certifiedModel.meta).toMatchObject({ customCapabilityContract: (declaredModel.meta as Record<string, unknown>).customCapabilityContract });
    expect(before.mappings.find((m) => m.vendorKey === certified && m.taskKind === 'text_to_video')).toMatchObject({ delivery: 'asynchronous', abandon: { via: 'poll-to-completion' } });
    draft.models[0].modes = draft.models[0].modes.filter((m) => m.taskKind === 'image_to_video');
    const replacement = promote('certify-2', certified);
    const after = readCatalog();
    const active = after.models.find((m) => m.vendorKey === replacement)!;
    expect(derivePublishedExecution(active, { mappings: after.mappings }).publishedModes).toEqual(['image_to_video']);
    expect(after.mappings.filter((m) => m.vendorKey === certified && m.enabled)).toEqual([]);
  });
  it.each(['text_to_video', 'image_to_video'] as const)('withdraws owned modes in both shrink directions: keep %s', (keep) => {
    const draft = dual();
    const first = registerDeclaredProvider({ card: draft, vendorKey: 'relay' });
    registerDeclaredProvider({ card: card('another'), vendorKey: 'relay' });
    const unrelated = readCatalog().models.find((m) => m.modelKey === 'another');
    draft.models[0].modes = draft.models[0].modes.filter((m) => m.taskKind === keep);
    registerDeclaredProvider({ card: draft, vendorKey: first.vendorKey });
    const state = readCatalog();
    const model = state.models.find((m) => m.modelKey === 'opaque-gamma')!;
    expect(state.mappings.filter((m) => m.modelKey === model.modelKey && m.enabled).map((m) => m.taskKind)).toEqual([keep]);
    expect(derivePublishedExecution(model, { mappings: state.mappings }).publishedModes).toEqual([keep]);
    expect(state.models.find((m) => m.modelKey === 'another')).toEqual(unrelated);
  });
  it('direct dispatch cannot use the implicit protocol fallback for a withdrawn task kind', async () => {
    const draft = dual();
    draft.provider.authType = 'none';
    registerDeclaredProvider({ card: draft, vendorKey: 'relay' });
    draft.models[0].modes = draft.models[0].modes.filter((m) => m.taskKind === 'image_to_video');
    registerDeclaredProvider({ card: draft, vendorKey: 'relay' });
    await expect(runTask({ vendor: 'relay', request: { kind: 'text_to_video', prompt: 'A blue marble', extras: { modelKey: draft.models[0].modelKey } } })).rejects.toThrow(/does not publish taskKind/);
  });
  it('text declarations remain chat and do not require a media capability contract', () => {
    const draft = card('opaque-chat');
    draft.models[0].kind = 'text';
    draft.models[0].parameters = [];
    draft.models[0].modes = [{ taskKind: 'chat', create: { method: 'POST', path: '/v1/chat/completions', body: { messages: [{ role: 'user', content: '{{request.prompt}}' }] } }, sourceUrls: [] }];
    registerDeclaredProvider({ card: draft, vendorKey: 'relay' });
    const state = readCatalog();
    const model = state.models.find((m) => m.modelKey === 'opaque-chat')!;
    expect(derivePublishedExecution(model, { mappings: state.mappings }).publishedModes).toEqual(['chat']);
    expect(() => assertDeclaredCapabilityForTask(model.meta, 'chat')).not.toThrow();
  });
  it('does not replace the existing workflow or manual capability admission lifecycle', () => {
    const projection = projectDeclaredModel(card().models[0], 'relay');
    const manualMeta = { customCapabilityContract: projection.contract, adapter: { publicationModes: [] } };
    expect(() => assertDeclaredCapabilityForTask(manualMeta, 'text_to_video')).not.toThrow();
    expect(() => assertDeclaredCapabilityForTask({ ...projection.meta, adapter: { publicationModes: [] } }, 'text_to_video')).toThrow(/does not publish/);
  });
  it('keeps a same-name model in a different connection unchanged', () => {
    registerDeclaredProvider({ card: dual(), vendorKey: 'relay-a' });
    registerDeclaredProvider({ card: dual(), vendorKey: 'relay-b' });
    const before = readCatalog().mappings.filter((m) => m.vendorKey === 'relay-b');
    registerDeclaredProvider({ card: card(), vendorKey: 'relay-a' });
    expect(readCatalog().mappings.filter((m) => m.vendorKey === 'relay-b')).toEqual(before);
  });
  it.each(['wire', 'capability'] as const)('refuses to erase independent %s edits atomically', (field) => {
    registerDeclaredProvider({ card: dual(), vendorKey: 'relay' });
    mutateCatalog((tx, state) => {
      if (field === 'wire') tx.upsertMapping({ ...state.mappings.find((m) => m.taskKind === 'image_to_video'), create: { method: 'POST', path: '/independent' } });
      else { const model = state.models[0]; const meta = structuredClone(model.meta) as { customCapabilityContract: CustomCapabilityContractV1 }; meta.customCapabilityContract.modes[0].hint = 'user edit'; tx.upsertModel({ ...model, meta }); }
    });
    const before = readCatalog();
    expect(() => registerDeclaredProvider({ card: card(), vendorKey: 'relay' })).toThrow(/independently edited/);
    expect(readCatalog()).toEqual(before);
  });
  it('refuses to rebuild a target model containing an independent mode without touching its timestamps', () => {
    registerDeclaredProvider({ card: dual(), vendorKey: 'relay' });
    mutateCatalog((tx) => tx.upsertMapping({ vendorKey: 'relay', modelKey: 'opaque-gamma', modeId: 'independent', taskKind: 'text_to_video', name: 'User mapping', enabled: true, create: { method: 'POST', path: '/user-owned' } }));
    const before = readCatalog();
    expect(() => registerDeclaredProvider({ card: card(), vendorKey: 'relay' })).toThrow(/unowned wire/);
    expect(readCatalog()).toEqual(before);
  });
  it.each(['missing-reference', 'unbound-parameter', 'bad-default'] as const)('rejects unrepresentable field before writing: %s', (shape) => {
    const draft = dual();
    if (shape === 'missing-reference') delete draft.models[0].modes[1].referenceParam;
    if (shape === 'unbound-parameter') draft.models[0].parameters!.push({ key: 'unused', label: 'Unused', type: 'text' });
    if (shape === 'bad-default') draft.models[0].parameters![0].default = 100;
    draft.models.unshift(card('valid-before-invalid').models[0]);
    const before = readCatalog();
    expect(() => registerDeclaredProvider({ card: draft, vendorKey: 'relay' })).toThrow(/models\./);
    expect(readCatalog()).toEqual(before);
  });
  it.each(['opaque-image', 'gpt-image-2', 'grok-imagine'])('preserves existing generic image protocol shapes: %s', (modelKey) => {
    const draft = buildOpenAiCompatibleDraft({ baseUrl: 'http://127.0.0.1:9000', authType: 'none', models: [{ modelKey, labelZh: modelKey, kind: 'image' }] });
    const projection = projectDeclaredModel(draft.models[0], 'relay');
    expect(projection.taskKinds).toContain('image_edit');
    expect(projection.contract?.modes.find((m) => m.transportTaskKind === 'image_edit')?.slots[0].min).toBe(1);
    for (const mode of projection.contract!.modes) for (const slot of mode.slots) expect(enModelDisplayText[slot.label]).toBeTruthy();
  });
  it('rejects a certified publication mask that names a mode absent from the card', () => {
    expect(() => projectDeclaredModel(card().models[0], 'relay', ['text_to_video', 'image_to_video'])).toThrow(/verified taskKind is absent/);
  });
  it('rejects an undeclared tail frame instead of inventing another input role', () => {
    const draft = dual();
    draft.models[0].modes[1].create.body = { image: '{{request.params.image_url}}', tail: '{{request.params.last_frame_url}}' };
    expect(() => projectDeclaredModel(draft.models[0], 'relay')).toThrow(/undeclared reference roles/);
  });
  it('rejects undeclared image references in a text-only video mode before writing', () => {
    const draft = card();
    draft.models[0].modes[0].create.body = { duration: '{{request.params.duration}}', resolution: '{{request.params.resolution}}', image: '{{request.params.image_url}}' };
    const before = readCatalog();
    expect(() => registerDeclaredProvider({ card: draft, vendorKey: 'relay' })).toThrow(/undeclared reference roles/);
    expect(readCatalog()).toEqual(before);
  });
  it('compiles legacy flat bindings into the existing params channel and derives headless defaults', () => {
    const draft = card();
    draft.models[0].modes[0].create.body = { duration: '{{request.duration}}', resolution: '{{request.resolution}}' };
    const projection = projectDeclaredModel(draft.models[0], 'relay');
    expect(projection.mappings[0].create.body).toEqual({ duration: '{{request.params.duration}}', resolution: '{{request.params.resolution}}' });
    expect(projection.mappings[0].create.defaultParams).toEqual({ duration: 1, resolution: '360p' });
    draft.models[0].modes[0].create.defaultParams = { duration: 5 };
    expect(() => projectDeclaredModel(draft.models[0], 'relay')).toThrow(/defaultParams.duration/);
  });
  it('removes old query/result fields instead of inheriting them during replacement', () => {
    const draft = card();
    draft.models[0].modes[0].result = { method: 'GET', path: '/old-result' };
    registerDeclaredProvider({ card: draft, vendorKey: 'relay' });
    delete draft.models[0].modes[0].result;
    delete draft.models[0].modes[0].query;
    draft.models[0].modes[0].delivery = 'synchronous';
    registerDeclaredProvider({ card: draft, vendorKey: 'relay' });
    const mapping = readCatalog().mappings.find((m) => m.vendorKey === 'relay')!;
    expect(mapping.query).toBeUndefined();
    expect(mapping.result).toBeUndefined();
  });
});
