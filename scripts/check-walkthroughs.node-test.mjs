// dead-aria-label 规则的判定逻辑单测（R17：加规则先验它会红）。
//
// 为什么必须有这份：规则的第一版**永远报不出东西**——词典里一大票纯占位值（`{{title}}`、`{{model}}`）
// 的通配模式是 `^.+$`，什么 label 都能"拼出来"，于是 322 个字面量全判活、0 命中。装上了、绿着、
// 什么也没测。下面第 4 组就是钉住那个坑的阳性对照。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  collectAriaLabelLiterals,
  extractInterpolatedValues,
  isAriaLabelAlive,
  templateCanProduce,
} from './lib/ariaLabelLiterals.mjs'
import { findPositionalProjectOpens } from './lib/positionalProjectOpen.mjs'
import { findDeadDataAttributes } from './lib/deadDataAttributes.mjs'
import { judgeBaselineGrowth } from './lib/walkthroughBaselineGuard.mjs'

const SRC = `
  const a = <button aria-label="打开设置" />
  const t = { addNode: '添加{{kind}}节点', bare: '{{title}}', count: '+{{count}}' }
`
const TEMPLATES = extractInterpolatedValues(SRC)

function deadIn(code, { srcText = SRC, templates = TEMPLATES } = {}) {
  return collectAriaLabelLiterals(code)
    .filter(({ literal }) => !isAriaLabelAlive(literal, { srcText, templates }))
    .map(({ literal }) => literal)
}

