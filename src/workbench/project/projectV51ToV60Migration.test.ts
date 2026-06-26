import { describe, expect, it } from 'vitest'
import { migrateProjectV51ToV60 } from './projectV51ToV60Migration'
import { createDefaultWorkbenchProjectPayload } from './projectRecordSchema'
import type { WorkbenchProjectRecordV1 } from './projectRecordSchema'
import type {
  GenerationCanvasNode,
  GenerationNodeKind,
} from '../generationCanvas/model/generationCanvasTypes'

function makeNode(overrides: Partial<GenerationCanvasNode> & { kind: GenerationNodeKind; id: string }): GenerationCanvasNode {
  return {
    id: overrides.id,
    kind: overrides.kind,
    title: overrides.title || 'Node',
    position: overrides.position || { x: 0, y: 0 },
    categoryId: overrides.categoryId,
    groupId: overrides.groupId,
    derivedFrom: overrides.derivedFrom,
    regeneratedFrom: overrides.regeneratedFrom,
    shotIndex: overrides.shotIndex,
    renderKind: overrides.renderKind,
  } as GenerationCanvasNode
}

function makeRecord(nodes: GenerationCanvasNode[]): WorkbenchProjectRecordV1 {
  const payload = createDefaultWorkbenchProjectPayload()
  return {
    id: 'p1',
    name: 'Test',
    payload: {
      ...payload,
      generationCanvas: {
        ...payload.generationCanvas,
        nodes,
      },
    },
  } as WorkbenchProjectRecordV1
}

