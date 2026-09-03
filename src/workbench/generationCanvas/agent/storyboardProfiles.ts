import type { StoryboardProfile } from './storyboardPlan'

/** skill.json 的两个内置片种模板；profile 只声明文本骨架，不另存结构化列。 */
export const STORYBOARD_PROFILES: Record<string, StoryboardProfile> = {
  'genre.short-drama': {
    aspect: '9:16',
    dialogue: true,
    promptSkeleton: [
      { key: 'shotSize', label: 'storyboardEditor.promptSkeleton.segment.shotSize', kind: 'enum', options: ['远景', '全景', '中景', '近景', '特写'] },
      { key: 'emotion', label: 'storyboardEditor.promptSkeleton.segment.emotion', kind: 'enum', options: ['紧张', '温柔', '压抑', '轻松', '孤独'] },
    ],
  },
  'genre.free-form': {
    aspect: '16:9',
    dialogue: false,
    promptSkeleton: [],
  },
}

export function storyboardProfileForKey(key?: string): StoryboardProfile {
  const profile = STORYBOARD_PROFILES[key || 'genre.free-form'] ?? STORYBOARD_PROFILES['genre.free-form']
  return {
    ...profile,
    promptSkeleton: profile.promptSkeleton.map((segment) => ({ ...segment, options: [...segment.options] })),
  }
}

export function profileKeyForStoryboardProfile(profile: StoryboardProfile): string | undefined {
  return Object.entries(STORYBOARD_PROFILES).find(([, candidate]) => JSON.stringify(candidate) === JSON.stringify(profile))?.[0]
}
