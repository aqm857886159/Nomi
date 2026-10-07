// scripts/merge-preflight.mjs 的行为测试：四类判定、设计卡格子、独立验收、逃逸合同。
// gh 调用只在 main() 里，这里测的全是纯函数，输入都是真实 PR 正文的形状。
import assert from 'node:assert/strict'
import test from 'node:test'
import { fixedTransitions } from './escape-ledger-lib.mjs'
import {
  checkDesignCard,
  checkEscapeContract,
  settledContracts,
  checkIndependentAcceptance,
  checkProtectedScope,
  classifyChange,
  extractSection,
  implementationLine,
  isGrandfathered,
  escapeLedgerFromTree,
  ledgerChanges,
  parsePullFileRows,
  renderReport,
} from './merge-preflight.mjs'

const FULL_CARD = [
  '## 设计卡',
  '线/负责人：线 A',
  '| ★1 用户怎么用 | 谁在什么时刻 | 当创作者批量生成时我想先看到总价以便决定 | 人工 |',
  '| ★2 谁说了算 | 状态归谁 | 生成批次归 production.run 主进程 owner | door-map |',
  '| ★3 一致与复用 | 同类别处 | 复用 spendCard，没有第二份定义 | git grep |',
  '| ★4 全状态 | 每个状态 | 空 加载 成功 失败 取消中 各一句话 | 截图 |',
  '| 5 中途表 | 打断 | 关窗时不扣费，回执在账本 | 脚本 |',
  '| 6 外部数据与失败 | 外部来源 | 供应商返回异常时提示重试，不甩锅给 key | 文档 |',
  '| 7 性能预算 | 规模 | 不适用：本改动不碰渲染热路径 | 人工 |',
  '| 8 真实条件 | 条件 | Windows 英文界面最小窗口已跑 | 截图 |',
  '| ★9 验收与回滚 | 验收 | 另一条线跑 pnpm run test:core-smoke，回滚 revert 本提交 | 命令 |',
  '',
  '## 独立验收',
  '报告：https://example.com/report 验收线：线 B',
].join('\n')

test('四类判定：按路径命中花钱 / 长跑 / 可打断 / 新界面，普通改动不命中', () => {
  assert.deepEqual(classifyChange([{ path: 'electron/productionRun/productionRunService.ts', status: 'M' }]).classes, ['长跑'])
  assert.ok(classifyChange([{ path: 'electron/generation/spendLedger.ts', status: 'M' }]).classes.includes('花钱'))
  assert.ok(classifyChange([{ path: 'src/workbench/ai/cancelGeneration.ts', status: 'M' }]).classes.includes('可打断'))
  assert.ok(classifyChange([{ path: 'src/workbench/NewPanel.tsx', status: 'A' }]).classes.includes('新界面'))
  assert.ok(classifyChange([{ path: 'src/design/tokens.ts', status: 'M' }]).classes.includes('新界面'))
  assert.ok(classifyChange([{ path: 'src/utils/format.ts', status: 'M' }], '+const c = new AbortController()').classes.includes('可打断'))
  assert.equal(classifyChange([{ path: 'src/utils/format.ts', status: 'M' }, { path: 'docs/x.md', status: 'M' }, { path: 'electron/productionRun/queue.test.ts', status: 'M' }]).fourClass, false)
})

test('设计卡：四类 9 格填全 → 过；缺格 → 红并指名；非四类只查 ★ 格', () => {
  assert.equal(checkDesignCard(FULL_CARD, { fourClass: true }).ok, true)
  const noFive = FULL_CARD.replace(/^\| 5 中途表.*$/m, '| 5 中途表 | 打断 |')
  const missing = checkDesignCard(noFive, { fourClass: true })
  assert.equal(missing.ok, false)
  assert.match(missing.lines.join('\n'), /缺格：5/)
  // 非四类：第 5 格空着也过，★ 格空着不过
  assert.equal(checkDesignCard(noFive, { fourClass: false }).ok, true)
  const noStar = FULL_CARD.replace(/^\| ★9 验收与回滚.*$/m, '')
  assert.match(checkDesignCard(noStar, { fourClass: false }).lines.join('\n'), /缺格：9/)
  assert.equal(checkDesignCard('## 做了什么\n随便', { fourClass: false }).ok, false)
})

