import { describe, expect, it, vi } from 'vitest'

import {
  buildProductionDeepLink,
  resolveProductionDeepLink,
} from './productionDeepLink'
import type { ProductionRun } from './productionRunTypes'

const run = {
  projectId: 'project-1',
  runId: 'run-1',
  artifacts: [{ artifactId: 'artifact-1' }],
} as ProductionRun

describe('production deep links', () => {
  it('builds and resolves a project/run/artifact link only after repository verification', () => {
    const read = vi.fn(() => run)
    const url = buildProductionDeepLink('project-1', 'run-1', 'artifact-1')
    expect(url).toBe('nomi://project/project-1/run/run-1?artifact=artifact-1')
    expect(resolveProductionDeepLink(url, { read } as never)).toEqual({
      projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-1',
    })
    expect(read).toHaveBeenCalledWith('project-1', 'run-1')
  })

  it.each([
    'nomi://project/%2e%2e/run/run-1',
    'nomi://project/project-1/run/%2e%2e',
    'nomi://project/project-1/run/run-1?artifact=%2e%2e',
    'nomi://project/project-1/run/run-1?artifact=artifact-1&path=/tmp/a',
    'file:///Users/me/private.mp4',
  ])('rejects malformed or path-like deep link %s', (url) => {
    expect(() => resolveProductionDeepLink(url, { read: () => run } as never)).toThrow(/link|invalid|unsupported/i)
  })

  it('rejects a forged project/run pair and wrong-run artifact', () => {
    expect(() => resolveProductionDeepLink(
      'nomi://project/project-2/run/run-1',
      { read: () => null } as never,
    )).toThrow(/not found/i)
    expect(() => resolveProductionDeepLink(
      'nomi://project/project-1/run/run-1?artifact=artifact-2',
      { read: () => run } as never,
    )).toThrow(/artifact/i)
  })
})
