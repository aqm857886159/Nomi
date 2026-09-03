import { describe, expect, it } from 'vitest'
import { residentArgsForSelection, residentCandidates, residentPlanShots, residentVisibleCandidates } from './residentExceptionProjections'

describe('resident exception projections', () => {
  it('keeps the first three candidates compact and reveals the second row on expand', () => {
    const candidates = residentCandidates({ candidates: [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id: `candidate-${id}`, title: `Version ${id}` })) })

    expect(residentVisibleCandidates(candidates, false).map((candidate) => candidate.id)).toEqual(['candidate-1', 'candidate-2', 'candidate-3'])
    expect(residentVisibleCandidates(candidates, true).map((candidate) => candidate.id)).toEqual(['candidate-1', 'candidate-2', 'candidate-3', 'candidate-4', 'candidate-5', 'candidate-6'])
  })

  it('projects every planned shot and selection without dropping provider metadata', () => {
    const args = { operation: 'create_canvas_nodes', nodes: [{ clientId: 'shot-1', title: 'Opening', prompt: 'Wide shot' }, { clientId: 'shot-2', title: 'Close', prompt: 'Close shot' }], providerId: 'provider-a' }
    expect(residentPlanShots(args)).toEqual([
      { id: 'shot-1', title: 'Opening', description: 'Wide shot' },
      { id: 'shot-2', title: 'Close', description: 'Close shot' },
    ])
    expect(residentArgsForSelection(args, ['shot-2'])).toMatchObject({ providerId: 'provider-a', nodes: [{ clientId: 'shot-2' }] })
  })
})
