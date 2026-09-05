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
