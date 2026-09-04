import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/design/agent-ui-spec.generated.json'), 'utf8'))

test('generated Agent UI rules carry runtime contract metadata', () => {
  assert.deepEqual(spec.viewport, { width: 1440, height: 900, deviceScaleFactor: 1 })
  assert.ok(spec.elements.length > 0)
  for (const rule of spec.elements) {
    assert.equal(typeof rule.sourceLocator, 'string', `${rule.anchor} needs a source locator`)
    assert.equal(typeof rule.tolerance, 'object', `${rule.anchor} needs a tolerance`)
    assert.equal(typeof rule.state, 'string', `${rule.anchor} needs a state`)
    assert.equal(typeof rule.sourceLibrary, 'string', `${rule.anchor} needs source library`)
    assert.equal(typeof rule.adaptationRule, 'string', `${rule.anchor} needs adaptation rule`)
    assert.ok(['P0', 'P1', 'P2'].includes(rule.severity), `${rule.anchor} needs severity`)
  }
  for (const rule of spec.runtimeRules) {
    assert.equal(typeof rule.sourceLocator, 'string', `${rule.id} needs a source locator`)
    assert.equal(typeof rule.tolerance, 'object', `${rule.id} needs a tolerance`)
    assert.equal(typeof rule.state, 'string', `${rule.id} needs a state`)
    assert.equal(typeof rule.sourceLibrary, 'string', `${rule.id} needs source library`)
    assert.equal(typeof rule.adaptationRule, 'string', `${rule.id} needs adaptation rule`)
    assert.ok(['P0', 'P1', 'P2'].includes(rule.severity), `${rule.id} needs severity`)
  }
})

test('approved P0 queue contract names the runtime fold-row hook', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'src/workbench/ai/ProjectAgentResidentShell.tsx'), 'utf8')
  assert.match(shell, /data-queue-more-row/)
  assert.doesNotMatch(shell, /data-agent-queue-more=/)
})

test('approved surfaces expose a single resident dock target', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'src/workbench/WorkbenchShell.tsx'), 'utf8')
  const storyboard = fs.readFileSync(path.join(ROOT, 'src/workbench/creation/storyboard/StoryboardWorkspace.tsx'), 'utf8')
  assert.match(shell, /agentDockRefs\.storyboard/)
  assert.match(storyboard, /agentDockRef/)
})

test('library patterns are adapted to Nomi infrastructure without a second visual stack', () => {
  const resident = fs.readFileSync(path.join(ROOT, 'src/workbench/ai/ProjectAgentResidentShell.tsx'), 'utf8')
  const exceptionStates = fs.readFileSync(path.join(ROOT, 'src/workbench/ai/resident/ResidentExceptionStates.tsx'), 'utf8')
  assert.match(resident, /@tabler\/icons-react/)
  assert.match(exceptionStates, /@tabler\/icons-react/)
  assert.match(exceptionStates, /border-nomi-line|bg-nomi-paper|text-nomi-ink/)
  assert.doesNotMatch(`${resident}\n${exceptionStates}`, /lucide-react|react-icons/)
})

test('committed example report preserves the three audited red cases', () => {
  const report = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/ux/fixtures/agent-ui-mismatch.example.json'), 'utf8'))
  assert.deepEqual(report.viewport, { width: 1440, height: 900, deviceScaleFactor: 1 })
  assert.deepEqual(report.mismatches.map((item) => item.ruleId), [
    'P0-PINNED-RESULT-CARD',
    'P1-STORYBOARD-AGENT-DOCK',
    'P0-QUEUE-MORE-ROW',
  ])
  for (const item of report.mismatches) {
    assert.equal(typeof item.sourceLocator, 'string')
    assert.ok('expected' in item && 'actual' in item && 'delta' in item)
  }
})
