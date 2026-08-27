import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const checker = fileURLToPath(new URL('./check-vocabularies.mjs', import.meta.url))

export const repositoryRoot = path.resolve(path.dirname(checker), '..')
export const repositoryBaselinePath = path.join(repositoryRoot, 'scripts/vocabularies-baseline.json')

export function makeFixture(files, baseline = { debtCap: 0, registered: [], debt: [] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-vocabularies-'))
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, contents)
  }
  const baselinePath = path.join(root, 'baseline.json')
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
  return { root, baselinePath }
}

export function runChecker(fixture, ...args) {
  const maybeOptions = args.at(-1)
  const options = maybeOptions && typeof maybeOptions === 'object' ? args.pop() : {}
  const environment = { ...process.env }
  delete environment.VOCAB_BASE_REF
  Object.assign(environment, options.env)

  return spawnSync(
    process.execPath,
    [checker, '--repo-root', fixture.root, '--baseline', fixture.baselinePath, ...args],
    { encoding: 'utf8', env: environment },
  )
}

export function cleanup(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true })
}

export function writeJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`)
}

export function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  return result.stdout.trim()
}

export function vocabularyEntry(site, members, reason = 'Legacy lifecycle owner scheduled for convergence.') {
  return { site, members, reason }
}
