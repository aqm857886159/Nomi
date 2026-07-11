import { describe, expect, it } from 'vitest'
import type { AssetRef } from './assetTypes'
import { composeAssetPoolSources } from './useAssetPool'

function asset(overrides: Partial<AssetRef> & Pick<AssetRef, 'id' | 'renderUrl' | 'origin'>): AssetRef {
  return {
    kind: 'image',
    name: overrides.id,
    source: overrides.origin.source,
    ...overrides,
  }
}

describe('composeAssetPoolSources', () => {
  it('全部素材去重时保留画布来源，但项目素材仍保留独立的落盘文件来源', () => {
    const canvas = asset({
      id: 'node-1',
      renderUrl: 'nomi-local://asset/project-a/assets/generated/a.png',
      origin: { source: 'canvas', nodeId: 'node-1' },
    })
    const projectFile = asset({
      id: 'assets/generated/a.png',
      renderUrl: canvas.renderUrl,
      origin: { source: 'project', projectId: 'project-a', relativePath: 'assets/generated/a.png' },
    })

    const result = composeAssetPoolSources([canvas], [projectFile])

    expect(result.assets).toEqual([canvas])
    expect(result.canvasAssets).toEqual([canvas])
    expect(result.projectAssets).toEqual([projectFile])
  })
})