test('设计卡：「不适用：理由」算填了，「不适用」不带理由不算', () => {
  const reasoned = FULL_CARD.replace(/^\| 7 性能预算.*$/m, '| 7 性能预算 | 规模 | 不适用：本改动不碰渲染热路径 | 人工 |')
  assert.equal(checkDesignCard(reasoned, { fourClass: true }).ok, true)
  const bare = FULL_CARD.replace(/^\| 7 性能预算.*$/m, '| 7 性能预算 | 不适用 |')
  assert.match(checkDesignCard(bare, { fourClass: true }).lines.join('\n'), /缺格：7/)
})

test('设计卡只放链接 → 不判红，提示人工到链接里核对', () => {
  const result = checkDesignCard('## 设计卡\ndocs/plan/2026-10-05-foo.md', { fourClass: true })
  assert.equal(result.ok, true)
  assert.match(result.lines.join('\n'), /人工到链接里核对/)
})

test('独立验收：要有报告链接和验收线编号，且不同于实现线', () => {
  assert.equal(checkIndependentAcceptance(FULL_CARD).ok, true)
  assert.equal(implementationLine(FULL_CARD), '线 A')
  const same = FULL_CARD.replace('线/负责人：线 A', '实现线：线B').replace('验收线：线 B', '验收线：线B')
  const sameResult = checkIndependentAcceptance(same)
  assert.equal(sameResult.ok, false)
  assert.match(sameResult.lines.join('\n'), /相同/)
  const noLink = FULL_CARD.replace('https://example.com/report', '见群里')
  assert.match(checkIndependentAcceptance(noLink).lines.join('\n'), /没有带报告链接/)
  assert.equal(checkIndependentAcceptance('## 设计卡\nx').ok, false)
})

test('账本删除判定对 merge-base 比：main 后来新加的条目不算本 PR 删的（#1055 / #1065）——一条一个文件后由文件表天然保证', () => {
  const dir = 'tests/ux/full-walk/escapeLedger'
  // PR 文件表是对 merge-base 算的：main 后来加的 OTHER-PR.json 不在表里，所以根本不会被取、更不会被判成「删了」
  const fork = { [`${dir}/A.json`]: { id: 'A', status: 'candidate' }, [`${dir}/B.json`]: { id: 'B', status: 'candidate' } }
  const head = { ...fork, [`${dir}/MINE.json`]: { id: 'MINE', status: 'candidate' } }
  const fetch = (file, side) => {
    const value = (side === 'base' ? fork : head)[file]
    return value ? JSON.stringify(value) : null
  }
  assert.deepEqual(ledgerChanges([{ path: `${dir}/MINE.json`, status: 'added' }], fetch).removed, [])
  // 真删了自己起点里的条目照样红
  const dropped = { ...head }
  delete dropped[`${dir}/B.json`]
  const fetchDropped = (file, side) => {
    const value = (side === 'base' ? fork : dropped)[file]
    return value ? JSON.stringify(value) : null
  }
  assert.deepEqual(ledgerChanges([{ path: `${dir}/MINE.json`, status: 'added' }, { path: `${dir}/B.json`, status: 'removed' }], fetchDropped).removed, ['B'])
})

test('逃逸合同：修订已结账的合同不要求再转换；新合同 / 未结账的照旧红（#1061）', () => {
  const file = 'docs/fixes/2026-10-06-capability-unavailable-dead-end.root-cause.json'
  const baseLedger = { entries: [
    { id: 'FB-a', status: 'fixed', rootCauseContract: file },
    { id: 'FB-b', status: 'reviewed', rootCauseContract: 'docs/fixes/2026-10-06-other.root-cause.json' },
  ] }
  const settled = settledContracts(baseLedger)
  assert.deepEqual(settled, [file])
  // 用户后来改了拍板，合同不变量跟着改：条目在 base 已 fixed → 过
  const amend = checkEscapeContract('高清置灰', [{ file, added: false, detected_by: 'user' }], [], [], settled)
  assert.equal(amend.ok, true)
  assert.match(amend.lines.join(), /修订已结账/)
  // 同名路径但是新增的合同：仍要进账本
  assert.equal(checkEscapeContract('x', [{ file, added: true, detected_by: 'user' }], [], [], settled).ok, false)
  // 修订的合同，但对应条目还没结账：仍要转 fixed
  const other = { file: 'docs/fixes/2026-10-06-other.root-cause.json', added: false, detected_by: 'user' }
  const unsettled = checkEscapeContract('x', [other], [], [], settled)
  assert.equal(unsettled.ok, false)
  assert.match(unsettled.lines.join(), /other.root-cause/)
  // 一个已结账 + 一个没结账一起改：红，只点名没结账的那个
  const mixed = checkEscapeContract('x', [{ file, added: false, detected_by: 'user' }, other], [], [], settled)
  assert.equal(mixed.ok, false)
  assert.doesNotMatch(mixed.lines.join(), /capability-unavailable/)
  // 不传 settled（旧调用）：行为不变
  assert.equal(checkEscapeContract('x', [{ file, added: false, detected_by: 'user' }], []).ok, false)
  assert.deepEqual(settledContracts(null), [])
})

