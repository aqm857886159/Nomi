// 空态起手 chip 的**派生证明**。
//
// 空态最容易变成一排好看的假按钮：文案照着产品会议记的三个词写死，点下去模型手里
// 根本没有那个工具，于是「什么都没发生」——比一片空白更糟。
//
// 这里把「这条起手真的做得到」拆成两道断言，两道都跑在真的表上、不复述任何清单：
//   ① 每个面**恰好三条**，且每条的能力 id 在 `CAPABILITY_CONTRACTS` 里查得到。
//      能力改名/下架 → `starterChipsForSurface` 过滤掉它 → 数量不足 → 当场红。
//   ② 这条起手声明的能力，在模型真正拿到的内部工具面（`modelFacingToolSpecs("internal")`，
//      注册表派生、不按意图路由裁剪——#646 之后工具集不再按 capability 分组）上至少有一个动词。
//      这一道拦的是另一种假：能力确实注册了，但没有任何模型可见动词指向它（付费边界、
//      「外部才有」的 profile 都会造成这种形状）。
import { describe, expect, it } from 'vitest'
import { modelFacingToolSpecs } from '../../../../electron/shared/agentCapabilities/modelFacingToolRegistry'
import { CAPABILITY_ALIAS_ENTRIES, CAPABILITY_CONTRACTS } from '../../../../electron/shared/agentCapabilities/registry'
import { enAgentPanelV4, zhAgentPanelV4 } from '../../../i18n/locales/agentPanelV4'
import { starterChipsForSurface, V4_EMPTY_TITLE_KEY } from './agentPanelV4EmptyState'
import type { ResidentSurface } from '../resident/residentShellDisplay'

const SURFACES: readonly ResidentSurface[] = ['creation', 'storyboard', 'generation', 'preview']

/** 一个能力在各投影面上的全部工具名（pi / mcp / ui / method + operation 别名）。 */
function aliasesOf(capabilityId: string): readonly string[] {
  return CAPABILITY_ALIAS_ENTRIES.filter((entry) => entry.contract.id === capabilityId).map((entry) => String(entry.alias))
}

/** 模型真正拿到的内部工具面里，指向这个能力的动词名。 */
function internalToolNamesFor(capabilityId: string): readonly string[] {
  return modelFacingToolSpecs('internal').filter((spec) => spec.contractId === capabilityId).map((spec) => spec.name)
}

// `key` 收 unknown：`TranslationKey` 在 tsconfig.test-types 那套工程里解析不出字面量联合
// （i18next 的模块增强没被那套工程收进来），写成 string 会当场 TS2345。
const localeText = (locale: typeof zhAgentPanelV4 | typeof enAgentPanelV4, key: unknown): string => {
  const leaf = String(key).replace(/^agentPanelV4\./, '')
  const value = (locale as unknown as Record<string, unknown>)[leaf]
  expect(typeof value, `${key} 在词典里缺一条`).toBe('string')
  return value as string
}

describe('Agent 面板 v4 空态起手', () => {
  it('每个面都有一句标题，两种语言都写了', () => {
    for (const surface of SURFACES) {
      for (const locale of [zhAgentPanelV4, enAgentPanelV4]) {
        expect(localeText(locale, V4_EMPTY_TITLE_KEY[surface]).length).toBeGreaterThan(0)
      }
    }
  })

  it('每个面恰好三条起手，且每条都指向一个已注册能力', () => {
    const registered: ReadonlySet<string> = new Set<string>(CAPABILITY_CONTRACTS.map((contract) => contract.id))
    for (const surface of SURFACES) {
      const chips = starterChipsForSurface(surface)
      expect(chips, `${surface} 面的起手条数`).toHaveLength(3)
      expect(new Set(chips.map((chip) => chip.id)).size, `${surface} 面的起手 id 不许重`).toBe(3)
      for (const chip of chips) expect(registered.has(chip.capabilityId), `${chip.capabilityId} 不在能力注册表里`).toBe(true)
    }
  })

  it('起手句发出去之后，模型手里真有那个能力的工具（zh / en 两版的起手句都存在）', () => {
    for (const surface of SURFACES) {
      for (const chip of starterChipsForSurface(surface)) {
        const aliases = aliasesOf(chip.capabilityId)
        expect(aliases.length, `${chip.capabilityId} 一个别名都没有`).toBeGreaterThan(0)
        const tools = internalToolNamesFor(chip.capabilityId)
        expect(
          tools.length,
          `${surface} / ${chip.id}：内部工具面上没有任何动词指向 ${chip.capabilityId}`,
        ).toBeGreaterThan(0)
        expect(tools.every((name) => aliases.includes(name)), `${chip.capabilityId} 的动词名必须是契约自己声明的 pi 别名`).toBe(true)
        for (const locale of [zhAgentPanelV4, enAgentPanelV4]) {
          expect(localeText(locale, chip.promptKey).length).toBeGreaterThan(0)
        }
      }
    }
  })
})
