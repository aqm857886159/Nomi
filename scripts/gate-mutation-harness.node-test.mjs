// gate-mutation-harness 的隔离证明（2026-10-10）：变异只落在副本上，真实工作区一个字节、一个 mtime 都不变，
// 包括 body 抛错、以及进程被硬杀（SIGKILL，Windows 上等同 TerminateProcess，不会跑任何 finally / 信号处理）。
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { makeTempDir } from './_test-temp.mjs'
import { createGateMutationHarness, repoRoot } from './gate-mutation-harness.mjs'

const TARGET = 'electron/shared/agentCapabilities/verbs/writeVerbs.ts'
const OPTIONS = { gate: 'scripts/check-model-face-frozen.mjs', shareDirs: ['docs', 'src', 'tests', 'evals', '.design-sync', 'outputs', 'worker', 'workers', 'infra'] }
const targetPath = path.join(repoRoot, TARGET)

function snapshot() {
  return { bytes: fs.readFileSync(targetPath), mtimeMs: fs.statSync(targetPath).mtimeMs }
}

function assertRealUntouched(before) {
  const after = snapshot()
  assert.ok(before.bytes.equals(after.bytes), '真实文件内容变了')
  assert.equal(after.mtimeMs, before.mtimeMs, '真实文件 mtime 变了（被写过）')
  const status = execFileSync('git', ['status', '--porcelain', '--', TARGET], { cwd: repoRoot, encoding: 'utf8' })
  assert.equal(status.trim(), '', `真实工作区不干净：${status}`)
}

/** 删掉被硬杀的子进程留下的副本：先拆 junction，再删目录（docs/lessons/windows-worktree-remove-follows-junctions.md）。 */
function removeLeakedCopy(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (fs.lstatSync(full).isSymbolicLink()) { try { fs.unlinkSync(full) } catch { fs.rmdirSync(full) } }
  }
  fs.rmSync(root, { recursive: true, force: true })
}

const harness = createGateMutationHarness(OPTIONS)
const FIND = fs.readFileSync(targetPath, 'utf8').slice(0, 24)

test('变异只落在副本：body 里能看到变异，结束后真实文件不变（内容、mtime、git status）', () => {
  const before = snapshot()
  const seen = harness.withMutation([[TARGET, FIND, 'MUTATED-IN-COPY-ONLY']], () => {
    const inCopy = fs.readFileSync(path.join(harness.copyRootForTests(), TARGET), 'utf8')
    assertRealUntouched(before)
    return inCopy.startsWith('MUTATED-IN-COPY-ONLY')
  })
  assert.equal(seen, true)
  assertRealUntouched(before)
  const outside = path.relative(repoRoot, harness.copyRootForTests())
  assert.ok(outside.startsWith('..') || path.isAbsolute(outside), '副本必须在仓库之外')
})

test('body 抛错之后：真实文件不变，副本也还原给下一个用例', () => {
  const before = snapshot()
  assert.throws(() => harness.withMutation([[TARGET, FIND, 'MUTATED-THEN-THROW']], () => { throw new Error('boom') }), /boom/)
  assertRealUntouched(before)
  assert.equal(fs.readFileSync(path.join(harness.copyRootForTests(), TARGET), 'utf8').slice(0, 24), FIND)
})

test('变异目标落在 junction 共享目录（会写穿到真实仓库）会被拒绝', () => {
  const before = snapshot()
  const docsFile = execFileSync('git', ['ls-files', 'docs/engineering'], { cwd: repoRoot, encoding: 'utf8' }).split('\n').find((name) => name.endsWith('.json'))
  const text = fs.readFileSync(path.join(repoRoot, docsFile), 'utf8')
  const docsBefore = fs.statSync(path.join(repoRoot, docsFile)).mtimeMs
  assert.throws(() => harness.withMutation([[docsFile, text.slice(0, 5), 'XXXXX']], () => {}), /拒绝写入|不在副本里/)
  assert.equal(fs.statSync(path.join(repoRoot, docsFile)).mtimeMs, docsBefore)
  assertRealUntouched(before)
})

test('进程被硬杀（SIGKILL）在变异中途：真实工作区仍然干净', () => {
  const before = snapshot()
  const harnessUrl = pathToFileURL(path.join(repoRoot, 'scripts/gate-mutation-harness.mjs')).href
  const code = `
    import { createGateMutationHarness } from ${JSON.stringify(harnessUrl)}
    const h = createGateMutationHarness(${JSON.stringify(OPTIONS)})
    h.withMutation([[${JSON.stringify(TARGET)}, ${JSON.stringify(FIND)}, 'KILLED-MID-MUTATION']], () => {
      console.log('COPY=' + h.copyRootForTests())
      process.kill(process.pid, 'SIGKILL')
    })
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: makeTempDir('nomi-harness-kill-'), encoding: 'utf8' })
  const copyRoot = /COPY=(.+)/.exec(child.stdout ?? '')?.[1]?.trim()
  try {
    assert.ok(copyRoot, `子进程没有走到变异中途：${child.stderr}`)
    assert.ok(child.signal === 'SIGKILL' || child.status !== 0, '子进程应该是被杀掉的')
    assert.match(fs.readFileSync(path.join(copyRoot, TARGET), 'utf8'), /^KILLED-MID-MUTATION/, '被杀时副本里留着变异（预期：它只在副本里）')
    assertRealUntouched(before)
  } finally {
    if (copyRoot) removeLeakedCopy(copyRoot)
  }
})
