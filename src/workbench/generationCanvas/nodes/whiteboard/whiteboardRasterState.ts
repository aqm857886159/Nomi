import { getCanvasDimensions, type CanvasDimensions } from './lib/canvas'
import type { WhiteboardState } from './whiteboardTypes'

/** The board's document size: the stored size, or the ratio's default for boards saved before sizes were stored. */
export function whiteboardCanvasDimensions(state: Pick<WhiteboardState, 'canvasDimensions' | 'activeRatio'>): CanvasDimensions {
  return state.canvasDimensions ?? getCanvasDimensions(state.activeRatio, 1280)
}

/** Selection and layer labels do not change pixels and must not create a new result version. */
export function whiteboardRasterStateKey(state: WhiteboardState): string {
  return JSON.stringify({
    dimensions: whiteboardCanvasDimensions(state),
    assets: state.canvasAssets,
    strokes: state.strokes,
    texts: state.texts ?? [],
    transforms: state.sceneTransforms ?? { offsets: {}, assetTransforms: {}, flips: {} },
    layers: state.layers.map(({ name: _name, thumbnail: _thumbnail, ...layer }) => layer),
  })
}

/** Whether the board would export anything a creator drew or placed: brush paths, images or non-blank text. Eraser paths alone are not content. */
export function whiteboardHasVisibleContent(state: WhiteboardState): boolean {
  return state.canvasAssets.length > 0
    || state.strokes.some((stroke) => stroke.tool === 'brush')
    || (state.texts ?? []).some((text) => text.text.trim().length > 0)
}
