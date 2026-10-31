/**
 * One ownership table, every cell, both writers, real catalog transaction.
 * The judge is facts only: is there an ownership record, does its digest match, did this run verify the route.
 * No cell names a vendor or a model family; `opaque` stands for any of them.
 */
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTempDir } from '../../scripts/_test-temp.mjs';
import { projectDeclaredModel, DeclaredRouteConflictError, type DeclaredRouteConflict } from '../providerAdapter/promotionMeta';
import { defaultCatalog } from '../providerAdapter/serviceCatalog';
import type { ProviderAdapterDraft, ProviderAdapterRun } from '../providerAdapter/types';
import { parseCustomCapabilityContract, type CustomCapabilityContractV1 } from '../shared/customCapabilityContract';
import { derivePublishedExecution } from '../shared/modelPublication';
import { mutateCatalog, readCatalog } from './catalogStore';
import { registerDeclaredProvider } from './declaredProviderRegistration';
import type { Mapping, ProfileKind } from './types';

let dir = '';
vi.mock('electron', () => ({ app: { getPath: () => dir, getAppPath: () => process.cwd() }, safeStorage: { isEncryptionAvailable: () => false } }));
beforeEach(() => { dir = makeTempDir('route-ownership-'); vi.stubEnv('NOMI_SETTINGS_DIR', dir); });
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); });

const BASE = 'http://127.0.0.1:9000';
const VENDOR = 'relay';
const MODEL = 'opaque';
const GENERATE: ProfileKind = 'text_to_image';
const EDIT: ProfileKind = 'image_edit';
const LEGACY = { method: 'POST' as const, path: '/legacy/route' };

function card(root = '/new', modelKey = MODEL): ProviderAdapterDraft {
  return {
    provider: { baseUrl: BASE, authType: 'none', providerKind: 'openai-compatible' },
    sources: [],
    models: [{ modelKey, labelZh: modelKey, kind: 'image', modes: [
      { taskKind: GENERATE, create: { method: 'POST', path: `${root}/generate`, body: { prompt: '{{request.prompt}}' } }, sourceUrls: [] },
      { taskKind: EDIT, create: { method: 'POST', path: `${root}/edit`, body: { prompt: '{{request.prompt}}', image: '{{request.params.image_url}}' } }, referenceParam: 'image_url', referenceShape: 'single', sourceUrls: [] },
    ] }],
  };
}
function textCard(modelKey = MODEL): ProviderAdapterDraft {
  return {
    provider: { baseUrl: BASE, authType: 'none', providerKind: 'openai-compatible' },
    sources: [],
    models: [{ modelKey, labelZh: modelKey, kind: 'text', modes: [{ taskKind: 'chat', create: { method: 'POST', path: '/v1/chat/completions', body: { messages: [{ role: 'user', content: '{{request.prompt}}' }] } }, sourceUrls: [] }] }],
  };
}

let runs = 0;
function certify(draft: ProviderAdapterDraft, verified: readonly ProfileKind[] = [GENERATE, EDIT, 'chat'], vendorKey = VENDOR) {
  const runId = `run-${(runs += 1)}`;
  const staged = defaultCatalog.stage({ vendorKey, catalogVendorKey: vendorKey, runId, vendorName: 'Relay', baseUrl: BASE, authType: 'none', apiKey: '', models: draft.models.map((m) => ({ modelKey: m.modelKey, kind: m.kind })) });
  // Existing rows are only in play on the stable key, which is where a re-saved connection certifies.
  expect(staged.vendor.key).toBe(vendorKey);
  const verifiedModes = draft.models.flatMap((m) => m.modes.filter((mode) => verified.includes(mode.taskKind)).map((mode) => ({ modelKey: m.modelKey, taskKind: mode.taskKind })));
  const run: ProviderAdapterRun = {
    id: runId, vendorKey, vendorName: 'Relay', connectionFingerprint: 'fixture', selectedModelKeys: draft.models.map((m) => m.modelKey), stage: 'completed', repairAttempt: 0,
    models: draft.models.map((m) => ({ modelKey: m.modelKey, labelZh: m.labelZh, kind: m.kind, modes: m.modes.map((mode) => verified.includes(mode.taskKind) ? { taskKind: mode.taskKind, state: 'verified' as const, attempts: 1 } : { taskKind: mode.taskKind, state: 'failed' as const, attempts: 1, stage: 'verify_asset' as const, error: 'probe failed' }) })),
    sourceUrls: [], createdAt: '', updatedAt: '',
  };
  const promote = () => defaultCatalog.promote({ run, draft, verifiedModes, revision: { id: `revision-${runId}`, vendorKey, digest: runId, draft, verifiedModes, createdAt: '' } });
  return { promote };
}

