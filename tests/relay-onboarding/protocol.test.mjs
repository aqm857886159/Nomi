// CI default Vitest lane: production declaration -> runtime -> loopback HTTP -> verified asset store.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { stationTimeout } from '../ux/_station-budget.mjs'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { relayDeclaration, startRelayVideoFixture, FAKE_RELAY_KEY } from '../ux/_relayVideoFixture.mjs'
import { submitDeclaration } from '../../electron/capabilityCore/modelOnboarding/submitDeclaration.ts'
import { readCatalog, upsertModelCatalogVendorApiKey } from '../../electron/catalog/catalogStore.ts'
import { createProject, runTask, fetchTaskResult, taskCache, executeProfileOperation } from '../../electron/runtime.ts'
import { readNomiLocalAsset } from '../../electron/assets/localAssetFile.ts'
import { listProjectAssets } from '../../electron/assets/projectAssetStore.ts'
import { buildOpenAiCompatibleDraft } from '../../electron/providerAdapter/builtinOpenAiCompatibleDraft.ts'
import { validateProviderAdapterDraft } from '../../electron/providerAdapter/validator.ts'
import { streamProfileMediaToFile } from '../../electron/capabilityCore/generationOutputMaterializer.ts'

vi.mock('electron', async (original) => ({ ...await original(), safeStorage: {
  isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`test:${s}`), decryptString: (s) => s.toString().replace(/^test:/, ''),
} }))
let root, relay
beforeEach(() => {
  root = makeTempDir('relay-protocol-')
  vi.stubEnv('NOMI_SETTINGS_DIR', path.join(root, 'settings'))
  vi.stubEnv('NOMI_PROJECTS_DIR', path.join(root, 'projects'))
})
afterEach(async () => { taskCache.delete('task-1'); await relay?.close(); relay = undefined; fs.rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs() })
async function prepare(shape = 'content', fault = null) {
  relay = await startRelayVideoFixture({ shape, fault })
  const card = relayDeclaration(relay.baseUrl, { shape })
  const reply = await submitDeclaration({ name: 'Loopback protocol', declaration: JSON.stringify(card) })
  expect(reply.ok, JSON.stringify(reply)).toBe(true)
  const row = readCatalog().models.find((m) => m.modelKey === 'opaque-gamma')
  upsertModelCatalogVendorApiKey(row.vendorKey, { apiKey: FAKE_RELAY_KEY, enabled: true })
  const project = createProject({ name: 'Protocol matrix', rootPath: path.join(root, 'project') })
  const payload = { vendor: row.vendorKey, request: { kind: 'text_to_video', prompt: 'A blue marble', duration: 4, extras: { projectId: project.id, modelKey: row.modelKey } } }
  const accepted = await runTask(payload, { spendGate: async () => {} })
  const poll = { vendor: row.vendorKey, modelKey: row.modelKey, projectId: project.id, taskKind: 'text_to_video', taskId: accepted.id }
  return { row, project, accepted, poll, card }
}
const posts = () => relay.hits.filter((h) => h.method === 'POST')
it.each(['content', 'plural-url', 'legacy-url'])('%s: AI declaration reaches decoded local asset with exactly one POST', async (shape) => {
  const { accepted, poll } = await prepare(shape)
  expect(['queued', 'running']).toContain(accepted.status)
  expect(accepted.id).toBe('task-1')
  const finished = await fetchTaskResult(poll)
  expect(finished.result.status).toBe('succeeded')
  expect(finished.result.provenance?.provider).toBe(poll.vendor)
  expect(finished.result.assets).toHaveLength(1)
  const asset = finished.result.assets[0]
  expect(asset.url).toMatch(/^nomi-local:/)
  expect(readNomiLocalAsset(asset.url).bytes.equals(relay.mp4)).toBe(true)
  expect(listProjectAssets({ projectId: poll.projectId }).items.find((item) => item.data.url === asset.url)?.data.mediaType).toBe('video')
  expect(posts()).toHaveLength(1)
  if (shape === 'content') {
    expect(Object.values(posts()[0].body).every((value) => typeof value === 'string')).toBe(true)
    expect(posts()[0].body).toMatchObject({ seconds: '4', size: '1280x720' })
    expect(relay.hits.filter((hit) => hit.path.endsWith('/content'))[0].authorized).toBe(true)
  }
})
it.each(['html', 'json-error', 'wrong-mime', 'bad-bytes', 'oversize', 'redirect'])('%s result never becomes an asset and retry/restart only GET the accepted task', async (fault) => {
  const { poll } = await prepare('content', fault)
  await expect(fetchTaskResult(poll)).rejects.toThrow(['html', 'json-error', 'wrong-mime', 'oversize'].includes(fault) ? /retrieval-download/ : undefined)
  expect(taskCache.get('task-1')).toBeTruthy()
  taskCache.delete('task-1') // Same recovery boundary as a fresh main process: context is rebuilt from the persisted identity.
  await expect(fetchTaskResult(poll)).rejects.toThrow()
  expect(posts()).toHaveLength(1)
  expect(relay.hits.filter((h) => h.path === '/asset.mp4')).toHaveLength(0)
  const generated = path.join(root, 'project', 'assets', 'generated')
  expect(fs.existsSync(generated) ? fs.readdirSync(generated, { recursive: true }).filter((name) => name.endsWith('.mp4')) : []).toHaveLength(0)
})
it('completed file response can be retrieved after cache eviction without another create', async () => {
  const { poll } = await prepare()
  taskCache.delete('task-1')
  expect((await fetchTaskResult(poll)).result.assets).toHaveLength(1)
  expect(posts()).toHaveLength(1)
})
it('a cold process resumes the persisted accepted task and lands a decoded asset without another POST', async () => {
  const { poll } = await prepare()
  taskCache.delete(poll.taskId)
  const inputFile = path.join(root, 'cold-retrieval-input.json')
  const outputFile = path.join(root, 'cold-retrieval-result.json')
  fs.writeFileSync(inputFile, JSON.stringify({ poll, outputFile }))
  // Async child execution leaves the real upstream HTTP server responsive. One thread pool
  // keeps every test worker inside the timed child process, including on timeout.
  const child = await promisify(execFile)(process.execPath, [
    path.resolve('node_modules/vitest/vitest.mjs'), 'run', 'tests/relay-onboarding/restart-child.test.mjs',
    '--pool=threads', '--maxWorkers=1',
  ], { cwd: process.cwd(), env: { ...process.env, NOMI_RELAY_RESTART_INPUT: inputFile }, timeout: stationTimeout({ turns: 2 }), maxBuffer: 1024 * 1024 })
  expect(child.stderr).not.toMatch(/unhandled rejection/i)
  const recovered = JSON.parse(fs.readFileSync(outputFile, 'utf8'))
  expect(recovered.pid).not.toBe(process.pid)
  expect(recovered.initialTaskCacheSize).toBe(0)
  expect(recovered.result.status).toBe('succeeded')
  expect(recovered.persistedAssetType).toBe('video')
  expect(readNomiLocalAsset(recovered.result.assets[0].url).bytes.equals(relay.mp4)).toBe(true)
  expect(posts()).toHaveLength(1)
  expect(relay.hits.filter((hit) => hit.path.endsWith('/content'))).toHaveLength(1)
}, stationTimeout({ turns: 3 }))

