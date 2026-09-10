import { expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../../../model/generationCanvasTypes'
import { collectCanvasImages } from './canvasImages'

it('collects image results independently of node kind and includes deduplicated history', () => {
  const nodes: GenerationCanvasNode[] = [
    { id: 'asset', kind: 'asset', title: 'Asset', position: { x: 0, y: 0 }, result: { id: 'a', type: 'image', url: 'nomi-local://a.png', createdAt: 1 } },
    { id: 'image', kind: 'image', title: 'Image', position: { x: 0, y: 0 }, result: { id: 'b', type: 'image', url: 'nomi-local://b.png', createdAt: 2 }, history: [
      { id: 'b', type: 'image', url: 'nomi-local://b.png', createdAt: 2 },
      { id: 'c', type: 'image', url: 'nomi-local://c.png', createdAt: 1 },
      { id: 'v', type: 'video', url: 'nomi-local://v.mp4', createdAt: 1 },
    ] },
  ]
  const images = collectCanvasImages(nodes)
  expect(images.map(image => image.url)).toEqual(['nomi-local://a.png', 'nomi-local://b.png', 'nomi-local://c.png'])
  expect(images[2].historical).toBe(true)
  expect(new Set(images.map(image => image.id)).size).toBe(3)
})
