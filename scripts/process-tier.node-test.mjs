// 流程档位（严 / 标准 / 短）的判定测试 + 历史回放护栏。
// 严档 ≡ 现行四类（花钱 / 长跑 / 可打断 / 新界面，inferRoutes 的 fourClass），没有别的升严来源；这一单只加短档。
// 护栏不存任何手填的计数或期望档位：夹具（scripts/fixtures/process-tiering-replay.json）只存输入，期望在这里当场用 inferRoutes 现算。
// 反例「改坏判据 / 夹具后这些测试必须红」在 scripts/process-tier-mutation.node-test.mjs（隔离副本里逐字节改坏、再还原）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { localApprovals } from './lib/coordApprovals.mjs'
import { evaluatePrBody } from './pr-body-criteria.mjs'
import { deriveUiVerification, evaluateProcessTier, inferRoutes, loadRoutingTable, PROCESS_TIERS } from './pr-judgement-lib.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const table = loadRoutingTable()
const M = (file, status = 'M') => ({ path: file, status })
const infer = (files) => inferRoutes(files, '', table)
const tierOf = (files, extra = {}) => evaluateProcessTier({ body: '', files, inferred: infer(files), ...extra })
const text = (result) => result.lines.join('\n')

const INTENT = (tier = '短', intent = '纯修复', ui = '无界面差异') => `## 变更意图\n- 意图：${intent}\n- 候选档位：${tier}\n- 单一意图：是\n- 声明：${intent === '纯修复' ? '纯修复：不改用户可见元素、布局、文案' : '新增一项能力'}\n- 界面核实：${ui}\n`
const NO_DIFF = { known: true, changed: false, reason: 'base/head 拍板图清单无差异' }

// ── 判定 ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('严档 ≡ 四类：花钱 / 长跑 / 可打断（路径与 diff）/ 新界面（目录与新增 tsx）各一条都是严，声明短档也降不了', () => {
  const cases = [
    ['花钱', [M('electron/generation/spendLedger.ts')]],
    ['长跑', [M('electron/productionRun/generationTask.ts')]],
    ['可打断', [M('electron/agentLane/cancelRun.ts')]],
    ['可打断', [{ ...M('electron/agentLane/run.ts'), added: '+const controller = new AbortController()' }]],
    ['新界面', [M('src/design/actions.ts')]],
    ['新界面', [M('src/workbench/panels/NewPanel.tsx', 'A')]],
  ]
  for (const [label, files] of cases) {
    const result = tierOf(files)
    assert.equal(result.tier, PROCESS_TIERS.STRICT, `${label}：${files[0].path}`)
    assert.match(text(result), new RegExp(`四类命中：.*${label}`))
    const declaredShort = tierOf(files, { body: INTENT(), uiVerification: NO_DIFF })
    assert.equal(declaredShort.tier, PROCESS_TIERS.STRICT, `声明短档 + 界面无差异也降不了：${label}`)
    assert.match(text(declaredShort), /声明短档不生效/)
  }
})

test('严档只由四类判定：名字带 auth / secret / schema / persist 的未登记文件，以及安全 / 数据格式 / 崩溃 / 方向检查字样，都不因此严', () => {
  const named = [
    M('electron/auth/sessionAuth.ts'),
    M('electron/store/secretVault.ts'),
    M('electron/db/schemaVersion.ts'),
    M('electron/workspace/persistState.ts'),
    M('electron/crash/panicReporter.ts'),
    M('src/features/authentication.ts'),
  ]
  for (const file of named) {
    const result = tierOf([file])
    assert.equal(result.tier, PROCESS_TIERS.STANDARD, `${file.path}：${text(result)}`)
  }
  const wordy = tierOf(named, { body: '## 变更意图\n- 意图：安全 crash 数据格式 direction-check security data format\n- 候选档位：标准\n- 单一意图：是\n' })
  assert.equal(wordy.tier, PROCESS_TIERS.STANDARD)
})