test('逃逸合同：判据看账本状态转换，不看正文用词', () => {
  const contract = { file: 'docs/fixes/2026-10-05-x.root-cause.json', detected_by: 'user' }
  // 误报（#1025）：正文写了「逃逸账本」，但没有条目转成 fixed → 不判成修逃逸 bug
  const mention = checkEscapeContract('这个 PR 新增逃逸账本的门岗，用户反馈见 #1', [], [])
  assert.equal(mention.applicable, false)
  assert.equal(mention.ok, true)
  // 漏报（#1026）：正文没有任何关键词，但把账本条目转成 fixed → 必须带合同
  const silent = checkEscapeContract('修分镜比例', [], ['LAW12-a'])
  assert.equal(silent.applicable, true)
  assert.equal(silent.ok, false)
  assert.match(silent.lines.join(), /LAW12-a/)
  assert.equal(checkEscapeContract('修分镜比例', [{ file: 'docs/fixes/2026-10-05-x.root-cause.json' }], ['LAW12-a']).ok, false, '合同没写 detected_by 不行')
  assert.equal(checkEscapeContract('修分镜比例', [contract], ['LAW12-a']).ok, true)
  // 合同声明用户发现、却没进账本：红（用户发现的问题必须进账本）
  const unledgered = checkEscapeContract('普通修复', [contract], [])
  assert.equal(unledgered.ok, false)
  assert.match(unledgered.lines.join(), /逃逸账本/)
  // 只引用账本条目 id、没转换：不要求合同，只给提示
  const ref = checkEscapeContract('参考 LAW12-a', [], [], ['LAW12-a'])
  assert.equal(ref.ok, true)
  assert.match(ref.lines.join(), /只是引用/)
  // 转换的判断只有一份实现：和 check:escape-ledger 共用 fixedTransitions
  const base = { entries: [{ id: 'LAW12-a', status: 'candidate' }, { id: 'LAW12-b', status: 'fixed' }] }
  const head = { entries: [{ id: 'LAW12-a', status: 'fixed' }, { id: 'LAW12-b', status: 'fixed' }] }
  assert.deepEqual(fixedTransitions(base, head), ['LAW12-a'])
})

test('报告：非四类只查 ★ 格；四类缺验收则结论红；扫描干净才写「扫描干净」', () => {
  const clean = renderReport({
    pr: 1,
    classification: classifyChange([{ path: 'src/utils/format.ts', status: 'M' }]),
    design: checkDesignCard(FULL_CARD, { fourClass: false }),
    acceptance: checkIndependentAcceptance(FULL_CARD),
    escape: checkEscapeContract('普通', [], []),
  })
  assert.equal(clean.blocked, false)
  assert.match(clean.text, /未命中，只查设计卡 ★ 格/)
  assert.match(clean.text, /扫描干净/)
  const four = classifyChange([{ path: 'electron/productionRun/productionRunService.ts', status: 'M' }])
  const noAcceptance = FULL_CARD.split('## 独立验收')[0]
  const blocked = renderReport({
    pr: 2,
    classification: four,
    design: checkDesignCard(noAcceptance, four),
    acceptance: checkIndependentAcceptance(noAcceptance),
    escape: checkEscapeContract('普通', [], []),
  })
  assert.equal(blocked.blocked, true)
  assert.match(blocked.text, /缺 `## 独立验收`/)
})

test('extractSection：取到下一个二级标题为止，HTML 注释不算内容', () => {
  const body = '## 设计卡\n<!-- 模板说明 -->\n内容\n## 验证\nx'
  assert.equal(extractSection(body, '设计卡'), '内容')
  assert.equal(extractSection(body, '独立验收'), null)
})

