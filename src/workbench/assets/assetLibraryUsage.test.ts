import { describe, expect, it } from 'vitest'
import {
  assetBelongsToProject,
  canManageAssetFolders,
  resolveAssetLibraryItemAction,
  shouldRunAssetItemAction,
  sourceOptionsForUsage,
} from './assetLibraryUsage'

describe('asset library usage context', () => {
  it('gives every visible card one meaningful primary action', () => {
    expect(resolveAssetLibraryItemAction('canvas', 'all')).toBe('preview')
    expect(resolveAssetLibraryItemAction('canvas', 'project')).toBe('select')
    expect(resolveAssetLibraryItemAction('timeline', 'all')).toBe('append')
    expect(resolveAssetLibraryItemAction('timeline', 'project')).toBe('append')
  })

  it('keeps folder mutation in the canvas asset manager only', () => {
    expect(canManageAssetFolders('canvas')).toBe(true)
    expect(canManageAssetFolders('timeline')).toBe(false)
  })

  it('offers the same asset source tabs in canvas and Preview', () => {
    expect(sourceOptionsForUsage('canvas').map((option) => option.value)).toEqual(['all', 'project'])
    expect(sourceOptionsForUsage('timeline').map((option) => option.value)).toEqual(['all', 'project'])
  })

  it('ignores the second click emitted by a timeline double-click', () => {
    expect(shouldRunAssetItemAction('append', 1)).toBe(true)
    expect(shouldRunAssetItemAction('append', 2)).toBe(false)
    expect(shouldRunAssetItemAction('select', 2)).toBe(true)
  })

  it('keeps external project files out of current-project writes', () => {
    expect(assetBelongsToProject({ origin: { source: 'project', projectId: 'current', relativePath: 'a.png' } }, 'current')).toBe(true)
    expect(assetBelongsToProject({ origin: { source: 'project', projectId: 'other', relativePath: 'a.png' } }, 'current')).toBe(false)
    expect(assetBelongsToProject({ origin: { source: 'canvas', nodeId: 'n1' } }, 'current')).toBe(true)
  })
})
