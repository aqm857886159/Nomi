import { describe, expect, it } from 'vitest'
import {
  assetBelongsToProject,
  canManageAssetFolders,
  nextAssetSelection,
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

describe('nextAssetSelection — 项目素材的选择规则', () => {
  const ids = ['a', 'b', 'c', 'd']
  const plain = { metaKey: false, ctrlKey: false, shiftKey: false }
  const tick = { metaKey: false, ctrlKey: true, shiftKey: false }

  it('对勾（与 ⌘/Ctrl 点同语义）能加选第二张，再点能取消——此前对勾等于普通点，只会换选', () => {
    const one = nextAssetSelection(new Set(), ids, 'a', null, tick)
    const two = nextAssetSelection(one, ids, 'c', 'a', tick)
    expect([...two]).toEqual(['a', 'c'])
    const back = nextAssetSelection(two, ids, 'c', 'c', tick)
    expect([...back]).toEqual(['a'])
    expect([...nextAssetSelection(back, ids, 'a', 'a', tick)]).toEqual([])
  })

  it('普通点仍是换选；Shift 从锚点连选', () => {
    expect([...nextAssetSelection(new Set(['a', 'c']), ids, 'b', 'a', plain)]).toEqual(['b'])
    expect([...nextAssetSelection(new Set(['a']), ids, 'c', 'a', { ...plain, shiftKey: true })]).toEqual(['a', 'b', 'c'])
    const same = new Set(['b'])
    expect(nextAssetSelection(same, ids, 'b', 'b', plain)).toBe(same)
  })
})
