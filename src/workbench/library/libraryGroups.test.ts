import { describe, expect, it } from 'vitest'
import { groupLibraryItems, libraryGroup } from './libraryGroups'

const variants = (count: number, category = 'Expressions') => Array.from({ length: count }, (_, i) => ({ id: `${category}-${i}`, group: { id: category, label: category } }))
describe('C20 library category projection', () => {
  it('projects twelve variants as one collapsed group without losing any choice', () => {
    const input = variants(12)
    const groups = groupLibraryItems(input, item => item.group)
    expect(groups).toHaveLength(1)
    expect(groups[0].collapsed).toBe(true)
    expect(groups[0].items).toEqual(input)
  })
  it('uses the same greater-than-four boundary for other categories', () => {
    expect(groupLibraryItems(variants(4, 'Camera'), item => item.group)[0].collapsed).toBe(false)
    expect(groupLibraryItems(variants(5, 'Camera'), item => item.group)[0].collapsed).toBe(true)
  })
  it('collects interleaved variants, preserves first occurrence and keeps uncategorized choices distinct', () => {
    const a = variants(6), b = variants(6, 'Camera')
    const input = [a[0], b[0], ...a.slice(1), ...b.slice(1), { id: 'user', group: undefined }]
    const groups = groupLibraryItems(input, item => item.group)
    expect(groups.map(g => g.items.length)).toEqual([6, 6, 1])
    expect(groups[2].collapsed).toBe(false)
    expect(groups.flatMap(g => g.items).map(i => i.id).sort()).toEqual(input.map(i => i.id).sort())
  })
  it('uses existing explicit categories or public source identity; never guesses from a title', () => {
    expect(libraryGroup({ sourceId: 'pack', source: 'Expressions', origin: 'public' }, 'en')).toEqual({ id: 'source:pack', label: 'Expressions' })
    expect(libraryGroup({ sourceId: 'user', source: 'My library', origin: 'user' }, 'en')).toBeUndefined()
    expect(libraryGroup({}, 'zh-CN')).toBeUndefined()
  })
})