test('旧 PR（规则生效前开的）缺项只给警告、不判红；新 PR 照判', () => {
  assert.equal(isGrandfathered({ createdAt: '2026-10-02T10:00:00Z', effectiveAt: '2026-10-04T00:00:00Z' }), true)
  assert.equal(isGrandfathered({ createdAt: '2026-10-05T10:00:00Z', effectiveAt: '2026-10-04T00:00:00Z' }), false)
  assert.equal(isGrandfathered({ createdAt: '2026-10-05T10:00:00Z', effectiveAt: null }), true, '#961 还没合并 = 规则尚未生效')
  const four = classifyChange([{ path: 'electron/productionRun/productionRunService.ts', status: 'M' }])
  const input = { pr: 947, classification: four, design: checkDesignCard('随便', four), acceptance: checkIndependentAcceptance('随便'), escape: checkEscapeContract('普通', [], []) }
  const old = renderReport({ ...input, grandfathered: true })
  assert.equal(old.blocked, false)
  assert.doesNotMatch(old.text, /✖/)
  assert.match(old.text, /⚠ PR 正文没有/)
  assert.equal(renderReport({ ...input, grandfathered: false }).blocked, true)
})

test('规则与门岗范围：碰到受保护文件必须在正文点名，整文件删除要写理由（#1032 回退 #1031 的事故）', () => {
  const files = [
    { path: 'CLAUDE.md', status: 'modified' },
    { path: 'scripts/check-escape-ledger.mjs', status: 'removed' },
    { path: 'src/devlab/designLab/processFeedback/processFeedbackLabKit.tsx', status: 'modified' },
  ]
  const silent = checkProtectedScope('## 为什么\n换基线', files)
  assert.equal(silent.ok, false)
  assert.match(silent.lines.join('\n'), /CLAUDE\.md/)
  assert.match(silent.lines.join('\n'), /check-escape-ledger\.mjs（整文件删除）/)
  const namedNoReason = checkProtectedScope('## 碰到的规则与门岗\n- CLAUDE.md：P2 改一句\n- scripts/check-escape-ledger.mjs', files)
  assert.equal(namedNoReason.ok, false, '整文件删除只点名不写理由仍红')
  const named = checkProtectedScope('## 碰到的规则与门岗\n- CLAUDE.md：P2 改一句\n- scripts/check-escape-ledger.mjs 删除：并进 check-ledger.mjs', files)
  assert.equal(named.ok, true)
  assert.equal(checkProtectedScope('', [{ path: 'src/a.ts', status: 'modified' }]).ok, true, '没碰受保护文件不要求这一节')
})

test('规则与门岗范围：package.json 删掉门岗命令也算；逃逸账本条目消失直接红', () => {
  const pkg = checkProtectedScope('', [{ path: 'package.json', status: 'modified' }], { packageRemovedLines: ['    "check:escape-ledger": "node scripts/check-escape-ledger.mjs",'] })
  assert.equal(pkg.ok, false)
  assert.match(pkg.lines.join('\n'), /package\.json/)
  assert.equal(checkProtectedScope('', [{ path: 'package.json', status: 'modified' }], { packageRemovedLines: ['    "vite": "^7.0.0",'] }).ok, true, '只改依赖不算')
  const ledger = checkProtectedScope('', [], { ledgerRemovedIds: ['AUD-20261005-01'] })
  assert.equal(ledger.ok, false)
  assert.match(ledger.lines.join('\n'), /AUD-20261005-01/)
})

test('报告：规则与门岗范围红了，规则生效前开的 PR 也不放宽', () => {
  const report = renderReport({
    pr: 1,
    grandfathered: true,
    classification: { fourClass: false, classes: [], hits: [] },
    design: { ok: false, lines: ['✖ 设计卡缺格'] },
    acceptance: { ok: true, lines: [] },
    escape: { ok: true, lines: [] },
    scope: { ok: false, lines: ['✖ 碰到规则 / 门岗文件但正文没点名：CLAUDE.md'] },
  })
  assert.equal(report.blocked, true)
  assert.match(report.text, /⚠ 设计卡缺格/)
  assert.match(report.text, /✖ 碰到规则/)
})

test('分页文件表：超过 100 个文件也全收，账本排在后面照样认得出（#1048 有 129 个文件曾被截断）', () => {
  const rows = Array.from({ length: 129 }, (_, i) => `src/f${String(i).padStart(3, '0')}.ts\tmodified\t1\t0`)
  rows.push('tests/ux/full-walk/escapeLedger/LAW12-a.json\tadded\t20\t0', 'docs/old.md\tremoved\t0\t9')
  const parsed = parsePullFileRows(rows.join('\n') + '\n')
  assert.equal(parsed.length, 131)
  assert.ok(parsed.some((row) => row.path === 'tests/ux/full-walk/escapeLedger/LAW12-a.json'))
  assert.deepEqual(parsed.at(-1), { path: 'docs/old.md', status: 'removed', additions: 0, deletions: 9 })
  assert.deepEqual(parsePullFileRows(''), [])
  // 改名行带旧路径（jq 输出第五列）；没改名时第五列是空串，不出 previousPath
  assert.deepEqual(parsePullFileRows('tests/ux/full-walk/escapeLedger/LAW12-b.json\trenamed\t0\t0\ttests/ux/full-walk/escapeLedger/LAW12-a.json\n'),
    [{ path: 'tests/ux/full-walk/escapeLedger/LAW12-b.json', status: 'renamed', additions: 0, deletions: 0, previousPath: 'tests/ux/full-walk/escapeLedger/LAW12-a.json' }])
  assert.deepEqual(parsePullFileRows('src/a.ts\tmodified\t1\t0\t\n'), [{ path: 'src/a.ts', status: 'modified', additions: 1, deletions: 0 }])
})

