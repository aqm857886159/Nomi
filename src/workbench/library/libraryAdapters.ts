import type { SkillListItemDto } from '../api/skillApi'
import type { LocalProjectSummary } from './localProjectStore'
import { matchesLibraryQuery } from './libraryDiscovery'

export type SkillLibrarySource = 'mine' | 'builtin'
export type SkillLibraryCategory = 'all' | 'playbook' | 'assistant'

const PROVIDER_SEARCH_ALIASES: Record<string, readonly string[]> = {
  text: ['text', '文本', '文字'],
  image: ['image', '图像', '图片'],
  video: ['video', '视频'],
  audio: ['audio', '音频'],
}

export function filterProjectLibraryItems(projects: readonly LocalProjectSummary[], query: string): LocalProjectSummary[] {
  return projects.filter((project) => matchesLibraryQuery({
    title: project.name,
    // Search only user-facing identity/source labels; never index absolute
    // filesystem paths into the renderer discovery surface.
    keywords: [project.source ?? ''],
  }, query))
}

export function filterSkillLibraryItems(
  items: readonly SkillListItemDto[],
  options: { source: SkillLibrarySource; category: SkillLibraryCategory; query: string },
): SkillListItemDto[] {
  const byScope = items.filter((skill) => options.source === 'mine' ? skill.origin === 'user' : skill.origin === 'builtin')
  const byCategory = byScope.filter((skill) => options.category === 'all' || (options.category === 'playbook' ? skill.isPlaybook : !skill.isPlaybook))
  return byCategory.filter((skill) => matchesLibraryQuery({
    title: skill.label,
    description: skill.description,
    keywords: [
      skill.name,
      ...skill.neededProviders.flatMap((provider) => PROVIDER_SEARCH_ALIASES[provider] ?? [provider]),
      skill.isPlaybook ? 'playbook' : 'assistant',
      skill.isPlaybook ? '流程包' : '助手',
    ],
  }, options.query))
}