test('只改方向检查文档：不因此严（未声明的纯文档 → 短）', () => {
  const result = tierOf([M('docs/engineering/direction-checks/2026-10-28-process-tiering.md')])
  assert.equal(result.tier, PROCESS_TIERS.SHORT)
  assert.equal(result.autoShort, true)
})

test('未声明的纯文档 / 测试 / 配置 → 短；未声明的产品改动 → 标准', () => {
  for (const file of ['docs/plan/2026-10-28-process-tiering.md', 'tests/ux/foo.walk.mjs', 'scripts/check-foo.mjs', 'package.json', 'electron/capabilityCore/sameShotOnceDoors.e2e.test.ts', '.github/workflows/ci.yml']) {
    const result = tierOf([M(file)])
    assert.equal(result.tier, PROCESS_TIERS.SHORT, `${file}：${text(result)}`)
    assert.equal(result.autoShort, true)
  }
  const product = tierOf([M('electron/shared/logic.ts')])
  assert.equal(product.tier, PROCESS_TIERS.STANDARD)
  assert.match(text(product), /四类之外的其余改动/)
  const mixed = tierOf([M('docs/plan/a.md'), M('electron/shared/logic.ts')])
  assert.equal(mixed.tier, PROCESS_TIERS.STANDARD, '纯文档混进一个产品文件就不是纯文档')
  assert.equal(tierOf([]).tier, PROCESS_TIERS.STANDARD, '没有文件清单证明不了纯文档')
})

test('声明短档：纯修复 + 单一意图 + 写明无界面差异，且 base/head 界面清单核实无差异 → 短', () => {
  const files = [M('src/ui/onboarding/focus.ts')]
  const result = tierOf(files, { body: INTENT(), uiVerification: NO_DIFF })
  assert.equal(result.tier, PROCESS_TIERS.SHORT)
  assert.equal(result.autoShort, false)
  assert.match(text(result), /声明单一意图的纯修复/)
  const docsIntent = tierOf([M('src/ui/onboarding/focus.ts')], { body: INTENT('短', '纯文档'), uiVerification: NO_DIFF })
  assert.equal(docsIntent.tier, PROCESS_TIERS.SHORT, '纯文档 / 测试 / 配置意图同样可以声明短档')
})

test('声明短档、界面清单有差异或核实不了：落标准档，不升严', () => {
  const files = [M('src/ui/onboarding/focus.ts')]
  const changed = tierOf(files, { body: INTENT(), uiVerification: { known: true, changed: true, reason: '按钮文案变了' } })
  assert.equal(changed.tier, PROCESS_TIERS.STANDARD)
  assert.match(text(changed), /界面清单有差异（按钮文案变了）/)
  const unknown = tierOf(files, { body: INTENT(), uiVerification: { known: false, changed: null, reason: '取不到 base/head 拍板图清单' } })
  assert.equal(unknown.tier, PROCESS_TIERS.STANDARD)
  assert.match(text(unknown), /界面差异核实不了（取不到 base\/head 拍板图清单）/)
  for (const missing of [undefined, null, () => null, () => { throw new Error('读不到清单') }]) {
    const result = tierOf(files, { body: INTENT(), uiVerification: missing })
    assert.equal(result.tier, PROCESS_TIERS.STANDARD, `核实输入 ${String(missing)}`)
  }
})

