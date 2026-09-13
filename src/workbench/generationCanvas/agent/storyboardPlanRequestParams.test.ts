import { describe, expect, it } from 'vitest'
import { storyboardPlanToCreateNodesArgs, type StoryboardPlan } from './storyboardPlan'
import { buildAgentModelEntries } from './availableModels'
import type { ModelOption } from '../../../config/models'
import { buildModelEntryIndex, buildPlannedNodeMeta } from './plannedNodeMeta'

/**
 * 端到端（纯函数链）：整片默认 → 落画布参数 → **runner 真正读的那份 node.meta**。
 *
 * 为什么要单独钉这一段：`storyboardPlanToCreateNodesArgs` 只产出 `PlanCreatedNode.params`，
 * 真正发出去的是 `buildPlannedNodeMeta` 铺完档案默认、再按档案校验过的那份 meta。
 * 两段之间有一道「模型档案没有这个控件就丢掉」的闸——所以「节点参数里有 9:16」不等于
 * 「请求带着 9:16」。这一族 bug 的教训正是这个：显示成立不代表请求成立。
 *
 * 根因合同：docs/fixes/2026-09-12-storyboard-plan-defaults-passthrough.root-cause.json
 */
const entries = buildModelEntryIndex(
  buildAgentModelEntries([
    // GPT Image 2：档案声明 canonical `aspect_ratio`（`src/config/modelArchetypes/gptImage2.ts`）。
    { value: 'gpt-image-2', label: 'GPT Image 2', modelKey: 'gpt-image-2', vendor: 'kie', kind: 'image' },
    // Agnes Image 2.0：档案只声明像素 `size`，**没有** aspect_ratio 控件。
    { value: 'agnes-image-2.0-flash', label: 'Agnes Image', modelKey: 'agnes-image-2.0-flash', vendor: 'agnes', kind: 'image' },
  ] satisfies ModelOption[]),
)

const planOf = (modelKey: string, vendor: string): StoryboardPlan => ({
  title: 't',
  anchors: [],
  aspectRatio: '9:16',
  shots: [{ index: 1, shotId: 'shot-1', shotKind: 'image', durationSec: 0, anchorIds: [], prompt: '镜一', modelKey, modelVendor: vendor }],
})

const requestMeta = (plan: StoryboardPlan): Record<string, unknown> | undefined => {
  const node = storyboardPlanToCreateNodesArgs(plan).nodes.find((candidate) => candidate.prompt === '镜一')!
  return buildPlannedNodeMeta(node, entries)
}

describe('整片默认 → runner 读的那份 meta', () => {
  it('档案声明了 aspect_ratio 的模型：整片画幅真的进了请求参数', () => {
    expect(requestMeta(planOf('gpt-image-2', 'kie'))?.aspect_ratio).toBe('9:16')
  })

  it('行覆盖同样贯通到底', () => {
    const plan = planOf('gpt-image-2', 'kie')
    plan.shots[0].params = { aspect_ratio: '1:1' }
    expect(requestMeta(plan)?.aspect_ratio).toBe('1:1')
  })

  it('整片默认未定 → 请求参数回落档案默认（gpt-image-2 的 auto），不是我们编的值', () => {
    const plan = planOf('gpt-image-2', 'kie')
    delete plan.aspectRatio
    expect(requestMeta(plan)?.aspect_ratio).toBe('auto')
  })

  it('档案没有画幅控件的模型（Agnes 只声明像素 size）：这个键被诚实丢掉，不硬塞', () => {
    const meta = requestMeta(planOf('agnes-image-2.0-flash', 'agnes'))
    expect(meta?.aspect_ratio).toBeUndefined()
    // 那一族模型走的是它自己的尺寸档；批量条用 unsupportedFilmDefaultKeys 把这件事如实说给用户。
    expect(meta?.size).toBe('1024x1024')
  })
})
