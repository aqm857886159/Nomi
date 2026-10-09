import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EDGE_APPEND_CALLERS, EDGE_WRITERS, scanEdgeWriters } from './check-canvas-edge-writers.mjs'

const dirs = []
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-writers-'))
  dirs.push(root)
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), content)
  }
  return root
}

const writers = { 'src/workbench/generationCanvas/store/ok.ts': { why: 'x', mustCall: ['admitNewEdges('] } }

describe('画布写边门岗', () => {
  it('仓库现状是绿的', () => {
    expect(scanEdgeWriters()).toEqual([])
    expect(Object.keys(EDGE_WRITERS).length).toBeGreaterThan(0)
    expect(EDGE_APPEND_CALLERS.length).toBeGreaterThan(0)
  })

  it('名单外的文件直接写 .edges：红', () => {
    const root = tree({
      'src/workbench/generationCanvas/store/ok.ts': 'admitNewEdges(x); state.edges = state.edges.filter(Boolean)',
      'src/workbench/generationCanvas/store/rogue.ts': 'set((state) => { state.edges = [...state.edges, ...cloned.edges] })',
    })
    const out = scanEdgeWriters(root, writers, [])
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('rogue.ts')
  })

  it('.edges.push 也算；测试文件和注释不算', () => {
    const root = tree({
      'src/workbench/generationCanvas/store/ok.ts': 'admitNewEdges(x)',
      'src/workbench/generationCanvas/agent/rogue.ts': 'snapshot.edges.push(edge)',
      'src/workbench/generationCanvas/agent/rogue.test.ts': 'snapshot.edges.push(edge)',
      'src/workbench/generationCanvas/agent/note.ts': '// state.edges = []\n/* a.edges.push(b) */',
    })
    const out = scanEdgeWriters(root, {}, [])
    expect(out.map((line) => line.split(':')[0])).toEqual(['src/workbench/generationCanvas/agent/rogue.ts'])
  })

  it('名单里的文件整批追加但没经过闸：红', () => {
    const root = tree({ 'src/workbench/generationCanvas/store/ok.ts': 'state.edges = [...state.edges, ...cloned.edges]; admitNewEdges(x)' })
    expect(scanEdgeWriters(root, writers, []).join('\n')).toContain('整批追加')
  })

  it('名单里的文件写边却没出现过闸标记：红', () => {
    const root = tree({ 'src/workbench/generationCanvas/store/ok.ts': 'state.edges = state.edges.filter(Boolean)' })
    expect(scanEdgeWriters(root, writers, []).join('\n')).toContain('没有调过闸')
  })

  it('名单里的文件已经不写边了：红（名单只许反映现状）', () => {
    const root = tree({ 'src/workbench/generationCanvas/store/ok.ts': 'export const x = 1' })
    expect(scanEdgeWriters(root, writers, []).join('\n')).toContain('从名单里删掉')
  })

  it('应经 appendAdmittedEdges 的文件没调它：红', () => {
    const root = tree({ 'src/workbench/generationCanvas/store/group.ts': 'export const x = 1' })
    expect(scanEdgeWriters(root, {}, ['src/workbench/generationCanvas/store/group.ts']).join('\n')).toContain('appendAdmittedEdges')
  })
})
