// V-gates 复验（2026-10-21，PR #1266 第 2 轮）的反例：PR 不能自己给自己开绿灯。
// 统一原则：合同类数据（性能预算政策、拍板清单）不能由 PR 自己批准，只能来自 base，或来自协调在本机留下的确认记录；
// 实现线合理会改的「实现状态」字段（status / assertion / owner）照常允许。
// 全部跑完整 evaluatePrBody（CI 入口 = 默认 ci 确认口径；本机入口 = merge-preflight 的 local 口径），不只测解析函数。
//   B1 PR 改自己的场景文件放宽性能判据   B2 空元素认领   B3 src/design 下新增 tsx 套例外   B4 自造未批准的清单
//   S1 docs/evidence 只许非可执行类型   S3 验收线精确匹配   S5 非法日期按严格   S6 「不通过」单独反例   S7 路径分类
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { buildApproval } from './coord-approve.mjs'
import { checkIndependentAcceptance, evaluatePrBody } from './pr-body-criteria.mjs'
import { boardApprovalSubject, checkSuppressionContracts, ciApprovals, localApprovals, pushApprovals, suppressionApprovalSubject } from './lib/coordApprovals.mjs'
import { boardsAtHead, checkHeadAncestry, isRepoRelativeRef } from './lib/prEvidenceInputs.mjs'
import { knownScenarios, scenarioPolicyHash } from './perf-scenarios-lib.mjs'
import { evidenceJudgementEnforced } from './pr-judgement-lib.mjs'

const HEAD = 'abcdef1234567890abcdef1234567890abcdef12'
const CREATED = '2026-10-23T00:00:00Z'
const text = (result) => result.lines.join('\n')

// ── 夹具 ─────────────────────────────────────────────────────────────────────────────────────────────────────
const TABLE = {
  effectiveFrom: '2000-01-01',
  categories: {
    ui: { label: '新界面 / 改交互', evidence: [] },
    perf: { label: '新增功能 / 性能', evidence: [{ id: 'perf-scenario', label: '性能场景', tool: 'perf:scenarios' }] },
  },
  pathRules: [
    { category: 'ui', legacy: '新界面', pattern: '^src/design/' },
    { category: 'ui', legacy: '新界面', pattern: '^src/.*\\.tsx$', added: true },
    { category: 'ui', pattern: '^src/.*\\.tsx$', exclude: '^src/devlab/' },
    { category: 'perf', pattern: '^src/workbench/generationCanvas/' },
  ],
  evidenceJudgement: {
    effectiveFrom: '2026-10-22',
    boardClaimExceptions: [
      { id: 'pure-bugfix', label: '纯 bug 修复' },
      { id: 'single-element-restyle', label: '只改单个已有元素的样子' },
    ],
  },
}
const CARD = [
  '## 设计卡',
  '线/负责人：I-x',
  '| ★1 用户怎么用 | 谁在什么时刻 | 创作者点了按钮没有反应以便当场修好它 | 人工 |',
  '| ★2 谁说了算 | 状态归谁 | 状态归现有面板，不新增第二份状态 | door-map |',
  '| ★3 一致与复用 | 同类别处 | 复用现有按钮，没有第二份定义 | git grep |',
  '| ★4 全状态 | 每个状态 | 空 加载 成功 失败 各一句话 | 截图 |',
  '| 5 中途表 | 打断 | 关窗时不丢状态，回执在账本里留痕 | 脚本 |',
  '| 6 外部数据与失败 | 外部来源 | 没有外部数据，失败时提示重试 | 文档 |',
  '| 7 性能预算 | 规模 | 不适用：本改动不碰渲染热路径 | 人工 |',
  '| 8 真实条件 | 条件 | Windows 英文界面最小窗口已跑 | 截图 |',
  '| ★9 验收与回滚 | 验收 | 另一条线跑冒烟，回滚 revert 本提交 | 命令 |',
  '### 功能分类',
  '- [x] 新界面 / 改交互',
  '- [x] 新增功能 / 性能',
  '## 独立验收',
  '- 验收线：V-x', '- 报告：D:/Nomi-coord-state/reports/V-x.md', '- 报告首行：V-x：有条件通过', '- 验收 HEAD：abcdef1', '实现线：I-x',
].join('\n')
const NOT_APPLICABLE_PERF = '## 验收证据\n- perf-scenario：不适用：只改了一个按钮的事件绑定，不碰规模'
const ELEMENT = (overrides = {}) => ({ id: 'a', label: '按钮', candidates: ['001-div'], states: ['selected'], status: 'missing', owner: '#1', ...overrides })
const evalBody = (body, { files, scenarios = { ids: [], byId: new Map(), problems: [] }, evidence = {} } = {}) => evaluatePrBody({
  body, files, createdAt: CREATED, table: TABLE, scenarios,
  evidence: { headSha: HEAD, readReport: () => undefined, readRaw: () => null, boards: null, baseBoards: null, approvals: ciApprovals, ...evidence },
})
const tsxModified = [{ path: 'src/workbench/Foo.tsx', status: 'M' }]
const withApprovals = (records, pr = 7) => localApprovals({ pr, env: { NOMI_COORD_APPROVALS: 'approvals.jsonl' }, readFile: () => records.map((record) => JSON.stringify(record)).join('\n') })
const noRecords = () => localApprovals({ pr: 7, env: { NOMI_COORD_APPROVALS: 'approvals.jsonl' }, readFile: () => '' })

