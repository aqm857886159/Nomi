// scripts/pr-body-criteria.mjs（推送前与合并前共用的 PR 正文判据库）的总入口测试。
// 单项判据（设计卡格子、独立验收、逃逸合同、报告）的细节测试在 scripts/merge-preflight.node-test.mjs（判据从那里搬过来，测试没丢）。
import assert from 'node:assert/strict'
import test from 'node:test'

import { englishHeadingHint, evaluatePrBody, isGrandfathered, mergeReport } from './pr-body-criteria.mjs'

const STAR = [
  '## 设计卡',
  '| ★1 用户怎么用 | 谁在什么时刻 | 创作者推送前就看到全部门岗结果以便当场改掉 | 人工 |',
  '| ★2 谁说了算 | 状态归谁 | 门岗清单归 package.json 的 gates:contracts | git grep |',
  '| ★3 一致与复用 | 同类别处 | 复用 pr-body-criteria，没有第二份定义 | git grep |',
  '| ★4 全状态 | 每个状态 | 全过 红 取不到基线 无 PR 各一句话 | 截图 |',
  '| ★9 验收与回滚 | 验收 | 本测试表加回滚 revert 本提交 | 命令 |',
].join('\n')

const docsChange = [{ path: 'docs/engineering/x.md', status: 'M' }]

test('同一份正文、同一份改动 → 总入口只给一个结论（推送前与合并前调的就是它）', () => {
  const good = evaluatePrBody({ body: STAR, files: docsChange, createdAt: '2026-10-08T00:00:00Z' })
  assert.equal(good.blocked, false, good.lines.join('\n'))
  const bad = evaluatePrBody({ body: '## 做了什么\n随便', files: docsChange, createdAt: '2026-10-08T00:00:00Z' })
  assert.equal(bad.blocked, true)
  assert.match(bad.lines.join('\n'), /没有 `## 设计卡` 一节/)
})

test('英文标题：判据只认中文，但报错里点明是标题语言的问题', () => {
  const english = STAR.replace('## 设计卡', '## Design card')
  const result = evaluatePrBody({ body: english, files: docsChange, createdAt: '2026-10-08T00:00:00Z' })
  assert.equal(result.blocked, true)
  assert.match(result.lines.join('\n'), /英文标题/)
  assert.equal(englishHeadingHint('## Independent acceptance\nx', '独立验收').includes('英文标题'), true)
  assert.equal(englishHeadingHint('## 设计卡', '设计卡'), '')
})

test('四类改动的 9 格与独立验收在推送前同样要求', () => {
  const four = [{ path: 'electron/productionRun/productionRunService.ts', status: 'M' }]
  const result = evaluatePrBody({ body: STAR, files: four, createdAt: '2026-10-08T00:00:00Z' })
  assert.equal(result.blocked, true)
  assert.match(result.lines.join('\n'), /设计卡缺格：5、6、7、8/)
  assert.match(result.lines.join('\n'), /缺 `## 独立验收`/)
})

test('规则生效宽限：写死了 #961 的合并时刻，推送前没有 gh 也能判；拿不到创建时间 = 不宽限（fail-closed）', () => {
  assert.equal(isGrandfathered({ createdAt: '2026-10-02T00:00:00Z' }), true)
  assert.equal(isGrandfathered({ createdAt: '2026-10-08T00:00:00Z' }), false)
  assert.equal(isGrandfathered({ createdAt: null }), false)
  const blocked = evaluatePrBody({ body: '随便', files: docsChange, createdAt: null })
  assert.equal(blocked.blocked, true)
})

test('合并前报告：抬头 + 判据行 + 结论', () => {
  const report = mergeReport(7, evaluatePrBody({ body: STAR, files: docsChange, createdAt: '2026-10-08T00:00:00Z' }))
  assert.match(report.text, /^合并前扫描 · PR #7/)
  assert.match(report.text, /扫描干净/)
})
