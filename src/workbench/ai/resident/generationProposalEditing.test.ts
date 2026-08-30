import { describe, expect, it } from 'vitest'
import { asGenerationProposalArgs, isGenerationProposalTool, proposalDecisionPayload, updateGenerationProposalParams } from './generationProposalEditing'

describe('generation proposal editing', () => {
  const args = {
    operation: 'create_canvas_nodes',
    summary: 'create one shot',
    nodes: [{ clientId: 'shot-1', kind: 'video', title: 'Shot 1', prompt: 'cat', modelKey: 'video-a', modeId: 't2v', params: { duration: 5, resolution: '720p' } }],
  }

  it('recognizes only a valid canvas generation proposal', () => {
    expect(isGenerationProposalTool('create_canvas_nodes', args)).toBe(true)
    expect(isGenerationProposalTool('set_node_prompt', args)).toBe(false)
    expect(asGenerationProposalArgs({ nodes: [] })).toBeNull()
  })

  it('updates nested generation params without mutating the proposal', () => {
    const parsed = asGenerationProposalArgs(args)
    expect(parsed).not.toBeNull()
    const next = updateGenerationProposalParams(parsed!, 0, { duration: 8, resolution: '1080p' })
    expect(next.nodes[0].params).toEqual({ duration: 8, resolution: '1080p' })
    expect(args.nodes[0].params).toEqual({ duration: 5, resolution: '720p' })
  })

  it('returns full effective args and a top-level audit delta', () => {
    const edited = updateGenerationProposalParams(asGenerationProposalArgs(args)!, 0, { duration: 8 })
    expect(proposalDecisionPayload(args, edited)).toEqual({
      effectiveArgs: edited,
      overridesDelta: { nodes: edited.nodes },
    })
    expect(proposalDecisionPayload(args, args)).toEqual({})
  })
})
