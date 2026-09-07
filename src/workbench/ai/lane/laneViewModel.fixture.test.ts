// 跨层契约的**渲染层这一半**。
//
// 另一半是 `tests/agent-runtime/lane-slice.test.mts` 里那条「真 pi 产出的投影与这份夹具
// 逐字相等」。两条测试住在两套编译世界里（主进程是 NodeNext 的 ESM 岛，这里是 vite），
// 没有哪一条能一口气从 pi 跑到组件——硬塞进同一个 runner 只会得到一份互相 mock 的假闭环。
//
// 所以接缝被**物化**成这一个文件：上游证明「真 pi 长这样」，这里证明「长这样投出什么」。
// 谁先漂谁先红。这份夹具是**真 pi 跑出来的**，不是手写的——手写夹具只能证明
// 「我写的假数据和我写的断言一致」。
import fixture from '../../../../tests/agent-runtime/__fixtures__/lane-projection.json'
import { describe, expect, it } from 'vitest'

import type { LaneProjection } from '../../../../electron/shared/agentLane/laneContracts'
import { laneViewModel, type LaneViewModelLabels } from './laneViewModel'

const labels: LaneViewModelLabels = {
  toolLabel: (name) => `[${name}]`,
  thinkingLabel: '[thinking]',
  formatTokens: (value) => `${value}t`,
  formatCost: (usd) => `$${usd.toFixed(4)}`,
}

describe('laneViewModel against a projection a real pi lane produced', () => {
  it('turns one real turn into the v4 flow items, in the order it actually happened', () => {
    const model = laneViewModel(fixture as unknown as LaneProjection, labels)

    // 「说了什么 → 做了什么 → 结果如何」这条线，一屏之内读得出来（设计角色对 G1 的判据）。
    expect(model.items.map((item) => item.kind)).toEqual(['user', 'tool', 'tool', 'assistant'])

    const [first, read, write, closing] = model.items
    expect(first.kind === 'user' && first.text).toBe('Append one paragraph to the document.')
    expect(read.kind === 'tool' && read.receipt.action).toBe('document')
    expect(read.kind === 'tool' && read.receipt.status).toBe('output-available')
    expect(read.kind === 'tool' && read.receipt.output).toBe('The opening scene.')
    expect(write.kind === 'tool' && write.receipt.output).toBe('Applied append to the document. New revision 1.')
    expect(closing.kind === 'assistant' && closing.status).toBe('complete')
  })

  it('shows the receipt as one line per call, not one line per event', () => {
    const model = laneViewModel(fixture as unknown as LaneProjection, labels)
    // 投影里是 4 段（两次调用 + 两次结果），面板上是 2 行收据。今天那 7 条一模一样的
    // 红收据堆在下面，就是因为每个事件各占一行。
    expect((fixture as unknown as LaneProjection).parts.filter((part) => part.kind.startsWith('tool-'))).toHaveLength(4)
    expect(model.items.filter((item) => item.kind === 'tool')).toHaveLength(2)
  })

  it('prints only the numbers that were measured', () => {
    const model = laneViewModel(fixture as unknown as LaneProjection, labels)
    expect(model.usage.input).toBe('30t')
    expect(model.usage.output).toBe('12t')
    // 这个夹具的模型没有价目，所以花费那一行**不渲染**——不是印一个 ¥0.00。
    expect(model.usage.cost).toBeUndefined()
    expect(model.usage.max).toBeUndefined()
  })
})
