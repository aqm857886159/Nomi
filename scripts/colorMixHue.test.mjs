import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import tailwindConfig from '../tailwind.config.ts'
import {
  HUE_DRIFT_THRESHOLD,
  analyzeHueDrift,
  analyzeTransparentOklchMixes,
  collectTokenDefinitions,
  findTransparentOklchMixes,
  evaluateColorMixExpression,
  hueDelta,
  mixInOklch,
  mixInSrgb,
  parseOklchLiteral,
} from './lib/colorMixHue.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DARK_SELECTOR = ':root[data-mantine-color-scheme="dark"]'

/**
 * 从 tailwind.config.ts 的 addBase 里取真值 —— **运行时 token 的真相源是这里**（编译进
 * tailwind.generated.css），src/theme/nomi-tokens.css 只是参考镜像。不走正则，直接把 plugin 的
 * handler 拿假 addBase 跑一遍，读它真正注册的对象。
 */
function readAddBaseLayers() {
  const layers = {}
  const noop = () => {}
  for (const entry of tailwindConfig.plugins ?? []) {
    const handler = typeof entry === 'function' ? entry : entry?.handler
    if (typeof handler !== 'function') continue
    handler({
      addBase: (obj) => {
        for (const [selector, decls] of Object.entries(obj)) {
          layers[selector] = { ...(layers[selector] ?? {}), ...decls }
        }
      },
      addUtilities: noop,
      addComponents: noop,
      addVariant: noop,
      matchUtilities: noop,
      theme: () => undefined,
      config: () => undefined,
      e: (s) => s,
    })
  }
  return layers
}

const layers = readAddBaseLayers()
const LIGHT = layers[':root']
const DARK = layers[DARK_SELECTOR]

/** 某个模式下的 token 表：暗色继承浅色，再被暗色块覆盖。值统一包成数组，与 collectTokenDefinitions 同形。 */
const defsFor = (mode) =>
  new Map(Object.entries(mode === 'dark' ? { ...LIGHT, ...DARK } : LIGHT).map(([k, v]) => [k, [v]]))

const valueOf = (defs, token) => defs.get(token)?.[0]

describe('色相数学模型对齐真机（Chromium 126 / Electron 31 实测）', () => {
  // 这几个数字是 2026-08-02 在真 Electron 里 getComputedStyle 读出来的，不是推算的。
  // 模型跑偏 = 门岗和下面的回归断言全部失去意义，所以先钉死模型本身。
  const accentLight = parseOklchLiteral('oklch(0.55 0.13 250)')
  const accentDark = parseOklchLiteral('oklch(0.70 0.13 250)')
  const paperLight = parseOklchLiteral('oklch(1 0 0)')
  const paperDark = parseOklchLiteral('oklch(0.235 0.007 80)')

  it('mixInOklch 复现出「粉」和「橄榄绿」两个 bug 实测值', () => {
    expect(mixInOklch(accentLight, paperLight, 0.12).h).toBeCloseTo(346.8, 1)
    expect(mixInOklch(accentDark, paperDark, 0.26).h).toBeCloseTo(124.2, 1)
  })

  // in srgb 这条要过 oklch→sRGB 转换：Chromium 走 oklab→XYZ D65→sRGB 的矩阵链，本模块走 Ottosson
  // 直达矩阵，每通道差 ~0.001 → 低彩度下折合约 2° 色相。实测 248.0 / 248.9，模型算 245.7 / 247.2。
  // 不去复刻 Chromium 的矩阵链（收益为零、维护是负担）：2° 误差对 15° 的判据毫无影响，故按 ±3° 断言。
  // 上面那条 in oklch 全程不出 oklch 空间、无转换，所以能钉到 0.1° —— bug 模型本身是准的。
  it('mixInSrgb 复现出修好之后的实测值（色相稳在 248 附近，容 3° 转换误差）', () => {
    expect(Math.abs(mixInSrgb(accentLight, paperLight, 0.12).h - 248.0)).toBeLessThan(3)
    expect(Math.abs(mixInSrgb(accentDark, paperDark, 0.26).h - 248.9)).toBeLessThan(3)
  })
})

