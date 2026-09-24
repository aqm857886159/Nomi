import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { canCreateConnectedMedia, CONNECTION_CREATE_NODE_KINDS } from './connectionCreationPolicy'
import type { GenerationNodeKind } from './generationNodeKinds'

const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')

describe('connection creation policy', () => {
  it.each([
    ['text', true],
    ['image', true],
    ['video', true],
    ['keyframe', true],
    ['audio', false],
    ['model3d', false],
  ] as const)('%s source can create a connected media node: %s', (kind, expected) => {
    expect(canCreateConnectedMedia({ kind: kind as GenerationNodeKind })).toBe(expected)
  })

  it('keeps the connection menu targets aligned with the media creation contract', () => {
    expect(CONNECTION_CREATE_NODE_KINDS).toEqual(['image', 'video'])
    expect(read('src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowOverlays.tsx'))
      .toContain('kinds={CONNECTION_CREATE_NODE_KINDS}')
  })

  it('routes React Flow blank-canvas drops through the shared source predicate', () => {
    expect(read('src/workbench/generationCanvas/reactFlow/useGenerationCanvasReactFlowMenus.ts'))
      .toContain('if (!sourceNode || !canCreateConnectedMedia(sourceNode))')
  })
})
