import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { composerCanvasPlacement } from './composerCanvasPlacement'
import { NODE_COMPOSER_GAP, NODE_COMPOSER_WIDTH, TEXT_COMPOSER_GAP, TEXT_COMPOSER_MAX_WIDTH, TEXT_COMPOSER_MIN_WIDTH } from './nodeSizing'

/**
 * 把 CSS 变换在屏幕上的效果算出来：节点左上角在屏幕 (nodeX, nodeY)、画布缩放 zoom。
 * 浮框局部点 p → translateX(-50% × 自身宽) → scale(1/zoom)（原点=浮框左上角）→ 放到节点内 (left, top) →
 * 再被画布缩放 zoom 放大到屏幕。
 */
function screenRect(visualSize: { width: number; height: number }, zoom: number, node = { x: 200, y: 120 }) {
  const placement = composerCanvasPlacement(visualSize, zoom)
  const scale = Number(/scale\(([^)]+)\)/.exec(placement.transform)?.[1])
  const localLeft = -placement.width / 2
  const canvasLeft = placement.left + localLeft * scale
  const canvasRight = placement.left + (localLeft + placement.width) * scale
  return {
    left: node.x + canvasLeft * zoom,
    right: node.x + canvasRight * zoom,
    top: node.y + placement.top * zoom,
    nodeCenterX: node.x + (visualSize.width / 2) * zoom,
    nodeBottom: node.y + visualSize.height * zoom,
  }
}

/** 剥掉注释再扫：注释里提到这些符号（记录历史的那几行）不算调用（check:walkthroughs「结构测试须剥注释」）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('composerCanvasPlacement', () => {
  it('reported case: a 16:9 image node at 100% gets a 560px card centred right below it', () => {
    const rect = screenRect({ width: 320, height: 180 }, 1)
    expect(rect.right - rect.left).toBe(NODE_COMPOSER_WIDTH)
    expect((rect.left + rect.right) / 2).toBe(rect.nodeCenterX)
    expect(rect.top).toBe(rect.nodeBottom + NODE_COMPOSER_GAP)
  })

  it('class: for any node size and any zoom, screen width is constant and the card stays centred below the node', () => {
    const sizes = [{ width: 200, height: 148.5 }, { width: 320, height: 180 }, { width: 180, height: 320 }, { width: 680, height: 290 }]
    const zooms = [0.1, 0.25, 0.6, 1, 1.4, 2, 4]
    for (const size of sizes) {
      for (const zoom of zooms) {
        const rect = screenRect(size, zoom)
        expect(rect.right - rect.left).toBeCloseTo(NODE_COMPOSER_WIDTH, 6)
        expect((rect.left + rect.right) / 2).toBeCloseTo(rect.nodeCenterX, 6)
        expect(rect.top).toBeCloseTo(rect.nodeBottom + NODE_COMPOSER_GAP * zoom, 6)
      }
    }
  })

  it('never produces a non-finite transform for a broken zoom', () => {
    for (const zoom of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(composerCanvasPlacement({ width: 320, height: 180 }, zoom).transform).toBe('scale(1) translateX(-50%)')
    }
  })

  it('文本加工框：和节点同宽（屏幕宽夹在上下限里）、紧贴在下面（间距 8），位置仍只是节点尺寸与缩放的函数', () => {
    const wide = composerCanvasPlacement({ width: 404, height: 120 }, 1, 'match-node')
    expect(wide.width).toBe(404)
    expect(wide.top).toBe(120 + TEXT_COMPOSER_GAP)
    expect(wide.left).toBe(202)
    // 缩小到看不清时不跟着缩成一条缝；放大到比标准浮框还宽时不撑出 560。
    expect(composerCanvasPlacement({ width: 404, height: 120 }, 0.4, 'match-node').width).toBe(TEXT_COMPOSER_MIN_WIDTH)
    expect(composerCanvasPlacement({ width: 404, height: 120 }, 3, 'match-node').width).toBe(TEXT_COMPOSER_MAX_WIDTH)
    // 标准（图片 / 视频）浮框一个字不变。
    expect(composerCanvasPlacement({ width: 404, height: 120 }, 1).width).toBe(NODE_COMPOSER_WIDTH)
  })

  // 不变量的结构面：浮框这一侧不许再长回「量屏幕 → 躲东西」的放置层。
  it('the canvas composer derives its position without measuring the screen', () => {
    // 画布宿主的定位锚住在 composerAnchor.tsx（图片 / 视频卡与文本加工框共用同一个锚）。
    const anchor = stripComments(fs.readFileSync(path.join(__dirname, 'composerAnchor.tsx'), 'utf8'))
    expect(anchor).toContain('composerCanvasPlacement(visualSize, canvasZoom, placement)')
    for (const file of ['composerAnchor.tsx', 'NodeGenerationComposer.tsx']) {
      const source = stripComments(fs.readFileSync(path.join(__dirname, file), 'utf8'))
      for (const forbidden of ['getBoundingClientRect', 'requestAnimationFrame', 'resolveAnchoredPlacement', 'w-max']) {
        expect(source, `${file} ${forbidden}`).not.toContain(forbidden)
      }
    }
  })
})
