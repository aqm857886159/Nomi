// scripts/pr-body-criteria.mjs（推送前与合并前共用的 PR 正文判据库）的总入口测试。
// 单项判据（设计卡格子、独立验收、逃逸合同、报告）的细节测试在 scripts/merge-preflight.node-test.mjs（判据从那里搬过来，测试没丢）。
import assert from 'node:assert/strict'
import test from 'node:test'

import { checkEscapeContract, englishHeadingHint, evaluatePrBody, isGrandfathered, mergeReport } from './pr-body-criteria.mjs'

const STAR = [
  '## 设计卡',
  '| ★1 用户怎么用 | 谁在什么时刻 | 创作者推送前就看到全部门岗结果以便当场改掉 | 人工 |',
  '| ★2 谁说了算 | 状态归谁 | 门岗清单归 package.json 的 gates:contracts | git grep |',
  '| ★3 一致与复用 | 同类别处 | 复用 pr-body-criteria，没有第二份定义 | git grep |',
  '| ★4 全状态 | 每个状态 | 全过 红 取不到基线 无 PR 各一句话 | 截图 |',
  '| ★9 验收与回滚 | 验收 | 本测试表加回滚 revert 本提交 | 命令 |',
].join('\n')

const docsChange = [{ path: 'docs/engineering/x.md', status: 'M' }]

test('reviewed push admission is exact for every new contract and leaves all settlement/default branches strict', () => {
  const file = 'docs/fixes/2026-10-12-a.root-cause.json'
  const contract = { file, added: true, detected_by: 'user' }
  const options = { stage: 'push', reviewed: [file] }
  assert.equal(checkEscapeContract('', [contract], [], [], [], options).ok, true)
  for (const [contracts, admission] of [
    [[contract], {}], [[contract], { ...options, stage: 'merge' }],
    [[contract], { ...options, stage: 'unknown' }], [[contract], { stage: 'push', reviewed: [] }],
    [[{ ...contract, added: false }], options],
    [[contract, { ...contract, file: 'docs/fixes/2026-10-12-b.root-cause.json' }], options],
  ]) assert.equal(checkEscapeContract('', contracts, [], [], [], admission).ok, false)
  assert.equal(checkEscapeContract('', [], ['FB-fixed'], [], [], options).ok, false, 'fixed transition still requires its contract')
  assert.equal(checkEscapeContract('', [{ ...contract, added: false }], [], [], [file]).ok, true, 'settled revision behavior retained')
})

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

const TIER_INTENT = (tier, intent, ui = '无界面差异') => `## 变更意图\n- 意图：${intent}\n- 候选档位：${tier}\n- 单一意图：是\n- 声明：${intent === '纯修复' ? '纯修复：不改用户可见元素、布局、文案' : '新增一项能力'}\n- 界面核实：${ui}\n`
const SHORT_CARD = `## 短版设计卡\n- ★1：修复一个逻辑问题，真实任务与量具：回放测试；不改变界面。\n- ★2：唯一 owner 是共用判据层；证据：door-map。\n- ★3：复用现有路由与板清单；证据：git grep。\n- ★4：状态输出含成功、失败、未知；证据：node:test。\n- ★9：反例先红后绿，回滚 revert；证据：tests/pr-judgement-lib.node-test.mjs。\n`
const STANDARD_CARD = `## 设计卡\n| ★1 用户怎么用 | 单一任务和回放量具 | tests/pr-judgement-lib.node-test.mjs |\n| ★2 谁说了算 | 共用判据 owner | door-map |\n| ★3 一致与复用 | 复用现有实现 | git grep |\n| ★4 全状态 | 成功、失败、未知 | node:test |\n| ★9 验收与回滚 | 反例和 revert | tests/pr-judgement-lib.node-test.mjs |\n`

test('新三档：短档只收短卡；标准档收 ★卡、证据和单线评审；UI 核实差异升严', () => {
  const shortBody = [TIER_INTENT('短', '纯修复'), SHORT_CARD].join('\n')
  const short = evaluatePrBody({
    body: shortBody,
    files: [{ path: 'src/ui/onboarding/focus.ts', status: 'M' }],
    createdAt: '2026-10-28T00:00:00Z',
    uiVerification: { known: true, changed: false, reason: 'fixture parity' },
  })
  assert.equal(short.blocked, false, short.lines.join('\n'))
  assert.match(short.lines.join('\n'), /流程档位：短/)
  assert.doesNotMatch(short.lines.join('\n'), /独立验收缺/)

  const standardBody = [TIER_INTENT('标准', '新增功能', '清单无差异'), STANDARD_CARD, '## 验收证据\n- process-replay：tests/pr-judgement-lib.node-test.mjs\n', '## 单线评审\n- 评审线：R-process-tiering；结论：有条件通过；报告：tests/pr-judgement-lib.node-test.mjs'].join('\n')
  const standard = evaluatePrBody({ body: standardBody, files: [{ path: 'docs/plan/example.md', status: 'M' }], createdAt: '2026-10-28T00:00:00Z' })
  assert.equal(standard.blocked, false, standard.lines.join('\n'))
  assert.match(standard.lines.join('\n'), /标准档验收证据/)

  const strict = evaluatePrBody({
    body: [TIER_INTENT('短', '纯修复'), SHORT_CARD].join('\n'),
    files: [{ path: 'src/ui/onboarding/focus.ts', status: 'M' }],
    createdAt: '2026-10-28T00:00:00Z',
    uiVerification: { known: true, changed: true, reason: 'button copy changed' },
  })
  assert.equal(strict.blocked, true)
  assert.match(strict.lines.join('\n'), /严档触发项：.*界面差异核实不通过/)
})

