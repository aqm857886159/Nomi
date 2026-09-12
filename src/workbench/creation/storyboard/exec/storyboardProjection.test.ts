import { describe, expect, it } from 'vitest'
import { projectShotNode } from './storyboardProjection'
import type { StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'
import type { GenerationCanvasNode } from '../../../generationCanvas/model/generationCanvasTypes'

/**
 * 写回节点这一条路（改了分镜表 → 把行投影进已存在的画布节点）与落画布建节点是
 * **同一个 bug 的两个出口**：两处都曾直接铺 `shot.params`，于是"继承整片默认"的行在这里
 * 同样把画幅丢了——先落画布后改画幅时，节点上永远不会出现那个值。
 * 根因合同：docs/fixes/2026-09-12-storyboard-plan-defaults-passthrough.root-cause.json
 */
const planOf = (aspectRatio?: string): StoryboardPlan => ({
  title: 't',
  anchors: [],
  shots: [
    { index: 1, shotId: 'shot-1', shotKind: 'video', durationSec: 5, anchorIds: [], prompt: '镜一' },
    { index: 2, shotId: 'shot-2', shotKind: 'video', durationSec: 5, anchorIds: [], prompt: '镜二', params: { aspect_ratio: '16:9' } },
    {
      index: 3,
      shotId: 'shot-3',
      shotKind: 'video',
      durationSec: 5,
      anchorIds: [],
      prompt: '镜三',
      keyframe: { enabled: true, prompt: '首帧' },
    },
  ],
  ...(aspectRatio !== undefined ? { aspectRatio } : {}),
})

const nodeOf = (): GenerationCanvasNode => ({
  id: 'n1',
  kind: 'video',
  x: 0,
  y: 0,
  width: 320,
  height: 180,
  prompt: '',
  meta: {},
} as unknown as GenerationCanvasNode)

const meta = (plan: StoryboardPlan, index: number, part: 'shot' | 'keyframe' = 'shot'): Record<string, unknown> =>
  (projectShotNode(plan, plan.shots[index], nodeOf(), part, new Map()).meta ?? {}) as Record<string, unknown>

describe('projectShotNode · 整片默认写回节点', () => {
  it('继承整片默认的行写回节点时带上整片画幅', () => {
    expect(meta(planOf('9:16'), 0).aspect_ratio).toBe('9:16')
  })

  it('行覆盖赢整片默认', () => {
    expect(meta(planOf('9:16'), 1).aspect_ratio).toBe('16:9')
  })

  it('整片默认未定 → 节点 meta 不冒出一个 aspect_ratio（诚实缺席）', () => {
    expect('aspect_ratio' in meta(planOf(), 0)).toBe(false)
  })

  it('首帧图节点跟着同一个整片画幅走', () => {
    expect(meta(planOf('9:16'), 2, 'keyframe').aspect_ratio).toBe('9:16')
  })

  it('视频镜的 duration 仍照旧写回（resolver 不挤掉它）', () => {
    expect(meta(planOf('9:16'), 0).duration).toBe(5)
  })
})
