import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadNightlyExclusions, selectNightlyWalks } from './nightly-walk-selection.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('nightly exclusions are a reviewed B-category data registry', () => {
  const source = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests/ux/nightly-ci-exclusions.json'), 'utf8'))
  assert.equal(source.version, 1)
  assert.ok(source.exclusions.length > 0)
  const paths = source.exclusions.map((entry) => entry.path)
  assert.equal(new Set(paths).size, paths.length)
  for (const entry of source.exclusions) {
    assert.equal(entry.category, 'B')
    assert.match(entry.path, /^tests\/ux\/.*\.walk\.mjs$/)
    assert.ok(fs.existsSync(path.join(repoRoot, entry.path)), entry.path)
    assert.ok(entry.reason.length > 10, entry.path)
  }
})

test('nightly selection removes only registered exclusions and paid walks', () => {
  const excluded = [...loadNightlyExclusions().keys()]
  const files = [
    'tests/ux/z.walk.mjs',
    'tests/ux/agent-askback-real-model.walk.mjs',
    'tests/ux/paid.paid.mjs',
    'tests/ux/a.walk.mjs',
  ]
  assert.deepEqual(selectNightlyWalks(files), ['tests/ux/a.walk.mjs', 'tests/ux/z.walk.mjs'])
  assert.ok(excluded.includes('tests/ux/agent-askback-real-model.walk.mjs'))
})

test('the repository nightly inventory is reduced exactly by the B registry', () => {
  const source = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests/ux/nightly-ci-exclusions.json'), 'utf8'))
  const files = fs.readdirSync(path.join(repoRoot, 'tests/ux'))
    .map((file) => `tests/ux/${file}`)
  const allWalks = files.filter((file) => file.endsWith('.walk.mjs') && !file.endsWith('.paid.mjs'))
  const selected = selectNightlyWalks(files)
  assert.equal(selected.length, allWalks.length - source.exclusions.length)
  assert.equal(new Set(selected).size, selected.length)
})