test('声明短档但声明本身不成立（不是纯修复、没写界面核实、不是单一意图）：落标准档', () => {
  const files = [M('src/ui/onboarding/focus.ts')]
  const feature = tierOf(files, { body: INTENT('短', '新增功能'), uiVerification: NO_DIFF })
  assert.equal(feature.tier, PROCESS_TIERS.STANDARD)
  assert.match(text(feature), /声明不是纯修复/)
  const noUiLine = tierOf(files, { body: INTENT('短', '纯修复', '').replace(/- 界面核实：\n/, ''), uiVerification: NO_DIFF })
  assert.equal(noUiLine.tier, PROCESS_TIERS.STANDARD)
  assert.match(text(noUiLine), /缺少“界面核实：无界面差异”声明/)
  const notSingle = tierOf(files, { body: INTENT().replace('单一意图：是', '单一意图：否'), uiVerification: NO_DIFF })
  assert.equal(notSingle.tier, PROCESS_TIERS.STANDARD)
  assert.match(text(notSingle), /不是单一意图/)
  const noTier = tierOf(files, { body: INTENT().replace('- 候选档位：短\n', ''), uiVerification: NO_DIFF })
  assert.equal(noTier.tier, PROCESS_TIERS.STANDARD, '没写候选档位不能短')
})

test('界面核实只为声明短档的 PR 去取：别的 PR 不读 base/head 拍板图清单', () => {
  let calls = 0
  const spy = () => { calls += 1; return NO_DIFF }
  tierOf([M('electron/shared/logic.ts')], { uiVerification: spy })
  tierOf([M('electron/generation/spendLedger.ts')], { body: INTENT(), uiVerification: spy })
  tierOf([M('docs/a.md')], { uiVerification: spy })
  assert.equal(calls, 0)
  tierOf([M('src/ui/onboarding/focus.ts')], { body: INTENT(), uiVerification: spy })
  assert.equal(calls, 1)
})

test('让逃逸账本转 fixed 的 PR 永远不进短档：四类之外至少标准，四类之内仍是严', () => {
  const docs = [M('docs/fixes/2026-10-08-receipt.root-cause.json')]
  const docsFixed = tierOf(docs, { ledgerTransitions: ['FB-20261008-pending-spend-presentation'] })
  assert.equal(docsFixed.tier, PROCESS_TIERS.STANDARD, text(docsFixed))
  assert.equal(docsFixed.autoShort, true, '没有账本转换时同样的清单是自动短档')
  assert.equal(tierOf(docs).tier, PROCESS_TIERS.SHORT)
  assert.match(text(docsFixed), /逃逸账本条目转 fixed/)
  const declared = tierOf([M('src/ui/onboarding/focus.ts')], { body: INTENT(), uiVerification: NO_DIFF, ledgerTransitions: ['FB-x'] })
  assert.equal(declared.tier, PROCESS_TIERS.STANDARD, '声明短档也不行')
  const product = tierOf([M('electron/shared/logic.ts')], { ledgerTransitions: ['FB-x'] })
  assert.equal(product.tier, PROCESS_TIERS.STANDARD, '账本转 fixed 不抬到严')
  const money = tierOf([M('electron/generation/spendLedger.ts')], { ledgerTransitions: ['FB-x'] })
  assert.equal(money.tier, PROCESS_TIERS.STRICT)
})

test('规则生效前开的 PR 不适用短档；候选档位「严」只是声明', () => {
  const docs = tierOf([M('docs/plan/a.md')], { shortAllowed: false })
  assert.equal(docs.tier, PROCESS_TIERS.STANDARD)
  assert.match(text(docs), /规则生效前开的 PR，不适用短档/)
  const claimsStrict = tierOf([M('electron/shared/logic.ts')], { body: INTENT('严', '新增功能') })
  assert.equal(claimsStrict.tier, PROCESS_TIERS.STANDARD, '严档只由四类命中判定')
  assert.match(text(claimsStrict), /只是声明/)
})

