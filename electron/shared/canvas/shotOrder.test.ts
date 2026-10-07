import { describe, expect, it } from 'vitest'
import { previousShotPromptFor } from './shotOrder'

// 这一层守的是「审片环对外说三轴、实际只跑两轴」——连贯轴拿不到上一镜就恒不评。
// 反向铁律同样重要：判不出上一镜时宁可不评，也不要拿错的镜去比（会凭空判出断裂 + 触发白烧的重滚）。

const shot = (id: string, shotIndex: number | undefined, prompt: string, categoryId = 'shots') => ({
  id, shotIndex, prompt, categoryId, kind: 'video',
})

describe('previousShotPromptFor', () => {
  const CANVAS = [
    shot('s1', 1, '挂钟特写，指针停在 2:17'),
    shot('s2', 2, '她抬头看向玻璃门'),
    shot('s3', 3, '镜头推向玻璃门，地面浮现湿脚印'),
  ]

  it('中间那镜 → 拿到紧邻的上一镜（不是第一镜、也不是随便哪镜）', () => {
    expect(previousShotPromptFor(CANVAS, 's3')).toBe('她抬头看向玻璃门')
  })

  it('首镜 → 无上一镜（首镜不该因为「接不上」被扣分）', () => {
    expect(previousShotPromptFor(CANVAS, 's1')).toBeUndefined()
  })

  it('镜号有断档（2 被删了）→ 取剩下里最大的那个，不是硬找 index-1', () => {
    const gapped = [shot('s1', 1, '挂钟'), shot('s5', 5, '街上的背影')]
    expect(previousShotPromptFor(gapped, 's5')).toBe('挂钟')
  })

  it('★不占镜号的节点（参考卡/首帧图）→ 无上一镜，且自己也不会被当成别人的上一镜', () => {
    const withCard = [
      { id: 'card', kind: 'image', prompt: '小周定妆：短发圆脸', categoryId: 'cast' },
      ...CANVAS,
    ]
    expect(previousShotPromptFor(withCard, 'card')).toBeUndefined()
    expect(previousShotPromptFor(withCard, 's2')).toBe('挂钟特写，指针停在 2:17')
  })

  it('★跨分类不串：cast 里的高镜号不会被当成 shots 的上一镜', () => {
    const mixed = [shot('c9', 9, '另一条线的镜头', 'cast'), ...CANVAS]
    expect(previousShotPromptFor(mixed, 's2')).toBe('挂钟特写，指针停在 2:17')
  })

  it('上一镜没写提示词 → 跳过它往前找（空提示词当参照物等于没有参照物）', () => {
    const blank = [shot('s1', 1, '挂钟'), shot('s2', 2, '   '), shot('s3', 3, '街上')]
    expect(previousShotPromptFor(blank, 's3')).toBe('挂钟')
  })

  it('找不到该节点 / 空画布 → undefined，不炸', () => {
    expect(previousShotPromptFor(CANVAS, 'nope')).toBeUndefined()
    expect(previousShotPromptFor([], 's1')).toBeUndefined()
  })
})


it('paired first frame uses its video owner number and previous owner prompt, even across a gap', () => {
  const nodes = [shot('v1', 1, 'previous video'), shot('v3', 3, 'current video'),
    { id: 'f1', kind: 'image', meta: { storyboardKeyframe: true }, prompt: 'previous frame' },
    { id: 'f3', kind: 'image', meta: { storyboardKeyframe: true }, prompt: 'current frame' }]
  const edges = [{ source: 'f1', target: 'v1', mode: 'first_frame' }, { source: 'f3', target: 'v3', mode: 'first_frame' }]
  expect(previousShotPromptFor(nodes, 'f3', edges)).toBe('previous video')
  expect(previousShotPromptFor(nodes, 'v3', edges)).toBe('previous video')
  expect(previousShotPromptFor(nodes, 'f3', [])).toBeUndefined()
})
