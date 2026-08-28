import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mintSpendGrant: vi.fn(),
  runWorkbenchTaskByVendor: vi.fn(),
  runComfyCandidateTestByVendor: vi.fn(),
}))

vi.mock('../../../workbench/api/taskApi', () => ({
  mintSpendGrant: mocks.mintSpendGrant,
  runWorkbenchTaskByVendor: mocks.runWorkbenchTaskByVendor,
  runComfyCandidateTestByVendor: mocks.runComfyCandidateTestByVendor,
}))

import { runTestGeneration } from './runTestGeneration'

describe('ComfyUI workflow test bridge flow', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.mintSpendGrant.mockResolvedValue('grant-1')
    mocks.runComfyCandidateTestByVendor.mockResolvedValue({
      ok: true,
      revisionId: 'comfy-r1',
      active: { vendorKey: 'comfyui-local--candidate-r1', modelKey: 'workflow-1' },
    })
  })

  it('passes the exact disabled candidate revision through the dedicated desktop/main IPC', async () => {
    const result = await runTestGeneration({
      vendorKey: 'comfyui-local',
      candidateVendorKey: 'comfyui-local--candidate-r1',
      revisionId: 'comfy-r1',
      modelKey: 'workflow-1',
      binding: { outputNodeId: '9', outputKind: 'video' },
      prompt: 'a real test',
      extras: { comfy_fps: 24 },
    })

    expect(result).toMatchObject({ ok: true, revisionId: 'comfy-r1' })
    expect(mocks.runComfyCandidateTestByVendor).toHaveBeenCalledWith('comfyui-local--candidate-r1', expect.objectContaining({
      request: expect.objectContaining({
        extras: expect.objectContaining({
          modelKey: 'workflow-1',
          comfyCertificationRevisionId: 'comfy-r1',
          certifyOutput: true,
        }),
      }),
    }))
    expect(mocks.runWorkbenchTaskByVendor).not.toHaveBeenCalled()
  })

  it('keeps stable reasonCode and params for component error rendering', async () => {
    mocks.runComfyCandidateTestByVendor.mockResolvedValue({
      ok: false,
      revisionId: 'comfy-r1',
      reasonCode: 'media_markup_masquerade',
      params: { expectedKind: 'video' },
    })

    await expect(runTestGeneration({
      vendorKey: 'comfyui-local', candidateVendorKey: 'candidate', revisionId: 'comfy-r1', modelKey: 'workflow-1',
      binding: { outputNodeId: '9', outputKind: 'video' }, prompt: '', extras: {},
    })).resolves.toEqual({
      ok: false,
      revisionId: 'comfy-r1',
      reasonCode: 'media_markup_masquerade',
      params: { expectedKind: 'video' },
    })
  })
})