// ── B1 性能政策不能由 PR 自己放宽 ───────────────────────────────────────────────────────────────────────────────
const sc = (overrides = {}) => ({
  id: 'sample-type', feature: '样例：连续输入', script: 'tests/perf/canvas-scale-bench.mjs', args: [], scale: '300 个节点', metrics: ['response'],
  budget: 100, budgetStatus: 'approved', budgetStatistic: 'p95', baseline: { median: 20, p95: 90, runs: 5, machine: 'm', date: '2026-10-20', commit: 'abc1234' }, ...overrides,
})
const scenarioFiles = (base, head) => knownScenarios({
  baseEntries: base ? [{ file: 'tests/perf/scenarios/sample-type.json', data: base }] : [],
  prFiles: head ? [{ file: 'tests/perf/scenarios/sample-type.json', content: JSON.stringify(head) }] : [],
})
const RAW_127 = JSON.stringify({ machine: 'm', commit: 'abc1234', date: '2026-10-21', runs: 5, results: [{ id: 'sample-type', metrics: { response: { runs: 5, median: 20, p95: 127 } }, budget: 100, verdict: { status: 'ok' } }] })
const perfBody = `${CARD}\n## 验收证据\n- perf-scenario：sample-type 中位数 20 / p95 127 / 预算 100 / 原始结果 tests/perf/results/sample-type.json\n- ui-mockup：未验证：工具未建`
const perfFiles = [{ path: 'src/workbench/generationCanvas/x.ts', status: 'M' }, { path: 'tests/perf/scenarios/sample-type.json', status: 'M' }]
const perfRun = (known, approvals) => evalBody(perfBody.replace(/## 独立验收[\s\S]*?实现线：I-x\n?/, ''), { files: perfFiles, scenarios: known, evidence: { readRaw: () => RAW_127, approvals } })

test('B1·可信 base 的场景比 p95、p95 127 超预算 100：红（基线对照）', () => {
  const result = perfRun(scenarioFiles(sc(), null), ciApprovals)
  assert.equal(result.blocked, true, text(result))
  assert.match(text(result), /p95 127/)
})

test('B1·PR 把同一场景改成按中位数比（放宽）：CI 入口仍按 base 判红并提示待协调确认；本机入口没有确认记录红', () => {
  const relaxed = sc({ budgetStatistic: 'median' })
  const ci = perfRun(scenarioFiles(sc(), relaxed), ciApprovals)
  assert.equal(ci.blocked, true, text(ci))
  assert.match(text(ci), /待协调确认/)
  const local = perfRun(scenarioFiles(sc(), relaxed), noRecords())
  assert.equal(local.blocked, true)
  assert.match(text(local), /没有协调确认记录/)
  assert.match(text(local), /coord-approve\.mjs --pr 7 --perf sample-type/)
})

test('B1·改预算 / p95Budget / 欠账 / 噪声基线 / 主指标放宽，同样按 base 判', () => {
  for (const relaxed of [sc({ budget: 200 }), sc({ budgetStatistic: 'median', p95Budget: 500 }), sc({ budgetDebt: { owner: 'P-x', state: 'assigned', note: '先欠着不修', since: '2026-10-21' }, baseline: { median: 20, p95: 127, runs: 5, machine: 'm', date: 'd', commit: 'c' } }), sc({ metrics: ['longTasks'] })]) {
    const result = perfRun(scenarioFiles(sc(), relaxed), ciApprovals)
    assert.equal(result.blocked, true, `${JSON.stringify(relaxed).slice(0, 80)}\n${text(result)}`)
  }
})

test('B1·协调确认过（哈希对上）才用 PR head 的政策；内容确认后又改了 → 哈希对不上，重新判红', () => {
  const relaxed = sc({ budgetStatistic: 'median' })
  const record = { pr: 7, kind: 'perf-policy', name: 'sample-type', sha256: scenarioPolicyHash(relaxed), at: '2026-10-22T00:00:00Z', note: '协调看过：这个指标本身就是每轮 p95' }
  const approved = perfRun(scenarioFiles(sc(), relaxed), withApprovals([record]))
  assert.equal(approved.blocked, false, text(approved))
  assert.match(text(approved), /协调已确认/)
  const edited = perfRun(scenarioFiles(sc(), sc({ budgetStatistic: 'median', budget: 400 })), withApprovals([record]))
  assert.equal(edited.blocked, true, text(edited))
  const otherPr = perfRun(scenarioFiles(sc(), relaxed), withApprovals([{ ...record, pr: 8 }]))
  assert.equal(otherPr.blocked, true, '别的 PR 的确认记录不算')
})

test('B1·实现线合理会改的字段（feature 描述、基线的机器 / 日期）不要求确认', () => {
  const result = perfRun(scenarioFiles(sc(), sc({ feature: '换了一句描述', baseline: { median: 20, p95: 90, runs: 5, machine: 'other', date: '2026-10-22', commit: 'def5678' } })), noRecords())
  assert.doesNotMatch(text(result), /性能场景.*(?:待协调确认|没有协调确认记录)/)
})

test('B1·PR 新增的场景：预算由 PR 自己定，必须协调确认——本机没有记录红、CI 只提示、有记录绿', () => {
  const brandNew = sc({ budgetStatistic: 'median' })
  const ci = perfRun(scenarioFiles(null, brandNew), ciApprovals)
  assert.match(text(ci), /待协调确认/)
  assert.equal(ci.blocked, false, text(ci))
  const local = perfRun(scenarioFiles(null, brandNew), noRecords())
  assert.equal(local.blocked, true)
  assert.match(text(local), /PR 新增的场景/)
  const record = { pr: 7, kind: 'perf-policy', name: 'sample-type', sha256: scenarioPolicyHash(brandNew), at: 'x', note: '' }
  assert.equal(perfRun(scenarioFiles(null, brandNew), withApprovals([record])).blocked, false)
})

test('B1·本机确认记录文件没设环境变量 / 读不到 → 需要确认的项红，不当没有要求', () => {
  const relaxed = sc({ budgetStatistic: 'median' })
  const unset = perfRun(scenarioFiles(sc(), relaxed), localApprovals({ pr: 7, env: {} }))
  assert.equal(unset.blocked, true)
  assert.match(text(unset), /NOMI_COORD_APPROVALS/)
  const unreadable = perfRun(scenarioFiles(sc(), relaxed), localApprovals({ pr: 7, env: { NOMI_COORD_APPROVALS: 'D:/nope.jsonl' }, readFile: () => { throw new Error('ENOENT') } }))
  assert.equal(unreadable.blocked, true)
})

// ── B2 空认领 ───────────────────────────────────────────────────────────────────────────────────────────────
const boardsOf = (manifest, name = 'Foo') => ({ [name]: manifest })
const FOO = { board: 'Foo', elements: [ELEMENT({ status: 'implemented', assertion: 'x' }), ELEMENT({ id: 'b', status: 'implemented', assertion: 'x' })] }
const claimBody = (claim) => `${CARD.split('## 独立验收')[0]}\n## 拍板图\n${claim}\n${NOT_APPLICABLE_PERF}`

test('B2·空认领（空串 / 逗号 / 中文逗号 / 顿号 / 空白的各种组合）不算认领：完整入口红', () => {
  for (const junk of [',', '，', '、', ' , ', '，，、', ', ，、 ', '、、、,', ' ，  ,']) {
    const result = evalBody(claimBody(`- Foo: ${junk}`), { files: tsxModified, evidence: { boards: boardsOf(FOO) } })
    assert.equal(result.blocked, true, `${JSON.stringify(junk)}\n${text(result)}`)
    assert.match(text(result), /没有元素 id|没有合法的元素 id/)
  }
  const ok = evalBody(claimBody('- Foo: a、 b'), { files: tsxModified, evidence: { boards: boardsOf(FOO), baseBoards: boardsOf(FOO) } })
  assert.equal(ok.blocked, false, text(ok))
})

test('B2·认领里夹着非法的 id（带引号 / 斜杠）→ 红', () => {
  const result = evalBody(claimBody('- Foo: a, "b";rm'), { files: tsxModified, evidence: { boards: boardsOf(FOO) } })
  assert.equal(result.blocked, true)
})

// ── B3 新增生产 tsx 不许用例外（含 src/design/components）；改令牌可以 ───────────────────────────────────────────
const exceptionBody = (reason = '只调整了一个令牌的颜色值，不增删元素') => `${CARD.split('## 独立验收')[0]}\n## 独立验收\n- 验收线：V-x\n- 报告：D:/Nomi-coord-state/reports/V-x.md\n- 报告首行：V-x：有条件通过\n- 验收 HEAD：abcdef1\n实现线：I-x\n## 拍板图\n- 不适用：single-element-restyle：${reason}\n${NOT_APPLICABLE_PERF}`

test('B3·新增 src/design/components/NewPanel.tsx + 例外 → 红；新增 src/workbench 下同理 → 红', () => {
  for (const file of ['src/design/components/NewPanel.tsx', 'src/workbench/NewPanel.tsx', 'src/design/NewThing.tsx']) {
    const result = evalBody(exceptionBody(), { files: [{ path: file, status: 'A' }] })
    assert.equal(result.blocked, true, `${file}\n${text(result)}`)
    assert.match(text(result), /新增了界面文件/)
  }
})

test('B3·只改令牌 / 样式（改动已有文件）可以用例外 → 绿；新增的测试文件、devlab 不算新界面', () => {
  const tokens = evalBody(exceptionBody(), { files: [{ path: 'src/design/tokens.ts', status: 'M' }, { path: 'src/design/components/Button.tsx', status: 'M' }] })
  assert.equal(tokens.blocked, false, text(tokens))
  const testOnly = evalBody(exceptionBody(), { files: [{ path: 'src/workbench/Foo.tsx', status: 'M' }, { path: 'src/workbench/Foo.test.tsx', status: 'A' }, { path: 'src/devlab/Lab.tsx', status: 'A' }] })
  assert.equal(testOnly.blocked, false, text(testOnly))
})

test('B3·理由是重复字符（哈哈哈哈哈哈哈哈）→ 红（S2）', () => {
  assert.equal(evalBody(exceptionBody('哈哈哈哈哈哈哈哈'), { files: tsxModified }).blocked, true)
})

// ── B4 清单的批准身份 ───────────────────────────────────────────────────────────────────────────────────────
const claimFoo = (extra = '') => claimBody(`- Foo: a${extra}`)
const evidenceFor = (head, base, approvals) => ({ boards: head, baseBoards: base, approvals })

test('B4·PR 自造一份新板（base 上没有）认领自己：本机没有确认记录红、CI 只提示待确认', () => {
  const fake = { board: 'Fake', stage: 'built', elements: [ELEMENT({ status: 'implemented', assertion: 'x' })] }
  const body = claimBody('- Fake: a')
  const ci = evalBody(body, { files: tsxModified, evidence: evidenceFor(boardsOf(fake, 'Fake'), {}, ciApprovals) })
  assert.equal(ci.blocked, false, text(ci))
  assert.match(text(ci), /待协调确认/)
  const local = evalBody(body, { files: tsxModified, evidence: evidenceFor(boardsOf(fake, 'Fake'), {}, noRecords()) })
  assert.equal(local.blocked, true)
  assert.match(text(local), /是 PR 新增的板/)
  assert.match(text(local), /coord-approve\.mjs --pr 7 --board Fake/)
})

test('B4·协调确认过新板（哈希对上）→ 绿；确认后板内容又改了 → 红', () => {
  const fake = { board: 'Fake', stage: 'built', elements: [ELEMENT({ status: 'implemented', assertion: 'x' })] }
  const subject = boardApprovalSubject('Fake', null, fake)
  const record = { pr: 7, kind: 'board', name: 'Fake', sha256: subject.fingerprint, at: 'x', note: '' }
  const run = (manifest, records) => evalBody(claimBody('- Fake: a'), { files: tsxModified, evidence: evidenceFor(boardsOf(manifest, 'Fake'), {}, withApprovals(records)) })
  assert.equal(run(fake, [record]).blocked, false)
  const edited = { ...fake, elements: [ELEMENT({ status: 'implemented', assertion: 'x', label: '确认之后偷偷改了的按钮' })] }
  assert.equal(run(edited, [record]).blocked, true)
})

test('B4·给已有的板新增元素 / 改了元素合同：要确认；只更新实现状态（status / assertion / owner）：不用确认', () => {
  const base = boardsOf({ board: 'Foo', elements: [ELEMENT({ status: 'missing' })] })
  const advance = boardsOf({ board: 'Foo', elements: [ELEMENT({ status: 'implemented', assertion: 'x', owner: '#2' })] })
  const ok = evalBody(claimFoo(), { files: tsxModified, evidence: evidenceFor(advance, base, noRecords()) })
  assert.equal(ok.blocked, false, text(ok))
  const added = boardsOf({ board: 'Foo', elements: [ELEMENT({ status: 'implemented', assertion: 'x' }), ELEMENT({ id: 'new', status: 'implemented', assertion: 'x' })] })
  const addedRun = evalBody(claimFoo(', new'), { files: tsxModified, evidence: evidenceFor(added, base, noRecords()) })
  assert.equal(addedRun.blocked, true, text(addedRun))
  assert.match(text(addedRun), /新增了元素（new）/)
  const rewritten = boardsOf({ board: 'Foo', elements: [ELEMENT({ status: 'implemented', assertion: 'x', candidates: ['999-div'] })] })
  assert.equal(evalBody(claimFoo(), { files: tsxModified, evidence: evidenceFor(rewritten, base, noRecords()) }).blocked, true, '改了元素的候选 = 改了合同')
  const dropped = boardsOf({ board: 'Foo', elements: [ELEMENT({ status: 'dropped', userDecision: { quote: '随便写一句话', date: '2026-10-22' } })] })
  assert.equal(evalBody(claimFoo(), { files: tsxModified, evidence: evidenceFor(dropped, base, noRecords()) }).blocked, true, 'PR 自己写一句用户原话就放弃元素 = 改了合同')
})

test('B4·本机确认记录读不到（环境变量没设）时，需要确认的认领红', () => {
  const fake = { board: 'Fake', stage: 'built', elements: [ELEMENT({ status: 'implemented', assertion: 'x' })] }
  const result = evalBody(claimBody('- Fake: a'), { files: tsxModified, evidence: evidenceFor(boardsOf(fake, 'Fake'), {}, localApprovals({ pr: 7, env: {} })) })
  assert.equal(result.blocked, true)
  assert.match(text(result), /NOMI_COORD_APPROVALS/)
})

test('B4·用真实 git 读 PR head / base：PR 自己新增的板在 base 读不到、在 head 读得到，批准看协调记录', () => {
  const root = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'gates-approve-'))
  try {
    const g = (...args) => { const run = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(run.status, 0, run.stderr); return run.stdout.trim() }
    const gitFn = (args) => { const run = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 }); if (run.status !== 0) { const error = new Error(run.stderr); error.status = run.status; throw error } return run.stdout }
    g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false')
    fs.mkdirSync(path.join(root, 'tests/perf/scenarios'), { recursive: true }); fs.writeFileSync(path.join(root, 'tests/perf/scenarios/sample-type.json'), JSON.stringify(sc()))
    g('add', '-A'); g('commit', '-q', '-m', 'base'); g('update-ref', 'refs/remotes/origin/main', 'HEAD'); const base = g('rev-parse', 'HEAD')
    g('checkout', '-q', '-b', 'pr')
    fs.mkdirSync(path.join(root, 'docs/design/boards/2026-10-23'), { recursive: true })
    fs.writeFileSync(path.join(root, 'docs/design/boards/2026-10-23/NewBoard.board.json'), JSON.stringify({ board: 'NewBoard', elements: [ELEMENT()] }))
    fs.writeFileSync(path.join(root, 'tests/perf/scenarios/sample-type.json'), JSON.stringify(sc({ budget: 999 })))
    g('add', '-A'); g('commit', '-q', '-m', 'pr'); const head = g('rev-parse', 'HEAD')
    const boardRecord = buildApproval({ argv: ['--pr', '7', '--board', 'NewBoard', '--head', head, '--note', '看过'], git: gitFn, now: () => 'T', fetch: false })
    const heads = boardsAtHead({ git: gitFn, sha: head })
    assert.equal(boardRecord.sha256, boardApprovalSubject('NewBoard', null, heads.NewBoard).fingerprint)
    assert.equal(boardsAtHead({ git: gitFn, sha: base }).NewBoard, undefined)
    const perfRecord = buildApproval({ argv: ['--pr', '7', '--perf', 'sample-type', '--head', head], git: gitFn, now: () => 'T', fetch: false })
    assert.equal(perfRecord.sha256, scenarioPolicyHash(sc({ budget: 999 })))
    const approvals = withApprovals([boardRecord, perfRecord])
    assert.equal(approvals.lookup('board', 'NewBoard', boardRecord.sha256), true)
    assert.equal(approvals.lookup('perf-policy', 'sample-type', scenarioPolicyHash(sc())), false, '拿 base 的哈希冒充不行')
    assert.throws(() => buildApproval({ argv: ['--pr', '7', '--board', 'Ghost', '--head', head], git: gitFn, fetch: false }), /没有/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

// ── S1 docs/evidence 只许非可执行类型 ───────────────────────────────────────────────────────────────────────
function ancestryRepo(t) {
  const root = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'gates-s1-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const g = (...args) => { const run = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(run.status, 0, run.stderr); return run.stdout.trim() }
  const gitFn = (args) => { const run = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); if (run.status !== 0) { const error = new Error(run.stderr); error.status = run.status; throw error } return run.stdout }
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false')
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n'); g('add', '-A'); g('commit', '-q', '-m', 'base'); g('update-ref', 'refs/remotes/origin/main', 'HEAD')
  g('checkout', '-q', '-b', 'pr'); fs.writeFileSync(path.join(root, 'f.txt'), 'f\n'); g('add', '-A'); g('commit', '-q', '-m', 'feature')
  const accepted = g('rev-parse', 'HEAD')
  const addEvidence = (file, content) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), content); g('add', '-A'); g('commit', '-q', '-m', `evidence ${file}`) }
  return { g, root, accepted, addEvidence, check: () => checkHeadAncestry({ git: gitFn, accepted, head: g('rev-parse', 'HEAD') }) }
}