describe('dead-aria-label：字面量采集', () => {
  it('阳性对照：src 里零命中的 aria-label 被报出来', () => {
    assert.deepEqual(deadIn(`await win.locator('[aria-label="早就没人渲染了"]').click()`), ['早就没人渲染了'])
  })

  it('src 里还有渲染者的不报', () => {
    assert.deepEqual(deadIn(`win.locator('[aria-label="打开设置"]')`), [])
  })

  it('模板拼出来的 label 不报（添加{{kind}}节点 → 添加视频节点）', () => {
    assert.deepEqual(deadIn(`win.locator('[aria-label="添加视频节点"]')`), [])
  })

  // ↓ 这条是整条规则的成败：没有它，规则装上去等于没装。
  it('纯占位模板不得把任意 label 判活（否则规则永远报不出东西）', () => {
    assert.equal(templateCanProduce('{{title}}', '随便什么标签'), false)
    assert.equal(templateCanProduce('+{{count}}', '随便什么标签'), false)
    assert.deepEqual(deadIn(`win.locator('[aria-label="随便什么标签"]')`), ['随便什么标签'])
  })

  it('有锚的模板照常生效', () => {
    assert.equal(templateCanProduce('添加{{kind}}节点', '添加视频节点'), true)
    assert.equal(templateCanProduce('添加{{kind}}节点', '删除视频节点'), false)
  })

  it('走查自己种的数据不报（同名串在选择器之外也出现）', () => {
    const code = `
      const node = { title: '雨夜入场' }
      win.locator('[aria-label*="雨夜入场"]')
    `
    assert.deepEqual(deadIn(code), [])
  })

  it('插值拼出来的选择器跳过（静态判不了）', () => {
    assert.deepEqual(collectAriaLabelLiterals('win.locator(`[aria-label="添加${kind}节点"]`)'), [])
  })

  it('*= ^= $= 三种匹配写法都采到', () => {
    const code = `
      win.locator('[aria-label*="甲甲甲"]')
      win.locator('[aria-label^="乙乙乙"]')
      win.locator('[aria-label$="丙丙丙"]')
    `
    assert.deepEqual(deadIn(code).sort(), ['丙丙丙', '乙乙乙', '甲甲甲'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// positional-project-open：「多项目 × 位置式项目卡选择」（2026-09-06，R17 先验它会红）
//
// 起因：production-mcp 旅程重启后用 `.first()` 点项目卡。自 2026-09-04 起同一隔离库里有两个项目，
// 排序按「最近用过」派生，两者 updatedAt 同秒 → `.first()` 掷硬币 → 一半概率进错项目，
// 任务中心开出来是空的，而报错落在下游的「[data-production-task-card] 10s 超时」。
// 这条规则要在**写下那一行的 commit** 上就红，而不是等 CI 掷到反面。
// ─────────────────────────────────────────────────────────────────────────────
describe('positional-project-open：多项目下的位置式选择', () => {
  const MULTI = `await callTool('nomi_project_create', { name: 'fixture' })`

  it('阳性对照：建了第二个项目又按位置点卡 → 报出来', () => {
    const code = `${MULTI}\nawait win.locator('[data-project-card="true"]').first().click()`
    const hits = findPositionalProjectOpens(code)
    assert.equal(hits.length, 1)
    assert.equal(hits[0].line, 2)
  })

  it('单项目走查的 .first() 不报（位置即身份，不误伤）', () => {
    const code = `await win.locator('[data-project-card]').first().click()`
    assert.deepEqual(findPositionalProjectOpens(code), [])
  })

  it('按身份选中的写法不报：data-project-id', () => {
    const code = `${MULTI}\nawait win.locator('[data-project-card="true"][data-project-id="p1"]').click()`
    assert.deepEqual(findPositionalProjectOpens(code), [])
  })

  it('按身份选中的写法不报：hasText / filter', () => {
    const byText = `${MULTI}\nconst c = win.locator('[data-project-card]', { hasText: name }).first()`
    const byFilter = `${MULTI}\nconst c = win.locator('[data-project-card="true"]').filter({ hasText: name }).first()`
    assert.deepEqual(findPositionalProjectOpens(byText), [])
    assert.deepEqual(findPositionalProjectOpens(byFilter), [])
  })

  it('.nth()/.last() 同属位置式，一并抓', () => {
    const code = `${MULTI}\nwin.locator('[data-project-card]').nth(1)\nwin.locator('[data-project-card]').last()`
    assert.equal(findPositionalProjectOpens(code).length, 2)
  })
})

// dead-data-attr（2026-10-08 外壳重设计：删组件时 data 属性锚点在十几份走查里悬空，前两条规则都看不见）。
describe('dead-data-attr：data 属性锚点存活', () => {
  const SRC_ATTRS = `
    <button data-agent-ball={status} data-v4-control="history" />
    <div data-clip-id={clip.id} />
    el.dataset.timelineStrip = ''
  `
  const dead = (code) => findDeadDataAttributes(code, SRC_ATTRS).map((hit) => hit.text)

  it('阳性对照：src 里零命中的属性名被报出来', () => {
    assert.deepEqual(dead(`win.locator('[data-agent-topbar-badge="true"]')`), ['[data-agent-topbar-badge="true"]'])
  })

  it('阳性对照：属性还在、但写死的枚举值已无人渲染 → 报出来', () => {
    assert.deepEqual(dead(`document.querySelector('[data-v4-control="dock-open"]')`), ['[data-v4-control="dock-open"]'])
  })

  it('活着的属性名 / 枚举值不报', () => {
    assert.deepEqual(dead(`win.locator('[data-agent-ball]'); win.locator('[data-v4-control="history"]')`), [])
  })

  it('数据驱动的值（src 里没写死过字面量值）不判值', () => {
    assert.deepEqual(dead(`win.locator('[data-clip-id="clip-a"]')`), [])
  })

  it('dataset.camelCase 写法算活', () => {
    assert.deepEqual(dead(`win.locator('[data-timeline-strip]')`), [])
  })

  it('第三方运行时属性与走查自己 setAttribute 造的标记不报', () => {
    assert.deepEqual(dead(`win.locator('[data-highlighted]'); el.setAttribute('data-walk-mark', '1'); win.locator('[data-walk-mark]')`), [])
  })
})

describe('dead-data-attr：判活口径的三处精度（#1136 复核）', () => {
  const SRC_DYNAMIC = `
    <div data-v4-control="history" />
    rowAttributes={(row) => ({ 'data-v4-command': row.id })}
    <a data-v4-command="literal" />
  `
  const dead = (code) => findDeadDataAttributes(code, SRC_DYNAMIC).map((hit) => hit.text)

  it('对象键写成表达式的属性（数据驱动的值）不判值', () => {
    assert.deepEqual(dead(`win.locator('[data-v4-command="skill:x"]')`), [])
  })

  it('expectAbsent 里的锚点是「删了不许回来」的防复发断言，不算悬空', () => {
    assert.deepEqual(dead(`await expectAbsent(win.locator('[data-gone-forever]'), { provenBy: p })`), [])
  })

  it('同一个锚点不在 expectAbsent 里照样报（其它写法的「不存在」要换成带基线的 expectAbsent）', () => {
    assert.deepEqual(dead(`check(document.querySelectorAll('[data-gone-forever]').length === 0)`), ['[data-gone-forever]'])
  })
})

describe('走查基线只减不增（#1136 评审阻断 2）', () => {
  const ids = ['dead-selector', 'dead-data-attr']

  it('阳性对照：已有规则的基线被上调 → 报', () => {
    const errors = judgeBaselineGrowth({ ruleIds: ids, baseline: { 'dead-selector': 3 }, baseBaseline: { 'dead-selector': 1 } })
    assert.equal(errors.length, 1)
  })

  it('阳性对照：新规则首发基线高于 merge-base 实测 → 报（不能「把当前数写进去」放宽）', () => {
    const errors = judgeBaselineGrowth({ ruleIds: ids, baseline: { 'dead-data-attr': 97 }, baseBaseline: {}, measureOnBase: () => 56 })
    assert.equal(errors.length, 1)
  })

  it('新规则量不了 merge-base 上的数时，首发基线只能是 0', () => {
    assert.equal(judgeBaselineGrowth({ ruleIds: ids, baseline: { 'dead-data-attr': 1 }, baseBaseline: {} }).length, 1)
    assert.deepEqual(judgeBaselineGrowth({ ruleIds: ids, baseline: { 'dead-data-attr': 0 }, baseBaseline: {} }), [])
  })

  it('首发基线等于 merge-base 实测、已有规则只降不升 → 不报', () => {
    assert.deepEqual(judgeBaselineGrowth({ ruleIds: ids, baseline: { 'dead-selector': 0, 'dead-data-attr': 56 }, baseBaseline: { 'dead-selector': 1 }, measureOnBase: () => 56 }), [])
  })
})
