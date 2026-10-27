// 界面不印金额的三道保险（方向检查 docs/engineering/direction-checks/2026-10-27-ui-money-amounts.md）：
// ① 反例必红、正例必绿：选择器认写法（语法树），删之前的任务中心「制作详情」原文件必须红；
// ② 全仓普查：同一组选择器扫 src，命中只许出现在出口名单里，且每个文件的处数等于名单记的数（只减不增，少了也红）；
//    货币格式化函数的 import 名单与 src 里真实 import 它的文件逐一相等（出口删了，放行位同提交删）；
// ③ 接线：仓库 eslint 配置在名单外的真实路径上报 ui-money/*，出口文件不报；货币格式化函数只许名单里的文件 import。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ESLint } from 'eslint'
import tseslint from 'typescript-eslint'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  FORMAT_MONEY_IMPORTERS,
  FORMAT_MONEY_IMPORT_PATTERN,
  FORMAT_MONEY_MODULE,
  MONEY_FORMAT_EXITS,
  MONEY_FORMAT_SELECTORS,
} from './ui-money-format.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** 删之前的 src/workbench/production/ProductionDetails.tsx 原文（2026-10-27 删掉四个金额格之前那一版）。 */
const BEFORE_DETAILS = fs.readFileSync(path.join(root, 'scripts/fixtures/ui-money/ProductionDetails.before.tsx.txt'), 'utf8')

// 只开这两条规则、不读仓库配置的计数器：出口名单里的文件也照数（同 canvas-store-subscriptions.test.mjs 的做法）。
// import 那条用的就是 eslint.config.mjs 里那一个 pattern：普查与 lint 同一个判据。
const counter = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      'no-restricted-syntax': ['error', ...MONEY_FORMAT_SELECTORS],
      'no-restricted-imports': ['error', { patterns: [FORMAT_MONEY_IMPORT_PATTERN] }],
    },
  },
})
/** 一个文件里：金额写法几处、import 货币格式化函数几处。 */
async function scan(source, filePath) {
  const [result] = await counter.lintText(source, { filePath })
  const fatal = result.messages.find((message) => message.fatal)
  if (fatal) throw new Error(`${path.relative(root, filePath)} 解析失败，普查会漏数：${fatal.message}`)
  const hits = (ruleId) => result.messages.filter((message) => message.ruleId === ruleId).length
  return { money: hits('no-restricted-syntax'), imports: hits('no-restricted-imports') }
}
const moneyHits = async (source, filePath) => (await scan(source, filePath)).money
const probe = (source) => moneyHits(source, path.join(root, 'src/workbench/uiMoneyProbe.tsx'))

describe('写法：金额格式化上屏必红，非金额必绿', () => {
  it('删之前的任务中心「制作详情」原文件必红（Intl currency + 货币码兜底两处）', async () => {
    expect(await moneyHits(BEFORE_DETAILS, path.join(root, 'src/workbench/production/ProductionDetails.tsx'))).toBe(2)
  })

  const red = [
    'const s = `¥${x}`',
    'const s = `CNY ${x}`',
    'const s = `${x} USD`',
    'const s = `$${x}`',
    "const s = '¥' + x",
    "const s = x + ' CNY'",
    "const s = currency + ' ' + x",
    'const s = budget.currency + x',
    'const s = `${currency} ${x.toFixed(2)}`',
    'const s = `${x}${budget.currency}`',
    "const s = n.toLocaleString(l, { style: 'currency', currency: c })",
    "const s = new Intl.NumberFormat(l, { style: 'currency', currency: c }).format(n)",
    "const s = new Intl.NumberFormat(l, { 'style': 'currency', currency: c }).format(n)",
    'export const A = () => <span>¥{amount}</span>',
    'export const A = () => <span>{amount} CNY</span>',
    "export const d = { shotPrice: '¥{{amount}}' }",
    "export const d = { costUsd: 'USD {{amount}}' }",
    "export const d = { cost: '{{currency}}{{amount}}' }",
  ]
  for (const source of red) {
    it(`红：${source}`, async () => {
      expect(await probe(source)).toBeGreaterThan(0)
    })
  }

  const green = [
    'const s = `${done}/${total}`',
    'const s = `${count} 次`',
    'const s = `${n}px`',
    'const s = `USD_RATE_${x}`',
    "const s = new Intl.NumberFormat(l, { style: 'percent' }).format(n)",
    "const s = new Intl.DateTimeFormat(l, { dateStyle: 'medium' }).format(d)",
    "const r = new RegExp('^' + x + '$')",
    'const r = `^${x}$`',
    'const r = `${a}$`',
    "export const d = { usedOnly: '已用 {{amount}}' }",
    "export const d = { calls: '{{cost}} 次调用' }",
    'export const A = () => <span>{done} / {total}</span>',
  ]
  for (const source of green) {
    it(`绿：${source}`, async () => {
      expect(await probe(source)).toBe(0)
    })
  }
})

function sourceFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // 设计实验室在 eslint 全局 ignores 里，不上生产界面；测试另有规矩。
      if (entry.name === '__tests__' || entry.name === 'node_modules' || full === path.join(root, 'src/devlab')) continue
      out.push(...sourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

describe('普查：现存金额只在出口名单里，只减不增', () => {
  /** 一趟解析记两本账：文件 → 金额写法处数；import 了货币格式化函数的文件。 */
  const census = { money: {}, importers: [] }
  // 全 src 逐个解析：2026-10-27 本机 1632 个文件约 6 秒，满载的机器上可能翻几倍，放宽到 120 秒（只放宽，不缩短）。
  beforeAll(async () => {
    for (const file of sourceFiles(path.join(root, 'src'))) {
      const hits = await scan(fs.readFileSync(file, 'utf8'), file)
      const relative = path.relative(root, file).replaceAll(path.sep, '/')
      if (hits.money > 0) census.money[relative] = hits.money
      if (hits.imports > 0) census.importers.push(relative)
    }
  }, 120_000)

  it('src 下每个文件的命中处数与出口名单逐一相等，名单外 0 处', () => {
    const expected = Object.fromEntries(Object.entries(MONEY_FORMAT_EXITS).map(([file, exit]) => [file, exit.count]))
    expect(census.money).toEqual(expected)
  })

  // 名单只拦「名单外的文件 import」，不管「名单里的文件还在不在 import」：出口删了、放行位还留着，
  // 下次有人顺手 import 回来 lint 不报（2026-10-27 删 Agent 面板任务卡那一位时补的这条对账）。
  it('货币格式化函数的 import 名单与 src 里真实 import 它的文件逐一相等（名单外 0 处，名单里不再 import 的 0 处）', () => {
    expect([...census.importers].sort()).toEqual(Object.keys(FORMAT_MONEY_IMPORTERS).sort())
  })

  it('名单里的文件都还在，各自写清印的是什么', () => {
    for (const [file, exit] of Object.entries(MONEY_FORMAT_EXITS)) {
      expect(fs.existsSync(path.join(root, file)), file).toBe(true)
      expect(exit.what.trim().length, file).toBeGreaterThan(0)
    }
    for (const [file, what] of Object.entries(FORMAT_MONEY_IMPORTERS)) {
      expect(fs.existsSync(path.join(root, file)), file).toBe(true)
      expect(what.trim().length, file).toBeGreaterThan(0)
    }
  })
})

describe('接线：仓库 eslint 配置真的拦', () => {
  let eslint
  beforeAll(() => {
    eslint = new ESLint({ cwd: root })
  })
  const ruleIds = async (source, relativePath) => {
    const [result] = await eslint.lintText(source, { filePath: path.join(root, relativePath) })
    return result.messages.map((message) => message.ruleId)
  }

  it('删之前的制作详情放回原路径：报 ui-money/no-restricted-syntax', async () => {
    expect(await ruleIds(BEFORE_DETAILS, 'src/workbench/production/ProductionDetails.tsx')).toContain('ui-money/no-restricted-syntax')
  })

  it('出口文件原样不报（名单只记账，不在 lint 上红）', async () => {
    const file = Object.keys(MONEY_FORMAT_EXITS)[0]
    expect(await ruleIds(fs.readFileSync(path.join(root, file), 'utf8'), file)).not.toContain('ui-money/no-restricted-syntax')
  })

  it('名单外 import 货币格式化函数：报 ui-money/no-restricted-imports；名单内不报', async () => {
    const outside = "import { formatMoney } from '../ai/v4/formatMoney'\nexport const label = formatMoney('en', 'CNY', 1)\n"
    expect(await ruleIds(outside, 'src/workbench/production/uiMoneyProbe.ts')).toContain('ui-money/no-restricted-imports')
    for (const file of Object.keys(FORMAT_MONEY_IMPORTERS)) {
      expect(await ruleIds(fs.readFileSync(path.join(root, file), 'utf8'), file), file).not.toContain('ui-money/no-restricted-imports')
    }
  })

  it('货币格式化函数就是登记的那一个文件', () => {
    expect(fs.readFileSync(path.join(root, FORMAT_MONEY_MODULE), 'utf8')).toContain('export function formatMoney(')
  })
})