test('S1·验收后只附 docs/evidence 下的图片 / 数据 / 文本 → 绿；附可执行类型（.mjs / .js / .html / .sh）→ 红', (t) => {
  const r = ancestryRepo(t)
  for (const file of ['docs/evidence/shot.png', 'docs/evidence/r.json', 'docs/evidence/r.md', 'docs/evidence/n.txt', 'docs/evidence/d.csv', 'docs/evidence/run.log']) r.addEvidence(file, 'x\n')
  assert.equal(r.check().ok, true, JSON.stringify(r.check()))
  for (const file of ['docs/evidence/runtime.mjs', 'docs/evidence/a.js', 'docs/evidence/p.html', 'docs/evidence/s.sh']) {
    const repo = ancestryRepo(t)
    repo.addEvidence(file, 'export const v = 2\n')
    const result = repo.check()
    assert.equal(result.ok, false, file)
    assert.match(result.reason, /非合并提交/)
  }
})

test('S1·符号链接（即使后缀是 .md）→ 红；改名把产品文件挪进 docs/evidence → 红', (t) => {
  const r = ancestryRepo(t)
  const blob = r.g('hash-object', '-w', '--stdin', '--path', 'x') // 空输入也是合法 blob
  r.g('update-index', '--add', '--cacheinfo', `120000,${blob},docs/evidence/link.md`); r.g('commit', '-q', '-m', 'symlink')
  assert.equal(r.check().ok, false)
  const m = ancestryRepo(t)
  fs.mkdirSync(path.join(m.root, 'docs/evidence'), { recursive: true })
  m.g('mv', 'f.txt', 'docs/evidence/f.txt'); m.g('commit', '-q', '-m', 'move product file')
  assert.equal(m.check().ok, false, '旧路径 f.txt 的删除不在 docs/evidence 下')
})

