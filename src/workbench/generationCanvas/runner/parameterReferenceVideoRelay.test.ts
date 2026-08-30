import { describe, expect, it, vi } from 'vitest'
import { NEWAPI_STANDARD_VIDEO_PARAMS } from '../../../../electron/catalog/newapiTransport'
import { getDesktopBridge } from '../../../desktop/bridge'
import { getActiveWorkbenchProjectId } from '../../project/workbenchProjectSession'
import type { ModelCatalogModelDto, ModelCatalogVendorDto } from '../../api/modelCatalogApi'
import type { TaskRequestDto } from '../../api/taskApi'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { projectParameterReferenceSlots } from '../model/parameterReferenceSlots'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { runCatalogGenerationTask } from './catalogTaskActions'

vi.mock('../../../desktop/bridge', () => ({ getDesktopBridge: vi.fn() }))
vi.mock('../../project/workbenchProjectSession', () => ({ getActiveWorkbenchProjectId: vi.fn() }))

describe('explicit video first-frame edges reach generic image parameters as extracted images', () => {
  it.each(['legacy', 'new'] as const)('%s NEWAPI first_frame edge sends extracted PNG, while the same source in a video slot stays MP4', async (entry) => {
    const videoUrl = 'https://asset.test/source.mp4'
    const frameUrl = 'https://asset.test/extracted-tail.png'
    const extractFrame = vi.fn().mockResolvedValue({ url: frameUrl })
    vi.mocked(getDesktopBridge).mockReturnValue({ video: { extractFrame } } as unknown as ReturnType<typeof getDesktopBridge>)
    vi.mocked(getActiveWorkbenchProjectId).mockReturnValue('project')
    const catalogMeta = { parameters: [...NEWAPI_STANDARD_VIDEO_PARAMS, { key: 'clip', label: 'Clip', type: 'image-url', mediaKind: 'video' }] }
    const target: GenerationCanvasNode = { id: 'target', kind: 'video', title: '', prompt: 'animate', position: { x: 0, y: 0 },
      meta: projectParameterReferenceSlots({ modelKey: 'generic-relay', modelVendor: 'custom-relay' }, catalogMeta) }
    const source: GenerationCanvasNode = { id: 'source', kind: 'video', title: '', position: { x: 0, y: 0 }, result: { id: 'r', type: 'video', url: videoUrl, createdAt: 1 } }
    let edges: GenerationCanvasEdge[] = [{ id: 'legacy', source: source.id, target: target.id, mode: 'first_frame' }]
    if (entry === 'new') {
      const store = useGenerationCanvasStore.getState()
      store.restoreSnapshot({ nodes: [source, target], edges: [], groups: [] })
      store.connectNodes(source.id, target.id, 'first_frame')
      edges = useGenerationCanvasStore.getState().edges
    }
    edges = [...edges, { id: 'clip', source: source.id, target: target.id, mode: 'reference', targetParamKey: 'clip' }]
    const model: ModelCatalogModelDto = { modelKey: 'generic-relay', vendorKey: 'custom-relay', labelZh: 'Relay', kind: 'video', enabled: true, published: true, publishedModes: ['image_to_video'], createdAt: '', updatedAt: '', meta: catalogMeta }
    const vendor: ModelCatalogVendorDto = { key: 'custom-relay', name: 'Relay', enabled: true, hasApiKey: true, createdAt: '', updatedAt: '' }
    const requests: TaskRequestDto[] = []
    await runCatalogGenerationTask(target, {
      referenceContext: { nodes: [source, target], edges },
      listCatalogModels: async () => [model], listCatalogVendors: async () => [vendor],
      runTask: async (_vendor, request) => {
        requests.push(request)
        return { id: 'task', kind: request.kind, status: 'succeeded', assets: [{ type: 'video', url: 'https://asset.test/output.mp4' }], raw: {} }
      },
    })
    expect(extractFrame).toHaveBeenCalledExactlyOnceWith({ videoUrl, which: 'last', projectId: 'project' })
    expect(requests[0].kind).toBe('image_to_video')
    expect(requests[0].extras?.firstFrameUrl).toBe(frameUrl)
    expect(requests[0].extras?.image_url).toBe(frameUrl)
    expect(requests[0].extras?.clip).toBe(videoUrl)
  })
})
