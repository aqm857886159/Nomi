import { describe, expect, it } from 'vitest'

import type { DesktopBridge } from './bridge'

type Catalog = DesktopBridge['modelCatalog']
type ImportResult = ReturnType<Catalog['importComfyWorkflow']>
type UpdateResult = Awaited<ReturnType<NonNullable<Catalog['updateComfyWorkflow']>>>
type CandidateTestPayload = Parameters<NonNullable<DesktopBridge['tasks']['runComfyCandidateTest']>>[0]

describe('desktop ComfyUI candidate bridge contract', () => {
  it('preserves the staged vendor and revision in import and update DTOs', () => {
    const imported: ImportResult = {
      ok: true,
      modelKey: 'wan-i2v',
      kind: 'video',
      taskKind: 'image_to_video',
      vendorKey: 'comfyui-local--candidate-a',
      revisionId: 'comfy-a',
    }
    const updated: UpdateResult = { ...imported, revisionId: 'comfy-b' }

    expect(imported).toMatchObject({ vendorKey: 'comfyui-local--candidate-a', revisionId: 'comfy-a' })
    expect(updated).toMatchObject({ revisionId: 'comfy-b' })
  })

  it('requires exact revision intent on the dedicated main-process test IPC', () => {
    const payload: CandidateTestPayload = {
      vendor: 'comfyui-local',
      request: {
        kind: 'text_to_video',
        prompt: 'test',
        extras: {
          modelKey: 'wan-t2v',
          comfyCertificationRevisionId: 'comfy-a',
          certifyOutput: true,
        },
      },
    }
    expect(payload.request.extras).toMatchObject({
      modelKey: 'wan-t2v',
      comfyCertificationRevisionId: 'comfy-a',
      certifyOutput: true,
    })
  })
})
