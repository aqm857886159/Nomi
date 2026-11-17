import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeResult } from '../generationCanvas/model/generationCanvasTypes'
import type { AssetRef } from './assetTypes'
import { applyAssetResultDeletion, collectProjectFileReferences, isProjectFileReferenced, planAssetDeletion } from './assetResultDeletion'

const refs = (nodes: GenerationCanvasNode[]) => collectProjectFileReferences(nodes, {})

const image = (id: string, url: string): GenerationNodeResult => ({ id, type: 'image', url, createdAt: 1 })

function canvasAsset(nodeId: string, resultId: string, renderUrl: string): AssetRef {
  return {
    id: `${nodeId}:${resultId}`,
    kind: 'image',
    name: '结果',
    renderUrl,
    ownerResultId: resultId,
    source: 'canvas',
    origin: { source: 'canvas', nodeId, resultId },
  }
}

describe('asset result deletion', () => {
  it('removes one history result without deleting its canvas node', () => {
    const a = image('a', 'nomi-local://asset/project-1/assets/a.png')
    const b = image('b', 'nomi-local://asset/project-1/assets/b.png')
    const node = {
      id: 'node-1', kind: 'image', title: '结果', position: { x: 0, y: 0 },
      result: a, history: [a, b], status: 'success',
    } as GenerationCanvasNode
    const asset = canvasAsset(node.id, 'b', b.url!)
    const plan = planAssetDeletion(asset, { projectId: 'project-1', nodes: [node], rest: {} })
    expect(plan.matches).toHaveLength(1)
    expect(plan.file).toEqual({ target: { projectId: 'project-1', relativePath: 'assets/b.png' }, fate: 'trash' })

    const next = applyAssetResultDeletion([node], plan.matches)
    expect(next).toHaveLength(1)
    expect(next[0].result?.id).toBe('a')
    expect(next[0].history?.map((result) => result.id)).toEqual(['a'])
  })

  it('matches a project asset to its owner node by URL when result metadata is absent', () => {
    const result = image('generated', 'nomi-local://asset/project-2/assets/generated.png')
    const node = {
      id: 'node-2', kind: 'image', title: '结果', position: { x: 0, y: 0 }, result, history: [result],
    } as GenerationCanvasNode
    const asset: AssetRef = {
      id: 'project-2:assets/generated.png', kind: 'image', name: 'generated.png',
      renderUrl: result.url!, source: 'project',
      origin: { source: 'project', projectId: 'project-2', relativePath: 'assets/generated.png' },
    }
    expect(planAssetDeletion(asset, { projectId: 'project-2', nodes: [node], rest: {} }).matches[0]?.resultIds).toEqual(['generated'])
  })
})

describe('editable document asset references', () => {
  const original = image('original', 'nomi-local://asset/project-1/assets/original.png')
  const state = { canvasAssets: [{ url: original.url }] }
  const edited = { ...image('edited', 'nomi-local://asset/project-1/assets/edited.png'), raw: { whiteboardState: state } }
  const target = { projectId: 'project-1', relativePath: 'assets/original.png' }
  it('keeps original pixels while either a current draft or a historical editable snapshot needs them', () => {
    for (const partial of [{ meta: { whiteboardState: state }, result: image('other', 'nomi-local://other') },
      { result: edited }, { result: image('other', 'nomi-local://other'), history: [edited] }]) {
      const node = { id: 'node', kind: 'image', position: { x: 0, y: 0 }, ...partial } as GenerationCanvasNode
      expect(isProjectFileReferenced(target, refs([node]))).toBe(true)
    }
    expect(isProjectFileReferenced(target, refs([]))).toBe(false)
  })
  it('deleting the original version cannot schedule deletion of an edited version’s source layers', () => {
    const node = { id: 'node', kind: 'image', position: { x: 0, y: 0 }, result: edited, history: [original, edited] } as GenerationCanvasNode
    const plan = planAssetDeletion(canvasAsset(node.id, original.id!, original.url!), { projectId: 'project-1', nodes: [node], rest: {} })
    expect(plan.matches).toHaveLength(1)
    expect(plan.file).toEqual({ target, fate: 'keep' })
    const remaining = applyAssetResultDeletion([node], plan.matches)
    const final = planAssetDeletion(canvasAsset(node.id, edited.id!, edited.url!), { projectId: 'project-1', nodes: remaining, rest: {} })
    expect(final.file).toEqual({ target: { projectId: 'project-1', relativePath: 'assets/edited.png' }, fate: 'trash' })
    expect(isProjectFileReferenced(target, refs(applyAssetResultDeletion(remaining, final.matches)))).toBe(false)
  })
})