test('逃逸账本一条一个文件：只取本 PR 动到的条目文件的两版；转 fixed、被删、改名都认得出，别的文件不去取', () => {
  const dir = 'tests/ux/full-walk/escapeLedger'
  const versions = {
    base: {
      [`${dir}/FB-a.json`]: { id: 'FB-a', status: 'reviewed' },
      [`${dir}/FB-b.json`]: { id: 'FB-b', status: 'candidate' },
      [`${dir}/FB-c.json`]: { id: 'FB-c', status: 'candidate' },
      [`${dir}/FB-old.json`]: { id: 'FB-old', status: 'candidate' },
    },
    head: {
      [`${dir}/FB-a.json`]: { id: 'FB-a', status: 'fixed' },
      [`${dir}/FB-new.json`]: { id: 'FB-new', status: 'fixed' },
      [`${dir}/FB-renamed.json`]: { id: 'FB-renamed', status: 'candidate' },
    },
  }
  const fetched = []
  const fetch = (file, side) => {
    fetched.push(`${side}:${file}`)
    const value = versions[side][file]
    return value ? JSON.stringify(value) : null
  }
  const result = ledgerChanges([
    { path: `${dir}/FB-a.json`, status: 'modified' },
    { path: `${dir}/FB-new.json`, status: 'added' },
    { path: `${dir}/FB-b.json`, status: 'removed' },
    { path: `${dir}/FB-renamed.json`, status: 'renamed', previousPath: `${dir}/FB-old.json` },
    { path: `${dir}/${'_meta.json'}`, status: 'modified' },
    { path: 'src/other.ts', status: 'modified' },
  ], fetch)
  assert.deepEqual(result.transitions.sort(), ['FB-a', 'FB-new'])
  assert.deepEqual(result.removed.sort(), ['FB-b', 'FB-old'])
  assert.ok(!fetched.some((key) => key.includes('FB-c') || key.includes('src/other') || key.includes('_meta')), `不该取没动的文件：${fetched.join(', ')}`)
  assert.ok(!fetched.includes(`base:${dir}/FB-new.json`), '新增的条目不去取 base')
  assert.ok(!fetched.includes(`head:${dir}/FB-b.json`), '删掉的条目不去取 head')
  // 文件表退回 A / M（取不到分页表时）：head 取不到而 base 取得到也算删
  const fallback = ledgerChanges([{ path: `${dir}/FB-c.json`, status: 'M' }], fetch)
  assert.deepEqual(fallback.removed, ['FB-c'])
  assert.deepEqual(ledgerChanges([{ path: 'src/a.ts', status: 'M' }], fetch), { transitions: [], removed: [] })
})

test('判已结账合同：一次 GraphQL 取回的目录按同一套规则组装成账本；缺 _meta / 文件名和 id 对不上 → 取不到（null）', () => {
  const file = 'docs/fixes/2026-10-06-capability-unavailable-dead-end.root-cause.json'
  const blob = (value) => ({ text: JSON.stringify(value) })
  const tree = [
    { name: '_meta.json', object: blob({ $schemaVersion: 1 }) },
    { name: 'FB-a.json', object: blob({ id: 'FB-a', since: '2026-10-06', status: 'fixed', rootCauseContract: file }) },
    { name: 'FB-b.json', object: blob({ id: 'FB-b', since: '2026-10-05', status: 'reviewed' }) },
  ]
  const ledger = escapeLedgerFromTree(tree)
  assert.deepEqual(ledger.entries.map((entry) => entry.id), ['FB-b', 'FB-a'])
  assert.deepEqual(settledContracts(ledger), [file])
  assert.equal(escapeLedgerFromTree(tree.slice(1)), null)
  assert.equal(escapeLedgerFromTree([...tree, { name: 'FB-c.json', object: blob({ id: 'FB-x' }) }]), null)
  assert.equal(escapeLedgerFromTree(undefined), null)
})
