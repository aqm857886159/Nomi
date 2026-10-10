import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupTestTemp, makeTempDir } from './_test-temp.mjs'
import { EDGE_APPEND_CALLERS, EDGE_WRITERS, findEdgeWrites, scanEdgeWriters } from './check-canvas-edge-writers.mjs'

const dirs = []
afterEach(() => { for (const dir of dirs.splice(0)) cleanupTestTemp(dir) })

function tree(files) {
  const root = makeTempDir('edge-writers-')
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

  // 2026-10-10 复审（PR #1147）：Codex 实跑过的三种绕过写法，原来的正则门岗不报红。
  describe('AST 判定：换写法绕不过', () => {
    it.each([
      ['对象字面量展开再覆盖 edges', 'const next = { ...state, edges: [...state.edges, edge] }', true],
      ["方括号赋值", "state['edges'] = [...state.edges, edge]", true],
      ['Object.assign 覆盖 edges', 'Object.assign(state, { edges: [...state.edges, edge] })', true],
      ['set({ edges })', 'set({ edges: [...get().edges, edge] })', true],
      ['concat 赋值（非追加形态也算写）', 'state.edges = state.edges.concat(edge)', false],
      ['edges.push', 'draft.edges.push(edge)', true],
      ["['edges'].push", "draft['edges'].push(edge)", true],
      ['复合赋值', 'state.edges += x', true],
    ])('%s：被识别为写边', (_name, code, append) => {
      const writes = findEdgeWrites(code)
      expect(writes.length).toBeGreaterThan(0)
      if (append) expect(writes.some((write) => write.append)).toBe(true)
    })

    it('只读用法不算写：{ nodes, edges: state.edges } 传给解析函数、读取 state.edges、注释和字符串', () => {
      expect(findEdgeWrites(`
        // state.edges = []
        const text = "state.edges = []"
        const edges = state.edges
        resolve(node, { nodes: state.nodes, edges: state.edges })
        const count = state.edges.length
      `)).toEqual([])
    })

    it.each([
      "const next = { ...state, edges: [...state.edges, edge] }",
      "state['edges'] = [...state.edges, edge]",
      'Object.assign(state, { edges: [...state.edges, edge] })',
    ])('名单外文件用这种写法：整仓扫描报红 — %s', (code) => {
      const root = tree({ 'src/workbench/generationCanvas/store/rogue.ts': code })
      const out = scanEdgeWriters(root, {}, [])
      expect(out).toHaveLength(1)
      expect(out[0]).toContain('rogue.ts')
    })

    it('名单内文件用这三种写法做整批追加：红', () => {
      const root = tree({ 'src/workbench/generationCanvas/store/ok.ts': 'admitNewEdges(x); Object.assign(state, { edges: [...state.edges, edge] })' })
      expect(scanEdgeWriters(root, writers, []).join(' ')).toContain('整批追加')
    })
  })
})