type WriterName = 'certification' | 'declaration';
const WRITERS: Record<WriterName, (draft: ProviderAdapterDraft) => void> = {
  certification: (draft) => { expect(certify(draft).promote().status).toBe('committed'); },
  declaration: (draft) => { registerDeclaredProvider({ card: draft, vendorKey: VENDOR }); },
};
const NAMES = Object.keys(WRITERS) as WriterName[];

function seed(rows: Array<Partial<Mapping>>, meta: Record<string, unknown> = {}, input: { vendorKey?: string; modelKey?: string; kind?: string } = {}) {
  const vendorKey = input.vendorKey ?? VENDOR;
  const modelKey = input.modelKey ?? MODEL;
  mutateCatalog((tx, state) => {
    if (!state.vendors.some((v) => v.key === vendorKey)) tx.upsertVendor({ key: vendorKey, name: vendorKey, enabled: false, baseUrlHint: BASE, authType: 'none', providerKind: 'openai-compatible' });
    tx.upsertModel({ vendorKey, modelKey, labelZh: modelKey, kind: input.kind ?? 'image', enabled: false, meta });
    for (const row of rows) tx.upsertMapping({ vendorKey, modelKey, name: 'existing', enabled: true, create: LEGACY, ...row });
  });
}
/** Saving a credential de-publishes the connection; the next certification lands on the stable key with its rows. */
function republishable(vendorKey = VENDOR) {
  mutateCatalog((tx, state) => { tx.upsertVendor({ ...state.vendors.find((v) => v.key === vendorKey), enabled: false }); });
}
function editRow(taskKind: ProfileKind, edit: Partial<Mapping>) {
  mutateCatalog((tx, state) => { tx.upsertMapping({ ...state.mappings.find((m) => m.vendorKey === VENDOR && m.modelKey === MODEL && m.taskKind === taskKind), ...edit }); });
}
const routes = (vendorKey = VENDOR, modelKey = MODEL) => readCatalog().mappings.filter((m) => m.vendorKey === vendorKey && m.modelKey === modelKey).sort((a, b) => a.taskKind.localeCompare(b.taskKind));
const route = (taskKind: ProfileKind) => routes().find((m) => m.taskKind === taskKind);
const wireOf = ({ createdAt: _c, updatedAt: _u, ...row }: Mapping) => row;
const modelMeta = (modelKey = MODEL) => readCatalog().models.find((m) => m.vendorKey === VENDOR && m.modelKey === modelKey)!.meta as Record<string, unknown>;
const digestsOf = (modelKey = MODEL) => (modelMeta(modelKey).declarationProjection as { wireDigests: Record<string, string> }).wireDigests;

function conflictsFrom(write: () => unknown): readonly DeclaredRouteConflict[] {
  try { write(); } catch (error) {
    expect(error).toBeInstanceOf(DeclaredRouteConflictError);
    return (error as DeclaredRouteConflictError).conflicts;
  }
  throw new Error('expected the replacement to be refused');
}
function expectReplaced() {
  expect(routes().map((r) => [r.taskKind, r.create.path])).toEqual([[EDIT, '/new/edit'], [GENERATE, '/new/generate']]);
  expect(Object.keys(digestsOf()).sort()).toEqual([EDIT, GENERATE].sort());
}
function expectRefused(writer: WriterName, conflict: Partial<DeclaredRouteConflict>, message: RegExp) {
  const before = readCatalog();
  const beforeRoutes = routes();
  let thrown: unknown;
  try { WRITERS[writer](card()); } catch (error) { thrown = error; }
  expect(thrown, 'the replacement must be refused').toBeInstanceOf(DeclaredRouteConflictError);
  expect((thrown as Error).message).toMatch(message);
  expect((thrown as DeclaredRouteConflictError).vendorKey).toBe(VENDOR);
  expect((thrown as DeclaredRouteConflictError).conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ modelKey: MODEL, ...conflict })]));
  expect(routes()).toEqual(beforeRoutes);
  // Declaration writes nothing at all. Certification only records that its own run failed.
  if (writer === 'declaration') expect(readCatalog()).toEqual(before);
}
const projectionRow = (taskKind: ProfileKind) => projectDeclaredModel(card().models[0], VENDOR).mappings.find((m) => m.taskKind === taskKind)!;

