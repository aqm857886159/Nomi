import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CANVAS_LAYER, CANVAS_LAYER_CSS_VARS } from './canvasLayerOrder'

// 层级表的结构合同（2026-10-10）：生成框（节点内）> 分组框头 > 分组框体，且节点层压住分组框头。
// 真实 Electron 的屏外走查（tests/ux/group-layer-order.walk.mjs）另外用 elementFromPoint 验同一件事。
const here = path.dirname(fileURLToPath(import.meta.url))
const generationCanvasDir = path.resolve(here, '..')

function source(relative: string): string {
  return fs.readFileSync(path.join(generationCanvasDir, relative), 'utf8')
}

describe('canvas layer order (single owner: canvasLayerOrder.ts)', () => {
  it('group body < group header < node layer: group chrome never paints over nodes', () => {
    expect(CANVAS_LAYER.groupBody).toBeLessThan(CANVAS_LAYER.groupHeader)
    expect(CANVAS_LAYER.groupHeader).toBeLessThan(CANVAS_LAYER.nodes)
  })

  it('generation composer sits above the group header of any group (the 10-10 bug)', () => {
    expect(CANVAS_LAYER.nodeComposer).toBeGreaterThan(CANVAS_LAYER.groupHeader)
    expect(CANVAS_LAYER.nodeComposer).toBeGreaterThan(CANVAS_LAYER.groupBody)
  })

  it('selected node is lifted inside the node layer, and the node layer owns its own children', () => {
    expect(CANVAS_LAYER.nodeSelected).toBeGreaterThan(CANVAS_LAYER.nodeResultStack)
    expect(CANVAS_LAYER.nodeResultStack).toBeGreaterThan(CANVAS_LAYER.groupPort)
  })

  it('canvas toolbars float above the node layer', () => {
    expect(CANVAS_LAYER.selectionToolbar).toBeGreaterThan(CANVAS_LAYER.nodes)
    expect(CANVAS_LAYER.groupToolbar).toBeGreaterThan(CANVAS_LAYER.nodes)
  })

  it('CSS variables injected on the canvas root are read from the table, not typed twice', () => {
    expect(CANVAS_LAYER_CSS_VARS).toEqual({
      '--canvas-z-nodes': String(CANVAS_LAYER.nodes),
      '--canvas-z-node-selected': String(CANVAS_LAYER.nodeSelected),
    })
  })

  it('no hard-coded z numbers come back in the files the table owns', () => {
    // 白名单：生成框内部的拖放层 z-[10] 只在生成框自己的局部上下文里生效，不参与画布跨层比较。
    const owned: Array<{ file: string; localZClasses: number }> = [
      { file: 'components/GroupFrame.tsx', localZClasses: 0 },
      { file: 'components/GroupFrameHeader.tsx', localZClasses: 0 },
      { file: 'components/CanvasGroupToolbar.tsx', localZClasses: 0 },
      { file: 'components/CanvasSelectionToolbar.tsx', localZClasses: 0 },
      { file: 'components/SelectionToolbarFrame.tsx', localZClasses: 0 },
      { file: 'nodes/NodeGenerationComposer.tsx', localZClasses: 1 },
      { file: 'nodes/TextNodeComposer.tsx', localZClasses: 0 },
      { file: 'reactFlow/generationCanvasReactFlowAdapter.ts', localZClasses: 0 },
    ]
    // 遍历「归表管的文件清单」：每个文件的 z-[n] 类个数与数字 zIndex 都要过守卫。
    for (const { file, localZClasses } of owned) {
      const text = source(file)
      expect(text.match(/\bz-\[-?\d+\]/g)?.length ?? 0, `${file} z-[n] classes`).toBe(localZClasses)
      expect(text, `${file} must not write a numeric zIndex literal`).not.toMatch(/zIndex:\s*-?\d/)
    }
    const css = source('reactFlow/generationCanvasReactFlow.css')
    expect(css).not.toMatch(/\.react-flow__nodes\s*\{\s*z-index:\s*\d/)
    expect(css).not.toMatch(/react-flow__node\.selected\s*\{\s*z-index:\s*\d/)
  })
})
