import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildClipNodeOutputPatch } from '../nodes/clipNodeOutput'
import type { GenerationCanvasNode, GenerationNodeKind } from './generationCanvasTypes'
import { DERIVED_OUTPUT_RULES, derivedFromMeta, isDerivedOutputOf, readDerivedFrom, type DerivedFromKind } from './derivedOutput'

const node = (id: string, kind: GenerationNodeKind, meta: Record<string, unknown> = {}): GenerationCanvasNode =>
  ({ id, kind, title: id, position: { x: 0, y: 0 }, categoryId: 'shots', meta })

// 五类出处边各一条「目标身份」断言：合法的源 / 目标种类放行，错的种类、没记出处、记的是别人，一律不是出处边。
const SAMPLE: Record<DerivedFromKind, { source: GenerationNodeKind; target: GenerationNodeKind; wrongTarget: GenerationNodeKind }> = {
  'panorama-screenshot': { source: 'panorama', target: 'asset', wrongTarget: 'text' },
  'director-output': { source: 'director', target: 'image', wrongTarget: 'text' },
  'whiteboard-snapshot': { source: 'whiteboard', target: 'image', wrongTarget: 'asset' },
  'clip-export': { source: 'clip', target: 'video', wrongTarget: 'asset' },
  'shot-table': { source: 'video', target: 'shot_table', wrongTarget: 'asset' },
}

describe('derived output (provenance) identity', () => {
  it.each(Object.keys(SAMPLE) as DerivedFromKind[])('%s: only a target that recorded its source passes', (kind) => {
    const { source, target, wrongTarget } = SAMPLE[kind]
    const src = node('src', source)
    expect(isDerivedOutputOf(src, node('t', target, derivedFromMeta(kind, 'src')))).toBe(true)
    expect(isDerivedOutputOf(src, node('t', target))).toBe(false)
    expect(isDerivedOutputOf(src, node('t', target, derivedFromMeta(kind, 'someone-else')))).toBe(false)
    expect(isDerivedOutputOf(src, node('t', wrongTarget, derivedFromMeta(kind, 'src')))).toBe(false)
    expect(isDerivedOutputOf(node('src', 'text'), node('t', target, derivedFromMeta(kind, 'src')))).toBe(DERIVED_OUTPUT_RULES[kind].sources === 'any')
  })

  it('garbage derivedFrom data is ignored', () => {
    expect(readDerivedFrom({ derivedFrom: { nodeId: 'x', kind: 'made-up' } })).toBeNull()
    expect(readDerivedFrom({ derivedFrom: 'x' })).toBeNull()
    expect(readDerivedFrom(undefined)).toBeNull()
  })
})

// 五个产出方都走 connectDerivedOutput、并且在建节点那一刻记下出处；全仓没有「provenance」开关。
describe('the five producers', () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  it.each([
    ['nodes/useNodePanoramaHandlers.ts', "derivedFromMeta('panorama-screenshot'"],
    ['nodes/director/DirectorNode.tsx', "derivedFromMeta('director-output'"],
    ['nodes/whiteboard/WhiteboardModal.tsx', "derivedFromMeta('whiteboard-snapshot'"],
    ['nodes/clipNodeOutput.ts', "derivedFromMeta('clip-export'"],
    ['nodes/shotTable/factBridge.ts', "derivedFromMeta('shot-table'"],
  ])('%s records its provenance on the derived node', (path, marker) => {
    const source = read(path)
    expect(source).toContain(marker)
    expect(source).not.toContain('provenance: true')
  })

  it.each(['nodes/useNodePanoramaHandlers.ts', 'nodes/director/DirectorNode.tsx', 'nodes/whiteboard/WhiteboardModal.tsx', 'nodes/ClipNode.tsx', 'nodes/shotTable/factBridge.ts'])(
    '%s connects through connectDerivedOutput',
    (path) => expect(read(path)).toContain('connectDerivedOutput('),
  )

  it('a clip export node is stamped with the clip that exported it', () => {
    const patch = buildClipNodeOutputPatch({ sourceClipNodeId: 'clip-1', outputUrl: 'u', relativePath: 'p', durationSeconds: 1 })
    expect(patch.meta).toMatchObject({ derivedFrom: { nodeId: 'clip-1', kind: 'clip-export' } })
  })
})
