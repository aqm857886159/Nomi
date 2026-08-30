import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowsDir = path.join(repoRoot, '.github/workflows')
const signaturePath = path.join(repoRoot, 'signatures/cla.json')
const claWorkflowPath = path.join(workflowsDir, 'cla.yml')
const claDocument = fs.readFileSync(path.join(repoRoot, 'CLA.md'), 'utf8')
const packageManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))

test('AGPL-only policy has no contributor-assistant workflow or main-branch signature ledger', () => {
  assert.equal(fs.existsSync(claWorkflowPath), false, 'CLA workflow must be removed')
  assert.equal(fs.existsSync(signaturePath), false, 'main must not retain a signature ledger copy')
  const workflowFiles = fs.readdirSync(workflowsDir).filter((name) => /\.ya?ml$/i.test(name))
  for (const name of workflowFiles) {
    const workflow = load(fs.readFileSync(path.join(workflowsDir, name), 'utf8'))
    const serialized = JSON.stringify(workflow)
    assert.doesNotMatch(serialized, /contributor-assistant\/github-action@/i, `${name} must not run CLA automation`)
  }
})

test('AGPL-only and no-signature rule is visible at the contributor boundary', () => {
  assert.match(claDocument, /不要求.*CLA/u)
  assert.match(claDocument, /不需要.*签/u)
  assert.match(claDocument, /AGPL-3\.0-only/)
  assert.match(claDocument, /no extra signature/i)
  assert.equal(packageManifest.license, 'AGPL-3.0-only')
})
