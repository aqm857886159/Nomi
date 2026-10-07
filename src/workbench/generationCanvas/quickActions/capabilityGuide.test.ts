// 能力此刻没有时菜单给的那条路：点了去哪儿（用户 10-06 拍板：不是只灰掉说原因）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { capabilityGuide } from './capabilityGuide'

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
  it('缺放大：直接落到 kie 的接入页（目录里的通用放大模型今天在 kie），文案说清要接 kie', () => {
    const guide = capabilityGuide('upscale', t)
    expect(guide.description).toBe('generationCommon.quickActions.guides.upscaleAdd')
    expect(dispatched(guide.onSelect)).toEqual([{ tab: 'models', vendorKey: 'kie' }])
  })

  it('缺改图模型：落到模型设置首页（哪一家能改图的都行）', () => {
    const guide = capabilityGuide('imageEdit', t)
    expect(guide.description).toBe('generationCommon.quickActions.guides.imageEditAdd')
    expect(dispatched(guide.onSelect)).toEqual([{ tab: 'models' }])
  })
})
