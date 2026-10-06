// 日志在 effect 里按条目去重只记一次——真 React 渲染（react-reconciler），不是手拨函数。
// 回归：日志曾写在 `useMemo` 里的投影函数中，每个流式快照重算一次，同一条错误记了 28 次。
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createReactTestRenderer } from './testReactRenderer'
import type { V4FlowItem } from './agentPanelV4Types'

const log = vi.hoisted(() => vi.fn())
vi.mock('../../../desktop/rendererLog', () => ({ logRendererError: log }))

import { useLogUnclassifiedProviderFailures } from './useLogUnclassifiedProviderFailures'

function Probe({ items }: { items: readonly V4FlowItem[] }): null {
  useLogUnclassifiedProviderFailures(items)
  return null
}

describe('useLogUnclassifiedProviderFailures', () => {
  beforeEach(() => log.mockReset())

  it('同一条认不出的错误，重渲染 10 次（每次都是新数组）只记 1 次；已化解与认得出的不记', () => {
    const renderer = createReactTestRenderer()
    const items = (): V4FlowItem[] => [
      { kind: 'error', reason: 'x', identity: 'e1:0', raw: 'totally unknown gibberish xyz' },
      { kind: 'error', reason: 'x', identity: 'e2:0', raw: 'also gibberish qqq', recovered: true },
      { kind: 'error', reason: 'x', identity: 'e3:0', raw: 'Connection error.' },
    ]
    for (let i = 0; i < 10; i++) {
      renderer.render(React.createElement(Probe, { items: items() }))
      renderer.flushPassiveEffects()
    }
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('lane-unclassified-failure', undefined, { code: null, diagnostic: 'totally unknown gibberish xyz' })
    renderer.close()
  })
})