test('界面清单对账 fail-closed：改了产品代码就必须拿到两边的清单', () => {
  assert.deepEqual(deriveUiVerification({ files: [M('docs/plan/a.md')] }), { known: true, changed: false, reason: '改动没有界面候选文件' })
  assert.equal(deriveUiVerification({ files: [M('src/ui/a.tsx')], baseBoards: {}, headBoards: {} }).known, false)
  assert.equal(deriveUiVerification({ files: [M('src/ui/a.tsx')], baseBoards: null, headBoards: { A: { board: 'A' } } }).known, false)
  assert.equal(deriveUiVerification({ files: [M('src/ui/a.tsx')], baseBoards: { A: { board: 'A' } }, headBoards: { A: { board: 'A' } } }).changed, false)
  assert.equal(deriveUiVerification({ files: [M('src/ui/a.tsx')], baseBoards: { A: { board: 'A' } }, headBoards: { A: { board: 'A', stage: 'built' } } }).changed, true)
})

// ── 总入口（evaluatePrBody）：每档交什么 ──────────────────────────────────────────────────────────────────────

const AFTER_RULE = '2026-10-28T00:00:00Z'
const BEFORE_RULE = '2026-10-27T15:59:59Z'
const SHORT_CARD = '## 短版设计卡\n- ★1：修一个逻辑问题，真实任务与量具：回放测试；不改变界面。\n- ★2：唯一 owner 是共用判据层；证据：door-map。\n- ★3：复用现有路由与板清单；证据：git grep。\n- ★4：状态输出含成功、失败、未知；证据：node:test。\n- ★9：反例先红后绿，回滚 revert；证据：本测试文件。\n'
const STAR_CARD = [
  '## 设计卡',
  '| ★1 用户怎么用 | 谁在什么时刻 | 创作者推送前就看到全部门岗结果以便当场改掉 | 人工 |',
  '| ★2 谁说了算 | 状态归谁 | 门岗清单归 package.json 的 gates:contracts | git grep |',
  '| ★3 一致与复用 | 同类别处 | 复用 pr-body-criteria，没有第二份定义 | git grep |',
  '| ★4 全状态 | 每个状态 | 全过 红 取不到基线 无 PR 各一句话 | 截图 |',
  '| ★9 验收与回滚 | 验收 | 本测试表加回滚 revert 本提交 | 命令 |',
].join('\n')
const judge = (options) => evaluatePrBody({ createdAt: AFTER_RULE, evidence: {}, table, ...options })

test('短档：短版设计卡就够，不查功能分类 / 验收证据，也不要独立验收', () => {
  const files = [M('src/workbench/generationCanvas/canvasStore.ts')] // 路径推出「画布 / 性能」类别，标准档要为它交功能分类和证据
  const short = judge({ body: [INTENT(), SHORT_CARD].join('\n'), files, uiVerification: NO_DIFF })
  assert.equal(short.processTier.tier, PROCESS_TIERS.SHORT)
  assert.equal(short.blocked, false, text(short))
  assert.match(text(short), /流程档位：短/)
  assert.match(text(short), /短版设计卡：5 格都填了/)
  assert.doesNotMatch(text(short), /独立验收/)
  const standard = judge({ body: STAR_CARD, files })
  assert.equal(standard.processTier.tier, PROCESS_TIERS.STANDARD)
  assert.equal(standard.blocked, true, '同一份改动不声明短档：标准档照旧要功能分类 / 验收证据')
  assert.match(text(standard), /功能分类/)
})

test('声明短档但核实对不上：落标准档（要 ## 设计卡），不升严', () => {
  const files = [M('src/ui/onboarding/focus.ts')]
  const body = [INTENT(), SHORT_CARD].join('\n')
  for (const uiVerification of [{ known: true, changed: true, reason: '按钮文案变了' }, { known: false, changed: null, reason: '取不到清单' }]) {
    const onlyShortCard = judge({ body, files, uiVerification })
    assert.equal(onlyShortCard.processTier.tier, PROCESS_TIERS.STANDARD)
    assert.equal(onlyShortCard.blocked, true)
    assert.match(text(onlyShortCard), /没有 `## 设计卡` 一节/)
    assert.doesNotMatch(text(onlyShortCard), /独立验收/, '落标准档，不是严档，不要独立验收')
    const withStarCard = judge({ body: `${body}\n${STAR_CARD}`, files, uiVerification })
    assert.equal(withStarCard.blocked, false, text(withStarCard))
  }
})

