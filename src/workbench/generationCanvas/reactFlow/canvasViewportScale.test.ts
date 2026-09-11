import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { clipNodeClientDeltaToFrames } from '../nodes/clipNodeDragModel'
import {
  edgeLabelTransform,
  inverseViewportScale,
  selectFlowZoom,
  shotTableDensityForZoom,
} from './canvasViewportScale'

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

function productionSources(directory: string): Array<[path: string, contents: string]> {
  return readdirSync(directory, { withFileTypes: true }).flatMap(
    (entry): Array<[string, string]> => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return productionSources(path)
      if (!/\.[cm]?[jt]sx?$/.test(entry.name) || entry.name.includes('.test.')) return []
      return [[path, readFileSync(path, 'utf8')]]
    },
  )
}

describe('canvas viewport scale', () => {
  it('reads zoom off the React Flow transform and survives a degenerate transform', () => {
    expect(selectFlowZoom({ transform: [120, -40, 0.5] })).toBe(0.5)
    expect(selectFlowZoom({ transform: [0, 0, 0] })).toBe(1)
    expect(selectFlowZoom({ transform: [0, 0, Number.NaN] })).toBe(1)
  })

  it('moves a clip by the model delta the screen gesture really covered at 50% zoom', () => {
    // 50% 缩放下，屏幕上走 60px = 画布里走 120px。轴上 4px/帧 → 30 帧。
    // 迁移后这里喂进去的缩放恒是 1（store 的 canvasZoom 没人写），于是只走 15 帧 = 拖不到手指下面那一格。
    const zoom = selectFlowZoom({ transform: [0, 0, 0.5] })
    expect(clipNodeClientDeltaToFrames(60, 4, zoom)).toBe(30)
    expect(clipNodeClientDeltaToFrames(-60, 4, zoom)).toBe(-30)
    // 100% 缩放不受影响（回归保护：修完别把常规档也算歪了）。
    expect(clipNodeClientDeltaToFrames(60, 4, selectFlowZoom({ transform: [0, 0, 1] }))).toBe(15)
  })

  it('keeps viewport-space chrome at a constant screen size', () => {
    expect(inverseViewportScale(0.5)).toBe(2)
    expect(inverseViewportScale(2)).toBe(0.5)
    expect(inverseViewportScale(0)).toBe(1)
    expect(edgeLabelTransform(12, 34, 0.5)).toBe('translate(-50%, -50%) translate(12px, 34px) scale(2)')
    expect(edgeLabelTransform(0, 0, 1)).toBe('translate(-50%, -50%) translate(0px, 0px) scale(1)')
  })

  it('bands the shot table density instead of tracking every zoom frame', () => {
    expect(shotTableDensityForZoom(1)).toBe('full')
    expect(shotTableDensityForZoom(0.8)).toBe('full')
    expect(shotTableDensityForZoom(0.6)).toBe('compact')
    expect(shotTableDensityForZoom(0.4)).toBe('compact')
    expect(shotTableDensityForZoom(0.3)).toBe('card')
  })

  it('leaves exactly one zoom truth: the dead canvas-store viewport fields are gone', () => {
    // 这条是行 2 的根因门岗：只要有人再往 store 里塞一份视口，读的人就又会分成两拨，
    // 而「没人写」的那拨会静默地恒为 1（正是本次修的那个 bug 的长相）。
    for (const file of ['../store/canvasStoreTypes.ts', '../store/generationCanvasStore.ts']) {
      const contents = source(file)
      expect(contents).not.toContain('canvasZoom')
      expect(contents).not.toContain('canvasOffset')
    }
    const canvasRoot = fileURLToPath(new URL('..', import.meta.url))
    const offenders = productionSources(canvasRoot)
      .filter(([, contents]) => /setCanvasTransform|setCanvasZoom/.test(contents))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })
})
