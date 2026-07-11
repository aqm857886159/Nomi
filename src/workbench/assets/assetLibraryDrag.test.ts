import { describe, expect, it } from 'vitest'
import {
  parseAssetLibraryDragItems,
  serializeAssetLibraryDrag,
  type AssetLibraryDragPayload,
} from './assetLibraryDrag'

describe('assetLibraryDrag', () => {
  it('round-trips multiple selected assets and the pointer anchor', () => {
    const payloads: AssetLibraryDragPayload[] = [
      {
        kind: 'image',
        name: 'a.png',
        renderUrl: 'nomi-local://project/assets/a.png',
        origin: { source: 'project', projectId: 'project-1', relativePath: 'assets/a.png' },
        dragAnchor: { xRatio: 0.25, yRatio: 0.75 },
      },
      {
        kind: 'video',
        name: 'b.mp4',
        renderUrl: 'nomi-local://project/assets/b.mp4',
        origin: { source: 'project', projectId: 'project-1', relativePath: 'assets/b.mp4' },
      },
    ]

    expect(parseAssetLibraryDragItems(serializeAssetLibraryDrag(payloads))).toEqual(payloads)
  })
})