it('slow content times out, keeps the receipt, and cancellation stops a subsequent GET', async () => {
  const { poll } = await prepare('content', 'slow')
  vi.stubEnv('NOMI_VENDOR_HTTP_TIMEOUT_MS', '80')
  await expect(fetchTaskResult(poll)).rejects.toThrow()
  expect(taskCache.get('task-1')).toBeTruthy()
  vi.stubEnv('NOMI_VENDOR_HTTP_TIMEOUT_MS', '10000')
  const controller = new AbortController()
  const request = fetchTaskResult(poll, controller.signal)
  // Observe actual HTTP arrival rather than sleeping to infer work has started.
  await vi.waitFor(() => expect(relay.hits.filter((h) => h.path.endsWith('/content'))).toHaveLength(2))
  controller.abort(new DOMException('Cancelled by creator', 'AbortError'))
  await expect(request).rejects.toThrow()
  expect(controller.signal.aborted).toBe(true)
  expect(posts()).toHaveLength(1)
})
it('missing provider task ID never becomes a fabricated polling identity', async () => {
  const { accepted } = await prepare('content', 'missing-task-id')
  expect(accepted.status).toBe('failed')
  expect(accepted.id).not.toBe('task-1')
  expect(posts()).toHaveLength(1)
  expect(relay.hits.some((h) => /\/content$/.test(h.path))).toBe(false)
})
it('unknown connection has no guessed video route, explicit standard capability selects only its contract', () => {
  const base = { baseUrl: 'https://relay.example', authType: 'bearer', models: [{ modelKey: 'video-whatever', labelZh: 'Video', kind: 'video' }] }
  expect(buildOpenAiCompatibleDraft(base).models[0].modes).toEqual([])
  expect(() => buildOpenAiCompatibleDraft({ ...base, mediaProtocols: ['openai-videos-v1', 'video-generations-json-v1'] })).toThrow(/explicit model declaration/)
  expect(buildOpenAiCompatibleDraft({ ...base, mediaProtocols: ['openai-videos-v1'] }).models[0].modes[0].create.path).toBe('/v1/videos')
})
it('multipart rejects half a file pair and media bytes cannot be declared on create/query or a text model', () => {
  for (const mutate of [
    (mode) => { mode.create.multipart.fileField = 'input_reference' },
    (mode) => { mode.create.mediaResponse = mode.result.mediaResponse },
    (mode) => { mode.query.mediaResponse = mode.result.mediaResponse },
    (mode) => { mode.result.method = 'POST' },
  ]) {
    const card = relayDeclaration('https://relay.example', { shape: 'content' })
    mutate(card.models[0].modes[0])
    expect(() => validateProviderAdapterDraft(card, { providerBaseUrl: 'https://relay.example', selectedModelKeys: ['opaque-gamma'] })).toThrow()
  }
})
it('chunked bodies are bounded by received bytes, not only Content-Length', async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65)); controller.close() } })
  await expect(streamProfileMediaToFile(new Response(stream, { headers: { 'Content-Type': 'video/mp4' } }), path.join(root, 'bounded.mp4'), new AbortController().signal, 64)).rejects.toThrow(/size limit/)
})