describe.each(NAMES)('%s write', (writer) => {
  const write = WRITERS[writer];

  it('a route with a modeId is refused and left alone', () => {
    seed([{ taskKind: GENERATE, modeId: 'user-mode' }]);
    expectRefused(writer, { taskKind: GENERATE, modeId: 'user-mode', reason: 'independent_mode' }, /mappings\.text_to_image.*unowned wire/);
  });

  it('a route whose wire equals the new one is replaced, the enabled switch does not count', () => {
    seed([{ ...projectionRow(GENERATE), enabled: false }, { ...projectionRow(EDIT), enabled: true }]);
    write(card());
    expectReplaced();
  });

  it('an owned route whose digest matches is replaced', () => {
    seed([]);
    write(card('/first'));
    republishable();
    write(card());
    expectReplaced();
  });

  it('an owned route switched off without touching its wire is still owned', () => {
    seed([]);
    write(card('/first'));
    republishable();
    editRow(GENERATE, { enabled: false });
    write(card());
    expectReplaced();
  });

  it('an owned route edited on its own is refused and left alone', () => {
    seed([]);
    write(card('/first'));
    republishable();
    editRow(GENERATE, { create: { method: 'POST', path: '/hand-edited' } });
    expectRefused(writer, { taskKind: GENERATE, reason: 'edited', current: { method: 'POST', path: '/hand-edited' }, declared: { method: 'POST', path: '/new/generate' } }, /mappings\.text_to_image.*independently edited/);
  });

  it('a route on another model of this connection is not judged and not touched', () => {
    seed([]);
    seed([{ taskKind: GENERATE }, { taskKind: EDIT, modeId: 'user-mode' }], {}, { modelKey: 'sibling' });
    const before = routes(VENDOR, 'sibling');
    write(card());
    expectReplaced();
    expect(routes(VENDOR, 'sibling')).toEqual(before);
  });

  it('the same model on another connection is not judged and not touched', () => {
    seed([]);
    seed([{ taskKind: GENERATE }, { taskKind: EDIT, modeId: 'user-mode' }], {}, { vendorKey: 'other-connection' });
    const before = routes('other-connection');
    write(card());
    expectReplaced();
    expect(routes('other-connection')).toEqual(before);
  });

  it('a connection-level route with no model is not judged and not touched', () => {
    seed([]);
    mutateCatalog((tx) => { tx.upsertMapping({ vendorKey: VENDOR, taskKind: GENERATE, name: 'generic', enabled: true, create: LEGACY }); });
    const before = readCatalog().mappings.filter((m) => m.vendorKey === VENDOR && !m.modelKey);
    expect(before).toHaveLength(1);
    write(card());
    expectReplaced();
    expect(readCatalog().mappings.filter((m) => m.vendorKey === VENDOR && !m.modelKey)).toEqual(before);
  });

  it('a hand-authored capability is refused and left alone', () => {
    const contract = structuredClone(projectDeclaredModel(card().models[0], VENDOR).contract!) as CustomCapabilityContractV1;
    contract.modes[0].hint = 'written by hand';
    seed([], { customCapabilityContract: contract });
    const before = parseCustomCapabilityContract(modelMeta());
    expectRefused(writer, { reason: 'capability_authored' }, /customCapabilityContract: user-authored/);
    expect(parseCustomCapabilityContract(modelMeta())).toEqual(before);
  });

  it('a hand-authored capability equal to the new one is replaced', () => {
    seed([], { customCapabilityContract: projectDeclaredModel(card().models[0], VENDOR).contract });
    write(card());
    expectReplaced();
  });

  it('an owned capability edited on its own is refused and left alone', () => {
    seed([]);
    write(card('/first'));
    republishable();
    mutateCatalog((tx, state) => {
      const model = state.models.find((m) => m.modelKey === MODEL)!;
      const meta = structuredClone(model.meta) as { customCapabilityContract: CustomCapabilityContractV1 };
      meta.customCapabilityContract.modes[0].hint = 'edited by hand';
      tx.upsertModel({ ...model, meta });
    });
    expectRefused(writer, { reason: 'capability_edited' }, /customCapabilityContract: independently edited/);
  });

  it('a text model has no media route to judge: its rows stay exactly as they are', () => {
    seed([{ taskKind: GENERATE }, { taskKind: EDIT, modeId: 'user-mode' }], {}, { kind: 'text' });
    const before = routes().map(wireOf);
    write(textCard());
    expect(routes().map(wireOf)).toEqual(before);
    expect(readCatalog().models.find((m) => m.modelKey === MODEL)!.kind).toBe('text');
  });

  it('one refusal lists every conflict of every model at once and writes neither', () => {
    seed([{ taskKind: GENERATE }, { taskKind: EDIT, modeId: 'user-mode' }]);
    seed([{ taskKind: GENERATE, modeId: 'user-mode' }], {}, { modelKey: 'second' });
    const draft = { ...card(), models: [...card().models, ...card('/second', 'second').models, ...card('/third', 'third').models] };
    seed([], {}, { modelKey: 'third' });
    const before = [routes(), routes(VENDOR, 'second'), routes(VENDOR, 'third')];
    const conflicts = conflictsFrom(() => WRITERS[writer](draft));
    const judged = conflicts.map((c) => `${c.modelKey}:${c.taskKind}:${c.reason}`);
    // Certification may replace the verified unowned route, so only modeId rows are common to both writers.
    expect(judged).toEqual(expect.arrayContaining([`${MODEL}:${EDIT}:independent_mode`, `second:${GENERATE}:independent_mode`]));
    if (writer === 'declaration') expect(judged).toContain(`${MODEL}:${GENERATE}:unowned`);
    expect(judged.some((entry) => entry.startsWith('third:'))).toBe(false);
    expect([routes(), routes(VENDOR, 'second'), routes(VENDOR, 'third')]).toEqual(before);
  });
});

