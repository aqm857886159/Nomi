import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTempDir } from '../../scripts/_test-temp.mjs';
import { doorsForTargets } from '../../scripts/door-map.mjs';
import callers from './__fixtures__/promotionCallers.json';
import { relayDeclaration } from '../../tests/ux/_relayVideoFixture.mjs';
import type { ProviderAdapterDraft, ProviderAdapterRun } from '../providerAdapter/types';
import type { WorkflowBinding } from './comfyuiWorkflowImport';

import { mutateCatalog, readCatalog } from './catalogStore';
import { parseCustomCapabilityContract } from '../shared/customCapabilityContract';
import { consumedCanonicalKeys, wireReferencedParamKeys } from './paramTranslate';
import { analyzeComfyWorkflowText, importComfyWorkflowToCatalog, updateComfyWorkflowInCatalog } from './comfyuiWorkflowImportStore';
import { resolveComfyStagedCandidate, promoteCertifiedComfyCandidate, materializeCertifiedComfyAssets } from './comfyuiCandidateLifecycle';
import { registerDeclaredProvider } from './declaredProviderRegistration';
import { defaultCatalog, type LoadedConnection } from '../providerAdapter/serviceCatalog';
import { buildOpenAiCompatibleDraft, builtinDraftForUndocumentedEndpoint } from '../providerAdapter/builtinOpenAiCompatibleDraft';
import { genericCompilation } from '../providerAdapter/serviceFallback';
import { referenceKeyDeclarationFor } from '../shared/modelArchetypes/referenceKeys';
import { resolveArchetypeForModel } from '../shared/modelArchetypes';
import { NEWAPI_VIDEO_CREATE_OP } from './newapiTransport';
import { deriveModelNameSource } from './modelNameSource';
import { imageEditGuardError } from './taskParams';
import type { Model, Vendor } from './types';

let dir = '';
vi.mock('electron', () => ({ app: { getPath: () => dir, getAppPath: () => process.cwd() }, safeStorage: { isEncryptionAvailable: () => false } }));
beforeEach(() => { dir = makeTempDir('promotion-matrix-'); vi.stubEnv('NOMI_SETTINGS_DIR', dir); });
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); });
const graph = (prompt: string) => JSON.stringify({
  '1': { class_type: 'LoadImage', inputs: { image: 'source.png' } },
  '2': { class_type: 'CLIPTextEncode', inputs: { text: prompt } },
  '3': { class_type: 'KSampler', inputs: { positive: ['2', 0], steps: 7 } },
  '4': { class_type: 'VHS_VideoCombine', inputs: { images: ['3', 0], frame_rate: 24 } },
});
const evidence = [{ kind: 'video' as const, contentType: 'video/mp4', byteLength: 128, sha256: 'a'.repeat(64), metadata: { width: 16, height: 16, durationSeconds: 1, streamCount: 1 } }];
const dimensions = ['already-imported', 'new-import', 'edit', 'failed-edit-keeps-active', 'i2v-controls-and-slots'] as const;

