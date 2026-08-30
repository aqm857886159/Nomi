import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import test, { afterEach } from 'node:test'
import {
  buildFocusedCommands,
  changedFiles,
  isNodeTestFile,
  isVitestFile,
  selectFocusedTargets,
} from './test-focused.mjs'

const temporaryRoots = []

function makeProject() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-focused-'))
  temporaryRoots.push(projectRoot)
  return projectRoot
}

function write(projectRoot, relative, contents = '') {
  const target = path.join(projectRoot, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, contents)
}

afterEach(() => {
  for (const projectRoot of temporaryRoots.splice(0)) {
    fs.rmSync(projectRoot, { recursive: true, force: true })
  }
})

test('classifies Vitest and Node test naming without overlap', () => {
  assert.equal(isVitestFile('electron/foo.test.ts'), true)
  assert.equal(isVitestFile('scripts/check-foo.node-test.mjs'), false)
  assert.equal(isNodeTestFile('scripts/check-foo.node-test.mjs'), true)
  assert.equal(isNodeTestFile('electron/foo.test.ts'), false)
})

test('selects changed tests and sibling tests without scanning the repository', () => {
  const projectRoot = makeProject()
  write(projectRoot, 'src/widget.ts')
  write(projectRoot, 'src/other.ts')
  write(projectRoot, 'src/widget.test.ts')
  write(projectRoot, 'scripts/check-quality.mjs')
  write(projectRoot, 'scripts/check-quality.node-test.mjs')

  const targets = selectFocusedTargets(
    ['src/widget.ts', 'src/other.ts', 'scripts/check-quality.mjs', 'README.md'],
    projectRoot,
  )

  assert.deepEqual(targets.vitest, ['src/widget.test.ts'])
  assert.deepEqual(targets.related, ['src/other.ts'])
  assert.deepEqual(targets.node, ['scripts/check-quality.node-test.mjs'])
})

test('changed Vitest tests are run directly and docs-only changes have no targets', () => {
  assert.deepEqual(selectFocusedTargets(['electron/foo.test.mjs']).vitest, ['electron/foo.test.mjs'])
  assert.deepEqual(selectFocusedTargets(['docs/README.md']), { vitest: [], related: [], node: [] })
})

test('keeps direct and related Vitest invocations when a change set needs both', () => {
  const projectRoot = makeProject()
  write(projectRoot, 'src/without-sibling.ts')
  const targets = selectFocusedTargets(['electron/direct.test.ts', 'src/without-sibling.ts'], projectRoot)
  const commands = buildFocusedCommands(targets, 'linux')

  assert.deepEqual(commands, [
    {
      label: 'focused Vitest',
      command: 'pnpm',
      args: ['exec', 'vitest', 'run', 'electron/direct.test.ts'],
    },
    {
      label: 'focused related Vitest',
      command: 'pnpm',
      args: ['exec', 'vitest', 'related', '--run', '--passWithNoTests', 'src/without-sibling.ts'],
    },
  ])
  assert.equal(
    commands.some(({ args }) => args[0] === 'run' && args[1] === 'test'),
    false,
  )
})

test('reads the requested Git base and head instead of relying on ambient variables', () => {
  const projectRoot = makeProject()
  execFileSync('git', ['init', '--quiet'], { cwd: projectRoot })
  write(projectRoot, 'src/widget.ts', 'export const value = 1\n')
  execFileSync('git', ['add', 'src/widget.ts'], { cwd: projectRoot })
  execFileSync(
    'git',
    ['-c', 'user.name=Nomi Test', '-c', 'user.email=test@nomi.invalid', 'commit', '--quiet', '-m', 'base'],
    {
      cwd: projectRoot,
    },
  )
  write(projectRoot, 'src/widget.ts', 'export const value = 2\n')
  execFileSync('git', ['add', 'src/widget.ts'], { cwd: projectRoot })
  execFileSync(
    'git',
    ['-c', 'user.name=Nomi Test', '-c', 'user.email=test@nomi.invalid', 'commit', '--quiet', '-m', 'head'],
    {
      cwd: projectRoot,
    },
  )

  assert.deepEqual(changedFiles({ cwd: projectRoot, base: 'HEAD~1', head: 'HEAD' }), ['src/widget.ts'])
})
