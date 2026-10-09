import fs from 'node:fs'
import { exemptionEvidenceGrowth, feelMode, feelSurfaceKey } from '../tests/ux/_feel-observer.mjs'
import { execFileSync } from 'node:child_process'

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8' }).trim()
for (const file of ['tests/ux/feel-baseline.json', 'tests/ux/feel-exemptions.json']) {
  const current = read(file)
  let previous
  const exists = execFileSync('git', ['ls-tree', '-z', '--name-only', base, '--', file], { encoding: 'utf8' }).trim()
  if (exists) previous = JSON.parse(execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8' }))
  const keys = new Set()
  for (const entry of current.entries) {
    const isBaseline = file.includes('baseline')
    const key = isBaseline ? feelSurfaceKey(entry) : `${entry.label}:${entry.rule || 'exemption'}`
    if (isBaseline && (!entry.journey || !entry.screenshotName || !entry.rule || feelMode(entry.journey) !== 'ratchet')) throw new Error(`Invalid ratchet surface: ${key}`)
    if (keys.has(key)) throw new Error(`Duplicate feel entry: ${key}`)
    keys.add(key)
    if (!entry.owner || (!isBaseline && !entry.label)) throw new Error(`Missing feel owner/label: ${key}`)
    if (file.includes('exemptions')) {
      if (!entry.reason || !entry.rule || !Array.isArray(entry.findings) || !entry.findings.length) {
        throw new Error(`Exemptions require a rule, reason and exact findings: ${key}`)
      }
      for (const finding of entry.findings) {
        if (!Array.isArray(finding.target) || !finding.target.length
          || !Array.isArray(finding.text) || finding.text.length !== finding.target.length
          || !Array.isArray(finding.fontSizes) || finding.fontSizes.length !== finding.target.length
          || !finding.fontSizes.every((size) => Number.isFinite(size) && size > 0)) {
          throw new Error(`Invalid exemption evidence: ${key}`)
        }
      }
    }
    if (file.includes('baseline') && (!Number.isInteger(entry.count) || entry.count < 0)) throw new Error(`Invalid count: ${key}`)
    if (previous) {
      const old = previous.entries.find((item) => isBaseline ? feelSurfaceKey(item) === key : item.label === entry.label && item.rule === entry.rule)
      if (!old || (entry.count ?? 1) > (old.count ?? 1)) throw new Error(`Feel ratchet may only decrease: ${key}`)
      if (file.includes('exemptions')) {
        if (exemptionEvidenceGrowth(old.findings, entry.findings).length) throw new Error(`Feel exemption evidence may only decrease: ${key}`)
      }
    }
  }
  if (previous && file.includes('baseline')) {
    for (const old of previous.entries) {
      if (!current.entries.some((entry) => feelSurfaceKey(entry) === feelSurfaceKey(old))) {
        throw new Error(`Keep the registered feel surface at count 0 instead of deleting it: ${old.label}:${old.rule}`)
      }
    }
  }
  // Initial reviewed evidence is permitted; subsequent merge-base entries can only shrink.
}
const scanner = fs.readFileSync('tests/ux/_feel.mjs', 'utf8')
if (/^import\s/m.test(scanner) || /data-testid|react-flow|nomi|agent-panel/i.test(scanner)) {
  throw new Error('Feel scanner must be independent of product imports/selectors')
}
const catalog = read('tests/ux/journeys/catalog.json')
for (const journey of catalog.journeys) {
  const experienceOnly = journey.experience === true && journey.runner === 'experience.walk.mjs'
    && Array.isArray(journey.steps) && journey.steps.length > 0
  if (!journey.id || !Array.isArray(journey.states) || (!journey.states.length && !experienceOnly)) throw new Error('Invalid feel journey')
  for (const state of journey.states) if (!state.id || !state.html || !state.owner) throw new Error('Invalid feel state')
}
console.log('Feel generic boundary and baseline/exemption ratchets passed')
