import { describe, expect, it } from 'vitest'
import { normalizeLegacyImageAssetKinds } from './projectMediaMigration'
import { createDefaultWorkbenchProjectPayload } from './projectRecordSchema'
import type { WorkbenchProjectRecordV1 } from './projectRecordSchema'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'

function makeNode(overrides: Partial<GenerationCanvasNode> & { id: string }): GenerationCanvasNode {
  return {
    id: overrides.id,
    kind: overrides.kind || 'image',
    title: overrides.title || 'Node',
    prompt: overrides.prompt ?? '',
    position: overrides.position || { x: 0, y: 0 },
    result: overrides.result,
    meta: overrides.meta,
  } as GenerationCanvasNode
}

function makeRecord(nodes: GenerationCanvasNode[]): WorkbenchProjectRecordV1 {
  const payload = createDefaultWorkbenchProjectPayload()
  return {
    id: 'p1',
    name: 'Test',
    payload: {
      ...payload,
      generationCanvas: { ...payload.generationCanvas, nodes },
    },
  } as WorkbenchProjectRecordV1
}

function kindsOf(record: WorkbenchProjectRecordV1): string[] {
  return record.payload.generationCanvas.nodes.map((n) => n.kind)
}

describe('normalizeLegacyImageAssetKinds', () => {
  it('converts imported / file-tree / local-edit image nodes to asset', () => {
    const record = makeRecord([
      makeNode({ id: 'import', kind: 'image', meta: { source: 'local-drop', localOnly: true } }),
      makeNode({ id: 'uploaded', kind: 'image', meta: { source: 'asset-upload' } }),
      makeNode({ id: 'workspace', kind: 'image', meta: { source: 'workspace-file' } }),
      makeNode({ id: 'crop', kind: 'image', meta: { source: 'image-crop', localOnly: true } }),
      makeNode({ id: 'rotate', kind: 'image', meta: { source: 'image-rotate-left', localOnly: true } }),
      makeNode({ id: 'flip', kind: 'image', meta: { source: 'image-flip-h', localOnly: true } }),
      makeNode({ id: 'grid', kind: 'image', meta: { source: 'image-grid-split-2x2', localOnly: true } }),
      makeNode({ id: 'pano-shot', kind: 'image', meta: { source: 'panorama-screenshot', localOnly: true } }),
      makeNode({ id: 'localonly', kind: 'image', meta: { localOnly: true } }),
    ])
    const out = normalizeLegacyImageAssetKinds(record)
    expect(kindsOf(out)).toEqual(Array(9).fill('asset'))
  })

  it('keeps real generated image nodes as image', () => {
    const record = makeRecord([
      // 真生成图：带 provenance —— 即便 source/localOnly 看着像素材也不动。
      makeNode({
        id: 'generated',
        kind: 'image',
        result: { id: 'r', type: 'image', url: 'x', createdAt: 1, provenance: { model: 'm' } } as GenerationCanvasNode['result'],
        meta: { source: 'image-crop', localOnly: true },
      }),
      // 无素材特征的 image（纯生成节点，无 meta.source / 非 localOnly）。
      makeNode({ id: 'plain', kind: 'image' }),
      makeNode({ id: 'authored', kind: 'image', meta: { source: 'generation' } }),
    ])
    const out = normalizeLegacyImageAssetKinds(record)
    expect(kindsOf(out)).toEqual(['image', 'image', 'image'])
  })

  it('does not touch non-image kinds', () => {
    const record = makeRecord([
      makeNode({ id: 'char', kind: 'character', meta: { localOnly: true } }),
      makeNode({ id: 'vid', kind: 'video', meta: { source: 'local-drop' } }),
    ])
    const out = normalizeLegacyImageAssetKinds(record)
    expect(kindsOf(out)).toEqual(['character', 'video'])
  })

  it('returns the same record reference when nothing changes', () => {
    const record = makeRecord([makeNode({ id: 'plain', kind: 'image' })])
    expect(normalizeLegacyImageAssetKinds(record)).toBe(record)
  })
})