// ── S3 / S5 / S6 / S7 ──────────────────────────────────────────────────────────────────────────────────────
const accBody = (first = 'V-x：有条件通过', line = 'V-x') => `## 独立验收\n- 验收线：${line}\n- 报告：D:/Nomi-coord-state/reports/V-x.md\n- 报告首行：${first}\n- 验收 HEAD：abcdef1\n实现线：I-x`
const report = (first, line = 'V-x') => `${first}\n\n- 验收线：${line}\n- 验收 HEAD：\`${HEAD}\`\n`
const strictAcc = (body, readReport) => checkIndependentAcceptance(body, { stage: 'merge', strict: true, headSha: HEAD, readReport })

test('S3·验收线编号精确匹配：报告写 V-x-unrelated 不能冒充正文的 V-x；括注 / 「·」后缀不算', () => {
  assert.equal(strictAcc(accBody(), () => report('V-x：有条件通过', 'V-x-unrelated')).ok, false)
  assert.equal(strictAcc(accBody(), () => report('V-x：有条件通过', 'V-x（独立于 I-x）')).ok, true)
  assert.equal(strictAcc(accBody(), () => report('V-x：有条件通过', 'V-x · Haiku')).ok, true)
  assert.equal(strictAcc(accBody(), () => report('V-x：有条件通过', 'I-x-more')).ok, false)
})