describe('migrateProjectV51ToV60', () => {
  describe('renderKind backfill', () => {
    it('infers shot-frame for shots category nodes lacking renderKind', () => {
      const record = makeRecord([makeNode({ id: 'n1', kind: 'image', categoryId: 'shots' })])
      const { record: out, diagnostic } = migrateProjectV51ToV60(record)
      expect(out.payload.generationCanvas.nodes[0].renderKind).toBe('shot-frame')
      expect(diagnostic.renderKindBackfilled).toBe(1)
    })

    it('infers character-card for cast / scene-card / prop-card / audio-strip respectively', () => {
      const record = makeRecord([
        makeNode({ id: 'a', kind: 'image', categoryId: 'cast' }),
        makeNode({ id: 'b', kind: 'image', categoryId: 'scene' }),
        makeNode({ id: 'c', kind: 'image', categoryId: 'prop' }),
        makeNode({ id: 'd', kind: 'audio', categoryId: 'audio' }),
      ])
      const { record: out } = migrateProjectV51ToV60(record)
      const kinds = out.payload.generationCanvas.nodes.map((n) => n.renderKind)
      expect(kinds).toEqual(['character-card', 'scene-card', 'prop-card', 'audio-strip'])
    })

    it('does not overwrite existing renderKind', () => {
      const record = makeRecord([
        makeNode({ id: 'n1', kind: 'image', categoryId: 'shots', renderKind: 'character-card' }),
      ])
      const { record: out, diagnostic } = migrateProjectV51ToV60(record)
      expect(out.payload.generationCanvas.nodes[0].renderKind).toBe('character-card')
      expect(diagnostic.renderKindBackfilled).toBe(0)
    })
  })

  describe('derivedFrom semantic split', () => {
    it('keeps derivedFrom when source node is in a different category (cross-category copy)', () => {
      const record = makeRecord([
        makeNode({ id: 'src', kind: 'image', categoryId: 'cast' }),
        makeNode({ id: 'copy', kind: 'image', categoryId: 'shots', derivedFrom: 'src' }),
      ])
      const { record: out, diagnostic } = migrateProjectV51ToV60(record)
      const copy = out.payload.generationCanvas.nodes.find((n) => n.id === 'copy')!
      expect(copy.derivedFrom).toBe('src')
      expect(copy.regeneratedFrom).toBeUndefined()
      expect(diagnostic.derivedFromKeptCrossCategory).toBe(1)
    })

    it('moves derivedFrom to regeneratedFrom when source is in the same category', () => {
      const record = makeRecord([
        makeNode({ id: 'src', kind: 'image', categoryId: 'shots' }),
        makeNode({ id: 'v2', kind: 'image', categoryId: 'shots', derivedFrom: 'src' }),
      ])
      const { record: out, diagnostic } = migrateProjectV51ToV60(record)
      const v2 = out.payload.generationCanvas.nodes.find((n) => n.id === 'v2')!
      expect(v2.derivedFrom).toBeUndefined()
      expect(v2.regeneratedFrom).toBe('src')
      expect(diagnostic.derivedFromMovedToRegeneratedFrom).toBe(1)
    })

    it('clears derivedFrom when source no longer exists (orphan)', () => {
      const record = makeRecord([
        makeNode({ id: 'orphan', kind: 'image', categoryId: 'shots', derivedFrom: 'ghost' }),
      ])
      const { record: out, diagnostic } = migrateProjectV51ToV60(record)
      const orphan = out.payload.generationCanvas.nodes[0]
      expect(orphan.derivedFrom).toBeUndefined()
      expect(orphan.regeneratedFrom).toBeUndefined()
      expect(diagnostic.derivedFromClearedOrphan).toBe(1)
    })
  })

  describe('shotIndex assignment', () => {
    it('assigns shotIndex by position.y ascending', () => {
      const record = makeRecord([
        makeNode({ id: 's3', kind: 'image', categoryId: 'shots', position: { x: 0, y: 300 } }),
        makeNode({ id: 's1', kind: 'image', categoryId: 'shots', position: { x: 0, y: 100 } }),
        makeNode({ id: 's2', kind: 'image', categoryId: 'shots', position: { x: 0, y: 200 } }),
      ])
      const { record: out, diagnostic } = migrateProjectV51ToV60(record)
      const indexById = Object.fromEntries(
        out.payload.generationCanvas.nodes.map((n) => [n.id, n.shotIndex]),
      )
      expect(indexById['s1']).toBe(1)
      expect(indexById['s2']).toBe(2)
      expect(indexById['s3']).toBe(3)
      expect(diagnostic.shotIndicesAssigned).toBe(3)
    })

    it('does not assign shotIndex to non-shots category nodes', () => {
      const record = makeRecord([
        makeNode({ id: 'c1', kind: 'image', categoryId: 'cast', position: { x: 0, y: 0 } }),
      ])
      const { record: out, diagnostic } = migrateProjectV51ToV60(record)
      expect(out.payload.generationCanvas.nodes[0].shotIndex).toBeUndefined()
      expect(diagnostic.shotIndicesAssigned).toBe(0)
    })
  })

  describe('idempotency', () => {
    it('a fully-migrated record produces no further changes on second run', () => {
      const record = makeRecord([
        makeNode({
          id: 'n1',
          kind: 'image',
          categoryId: 'shots',
          position: { x: 0, y: 0 },
          renderKind: 'shot-frame',
          shotIndex: 1,
        }),
      ])
      const first = migrateProjectV51ToV60(record)
      const second = migrateProjectV51ToV60(first.record)
      expect(second.diagnostic.alreadyMigrated).toBe(true)
      expect(second.record).toBe(first.record)
    })

    it('does not treat cross-category derivedFrom as a change once render metadata is present', () => {
      const record = makeRecord([
        makeNode({
          id: 'cast-source',
          kind: 'character',
          categoryId: 'cast',
          renderKind: 'character-card',
        }),
        makeNode({
          id: 'shot-copy',
          kind: 'image',
          categoryId: 'shots',
          renderKind: 'shot-frame',
          shotIndex: 1,
          derivedFrom: 'cast-source',
        }),
      ])
      const { record: out, diagnostic } = migrateProjectV51ToV60(record)
      expect(out).toBe(record)
      expect(diagnostic.alreadyMigrated).toBe(true)
    })

    it('returns the same record reference when nothing changed', () => {
      const record = makeRecord([])
      const { record: out, diagnostic } = migrateProjectV51ToV60(record)
      expect(out).toBe(record)
      expect(diagnostic.alreadyMigrated).toBe(true)
    })
  })

  describe('数组参考 meta.referenceImageUrls → 有序 character_ref 边（audit §1d）', () => {
    function recordWithEdges(nodes: GenerationCanvasNode[], edges: unknown[] = []): WorkbenchProjectRecordV1 {
      const base = makeRecord(nodes)
      return {
        ...base,
        payload: {
          ...base.payload,
          generationCanvas: { ...base.payload.generationCanvas, edges: edges as never },
        },
      }
    }
    const imgWithResult = (id: string, url: string): GenerationCanvasNode => ({
      ...makeNode({ id, kind: 'image', categoryId: 'cast' }),
      result: { id: `${id}-r`, type: 'image', url, createdAt: 0 },
    }) as GenerationCanvasNode
    const omniShot = (id: string, refUrls: string[]): GenerationCanvasNode => ({
      ...makeNode({ id, kind: 'video', categoryId: 'shots' }),
      meta: { modelKey: 'seedance-2', archetype: { id: 'seedance-2', modeId: 'omni' }, referenceImageUrls: refUrls },
    }) as GenerationCanvasNode

    it('画布内有源的参考 → 建有序边、清 meta、诊断计数', () => {
      const record = recordWithEdges([
        imgWithResult('a', 'https://cdn/a.png'),
        imgWithResult('b', 'https://cdn/b.png'),
        omniShot('v1', ['https://cdn/a.png', 'https://cdn/b.png']),
      ])
      const { record: out, diagnostic } = migrateProjectV51ToV60(record)
      expect(diagnostic.referenceEdgesCreated).toBe(2)
      const edges = out.payload.generationCanvas.edges
      expect(edges.map((e) => [e.source, e.order])).toEqual([['a', 0], ['b', 1]])
      const v1 = out.payload.generationCanvas.nodes.find((n) => n.id === 'v1')
      expect((v1?.meta as Record<string, unknown>)?.referenceImageUrls).toBeUndefined()
    })

    it('反查不到源的 URL 保留 meta（绝不丢已存参考）', () => {
      const record = recordWithEdges([
        imgWithResult('a', 'https://cdn/a.png'),
        omniShot('v1', ['https://cdn/a.png', 'https://cdn/manual-upload.png']),
      ])
      const { record: out, diagnostic } = migrateProjectV51ToV60(record)
      expect(diagnostic.referenceEdgesCreated).toBe(1)
      const v1 = out.payload.generationCanvas.nodes.find((n) => n.id === 'v1')
      expect((v1?.meta as Record<string, unknown>)?.referenceImageUrls).toEqual(['https://cdn/manual-upload.png'])
    })

    it('幂等：二次迁移不再建边', () => {
      const record = recordWithEdges([
        imgWithResult('a', 'https://cdn/a.png'),
        omniShot('v1', ['https://cdn/a.png']),
      ])
      const first = migrateProjectV51ToV60(record)
      const second = migrateProjectV51ToV60(first.record)
      expect(second.diagnostic.referenceEdgesCreated).toBe(0)
      expect(second.record).toBe(first.record)
    })
  })
})
