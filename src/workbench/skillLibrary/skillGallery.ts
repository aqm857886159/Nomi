import { libraryGroup, type LibraryCategory } from '../library/libraryGroups'
import type { SkillListItemDto } from '../api/skillApi'
import type { LibraryPrompt } from '../api/promptLibraryApi'
import { promptDisplayTitle } from '../promptLibrary/promptDisplay'
import { matchesLibraryQuery } from '../library/libraryDiscovery'
import { skillDisplayTitle } from './skillDisplay'

export type SkillGalleryEntry = {
  id: string
  group?: LibraryCategory
  title: string
  description: string
  body: string
  kind: 'skill' | 'prompt' | 'effect'
  cover?: string
  preview?: SkillListItemDto['preview']
  source?: string
  author?: string
  license?: string
  upstream?: boolean
  skill?: SkillListItemDto
  prompt?: LibraryPrompt
}
export function galleryEntries(skills: readonly SkillListItemDto[], prompts: readonly LibraryPrompt[], language: string): SkillGalleryEntry[] {
  const locale = language.startsWith('zh') ? 'zh-CN' : 'en'
  return [
    ...skills.filter(s => s.curation?.kind !== 'effect').map(skill => ({
      id: `skill:${skill.name}`, group: libraryGroup(skill, language), title: skillDisplayTitle(skill, language),
      description: skill.curation?.summary[locale] ?? skill.description ?? '', body: skill.body ?? '', kind: 'skill' as const,
      cover: skill.cover, preview: skill.preview, source: skill.curation?.source.url,
      author: skill.curation?.source.author ?? skill.author ?? undefined, license: skill.curation?.license,
      upstream: skill.curation?.preview?.provenance === 'upstream-output', skill,
    })),
    ...prompts.map(prompt => ({
      id: `prompt:${prompt.id}`, group: libraryGroup(prompt, language), title: prompt.curation?.title[locale] ?? promptDisplayTitle(prompt),
      description: prompt.curation?.summary[locale] ?? prompt.prompt, body: prompt.prompt,
      kind: prompt.curation?.kind === 'effect' ? 'effect' as const : 'prompt' as const,
      cover: prompt.mediaType === 'image' ? prompt.mediaUrl : undefined,
      preview: prompt.mediaUrl ? { url: prompt.mediaUrl, type: prompt.mediaType } : undefined,
      source: prompt.sourceUrl, author: prompt.curation?.source.author, license: prompt.curation?.license,
      upstream: prompt.curation?.preview?.provenance === 'upstream-output', prompt,
    })),
  ]
}
export function galleryBody(entry: SkillGalleryEntry): string {
  if (entry.prompt) return entry.body.trim()
  const blocks = entry.body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim().split(/\n\s*\n/)
  if (blocks[0] === `# ${entry.title}`) blocks.shift()
  if (blocks[0] === entry.description) blocks.shift()
  return blocks.join('\n\n')
}

const PROVIDER_SEARCH_ALIASES: Record<string, readonly string[]> = {
  text: ['text', '文本', '文字'],
  image: ['image', '图像', '图片'],
  video: ['video', '视频'],
  audio: ['audio', '音频'],
}

export function matchesGalleryQuery(entry: SkillGalleryEntry, query: string): boolean {
  return matchesLibraryQuery({
    title: entry.title, description: entry.description, tags: entry.prompt?.tags,
    keywords: [entry.skill?.name ?? '', ...(entry.skill?.neededProviders ?? []).flatMap(provider => PROVIDER_SEARCH_ALIASES[provider] ?? [provider])],
  }, query)
}
