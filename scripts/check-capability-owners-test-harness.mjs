import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalEntries, canonicalFiles } from './check-capability-owners-fixtures.mjs'

const checker = fileURLToPath(new URL('./check-capability-owners.mjs', import.meta.url))

export function makeFixture(files = canonicalFiles, entries = canonicalEntries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-capability-owners-'))
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, contents)
  }
  const baselinePath = path.join(root, 'scripts/capability-owners-baseline.json')
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true })
  fs.writeFileSync(baselinePath, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`)
  return { root, baselinePath }
}

export function runChecker(fixture, ...args) {
  return spawnSync(
    process.execPath,
    [checker, '--repo-root', fixture.root, '--baseline', fixture.baselinePath, ...args],
    { encoding: 'utf8' },
  )
}

export function cleanup(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true })
}

export function withFile(relative, contents) {
  return { ...canonicalFiles, [relative]: contents }
}

export function expectRejected(files, diagnostic, entries = canonicalEntries, ...args) {
  const fixture = makeFixture(files, entries)
  try {
    const result = runChecker(fixture, ...args)
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stderr, diagnostic)
  } finally {
    cleanup(fixture)
  }
}

export function replaceRequired(source, search, replacement, label = 'fixture') {
  assert.equal(source.split(search).length, 2, `${label} replacement must match exactly once`)
  return source.replace(search, replacement)
}

export function replaceInFunction(source, name, search, replacement) {
  const start = source.indexOf(`export function ${name}`)
  assert.notEqual(start, -1, `missing fixture function ${name}`)
  const next = source.indexOf('\n    export function ', start + 1)
  const end = next === -1 ? source.length : next
  const body = source.slice(start, end)
  const replaced = replaceRequired(body, search, replacement, `fixture function ${name}`)
  return `${source.slice(0, start)}${replaced}${source.slice(end)}`
}