test('S5·创建时间读不懂（非法日期）按已生效处理，不能变成关闭严格口径的开关', () => {
  assert.equal(evidenceJudgementEnforced(TABLE, 'not-a-date'), true)
  assert.equal(evidenceJudgementEnforced(TABLE, '2026-10-21T00:00:00Z'), false)
  assert.equal(evidenceJudgementEnforced(TABLE, null), true)
})

test('S6·「不通过」（含「未通过」「不予通过」）单独成反例：HEAD / 验收线 / 链接都对、没有任何阻断词，也红', () => {
  for (const verdict of ['V-x：不通过', 'V-x：未通过', 'V-x：不予通过']) {
    const result = strictAcc(accBody(verdict), () => report(verdict))
    assert.equal(result.ok, false, `${verdict}\n${text(result)}`)
    assert.match(text(result), /不通过/)
  }
})

test('S7·报告路径分类：docs/ui/r.md 是仓库内、D:\\\\… 反斜杠是本机、.. 与外链不是仓库内', () => {
  assert.equal(isRepoRelativeRef('docs/ui/r.md'), true)
  assert.equal(isRepoRelativeRef('docs/evidence/r.md'), true)
  assert.equal(isRepoRelativeRef('D:\\Nomi-coord-state\\reports\\V-x.md'), false)
  assert.equal(isRepoRelativeRef('D:/Nomi-coord-state/reports/V-x.md'), false)
  assert.equal(isRepoRelativeRef('../x.md'), false)
  assert.equal(isRepoRelativeRef('docs\\..\\x.md'), false)
  assert.equal(isRepoRelativeRef('https://example.com/r'), false)
})

