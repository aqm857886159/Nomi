import { describe, expect, it } from 'vitest'
import { asGenerationProposalArgs, asSemanticGenerationProposalArgs, isGenerationProposalTool, proposalDecisionPayload, updateSemanticGenerationField, updateSemanticGenerationParameters, updateSemanticGenerationShot, updateGenerationProposalParams } from './generationProposalEditing'

describe('generation proposal editing', () => {
  const args = {
    operation: 'create_canvas_nodes',
    summary: 'create one shot',
    nodes: [{ clientId: 'shot-1', kind: 'video', title: 'Shot 1', prompt: 'cat', modelKey: 'video-a', vendor: 'kie', modelVendor: 'kie', modeId: 't2v', variantId: 'standard', params: { duration: 5, resolution: '720p' } }],
  }

  it('recognizes only a valid canvas generation proposal', () => {
    expect(isGenerationProposalTool('create_canvas_nodes', args)).toBe(true)
    expect(isGenerationProposalTool('set_node_prompt', args)).toBe(false)
    expect(asGenerationProposalArgs({ nodes: [] })).toBeNull()
    expect(isGenerationProposalTool('nomi_operation_create', { prompt: 'cat', taskKind: 'text_to_image', parameters: { size: '1:1' } })).toBe(true)
    expect(isGenerationProposalTool('nomi_preview_execution', { operationId: 'op-1' })).toBe(false)
  })

  it('edits semantic prompt/model/parameters and preserves Host metadata', () => {
    const original = { operationId: 'op-1', prompt: 'cat', providerId: 'apimart', modelId: 'image-a', parameters: { size: '1:1' } }
    const parsed = asSemanticGenerationProposalArgs(original)!
    const next = updateSemanticGenerationParameters(
      updateSemanticGenerationField(updateSemanticGenerationField(parsed, 'prompt', 'small cat avatar'), 'modelId', 'image-b'),
      { size: '1024x1024', quality: 'standard' },
    )
    expect(next).toMatchObject({ operationId: 'op-1', prompt: 'small cat avatar', modelId: 'image-b', parameters: { size: '1024x1024', quality: 'standard' } })
    expect(original).toEqual({ operationId: 'op-1', prompt: 'cat', providerId: 'apimart', modelId: 'image-a', parameters: { size: '1:1' } })
  })

  it('edits nested patch and multi-shot values through the same semantic payload', () => {
    const parsed = asSemanticGenerationProposalArgs({ operationId: 'op-2', patch: { prompt: 'old', parameters: { duration: 5 } }, shots: [{ shotId: 'shot-1', prompt: 'old shot', parameters: { duration: 5 } }] })!
    const patched = updateSemanticGenerationParameters(updateSemanticGenerationField(parsed, 'prompt', 'new'), { duration: 8 })
    const next = updateSemanticGenerationShot(patched, 0, { prompt: 'new shot', parameters: { duration: 9 } })
    expect(next.patch).toMatchObject({ prompt: 'new', parameters: { duration: 8 } })
    expect(next.shots?.[0]).toMatchObject({ prompt: 'new shot', parameters: { duration: 9 } })
  })

  it('updates nested generation params without mutating the proposal', () => {
    const parsed = asGenerationProposalArgs(args)
    expect(parsed).not.toBeNull()
    const next = updateGenerationProposalParams(parsed!, 0, { duration: 8, resolution: '1080p' })
    expect(next.nodes[0].params).toEqual({ duration: 8, resolution: '1080p' })
    expect(args.nodes[0].params).toEqual({ duration: 5, resolution: '720p' })
  })

  it('keeps the selected vendor and variant in the editable canvas proposal', () => {
    const parsed = asGenerationProposalArgs(args)
    expect(parsed?.nodes[0]).toMatchObject({ vendor: 'kie', modelVendor: 'kie', variantId: 'standard' })
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
