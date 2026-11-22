// typecheck 编排器的判据测试：四份检查一份都不许悄悄少；任何一份红整体红；并发且不早退。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

import { TYPECHECK_JOBS, runTypecheckJobs } from './typecheck.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function bypassesTscCommand(source) {
  if (source.includes(['typescript', 'bin', 'tsc'].join('/'))) return true
  const file = ts.createSourceFile('script.ts', source, ts.ScriptTarget.Latest, true)
  let bypass = false
  const visit = (node) => {
    if (ts.isCallExpression(node) && /(?:^|\.)spawn(?:Sync)?$/.test(node.expression.getText(file))) {
      bypass ||= node.arguments.slice(0, 2).some((arg) => /\btsc(?:Bin|Path)?\b/.test(arg.getText(file)))
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return bypass
}

test('所有脚本只经统一入口启动 tsc：新增第五处自行解析或 spawn 也红', () => {
  const scripts = path.join(repoRoot, 'scripts')
  const bypasses = fs.readdirSync(scripts, { recursive: true })
    .filter((file) => file !== path.join('lib', 'tsc-run.mjs') && fs.statSync(path.join(scripts, file)).isFile())
    .filter((file) => bypassesTscCommand(fs.readFileSync(path.join(scripts, file), 'utf8')))
  assert.deepEqual(bypasses, [], 'tsc 命令只能在 scripts/lib/tsc-run.mjs 里定义')
})

test('结构判据认得旧拼法、直接 spawn 和新增脚本；普通 Node 子进程不误伤', () => {
  assert.equal(bypassesTscCommand(`require.resolve('${['typescript', 'bin', 'tsc'].join('/')}')`), true)
  assert.equal(bypassesTscCommand("spawn(process.execPath, [tscBin, '-p', project])"), true)
  assert.equal(bypassesTscCommand("spawnSync('tsc', ['-p', project])"), true)
  assert.equal(bypassesTscCommand("spawn(process.execPath, ['scripts/check-test-types.mjs'])"), false)
})

test('五份检查一份都不少：app / electron / electron-pi（--noEmit）/ 浏览器测试夹具四份 tsc，加 check:test-types', () => {
  const tsc = TYPECHECK_JOBS.filter((job) => job.kind === 'tsc').map((job) => job.args.join(' '))
  assert.deepEqual(tsc, ['-p tsconfig.app.json', '-p electron/tsconfig.json', '-p electron/tsconfig.pi.json --noEmit', '-p tsconfig.fixtures.json'])
  const scripts = TYPECHECK_JOBS.filter((job) => job.kind === 'script').map((job) => job.script)
  assert.deepEqual(scripts, ['scripts/check-test-types.mjs'])
  for (const job of TYPECHECK_JOBS) {
    if (job.script) assert.ok(fs.existsSync(path.join(repoRoot, job.script)), `${job.script} 不存在`)
  }
})

test('package.json：typecheck 走编排器；gates:contracts 里 typecheck 在、check:test-types 不再单列（由 typecheck 带起）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts.typecheck, 'node ./scripts/typecheck.mjs')
  assert.match(pkg.scripts['check:test-types'], /check-test-types\.mjs/)
  const gates = pkg.scripts['gates:contracts'].split(/\s+/)
  assert.ok(gates.includes('typecheck'))
  assert.ok(!gates.includes('check:test-types'), 'check:test-types 已并入 typecheck，不许同时再跑一遍')
})

test('并发而不早退：先红的不阻止后面的跑完；任何一份红整体红，汇总点名', async () => {
  const started = []
  const finish = []
  const run = (job) => new Promise((resolve) => {
    started.push(job.name)
    finish.push(() => resolve({ name: job.name, code: job.name === 'tsc electron' ? 2 : 0, output: '', ms: 1 }))
  })
  const pending = runTypecheckJobs(TYPECHECK_JOBS, { run })
  assert.equal(started.length, TYPECHECK_JOBS.length, '任何一份结束前五份都已启动，不能串行等待')
  finish[1]()
  await Promise.resolve()
  let settled = false
  pending.then(() => { settled = true })
  await Promise.resolve()
  assert.equal(settled, false, '一份先红时仍必须等其余检查完成')
  finish.forEach((resolve) => resolve())
  const outcome = await pending
  assert.deepEqual(outcome.failed.map((result) => result.name), ['tsc electron'])
  assert.equal(outcome.results.length, TYPECHECK_JOBS.length)
})

test('没跑起来也算红（失败方向只有一个）', async () => {
  const outcome = await runTypecheckJobs(TYPECHECK_JOBS.slice(0, 1), { run: async (job) => ({ name: job.name, code: 1, output: 'spawn failed', ms: 1 }) })
  assert.equal(outcome.failed.length, 1)
})
