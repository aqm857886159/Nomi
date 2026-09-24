import { describe, expect, it } from 'vitest'
import { canCreateConnectedMedia, CONNECTION_CREATE_NODE_KINDS } from './connectionCreationPolicy'
import type { GenerationNodeKind } from './generationNodeKinds'

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
  })
})
