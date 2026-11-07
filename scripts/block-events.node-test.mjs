// 本机门岗阻断记录（scripts/lib/blockEvents.mjs）：红一次多一行、形状过 schema、写不成只警告不改结论、CI 里不写；
// 两个本机入口（推送前快检 / 钩子、整套门岗）的阻断出口都经过它。
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import Ajv from 'ajv'

import { BLOCK_EVENTS_FILE, BLOCK_EVENTS_SCHEMA, blockEventsPath, readBlockEvents, recordBlockEvent } from './lib/blockEvents.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const validate = new Ajv({ allErrors: true, strict: true }).compile(JSON.parse(fs.readFileSync(path.join(repoRoot, BLOCK_EVENTS_SCHEMA), 'utf8')))
const assertValid = (record) => assert.ok(validate(record), JSON.stringify(validate.errors))

function tempRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block-events-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q', '-b', 'fix/some-branch'])
  git(['config', 'user.email', 't@example.com'])
  git(['config', 'user.name', 't'])
  git(['commit', '-q', '--allow-empty', '-m', 'init'])
  return { dir, git }
}

test('a local block appends exactly one schema-valid line under the git common dir, shared by every worktree', (t) => {
  const { dir, git } = tempRepo(t)
  const worktree = `${dir}-wt`
  git(['worktree', 'add', '-q', '-b', 'other', worktree])
  t.after(() => fs.rmSync(worktree, { recursive: true, force: true }))
  const env = {}
  const first = recordBlockEvent({ stage: 'push', gates: ['check:pr-judgement', 'lint:changed', 'lint:changed'], durationMs: 3712.4, cwd: dir, env, warn: assert.fail })
  const second = recordBlockEvent({ stage: 'gates', gates: ['typecheck'], cwd: worktree, env, warn: assert.fail })
  assert.equal(first.written, true)
  assert.equal(first.file, second.file, '所有工作树写同一份')
  assert.equal(path.basename(first.file), BLOCK_EVENTS_FILE)
  assert.equal(fs.realpathSync(path.dirname(first.file)), fs.realpathSync(path.join(dir, '.git')))
  const { records, malformed } = readBlockEvents(first.file)
  assert.equal(malformed, 0)
  assert.equal(records.length, 2)
  for (const record of records) assertValid(record)
  assert.deepEqual(records[0].gates, ['check:pr-judgement', 'lint:changed'])
  assert.equal(records[0].branch, 'fix/some-branch')
  assert.equal(records[0].durationMs, 3712)
  assert.equal(records[0].codeChanged, null, 'codeChanged 由 block-radar 事后算，写入时恒为 null')
  assert.equal(records[1].branch, 'other')
  assert.equal(records[0].head, git(['rev-parse', 'HEAD']).trim())
})

test('schema rejects records that drifted from the writer', () => {
  const good = { at: '2026-11-07T01:02:03.456Z', stage: 'quick', gates: ['typecheck'], branch: null, head: 'a'.repeat(40), runner: 'local', durationMs: null, codeChanged: null }
  assertValid(good)
  for (const bad of [
    { ...good, stage: 'ci' },
    { ...good, gates: [] },
    { ...good, head: 'abc' },
    { ...good, at: '2026-11-07 01:02:03' },
    { ...good, extra: 1 },
    { ...good, runner: 'ci' },
    (({ codeChanged, ...rest }) => rest)(good),
  ]) assert.equal(validate(bad), false, JSON.stringify(bad))
})

test('recording never changes the gate verdict: unwritable target only warns; CI does not write; bad input only warns', (t) => {
  const { dir } = tempRepo(t)
  const warnings = []
  const failing = recordBlockEvent({ stage: 'push', gates: ['x'], cwd: dir, env: {}, append: () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }) }, warn: (line) => warnings.push(line) })
  assert.equal(failing.written, false)
  assert.match(warnings[0], /阻断记录没写成（不影响门岗结论）：EACCES/)
  const outside = recordBlockEvent({ stage: 'push', gates: ['x'], cwd: os.tmpdir(), env: {}, warn: (line) => warnings.push(line) })
  assert.equal(outside.written, false, '不在 git 仓库里')
  assert.equal(recordBlockEvent({ stage: 'ci', gates: ['x'], cwd: dir, env: {}, warn: (line) => warnings.push(line) }).written, false)
  assert.equal(recordBlockEvent({ stage: 'push', gates: [], cwd: dir, env: {}, warn: (line) => warnings.push(line) }).written, false)
  const ci = recordBlockEvent({ stage: 'gates', gates: ['x'], cwd: dir, env: { CI: 'true' }, append: assert.fail, warn: assert.fail })
  assert.equal(ci.written, false)
  assert.equal(readBlockEvents(blockEventsPath({ cwd: dir })).records.length, 0)
})

test('reader skips torn lines and treats a missing file as empty', (t) => {
  const { dir } = tempRepo(t)
  const file = path.join(dir, 'events.jsonl')
  assert.deepEqual(readBlockEvents(file), { records: [], malformed: 0 })
  fs.writeFileSync(file, '{"stage":"push"}\n{"stage":\n\n')
  assert.deepEqual(readBlockEvents(file), { records: [{ stage: 'push' }], malformed: 1 })
})

test('both local entries record at their blocking exit (structural)', () => {
  const gates = fs.readFileSync(path.join(repoRoot, 'scripts/run-gates-contracts.mjs'), 'utf8')
  assert.match(gates, /import \{ recordBlockEvent \} from '\.\/lib\/blockEvents\.mjs'/)
  assert.match(gates, /recordBlockEvent\(\{ stage: 'gates'/)
  const prePush = fs.readFileSync(path.join(repoRoot, 'scripts/pre-push-contracts.mjs'), 'utf8')
  assert.match(prePush, /import \{ recordBlockEvent \} from '\.\/lib\/blockEvents\.mjs'/)
  // 钩子的每一条阻断出口都从命令行入口那一处走：main() 返回 1（阻断）就记一条（门岗名由 main 写进 blockContext）；
  // 返回 2 是参数 / 环境错，不算被门岗拦
  assert.match(prePush, /main\(\)\.then\(\(code\) => \{\n\s+if \(code === 1\) recordBlockEvent\(/)
})

test('a deliberately red gate in the full suite appends one schema-valid line (real run-gates-contracts process)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block-events-e2e-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'events.jsonl')
  // check:pr-judgement 拿到一份空正文（NOMI_PR_BODY=''）= 设计卡都没有 → 红；这是真门岗、真汇总出口
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/run-gates-contracts.mjs'), 'check:pr-judgement'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, CI: '', GITHUB_ACTIONS: '', NOMI_PR_BODY: '', NOMI_BLOCK_EVENTS_FILE: file },
    timeout: 240_000,
  })
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
  const { records } = readBlockEvents(file)
  assert.equal(records.length, 1)
  assertValid(records[0])
  assert.equal(records[0].stage, 'gates')
  assert.deepEqual(records[0].gates, ['check:pr-judgement'])
})
