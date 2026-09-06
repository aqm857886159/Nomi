// 「先查别人」门岗的判据测试（R17：加规则必须先证明它会红）。
// 喂的是假仓库（Map<路径, 正文>），不依赖今天的真实文档——门岗的测试只测存量，
// 就永远测不到「明天新增一份没查就写的方案会不会红」。
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PRIOR_ART_DIFF_BUDGET,
  PRIOR_ART_THRESHOLD_DATE,
  evaluatePlans,
  evaluatePullRequest,
  extractPriorArtSection,
  planDate,
  referencedPlans,
  resolveFromPlan,
} from './prior-art-lib.mjs'

const GOOD_SECTION = `# 方案

## 先查别人

- 依赖里已有？@earendil-works/pi-coding-agent@0.84.3 dist/core/session-manager.d.ts:184 有 SessionManager
- 仓库里已有？electron/harness/runtime/pi/session.mts:41 已经接了一半
- 生态里已有？https://example.com/docs/session 官方文档说明了持久化语义
- TikHub 自媒体里怎么说？https://example.com/post/123 有人抱怨恢复会丢历史
- 结论：用已有（pi 的 SessionManager），理由：版本迁移我们跟不动

## 范围
`

test('缺整节 → 红', () => {
  const plans = new Map([['docs/plan/2026-09-08-x.md', '# 方案\n\n## 范围\n- 改这改那\n']])
  const errors = evaluatePlans({ plans })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /缺少「## 先查别人」一节/)
})

test('有节但带出处的条目不足 3 条 → 红', () => {
  const markdown = '# 方案\n\n## 先查别人\n\n- 查过了，没有\n- 生态里也没有\n- 唯一出处 https://example.com/a\n'
  const errors = evaluatePlans({ plans: new Map([['docs/plan/2026-09-08-x.md', markdown]]) })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /只有 1 条带出处/)
})

test('四问答满且带出处 → 绿', () => {
  assert.deepEqual(evaluatePlans({ plans: new Map([['docs/plan/2026-09-08-x.md', GOOD_SECTION]]) }), [])
})

test('阈值之前的老方案不追溯，无日期前缀的同样不追溯', () => {
  const plans = new Map([
    ['docs/plan/2026-09-06-old.md', '# 老方案\n没有那一节\n'],
    ['docs/plan/agent-foundation.md', '# 更老的方案\n没有那一节\n'],
  ])
  assert.deepEqual(evaluatePlans({ plans }), [])
  assert.equal(planDate('docs/plan/2026-09-06-old.md'), '2026-09-06')
  assert.equal(planDate('docs/plan/agent-foundation.md'), null)
  assert.ok('2026-09-06' < PRIOR_ART_THRESHOLD_DATE)
})

test('节的边界只到同级或更高级标题，四级小标题算节内', () => {
  const markdown = '## 先查别人\n\n#### 依赖\n- a https://example.com/a\n- b https://example.com/b\n'
    + '#### 生态\n- c file.ts:12\n\n## 下一节\n- 这条不算 https://example.com/z\n'
  const section = extractPriorArtSection(markdown)
  assert.equal(section.entries.length, 3)
  assert.equal(section.sourced.length, 3)
})

test('大改 PR 正文没引用任何方案 → 红；小改不管', () => {
  const plans = new Map([['docs/plan/2026-09-08-x.md', GOOD_SECTION]])
  const big = evaluatePullRequest({ body: '顺手改了点东西', changedLines: PRIOR_ART_DIFF_BUDGET + 1, plans })
  assert.equal(big.length, 1)
  assert.match(big[0], /没有引用任何 docs\/plan/)
  assert.deepEqual(evaluatePullRequest({ body: '顺手改了点东西', changedLines: PRIOR_ART_DIFF_BUDGET, plans }), [])
})

test('大改 PR 引用了合格方案 → 绿；引用不存在或不合格的 → 红', () => {
  const plans = new Map([
    ['docs/plan/2026-09-08-x.md', GOOD_SECTION],
    ['docs/plan/2026-09-08-bad.md', '# 方案\n## 范围\n- 无\n'],
  ])
  const lines = PRIOR_ART_DIFF_BUDGET + 500
  assert.deepEqual(evaluatePullRequest({ body: '见 docs/plan/2026-09-08-x.md', changedLines: lines, plans }), [])
  const missing = evaluatePullRequest({ body: '见 docs/plan/2026-09-08-ghost.md', changedLines: lines, plans })
  assert.match(missing[0], /引用的方案不存在于本分支/)
  const bad = evaluatePullRequest({ body: '见 docs/plan/2026-09-08-bad.md', changedLines: lines, plans })
  assert.match(bad[0], /引用的方案不合格/)
})

test('正文里的方案路径去重保序', () => {
  const refs = referencedPlans('a docs/plan/b.md, docs/plan/a.md 再提一次 docs/plan/b.md')
  assert.deepEqual(refs, ['docs/plan/b.md', 'docs/plan/a.md'])
})

// —— 第三种出处：指向仓库里真实存在的文件的链接（2026-09-07 第一次真跑时补的判据）——
// 起因：门岗上线第一跑就拦下 docs/plan/2026-09-07-agent-runtime-rebuild.md，而那份方案
// 恰恰是全仓检索做得最足的之一——它引的是 docs/audit/*.md 与 docs/research/*.md，
// 只是链接里没有冒号行号。「一条指向真实文件的链接不算出处」是判据错了，不是文档错了。
// 这一条比「含冒号数字」更强：门岗能自己去确认那个文件在不在，指不到就不算。
test('出处第三种：链接指向仓库里存在的文件算数，指不到的不算', () => {
  const markdown = '## 先查别人\n'
    + '- 依赖里已有？见 [评审](../audit/real-a.md)\n'
    + '- 仓库里已有？见 [审计](../audit/real-b.md)\n'
    + '- 生态里已有？见 [调研](../research/real-c.md)\n'
  const exists = new Set(['docs/audit/real-a.md', 'docs/audit/real-b.md', 'docs/research/real-c.md'])
  const plans = new Map([['docs/plan/2026-09-08-x.md', markdown]])
  assert.deepEqual(evaluatePlans({ plans, fileExists: (file) => exists.has(file) }), [])

  // 同一份文档，链接全部指不到 → 一条出处都不算
  const ghost = evaluatePlans({ plans, fileExists: () => false })
  assert.equal(ghost.length, 1)
  assert.match(ghost[0], /只有 0 条带出处/)

  // 不给 fileExists（纯文本判据）时只认 URL 与 file:line，链接不算
  assert.match(evaluatePlans({ plans })[0], /只有 0 条带出处/)
})

test('相对路径解析：../ 与 ./ 都按方案文档所在目录算，外链不解析', () => {
  assert.equal(resolveFromPlan('docs/plan/2026-09-08-x.md', '../audit/a.md'), 'docs/audit/a.md')
  assert.equal(resolveFromPlan('docs/plan/2026-09-08-x.md', './sub/b.md'), 'docs/plan/sub/b.md')
  assert.equal(resolveFromPlan('docs/plan/2026-09-08-x.md', 'c.md'), 'docs/plan/c.md')
  assert.equal(resolveFromPlan('docs/plan/2026-09-08-x.md', 'https://example.com/a.md'), null)
})
