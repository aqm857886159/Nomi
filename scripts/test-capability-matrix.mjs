import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STAGES } from '../tests/system/profiles.mjs'

const DIMENSIONS = ['normal', 'boundary', 'failure', 'persistence']

function journeyIsExecutable(root, journeyId) {
  return Object.hasOwn(STAGES, journeyId) || fs.existsSync(path.join(root, 'evals/journeys', `${journeyId}.mjs`))
}

export function validateCapabilityMatrix(matrix, { root }) {
  const errors = []
  const uncovered = []
  const seen = new Set()
  if (!Array.isArray(matrix)) return { errors: ['matrix must be an array'], uncovered }

  for (const capability of matrix) {
    if (!capability?.id) {
      errors.push('capability missing id')
      continue
    }
    if (seen.has(capability.id)) errors.push(`duplicate id: ${capability.id}`)
    seen.add(capability.id)
    if (!capability.group) errors.push(`${capability.id}: missing group`)
    for (const dimension of DIMENSIONS) {
      if (!Array.isArray(capability[dimension])) {
        errors.push(`${capability.id}: missing dimension ${dimension}`)
        continue
      }
      if (capability[dimension].length === 0 && !capability.unsupportedReason)
        uncovered.push(`${capability.id}:${dimension}`)
      for (const file of capability[dimension]) {
        if (!fs.existsSync(path.join(root, file)) && !capability.unsupportedReason) {
          errors.push(`${capability.id}: missing test file ${file}`)
        }
      }
    }
    if (!Array.isArray(capability.journeys)) {
      errors.push(`${capability.id}: journeys must be an array`)
    } else {
      for (const journeyId of capability.journeys) {
        if (typeof journeyId !== 'string' || !journeyIsExecutable(root, journeyId)) {
          errors.push(`${capability.id}: unknown journey ${String(journeyId)}`)
        }
      }
    }
  }
  return { errors, uncovered }
}

export function renderCapabilityMatrix(matrix, result) {
  const groups = Map.groupBy(matrix, (capability) => capability.group)
  const lines = [
    '# Nomi Product Capability Test Matrix',
    '',
    `Capabilities: ${matrix.length} · uncovered dimensions: ${result.uncovered.length}`,
    '',
  ]
  for (const [group, capabilities] of groups) {
    lines.push(
      `## ${group}`,
      '',
      '| Capability | Risk | Normal | Boundary | Failure | Persistence | Journeys |',
      '|---|---|---:|---:|---:|---:|---|',
    )
    for (const capability of capabilities) {
      lines.push(
        `| ${capability.id} | ${capability.risk} | ${capability.normal.length} | ${capability.boundary.length} | ${capability.failure.length} | ${capability.persistence.length} | ${capability.journeys.join(', ') || '—'} |`,
      )
    }
    lines.push('')
  }
  if (result.uncovered.length)
    lines.push('## Uncovered dimensions', '', ...result.uncovered.map((item) => `- ${item}`), '')
  return `${lines.join('\n')}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, '..')
  const matrixPath = path.join(root, 'tests/system/capabilities.json')
  const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'))
  const result = validateCapabilityMatrix(matrix, { root })
  if (process.argv.includes('--write')) {
    const out = path.join(root, 'docs/testing/capability-matrix.md')
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, renderCapabilityMatrix(matrix, result))
    console.log(`wrote ${path.relative(root, out)}`)
  }
  console.log(`capabilities=${matrix.length} errors=${result.errors.length} uncovered=${result.uncovered.length}`)
  for (const error of result.errors) console.error(`ERROR ${error}`)
  for (const gap of result.uncovered) console.log(`UNCOVERED ${gap}`)
  process.exit(result.errors.length ? 1 : 0)
}
