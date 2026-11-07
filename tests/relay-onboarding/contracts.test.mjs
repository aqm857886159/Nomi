import { Buffer } from 'node:buffer'
// Executable known gaps. it.fails asserts the intended invariant; remove .fails only after repair.
// Fixtures own only the upstream HTTP response. Catalog, declaration, discovery and runtime are real.
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { startRelayVideoFixture, relayDeclaration, FAKE_RELAY_KEY } from '../ux/_relayVideoFixture.mjs'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { parseModelListPage } from '../../electron/ai/onboarding/modelListResponse.ts'
import { guessModelKind } from '../../electron/catalog/modelKindHeuristic.ts'
import { runModelDiscovery } from '../../src/ui/onboarding/modelDiscovery.ts'
import { buildOpenAiCompatibleDraft } from '../../electron/providerAdapter/builtinOpenAiCompatibleDraft.ts'
import { validateProviderAdapterDraft } from '../../electron/providerAdapter/validator.ts'
import { readCatalog, upsertModelCatalogVendorApiKey } from '../../electron/catalog/catalogStore.ts'
import { submitDeclaration } from '../../electron/capabilityCore/modelOnboarding/submitDeclaration.ts'
import { resolveArchetypeForModel } from '../../electron/shared/modelArchetypes/index.ts'
import { agentModelEntriesFromCatalog } from '../../electron/catalog/agentModelEntriesFromCatalog.ts'
import { createProject, executeProfileOperation, buildProfileTaskResult, runTask, fetchTaskResult } from '../../electron/runtime.ts'
import { tryModel } from '../../electron/capabilityCore/modelOnboarding/tryModel.ts'
import { upsertRendererCatalogVendorApiKey } from '../../electron/catalog/rendererCatalogMutation.ts'
import { catalogModelAvailability } from '../../electron/catalog/catalogModelAvailability.ts'
import { defaultCatalog } from '../../electron/providerAdapter/serviceCatalog.ts'

vi.mock('electron', async (original) => ({ ...await original(), safeStorage: {
  isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`test:${s}`), decryptString: (s) => s.toString().replace(/^test:/, ''),
} }))

let root
let relay
beforeEach(() => {
  root = makeTempDir('relay-onboarding-')
  vi.stubEnv('NOMI_SETTINGS_DIR', path.join(root, 'settings'))
  vi.stubEnv('NOMI_PROJECTS_DIR', path.join(root, 'projects'))
})
afterEach(async () => { await relay?.close(); relay = undefined; fs.rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs() })
const model = (id = 'opaque-gamma') => ({ vendorKey: 'loopback-relay', modelKey: id, labelZh: id, kind: 'video', enabled: true, meta: {} })
const vendor = () => ({ key: 'loopback-relay', name: 'Loopback', baseUrlHint: relay.baseUrl, authType: 'bearer', enabled: true, meta: {} })
const request = { kind: 'text_to_video', prompt: 'A blue marble rolls slowly', duration: 1, resolution: '360p', size: '16:9', extras: {} }
async function register(options = {}) {
  relay = await startRelayVideoFixture(options)
  const card = relayDeclaration(relay.baseUrl, options)
  const reply = await submitDeclaration({ name: 'Loopback', declaration: JSON.stringify(card) })
  expect(reply.ok, JSON.stringify(reply)).toBe(true)
  const row = readCatalog().models.find((m) => m.modelKey === (options.id ?? 'opaque-gamma'))
  expect(row?.kind).toBe('video')
  return { card, row, reply }
}

