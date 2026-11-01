import { afterEach, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { assertPaidBuildReady } from './_paidRun.mjs'
import { LOCK_EXIT_BUILD_MARKERS } from './_generationLockExitSteps.mjs'

const roots = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const parent = path.resolve(process.env.NOMI_LOCK_EXIT_OUT || '.tmp/generation-lock-exit')
  fs.mkdirSync(parent, { recursive: true })
  const root = fs.mkdtempSync(path.join(parent, 'receipt-unit-')); roots.push(root)
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
  git(['init', '-q'])
  const write = (name, text) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text) }
  const commit = () => { git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']); return git(['rev-parse', 'HEAD']) }
  write('src/guard.ts', 'old source'); write('electron/host.ts', 'host')
  const first = commit()
  const source = fs.readFileSync('tests/ux/generation-lock-exit-real.paid.mjs', 'utf8')
  const prefix = source.slice(source.indexOf('const receiptPath'), source.indexOf('const model'))
  const validate = (receipt = { commit: first, status: 'passed', report: { stages: ['storyboard', 'canvas', 'list', 'restart'] } }) => {
    const file = path.join(root, 'receipt.json'); fs.writeFileSync(file, JSON.stringify(receipt))
    // Execute only the actual preflight block; no paid entry, credentials or provider is invoked.
    vm.runInNewContext(prefix, { fs, assert, process: { env: { NOMI_LOCK_EXIT_REHEARSAL_RECEIPT: file } }, execFileSync: (exe, args) => execFileSync(exe, args, { cwd: root, stdio: 'pipe' }) })
  }
  return { root, write, commit, first, validate }
}
it('paid receipt accepts the same source through documentation-only commits', () => {
  const f = fixture(); f.write('docs/note.md', 'docs only'); f.commit(); expect(() => f.validate()).not.toThrow()
})
it.each(['src/guard.ts', 'electron/host.ts'])('paid receipt rejects an older source commit changed in %s', file => {
  const f = fixture(); f.write(file, 'changed'); f.commit(); expect(() => f.validate()).toThrow()
})
it('paid receipt rejects dirty product source even when its commit equals HEAD', () => {
  const f = fixture(); f.write('src/guard.ts', 'uncommitted'); expect(() => f.validate()).toThrow()
})
it.each([
  { status: 'passed', report: { stages: ['storyboard', 'canvas', 'list', 'restart'] } },
  { commit: '--output=bad', status: 'passed', report: { stages: ['storyboard', 'canvas', 'list', 'restart'] } },
  { status: 'failed', report: { stages: ['storyboard', 'canvas', 'list', 'restart'] } },
  { status: 'passed', report: { stages: ['storyboard'] } },
])('paid receipt rejects missing provenance or incomplete rehearsal %#', receipt => {
  const f = fixture(); expect(() => f.validate(receipt)).toThrow()
})
it('the old IPC-only product cannot pass the updated repair markers', () => {
  const f = fixture(); f.write('dist/main.js', 'nomi:tasks:canvas-unknown-runs')
  expect(() => assertPaidBuildReady(f.root, { markers: LOCK_EXIT_BUILD_MARKERS, verify: () => {} })).toThrow(/标记/)
  f.write('dist/main.js', LOCK_EXIT_BUILD_MARKERS.join('\n'))
  expect(() => assertPaidBuildReady(f.root, { markers: LOCK_EXIT_BUILD_MARKERS, verify: () => {} })).not.toThrow()
})
