// 空态起手 chip 的**派生证明**。
//
// 空态最容易变成一排好看的假按钮：文案照着产品会议记的三个词写死，点下去模型手里
// 根本没有那个工具，于是「什么都没发生」——比一片空白更糟。
//
// 这里把「这条起手真的做得到」拆成两道断言，两道都跑在真的表上、不复述任何清单：
//   ① 每个面**恰好三条**，且每条的能力 id 在 `CAPABILITY_CONTRACTS` 里查得到。
//      能力改名/下架 → `starterChipsForSurface` 过滤掉它 → 数量不足 → 当场红。
//   ② 把这条起手的**真实句子**（zh / en 两版）连同这个面的 capability 喂给
//      `agentToolsForRequest`——那是这个面真正会交给模型的工具集——断言里面至少有一个
//      别名属于这条起手声明的能力。这一道拦的是另一种假：能力确实注册了，但这句话
//      的意图路由把它送到了另一个工具集（把「分镜」写成「镜头」就会这样）。
//
// 测试文件可以 import `electron/harness/`（check:boundaries 的扫描范围排除 `.test.`），
// 生产的空态模块则只碰中立契约层 `electron/shared/`。
import { describe, expect, it } from 'vitest'
import { agentToolsForRequest } from '../../../../electron/harness/agentChatPolicy'
import type { AgentChatRequest } from '../../../../electron/harness/agentChatContracts'
import { CAPABILITY_ALIAS_ENTRIES, CAPABILITY_CONTRACTS } from '../../../../electron/shared/agentCapabilities/registry'
import { enAgentPanelV4, zhAgentPanelV4 } from '../../../i18n/locales/agentPanelV4'
import { starterChipsForSurface, V4_EMPTY_TITLE_KEY } from './agentPanelV4EmptyState'
import type { ResidentSurface } from '../resident/residentShellDisplay'

const SURFACES: readonly ResidentSurface[] = ['creation', 'storyboard', 'generation', 'preview']

/** 面 → 这个面发出去的 capability。与 `useAgentPanelV4Actions.send` 同一条判据。 */
const CAPABILITY_FOR_SURFACE: Record<ResidentSurface, AgentChatRequest['capability']> = {
  creation: 'creation-editor',
  storyboard: 'creation-editor',
  generation: 'canvas-agent',
  preview: 'canvas-agent',
}

/** 一个能力在各投影面上的全部工具名（pi / mcp / ui + operation 别名）。 */
function aliasesOf(capabilityId: string): readonly string[] {
  return CAPABILITY_ALIAS_ENTRIES.filter((entry) => entry.contract.id === capabilityId).map((entry) => String(entry.alias))
}

function toolNamesFor(surface: ResidentSurface, prompt: string): readonly string[] {
  return agentToolsForRequest({
    capability: CAPABILITY_FOR_SURFACE[surface],
    prompt,
    history: { kind: 'ephemeral' },
  } as AgentChatRequest).map((tool) => tool.name)
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

  it('起手句发出去之后，模型手里真有那个能力的工具（zh / en 两版都验）', () => {
    for (const surface of SURFACES) {
      for (const chip of starterChipsForSurface(surface)) {
        const aliases = aliasesOf(chip.capabilityId)
        expect(aliases.length, `${chip.capabilityId} 一个别名都没有`).toBeGreaterThan(0)
        for (const locale of [zhAgentPanelV4, enAgentPanelV4]) {
          const prompt = localeText(locale, chip.promptKey)
          const tools = toolNamesFor(surface, prompt)
          expect(
            tools.some((name) => aliases.includes(name)),
            `${surface} / ${chip.id}：「${prompt}」路由出的工具集里没有 ${chip.capabilityId}（拿到的是 ${tools.join(', ')}）`,
          ).toBe(true)
        }
      }
    }
  })
})
