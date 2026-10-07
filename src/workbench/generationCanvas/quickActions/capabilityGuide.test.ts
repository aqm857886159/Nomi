// 能力此刻没有时菜单给的那条路：点了去哪儿（用户 10-06 拍板：不是只灰掉说原因）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CAPABILITY_GUIDE_EXCEPTIONS, capabilityGuide } from './capabilityGuide'
import { QUICK_ACTIONS } from './quickActionCatalog'

const t = ((key: string) => key) as never
// 测试环境是 node：用一个真的 EventTarget 当 window（capabilityGuide 只在它上面派发事件）。
beforeEach(() => { vi.stubGlobal('window', new EventTarget()) })
afterEach(() => { vi.unstubAllGlobals() })

function dispatched(run: () => void): unknown[] {
  const details: unknown[] = []
  const listener = (event: Event) => details.push((event as CustomEvent).detail)
  window.addEventListener('nomi-open-settings', listener)
  try { run() } finally { window.removeEventListener('nomi-open-settings', listener) }
  return details
}

describe('capabilityGuide', () => {
  it('缺改图模型：落到模型设置首页（哪一家能改图的都行）', () => {
    const guide = capabilityGuide('imageEdit', t)
    expect(guide.description).toBe('generationCommon.quickActions.guides.imageEditAdd')
    expect(dispatched(guide.onSelect)).toEqual([{ tab: 'models' }])
  })

  // 矩阵：每个「要模型才做得了」的能力，缺了就要有下一步（capabilityGuide）；
  // 唯一例外是放大（用户 2026-10-07 拍板置灰）。新增例外必须改这里并写理由，不许悄悄放宽。
  it('矩阵：要模型的能力缺了都有下一步，只有放大是带理由的例外', () => {
    const requires = [...new Set(QUICK_ACTIONS.flatMap((a) => (a.requires ? [a.requires] : [])))].sort()
    expect(requires).toEqual(['image-edit', 'upscale'])
    expect(Object.keys(CAPABILITY_GUIDE_EXCEPTIONS)).toEqual(['upscale'])
    expect(CAPABILITY_GUIDE_EXCEPTIONS.upscale).toContain('2026-10-07')
    expect(capabilityGuide('imageEdit', t).description).toBeTruthy()
  })
})