it('a rejected create is never retried on another route', async () => {
  await expect(prepare('content', 'create-rejected')).rejects.toThrow()
  expect(posts()).toHaveLength(1)
  expect(posts()[0].path).toBe('/v1/videos')
  expect(relay.tasks.size).toBe(0)
})
it('a landing failure preserves the receipt; after the workspace returns recovery only queries and downloads', async () => {
  const { poll } = await prepare()
  const projectRoot = path.join(root, 'project')
  const hidden = `${projectRoot}.temporarily-unavailable`
  fs.renameSync(projectRoot, hidden)
  try { await expect(fetchTaskResult(poll)).rejects.toThrow() }
  finally { fs.renameSync(hidden, projectRoot) }
  expect(taskCache.get('task-1')).toBeTruthy()
  taskCache.delete('task-1')
  expect((await fetchTaskResult(poll)).result.assets).toHaveLength(1)
  expect(posts()).toHaveLength(1)
})

it('file-result operations preserve the shared ban on forwarding local references after submission', async () => {
  const { row, card, accepted, poll } = await prepare()
  const vendor = readCatalog().vendors.find((item) => item.key === row.vendorKey)
  const operation = { ...card.models[0].modes[0].result, query: { image: 'nomi-local://asset/project/missing.png' } }
  await expect(executeProfileOperation({ vendor, model: row, apiKey: FAKE_RELAY_KEY,
    request: { kind: 'text_to_video', prompt: 'A blue marble', extras: { projectId: poll.projectId } },
    operation, providerMeta: { task_id: accepted.id }, stage: 'result',
  })).rejects.toThrow()
  expect(relay.hits.filter((hit) => hit.path.endsWith('/content'))).toHaveLength(0)
  expect(posts()).toHaveLength(1)
})
