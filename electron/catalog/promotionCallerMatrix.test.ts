import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTempDir } from '../../scripts/_test-temp.mjs';
import { doorsForTargets } from '../../scripts/door-map.mjs';
import callers from './__fixtures__/promotionCallers.json';
import { relayDeclaration } from '../../tests/ux/_relayVideoFixture.mjs';
import type { ProviderAdapterDraft, ProviderAdapterRun } from '../providerAdapter/types';
import type { WorkflowBinding } from './comfyuiWorkflowImport';

import { readCatalog } from './catalogStore';
import { parseCustomCapabilityContract } from '../shared/customCapabilityContract';
import { consumedCanonicalKeys, wireReferencedParamKeys } from './paramTranslate';
import { analyzeComfyWorkflowText, importComfyWorkflowToCatalog, updateComfyWorkflowInCatalog } from './comfyuiWorkflowImportStore';
import { resolveComfyStagedCandidate, promoteCertifiedComfyCandidate, materializeCertifiedComfyAssets } from './comfyuiCandidateLifecycle';
import { registerDeclaredProvider } from './declaredProviderRegistration';
import { defaultCatalog } from '../providerAdapter/serviceCatalog';

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
it('the caller inventory equals the shared promotion property census and its wrapper hops', () => {
  const actual = doorsForTargets(['promote']);
  expect(actual.map((d: { path: string }) => d.path).sort()).toEqual(callers.filter(c => c.symbol === 'promote').map(c => c.path).sort());
  for (const caller of callers) expect(fs.readFileSync(path.resolve(caller.path), 'utf8')).toContain(caller.symbol);
  expect(doorsForTargets(['promoteCertifiedComfyCandidate']).map((d: { path: string }) => d.path).sort()).toEqual(['electron/catalog/comfyuiCandidateLifecycle.ts', 'electron/integrationCertification/integrationSession.ts']);
});
describe.each(callers)('$id capability input lifecycle matrix', (caller) => {
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
