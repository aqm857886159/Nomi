import { describe, expect, it } from 'vitest'
import { buildCatalogTaskRequest } from './catalogTaskActions'
import { resolveGenerationReferences } from './generationReferenceResolver'
import { classifyGenerationError } from '../../observability/classifyError'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'

function target(vendor = 'minimax'): GenerationCanvasNode {
  return { id: 'target', kind: 'video', title: '', position: { x: 0, y: 0 }, prompt: '',
    meta: { modelKey: 'MiniMax-H3-Regeneration', modelVendor: vendor,
      archetype: { id: 'minimax-h3-regeneration', modeId: 'regenerate' } } }
}
function result(resolution = '768P', provider = 'minimax'): GenerationNodeResult {
  return { id: 'result', type: 'video', url: 'nomi-local://asset/project/source.mp4', taskId: 'source-task', createdAt: 1,
    provenance: { provider, modelKey: 'MiniMax-H3', timestamp: 1, params: { extras: { resolution } } } }
}
function connected(resolution = '768P', provider = 'minimax', vendor = provider) {
  const node = target(vendor)
  const source: GenerationCanvasNode = { ...target(), id: 'source', result: result(resolution, provider) }
  const referenceContext = { nodes: [source, node], edges: [{ id: 'edge', source: 'source', target: 'target', mode: 'reference' as const }] }
  const references = resolveGenerationReferences(node, referenceContext)
  return { node, source, options: { referenceContext, references } }
}
describe('source-task operations use original result provenance', () => {
  it.each(['minimax', 'apimart'])('derives the connected source ID for %s', vendor => {
    const { node, options } = connected('768P', vendor)
    const { request } = buildCatalogTaskRequest(node, options)
    expect(request.extras?.source_task_id).toBe('source-task')
  })
  it('supports switching the original generated node to regeneration', () => {
    const node = { ...target(), result: result() }
    expect(buildCatalogTaskRequest(node).request.extras?.source_task_id).toBe('source-task')
  })
  it('blocks the reported 2K source instead of submitting an empty request', () => {
    const { node, options } = connected('2K')
    expect(() => buildCatalogTaskRequest(node, options)).toThrow(/768P/)
  })
  it('explains a local input failure without blaming the provider or balance', () => {
    const { node, options } = connected('2K')
    let message = ''
    try { buildCatalogTaskRequest(node, options) } catch (error) { message = (error as Error).message }
    const report = classifyGenerationError(message)
    expect(report.kind).toBe('input')
    expect(report.hint).toContain('768P')
    expect(report.providerMessage).toBeUndefined()
    expect(report.hint).not.toMatch(/服务商|额度/)
  })
  it('rejects an absent source, including a node with only unrelated old history', () => {
    expect(() => buildCatalogTaskRequest({ ...target(), history: [result()] })).toThrow()
  })
  it('does not borrow a task ID from another provider', () => {
    const { node, options } = connected('768P', 'apimart', 'minimax')
    expect(() => buildCatalogTaskRequest(node, options)).toThrow()
  })
  it('does not guess which video to use', () => {
    const { node, source, options } = connected()
    const other = { ...source, id: 'other', result: { ...result(), taskId: 'other-task', url: 'nomi-local://asset/project/other.mp4' } }
    options.referenceContext.nodes.push(other)
    options.references.referenceVideos.push(other.result.url)
    expect(() => buildCatalogTaskRequest(node, options)).toThrow()
  })
  it('preserves the explicit ID path when no canvas source was selected', () => {
    const node = target(); node.meta!.source_task_id = 'manual-task'
    expect(buildCatalogTaskRequest(node).request.extras?.source_task_id).toBe('manual-task')
  })
  it('rejects a stale manual ID that conflicts with the live connected result', () => {
    const { node, options } = connected(); node.meta!.source_task_id = 'old-task'
    expect(() => buildCatalogTaskRequest(node, options)).toThrow()
  })
  it('rejects imported videos without trustworthy generation provenance', () => {
    const { node, source, options } = connected(); delete source.result!.provenance
    expect(() => buildCatalogTaskRequest(node, options)).toThrow()
  })
})