describe('a route with no ownership record', () => {
  it('declaration resubmission refuses it: a card is not evidence the route works', () => {
    seed([{ taskKind: GENERATE, create: { method: 'POST', path: '/legacy/generate' } }]);
    expectRefused('declaration', { taskKind: GENERATE, reason: 'unowned', current: { method: 'POST', path: '/legacy/generate' }, declared: { method: 'POST', path: '/new/generate' } }, /mappings\.text_to_image.*unowned wire/);
  });

  it('certification replaces what this run verified', () => {
    seed([{ taskKind: GENERATE, create: { method: 'POST', path: '/legacy/generate' } }, { taskKind: EDIT, create: { method: 'POST', path: '/legacy/edit' } }]);
    WRITERS.certification(card());
    expectReplaced();
    expect(routes().every((r) => r.enabled)).toBe(true);
  });

  it('certification keeps what this run did not verify: no ownership claimed, not published, wire and switch unchanged', () => {
    seed([{ taskKind: GENERATE, create: { method: 'POST', path: '/legacy/generate' } }, { taskKind: EDIT, create: { method: 'POST', path: '/legacy/edit' } }]);
    const keptBefore = wireOf(route(EDIT)!);
    expect(certify(card(), [GENERATE]).promote().status).toBe('committed');
    expect(route(GENERATE)).toMatchObject({ enabled: true, create: { path: '/new/generate' } });
    expect(wireOf(route(EDIT)!)).toEqual(keptBefore);
    expect(Object.keys(digestsOf())).toEqual([GENERATE]);
    const state = readCatalog();
    const model = state.models.find((m) => m.modelKey === MODEL)!;
    expect(derivePublishedExecution(model, { mappings: state.mappings }).publishedModes).toEqual([GENERATE]);
    expect(parseCustomCapabilityContract(model.meta)!.modes.map((m) => m.transportTaskKind)).toEqual([GENERATE]);
  });

  it('a kept route is replaced by the first later run that verifies it', () => {
    seed([{ taskKind: EDIT, create: { method: 'POST', path: '/legacy/edit' } }]);
    expect(certify(card(), [GENERATE]).promote().status).toBe('committed');
    expect(route(EDIT)?.create.path).toBe('/legacy/edit');
    republishable();
    expect(certify(card()).promote().status).toBe('committed');
    expectReplaced();
  });

  it('a kept route is still refused by a later declaration: certification did not adopt it', () => {
    seed([{ taskKind: EDIT, create: { method: 'POST', path: '/legacy/edit' } }]);
    expect(certify(card('/first'), [GENERATE]).promote().status).toBe('committed');
    republishable();
    expectRefused('declaration', { taskKind: EDIT, reason: 'unowned' }, /mappings\.image_edit.*unowned wire/);
  });

  it('certification with no verified mode for a model judges nothing on it', () => {
    seed([{ taskKind: GENERATE }]);
    seed([{ taskKind: GENERATE, modeId: 'user-mode' }], {}, { modelKey: 'unverified-model' });
    const before = routes(VENDOR, 'unverified-model').map(wireOf);
    const draft = { ...card(), models: [...card().models, ...card('/second', 'unverified-model').models] };
    const runId = `run-${(runs += 1)}`;
    defaultCatalog.stage({ vendorKey: VENDOR, catalogVendorKey: VENDOR, runId, vendorName: 'Relay', baseUrl: BASE, authType: 'none', apiKey: '', models: draft.models.map((m) => ({ modelKey: m.modelKey, kind: m.kind })) });
    const verifiedModes = card().models[0].modes.map((mode) => ({ modelKey: MODEL, taskKind: mode.taskKind }));
    const run: ProviderAdapterRun = { id: runId, vendorKey: VENDOR, vendorName: 'Relay', connectionFingerprint: 'fixture', selectedModelKeys: draft.models.map((m) => m.modelKey), stage: 'partial', repairAttempt: 0, models: [
      { modelKey: MODEL, labelZh: MODEL, kind: 'image', modes: verifiedModes.map((mode) => ({ taskKind: mode.taskKind, state: 'verified' as const, attempts: 1 })) },
      { modelKey: 'unverified-model', labelZh: 'unverified-model', kind: 'image', modes: [{ taskKind: GENERATE, state: 'failed' as const, attempts: 1, stage: 'verify_asset' as const, error: 'probe failed' }] },
    ], sourceUrls: [], createdAt: '', updatedAt: '' };
    expect(defaultCatalog.promote({ run, draft, verifiedModes, revision: { id: `revision-${runId}`, vendorKey: VENDOR, digest: runId, draft, verifiedModes, createdAt: '' } }).status).toBe('committed');
    expect(routes(VENDOR, 'unverified-model').map(wireOf)).toEqual(before);
  });
});

describe('a refused certification gives up its lease', () => {
  it('replaying the same promotion is no-lease, so the recovery journal can move on', () => {
    seed([{ taskKind: GENERATE, modeId: 'user-mode' }]);
    const { promote } = certify(card());
    expect(() => promote()).toThrow(DeclaredRouteConflictError);
    expect(promote()).toEqual({ status: 'no-lease' });
    expect(route(GENERATE)).toMatchObject({ modeId: 'user-mode', create: LEGACY });
  });

  it('a later run on the same model holds a new lease and is judged on its own', () => {
    seed([{ taskKind: GENERATE, modeId: 'user-mode' }]);
    expect(() => certify(card()).promote()).toThrow(DeclaredRouteConflictError);
    mutateCatalog((tx) => { tx.deleteModelMappings(VENDOR, MODEL); });
    expect(certify(card()).promote().status).toBe('committed');
    expectReplaced();
  });
});