test('严档 ≡ 四类：声明短档碰花钱路径，照样 9 格 + 独立验收', () => {
  const result = judge({ body: [INTENT(), SHORT_CARD].join('\n'), files: [M('electron/generation/spendLedger.ts')], uiVerification: NO_DIFF })
  assert.equal(result.processTier.tier, PROCESS_TIERS.STRICT)
  assert.equal(result.blocked, true)
  assert.match(text(result), /没有 `## 设计卡` 一节（四类，9 格）/)
  assert.match(text(result), /缺 `## 独立验收`/)
  const withCard = judge({ body: STAR_CARD, files: [M('electron/generation/spendLedger.ts')] })
  assert.match(text(withCard), /设计卡缺格：5、6、7、8/)
})

test('标准档 = 今天四类之外的全部要求：★ 卡就够，没有额外的评审段或证据要求', () => {
  const result = judge({ body: STAR_CARD, files: [M('electron/shared/logic.ts')] })
  assert.equal(result.processTier.tier, PROCESS_TIERS.STANDARD)
  assert.equal(result.blocked, false, text(result))
  assert.doesNotMatch(text(result), /单线评审/)
})

test('让逃逸账本转 fixed 的纯文档改动：标准档，不是短档（走总入口）', () => {
  const docs = [M('docs/fixes/2026-10-08-receipt.root-cause.json')]
  const plain = judge({ body: SHORT_CARD, files: docs })
  assert.equal(plain.processTier.tier, PROCESS_TIERS.SHORT)
  const fixed = judge({ body: SHORT_CARD, files: docs, ledger: { transitions: ['FB-20261008-pending-spend-presentation'] } })
  assert.equal(fixed.processTier.tier, PROCESS_TIERS.STANDARD)
  assert.match(text(fixed), /没有 `## 设计卡` 一节/, '落标准档：要 ## 设计卡；今天这类单要过的逃逸合同等门岗照旧')
  assert.match(text(fixed), /转 fixed/)
})

test('规则生效前开的 PR 不适用短档（跟今天一样判）', () => {
  const result = judge({ body: SHORT_CARD, files: [M('docs/plan/a.md')], createdAt: BEFORE_RULE })
  assert.equal(result.processTier.tier, PROCESS_TIERS.STANDARD)
  assert.equal(result.blocked, true)
  assert.match(text(result), /没有 `## 设计卡` 一节/)
  assert.equal(judge({ body: SHORT_CARD, files: [M('docs/plan/a.md')], createdAt: AFTER_RULE }).blocked, false)
})

test('短档不免清单合同的批准：纯文档 PR 改了拍板清单，没有协调确认记录照样红', () => {
  const ELEMENT = (overrides = {}) => ({ id: 'a', label: '按钮', candidates: ['001-div'], states: ['selected'], status: 'missing', owner: '#1', ...overrides })
  const base = { Foo: { board: 'Foo', elements: [ELEMENT()] } }
  const head = { Foo: { board: 'Foo', elements: [ELEMENT(), ELEMENT({ id: 'new' })] } }
  const approvals = localApprovals({ pr: 7, env: { NOMI_COORD_APPROVALS: 'approvals.jsonl' }, readFile: () => '' })
  const result = judge({ body: SHORT_CARD, files: [M('docs/design/boards/2026-10-28/Foo.board.json')], evidence: { boards: head, baseBoards: base, approvals } })
  assert.equal(result.processTier.tier, PROCESS_TIERS.SHORT)
  assert.equal(result.blocked, true, text(result))
  assert.match(text(result), /清单的批准身份不能由 PR 自己给/)
})

// ── 回放护栏 ─────────────────────────────────────────────────────────────────────────────────────────────────

