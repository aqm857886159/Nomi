import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')
const viewportPath = 'src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowViewport.tsx'
describe('React Flow owns the complete canvas zoom range', () => {
  it('exposes the shared minimum and maximum to the kernel, so card density is reachable', () => {
    const viewport = read(viewportPath)
    expect(viewport).toContain('minZoom={CANVAS_MIN_ZOOM}')
    expect(viewport).toContain('maxZoom={CANVAS_MAX_ZOOM}')
  })
  it('slider and explicit fit consume the same range without a second manual clamp', () => {
    const canvas = read('src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx')
    expect(canvas).toContain('CANVAS_MIN_ZOOM, CANVAS_MAX_ZOOM')
    expect(canvas).not.toContain('flow.zoomTo(Math.min')
    const navigation = read('src/workbench/generationCanvas/components/CanvasNavigationStack.tsx')
    expect(navigation).toContain('min={CANVAS_MIN_ZOOM * 100}')
    expect(navigation).toContain('max={CANVAS_MAX_ZOOM * 100}')
  })
})
