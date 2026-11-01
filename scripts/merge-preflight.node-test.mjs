// scripts/merge-preflight.mjs 的行为测试：四类判定、设计卡格子、独立验收、逃逸合同。
// 判据部分测纯函数，输入都是真实 PR 正文的形状；取数部分（main()）用临时 git 仓库当 GitHub，端到端跑。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { cleanupTestTemp, makeTempDir } from './_test-temp.mjs'
import { fixedTransitions } from './escape-ledger-lib.mjs'
import { prChanges } from './lib/prChanges.mjs'
import {
  checkDesignCard,
  checkEscapeContract,
  settledContracts,
  checkIndependentAcceptance,
  classifyChange,
  implementationLine,
  isGrandfathered,
  ledgerChanges,
  renderReport,
  resolveJudgementStage,
} from './pr-body-criteria.mjs'
import { checkProtectedScope, extractSection, main as preflightMain } from './merge-preflight.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

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

test('独立验收的报告链接：推送时只提醒（报告要推送后才有），合并时照旧必须有；CI 里不认推送档', () => {
  const pending = FULL_CARD.replace('https://example.com/report', '未验证：待协调会话指派验收线')
  const atPush = checkIndependentAcceptance(pending, { stage: 'push' })
  assert.equal(atPush.ok, true)
  assert.match(atPush.lines.join('\n'), /⚠ 独立验收还没有报告链接/)
  assert.equal(checkIndependentAcceptance(pending).ok, false, '缺省按合并判')
  assert.equal(checkIndependentAcceptance(pending, { stage: 'merge' }).ok, false)
  // 推送档只放宽「链接」这一项：没有这一节、没写验收线、验收线等于实现线，推送时照样红
  assert.equal(checkIndependentAcceptance('## 设计卡\nx', { stage: 'push' }).ok, false)
  assert.equal(checkIndependentAcceptance(pending.replace(/验收线：线 B/, ''), { stage: 'push' }).ok, false)
  const same = pending.replace('线/负责人：线 A', '实现线：线B').replace('验收线：线 B', '验收线：线B')
  assert.equal(checkIndependentAcceptance(same, { stage: 'push' }).ok, false)
  assert.equal(resolveJudgementStage({ NOMI_PR_JUDGEMENT_STAGE: 'push' }), 'push')
  assert.equal(resolveJudgementStage({}), 'merge')
  assert.equal(resolveJudgementStage({ NOMI_PR_JUDGEMENT_STAGE: 'push', CI: 'true' }), 'merge', 'CI 里继承来的变量不能放宽判据')
  assert.equal(resolveJudgementStage({ NOMI_PR_JUDGEMENT_STAGE: 'merge-later' }), 'merge')
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
  assert.equal(checkEscapeContract('修分镜比例\n\n## 验收证据\n\n- real-scene-replay：修前 docs/evidence/a.log；修后 docs/evidence/b.log', [contract], ['LAW12-a']).ok, true)
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

test('逃逸账本一条一个文件：只取本 PR 动到的条目文件的两版；转 fixed、被删都认得出，别的文件不去取', () => {
  const dir = 'tests/ux/full-walk/escapeLedger'
  const versions = {
    base: {
      [`${dir}/FB-a.json`]: { id: 'FB-a', status: 'reviewed' },
      [`${dir}/FB-b.json`]: { id: 'FB-b', status: 'candidate' },
      [`${dir}/FB-c.json`]: { id: 'FB-c', status: 'candidate' },
    },
    head: {
      [`${dir}/FB-a.json`]: { id: 'FB-a', status: 'fixed' },
      [`${dir}/FB-new.json`]: { id: 'FB-new', status: 'fixed' },
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
    { path: `${dir}/${'_meta.json'}`, status: 'modified' },
    { path: 'src/other.ts', status: 'modified' },
  ], fetch)
  assert.deepEqual(result.transitions.sort(), ['FB-a', 'FB-new'])
  assert.deepEqual(result.removed.sort(), ['FB-b'])
  assert.ok(!fetched.some((key) => key.includes('FB-c') || key.includes('src/other') || key.includes('_meta')), `不该取没动的文件：${fetched.join(', ')}`)
  assert.ok(!fetched.includes(`base:${dir}/FB-new.json`), '新增的条目不去取 base')
  assert.ok(!fetched.includes(`head:${dir}/FB-b.json`), '删掉的条目不去取 head')
  // 文件表退回 A / M（取不到分页表时）：head 取不到而 base 取得到也算删
  const fallback = ledgerChanges([{ path: `${dir}/FB-c.json`, status: 'M' }], fetch)
  assert.deepEqual(fallback.removed, ['FB-c'])
  assert.deepEqual(ledgerChanges([{ path: 'src/a.ts', status: 'M' }], fetch), { transitions: [], removed: [] })
})

// ── 取数只走本地 git（2026-10-24）：GitHub 的 PR diff 超过 300 个文件就 HTTP 406（#1269 改了 321 个，扫描只能打「取不到 PR diff」），
//    文件表 / 列目录 / GraphQL / compare 也各有上限——现在文件表、新增行、文件内容、merge-base 全在本地对 fetch 到的提交算。
//    这里用临时仓库当 GitHub：裸仓库当 origin（refs/heads/main + refs/pull/7/head），一个空仓库当协调会话的检出（main() 在里面 fetch）；
//    假 gh 只认 pr view——pr diff 照真 GitHub 那样报 406，别的（api / graphql / compare / contents）一律报错，证明实现不再走它们。
const PR = '7'
const LEDGER_DIR = 'tests/ux/full-walk/escapeLedger'
const LEDGER = `${LEDGER_DIR}/FB-x.json`
const CONTRACT = 'docs/fixes/x.root-cause.json'
const runGit = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })

/** base / head：{ 路径: 文本 | 对象（写成 JSON） | null（在 head 里删掉） }。返回 { git, root, origin, baseSha, headSha }。 */
function prRepo(t, { base = {}, head = {} } = {}) {
  const dir = makeTempDir('merge-preflight-')
  t.after(() => cleanupTestTemp(dir))
  const origin = path.join(dir, 'origin.git')
  const work = path.join(dir, 'work')
  const local = path.join(dir, 'local')
  runGit(dir, ['init', '-q', '--bare', origin])
  runGit(dir, ['init', '-q', work])
  for (const [key, value] of [['user.email', 't@t'], ['user.name', 't'], ['commit.gpgsign', 'false']]) runGit(work, ['config', key, value])
  const commit = (files, message) => {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(work, rel)
      if (content === null) { fs.rmSync(abs, { force: true }); continue }
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`)
    }
    runGit(work, ['add', '-A'])
    runGit(work, ['commit', '-q', '--allow-empty', '-m', message])
    return runGit(work, ['rev-parse', 'HEAD']).trim()
  }
  const baseSha = commit({ 'README.md': 'base\n', ...base }, 'base')
  runGit(work, ['push', '-q', origin, 'HEAD:refs/heads/main'])
  const headSha = commit(head, 'pr')
  runGit(work, ['push', '-q', origin, `HEAD:refs/pull/${PR}/head`])
  runGit(dir, ['init', '-q', local])
  runGit(local, ['remote', 'add', 'origin', origin])
  return { git: (args) => runGit(local, args), root: local, origin, baseSha, headSha }
}

function fakeGh({ headRefOid, body = '## 设计卡\n', createdAt = '2026-10-10T00:00:00Z' }) {
  const calls = []
  const exec = (args) => {
    const line = args.join(' ')
    calls.push(line)
    if (line.startsWith('pr view')) return JSON.stringify({ body, headRefOid, baseRefName: 'main', createdAt })
    // 真 GitHub 的原话（#1269）：实现若退回 gh pr diff 取数，大 PR 就拿不到结论
    if (line.startsWith('pr diff')) throw new Error("could not find pull request diff: HTTP 406: Sorry, the diff exceeded the maximum number of files (300). Consider using 'List pull requests files' API or locally cloning the repository instead.")
    throw new Error(`unexpected gh call: ${line}`)
  }
  return { exec, calls }
}

function runPreflight(repo, { git = repo.git, ...options } = {}) {
  const { exec, calls } = fakeGh({ headRefOid: repo.headSha, ...options })
  const lines = []
  const original = console.log
  console.log = (...parts) => lines.push(parts.join(' '))
  try {
    return { code: preflightMain([PR, '--repo', 'o/r'], exec, git, repo.root), out: lines.join('\n'), calls }
  } finally {
    console.log = original
  }
}

const ONLY_PR_VIEW = [`pr view ${PR} --json body,headRefOid,baseRefName,createdAt --repo o/r`]
const sources = (count, version) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`src/f${String(i).padStart(3, '0')}.ts`, `export const v${i} = ${version}\n`]))

test('大 PR（超过 300 个文件，GitHub 的 PR diff 给不了）：本地 git 取全文件表，排在最后的账本条目也认得出，出真结论', (t) => {
  const count = 320
  const repo = prRepo(t, {
    base: { ...sources(count, 0), [LEDGER]: { id: 'FB-x', status: 'candidate' } },
    head: { ...sources(count, 1), [CONTRACT]: { detected_by: 'user' }, [LEDGER]: { id: 'FB-x', status: 'fixed' } },
  })
  const result = runPreflight(repo)
  assert.match(result.out, /^合并前扫描 · PR #7$/m, result.out)
  assert.doesNotMatch(result.out, /取不到/)
  assert.match(result.out, /逃逸账本 FB-x → fixed：带了含 detected_by 的合同（docs\/fixes\/x\.root-cause\.json）/, '账本条目排在第 321 个文件之后')
  assert.doesNotMatch(result.out, /没有把对应的逃逸账本条目/)
  assert.match(result.out, /^结论：/m)
  assert.deepEqual(result.calls, ONLY_PR_VIEW, '远程只剩 gh pr view 一次：不再走 gh pr diff / 文件表 / contents / compare / GraphQL')
  const changes = prChanges({ git: repo.git, base: repo.baseSha, head: repo.headSha })
  assert.equal(changes.files.length, count + 2)
  assert.deepEqual(changes.files.at(-1), { path: LEDGER, status: 'M' })
})

test('head 对不上：fetch 到的 pull/<n>/head 不是 gh pr view 给的 headRefOid（取数这几秒里 PR 又推了）→ 取数失败，不拿新 head 判旧正文', (t) => {
  const repo = prRepo(t, { base: { 'src/a.ts': 'a\n' }, head: { 'src/a.ts': 'b\n' } })
  const result = runPreflight(repo, { headRefOid: repo.baseSha })
  assert.equal(result.code, 1)
  assert.match(result.out, new RegExp(`取不到和正文同一版的 PR head：fetch 到的 pull/7/head 是 ${repo.headSha.slice(0, 12)}，gh pr view 给的是 ${repo.baseSha.slice(0, 12)}`))
  assert.match(result.out, /^结论：✖ 有项没过，先别合（取数失败，不是 PR 的问题/m)
  assert.doesNotMatch(result.out, /合并前扫描 · PR/, '取数失败不出判据行')
})

test('本地 diff 的格式用参数钉死：仓库里设了 diff.noprefix / diff.mnemonicPrefix / color.ui=always / diff.renames / diff.orderFile / diff.algorithm，文件表、新增行、package.json 被删行和扫描结论都不变', (t) => {
  const problem = '用户在生成框里点了重试，结果没有任何反应，也没有提示哪里出了问题，只能关掉重开'.repeat(4)
  const repo = prRepo(t, {
    base: {
      'package.json': '{\n  "scripts": {\n    "check:x": "node scripts/check-x.mjs",\n    "build": "vite build"\n  }\n}\n',
      'src/workbench/ai/stream.ts': 'export const a = 1\n',
      'docs/中文说明.md': '一\n',
      [`${LEDGER_DIR}/FB-old.json`]: { id: 'FB-old', status: 'candidate', problem },
    },
    head: {
      'package.json': '{\n  "scripts": {\n    "build": "vite build"\n  }\n}\n',
      'src/workbench/ai/stream.ts': 'export const a = 1\nexport const c = new AbortController()\n',
      'docs/中文说明.md': '一\n二\n',
      [`${LEDGER_DIR}/FB-old.json`]: null,
      [`${LEDGER_DIR}/FB-new.json`]: { id: 'FB-new', status: 'candidate', problem },
    },
  })
  const clean = runPreflight(repo)
  const cleanChanges = prChanges({ git: repo.git, base: repo.baseSha, head: repo.headSha })
  // 先证明基准本身是对的（否则「不变」没有意义）
  assert.deepEqual(cleanChanges.files, [
    { path: 'docs/中文说明.md', status: 'M' },
    { path: 'package.json', status: 'M' },
    { path: 'src/workbench/ai/stream.ts', status: 'M' },
    { path: `${LEDGER_DIR}/FB-new.json`, status: 'A' },
    { path: `${LEDGER_DIR}/FB-old.json`, status: 'D' },
  ])
  assert.equal(cleanChanges.addedByFile.get('src/workbench/ai/stream.ts'), '+export const c = new AbortController()')
  assert.equal(cleanChanges.addedByFile.get('docs/中文说明.md'), '+二')
  assert.deepEqual(cleanChanges.packageRemovedLines, ['    "check:x": "node scripts/check-x.mjs",'])
  assert.match(clean.out, /四类：命中（[^）]*可打断/)
  assert.match(clean.out, /没点名：[^\n]*package\.json/)
  // 再把会改 diff 输出的配置全打开：结果逐字不变
  const orderFile = path.join(repo.root, 'diff-order.txt')
  fs.writeFileSync(orderFile, 'tests/*\nsrc/*\npackage.json\n')
  for (const [key, value] of [['diff.noprefix', 'true'], ['diff.mnemonicPrefix', 'true'], ['color.ui', 'always'], ['diff.renames', 'copies'], ['diff.orderFile', orderFile], ['diff.algorithm', 'histogram']]) runGit(repo.root, ['config', key, value])
  assert.deepEqual(prChanges({ git: repo.git, base: repo.baseSha, head: repo.headSha }), cleanChanges)
  assert.equal(runPreflight(repo).out, clean.out)
})

test('逃逸账本条目文件改名：文件表里是「旧路径 D + 新路径 A」，旧 id 照样算被删（和原来 previous_filename 的行为一致）', (t) => {
  const problem = '导出的视频少了最后一个镜头，时间轴上明明还在，预览也正常，只有导出文件里没有'.repeat(4)
  const repo = prRepo(t, {
    base: { [`${LEDGER_DIR}/FB-old.json`]: { id: 'FB-old', status: 'candidate', problem } },
    head: { [`${LEDGER_DIR}/FB-old.json`]: null, [`${LEDGER_DIR}/FB-new.json`]: { id: 'FB-new', status: 'candidate', problem } },
  })
  const result = runPreflight(repo)
  assert.match(result.out, /✖ 逃逸账本里有条目被删掉：FB-old（/)
  assert.equal(result.code, 1)
  // 内容几乎一样，git 默认会认成改名（R0xx）；钉死 --no-renames 后是一删一增，旧路径不会藏在改名记录里
  assert.deepEqual(prChanges({ git: repo.git, base: repo.baseSha, head: repo.headSha }).files, [
    { path: `${LEDGER_DIR}/FB-new.json`, status: 'A' },
    { path: `${LEDGER_DIR}/FB-old.json`, status: 'D' },
  ])
})

test('取数失败 = 没有结论：fetch 不到、本机缺对象、合同内容读不出来、浅克隆——都是「结论：✖ 取不到」，也不退回 GitHub API', (t) => {
  const repo = prRepo(t, { base: { 'src/a.ts': 'a\n' }, head: { 'src/a.ts': 'b\n', [CONTRACT]: { detected_by: 'user' } } })
  const failing = (when, message) => (args) => {
    if (!when(args)) return repo.git(args)
    const error = new Error(`Command failed: git ${args.join(' ')}\n${message}`)
    error.status = 128
    throw error
  }
  // 输出超过 maxBuffer：Node 杀掉子进程并抛 ENOBUFS（不是返回截断的输出）——到这里同样是取数失败，不会拿半份 diff 去判
  const overflow = (args) => {
    if (args.includes('-U0')) throw Object.assign(new Error('spawnSync git ENOBUFS'), { code: 'ENOBUFS' })
    return repo.git(args)
  }
  const cases = [
    ['fetch 失败', failing((args) => args[0] === 'fetch', "fatal: couldn't find remote ref refs/pull/7/head"), /取不到PR head 与基线分支的提交（git fetch）/],
    ['本机缺对象', failing((args) => args.includes('diff'), 'fatal: bad object'), /取不到PR 改动（本地 git diff）/],
    ['diff 输出超过上限', overflow, /取不到PR 改动（本地 git diff）：spawnSync git ENOBUFS/],
    ['合同内容读不出来', failing((args) => args[0] === 'rev-parse' && String(args.at(-1)).endsWith(`:${CONTRACT}`), 'fatal: unable to read tree'), /取不到docs\/fixes\/x\.root-cause\.json@[0-9a-f]{9} 的内容/],
  ]
  for (const [label, git, pattern] of cases) {
    const result = runPreflight(repo, { git })
    assert.equal(result.code, 1, label)
    assert.match(result.out, pattern, `${label}：${result.out}`)
    assert.match(result.out, /^结论：✖ 有项没过，先别合（取数失败/m, label)
    assert.deepEqual(result.calls, ONLY_PR_VIEW, `${label}：取不到也不许退回 GitHub API`)
  }
  // 真实的取不到：远端没有这个 PR 的引用
  const gone = prRepo(t, { base: { 'src/a.ts': 'a\n' }, head: { 'src/a.ts': 'b\n' } })
  runGit(gone.origin, ['update-ref', '-d', `refs/pull/${PR}/head`])
  const missing = runPreflight(gone)
  assert.equal(missing.code, 1)
  assert.match(missing.out, /取不到PR head 与基线分支的提交（git fetch）/)
  // 浅克隆：merge-base 算不准，不当真
  const shallow = prRepo(t, { base: { 'src/a.ts': 'a\n' }, head: { 'src/a.ts': 'b\n' } })
  runGit(shallow.root, ['fetch', '-q', '--depth', '1', 'origin', 'refs/heads/main'])
  const cut = runPreflight(shallow)
  assert.equal(cut.code, 1)
  assert.match(cut.out, /取不到完整的提交历史：本机仓库是浅克隆/)
})

test('取数只有本地 git 一个口：合并前扫描的远程调用只剩 gh pr view，文件表 / 新增行只经 scripts/lib/prChanges.mjs（不再有 gh pr diff、gh api、第二份 git diff）', () => {
  const source = fs.readFileSync(path.join(here, 'merge-preflight.mjs'), 'utf8')
  const ghCalls = [...source.matchAll(/\bgh\(\[\s*'([^']+)',\s*'([^']+)'/g)].map((match) => `${match[1]} ${match[2]}`)
  assert.deepEqual(ghCalls, ['pr view'])
  assert.doesNotMatch(source, /\bexec\(\[/, '不许绕过 gh 包装直接调 gh')
  assert.doesNotMatch(source, /'api'|'graphql'|contents\/|\/compare\/|'--paginate'/, '文件内容 / 文件表 / 目录 / merge-base 不再走 GitHub API')
  assert.match(source, /from '\.\/lib\/prChanges\.mjs'/)
  assert.doesNotMatch(source, /'--name-status'|'-U0'/, '文件表 / 新增行只从 prChanges 一处取')
})

// ── 花钱类合并前要有真付费证据（2026-10-16，#1203 写「未验证」被合进来）：端到端走一遍 main()，只看真付费那一行 ──
const SPEND_FILE = 'electron/capabilityCore/generationSpendDecision.ts'
const spendBody = (paidLine) => [
  '## 设计卡', '### 功能分类', '- [x] 花钱', '',
  '## 验收证据',
  '- spend-walks：tests/ux/agent-spend-card.walk.mjs',
  ...(paidLine ? [paidLine] : []),
  '- spend-fault-injection：tests/ux/full-walk/playbooks/pb07-failure-kinds.walk.mjs',
].join('\n')
const spendRepo = (t) => prRepo(t, { base: { [SPEND_FILE]: 'export const a = 1\n' }, head: { [SPEND_FILE]: 'export const a = 2\n' } })

test('花钱类 PR：正文缺 spend-paid-sample 行 → 扫描红并点名；写「未验证」→ 红；写裸 PR 号 → 红', (t) => {
  const repo = spendRepo(t)
  for (const line of [null, '- spend-paid-sample：未验证：待协调真付费', '- spend-paid-sample：#1203']) {
    const result = runPreflight(repo, { body: spendBody(line) })
    assert.equal(result.code, 1, String(line))
    assert.match(result.out, /spend-paid-sample/, String(line))
    assert.match(result.out, /✖ [^\n]*spend-paid-sample|→ spend-paid-sample/, String(line))
    assert.match(result.out, /结论：✖/, String(line))
  }
})

test('花钱类 PR：补上运行号 / 报告链接 → 真付费那一项不再红；协调豁免 → 不红且醒目打出理由', (t) => {
  const repo = spendRepo(t)
  for (const line of ['- spend-paid-sample：run 20261016', '- spend-paid-sample：https://example.com/paid-report']) {
    const result = runPreflight(repo, { body: spendBody(line) })
    assert.doesNotMatch(result.out, /→ spend-paid-sample/, line)
    assert.doesNotMatch(result.out, /缺这些证据条目：[^\n]*spend-paid-sample/, line)
  }
  const waived = runPreflight(repo, { body: spendBody('- spend-paid-sample：协调豁免：只改日志文案，不碰供应商') })
  assert.doesNotMatch(waived.out, /→ spend-paid-sample/)
  assert.match(waived.out, /⚠ spend-paid-sample：协调豁免——只改日志文案/)
})

test('不是花钱类的 PR 不被要求这一行', (t) => {
  const repo = prRepo(t, { base: { 'src/utils/format.ts': 'a\n' }, head: { 'src/utils/format.ts': 'b\n' } })
  const result = runPreflight(repo, { body: '## 设计卡\n' })
  assert.match(result.out, /^合并前扫描 · PR #7$/m)
  assert.doesNotMatch(result.out, /spend-paid-sample/)
})