test('S7·合并前扫描读报告：docs/ui/r.md 走仓库读取器、D:\ 反斜杠路径走本机读取器（旧分类器把 .. 当通配、只认 / 分隔符）', async () => {
  const { readReportRef } = await import('./merge-preflight.mjs')
  const repo = (file) => (file === 'docs/ui/r.md' ? '通过\n' : null)
  assert.equal(readReportRef('docs/ui/r.md', repo, () => '错读了本机'), '通过\n')
  assert.equal(readReportRef('D:\\Nomi-coord-state\\reports\\V-x.md',() => '错读了仓库', () => '本机报告'), '本机报告')
})

// ── 默认全拦（2026-10-22 用户拍板方案 A）：场景白名单 = feature / scale / group + baseline 的 machine / date / commit，其余全算政策 ──────────
test('A·场景：改 feature 描述不需要确认；改 baseline 的 p95 需要确认', () => {
  const described = perfRun(scenarioFiles(sc(), sc({ feature: '换了一句话', scale: '400 个节点', group: '⑤ 别的组' })), noRecords())
  assert.doesNotMatch(text(described), /性能场景.*(?:待协调确认|没有协调确认记录)/)
  const rebaselined = perfRun(scenarioFiles(sc(), sc({ baseline: { median: 20, p95: 120, runs: 5, machine: 'm', date: '2026-10-20', commit: 'abc1234' } })), noRecords())
  assert.match(text(rebaselined), /没有协调确认记录/)
  assert.equal(rebaselined.blocked, true)
})

