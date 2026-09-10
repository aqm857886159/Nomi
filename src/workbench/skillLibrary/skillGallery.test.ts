import { describe, expect, it } from 'vitest'
import { galleryBody, galleryEntries, matchesGalleryQuery } from './skillGallery'
import type { SkillListItemDto } from '../api/skillApi'
import type { LibraryPrompt } from '../api/promptLibraryApi'

const skill: SkillListItemDto = {
  directoryName: 'external', name: 'external', label: 'External', description: 'Summary', author: null,
  stageLabels: [], isPlaybook: false, neededProviders: [], manifestError: null, origin: 'user', packageVersion: 'v1', contentHash: 'hash',
  body: '---\nname: external\n---\n\n# External\n\nSummary\n\n## Method\n\nDo the work.',
}
describe('skill gallery projection', () => {
  it('preserves name, provider aliases and multi-term search in the new gallery', () => {
    const [entry] = galleryEntries([{ ...skill, neededProviders: ['image'] }], [], 'en')
    expect(matchesGalleryQuery(entry, 'external 图像')).toBe(true)
    expect(matchesGalleryQuery(entry, 'image summary')).toBe(true)
    expect(matchesGalleryQuery(entry, 'video')).toBe(false)
  })
  it('keeps old external Skills without covers and displays their complete body without frontmatter', () => {
    const [entry] = galleryEntries([skill], [], 'en')
    expect(entry.cover).toBeUndefined()
    expect(galleryBody(entry)).toBe('## Method\n\nDo the work.')
  })
  it('preserves video previews and full prompt descriptions', () => {
    const prompt: LibraryPrompt = { id: 'video', title: 'Video', prompt: '**Complete prompt**', mediaUrl: 'nomi-local://asset/demo.mp4', mediaType: 'video', promptType: 'video', tags: [], source: 'mine', sourceId: '', sourceUrl: '', origin: 'user' }
    const [entry] = galleryEntries([], [prompt], 'zh-CN')
    expect(entry.description).toBe(prompt.prompt)
    expect(galleryBody(entry)).toBe(prompt.prompt.trim())
    expect(entry.preview).toEqual({ url: prompt.mediaUrl, type: 'video' })
    expect(entry.cover).toBeUndefined()
  })
})
