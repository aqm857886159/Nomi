import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import { describe, expect, it } from 'vitest'
import tailwindConfig from '../../tailwind.config'
import { ICON_TIER_CHEVRON_CLASS, ICON_TIER_CLASSES, ICON_TIERS, type IconTier } from './iconTiers'

// 四档有两份写法：`ICON_TIERS` 的数值（裸图标传给 Tabler）和 `ICON_TIER_CLASSES` 的类名（容器挂在自己身上）。
// Tailwind 只认静态类名，两份没法由一份运行时生成，所以这里让 Tailwind 用仓库自己的配置**真把类名编译成 CSS**，
// 再拿 CSS 里的数值对 ICON_TIERS——比的是浏览器拿到的那条声明，不是类名里看起来的数字（size-4 到底多大由主题定）。
const ROOT_FONT_PX = 16

type Rendered = { selector: string; width: number; height: number; strokeWidth: number }

function toPx(value: string): number {
  if (value.endsWith('rem')) return Number.parseFloat(value) * ROOT_FONT_PX
  return Number.parseFloat(value)
}

/** 编译一串类名，按「子元素选择器」收拢出 width / height / stroke-width。 */
async function compile(classes: string): Promise<Rendered[]> {
  const config = {
    ...tailwindConfig,
    content: [{ raw: `<i class="${classes}"></i>`, extension: 'html' }],
    // Compile only this fixture's classes using the production theme and plugins.
    safelist: [],
    corePlugins: { preflight: false },
  }
  const result = await postcss([tailwindcss(config)]).process('@tailwind utilities;', { from: undefined })
  const byTarget = new Map<string, Rendered>()
  result.root.walkRules((rule) => {
    const target = rule.selector.slice(rule.selector.lastIndexOf('>') + 1)
    const entry = byTarget.get(target) ?? { selector: target, width: Number.NaN, height: Number.NaN, strokeWidth: Number.NaN }
    rule.walkDecls((decl) => {
      if (decl.prop === 'width') entry.width = toPx(decl.value)
      if (decl.prop === 'height') entry.height = toPx(decl.value)
      if (decl.prop === 'stroke-width') entry.strokeWidth = Number.parseFloat(decl.value)
    })
    byTarget.set(target, entry)
  })
  return [...byTarget.values()]
}

describe('图标四档：类名编译出的 CSS 就是 ICON_TIERS 的数值', () => {
  it.each(Object.keys(ICON_TIERS) as IconTier[])('%s 档', async (tier) => {
    const rendered = await compile(ICON_TIER_CLASSES[tier])
    expect(rendered).toEqual([{ selector: 'svg', width: ICON_TIERS[tier].size, height: ICON_TIERS[tier].size, strokeWidth: ICON_TIERS[tier].stroke }])
  })

  it('tool 档就是工作区按钮一直以来的 16 / 2（默认档逐字不变，存量按钮一像素不动）', () => {
    expect(ICON_TIER_CLASSES.tool).toBe('[&>svg]:size-4 [&>svg]:stroke-2')
  })

  it('按钮尾部箭头槽恒为角标档，且选择器压得过任何一档的 [&>svg]', async () => {
    const rendered = await compile(ICON_TIER_CHEVRON_CLASS)
    expect(rendered).toEqual([{ selector: '[data-button-chevron]', width: ICON_TIERS.corner.size, height: ICON_TIERS.corner.size, strokeWidth: ICON_TIERS.corner.stroke }])
    // `.x>[data-button-chevron]` 是 (0,2,0)，`.y>svg` 是 (0,1,1)：属性选择器按类算，主图标挂哪一档都盖不到箭头，
    // 一个按钮里两档图标不需要包裹层。
  })
})
