import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_LANE_PROJECTION } from './lane/laneClient'

const deps = vi.hoisted(() => ({ singleShot: vi.fn(), abort: vi.fn() }))
vi.mock('./lane/laneClient', async (load) => ({
  ...await load<typeof import('./lane/laneClient')>(),
  laneClient: { singleShot: deps.singleShot, abortSingleShot: deps.abort },
}))
import { runSingleShotAgent } from './agentLoopMode'

const request = { featureKey: 'directions:p1', prompt: 'hi', displayPrompt: 'plan', projectId: 'p1', skillKey: 'direction' }
beforeEach(() => {
  vi.clearAllMocks()
  deps.singleShot.mockResolvedValue({ ok: true, singleShot: { ...EMPTY_LANE_PROJECTION, parts: [
    { kind: 'assistant-text', sequence: 1, entrySeq: 2, contentIndex: 0, text: 'result', streaming: false },
  ] } })
})

describe('single-shot requests', () => {
  it('uses the isolated lane command without enqueuing on the user conversation', async () => {
    const response = await runSingleShotAgent(request)
    expect(deps.singleShot).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'hi', projectId: 'p1', featureKey: 'directions:p1',
      context: expect.objectContaining({ skillKey: 'direction', approvalPolicy: { mode: 'step', spend: 'confirm' } }),
    }))
    expect(response).toMatchObject({ status: 'finished', text: 'result', toolCalls: [] })
  })

  it('preserves asset claims instead of accepting display URLs as authority', async () => {
    await runSingleShotAgent({ ...request,
      attachments: [{ url: 'nomi-local://frame', contentType: 'image/png', fileName: 'frame.png', kind: 'image' }],
      attachmentClaims: [{ assetId: 'frame', version: 1 }],
    })
    expect(deps.singleShot.mock.calls[0][0].context.attachments).toEqual([{ assetId: 'frame', version: 1 }])
    expect(deps.singleShot.mock.calls[0][0]).not.toHaveProperty('attachments')
  })

  it('does not turn a feature attribution into a requested installed skill', async () => {
    const { skillKey: _skill, ...featureOnly } = request
    await runSingleShotAgent(featureOnly)
    expect(deps.singleShot.mock.calls[0][0].context).not.toHaveProperty('skillKey')
  })

  it('preserves the main rejection for an explicitly requested missing skill', async () => {
    deps.singleShot.mockResolvedValue({ ok: false, code: 'agent_skill_unavailable', diagnostic: 'agent_skill_unavailable' })
    await expect(runSingleShotAgent(request)).rejects.toThrow('agent_skill_unavailable')
    expect(deps.singleShot).toHaveBeenCalledOnce()
  })

  it('rejects an explicit attachment that has no main-resolvable asset claim', async () => {
    await expect(runSingleShotAgent({ ...request, attachments: [
      { url: 'nomi-local://frame', contentType: 'image/png', fileName: 'frame.png', kind: 'image' },
    ] })).rejects.toThrow('agent_attachment_claim_required')
    expect(deps.singleShot).not.toHaveBeenCalled()
  })

  it('does not return a successful empty plan when the provider failed', async () => {
    deps.singleShot.mockResolvedValue({ ok: true, singleShot: { ...EMPTY_LANE_PROJECTION, parts: [
      { kind: 'error', sequence: 1, entrySeq: 2, contentIndex: 0, text: 'provider failed' },
    ] } })
    await expect(runSingleShotAgent(request)).rejects.toThrow('provider failed')
  })
})
