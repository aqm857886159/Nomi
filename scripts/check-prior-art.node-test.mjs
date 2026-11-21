// 「先查别人」门岗的判据测试（R17：加规则必须先证明它会红）。
// 喂的是假仓库（Map<路径, 正文>），不依赖今天的真实文档——门岗的测试只测存量，
// 就永远测不到「明天新增一份没查就写的方案会不会红」。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  PRIOR_ART_THRESHOLD_DATE,
  evaluatePlans,
  evaluatePullRequest,
  extractPriorArtSection,
  planDate,
  referencedPlans,
  resolveFromPlan,
  scopePlansToChanged,
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

test('目标：模板 ★0 标题和旧标题核同一节，出处不足不能静默跳过', () => {
  const template = fs.readFileSync(new URL('../docs/engineering/design-card.md', import.meta.url), 'utf8')
  const heading = template.match(/^\| (★0 [^（|]+)（/m)?.[1].trim()
  assert.ok(heading, '模板必须声明 ★0 格名')
  for (const title of [heading, `${heading}（补充说明）`, '先查别人', '先查别人（补充说明）']) {
    for (const level of ['##', '###']) {
      const markdown = GOOD_SECTION.replace('## 先查别人', `${level} ${title}`)
      assert.equal(extractPriorArtSection(markdown).found, true)
      assert.deepEqual(evaluatePlans({ plans: new Map([['docs/plan/2026-11-21-good.md', markdown]]) }), [])
      assert.equal(evaluatePlans({ plans: new Map([['docs/plan/2026-11-21-bad.md', `${level} ${title}\n- 查过了`]]) }).length, 1)
      assert.deepEqual(evaluatePullRequest({ body: markdown, registryChanged: true }), [])
    }
  }
})

test('目标真样本：删项目卡的 ★0 来源节应通过 PR 引卡入口', () => {
  const file = 'docs/plan/2026-10-23-project-delete-to-trash.md'
  const markdown = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  assert.equal(extractPriorArtSection(markdown).found, true)
  assert.deepEqual(evaluatePullRequest({ body: file, registryChanged: true, plans: new Map([[file, markdown]]) }), [])
})

test('目标真旧案：★0 卡出处不足被核，没动旧卡不追溯；变更集未知不冒充通过', () => {
  const file = 'docs/plan/2026-10-21-select-to-iterate.md'
  // 冻结 24b1ad04d 的相关表格行，后续补齐原卡不会让反例失效。
  const markdown = [
    '### ★0 先查别人',
    '| 出处 | 它怎么做 | 对哪个决定的影响 |',
    '|---|---|---|',
    '| Figma Make 论坛（2026-02，协调会话转述，无链接） | 发送时选中高亮消失，用户不知道对象带没带上 | **确认** Δ1：发出的气泡里保留 chip |',
    '| 仓库内：时间轴片段 chip（`timelineAgentSurface.tsx:136-154`） | 选中片段即成 chip，变了标「已变更」 | **确认** Δ1 照抄投影做法 |',
  ].join('\n')
  const plans = new Map([[file, markdown], ['docs/plan/2026-11-21-good.md', GOOD_SECTION]])
  const fileExists = (rel) => fs.existsSync(new URL(`../${rel}`, import.meta.url))
  assert.deepEqual(evaluatePlans({ plans: scopePlansToChanged(plans, new Set()), fileExists }), [])
  assert.deepEqual(evaluatePlans({ plans: scopePlansToChanged(plans, new Set(['docs/plan/2026-11-21-good.md'])), fileExists }), [])
  for (const changed of [new Set([file]), null]) {
    const errors = evaluatePlans({ plans: scopePlansToChanged(plans, changed), fileExists })
    assert.equal(errors.length, 1)
    assert.match(errors[0], /只有 1 条带出处/)
  }
  const errors = evaluatePullRequest({ body: file, registryChanged: true, plans, fileExists })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /只有 1 条带出处/)
})

