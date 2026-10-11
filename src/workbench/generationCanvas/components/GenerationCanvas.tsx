import React, { type JSX } from 'react'
import { lazyWithChunkBoundary } from '../../../ui/chunkBoundary'
import '../styles/generationCanvas.css'

type GenerationCanvasProps = {
  readOnly?: boolean
}

export const preloadGenerationCanvas = () => import('../reactFlow/GenerationCanvasReactFlow')
const GenerationCanvasReactFlow = lazyWithChunkBoundary('React Flow 画布', preloadGenerationCanvas)

/** The generation canvas has one renderer; the store remains its data source. */
export default function GenerationCanvas(props: GenerationCanvasProps): JSX.Element {
  return (
    <React.Suspense fallback={null}>
      <GenerationCanvasReactFlow {...props} />
    </React.Suspense>
  )
}
