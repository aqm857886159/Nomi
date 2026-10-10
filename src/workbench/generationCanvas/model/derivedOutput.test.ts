import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeKind } from './generationCanvasTypes'
import { DERIVED_OUTPUT_RULES, canDeriveOutput, type DerivedOutputKind } from './derivedOutput'

const node = (id: string, kind: GenerationNodeKind, extra: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode =>
  ({ id, kind, title: id, position: { x: 0, y: 0 }, categoryId: 'shots', meta: {}, ...extra })
const videoResult = { id: 'r', type: 'video' as const, url: 'u', createdAt: 1 }

// 各类各一条合法放行 + 错的源 / 错的新节点种类被拒。
const SAMPLE: Record<DerivedOutputKind, { source: GenerationCanvasNode; target: GenerationNodeKind; wrongSource: GenerationNodeKind; wrongTarget: GenerationNodeKind }> = {
  'panorama-screenshot': { source: node('s', 'panorama'), target: 'asset', wrongSource: 'text', wrongTarget: 'text' },
  'director-output': { source: node('s', 'director'), target: 'image', wrongSource: 'text', wrongTarget: 'asset' },
  'whiteboard-snapshot': { source: node('s', 'whiteboard'), target: 'image', wrongSource: 'text', wrongTarget: 'asset' },
  'clip-export': { source: node('s', 'clip'), target: 'video', wrongSource: 'text', wrongTarget: 'asset' },
  'shot-table': { source: node('s', 'video', { result: videoResult }), target: 'shot_table', wrongSource: 'text', wrongTarget: 'asset' },
  'video-frame': { source: node('s', 'video', { result: videoResult }), target: 'image', wrongSource: 'text', wrongTarget: 'video' },
  'video-trim': { source: node('s', 'video', { result: videoResult }), target: 'video', wrongSource: 'text', wrongTarget: 'image' },
}

describe('derived output rules', () => {
  it.each(Object.keys(SAMPLE) as DerivedOutputKind[])('%s: the right source and new-node kind pass, the wrong ones do not', (kind) => {
    const { source, target, wrongSource, wrongTarget } = SAMPLE[kind]
    expect(canDeriveOutput(kind, source, target)).toBe(true)
    expect(canDeriveOutput(kind, node('s', wrongSource), target)).toBe(false)
    expect(canDeriveOutput(kind, source, wrongTarget)).toBe(false)
  })

  it('shot-table: only a video source (no "any")', () => {
    expect(DERIVED_OUTPUT_RULES['shot-table'].sources).not.toContain('text')
    expect(canDeriveOutput('shot-table', node('s', 'text'), 'shot_table')).toBe(false)
    expect(canDeriveOutput('shot-table', node('s', 'image'), 'shot_table')).toBe(false)
    expect(canDeriveOutput('shot-table', node('s', 'asset'), 'shot_table')).toBe(false) // asset 卡没有视频结果
    expect(canDeriveOutput('shot-table', node('s', 'asset', { result: videoResult }), 'shot_table')).toBe(true) // 导入的视频素材
  })
})

// 结构断言：没有任何持久化的身份字段、没有公开的「给已有节点补出处边」的动作——普通卡调不到、也伪造不了。
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(full)
  }
  return out
}

describe('no forgeable provenance identity exists', () => {
  const root = path.resolve(import.meta.dirname, '../../..')
  const files = walk(root).filter((file) => !file.endsWith('derivedOutput.test.ts'))
  // 注意：节点上另有一个无关的 `derivedFrom`（分类间副本血缘，节点顶层字段），这里只禁「meta 里的出处身份」。
  const forbidden = ['meta.derived' + 'From', 'meta?.derived' + 'From', 'derivedFrom' + 'Meta', 'connectDerived' + 'Output', 'prove' + 'nance: true', 'isDerivedOutput' + 'Of']

  it.each(forbidden)('src contains no "%s"', (needle) => {
    const hits = files.filter((file) => readFileSync(file, 'utf8').includes(needle))
    expect(hits.map((file) => path.relative(root, file))).toEqual([])
  })
})

describe('the five producers use the atomic action', () => {
  const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
  it.each([
    ['nodes/useNodePanoramaHandlers.ts', "'panorama-screenshot'"],
    ['nodes/director/DirectorNode.tsx', "'director-output'"],
    ['nodes/whiteboard/WhiteboardModal.tsx', "'whiteboard-snapshot'"],
    ['nodes/ClipNode.tsx', "'clip-export'"],
    ['nodes/shotTable/factBridge.ts', "'shot-table'"],
  ])('%s calls addDerivedOutput with %s', (rel, kind) => {
    const source = read(rel)
    expect(source).toContain('addDerivedOutput(')
    expect(source).toContain(kind)
  })
})
