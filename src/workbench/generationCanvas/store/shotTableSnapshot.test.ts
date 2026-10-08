import { describe, expect, it } from 'vitest'
import { createDeconstructionShotTable } from '../nodes/shotTable/shotTableFacts'
import { normalizeStoreSnapshot } from './canvasSnapshotNormalizer'
import { normalizeGenerationCanvasSnapshot } from '../../workbenchPersistence'
import { getNodeSizeBounds, resolveNodeVisualSize } from '../nodes/nodeSizing'

const snapshot = () => ({
  nodes: [{ id: 'table', kind: 'shot_table', title: 'Shot Table', position: { x: 0, y: 0 },
    meta: { shotTable: createDeconstructionShotTable('video-1', 'Reference') } }],
  edges: [], groups: [], selectedNodeIds: [],
})

describe('shot table snapshot readers', () => {
  for (const normalize of [normalizeStoreSnapshot, normalizeGenerationCanvasSnapshot]) {
    it(`${normalize.name} preserves the deconstruction table and rejects a malformed one`, () => {
      const raw = snapshot()
      expect(normalize(raw).nodes[0].kind).toBe('shot_table')
      const invalid = { ...raw, nodes: [{ ...raw.nodes[0], meta: { shotTable: { ...raw.nodes[0].meta.shotTable, rows: 'x' } } }] }
      expect(() => normalize(invalid)).toThrow()
    })
  }

  it('uses the registered dimensions and clamps free resizing to table bounds', () => {
    expect(resolveNodeVisualSize({ kind: 'shot_table' })).toEqual({ width: 960, height: 420 })
    expect(getNodeSizeBounds('shot_table')).toEqual({ minWidth: 560, maxWidth: 1400, minHeight: 160, maxHeight: 900 })
    expect(resolveNodeVisualSize({ kind: 'shot_table', size: { width: 2000, height: 20 } })).toEqual({ width: 1400, height: 160 })
  })
})
