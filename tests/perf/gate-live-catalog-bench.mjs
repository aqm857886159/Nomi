#!/usr/bin/env node
// 生成工具的门读「现在的」模型表要多少钱（设计卡 docs/plan/2026-11-16-external-agent-gate-reach-confirm.md ★7）。
// 真函数：electron/capabilityCore/liveGenerationRuntime.ts#createLiveGenerationRuntime 的 registry（两个宿主交给门的那一份）
// + electron/capabilityCore/mcpGenerationTools.ts#createGenerationPlanningHandler 的 preview / gate_request。
// 隔离资料目录、内置种子全量（所有内置家）、APIMart 存一把假密钥；不出网、零花费。
//
// 量什么（一个 40 镜的 Run）：
//   · gatePassMs（主指标）：40 镜各走一次预览 + 过门（request）的总毫秒——门每次都按现在的目录答；
//   · perGateCatalogReadMs：目录没变时门问一次目录的单次毫秒（缓存命中：读文件字节 + 比身份）；
//   · catalogRebuildMs：目录刚变过（交卡 / 存密钥）之后的第一次问，重算整张模型表的毫秒。
// 接口同 tests/perf/node-json-bench.mjs 的约定：--runs N --out 文件 → { runs, noisy, metrics: { 名字: number[] } }。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import Module from 'node:module'
import { require as tsxRequire } from 'tsx/cjs/api'

// 量具不在 Electron 里：换一个只认这条量具的 electron 模块——钥匙串用可逆的假加密（不碰真钥匙串），其余为空。
const fakeElectron = {
  app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd(), isPackaged: false },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(`perf:${plain}`, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8').replace(/^perf:/, ''),
  },
}
const originalLoad = Module._load
Module._load = function load(request, ...rest) {
  return request === 'electron' ? fakeElectron : originalLoad.call(this, request, ...rest)
}

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1] }
const runs = Number(arg('--runs', 5))
const output = arg('--out', '')
if (!output || !Number.isInteger(runs) || runs < 1) throw new Error('Use --out <result.json> and a positive --runs')

const SHOTS = 40
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-gate-live-catalog-'))
process.env.NOMI_SETTINGS_DIR = path.join(root, 'settings')
fs.mkdirSync(process.env.NOMI_SETTINGS_DIR, { recursive: true })

const { ensureBuiltinModelSeeds, upsertModelCatalogVendorApiKey, upsertModelCatalogVendor, readCatalog } = tsxRequire('../../electron/catalog/catalogStore.ts', import.meta.url)
const { createLiveGenerationRuntime } = tsxRequire('../../electron/capabilityCore/liveGenerationRuntime.ts', import.meta.url)
const { createGenerationPlanningHandler, createInMemoryGenerationOperationStore } = tsxRequire('../../electron/capabilityCore/mcpGenerationTools.ts', import.meta.url)
const lease = tsxRequire('../../electron/capabilityCore/projectLease.ts', import.meta.url)

ensureBuiltinModelSeeds()
upsertModelCatalogVendorApiKey('apimart', { apiKey: 'sk-perf-fake', enabled: true })

const projectLease = {
  version: lease.PROJECT_LEASE_VERSION, keyId: 'k', algorithm: lease.PROJECT_LEASE_ALGORITHM, issuer: 'nomi-main', nonce: 'n', scopeHash: 's', mac: 'm',
  projectId: 'project-1', immutableProjectUuid: 'uuid-1', projectGeneration: 1, canonicalRootDigest: 'r', manifestDigest: 'm',
  issuedAt: '2026-11-16T00:00:00.000Z', expiresAt: '2026-11-16T01:00:00.000Z', audience: lease.PROJECT_LEASE_AUDIENCE,
  leasePrincipal: 'mcp:codex', sessionId: 's', connectionNonce: 'c', revocationEpoch: 0,
  scopeSet: ['generation:create', 'generation:plan', 'generation:preview', 'generation:read', 'generation:cancel'],
}

const runtime = createLiveGenerationRuntime()
const handler = createGenerationPlanningHandler({
  registry: runtime.registry,
  createDraftScope: runtime.createDraftScope,
  operations: createInMemoryGenerationOperationStore(),
  now: () => '2026-11-16T00:00:00.000Z',
  providerReadiness: ({ providerId }) => runtime.readBootstrap().readinessByProvider[providerId] ?? { providerReady: false, missingForSubmit: ['configured_provider'] },
})
const call = (capability, params) => handler({ capability, params, lease: projectLease })

const target = runtime.registry.snapshot().flatMap((manifest) => manifest.providers.filter((p) => p.providerId === 'apimart')
  .flatMap((p) => p.models.map((model) => ({ moduleId: manifest.moduleId, providerId: 'apimart', modelId: model.modelId, mode: model.modes[0] }))))
  .find((row) => row.modelId.includes('seedream'))
if (!target) throw new Error('no built-in APIMart image model')

async function draftOperations() {
  const ids = []
  for (let index = 0; index < SHOTS; index += 1) {
    const created = await call('create', { candidate: { candidateId: `c${index}`, revision: 1, ...target, prompt: `shot ${index}`, parameters: {}, references: [] } })
    ids.push(created.operation.operationId)
  }
  return ids
}

/** 目录变一次（设置页改一下名字）：门的下一次问要重算整张表。 */
let touch = 0
function touchCatalog() {
  touch += 1
  const vendor = readCatalog().vendors.find((row) => row.key === 'apimart')
  upsertModelCatalogVendor({ ...vendor, name: `APIMart ${touch}` })
}

async function onePass() {
  const ids = await draftOperations()
  touchCatalog()
  const rebuildStarted = performance.now()
  runtime.registry.snapshot()
  const catalogRebuildMs = performance.now() - rebuildStarted
  const started = performance.now()
  for (const operationId of ids) {
    await call('preview', { operationId })
    const gate = await call('gate_request', { operationId })
    if (gate.nextAction !== 'confirm') throw new Error(`gate did not reach confirm: ${JSON.stringify(gate).slice(0, 300)}`)
  }
  const gatePassMs = performance.now() - started
  // 门每问一次目录（目录没变，命中缓存）的单次毫秒：读一次文件字节 + 比一次身份。
  const readStarted = performance.now()
  for (let index = 0; index < SHOTS; index += 1) runtime.registry.snapshot()
  const perGateCatalogReadMs = (performance.now() - readStarted) / SHOTS
  return { gatePassMs, catalogRebuildMs, perGateCatalogReadMs }
}

await onePass() // warm-up
const load = () => os.loadavg()[1]
let noisy = load() >= 10
const metrics = { gatePassMs: [], catalogRebuildMs: [], perGateCatalogReadMs: [] }
for (let run = 0; run < runs; run += 1) {
  const sample = await onePass()
  metrics.gatePassMs.push(Number(sample.gatePassMs.toFixed(1)))
  metrics.catalogRebuildMs.push(Number(sample.catalogRebuildMs.toFixed(1)))
  metrics.perGateCatalogReadMs.push(Number(sample.perGateCatalogReadMs.toFixed(3)))
}
noisy = noisy || load() >= 10
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
fs.writeFileSync(output, `${JSON.stringify({ runs, noisy, metrics }, null, 2)}\n`)
console.log(JSON.stringify({ ...metrics, noisy }))
fs.rmSync(root, { recursive: true, force: true })
