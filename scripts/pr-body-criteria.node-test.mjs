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

test('用户发现的问题转 fixed 的 PR 要有真实场景复现一节：五行答了、修前修后有凭据；该走哪些地方不列清单', () => {
  const contract = { file: 'docs/fixes/2026-11-02-a.root-cause.json', added: true, detected_by: 'user' }
  const judge = (body, options = {}) => checkEscapeContract(body, [contract], ['USER-a'], [], [], options)
  const section = (changes = {}) => {
    const fields = {
      用户的流程: '把剧本给 Agent 出分镜，点生成资产图，报错后放着去忙，回来和重启后还卡（用户原话）',
      我走的: '同样的步骤，真应用真模型，放置和重启都走',
      差别: '并发上限用本机代理模拟，不改变结论：本机怎么处理这个报错才是问题',
      修前: '看到同样的报错和锁定 docs/evidence/a/before.log',
      修后: '同样的步骤走通 https://github.com/o/r/actions/runs/12345678',
      ...changes,
    }
    return `正文\n\n## 真实场景复现\n\n${Object.entries(fields).filter(([, value]) => value !== null).map(([name, value]) => `- ${name}：${value}`).join('\n')}\n\n## 别的\n\n- 修后：这一节外面的不算\n`
  }

  assert.equal(judge(section()).ok, true)
  assert.match(judge(section()).lines.join('\n'), /✅ 真实场景复现/)
  assert.equal(judge(section({ 差别: '无' })).ok, true, '和用户那次一模一样可以写无')
  assert.equal(judge(section({ 我走的: '只有设置页这一处' })).ok, true, '走哪些地方每个问题自己推，门岗不列清单')

  for (const [body, why] of [
    ['', '没有这一节'],
    ['## 验收证据\n\n- 修前：docs/evidence/a.log\n- 修后：docs/evidence/b.log', '别的节不算'],
    [section({ 用户的流程: null }), '不写用户怎么走的'],
    [section({ 我走的: null }), '不写自己怎么走的'],
    [section({ 差别: null }), '不写差别'],
    [section({ 修前: null }), '没有修前'],
    [section({ 修后: null }), '没有修后，那一节外面的不算'],
    [section({ 修前: '复现了' }), '光说不算'],
    [section({ 修后: '#124' }), '裸 PR 号证明不了谁跑过'],
    [section({ 修前: '未验证：无' }), '未验证要写清原因'],
    [section({ 修前: '未验证' }), '未验证要写原因'],
  ]) {
    const result = judge(body)
    assert.equal(result.ok, false, why)
    assert.match(result.lines.join('\n'), /✖ 这个 PR 修的是用户发现的问题/, why)
  }

  const unverified = judge(section({ 修前: '未验证：缺对方的中转和 Key' }))
  assert.equal(unverified.ok, true, 'P3：没有真实资源记 unverified')
  assert.match(unverified.lines.join('\n'), /⚠ 真实场景复现有没做的（修前：缺对方的中转和 Key）/, '没做要说出来')

  const atPush = judge('', { stage: 'push' })
  assert.equal(atPush.ok, true, '真付费在验收之后才跑，推送时只提醒')
  assert.match(atPush.lines.join('\n'), /⚠ 这个 PR 修的是用户发现的问题/)

  assert.equal(judge('', { createdAt: '2026-11-01T23:59:59Z' }).ok, true, '规则生效前开的 PR 只提醒')
  assert.equal(judge('', { createdAt: '2026-11-02T00:00:00Z' }).ok, false, '生效后开的 PR 要求')
  assert.equal(judge('', { createdAt: '2026-11-01T23:59:59Z', enforce: true }).ok, false, '回放按已生效')

  // 没有转 fixed 的 PR 不要求：只引用账本条目、修订已结账的合同都不算修用户的问题
  assert.equal(checkEscapeContract('', [], [], ['USER-a'], []).ok, true)
  assert.equal(checkEscapeContract('', [{ ...contract, added: false }], [], [], [contract.file]).ok, true)

  // 放回真实 PR 试跑时查出来的：评审发现的问题转 fixed（#1401 的形状）没有用户的流程可写；发版后发现的算用户发现
  const foundBy = (detected_by) => checkEscapeContract('', [{ ...contract, detected_by }], ['REV-a'], [], [])
  for (const notUser of ['review', 'walkthrough', 'ci']) assert.equal(foundBy(notUser).ok, true, notUser)
  assert.doesNotMatch(foundBy('review').lines.join('\n'), /真实场景复现/)
  assert.equal(foundBy('post-release').ok, false)
  assert.equal(checkEscapeContract('', [{ ...contract, detected_by: 'review' }, contract], ['REV-a', 'USER-a'], [], []).ok, false, '混着用户发现的也要')
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
