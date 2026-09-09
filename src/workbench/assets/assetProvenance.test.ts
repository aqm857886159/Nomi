import { describe, expect, it } from 'vitest'
import {
  ASSET_PROVENANCE_VALUES,
  assetProvenanceOf,
  countAssetProvenance,
  toggleAssetProvenance,
} from './assetProvenance'
import type { AssetRef } from './assetTypes'

function projectAsset(relativePath: string): AssetRef {
  return {
    id: relativePath,
    kind: 'video',
    name: relativePath.split('/').pop() ?? relativePath,
    renderUrl: 'nomi-local://x',
    source: 'project',
    origin: { source: 'project', projectId: 'p1', relativePath },
  }
}

const canvasAsset: AssetRef = {
  id: 'node-1',
  kind: 'image',
  name: 'shot.png',
  renderUrl: 'nomi-local://y',
  source: 'canvas',
  origin: { source: 'canvas', nodeId: 'node-1' },
}

describe('assetProvenanceOf', () => {
  it('只有 assets/reference/ 下的算参考', () => {
    expect(assetProvenanceOf(projectAsset('assets/reference/2026-09-08/douyin-ref-1.mp4'))).toBe('reference')
    expect(assetProvenanceOf(projectAsset('assets/imported/2026-09-08/upload.mp4'))).toBe('mine')
    expect(assetProvenanceOf(projectAsset('assets/generated/2026-09-08/shot.png'))).toBe('mine')
    expect(assetProvenanceOf(projectAsset('reference/loose.mp4'))).toBe('mine')
    expect(assetProvenanceOf(canvasAsset)).toBe('mine')
  })
})

describe('countAssetProvenance', () => {
  it('两个来源都有计数，空的也报 0（漏斗里不会出现缺项）', () => {
    const counts = countAssetProvenance([
      projectAsset('assets/reference/a.mp4'),
      projectAsset('assets/imported/b.mp4'),
      projectAsset('assets/imported/c.mp4'),
    ])
    expect([...counts.keys()].sort()).toEqual([...ASSET_PROVENANCE_VALUES].sort())
    expect(counts.get('reference')).toBe(1)
    expect(counts.get('mine')).toBe(2)
    expect(countAssetProvenance([]).get('reference')).toBe(0)
  })
})

describe('toggleAssetProvenance', () => {
  it('最后一项取消不掉（否则用户得到一片空列表且看不见原因）', () => {
    const both = new Set<'mine' | 'reference'>(['mine', 'reference'])
    expect([...toggleAssetProvenance(both, 'mine')]).toEqual(['reference'])
    const only = new Set<'mine' | 'reference'>(['reference'])
    expect([...toggleAssetProvenance(only, 'reference')]).toEqual(['reference'])
    expect([...toggleAssetProvenance(only, 'mine')].sort()).toEqual(['mine', 'reference'])
  })
})