const fixture = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/process-tiering-replay.json'), 'utf8'))
const replayFiles = (pr) => pr.files.map((entry) => ({ status: entry[0], path: entry.slice(2), added: (pr.added?.[entry.slice(2)] ?? []).join('\n') }))
const replayJudge = (pr) => evaluatePrBody({
  body: '',
  files: replayFiles(pr).map(({ path: file, status }) => ({ path: file, status })),
  addedByFile: new Map(replayFiles(pr).map((file) => [file.path, file.added])),
  ledger: { transitions: pr.ledgerFixed ?? [] },
  enforce: true,
  table,
  evidence: {},
})

test('回放夹具：只存输入，PR 数等于生成时记下的数', () => {
  assert.equal(fixture.prs.length, fixture.prCount, `夹具里有 ${fixture.prs.length} 个 PR，生成时记下的是 ${fixture.prCount}：夹具只能重跑生成脚本，不能手改`)
  assert.equal(new Set(fixture.prs.map((pr) => pr.number)).size, fixture.prs.length, 'PR 号不能重复')
  assert.deepEqual(Object.keys(fixture).sort(), ['_comment', 'diffRule', 'generatedBy', 'prCount', 'prs', 'schemaVersion', 'window'], '夹具顶层只许这些字段（没有档位、计数、必须严名单这类期望）')
  for (const pr of fixture.prs) {
    assert.ok(Object.keys(pr).every((key) => ['number', 'mergeCommit', 'files', 'added', 'ledgerFixed'].includes(key)), `#${pr.number} 有输入之外的字段：${Object.keys(pr).join('、')}`)
    assert.ok(pr.files.length > 0 && pr.files.every((entry) => /^[ADMT] \S/.test(entry)), `#${pr.number} 的文件清单要「状态 路径」`)
    assert.match(pr.mergeCommit, /^[0-9a-f]{40}$/)
  }
  assert.doesNotMatch(JSON.stringify({ ...fixture, prs: undefined }), /\/Users\/|\/home\/|\/tmp\/|[A-Za-z]:\\/, '夹具的说明字段里不许有本机绝对路径')
})

test('回放夹具的 diff 规则和 test-routing.json 对得上（规则变了就该重生成）', () => {
  assert.deepEqual({ pattern: fixture.diffRule.pattern, scope: fixture.diffRule.scope }, { pattern: table.abortSignal.pattern, scope: table.abortSignal.scope ?? null })
})

test('回放护栏：夹具里每个 PR（空正文、无声明）新规判严 ⇔ 现行四类 inferRoutes(...).fourClass', (t) => {
  const tally = { strict: 0, standard: 0, short: 0 }
  for (const pr of fixture.prs) {
    const expectedStrict = inferRoutes(replayFiles(pr), '', table).fourClass
    const result = replayJudge(pr)
    tally[result.processTier.tier] += 1
    assert.equal(result.processTier.tier === PROCESS_TIERS.STRICT, expectedStrict, `#${pr.number}：新规判${result.processTier.tier}，现行四类 fourClass=${expectedStrict}\n${text(result.processTier)}`)
    assert.equal(result.classification.fourClass, expectedStrict, `#${pr.number}：总入口的四类与当场现算的不一致`)
  }
  t.diagnostic(`回放 ${fixture.prs.length} 个 PR：严 ${tally.strict} / 标准 ${tally.standard} / 短 ${tally.short}`)
})

test('回放护栏覆盖：四类里每一类，夹具中都至少有一个 PR 只因这一类才严', () => {
  for (const label of ['花钱', '长跑', '可打断', '新界面']) {
    const only = fixture.prs.filter((pr) => {
      const { classes } = inferRoutes(replayFiles(pr), '', table)
      return classes.length === 1 && classes[0] === label
    })
    assert.ok(only.length > 0, `夹具里没有只因「${label}」才严的 PR：护栏拦不住「去掉这一类」，要重生成夹具或扩大窗口`)
  }
})