describe('relay onboarding reproducible gaps', () => {
  it.fails('discovery preserves explicit video output evidence through the picker', async () => {
    relay = await startRelayVideoFixture({ descriptors: true })
    const page = parseModelListPage(await (await globalThis.fetch(`${relay.baseUrl}/v1/models`, { headers: { Authorization: `Bearer ${FAKE_RELAY_KEY}` } })).text())
    expect(page.ok).toBe(true)
    expect(page.descriptors[0].architecture.outputModalities).toEqual(['video'])
    const next = await runModelDiscovery({ load: async () => page, guessKinds: async ({ ids }) => ({ kinds: Object.fromEntries(ids.map((id) => [id, guessModelKind(id)])) }), existing: [], previous: [], isCurrent: () => true })
    expect(next.candidates.map((m) => m.kind)).toEqual(['video', 'video', 'video'])
  })

  it.fails('a documented video model with only identity never silently becomes a chat model', async () => {
    const next = await runModelDiscovery({ load: async () => ({ ok: true, models: ['opaque-gamma'] }), existing: [], previous: [], isCurrent: () => true })
    expect(next.candidates[0].kind).not.toBe('text')
  })

  it('an OpenAI-compatible video draft can use the standard videos contract', async () => {
    relay = await startRelayVideoFixture({ shape: 'content' })
    // Proposed connection capability in the design draft; no brand/name selects this protocol.
    const draft = buildOpenAiCompatibleDraft({ baseUrl: relay.baseUrl, authType: 'bearer', mediaProtocols: ['openai-videos-v1'], models: [model()] })
    const mode = draft.models[0].modes.find((m) => m.taskKind === 'text_to_video')
    // Generic protocol support, not a provider-name exception. Existing explicit legacy mappings stay valid.
    expect(mode.create.path).toBe('/v1/videos')
  })

  it('a valid declaration retains parameters in the catalog capability contract', async () => {
    const { row } = await register()
    const archetype = resolveArchetypeForModel(row)
    expect(archetype?.modes[0].params.map((p) => p.key)).toEqual(expect.arrayContaining(['duration', 'resolution']))
  })

  it('a frame-only declaration retains its required reference slot', async () => {
    const { row } = await register({ id: 'opaque-beta', frameOnly: true })
    const mapping = readCatalog().mappings.find((m) => m.modelKey === row.modelKey)
    expect(mapping.taskKind).toBe('image_to_video')
    expect(resolveArchetypeForModel(row)?.modes[0].slots).toEqual(expect.arrayContaining([expect.objectContaining({ min: 1 })]))
  })

  it('replacing a declaration removes an obsolete mode previously owned by that declaration', async () => {
    const { row, card } = await register()
    const twoModes = globalThis.structuredClone(card)
    twoModes.models[0].modes.push(relayDeclaration(relay.baseUrl, { frameOnly: true }).models[0].modes[0])
    const expanded = await submitDeclaration({ vendorKey: row.vendorKey, declaration: JSON.stringify(twoModes) })
    expect(expanded.ok, JSON.stringify(expanded)).toBe(true)
    expect(readCatalog().mappings.filter((m) => m.vendorKey === row.vendorKey && m.modelKey === row.modelKey && m.enabled)).toHaveLength(2)
    const replaced = await submitDeclaration({ vendorKey: row.vendorKey, declaration: JSON.stringify(card) })
    expect(replaced.ok, JSON.stringify(replaced)).toBe(true)
    expect(readCatalog().mappings.filter((m) => m.vendorKey === row.vendorKey && m.modelKey === row.modelKey && m.enabled).map((m) => m.taskKind)).toEqual(['text_to_video'])
  })

  it('model specifications never advertise chat for a declared media model', async () => {
    const { row } = await register()
    const entry = agentModelEntriesFromCatalog(readCatalog()).find((e) => e.entry.modelId === row.modelKey)?.entry
    expect(entry.kind).toBe('video')
    expect(entry.modes.map((m) => m.modeId)).not.toContain('chat')
  })

  it('a frame-only declaration refuses missing image before any provider POST', async () => {
    const { row } = await register({ frameOnly: true })
    upsertModelCatalogVendorApiKey(row.vendorKey, { apiKey: FAKE_RELAY_KEY, enabled: true })
    await expect(runTask({ vendor: row.vendorKey, request: { kind: 'image_to_video', prompt: request.prompt, extras: { modelKey: row.modelKey } } })).rejects.toThrow(/参考|图片|reference|image/i)
    expect(relay.hits.filter((h) => h.method === 'POST')).toHaveLength(0)
  })

  it('control: a disabled credential produces an honest declaration next action', async () => {
    const { row, card } = await register()
    // The visible custom-connection page deliberately stages the credential disabled until promotion.
    // Calling the real renderer boundary, rather than the privileged key writer, is essential.
    await upsertRendererCatalogVendorApiKey(row.vendorKey, { apiKey: FAKE_RELAY_KEY, enabled: true })
    const reply = await submitDeclaration({ vendorKey: row.vendorKey, declaration: JSON.stringify(card) })
    expect(reply.ok, JSON.stringify(reply)).toBe(true)
    expect(reply.state.selfCheck.credential).toMatchObject({ checked: false })
    const state = readCatalog()
    const saved = state.models.find((m) => m.vendorKey === row.vendorKey && m.modelKey === row.modelKey)
    const usable = catalogModelAvailability(state, saved).usable
    const promisedPicker = /in Nomi's model pickers/.test(reply.nextAction.userSees)
    expect(usable || !promisedPicker, 'the tool claim and the shared availability gate must agree').toBe(true)
  })

  it('control: connection-only wizard registration then declaration has the same availability facts', async () => {
    relay = await startRelayVideoFixture()
    const configured = defaultCatalog.register({ vendorKey: 'loopback-relay', vendorName: 'Loopback', baseUrl: relay.baseUrl,
      authType: 'bearer', providerKind: 'openai-compatible', apiKey: FAKE_RELAY_KEY, models: [], savedAt: new Date().toISOString() })
    const reply = await submitDeclaration({ vendorKey: configured.vendor.key, declaration: JSON.stringify(relayDeclaration(relay.baseUrl)) })
    expect(reply.ok, JSON.stringify(reply)).toBe(true)
    expect(reply.state.selfCheck.credential).toMatchObject({ checked: true, ok: true })
    const state = readCatalog()
    const row = state.models.find((m) => m.vendorKey === configured.vendor.key && m.modelKey === 'opaque-gamma')
    expect(catalogModelAvailability(state, row)).toEqual({ usable: true })
  })

  it('a video declaration can express an authenticated binary result', async () => {
    relay = await startRelayVideoFixture({ shape: 'content' })
    const card = relayDeclaration(relay.baseUrl, { shape: 'legacy-url' })
    // Proposed shared output shape in the design draft. Do not coerce video into audioResponse.
    card.models[0].modes[0].result = { method: 'GET', path: '/v1/videos/{{providerMeta.task_id}}/content', mediaResponse: { kind: 'binary', contentType: 'video/mp4' } }
    expect(() => validateProviderAdapterDraft(card, { providerBaseUrl: relay.baseUrl, selectedModelKeys: ['opaque-gamma'] })).not.toThrow()
  })

  it('text-to-video can declare a multipart request with text fields and no reference file', async () => {
    relay = await startRelayVideoFixture({ shape: 'legacy-url' })
    const card = relayDeclaration(relay.baseUrl, { shape: 'legacy-url' })
    const create = card.models[0].modes[0].create
    delete create.body
    create.path = '/v1/videos'
    create.multipart = { fields: { model: '{{model.modelKey}}', prompt: '{{request.prompt}}', seconds: '4', size: '1280x720' } }
    expect(() => validateProviderAdapterDraft(card, { providerBaseUrl: relay.baseUrl, selectedModelKeys: ['opaque-gamma'] })).not.toThrow()
  })

  it('the real result executor materializes content bytes as a video artifact', async () => {
    const project = createProject({ name: 'Content contract', rootPath: path.join(root, 'content-project') })
    const request = { kind: 'text_to_video', prompt: 'A blue marble rolls slowly', extras: { projectId: project.id } }
    relay = await startRelayVideoFixture({ shape: 'content' })
    const headers = { Authorization: `Bearer ${FAKE_RELAY_KEY}` }
    const body = new globalThis.FormData()
    body.set('model', 'opaque-gamma'); body.set('prompt', request.prompt); body.set('seconds', '4'); body.set('size', '1280x720')
    const accepted = await (await globalThis.fetch(`${relay.baseUrl}/v1/videos`, { method: 'POST', headers, body })).json()
    const mode = relayDeclaration(relay.baseUrl, { shape: 'content' }).models[0].modes[0]
    const queried = await executeProfileOperation({ vendor: vendor(), model: model(), apiKey: FAKE_RELAY_KEY, request, operation: mode.query, providerMeta: { task_id: accepted.id }, stage: 'query' })
    const completed = await buildProfileTaskResult({ response: queried.response, mapping: mode, operation: mode.query, request, taskIdFallback: accepted.id, wantedKind: 'video' })
    expect(completed.result.status).toBe('succeeded')
    const operation = mode.result
    const result = await executeProfileOperation({ vendor: vendor(), model: model(), apiKey: FAKE_RELAY_KEY, request, operation, providerMeta: { task_id: accepted.id }, stage: 'result' })
    expect(relay.hits.at(-1).authorized).toBe(true)
    const built = await buildProfileTaskResult({ response: result.response, mapping: { statusMapping: { succeeded: ['completed'] } }, operation, request, taskIdFallback: accepted.id, wantedKind: 'video' })
    expect(built.result.assets).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'video' })]))
  })

  it.each(['plural-url', 'legacy-url'])('control: explicit %s declaration executes create, query and returns the documented result', async (shape) => {
    relay = await startRelayVideoFixture({ shape })
    const mode = relayDeclaration(relay.baseUrl, { shape }).models[0].modes[0]
    const submitted = await executeProfileOperation({ vendor: vendor(), model: model(), apiKey: FAKE_RELAY_KEY, request, operation: mode.create, stage: 'create' })
    const created = await buildProfileTaskResult({ response: submitted.response, mapping: mode, operation: mode.create, request, taskIdFallback: 'local', wantedKind: 'video' })
    expect(created.providerMeta.task_id).toBe('task-1')
    const queried = await executeProfileOperation({ vendor: vendor(), model: model(), apiKey: FAKE_RELAY_KEY, request, operation: mode.query, providerMeta: created.providerMeta, stage: 'query' })
    const finished = await buildProfileTaskResult({ response: queried.response, mapping: mode, operation: mode.query, request, taskIdFallback: 'task-1', wantedKind: 'video' })
    expect(finished.result.status).toBe('succeeded')
    expect(finished.result.assets).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'video', url: `${relay.baseUrl}/asset.mp4` })]))
    expect(relay.tasks.size).toBe(1)
  })

  it('a document-reading agent submits a declaration then calls the real try_model handler against loopback', async () => {
    const { row, card } = await register()
    const mode = card.models[0].modes[0]
    // No live key. This is the same credential write gate, scoped to this test directory.
    upsertModelCatalogVendorApiKey(row.vendorKey, { apiKey: FAKE_RELAY_KEY, enabled: true })
    const tried = await tryModel({ runTask, fetchTaskResult, pollIntervalMs: 1, approvalPolicy: () => ({ mode: 'direct' }) }, { vendorKey: row.vendorKey, modelKey: row.modelKey, taskKind: mode.taskKind, prompt: request.prompt })
    expect(tried.ok, JSON.stringify(tried)).toBe(true)
    expect(relay.tasks.size).toBe(1)
    const posts = relay.hits.filter((h) => h.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(Number(posts[0].body.duration)).toBe(1)
    expect(posts[0].body.resolution).toBe('360p')
  })
})
