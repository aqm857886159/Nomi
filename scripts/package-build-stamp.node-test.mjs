import { makeTempDir } from './_test-temp.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { invalidateBuild, sourceIdentity, stampedBuild, verifyBuild } from './package-build-stamp.mjs'

const cli = fileURLToPath(new URL('./package-build-stamp.mjs', import.meta.url))
function fixture(t) {
  const root = makeTempDir('nomi-package-stamp-test-')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim()
  git('init')
  git('config', 'user.email', 'fixture@example.invalid')
  git('config', 'user.name', 'Fixture')
  fs.writeFileSync(path.join(root, '.gitignore'), 'dist/\ndist-electron/\n')
  fs.writeFileSync(path.join(root, 'source.txt'), 'initial')
  git('add', '.')
  git('commit', '-m', 'fixture')
  for (const output of ['dist', 'dist-electron']) fs.mkdirSync(path.join(root, output))
  return { root, git, build: () => stampedBuild(root, () => {}) }
}

test('correct stamps pass; stale renderer or electron stamp fails at CLI before packaging', t => {
  const { root, build } = fixture(t)
  build()
  assert.equal(spawnSync(process.execPath, [cli, 'verify'], { cwd: root }).status, 0)
  for (const output of ['dist', 'dist-electron']) {
    build()
    const stamp = path.join(root, output, 'build-stamp.json')
    const data = JSON.parse(fs.readFileSync(stamp))
    fs.writeFileSync(stamp, JSON.stringify({ ...data, head: '0'.repeat(40) }))
    const result = spawnSync(process.execPath, [cli, 'verify'], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /先 `pnpm build`/)
    console.log(`STALE ${output}: exit=${result.status} ${result.stderr.trim()}`)
  }
})

for (const change of ['head', 'staged', 'unstaged', 'untracked', 'missing', 'malformed', 'partial']) {
  test(`${change} change invalidates build`, t => {
    const { root, git, build } = fixture(t)
    build()
    if (change === 'head') git('commit', '--allow-empty', '-m', 'new HEAD')
    if (change === 'staged' || change === 'unstaged') {
      fs.writeFileSync(path.join(root, 'source.txt'), change)
      if (change === 'staged') git('add', '.')
    }
    if (change === 'untracked') fs.writeFileSync(path.join(root, 'new-source.txt'), 'new')
    if (change === 'missing') fs.unlinkSync(path.join(root, 'dist-electron/build-stamp.json'))
    if (change === 'malformed') fs.writeFileSync(path.join(root, 'dist/build-stamp.json'), '{')
    if (change === 'partial') invalidateBuild(root)
    assert.throws(() => verifyBuild(root), /pnpm build/)
  })
}

test('dirty content is hashed, actual index is preserved, later dirty edits invalidate', t => {
  const { root, git, build } = fixture(t)
  const index = git('write-tree')
  fs.writeFileSync(path.join(root, 'source.txt'), 'dirty one')
  build()
  assert.equal(verifyBuild(root).dirty, true)
  assert.equal(git('write-tree'), index)
  fs.writeFileSync(path.join(root, 'source.txt'), 'dirty two')
  assert.throws(() => verifyBuild(root), /pnpm build/)
  assert.notEqual(sourceIdentity(root).tree, index)
})

test('failed build and source edits during build leave no usable stamp', t => {
  const { root, build } = fixture(t)
  build()
  assert.throws(() => stampedBuild(root, () => { throw new Error('compiler failed') }), /compiler failed/)
  assert.throws(() => verifyBuild(root), /pnpm build/)
  assert.throws(() => stampedBuild(root, () => fs.writeFileSync(path.join(root, 'source.txt'), 'during build')), /构建期间/)
  assert.throws(() => verifyBuild(root), /pnpm build/)
})

test('both packaging scripts verify before electron-builder; partial builds invalidate', () => {
  const { scripts } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)))
  for (const name of ['dist', 'dist:mac:dir']) assert.match(scripts[name], /package-build-stamp\.mjs verify && .*electron-builder/)
  assert.match(scripts.build, /package-build-stamp\.mjs build/)
  assert.match(scripts['build:renderer'], /package-build-stamp\.mjs invalidate &&/)
  assert.match(fs.readFileSync(new URL('./build-electron.mjs', import.meta.url), 'utf8'), /invalidateBuild\(repoRoot\)/)
})
