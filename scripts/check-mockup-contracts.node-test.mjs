import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureFiles = [
  path.join(root, 'docs/design/mockups/mockup-contracts-gate-fixture.md'),
  path.join(root, 'docs/design/mockups/contracts/mockup-contracts-gate-fixture.intent.mjs'),
  path.join(root, 'tests/ux/mockup-contracts-gate-fixture.walk.mjs'),
]

test('新验收合同没有 labScreen 时门岗必须红', () => {
  fs.writeFileSync(fixtureFiles[0], 'temporary fixture\n')
  fs.writeFileSync(fixtureFiles[1], `export default {
  mockup: 'docs/design/mockups/mockup-contracts-gate-fixture.md',
  mechanizes: { migratedAt: '2026-10-04' },
  surface: 'fixture',
  layer: 'intent',
}\n`)
  fs.writeFileSync(fixtureFiles[2], `import contract from '../../docs/design/mockups/contracts/mockup-contracts-gate-fixture.intent.mjs'\nvoid contract\n`)
  try {
    const result = spawnSync(process.execPath, ['scripts/check-mockup-contracts.mjs'], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}\n${result.stderr}`, /缺少 labScreen/)
  } finally {
    for (const file of fixtureFiles) fs.rmSync(file, { force: true })
  }
})

test('新 HTML 验收合同不能绕过 exploration 基线', () => {
  const files = [
    path.join(root, 'docs/design/mockups/mockup-contracts-html-fixture.html'),
    path.join(root, 'docs/design/mockups/contracts/mockup-contracts-html-fixture.intent.mjs'),
    path.join(root, 'tests/ux/mockup-contracts-html-fixture.walk.mjs'),
  ]
  fs.writeFileSync(files[0], '<html><body>temporary fixture</body></html>\n')
  fs.writeFileSync(files[1], `export default {
  mockup: 'docs/design/mockups/mockup-contracts-html-fixture.html',
  mechanizes: { migratedAt: '2026-10-04' },
  surface: 'fixture',
  layer: 'intent',
}\n`)
  fs.writeFileSync(files[2], `import contract from '../../docs/design/mockups/contracts/mockup-contracts-html-fixture.intent.mjs'\nvoid contract\n`)
  try {
    const result = spawnSync(process.execPath, ['scripts/check-mockup-contracts.mjs'], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}\n${result.stderr}`, /新 HTML 样张只能标 layer: 'exploration'/)
  } finally {
    for (const file of files) fs.rmSync(file, { force: true })
  }
})
