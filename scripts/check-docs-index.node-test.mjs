import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const planIndexPath = path.join(repoRoot, 'docs', 'plan', 'INDEX.md')
const planFilePath = path.join(repoRoot, 'docs', 'plan', '2026-09-04-cross-device-min-energy-redesign.md')
const planPath = '2026-09-04-cross-device-min-energy-redesign.md'

test('indexes the cross-device minimum-energy redesign plan', () => {
  const index = fs.readFileSync(planIndexPath, 'utf8')
  assert.ok(index.includes(`](${planPath})`), `docs/plan/INDEX.md must link ${planPath}`)
})

test('marks the cross-device minimum-energy redesign plan with a status', () => {
  const opening = fs.readFileSync(planFilePath, 'utf8').split(/\r?\n/).slice(0, 12).join('\n')
  assert.match(opening, /✅|🚧|⏳|🧊|📋|⛔|📎/, `${planPath} must declare a status in its opening 12 lines`)
})
