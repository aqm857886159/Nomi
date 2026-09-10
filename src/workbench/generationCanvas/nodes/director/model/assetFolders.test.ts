import { describe, expect, it } from 'vitest'
import { canMoveAssetFolder, matchingAssetFolders } from './assetFolders'

describe('asset folder ancestry', () => {
  const folders = [{ id: 'a', name: 'Models', parentId: null }, { id: 'b', name: 'Furniture', parentId: 'a' }, { id: 'c', name: 'Lights', parentId: null }]
  it('a matching nested asset reveals its entire ancestry and excludes unrelated folders', () => {
    const visible = matchingAssetFolders(folders, [{ id: 'chair', name: 'Red Chair', folderId: 'b', kind: 'model', url: 'chair.glb', createdAt: 1 }], 'chair')
    expect([...visible].sort()).toEqual(['a', 'b'])
    expect([...matchingAssetFolders(folders, [], 'furniture')].sort()).toEqual(['a', 'b'])
  })
  it('rejects parent loops already present in a supplied destination chain', () => {
    expect(canMoveAssetFolder([...folders, { id: 'loop', name: 'Loop', parentId: 'loop' }], 'a', 'loop')).toBe(false)
    expect(canMoveAssetFolder(folders, 'a', 'b')).toBe(false)
    expect(canMoveAssetFolder(folders, 'b', 'c')).toBe(true)
  })
})