describe('--nomi-accent-soft 必须保住 accent 的色相（不许再跑成粉/橄榄绿）', () => {
  for (const mode of ['light', 'dark']) {
    it(`${mode} 模式下 accent-soft 的色相与 accent 相差 < ${HUE_DRIFT_THRESHOLD}°`, () => {
      const defs = defsFor(mode)
      const accent = parseOklchLiteral(valueOf(defs, '--nomi-accent'))
      const soft = evaluateColorMixExpression(valueOf(defs, '--nomi-accent-soft'), defs)
      expect(accent, '--nomi-accent 必须是可解析的 oklch 字面量').not.toBeNull()
      expect(soft, `--nomi-accent-soft 求值失败：${valueOf(defs, '--nomi-accent-soft')}`).not.toBeNull()
      const drift = hueDelta(soft.h, accent.h)
      expect(
        drift,
        `${mode} 模式 accent-soft 色相 h≈${soft.h.toFixed(1)}，偏离 accent 的 h≈${accent.h.toFixed(1)} 达 ${drift.toFixed(1)}°。\n` +
          `多半是有人把它改回了 color-mix(in oklch, …) —— oklch 会对色相走最短弧插值，而 --nomi-paper 钉了色相\n` +
          `（浅 h=0 / 暗 h=80），accent 会被拽成粉(h≈347)或橄榄绿(h≈124)。改回 in srgb。`,
      ).toBeLessThan(HUE_DRIFT_THRESHOLD)
    })
  }
})

describe('两个 token 真相源不许漂移（运行时真源 = tailwind addBase；nomi-tokens.css 是镜像）', () => {
  // 栽过：只改一处 → 要么「改了没生效」，要么两处各说各话。
  const css = fs.readFileSync(path.join(ROOT, 'src/theme/nomi-tokens.css'), 'utf8')
  const darkStart = css.indexOf(DARK_SELECTOR)
  const cssLight = collectTokenDefinitions([css.slice(0, darkStart)])
  const cssDark = collectTokenDefinitions([css.slice(darkStart)])

  for (const [mode, mirror] of [
    ['light', cssLight],
    ['dark', cssDark],
  ]) {
    it(`${mode} 模式：accent / paper / accent-soft 两处定义一致`, () => {
      const live = defsFor(mode)
      for (const token of ['--nomi-accent', '--nomi-paper', '--nomi-accent-soft']) {
        const mirrored = mirror.get(token)
        expect(mirrored, `nomi-tokens.css 的 ${mode} 块缺 ${token}`).toBeTruthy()
        expect(
          mirrored[0].replace(/\s+/g, ' '),
          `${token} 在 ${mode} 模式下两处不一致：tailwind.config.ts（运行时真源）= ${valueOf(live, token)}，nomi-tokens.css = ${mirrored[0]}`,
        ).toBe(valueOf(live, token).replace(/\s+/g, ' '))
      }
    })
  }
})

describe('色相漂移门岗本身有效（守住门岗，别让它变成空转的摆设）', () => {
  const defs = collectTokenDefinitions([
    ":root { --accent: oklch(0.55 0.13 250); --paper: oklch(1 0 0); --ink: oklch(0.22 0.01 80); }",
  ])

  it('抓得住「有色相的色 × 钉了色相的中性色」用 in oklch 混', () => {
    const findings = analyzeHueDrift(
      [{ path: 'fake.css', content: '  --x: color-mix(in oklch, var(--accent) 12%, var(--paper));' }],
      defs,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].pairs).toHaveLength(1)
    expect(findings[0].pairs[0].resultHue).toBeCloseTo(346.8, 1)
  })

  it('混 transparent 不归色相漂移判据管（transparent 无色相、拽不动谁）—— 那一族由下面的整族禁令拦', () => {
    const findings = analyzeHueDrift(
      [
        {
          path: 'fake.css',
          content:
            '  --a: color-mix(in oklch, var(--accent) calc(1 * 100%), transparent);\n' +
            '  --b: color-mix(in oklch, var(--ink) 32%, transparent);',
        },
      ],
      defs,
    )
    expect(findings).toEqual([])
  })

  it('放行改好之后的 in srgb 写法', () => {
    const findings = analyzeHueDrift(
      [{ path: 'fake.css', content: '  --x: color-mix(in srgb, var(--accent) 12%, var(--paper));' }],
      defs,
    )
    expect(findings).toEqual([])
  })
})