test('r2：旧严档正文向宽档单调兼容——9 格满足 5 格，独立验收可复用为单线评审', () => {
  const legacyNine = [
    '## 设计卡',
    '| ★1 用户怎么用 | 任务 | 回放 | 量具 |',
    '| ★2 谁说了算 | owner | 共用判据 | 证据 |',
    '| ★3 一致与复用 | 同类 | 复用 | git grep |',
    '| ★4 全状态 | 成功失败未知 | 全列 | 截图 |',
    '| 5 中途表 | 打断 | 无变化 | 脚本 |',
    '| 6 外部数据与失败 | 来源 | 失败 | 文档 |',
    '| 7 性能预算 | 规模 | 预算 | 命令 |',
    '| 8 真实条件 | 条件 | 实机 | 截图 |',
    '| ★9 验收与回滚 | 验收 | 回滚 | 命令 |',
  ].join('\n')
  const legacyAcceptance = '## 独立验收\n- 报告：docs/evidence/r2-legacy.md\n- 验收线：legacy-line\n'
  const standard = evaluatePrBody({
    body: [TIER_INTENT('标准', '新增功能', '清单无差异'), legacyNine, legacyAcceptance].join('\n'),
    files: docsChange,
    createdAt: '2026-10-28T00:00:00Z',
  })
  assert.equal(standard.blocked, false, standard.lines.join('\n'))
  assert.match(standard.lines.join('\n'), /复用旧正文.*独立验收/)

  const short = evaluatePrBody({
    body: [TIER_INTENT('短', '纯修复'), legacyNine, legacyAcceptance].join('\n'),
    files: [{ path: 'src/ui/onboarding/focus.ts', status: 'M' }],
    createdAt: '2026-10-28T00:00:00Z',
    uiVerification: { known: true, changed: false, reason: 'legacy fixture parity' },
  })
  assert.equal(short.blocked, false, short.lines.join('\n'))
  assert.match(short.lines.join('\n'), /流程档位：短/)
})

// 2026-10-10：#1136 正文写「加节点条等 #1133 合入后作为本 PR 后续提交」，没做就合了（逃逸账本 FB-20261010-shell-canvas-chrome-parity）。
// 承诺必须落实或移交，否则合并档判红——必红测试（先证它会红，再证两种标法放行）。
const PROMISE_BODY = (line) => `${STAR}\n\n## 做了什么\n${line}\n`
const FRESH = '2026-10-11T00:00:00Z'

test('必红：正文承诺「后续提交 / 等 X 合入后再做」又没标已完成或移交 → 合并档判红', () => {
  for (const line of [
    '- 加节点条等 #1133 合入后作为本 PR 后续提交，长相用 #1133 的。',
    '- 列表视图的细节后续 PR 再补。',
    '- 项目库横幅待更新线合并后接。',
    '- 这块后面再做。',
  ]) {
    const result = evaluatePrBody({ body: PROMISE_BODY(line), files: docsChange, createdAt: FRESH, stage: 'merge' })
    assert.equal(result.blocked, true, `没拦住：${line}\n${result.lines.join('\n')}`)
    assert.match(result.lines.join('\n'), /没落实的承诺/)
  }
})

test('标法放行：已完成 <提交号>、移交 <#PR / 待办编号 / docs 路径> 都算落实；只写「已完成」没提交号、只写「移交」没去处照样红', () => {
  for (const line of [
    '- 加节点条等 #1133 合入后作为后续提交——已完成 82c87d82e。',
    '- 列表视图细节后续 PR 再补：移交 #1128。',
    '- 项目库横幅等更新线合入后接：移交 待办 T-123。',
    '- 后面再做，移交 docs/plan/2026-10-10-list-view.md。',
  ]) {
    const result = evaluatePrBody({ body: PROMISE_BODY(line), files: docsChange, createdAt: FRESH, stage: 'merge' })
    assert.equal(result.blocked, false, `误拦：${line}\n${result.lines.join('\n')}`)
  }
  for (const line of ['- 后续提交——已完成。', '- 后续 PR 再补，移交。']) {
    assert.equal(evaluatePrBody({ body: PROMISE_BODY(line), files: docsChange, createdAt: FRESH, stage: 'merge' }).blocked, true, line)
  }
})

test('推送档只警告不判红；生效日之前开的 PR 只警告；代码块里的示例不算；没有承诺措辞的正文不受影响', () => {
  const promise = PROMISE_BODY('- 后续提交再补。')
  const push = evaluatePrBody({ body: promise, files: docsChange, createdAt: FRESH, stage: 'push' })
  assert.equal(push.blocked, false)
  assert.match(push.lines.join('\n'), /⚠ PR 正文里有没落实的承诺/)
  const old = evaluatePrBody({ body: promise, files: docsChange, createdAt: '2026-10-08T00:00:00Z', stage: 'merge' })
  assert.equal(old.blocked, false)
  const fenced = evaluatePrBody({ body: PROMISE_BODY('```\n后续提交再补\n```'), files: docsChange, createdAt: FRESH, stage: 'merge' })
  assert.equal(fenced.blocked, false)
  assert.equal(evaluatePrBody({ body: PROMISE_BODY('- 全部做完，没有遗留。'), files: docsChange, createdAt: FRESH, stage: 'merge' }).blocked, false)
})