// 2026-10-01（P0「只写我们独有的」）：方案不再被强制写「先查别人」——领域工作（分镜、制作流程、画布……）
// 没有现成的可查，逼人写一节只会写出「查过了，没有」。这一节只在**引入通用能力**时才有人要（见下面
// 「登记表变了」那几条）；写了就必须写像样——有节但出处不足仍然红。
test('没有「先查别人」这一节的方案 → 绿（领域工作不再要手续）', () => {
  const plans = new Map([['docs/plan/2026-09-08-x.md', '# 方案\n\n## 范围\n- 改这改那\n']])
  assert.deepEqual(evaluatePlans({ plans }), [])
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

test('PR 不动自写登记表：改多少行都不要求引用方案（旧的「超过 300 行」那道纸面门岗已删）', () => {
  const plans = new Map()
  assert.deepEqual(evaluatePullRequest({ body: '顺手改了点东西', registryChanged: false, plans }), [])
  assert.deepEqual(evaluatePullRequest({ body: '', plans }), [])
})

test('PR 新增 / 修改了自写登记表（= 新增通用能力）：正文既没引用方案也没带查证 → 红', () => {
  const errors = evaluatePullRequest({ body: '顺手加了个通用能力', registryChanged: true, plans: new Map() })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /自写登记表/)
})

test('登记表变了 + 引用合格方案 → 绿；引用不存在或不合格的 → 红', () => {
  const plans = new Map([
    ['docs/plan/2026-09-08-x.md', GOOD_SECTION],
    ['docs/plan/2026-09-08-bad.md', '# 方案\n## 范围\n- 无\n'],
  ])
  assert.deepEqual(evaluatePullRequest({ body: '见 docs/plan/2026-09-08-x.md', registryChanged: true, plans }), [])
  const missing = evaluatePullRequest({ body: '见 docs/plan/2026-09-08-ghost.md', registryChanged: true, plans })
  assert.match(missing[0], /引用的方案不存在于本分支/)
  const bad = evaluatePullRequest({ body: '见 docs/plan/2026-09-08-bad.md', registryChanged: true, plans })
  assert.match(bad[0], /引用的方案不合格/)
})

test('登记表变了 + 正文自己带一节合格的「先查别人」→ 绿；带了但出处不足 → 红', () => {
  const good = evaluatePullRequest({ body: GOOD_SECTION, registryChanged: true, plans: new Map() })
  assert.deepEqual(good, [])
  const thin = evaluatePullRequest({ body: '## 先查别人\n- 查过了\n', registryChanged: true, plans: new Map() })
  assert.equal(thin.length, 1)
  assert.match(thin[0], /只有 0 条带出处/)
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

// 2026-10-02：只评本次改动动过的方案。历史方案里的链接指向的文件之后被删，不该让每次删除都多一份方案变红。
test('历史方案的链接后来指不到了：没动它就不判；动了它就照判；算不出改动集就全量判', () => {
  const stale = [
    '## 先查别人',
    '',
    '- 仓库已有：见 [旧脚本](../../scripts/gone.mjs)',
    '- 依赖：见 [旧文](../../scripts/gone2.mjs)',
    '- 生态：见 [旧测试](../../scripts/gone3.mjs)',
    '',
  ].join('\n')
  const plans = new Map([['docs/plan/2026-09-20-old.md', stale], ['docs/plan/2026-10-05-new.md', stale]])
  const fileExists = () => false
  assert.equal(evaluatePlans({ plans, fileExists }).length, 2, '全量判时两份都红')
  const onlyNew = scopePlansToChanged(plans, new Set(['docs/plan/2026-10-05-new.md']))
  const errors = evaluatePlans({ plans: onlyNew, fileExists })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /2026-10-05-new\.md/)
  assert.equal(scopePlansToChanged(plans, null), plans, '算不出改动集 → 全量，不拿算不出来当通过')
})

