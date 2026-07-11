import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import type { AssetRef } from './assetTypes'
import {
  buildAssetLibraryDeletePlan,
  filterImageVideoAssets,
  parseNomiLocalAssetUrl,
} from './assetLibrarySources'

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

  it('解析带编码的跨项目 nomi-local 素材地址', () => {
    expect(parseNomiLocalAssetUrl('nomi-local://asset/project%20a/assets/generated/%E7%8C%AB.png?thumb=1')).toEqual({
      projectId: 'project a',
      relativePath: 'assets/generated/猫.png',
    })
  })

  it('删除当前画布素材时同步生成画布节点和跨项目落盘文件计划', () => {
    const crossProjectUrl = 'nomi-local://asset/project-a/assets/generated/a.png'
    const ownedUrl = 'nomi-local://asset/project-b/assets/generated/b.png'
    const nodes = [
      {
        id: 'node-cross',
        result: { id: 'r1', type: 'image', url: crossProjectUrl, createdAt: 1 },
      },
      {
        id: 'node-owned',
        result: { id: 'r2', type: 'image', url: ownedUrl, createdAt: 2 },
      },
    ] as GenerationCanvasNode[]
    const selectedAssets: AssetRef[] = nodes.map((node) => ({
      id: node.id,
      kind: 'image',
      name: node.id,
      renderUrl: node.result!.url!,
      source: 'canvas',
      origin: { source: 'canvas', nodeId: node.id },
    }))
    const allProjectAssets = [
      projectAsset({ id: 'a', projectId: 'project-a', relativePath: 'assets/generated/a.png' }),
      projectAsset({ id: 'b', projectId: 'project-b', relativePath: 'assets/generated/b.png', ownerNodeId: 'node-owned' }),
      projectAsset({ id: 'unrelated', projectId: 'project-b', relativePath: 'assets/generated/keep.png' }),
    ]

    const plan = buildAssetLibraryDeletePlan({
      selectedAssets,
      canvasNodes: nodes,
      allProjectAssets,
      currentProjectId: 'project-b',
    })

    expect(plan.nodeIds).toEqual(['node-cross', 'node-owned'])
    expect(plan.fileTargets).toEqual(expect.arrayContaining([
      { projectId: 'project-a', relativePath: 'assets/generated/a.png' },
      { projectId: 'project-b', relativePath: 'assets/generated/b.png' },
    ]))
    expect(plan.fileTargets).not.toContainEqual({
      projectId: 'project-b',
      relativePath: 'assets/generated/keep.png',
    })
  })
})
