import { makeTempDir } from './_test-temp.mjs'
// 门岗自测：**先验它会红**（R17）。三条判据各一条阳性对照 + 一条现状为绿的对照。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { APPROVED_LANDING_EXCEPTIONS, checkGenerationEntrances, scanDispatchSites } from './check-generation-entrances.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 把门岗读的四样东西复制到一个临时根上，这样阳性对照不碰真仓库。 */
function sandbox() {
  const root = makeTempDir('nomi-entrances-gate-')
  for (const relative of [
    'scripts/generation-entrances-ledger.json',
    'electron/parity/generationEntrances.ts',
    'electron/parity/parityCases.ts',
  ]) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.join(repoRoot, relative), target)
  }
  return root
}

const readLedger = (root) => JSON.parse(fs.readFileSync(path.join(root, 'scripts/generation-entrances-ledger.json'), 'utf8'))
const writeLedger = (root, value) => fs.writeFileSync(path.join(root, 'scripts/generation-entrances-ledger.json'), JSON.stringify(value, null, 2))

test('现状：真仓库上是绿的', () => {
  assert.deepEqual(checkGenerationEntrances(repoRoot), [])
})

test('反向扫真的扫得到已知的那几扇门', () => {
  const sites = scanDispatchSites(repoRoot)
  assert.ok(sites.has('electron/capabilityCore/generationRuntimeAdapter.ts::provider.buildRequest'))
  assert.ok(sites.has('src/workbench/generationCanvas/runner/catalogTaskActions.ts::runTask'))
  assert.ok(sites.has('electron/capabilityCore/modelOnboarding/tryModel.ts::deps.runTask'))
})

test('阳性对照①：新长出一个未登记的调用点 → 红', () => {
  const root = sandbox()
  // 复制一份真实的调用点集合进沙箱，再删掉其中一条登记。
  const ledger = readLedger(root)
  const removed = ledger.sites.pop()
  writeLedger(root, ledger)
  // 沙箱里没有 electron/ 与 src/ 的源码，所以直接把「扫到的集合」换成真仓库的那一份来比。
  fs.cpSync(path.join(repoRoot, 'electron'), path.join(root, 'electron'), { recursive: true })
  fs.cpSync(path.join(repoRoot, 'src'), path.join(root, 'src'), { recursive: true })
  const problems = checkGenerationEntrances(root)
  assert.ok(problems.some((problem) => problem.includes('未登记的生成调用点') && problem.includes(removed.site)),
    `期望报出未登记的 ${removed.site}，实际：${problems.join(' | ')}`)
})

test('阳性对照②：登记表留着一条已经不存在的门 → 红', () => {
  const root = sandbox()
  fs.cpSync(path.join(repoRoot, 'electron'), path.join(root, 'electron'), { recursive: true })
  fs.cpSync(path.join(repoRoot, 'src'), path.join(root, 'src'), { recursive: true })
  const ledger = readLedger(root)
  ledger.sites.push({ site: 'electron/ghost/vanished.ts::runTask', count: 1, reason: '已经被删掉的门' })
  writeLedger(root, ledger)
  const problems = checkGenerationEntrances(root)
  assert.ok(problems.some((problem) => problem.includes('已经不存在')), problems.join(' | '))
})

test('阳性对照③：登记条目既没有 entrances 也没有 reason → 红', () => {
  const root = sandbox()
  fs.cpSync(path.join(repoRoot, 'electron'), path.join(root, 'electron'), { recursive: true })
  fs.cpSync(path.join(repoRoot, 'src'), path.join(root, 'src'), { recursive: true })
  const ledger = readLedger(root)
  const target = ledger.sites.find((site) => site.reason)
  delete target.reason
  writeLedger(root, ledger)
  const problems = checkGenerationEntrances(root)
  assert.ok(problems.some((problem) => problem.includes('既没有 entrances 也没有 reason')), problems.join(' | '))
})

test('阳性对照④：加了入口却没更新矩阵形状 → 红', () => {
  const root = sandbox()
  fs.cpSync(path.join(repoRoot, 'electron'), path.join(root, 'electron'), { recursive: true })
  fs.cpSync(path.join(repoRoot, 'src'), path.join(root, 'src'), { recursive: true })
  const file = path.join(root, 'electron/parity/generationEntrances.ts')
  const source = fs.readFileSync(file, 'utf8').replace(
    '];\n\n/** 矩阵的基准入口',
    '  {\n    id: "ghost-entrance",\n    userAction: "验红用",\n    engine: "provider",\n    entrySite: "x",\n'
      + '    dispatchSite: "electron/capabilityCore/generationRuntimeAdapter.ts:282",\n'
      + '    projectsPromptMentions: false,\n    appendsRetryDirective: false,\n    dispatchProfile: "provider",\n  },\n];\n\n/** 矩阵的基准入口',
  )
  fs.writeFileSync(file, source)
  const problems = checkGenerationEntrances(root)
  assert.ok(problems.some((problem) => problem.includes('ledger.matrix.entrances')), problems.join(' | '))
})

test('阳性对照⑤：入口指向一个不发请求的 dispatchSite → 红', () => {
  const root = sandbox()
  fs.cpSync(path.join(repoRoot, 'electron'), path.join(root, 'electron'), { recursive: true })
  fs.cpSync(path.join(repoRoot, 'src'), path.join(root, 'src'), { recursive: true })
  const file = path.join(root, 'electron/parity/generationEntrances.ts')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8')
    .replace('dispatchSite: "electron/runtime.ts:309 runTask"', 'dispatchSite: "electron/nowhere.ts:1 runTask"'))
  const problems = checkGenerationEntrances(root)
  assert.ok(problems.some((problem) => problem.includes('不在反向扫到的调用点文件里')), problems.join(' | '))
})

