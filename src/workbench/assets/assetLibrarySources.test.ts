import { describe, expect, it } from 'vitest'
import type { AssetRef } from './assetTypes'
import {
  filterCanvasLibraryAssets,
  filterImageVideoAssets,
  filterPlayableAssets,
} from './assetLibrarySources'
import { buildNomiLocalAssetUrl, parseNomiLocalAssetUrl } from '../../media/nomiLocalAssetUrl'

function projectAsset(input: {
  id: string
  projectId: string
  relativePath: string
  kind?: AssetRef['kind']
  ownerNodeId?: string
}): AssetRef {
  return {
    id: input.id,
    kind: input.kind ?? 'image',
    name: input.relativePath,
    renderUrl: `nomi-local://asset/${encodeURIComponent(input.projectId)}/${input.relativePath}`,
    ownerNodeId: input.ownerNodeId,
    source: 'project',
    origin: { source: 'project', projectId: input.projectId, relativePath: input.relativePath },
  }
}

describe('asset library sources', () => {
  it('全部素材只保留所有项目中的图片和视频', () => {
    const assets = [
      projectAsset({ id: 'image', projectId: 'a', relativePath: 'a.png' }),
      projectAsset({ id: 'video', projectId: 'b', relativePath: 'b.mp4', kind: 'video' }),
      projectAsset({ id: 'audio', projectId: 'b', relativePath: 'b.mp3', kind: 'audio' }),
    ]
    expect(filterImageVideoAssets(assets).map((asset) => asset.id)).toEqual(['image', 'video'])
  })

  it('includes 3D in the canvas library but keeps it out of timeline-playable assets', () => {
    const assets = [
      projectAsset({ id: 'image', projectId: 'a', relativePath: 'a.png' }),
      projectAsset({ id: 'audio', projectId: 'a', relativePath: 'a.mp3', kind: 'audio' }),
      projectAsset({ id: 'model3d', projectId: 'a', relativePath: 'a.glb', kind: 'model3d' }),
    ]

    expect(filterCanvasLibraryAssets(assets).map((asset) => asset.id)).toEqual(['image', 'model3d'])
    expect(filterPlayableAssets(assets).map((asset) => asset.id)).toEqual(['image', 'audio'])
  })

  it('解析带编码的跨项目 nomi-local 素材地址', () => {
    expect(parseNomiLocalAssetUrl('nomi-local://asset/project%20a/assets/generated/%E7%8C%AB.png?thumb=1')).toEqual({
      projectId: 'project a',
      relativePath: 'assets/generated/猫.png',
    })
  })

  it('逐段编码项目内相对路径，拒绝目录穿越', () => {
    expect(buildNomiLocalAssetUrl('project a', 'assets/generated/猫 1.png')).toBe(
      'nomi-local://asset/project%20a/assets/generated/%E7%8C%AB%201.png',
    )
    expect(() => buildNomiLocalAssetUrl('project-a', '../secret.txt')).toThrow('Unsafe local asset path')
  })
})