describe('color-mix(in oklch, X, transparent) 整族禁令（R17：先证它在修复前的写法上红）', () => {
  // 这几行是 2026-09-06 修复前仓库里的原文（tailwind.config.ts tokenColor() / 画布 CSS / 时间轴预览 /
  // 骨架屏 gradient / 结构测试里的硬编码断言）。tokenColor() 那一行把全 App 的 --nomi-accent-soft 染粉了。
  const PRE_FIX = [
    '  `color-mix(in oklch, var(${cssVar}) calc(<alpha-value> * 100%), transparent)`',
    '  border: 1px solid color-mix(in oklch, var(--nomi-ink) 36%, transparent);',
    '    0 0 0 1px color-mix(in oklch, var(--nomi-paper) 22%, transparent) inset,',
    '  background: linear-gradient(90deg, transparent, color-mix(in oklch, var(--nomi-ink) 10%, transparent), transparent);',
    "                background: box.hasBackdrop ? 'color-mix(in oklch, var(--nomi-paper) 86%, transparent)' : 'transparent',",
    "    expect(flowStyles).toContain('color-mix(in oklch, var(--nomi-ink) 32%, transparent)')",
  ]

  it('修复前的每一种写法都抓得住（含 calc(<alpha-value>) 百分比、嵌在 gradient / JS 字符串里的）', () => {
    const findings = analyzeTransparentOklchMixes([{ path: 'prefix.css', content: PRE_FIX.join('\n') }])
    expect(findings.map((f) => f.line)).toEqual(PRE_FIX.map((_, i) => i + 1))
    expect(findings[0].expression).toBe('color-mix(in oklch, var(${cssVar}) calc(<alpha-value> * 100%), transparent)')
  })

  it('操作数顺序不限：transparent 写在前面一样抓', () => {
    expect(findTransparentOklchMixes('x: color-mix(in oklch, transparent, var(--nomi-paper) 5%);')).toHaveLength(1)
    expect(findTransparentOklchMixes('x: color-mix(in oklch, transparent 30%, oklch(0.5 0.1 250));')).toHaveLength(1)
  })

  it('只认 transparent 这个操作数：oklch 里混两个真颜色归色相漂移判据管，这里不重复报', () => {
    expect(findTransparentOklchMixes('x: color-mix(in oklch, var(--nomi-accent) 12%, var(--nomi-paper));')).toEqual([])
    expect(findTransparentOklchMixes('x: color-mix(in oklch, var(--transparent-ish) 12%, var(--nomi-paper));')).toEqual([])
  })

  it('修好之后的 in oklab（和既有的 in srgb）写法一律放行', () => {
    const fixed = PRE_FIX.map((l) => l.replace('in oklch', 'in oklab'))
    expect(analyzeTransparentOklchMixes([{ path: 'fixed.css', content: fixed.join('\n') }])).toEqual([])
    expect(findTransparentOklchMixes('x: color-mix(in srgb, var(--nomi-ink) 32%, transparent);')).toEqual([])
  })

  it('真仓库里一处都不剩（src / electron / tailwind.config.ts，与门岗同一扫描面）', () => {
    const files = execSync('git ls-files src electron tailwind.config.ts', { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .map((l) => l.trim())
      .filter((f) => f && /\.(tsx?|css|mjs)$/.test(f) && fs.existsSync(path.join(ROOT, f)))
      .map((f) => ({ path: f, content: fs.readFileSync(path.join(ROOT, f), 'utf8') }))
    const findings = analyzeTransparentOklchMixes(files)
    expect(
      findings.map((f) => `${f.file}:${f.line}  ${f.expression}`),
      '有人写回了 color-mix(in oklch, …, transparent)。改 in oklab —— 别按「操作数是中性色」放行，那是陷阱。',
    ).toEqual([])
  })
})