// 架构③（协调会话 10-08，用户拍板「生成那一刻 = 落画布那一刻」）：每个生成入口都要说清「请求发出之前，画布上有没有这一镜的节点」。
// 入口表每条带 `landing`：`{ kind: "node-first", owner: "<文件> <符号>" }`（谁保证先有节点）或 `{ kind: "exception" }`，
// 例外的理由住在登记表 `landingExceptions`（门岗只认那里写了理由的）。今天唯一批准的例外是接入试跑（try-model）。
const withSources = (root) => {
  fs.cpSync(path.join(repoRoot, 'electron'), path.join(root, 'electron'), { recursive: true })
  fs.cpSync(path.join(repoRoot, 'src'), path.join(root, 'src'), { recursive: true })
  return root
}
const entrancesFile = (root) => path.join(root, 'electron/parity/generationEntrances.ts')
const entranceBlock = (source, id) => {
  const start = source.indexOf(`    id: "${id}",`)
  return source.slice(start, source.indexOf('\n  },', start))
}

test('落地：真仓库上每个入口都声明了落地方式；例外只有 try-model，且登记表里写着理由', () => {
  const source = fs.readFileSync(entrancesFile(repoRoot), 'utf8')
  const ids = [...source.matchAll(/^\s{4}id: "([^"]+)",$/gm)].map((match) => match[1])
  for (const id of ids) assert.match(entranceBlock(source, id), /\n\s{4}landing: \{ kind: "(node-first|exception)"/, `${id} 没有 landing`)
  const exceptions = ids.filter((id) => /landing: \{ kind: "exception"/.test(entranceBlock(source, id)))
  assert.deepEqual(exceptions, ['try-model'])
  const reason = readLedger(repoRoot).landingExceptions?.['try-model']
  assert.ok(typeof reason === 'string' && reason.trim().length >= 20, `try-model 的例外理由缺失：${reason}`)
})

test('阳性对照⑥：新入口不声明落地方式 → 红', () => {
  const root = withSources(sandbox())
  const file = entrancesFile(root)
  const source = fs.readFileSync(file, 'utf8')
  const block = entranceBlock(source, 'canvas-node')
  fs.writeFileSync(file, source.replace(block, block.replace(/\n\s{4}landing: [^\n]*/, '')))
  const problems = checkGenerationEntrances(root)
  assert.ok(problems.some((problem) => problem.includes('canvas-node') && problem.includes('没有声明落地方式')), problems.join(' | '))
})

test('阳性对照⑦：入口自称例外、登记表里却没有理由（不落地就派发）→ 红', () => {
  const root = withSources(sandbox())
  const file = entrancesFile(root)
  const source = fs.readFileSync(file, 'utf8')
  const block = entranceBlock(source, 'continue-batch')
  fs.writeFileSync(file, source.replace(block, block.replace(/\n\s{4}landing: [^\n]*/, '\n    landing: { kind: "exception" },')))
  const problems = checkGenerationEntrances(root)
  assert.ok(problems.some((problem) => problem.includes('continue-batch') && problem.includes('落地例外')), problems.join(' | '))
})

test('阳性对照⑧：node-first 指向一个不存在的落地 owner → 红', () => {
  const root = withSources(sandbox())
  const file = entrancesFile(root)
  const source = fs.readFileSync(file, 'utf8')
  const block = entranceBlock(source, 'auto-run-batch')
  fs.writeFileSync(file, source.replace(block, block.replace(/\n\s{4}landing: [^\n]*/, '\n    landing: { kind: "node-first", owner: "electron/nowhere/ghostLanding.ts landGhost" },')))
  const problems = checkGenerationEntrances(root)
  assert.ok(problems.some((problem) => problem.includes('auto-run-batch') && problem.includes('落地 owner')), problems.join(' | '))
})

// #1139 对抗评审 N3：例外按身份写死、条数也对账。以前「是登记表里的调用点」就能进 landingExceptions。
test('落地例外按身份写死：批准的恰好两条（try-model、接入认证试跑），真仓库的例外表与它逐条相等', () => {
  assert.deepEqual(Object.keys(APPROVED_LANDING_EXCEPTIONS).sort(), ['electron/integrationCertification/integrationSession.ts::runTask', 'try-model'])
  assert.deepEqual(Object.keys(readLedger(repoRoot).landingExceptions).sort(), Object.keys(APPROVED_LANDING_EXCEPTIONS).sort())
})

test('阳性对照⑨：把一个普通登记调用点塞进 landingExceptions（悄悄多一条永久豁免）→ 红', () => {
  const root = withSources(sandbox())
  const ledger = readLedger(root)
  const ordinary = ledger.sites.find((site) => site.site === 'electron/main.ts::runTask')
  assert.ok(ordinary, '夹具：登记表里应当有 electron/main.ts::runTask 这个普通调用点')
  ledger.landingExceptions[ordinary.site] = '看起来像理由的一句话，用来验证门岗不认它'
  writeLedger(root, ledger)
  const problems = checkGenerationEntrances(root)
  assert.ok(problems.some((problem) => problem.includes('electron/main.ts::runTask') && problem.includes('不在批准的落地例外里')), problems.join(' | '))
  assert.ok(problems.some((problem) => problem.includes('条数') || problem.includes('批准的是 2 条')), problems.join(' | '))
})

test('阳性对照⑩：删掉一条批准的例外（少一条）→ 红', () => {
  const root = withSources(sandbox())
  const ledger = readLedger(root)
  delete ledger.landingExceptions['electron/integrationCertification/integrationSession.ts::runTask']
  writeLedger(root, ledger)
  const problems = checkGenerationEntrances(root)
  assert.ok(problems.some((problem) => problem.includes('批准的是 2 条')), problems.join(' | '))
})
