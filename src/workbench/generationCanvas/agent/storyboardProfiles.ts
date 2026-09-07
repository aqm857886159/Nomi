import type { StoryboardProfile } from './storyboardPlan'

/**
 * 两个内置片种模板 —— 这份 TS 表就是唯一真相源。
 *
 * 2026-09-07 更正一条说了很久的谎：这里原本写着「skill.json 的两个内置片种模板」，
 * 而 `skills/workbench-storyboard-planner/skill.json` 里确实有过一个同名的
 * `storyboardProfile` 块——但它从来没有被读过。它不在 manifest 的 zod schema 里，
 * 解析时被静默剥掉，从未进入 SkillRecord。两份甚至已经漂了（那边写中文字面量
 * 「景别·运镜」，这边是 i18n key）。清单退场时那个块一并删掉，这里补上实情。
 *
 * profile 只声明文本骨架，不另存结构化列。
 */
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
