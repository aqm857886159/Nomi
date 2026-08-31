import { describe, expect, it } from 'vitest'
import { getGenerationNodeComponentForNode } from './renderRegistry'
import { MissingCanvasPluginNode } from '../plugins/MissingCanvasPluginNode'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

describe('canvas plugin render registry', () => {
  it('falls back to a data-preserving placeholder when the feature is disabled', () => {
    const node: GenerationCanvasNode = {
      id: 'missing', kind: 'text', title: '保留', position: { x: 0, y: 0 },
      typeId: 'nomi.future/node',
      pluginState: { pluginId: 'nomi.future', pluginVersion: '1.0.0', typeId: 'nomi.future/node', schemaVersion: 1, state: { value: 1 } },
    }
    expect(getGenerationNodeComponentForNode(node)).toBe(MissingCanvasPluginNode)
  })

  it('falls back when stored plugin state is newer than the installed node schema', () => {
    const node: GenerationCanvasNode = {
      id: 'future', kind: 'text', title: '保留', position: { x: 0, y: 0 },
      typeId: 'nomi.workflow/checkpoint',
      pluginState: { pluginId: 'nomi.workflow', pluginVersion: '2.0.0', typeId: 'nomi.workflow/checkpoint', schemaVersion: 2, state: { checked: true } },
    }
    expect(getGenerationNodeComponentForNode(node)).toBe(MissingCanvasPluginNode)
  })
})