test('A·场景：以后新加的任何字段、预算依据、整个文件被删，默认也要确认（列表之外不再是漏洞）', () => {
  assert.match(text(perfRun(scenarioFiles(sc(), sc({ someFutureField: 1 })), noRecords())), /没有协调确认记录/)
  assert.match(text(perfRun(scenarioFiles(sc(), sc({ budgetBasis: '改了依据' })), noRecords())), /没有协调确认记录/)
  const removed = knownScenarios({ baseEntries: [{ file: 'tests/perf/scenarios/sample-type.json', data: sc() }], removedFiles: ['tests/perf/scenarios/sample-type.json'] })
  const result = perfRun(removed, noRecords())
  assert.equal(result.blocked, true)
  assert.match(text(result), /被 PR 删掉了/)
})

test('A·场景：确认过的哈希绑整份规范化内容——只改 machine / date / commit 的刷新不使确认失效，改任何政策字段使其失效', () => {
  const relaxed = sc({ budgetStatistic: 'median' })
  const record = { pr: 7, kind: 'perf-policy', name: 'sample-type', sha256: scenarioPolicyHash(relaxed), at: 'T', note: '' }
  assert.equal(scenarioPolicyHash(relaxed), scenarioPolicyHash({ ...relaxed, feature: '换描述', baseline: { ...relaxed.baseline, machine: 'other', date: 'x', commit: 'y' } }))
  assert.notEqual(scenarioPolicyHash(relaxed), scenarioPolicyHash({ ...relaxed, extra: true }))
  assert.equal(perfRun(scenarioFiles(sc(), relaxed), withApprovals([record])).blocked, false)
})

test('A·板：整张板被删、新增板外的 decor 变化，不看正文有没有拍板图节也要确认；只改 status / assertion / owner 不用', () => {
  const base = { Foo: { board: 'Foo', decor: [], elements: [ELEMENT({ status: 'missing' })] } }
  const progress = { Foo: { board: 'Foo', decor: [], elements: [ELEMENT({ status: 'implemented', assertion: 'z', owner: '#99' })] } }
  assert.equal(evalBody(CARD.split('### 功能分类')[0], { files: [{ path: 'docs/x.md', status: 'M' }], evidence: evidenceFor(progress, base, noRecords()) }).blocked, false)
  const deletedBoard = evalBody(CARD.split('### 功能分类')[0], { files: [{ path: 'docs/design/boards/2026-10-23/Foo.board.json', status: 'D' }], evidence: evidenceFor({}, base, noRecords()) })
  assert.equal(deletedBoard.blocked, true)
  assert.match(text(deletedBoard), /整张删掉/)
  const decor = { Foo: { board: 'Foo', decor: ['c-x'], elements: [ELEMENT({ status: 'missing' })] } }
  assert.match(text(evalBody(CARD.split('### 功能分类')[0], { files: [{ path: 'docs/x.md', status: 'M' }], evidence: evidenceFor(decor, base, noRecords()) })), /板级字段/)
})

