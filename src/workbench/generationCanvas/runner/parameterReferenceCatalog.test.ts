import { describe, expect, it } from 'vitest'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { projectParameterReferenceSlots } from '../model/parameterReferenceSlots'
import type { ModelCatalogModelDto, ModelCatalogVendorDto } from '../../api/modelCatalogApi'
import type { TaskRequestDto } from '../../api/taskApi'
import { runCatalogGenerationTask } from './catalogTaskActions'
import { NEWAPI_STANDARD_VIDEO_PARAMS } from '../../../../electron/catalog/newapiTransport'

const vendor: ModelCatalogVendorDto = { key: 'custom', name: 'custom', enabled: true, hasApiKey: true, createdAt: '', updatedAt: '' }
const catalog = (key: string) => ({ parameters: [{ key, label: key, type: 'image-url' }] })
function target(meta: Record<string, unknown> = {}): GenerationCanvasNode {
  return { id: 'target', kind: 'video', title: '', prompt: 'animate', position: { x: 0, y: 0 },
    meta: { modelKey: 'model', modelVendor: 'custom', ...meta } }
}
function source(kind: 'image' | 'video' = 'image'): GenerationCanvasNode {
  return { id: 'source', kind, title: '', position: { x: 0, y: 0 }, result: { id: 'result', type: kind, url: `https://asset.test/${kind}`, createdAt: 1 } }
}
async function run(node: GenerationCanvasNode, sourceNode: GenerationCanvasNode, edge: GenerationCanvasEdge, meta: Record<string, unknown>) {
  const calls: TaskRequestDto[] = []
  const model: ModelCatalogModelDto = { modelKey: 'model', vendorKey: 'custom', labelZh: 'model', kind: 'video', enabled: true, published: true, publishedModes: ['image_to_video'], createdAt: '', updatedAt: '', meta }
  await runCatalogGenerationTask(node, {
    referenceContext: { nodes: [node, sourceNode], edges: [edge] },
    listCatalogVendors: async () => [vendor], listCatalogModels: async () => [model],
    runTask: async (_vendor, request) => {
      calls.push(request)
      return { id: 'task', kind: request.kind, status: 'succeeded', assets: [{ type: 'video', url: 'https://asset.test/output' }], raw: {} }
    },
  })
  return calls[0]
}

describe('catalog execution uses current parameter declarations and resolved media', () => {
  it('sends a legacy first_frame image through the real NEWAPI image_url request parameter', async () => {
    const meta = { parameters: NEWAPI_STANDARD_VIDEO_PARAMS }
    const node = target(projectParameterReferenceSlots({ modelKey: 'model', modelVendor: 'custom' }, meta))
    const request = await run(node, source(), { id: 'legacy', source: 'source', target: node.id, mode: 'first_frame' }, meta)
    expect(request.kind).toBe('image_to_video')
    expect(request.extras?.firstFrameUrl).toBe('https://asset.test/image')
    expect(request.extras?.image_url).toBe('https://asset.test/image')
  })

  it('projects a newly declared key from an existing unkeyed edge before building the request', async () => {
    const node = target()
    const request = await run(node, source(), { id: 'edge', source: 'source', target: node.id, mode: 'reference' }, catalog('new_image'))
    expect(request.extras?.new_image).toBe('https://asset.test/image')
    expect(node.meta?.parameterReferenceSlots).toBeUndefined()
  })

  it('does not retarget a removed explicit key or leak it into generic references after a catalog update', async () => {
    const node = target(projectParameterReferenceSlots({ modelKey: 'model', modelVendor: 'custom' }, catalog('old_image')))
    const request = await run(node, source(), { id: 'edge', source: 'source', target: node.id, mode: 'reference', targetParamKey: 'old_image' }, catalog('new_image'))
    expect(request.extras?.new_image).toBeUndefined()
    expect(request.extras?.old_image).toBeUndefined()
    expect(request.kind).toBe('text_to_video')
  })

  it.each(['legacy', 'untyped', 'image'])('resolves video tail-frame relay after refreshing the catalog (%s)', async (declaration) => {
    const declared = declaration !== 'legacy'
    const meta = declared ? { parameters: [{ key: 'first_frame_url', label: 'First', type: 'image-url', ...(declaration === 'image' ? { mediaKind: 'image' } : {}) }] } : {}
    const node = target({ ...projectParameterReferenceSlots({ modelKey: 'model', modelVendor: 'custom' }, meta), lastFrameUrl: 'https://asset.test/actual-tail.png' })
    const request = await run(node, source('video'), {
      id: 'edge', source: 'source', target: node.id, mode: 'first_frame', ...(declared ? { targetParamKey: 'first_frame_url' } : {}),
    }, meta)
    expect(request.extras?.firstFrameUrl).toBe('https://asset.test/actual-tail.png')
    if (declared) expect(request.extras?.first_frame_url).toBe('https://asset.test/actual-tail.png')
  })
})
