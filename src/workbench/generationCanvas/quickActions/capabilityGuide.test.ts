// 能力此刻没有时菜单给的那条路：点了去哪儿（用户 10-06 拍板：不是只灰掉说原因）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CAPABILITY_GUIDE_EXCEPTIONS, GUIDE_FOR_REQUIREMENT, capabilityGuide } from './capabilityGuide'
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

  // D-1126-se-missing-model-guide：谁能拆图层由目录算出来；点名那一家、打开它的接入页。算不出 → 通用的去添加。
  it('缺图层分离模型：目录算得出谁能拆 → 点名去接那一家，点了打开它的接入页；算不出 → 退回去添加', () => {
    const tWithArgs = ((key: string, args?: { vendors?: string }) => (args?.vendors ? `${key}:${args.vendors}` : key)) as never
    const named = capabilityGuide('layerSplit', tWithArgs, [{ vendorKey: 'apimart', vendorName: 'APIMart' }])
    expect(named.description).toBe('generationCommon.quickActions.guides.layerSplitConnect:APIMart')
    expect(dispatched(named.onSelect)).toEqual([{ tab: 'models', vendorKey: 'apimart' }])
    const generic = capabilityGuide('layerSplit', tWithArgs, [])
    expect(generic.description).toBe('generationCommon.quickActions.guides.layerSplitAdd')
    expect(dispatched(generic.onSelect)).toEqual([{ tab: 'models' }])
  })

  // 矩阵：每个「要模型才做得了」的能力，缺了就要有下一步（capabilityGuide）；
  // 唯一例外是放大（用户 2026-10-07 拍板置灰）。新增例外必须改这里并写理由，不许悄悄放宽。
  it('矩阵：要模型的能力缺了都有下一步，只有放大是带理由的例外', () => {
    const requires = [...new Set(QUICK_ACTIONS.flatMap((a) => (a.requires ? [a.requires] : [])))].sort()
    expect(requires).toEqual(['image-edit', 'layer-split', 'upscale'])
    expect(Object.keys(CAPABILITY_GUIDE_EXCEPTIONS)).toEqual(['upscale'])
    expect(CAPABILITY_GUIDE_EXCEPTIONS.upscale).toContain('2026-10-07')
    // 例外之外的每一项都有一条路，且那条路有字。
    for (const requirement of requires.filter((key) => !(key in CAPABILITY_GUIDE_EXCEPTIONS))) {
      const capability = GUIDE_FOR_REQUIREMENT[requirement as keyof typeof GUIDE_FOR_REQUIREMENT]
      expect(capability, requirement).toBeTruthy()
      expect(capabilityGuide(capability, t).description).toBeTruthy()
    }
  })
})