test('A·板：确认记录的哈希绑整份规范化内容；确认之后板级字段又变一个字 → 失效', () => {
  const base = { Foo: { board: 'Foo', decor: [], elements: [ELEMENT({ status: 'missing' })] } }
  const head = { Foo: { board: 'Foo', decor: ['c-x'], elements: [ELEMENT({ status: 'missing' })] } }
  const record = { pr: 7, kind: 'board', name: 'Foo', sha256: boardApprovalSubject('Foo', base.Foo, head.Foo).fingerprint, at: 'T', note: '' }
  const files = [{ path: 'docs/x.md', status: 'M' }]
  const body = CARD.split('### 功能分类')[0]
  assert.equal(evalBody(body, { files, evidence: evidenceFor(head, base, withApprovals([record])) }).blocked, false)
  const later = { Foo: { ...head.Foo, decor: ['c-x', 'c-y'] } }
  assert.equal(evalBody(body, { files, evidence: evidenceFor(later, base, withApprovals([record])) }).blocked, true)
})

test('A·板 stage：只放行「已拍板 → built」（approved→built；仓库词表里的 explored→built 同）；explored→approved、built 退回 approved、其余变化都要确认', () => {
  const withStage = (stage) => ({ Foo: { board: 'Foo', stage, decor: [], elements: [ELEMENT({ status: 'missing' })] } })
  const body = CARD.split('### 功能分类')[0]
  const files = [{ path: 'docs/x.md', status: 'M' }]
  const run = (from, to) => evalBody(body, { files, evidence: evidenceFor(withStage(to), withStage(from), noRecords()) })
  assert.equal(run('approved', 'built').blocked, false, 'approved → built 是实现进度')
  assert.equal(run('explored', 'built').blocked, false, '仓库词表里 explored 即已拍板待实现，→ built 是实现进度')
  const toApproved = run('explored', 'approved')
  assert.equal(toApproved.blocked, true, 'explored → approved 代表用户拍板，只能来自确认记录')
  assert.match(text(toApproved), /板级字段/)
  assert.equal(run('built', 'approved').blocked, true, 'built 退回 approved 要确认')
  assert.equal(run('built', 'explored').blocked, true, 'built 退回 explored 要确认')
  assert.equal(run('built', 'built').blocked, false)
})

test('推送档（mode=push）eslint-suppressions 三态：取不到记录警告放行、取得到未签判红、签了对上过；合并前（mode=local）取不到照旧判红', () => {
  const base = { 'scripts/a.mjs': { 'no-unused-vars': { count: 1 } } }
  const head = { ...base, 'scripts/b.mjs': { 'no-unused-vars': { count: 1 } } }
  const fp = suppressionApprovalSubject(base, head).fingerprint
  const rec = JSON.stringify({ pr: null, kind: 'eslint-suppressions', name: 'eslint-suppressions.json', sha256: fp, at: 'T', note: '' })

  const missing = checkSuppressionContracts({ strict: true, baseSuppressions: base, suppressions: head, approvals: pushApprovals({ env: {} }) })
  assert.equal(missing.ok, true)
  assert.match(missing.lines.join('\n'), /⚠.*待协调确认（合并前扫描会核/)

  const unreadable = checkSuppressionContracts({ strict: true, baseSuppressions: base, suppressions: head, approvals: pushApprovals({ env: { NOMI_COORD_APPROVALS: 'x' }, readFile: () => { throw new Error('ENOENT') } }) })
  assert.equal(unreadable.ok, true)
  assert.match(unreadable.lines.join('\n'), /⚠.*待协调确认（合并前扫描会核/)

  const unsigned = checkSuppressionContracts({ strict: true, baseSuppressions: base, suppressions: head, approvals: pushApprovals({ env: { NOMI_COORD_APPROVALS: 'x' }, readFile: () => '' }) })
  assert.equal(unsigned.ok, false)

  const signed = checkSuppressionContracts({ strict: true, baseSuppressions: base, suppressions: head, approvals: pushApprovals({ env: { NOMI_COORD_APPROVALS: 'x' }, readFile: () => rec }) })
  assert.equal(signed.ok, true)
  assert.match(signed.lines.join('\n'), /协调已确认/)

  const localMissing = checkSuppressionContracts({ strict: true, baseSuppressions: base, suppressions: head, approvals: localApprovals({ pr: 7, env: {} }) })
  assert.equal(localMissing.ok, false)
})
