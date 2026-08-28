import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { validateCapabilityMatrix } from './test-capability-matrix.mjs'

const root = path.resolve(import.meta.dirname, '..')
const matrix = JSON.parse(fs.readFileSync(path.join(root, 'tests/system/capabilities.json'), 'utf8'))

describe('capability matrix', () => {
  test('contains unique capability ids', () => {
    const result = validateCapabilityMatrix(matrix, { root })
    expect(result.errors.filter((error) => error.includes('duplicate id'))).toEqual([])
  })

  test('high-risk capabilities declare all four test dimensions', () => {
    const result = validateCapabilityMatrix(matrix, { root })
    expect(result.errors.filter((error) => error.includes('dimension'))).toEqual([])
  })

  test('referenced test files exist or have an honest unsupported reason', () => {
    const result = validateCapabilityMatrix(matrix, { root })
    expect(result.errors.filter((error) => error.includes('missing test file'))).toEqual([])
  })

  test('registers the B6 project-agent canvas spine and both real journeys', () => {
    expect(matrix.find((capability) => capability.id === 'project-agent.canvas-read')).toMatchObject({
      group: 'project-agent',
      risk: 'high',
      journeys: ['project-agent-mcp', 'project-agent-surface'],
    })
  })

  test('rejects journey labels that do not resolve to an eval journey or executable system stage', () => {
    const result = validateCapabilityMatrix(
      [
        {
          id: 'demo',
          group: 'demo',
          risk: 'low',
          normal: [],
          boundary: [],
          failure: [],
          persistence: [],
          journeys: ['descriptive-label-only'],
          unsupportedReason: 'fixture',
        },
      ],
      { root },
    )

    expect(result.errors).toContain('demo: unknown journey descriptive-label-only')
  })

  test('reports uncovered dimensions without treating them as schema errors', () => {
    const result = validateCapabilityMatrix(
      [
        {
          id: 'demo',
          group: 'demo',
          risk: 'high',
          normal: [],
          boundary: [],
          failure: [],
          persistence: [],
          journeys: [],
          unsupportedReason: null,
        },
      ],
      { root },
    )
    expect(result.errors).toEqual([])
    expect(result.uncovered).toEqual(['demo:normal', 'demo:boundary', 'demo:failure', 'demo:persistence'])
  })
})
