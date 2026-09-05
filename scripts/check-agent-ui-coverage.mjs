#!/usr/bin/env node
/**
 * Agent UI design -> code coverage gate.
 *
 * The generated spec intentionally keeps stateful/hover-only anchors out of
 * its measured geometry list. This matrix makes each such omission explicit,
 * so a newly uncovered anchor cannot silently disappear from the walk.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const specPath = path.join(root, 'docs/design/agent-ui-spec.generated.json')
const matrixPath = path.join(root, 'tests/ux/fixtures/agent-ui-coverage-matrix.json')
const walkPath = path.join(root, 'tests/ux/agent-ui-conformance.walk.mjs')

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const spec = readJson(specPath)
const matrix = readJson(matrixPath)
const walkSource = fs.readFileSync(walkPath, 'utf8')
const errors = []
const fail = (message) => errors.push(message)
const sorted = (items) => [...items].sort()
const sameSet = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))

if (matrix.version !== 1) fail(`coverage matrix version must be 1, got ${matrix.version}`)
if (matrix.generatedSpec !== 'docs/design/agent-ui-spec.generated.json') {
  fail(`coverage matrix must point at generated spec, got ${matrix.generatedSpec}`)
}

const uncovered = spec.summary?.uncoveredSpecAnchors ?? []
const entries = Object.entries(matrix.anchors ?? {})
const entryAnchors = entries.map(([anchor]) => anchor)
if (!sameSet(entryAnchors, uncovered)) {
  const missing = uncovered.filter((anchor) => !entryAnchors.includes(anchor))
  const stale = entryAnchors.filter((anchor) => !uncovered.includes(anchor))
  if (missing.length) fail(`uncovered anchors missing from matrix: ${missing.join(', ')}`)
  if (stale.length) fail(`matrix contains anchors no longer uncovered: ${stale.join(', ')}`)
}

const measured = (spec.elements ?? []).map((rule) => rule.anchor)
const overlap = entryAnchors.filter((anchor) => measured.includes(anchor))
if (overlap.length) fail(`anchor cannot be both measured and uncovered: ${overlap.join(', ')}`)

const allowedStatuses = new Set([
  'scene-root',
  'runtime-present-unmeasured',
  'runtime-present-blocked',
  'missing-runtime-anchor',
  'selector-drift',
])
const srcFiles = new Map()
const readSource = (relativePath) => {
  if (!srcFiles.has(relativePath)) {
    const absolute = path.join(root, relativePath)
    srcFiles.set(relativePath, fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : null)
  }
  return srcFiles.get(relativePath)
}

for (const [anchor, entry] of entries) {
  if (!allowedStatuses.has(entry.status)) fail(`${anchor}: unknown status ${entry.status}`)
  if (!Array.isArray(entry.specRefs) || entry.specRefs.length === 0) fail(`${anchor}: specRefs must name at least one contract row`)
  if (typeof entry.state !== 'string' || !entry.state) fail(`${anchor}: state is required`)

  if (entry.status === 'missing-runtime-anchor') {
    if (entry.source !== null) fail(`${anchor}: missing-runtime-anchor must have source=null`)
    const srcText = [...(function* collect(dir) {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, item.name)
        if (item.isDirectory()) yield* collect(full)
        else if (/\.(tsx?|css)$/.test(item.name)) yield fs.readFileSync(full, 'utf8')
      }
    })(path.join(root, 'src'))].join('\n')
    if (srcText.includes(anchor)) fail(`${anchor}: marked missing but exact selector exists in src`)
    continue
  }

  if (!entry.source || typeof entry.source.path !== 'string' || typeof entry.source.selector !== 'string') {
    fail(`${anchor}: ${entry.status} requires source.path and source.selector`)
    continue
  }
  const source = readSource(entry.source.path)
  if (source === null) {
    fail(`${anchor}: source file missing: ${entry.source.path}`)
    continue
  }
  if (!source.includes(entry.source.selector)) {
    fail(`${anchor}: source selector ${entry.source.selector} not found in ${entry.source.path}`)
  }
  if (entry.status === 'selector-drift' && entry.contractSelector !== anchor) {
    fail(`${anchor}: selector-drift must preserve contractSelector=${anchor}`)
  }
  if (entry.status !== 'selector-drift' && entry.source.selector !== anchor) {
    fail(`${anchor}: source selector must match contract anchor for ${entry.status}`)
  }
}

const runtimeRuleIds = new Set((spec.runtimeRules ?? []).map((rule) => rule.id))
for (const required of ['P0-QUEUE-MORE-ROW', 'P0-PINNED-RESULT-CARD', 'P1-STORYBOARD-AGENT-DOCK']) {
  if (!runtimeRuleIds.has(required)) fail(`runtime contract missing required rule ${required}`)
}
// The app walk may preserve stateNotReached from generated metadata, but it
// must never overwrite every rule at the call site. That turns real red rules
// into an unconditional state-not-reached report.
if (/stateNotReached\s*:\s*true/.test(walkSource)) {
  fail('conformance walk unconditionally forces runtimeRules.stateNotReached=true')
}

if (errors.length) {
  console.error(`✖ Agent UI coverage gate failed (${errors.length}):`)
  for (const error of errors) console.error(`  · ${error}`)
  process.exit(1)
}

const byStatus = entries.reduce((counts, [, entry]) => {
  counts[entry.status] = (counts[entry.status] ?? 0) + 1
  return counts
}, {})
console.log(`✅ Agent UI coverage gate passed: ${entryAnchors.length} explicit uncovered anchors; ${JSON.stringify(byStatus)}`)
