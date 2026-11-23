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
  it('projects curated group names in the active interface language', () => {
    const item = { curation: { group: { 'zh-CN': '表情预设', en: 'Expressions' } } } as Parameters<typeof libraryGroup>[0]
    expect(libraryGroup(item, 'zh-CN')).toEqual({ id: 'category:Expressions', label: '表情预设' })
    expect(libraryGroup(item, 'en')).toEqual({ id: 'category:Expressions', label: 'Expressions' })
  })
  it('localizes built-in and Chinese-labeled public source group names for zh-CN and en without changing stable ids', () => {
    const expr = { origin: 'public', sourceId: 'builtin-expressions', source: '表情预设' }
    expect(libraryGroup(expr, 'zh-CN')).toEqual({ id: 'source:builtin-expressions', label: '表情预设' })
    expect(libraryGroup(expr, 'en')).toEqual({ id: 'source:builtin-expressions', label: 'Expressions' })

    const gpt4o = { origin: 'public', sourceId: 'imgedify-gpt4o', source: 'GPT-4o 图像' }
    expect(libraryGroup(gpt4o, 'zh-CN')).toEqual({ id: 'source:imgedify-gpt4o', label: 'GPT-4o 图像' })
    expect(libraryGroup(gpt4o, 'en')).toEqual({ id: 'source:imgedify-gpt4o', label: 'GPT-4o Image' })

    const sora = { origin: 'public', sourceId: 'sora-official', source: 'Sora 官方' }
    expect(libraryGroup(sora, 'zh-CN')).toEqual({ id: 'source:sora-official', label: 'Sora 官方' })
    expect(libraryGroup(sora, 'en')).toEqual({ id: 'source:sora-official', label: 'Sora Official' })
  })
})