const STANDARD_BASE_URL = 'http://127.0.0.1:9000';
type StandardRow = { modelKey: string; labelZh: string; kind: 'video' | 'image' };
const standardVendor = (): Vendor => ({ key: 'standard-relay', name: 'Standard', enabled: false, baseUrlHint: STANDARD_BASE_URL, authType: 'none', providerKind: 'openai-compatible', meta: { mediaProtocols: ['video-generations-json-v1'] }, createdAt: '', updatedAt: '' } as Vendor);
const standardModels = (rows: readonly StandardRow[]): Model[] => rows.map(row => ({ vendorKey: 'standard-relay', modelKey: row.modelKey, labelZh: row.labelZh, kind: row.kind, enabled: false, createdAt: '', updatedAt: '' }) as Model);
// Every producer door runs for real; only the connection it reads is fixture data.
const standardInput = (rows: readonly StandardRow[]) => ({ baseUrl: STANDARD_BASE_URL, authType: 'none' as const, providerKind: 'openai-compatible' as const, models: rows, mediaProtocols: ['video-generations-json-v1'] as const });
const standardProducers: Record<string, (rows: readonly StandardRow[]) => ProviderAdapterDraft | null> = {
  'parity-probe': (rows) => { const input = standardInput(rows); return buildOpenAiCompatibleDraft(input); },
  'standard-fallback': (rows) => genericCompilation({ vendor: standardVendor(), models: standardModels(rows), apiKey: '' } as LoadedConnection, standardModels(rows)).draft,
  'standard-undocumented': (rows) => builtinDraftForUndocumentedEndpoint({ vendor: standardVendor(), models: standardModels(rows) }),
};
const standardCases: StandardRow[] = [
  { modelKey: 'opaque-video', labelZh: 'Opaque video', kind: 'video' },
  { modelKey: 'seedance-2', labelZh: 'Shared archetype name', kind: 'video' },
  { modelKey: 'opaque-image', labelZh: 'Opaque image', kind: 'image' },
  { modelKey: 'gpt-image-2', labelZh: 'Multipart edit', kind: 'image' },
  { modelKey: 'grok-imagine-image', labelZh: 'JSON edit', kind: 'image' },
];
const REFERENCE_TASKS = new Set<string>(['image_to_video', 'image_edit']);
const wireKeys = (create: { body?: unknown; multipart?: { fields?: unknown } }) => wireReferencedParamKeys({ ...create, body: create.multipart?.fields ?? create.body } as never);
function publishStandard(draft: ProviderAdapterDraft, row: StandardRow, runId: string): string {
  const staged = defaultCatalog.stage({ vendorKey: 'standard-relay', catalogVendorKey: 'standard-relay', runId, vendorName: 'Standard', baseUrl: STANDARD_BASE_URL, authType: 'none', apiKey: '', models: [{ modelKey: row.modelKey, kind: row.kind }] });
  const verifiedModes = draft.models[0].modes.map(mode => ({ modelKey: row.modelKey, taskKind: mode.taskKind }));
  const run: ProviderAdapterRun = { id: runId, vendorKey: staged.vendor.key, vendorName: 'Standard', connectionFingerprint: 'fixture', selectedModelKeys: [row.modelKey], stage: 'completed', repairAttempt: 0, models: [{ modelKey: row.modelKey, labelZh: row.labelZh, kind: row.kind, modes: draft.models[0].modes.map(mode => ({ taskKind: mode.taskKind, state: 'verified' as const, attempts: 1 })) }], sourceUrls: [], createdAt: '', updatedAt: '' };
  expect(defaultCatalog.promote({ run, draft, verifiedModes, revision: { id: runId, vendorKey: staged.vendor.key, digest: runId, draft, verifiedModes, createdAt: '' } }).status).toBe('committed');
  return staged.vendor.key;
}
it('the caller inventory equals the shared promotion property census and its wrapper hops', () => {
  const actual = doorsForTargets(['promote']);
  expect(actual.map((d: { path: string }) => d.path).sort()).toEqual(callers.filter(c => c.symbol === 'promote').map(c => c.path).sort());
  for (const caller of callers) expect(fs.readFileSync(path.resolve(caller.path), 'utf8')).toContain(caller.symbol);
  expect(doorsForTargets(['promoteCertifiedComfyCandidate']).map((d: { path: string }) => d.path).sort()).toEqual(['electron/catalog/comfyuiCandidateLifecycle.ts', 'electron/integrationCertification/integrationSession.ts']);
});
it('the standard draft producers equal their door census', () => {
  const doorPaths = (symbol: string) => [...new Set(doorsForTargets([symbol]).map((d: { path: string }) => d.path))].sort();
  expect(doorPaths('buildOpenAiCompatibleDraft')).toEqual(['electron/parity/generationParityTestUtils.ts', 'electron/providerAdapter/builtinOpenAiCompatibleDraft.ts', 'electron/providerAdapter/serviceFallback.ts']);
  expect(doorPaths('builtinDraftForUndocumentedEndpoint')).toEqual(['electron/providerAdapter/service.ts']);
  expect(doorPaths('genericCompilation')).toEqual(['electron/providerAdapter/service.ts', 'electron/providerAdapter/serviceCompilation.ts']);
  expect(callers.filter(c => c.input === 'standard-draft').map(c => c.id).sort()).toEqual(Object.keys(standardProducers).sort());
});
describe.each(callers.filter(c => c.input !== 'standard-draft'))('$id capability input lifecycle matrix', (caller) => {
  it.each(dimensions)('%s', async (dimension) => {
    let vendorKey: string, modelKey: string;
    if (caller.input === 'workflow') {
      const bindingFor = (text: string) => (analyzeComfyWorkflowText(text) as { analysis: { suggested: WorkflowBinding } }).analysis.suggested;
      const text = graph('first');
      const staged = importComfyWorkflowToCatalog({ text, binding: bindingFor(text), labelZh: 'Opaque workflow' }, 'first') as { ok: true; vendorKey: string; modelKey: string; revisionId: string; taskKind: 'image_to_video' };
      expect(staged.ok).toBe(true);
      const settle = async (item: typeof staged) => {
        const candidate = resolveComfyStagedCandidate(item);
        if (caller.id === 'workflow-materialization') await materializeCertifiedComfyAssets({ certification: { candidate, evidence }, status: 'succeeded', urls: ['https://fixture.invalid/video.mp4'], materialize: async () => 'nomi-local://asset/fixture' });
        else promoteCertifiedComfyCandidate(candidate, evidence); // exact terminal callback used by connector/session
      };
      await settle(staged);
      vendorKey = staged.vendorKey; modelKey = staged.modelKey;
      if (dimension === 'already-imported') expect(JSON.parse(fs.readFileSync(path.join(dir, 'model-catalog.json'), 'utf8')).models.some((m: { modelKey: string }) => m.modelKey === modelKey)).toBe(true);
      if (dimension === 'edit' || dimension === 'failed-edit-keeps-active') {
        const before = readCatalog();
        const edited = graph('edited');
        const next = updateComfyWorkflowInCatalog({ vendorKey, modelKey, text: edited, binding: bindingFor(edited), labelZh: 'Edited' }) as typeof staged;
        if (dimension === 'edit') { await settle(next); vendorKey = next.vendorKey; }
        else {
          await expect(materializeCertifiedComfyAssets({ certification: { candidate: resolveComfyStagedCandidate(next), evidence }, status: 'succeeded', urls: ['https://fixture.invalid/bad.mp4'], materialize: async () => { throw new Error('bad output'); } })).rejects.toThrow('bad output');
          const active = readCatalog().models.find(m => m.vendorKey === vendorKey && m.modelKey === modelKey)!;
          expect(active).toEqual(before.models.find(m => m.vendorKey === vendorKey && m.modelKey === modelKey));
          expect(readCatalog().mappings.filter(m => m.vendorKey === vendorKey)).toEqual(before.mappings.filter(m => m.vendorKey === vendorKey));
        }
      }
    } else {
      const draft = relayDeclaration('http://127.0.0.1:9000', { frameOnly: true }) as ProviderAdapterDraft;
      draft.provider.authType = 'none'; modelKey = draft.models[0].modelKey; vendorKey = 'matrix-relay';
      const publish = (runId: string) => {
        if (caller.input === 'declaration') { registerDeclaredProvider({ card: draft, vendorKey }); return; }
        const staged = defaultCatalog.stage({ vendorKey, catalogVendorKey: vendorKey, runId, vendorName: 'Matrix', baseUrl: draft.provider.baseUrl, authType: 'none', apiKey: '', models: [{ modelKey, kind: 'video' }] });
        const verifiedModes = [{ modelKey, taskKind: 'image_to_video' as const }];
        const run: ProviderAdapterRun = { id: runId, vendorKey: staged.vendor.key, vendorName: 'Matrix', connectionFingerprint: 'fixture', selectedModelKeys: [modelKey], stage: 'completed', repairAttempt: 0, models: [{ modelKey, labelZh: 'Matrix', kind: 'video', modes: [{ taskKind: 'image_to_video', state: 'verified', attempts: 1 }] }], sourceUrls: [], createdAt: '', updatedAt: '' };
        expect(defaultCatalog.promote({ run, draft, verifiedModes, revision: { id: runId, vendorKey: staged.vendor.key, digest: runId, draft, verifiedModes, createdAt: '' } }).status).toBe('committed');
        vendorKey = staged.vendor.key;
      };
      publish('first');
      if (dimension === 'already-imported') expect(JSON.parse(fs.readFileSync(path.join(dir, 'model-catalog.json'), 'utf8')).models.some((m: { modelKey: string }) => m.modelKey === modelKey)).toBe(true);
      if (dimension === 'edit') { draft.models[0].labelZh = 'Edited'; publish('edit'); }
      if (dimension === 'failed-edit-keeps-active') {
        const before = readCatalog(); draft.models[0].modes[0].referenceParam = undefined;
        if (caller.input === 'declaration') expect(() => publish('bad')).toThrow(/referenceParam/);
        else {
          // A prepared but invalid edit may stage separately; the active source remains exact.
          expect(() => publish('bad')).toThrow(/referenceParam/);
          const active = readCatalog().models.find(m => m.vendorKey === vendorKey && m.modelKey === modelKey)!;
          expect(active).toEqual(before.models.find(m => m.vendorKey === vendorKey && m.modelKey === modelKey));
        }
      }
    }
    const state = readCatalog(); const model = state.models.find(m => m.vendorKey === vendorKey && m.modelKey === modelKey)!;
    const contract = parseCustomCapabilityContract(model.meta)!;
    expect(contract?.modes).toHaveLength(1);
    expect(contract.modes[0].slots[0]).toMatchObject({ min: 1, max: 1 });
    expect(contract.modes[0].params.length).toBeGreaterThan(0);
    const mapping = state.mappings.find(m => m.vendorKey === vendorKey && m.modelKey === modelKey && m.enabled)!;
    const covered = new Set([...wireReferencedParamKeys(mapping.create), ...consumedCanonicalKeys(mapping.create?.paramMap)]);
    for (const p of contract.modes[0].params) expect(covered.has(p.key), `${caller.id}: ${p.key}`).toBe(true);
  });
});
describe.each(callers.filter(c => c.input === 'standard-draft'))('$id standard draft lifecycle matrix', (caller) => {
  describe.each(standardCases)('$modelKey', (row) => {
    it.each(dimensions)('%s', (dimension) => {
      const draft = standardProducers[caller.id]([row])!;
      expect(draft).toBeTruthy();
      if (!draft.models[0]?.modes.length) {
        // The fallback door has no connection facts about a video protocol, so it may honestly offer no route.
        expect(`${caller.id}:${row.kind}`).toBe('standard-fallback:video');
        return;
      }
      let vendorKey = publishStandard(draft, row, 'first');
      if (dimension === 'already-imported') expect(readCatalog().models.some(m => m.vendorKey === vendorKey && m.modelKey === row.modelKey)).toBe(true);
      if (dimension === 'edit') { draft.models[0].labelZh = 'Edited'; vendorKey = publishStandard(draft, row, 'edit'); }
      if (dimension === 'failed-edit-keeps-active') {
        const before = readCatalog();
        const broken = structuredClone(draft);
        const reference = broken.models[0].modes.find(mode => REFERENCE_TASKS.has(mode.taskKind))!;
        delete reference.referenceParam;
        expect(() => publishStandard(broken, row, 'bad')).toThrow(/referenceParam/);
        const after = readCatalog();
        expect(after.models.find(m => m.vendorKey === vendorKey && m.modelKey === row.modelKey)).toEqual(before.models.find(m => m.vendorKey === vendorKey && m.modelKey === row.modelKey));
        expect(after.mappings.filter(m => m.vendorKey === vendorKey)).toEqual(before.mappings.filter(m => m.vendorKey === vendorKey));
      }
      const state = readCatalog();
      const model = state.models.find(m => m.vendorKey === vendorKey && m.modelKey === row.modelKey)!;
      const contract = parseCustomCapabilityContract(model.meta)!;
      expect(contract.modes.map(mode => mode.transportTaskKind).sort()).toEqual(draft.models[0].modes.map(mode => mode.taskKind).sort());
      for (const mode of contract.modes) {
        const mapping = state.mappings.find(m => m.vendorKey === vendorKey && m.modelKey === row.modelKey && m.taskKind === mode.transportTaskKind)!;
        const read = wireKeys(mapping.create);
        if (REFERENCE_TASKS.has(mode.transportTaskKind)) {
          expect(mode.slots[0], mode.transportTaskKind).toMatchObject({ min: 1 });
          if (row.kind === 'video') {
            expect(mode.slots[0]).toMatchObject({ min: 1, max: 1, inputKey: 'image_url' });
            expect(JSON.stringify(mapping.create.body)).toContain('request.params.image_url');
          }
        } else {
          // A mode with no declared reference role reads no reference key; the judge is the live reference table, not a key name.
          expect(mode.slots, mode.transportTaskKind).toEqual([]);
          expect([...read].filter(key => referenceKeyDeclarationFor(key)), mode.transportTaskKind).toEqual([]);
        }
        const covered = new Set([...read, ...consumedCanonicalKeys(mapping.create?.paramMap)]);
        for (const p of mode.params) expect(covered.has(p.key), `${caller.id}: ${mode.transportTaskKind}.${p.key}`).toBe(true);
      }
    });
  });
});
describe('a first frame on a standard text route', () => {
  const row = standardCases[0];
  const request = { extras: { firstFrameUrl: 'https://cdn.example.test/first.png' } };
  const modes = () => { const input = standardInput([row]); return buildOpenAiCompatibleDraft(input).models[0].modes; };
  it('a pure text-to-video request carries no image key at all', () => {
    expect(modes().find(mode => mode.taskKind === 'text_to_video')!.create.body).not.toHaveProperty('image');
    expect(modes().find(mode => mode.taskKind === 'image_to_video')!.create.body).toHaveProperty('image', '{{request.params.image_url}}');
  });
  it('is refused before spending and pointed at the image-to-video mode', () => {
    const all = modes();
    const t2v = all.find(mode => mode.taskKind === 'text_to_video')!;
    const refusal = imageEditGuardError('text_to_video', request, true, row.labelZh, t2v.create.body, all.map(mode => ({ taskKind: mode.taskKind, body: mode.create.body })));
    expect(refusal).toMatch(/首帧/);
    expect(refusal).toMatch(/图生视频/);
    expect(imageEditGuardError('image_to_video', request, true, row.labelZh, all.find(mode => mode.taskKind === 'image_to_video')!.create.body)).toBeNull();
  });
});
describe('the model names a relay row can state', () => {
  const row = standardCases[1]; // Named like a shared archetype, the most common name on a relay.
  const resolve = (vendorKey: string, source?: 'archetype') => {
    const state = readCatalog();
    const model = state.models.find(m => m.vendorKey === vendorKey && m.modelKey === row.modelKey)!;
    return resolveArchetypeForModel({ modelKey: model.modelKey, vendorKey, meta: model.meta, modelNameSource: source ?? deriveModelNameSource(model, state.mappings) });
  };
  it('a certified row states its own key at most, never the shared archetype names', () => {
    const vendorKey = publishStandard(standardProducers['parity-probe']([row])!, row, 'first');
    expect(resolve(vendorKey, 'archetype')).toMatchObject({ family: 'custom-capability', catalogModelKey: row.modelKey });
    expect(resolve(vendorKey, 'archetype')?.variants).toBeUndefined();
    expect(resolve(vendorKey)?.catalogModelKey).toBeUndefined();
  });
  it('a row with no contract keeps the shared parameters and states none of its names', () => {
    mutateCatalog((tx) => {
      tx.upsertVendor({ key: 'manual-relay', name: 'Manual', enabled: true, baseUrlHint: STANDARD_BASE_URL, authType: 'none', providerKind: 'openai-compatible' });
      tx.upsertModel({ vendorKey: 'manual-relay', modelKey: row.modelKey, labelZh: row.labelZh, kind: row.kind, enabled: true, meta: {} });
      tx.upsertMapping({ vendorKey: 'manual-relay', modelKey: row.modelKey, taskKind: 'text_to_video', name: 'manual', enabled: true, create: NEWAPI_VIDEO_CREATE_OP });
    });
    expect(resolve('manual-relay', 'archetype')?.family).not.toBe('custom-capability');
    expect(resolve('manual-relay', 'archetype')?.variants?.length).toBeGreaterThan(0);
    const scoped = resolve('manual-relay')!;
    expect(scoped.family).not.toBe('custom-capability');
    expect(scoped.variants).toBeUndefined();
    expect(scoped.catalogModelKey).toBeUndefined();
    expect(scoped.modes.some(mode => mode.modelEnum)).toBe(false);
  });
});
