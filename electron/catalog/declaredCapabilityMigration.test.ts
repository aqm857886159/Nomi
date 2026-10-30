import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../scripts/_test-temp.mjs';
import { readProviderAdapterRevisions } from '../providerAdapter/store';
import { agentModelEntriesFromCatalog } from './agentModelEntriesFromCatalog';
import { runTask } from '../runtime';
import { findExecutableModel } from './executableModel';
import { readCatalog, ensureBuiltinModelSeeds } from './catalogStore';
import { describe, expect, it, vi } from 'vitest';
import { migrateCatalogForward } from './catalogMigrations';
import { relayDeclaration } from '../../tests/ux/_relayVideoFixture.mjs';
import { parseCustomCapabilityContract } from '../shared/customCapabilityContract';
import { deriveModelAvailability } from '../shared/modelAvailability';
import type { CatalogState } from './types';
import type { ProviderAdapterRevision, ProviderAdapterDraft } from '../providerAdapter/types';

const candidate = (relayDeclaration('http://127.0.0.1:9000') as ProviderAdapterDraft).models[0];
function legacy(): CatalogState {
  return { version: 13, vendors: [], apiKeysByVendor: {}, models: [{ vendorKey: 'relay', modelKey: candidate.modelKey, labelZh: 'Opaque', kind: 'video', enabled: true, createdAt: '', updatedAt: '', meta: { adapter: { activeRevision: 'original', modes: [{ taskKind: 'text_to_video', state: 'verified' }] } } }], mappings: [{ id: 'old-wire', vendorKey: 'relay', modelKey: candidate.modelKey, name: 'Original', enabled: true, ...structuredClone(candidate.modes[0]), createdAt: '', updatedAt: '' }] };
}
const revision: ProviderAdapterRevision = { id: 'original', vendorKey: 'relay', digest: 'original', draft: relayDeclaration('http://127.0.0.1:9000') as ProviderAdapterDraft, verifiedModes: [{ modelKey: candidate.modelKey, taskKind: 'text_to_video' }], createdAt: '' };
function migrate(state: CatalogState, revisions: ProviderAdapterRevision[]) {
  return migrateCatalogForward(state, () => { throw new Error('not empty'); }, (s) => s, () => revisions);
}
describe('legacy declaration capability migration matrix', () => {
  it('recovers missing capability only from the original revision without HTTP or verification', () => {
    const state = migrate(legacy(), [revision]);
    expect(state.version).toBe(14);
    expect(parseCustomCapabilityContract(state.models[0].meta)?.modes[0].params.map((p) => p.key)).toEqual(['duration', 'resolution']);
    expect(migrate(state, [revision])).toEqual(state);
    expect(state.mappings[0].id).toBe('old-wire');
  });
  it.each(['missing', 'wrong-vendor', 'wrong-model', 'changed-wire', 'edited-controls'] as const)('preserves and blocks incomplete old data: %s', (shape) => {
    const before = legacy();
    let revisions = [structuredClone(revision)];
    if (shape === 'missing') revisions = [];
    if (shape === 'wrong-vendor') revisions[0].vendorKey = 'other';
    if (shape === 'wrong-model') revisions[0].draft.models[0].modelKey = 'other';
    if (shape === 'changed-wire') before.mappings[0].create.path = '/independently-edited';
    if (shape === 'edited-controls') before.models[0].meta = { ...before.models[0].meta as Record<string, unknown>, parameters: [{ key: 'duration', label: 'User duration', type: 'number', default: 8 }] };
    const state = migrate(before, revisions);
    const availability = deriveModelAvailability({ model: state.models[0], vendor: { enabled: true, authType: 'none' }, credentialStatus: () => 'ok', evidence: { mappings: state.mappings } });
    expect(availability).toMatchObject({ usable: false, reason: 'capability_incomplete', missingFields: expect.arrayContaining(['customCapabilityContract']) });
    expect(state.mappings).toEqual(before.mappings);
    expect(migrate(state, revisions)).toEqual(state);
  });
  it.each([['null', null], ['models', { ...revision, draft: { models: {} } }], ['verifiedModes', { ...revision, verifiedModes: {} }]])('marks malformed revision records incomplete instead of failing catalog load: %s', (_shape, broken) => {
    const before = legacy();
    const state = migrate(before, [broken] as unknown as ProviderAdapterRevision[]);
    expect(state.version).toBe(14);
    expect(deriveModelAvailability({ model: state.models[0], vendor: { enabled: true, authType: 'none' }, credentialStatus: () => 'ok' })).toMatchObject({ usable: false, reason: 'capability_incomplete' });
    expect(state.mappings).toEqual(before.mappings);
  });
  it.each(['delivery', 'abandon', 'inactive-wire', 'mode-variant'] as const)('preserves independently edited legacy wire fields: %s', (field) => {
    const before = legacy();
    const source = structuredClone(revision);
    if (field === 'delivery') before.mappings[0].delivery = 'synchronous';
    if (field === 'abandon') before.mappings[0].abandon = { via: 'poll-to-completion' };
    if (field === 'mode-variant') before.mappings.push({ ...before.mappings[0], id: 'user-variant', modeId: 'user-choice', create: { method: 'POST', path: '/user-choice' } });
    if (field === 'inactive-wire') {
      const extra = (relayDeclaration(source.draft.provider.baseUrl, { frameOnly: true }) as ProviderAdapterDraft).models[0].modes[0];
      source.draft.models[0].modes.push(extra);
      before.mappings.push({ ...before.mappings[0], ...extra, id: 'unverified-user-wire', enabled: false, create: { ...extra.create, path: '/user-edited' } });
    }
    const state = migrate(before, [source]);
    expect(state.mappings).toEqual(before.mappings);
    expect(deriveModelAvailability({ model: state.models[0], vendor: { enabled: true, authType: 'none' }, credentialStatus: () => 'ok' })).toMatchObject({ usable: false, reason: 'capability_incomplete' });
  });
  it('exposes incomplete declarations to Agent with missing fields and no invented chat or built-in modes', () => {
    const state = migrate(legacy(), []);
    state.models[0].modelKey = 'veo3.1-fast';
    const row = agentModelEntriesFromCatalog(state).find((r) => r.entry.modelId === 'veo3.1-fast');
    expect(row?.availability).toMatchObject({ usable: false, statusReason: expect.stringContaining('重新读文档交卡') });
    expect(row?.entry.modes).toEqual([]);
    expect(row?.availability.statusReason).toContain('customCapabilityContract');
  });
  it('supplies original revisions without a store lease or file write', () => {
    const root = makeTempDir('original-revision-');
    try {
      const file = path.join(root, 'provider-adapters.json');
      const bytes = JSON.stringify({ version: 1, revisions: [revision], runs: [], inputs: [] });
      fs.writeFileSync(file, bytes);
      expect(readProviderAdapterRevisions(root)).toEqual([revision]);
      expect(fs.readFileSync(file, 'utf8')).toBe(bytes);
      expect(fs.readdirSync(root)).toEqual(['provider-adapters.json']);
      fs.writeFileSync(file, '{corrupt');
      expect(readProviderAdapterRevisions(root)).toEqual([]);
      expect(fs.readFileSync(file, 'utf8')).toBe('{corrupt');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('boot seed entry also supplies original revisions before ordinary catalog reads', () => {
    const root = makeTempDir('legacy-boot-projection-');
    vi.stubEnv('NOMI_SETTINGS_DIR', root);
    try {
      fs.writeFileSync(path.join(root, 'model-catalog.json'), JSON.stringify(legacy()));
      fs.writeFileSync(path.join(root, 'provider-adapters.json'), JSON.stringify({ version: 1, revisions: [revision], runs: [], inputs: [] }));
      ensureBuiltinModelSeeds();
      const model = readCatalog().models.find((m) => m.vendorKey === 'relay' && m.modelKey === candidate.modelKey)!;
      expect(parseCustomCapabilityContract(model.meta)?.modes[0].params.map((p) => p.key)).toEqual(['duration', 'resolution']);
      expect((model.meta as Record<string, unknown>).declarationCapabilityIssue).toBeUndefined();
    } finally { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('creation rejects missing capability with field reasons while original queries can resolve the model', async () => {
    const root = makeTempDir('incomplete-dispatch-');
    vi.stubEnv('NOMI_SETTINGS_DIR', root);
    try {
      const state = legacy();
      state.vendors = [{ key: 'relay', name: 'Relay', enabled: true, authType: 'none', baseUrlHint: 'http://127.0.0.1:9000', createdAt: '', updatedAt: '' }];
      fs.writeFileSync(path.join(root, 'model-catalog.json'), JSON.stringify(state));
      expect(() => findExecutableModel('relay', candidate.modelKey, 'video')).not.toThrow();
      await expect(runTask({ vendor: 'relay', request: { kind: 'text_to_video', prompt: 'A blue marble', extras: { modelKey: candidate.modelKey } } })).rejects.toThrow(/customCapabilityContract/);
    } finally { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('does not rewrite complete user-authored contracts', () => {
    const state = migrate(legacy(), [revision]);
    expect(parseCustomCapabilityContract(state.models[0].meta)).not.toBeNull();
    const current = structuredClone(state);
    current.version = 13;
    const before = structuredClone(current.models);
    expect(migrate(current, []).models).toEqual(before);
  });
});
