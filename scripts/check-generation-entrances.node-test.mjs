import { makeTempDir } from './_test-temp.mjs'
// 门岗自测：**先验它会红**（R17）。三条判据各一条阳性对照 + 一条现状为绿的对照。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { checkGenerationEntrances, scanDispatchSites } from './check-generation-entrances.mjs'

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
