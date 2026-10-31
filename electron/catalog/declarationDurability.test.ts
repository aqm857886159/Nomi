import fs from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeTempDir } from '../../scripts/_test-temp.mjs';
import { relayDeclaration } from '../../tests/ux/_relayVideoFixture.mjs';
import { registerDeclaredProvider } from './declaredProviderRegistration';
import { readCatalog } from './catalogStore';
import { migrateDeclaredCapabilities } from './catalogMigrations';
import type { ProviderAdapterDraft } from '../providerAdapter/types';
import { applyParamMap, consumedCanonicalKeys, wireReferencedParamKeys } from './paramTranslate';
import { projectDeclaredModel } from '../providerAdapter/promotionMeta';

let dir: string;
beforeEach(() => { dir = makeTempDir('declaration-source-'); vi.stubEnv('NOMI_SETTINGS_DIR', dir); });
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); });
const card = () => relayDeclaration('http://127.0.0.1:9000') as ProviderAdapterDraft;
it('stores the original per-model card atomically and without mutable input aliases', () => {
  const draft = card(); draft.omitted = [{ field: 'audio', reason: 'unsupported', sourceUrl: draft.sources[0].url }];
  registerDeclaredProvider({ card: draft, vendorKey: 'relay' });
  const model = readCatalog().models.find(m => m.vendorKey === 'relay')!;
  draft.models[0].parameters![0].default = 99;
  expect(model.meta).toMatchObject({ declarationSource: { version: 1, card: { sources: draft.sources, omitted: draft.omitted, models: [expect.objectContaining({ parameters: expect.arrayContaining([expect.objectContaining({ key: 'duration', default: 1 })]) })] } } });
});
it('restores a missing projection from the durable card without an adapter revision', () => {
  registerDeclaredProvider({ card: card(), vendorKey: 'relay' });
  const state = readCatalog(); const model = state.models.find(m => m.vendorKey === 'relay')!;
  delete (model.meta as Record<string, unknown>).customCapabilityContract;
  const restored = migrateDeclaredCapabilities(state, []);
  expect(restored.models.find(m => m.vendorKey === 'relay')?.meta).toMatchObject({ customCapabilityContract: { kind: 'video' } });
  expect(migrateDeclaredCapabilities(restored, [])).toEqual(restored);
});
it('records declaration-only evidence as untried without inventing generated media', () => {
  registerDeclaredProvider({ card: card(), vendorKey: 'relay' });
  expect(readCatalog().models.find(m => m.vendorKey === 'relay')?.meta).toMatchObject({ adapter: { state: 'declared', evidence: 'self-check' } });
  expect(JSON.stringify(readCatalog().models.find(m => m.vendorKey === 'relay')?.meta)).not.toContain('mediaEvidence');
});
it('refuses wire aliases as declaration controls and leaves the catalog unchanged', () => {
  const draft = card(); draft.models[0].parameters![0].key = 'seconds';
  draft.models[0].modes[0].create.body = { seconds: '{{request.params.seconds}}', resolution: '{{request.params.resolution}}' };
  const before = readCatalog();
  expect(() => registerDeclaredProvider({ card: draft, vendorKey: 'relay' })).toThrow(/parameters.seconds.*duration/);
  expect(readCatalog()).toEqual(before);
});
it('uses the existing canonical coverage invariant for translated declaration controls', () => {
  const draft = card(); const create = draft.models[0].modes[0].create;
  create.body = { seconds: '{{request.params.seconds}}', resolution: '{{request.params.resolution}}' };
  create.paramMap = { rules: [{ wire: 'seconds', from: 'duration' }] };
  const projected = projectDeclaredModel(draft.models[0], 'relay');
  const op = projected.mappings[0].create!;
  const covered = new Set([...wireReferencedParamKeys(op), ...consumedCanonicalKeys(op.paramMap)]);
  for (const param of projected.contract!.modes[0].params) expect(covered.has(param.key)).toBe(true);
  expect(applyParamMap(op.paramMap, { duration: 1, resolution: '360p' })).toMatchObject({ seconds: 1, resolution: '360p' });
});
it('refuses a tampered or transplanted original card during recovery', () => {
  registerDeclaredProvider({ card: card(), vendorKey: 'relay' });
  const state = readCatalog(); const model = state.models.find(m => m.vendorKey === 'relay')!;
  const meta = model.meta as Record<string, unknown>;
  delete meta.customCapabilityContract;
  (meta.declarationSource as { vendorKey: string }).vendorKey = 'other';
  expect(migrateDeclaredCapabilities(state, []).models.find(m => m.vendorKey === 'relay')?.meta).toMatchObject({ declarationCapabilityIssue: { missingFields: expect.arrayContaining(['originalSourceOwnership']) } });
});
it('rejects the complete card atomically before storing any model source', () => {
  const draft = card(); draft.models.push(structuredClone(draft.models[0]));
  draft.models[1].modelKey = 'invalid'; draft.models[1].parameters![0].default = 999;
  const before = readCatalog();
  expect(() => registerDeclaredProvider({ card: draft, vendorKey: 'relay' })).toThrow();
  expect(readCatalog()).toEqual(before);
});
it('forwards a binary result descriptor as part of the whole operation', () => {
  const draft = card(); const descriptor = { kind: 'binary', contentType: 'video/mp4' };
  draft.models[0].modes[0].result = { method: 'GET', path: '/content', mediaResponse: descriptor } as NonNullable<typeof draft.models[0]['modes'][number]['result']>;
  expect(projectDeclaredModel(draft.models[0], 'relay').mappings[0].result).toEqual({ method: 'GET', path: '/content', mediaResponse: descriptor });
});

it('preserves an already imported native workflow instead of requiring an HTTP adapter revision', () => {
  const state = readCatalog();
  state.models.push({ vendorKey: 'native', modelKey: 'opaque-workflow', labelZh: 'Opaque', kind: 'video', enabled: true, createdAt: '', updatedAt: '', meta: { parameters: [{ key: 'frame', label: 'Frame', type: 'image-url' }], comfyWorkflowImport: { text: '{}', binding: { images: [] } }, adapter: { activeRevision: 'native-revision' } } });
  expect(migrateDeclaredCapabilities(state, [])).toEqual(state);
});

it('refuses unknown wire-shaped keys instead of expanding a provider alias blacklist', () => {
  const draft = card(); draft.models[0].parameters![0].key = 'provider_seconds';
  draft.models[0].modes[0].create.body = { provider_seconds: '{{request.params.provider_seconds}}', resolution: '{{request.params.resolution}}' };
  expect(() => registerDeclaredProvider({ card: draft, vendorKey: 'relay' })).toThrow(/parameters\.provider_seconds: "provider_seconds" is not a Nomi parameter key/);
});
