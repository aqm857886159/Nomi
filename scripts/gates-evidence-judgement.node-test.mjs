// 门岗从「有没有」改成「对不对」（流程试行第 3 项，2026-10-21）：三处判据的反例测试，每个反例配一个会过的好例。
// 起因：PR #1264 设计卡九格都填、门岗全过，但性能场景是 pending、p95 127ms 超 100ms 预算、没有拍板图清单、真机没跑——
// 旧判据只看「条目在不在、链接有没有」，不看内容对不对。
//   1. 独立验收：贴链接不算，要核报告结论 / 验收的 HEAD / 验收线（pr-body-criteria.checkIndependentAcceptance）
//   2. 性能：pending 不能算达标、按声明的统计层级与适用预算判、原始结果可读且样本够且数字有限、正文数字要和原始结果对上（perf-scenarios-lib.parsePerfEvidence）
//   3. 改界面的 PR：认领拍板图清单，或给已登记的例外（pr-body-criteria.evaluatePrBody → checkBoardClaim）
// 修之前这些测试必须是红的（红的证据见交付报告）。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { checkIndependentAcceptance, evaluatePrBody } from './pr-body-criteria.mjs'
import { parsePerfEvidence } from './perf-scenarios-lib.mjs'
import { checkPrBoardClaims } from './check-board-parity.mjs'
import { boardsAtHead, checkHeadAncestry } from './lib/prEvidenceInputs.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const HEAD = 'abcdef1234567890abcdef1234567890abcdef12'

// ── 1. 独立验收 ─────────────────────────────────────────────────────────────────────────────────────────
const acceptanceBody = ({ line = 'V-x', link = 'D:/Nomi-coord-state/reports/V-x.md', first = 'V-x：有条件通过', head = 'abcdef1' } = {}) => [
  '## 独立验收',
  `- 验收线：${line}`,
  link ? `- 报告：${link}` : '',
  first === null ? '' : `- 报告首行：${first}`,
  head === null ? '' : `- 验收 HEAD：${head}`,
  '实现线：I-x',
].filter(Boolean).join('\n')
const reportText = ({ first = 'V-x：有条件通过', head = 'abcdef1234567890abcdef1234567890abcdef12', line = 'V-x' } = {}) => `${first}\n\n# V-x 独立验收\n\n- 验收线：${line}（独立于 I-x）\n- 验收 HEAD：\`${head}\`\n`
const strict = (body, extra = {}) => checkIndependentAcceptance(body, { stage: 'merge', strict: true, headSha: HEAD, readReport: () => undefined, ...extra })
const red = (result, pattern) => {
  assert.equal(result.ok, false, `应该红：\n${result.lines.join('\n')}`)
  if (pattern) assert.match(result.lines.join('\n'), pattern)
}
const green = (result) => assert.equal(result.ok, true, `应该绿：\n${result.lines.join('\n')}`)

test('独立验收·好例：结论、验收 HEAD、验收线都对，且报告本体读得到、与正文一致 → 绿', () => {
  green(strict(acceptanceBody(), { readReport: () => reportText() }))
})

test('独立验收·只有链接没有结论 → 红（旧判据：链接在就算过）', () => {
  red(strict(acceptanceBody({ first: null })), /报告首行|结论/)
})

test('独立验收·报告结论是「不通过」→ 红；「有条件通过」「通过」→ 绿；认不出结论 → 红', () => {
  red(strict(acceptanceBody({ first: 'V-x：不通过（阻断：B1 误写目标文稿）' })), /不通过/)
  green(strict(acceptanceBody({ first: 'V-x：通过' })))
  green(strict(acceptanceBody({ first: 'V-x：有条件通过（缺真机，已记未验证）' })))
  red(strict(acceptanceBody({ first: 'V-x：已看过，大体可以' })), /认不出|通过 \/ 有条件通过 \/ 不通过/)
})

test('独立验收·结论写通过但仍带未解除的阻断 → 红', () => {
  red(strict(acceptanceBody({ first: 'V-x：有条件通过（仍有阻断：B2 撤销会丢字）' })), /阻断/)
  green(strict(acceptanceBody({ first: 'V-x：有条件通过（无阻断；缺真机已记未验证）' })))
})

test('独立验收·验收的 HEAD 和 PR 当前 head 不一致 → 红；写得对 → 绿；缺 HEAD → 红；拿不到 PR head → 红', () => {
  red(strict(acceptanceBody({ head: '0123456' }), { headRelation: () => ({ ok: false, reason: '分支又加了代码提交' }) }), /验收 HEAD|head/)
  green(strict(acceptanceBody({ head: '0123456' }), { headRelation: () => ({ ok: true, note: '之后只有干净合并 main' }) }))
  const unknown = strict(acceptanceBody({ head: '0123456' }), { headRelation: () => ({ unknown: true, reason: '浅克隆' }) })
  green(unknown)
  assert.match(unknown.lines.join('\n'), /本机核/)
  red(strict(acceptanceBody({ head: null })), /验收 HEAD/)
  green(strict(acceptanceBody({ head: 'abcdef1234567890' })))
  red(strict(acceptanceBody(), { headSha: null }), /PR 当前 head|拿不到/)
})

test('独立验收·读得到报告本体时：首行与正文贴的不同、报告里的 HEAD 过期、报告写不通过而正文写通过 → 红', () => {
  red(strict(acceptanceBody(), { readReport: () => reportText({ first: 'V-x：有条件通过（另一句）' }) }), /首行/)
  red(strict(acceptanceBody(), { readReport: () => reportText({ head: '0123456789abcdef0123456789abcdef01234567' }), headRelation: () => ({ ok: false, reason: '分支又加了代码提交' }) }), /报告里的验收 HEAD|HEAD/)
  red(strict(acceptanceBody({ first: 'V-x：通过' }), { readReport: () => reportText({ first: 'V-x：不通过（阻断：B1）' }) }), /不通过/)
})

test('独立验收·报告读不到 → 红；本环境不读本机报告（CI）→ 只核正文并提示本机核', () => {
  red(strict(acceptanceBody(), { readReport: () => null }), /读不到/)
  const ci = strict(acceptanceBody(), { readReport: () => undefined })
  green(ci)
  assert.match(ci.lines.join('\n'), /本机核/)
})

test('独立验收·报告里的验收线和实现线相同 / 和正文写的不同 → 红', () => {
  red(strict(acceptanceBody(), { readReport: () => reportText({ line: 'I-x' }) }), /验收线/)
  red(strict(acceptanceBody({ line: 'I-x' })), /和实现线相同/)
})

test('独立验收·推送档只提醒（报告推送后才有），不因缺首行 / 缺 HEAD 判红', () => {
  const body = acceptanceBody({ first: null, head: null, link: '' })
  const push = checkIndependentAcceptance(body, { stage: 'push', strict: true, headSha: HEAD, readReport: () => undefined })
  green(push)
  assert.match(push.lines.join('\n'), /⚠/)
})

// ── 2. 性能 ─────────────────────────────────────────────────────────────────────────────────────────────
const scenario = (overrides = {}) => ({
  id: 'sample-type', script: 'tests/perf/canvas-scale-bench.mjs', metrics: ['response'], budget: 100, budgetStatus: 'approved',
  baseline: { median: 20, p95: 30, runs: 5, machine: 'test', date: '2026-10-20', commit: 'abc1234' }, ...overrides,
})
const byIdOf = (...list) => new Map(list.map((item) => [item.id, item]))
const raw = ({ id = 'sample-type', metric = 'response', runs = 5, median = 20, p95 = 30, status = 'ok', omit = false } = {}) =>
  JSON.stringify({ machine: 'test', commit: 'abc1234', date: '2026-10-21', runs: 5, results: omit ? [] : [{ id, metrics: { [metric]: { runs, median, p95 } }, budget: 100, verdict: { status } }] })
const RAW_PATH = 'tests/perf/results/sample-type.json'
const line = (median, p95, { budget = 100, id = 'sample-type', tail = ` / 原始结果 ${RAW_PATH}` } = {}) => `- perf-scenario：${id} 中位数 ${median} / p95 ${p95} / 预算 ${budget}${tail}`
const perf = (text, sc = scenario(), rawText = raw()) => parsePerfEvidence(text, [sc.id], byIdOf(sc), { strict: true, readRaw: (file) => (file === RAW_PATH ? rawText : null) })

test('性能·好例：已测场景、原始结果可读、样本够、数字有限、正文与原始结果对得上、在预算内 → 绿', () => {
  assert.deepEqual(perf(line(20, 30)), { ok: true, id: 'sample-type' })
})

test('性能·pending 状态配一个很低的中位数 → 红（待测场景不能证明达标）；量过的同一场景 → 绿', () => {
  const pending = scenario({ baseline: undefined, budgetStatus: 'proposed', measurement: { state: 'pending', reason: '基线待协调会话写' } })
  const result = perf(line(10, 12), pending, raw({ median: 10, p95: 12 }))
  assert.equal(result.ok, false)
  assert.match(result.reason, /pending|待测/)
  assert.equal(perf(line(10, 12), scenario(), raw({ median: 10, p95: 12 })).ok, true)
})

test('性能·场景声明按 p95 判，p95 超预算 → 红（中位数再低也没用）；p95 在预算内 → 绿', () => {
  const tail = scenario({ budgetStatistic: 'p95' })
  const over = perf(line(10, 127), tail, raw({ median: 10, p95: 127 }))
  assert.equal(over.ok, false)
  assert.match(over.reason, /p95 127/)
  assert.equal(perf(line(10, 90), tail, raw({ median: 10, p95: 90 })).ok, true)
})

test('性能·按中位数判的 response 场景，p95 超过适用的尾部预算（显式 p95Budget，缺省 1.5 倍预算）→ 红', () => {
  const explicit = scenario({ p95Budget: 120 })
  assert.equal(perf(line(20, 130), explicit, raw({ median: 20, p95: 130 })).ok, false)
  assert.equal(perf(line(20, 110), explicit, raw({ median: 20, p95: 110 })).ok, true)
  const implicit = perf(line(20, 160), scenario(), raw({ median: 20, p95: 160 }))
  assert.equal(implicit.ok, false)
  assert.match(implicit.reason, /p95 160/)
  assert.equal(perf(line(20, 149), scenario(), raw({ median: 20, p95: 149 })).ok, true)
})

test('性能·数字不是有限数（正文写 NaN / Infinity，或原始结果里是 null / NaN）→ 红', () => {
  assert.equal(perf('- perf-scenario：sample-type 中位数 NaN / p95 30 / 预算 100 / 原始结果 ' + RAW_PATH).ok, false)
  assert.match(perf('- perf-scenario：sample-type 中位数 20 / p95 Infinity / 预算 100 / 原始结果 ' + RAW_PATH).reason, /有限|NaN|Infinity/)
  const nullMedian = perf(line(20, 30), scenario(), raw({ median: null }))
  assert.equal(nullMedian.ok, false)
  assert.match(nullMedian.reason, /有限|数字/)
  assert.equal(perf(line(20, 30), scenario(), raw({ p95: 'NaN' })).ok, false)
})

test('性能·缺运行记录（没写原始结果 / 文件读不到 / 里面没有这个场景 / 样本不够）→ 红', () => {
  assert.equal(perf(line(20, 30, { tail: '' })).ok, false)
  assert.match(perf(line(20, 30, { tail: '' })).reason, /原始结果/)
  assert.equal(perf(line(20, 30, { tail: ' / 原始结果 tests/perf/results/ghost.json' })).ok, false)
  assert.equal(perf(line(20, 30), scenario(), raw({ omit: true })).ok, false)
  const few = perf(line(20, 30), scenario(), raw({ runs: 3 }))
  assert.equal(few.ok, false)
  assert.match(few.reason, /样本|runs/)
})

test('性能·正文自己写的数字和原始结果对不上 → 红；原始结果里这一轮本身是 pending → 红', () => {
  const mismatch = perf(line(20, 30), scenario(), raw({ median: 70, p95: 80 }))
  assert.equal(mismatch.ok, false)
  assert.match(mismatch.reason, /对不上/)
  assert.equal(perf(line(20, 30), scenario(), raw({ status: 'pending' })).ok, false)
})

test('性能·旧欠账只对登记过 budgetDebt 的存量场景放行：欠账场景超预算但没比欠账基线更差 → 绿；更差 → 红', () => {
  const debt = scenario({ budget: 33, metrics: ['frameGapP95'], baseline: { median: 40, p95: 44, runs: 5, machine: 'test', date: '2026-10-16', commit: 'abc1234' }, budgetDebt: { owner: 'P-x', state: 'assigned', note: '每帧全局查询', since: '2026-10-16' } })
  const lineFor = (m, p) => `- perf-scenario：sample-type 中位数 ${m} / p95 ${p} / 预算 33 / 原始结果 ${RAW_PATH}`
  assert.equal(perf(lineFor(44, 46), debt, raw({ metric: 'frameGapP95', median: 44, p95: 46 })).ok, true)
  assert.equal(perf(lineFor(60, 62), debt, raw({ metric: 'frameGapP95', median: 60, p95: 62 })).ok, false)
})

test('性能·不适用的证据行不要求原始结果（理由仍要具体）', () => {
  assert.equal(parsePerfEvidence('- perf-scenario：不适用：只改了一行文案', ['sample-type'], byIdOf(scenario()), { strict: true, readRaw: () => null }).ok, true)
})

// ── 3. 改界面的 PR 必须认领拍板图清单，或给已登记的例外 ──────────────────────────────────────────────────
const TABLE = {
  effectiveFrom: '2000-01-01',
  categories: { ui: { label: '新界面 / 改交互', evidence: [] } },
  pathRules: [
    { category: 'ui', legacy: '新界面', pattern: '^src/design/' },
    { category: 'ui', legacy: '新界面', pattern: '^src/.*\\.tsx$', added: true },
    { category: 'ui', pattern: '^src/.*\\.tsx$', exclude: '^src/devlab/' },
  ],
  evidenceJudgement: {
    effectiveFrom: '2026-10-22',
    boardClaimExceptions: [
      { id: 'pure-bugfix', label: '纯 bug 修复：不改布局、元素、文案' },
      { id: 'single-element-restyle', label: '只改单个已有元素的样子' },
    ],
  },
}
const SCENARIOS = { ids: [], byId: new Map(), problems: [] }
const CARD = [
  '## 设计卡',
  '| ★1 用户怎么用 | 谁在什么时刻 | 创作者点了按钮没有反应以便当场修好它 | 人工 |',
  '| ★2 谁说了算 | 状态归谁 | 状态归现有面板，不新增第二份状态 | door-map |',
  '| ★3 一致与复用 | 同类别处 | 复用现有按钮，没有第二份定义 | git grep |',
  '| ★4 全状态 | 每个状态 | 空 加载 成功 失败 各一句话 | 截图 |',
  '| ★9 验收与回滚 | 验收 | 另一条线跑冒烟，回滚 revert 本提交 | 命令 |',
  '### 功能分类',
  '- [x] 新界面 / 改交互',
].join('\n')
const FULL_CARD = CARD.replace('## 设计卡', ['## 设计卡', '线/负责人：I-x'].join('\n')).replace('### 功能分类', [
  '| 5 中途表 | 打断 | 关窗时不丢状态，回执在账本里留痕 | 脚本 |',
  '| 6 外部数据与失败 | 外部来源 | 没有外部数据，失败时提示重试 | 文档 |',
  '| 7 性能预算 | 规模 | 不适用：本改动不碰渲染热路径 | 人工 |',
  '| 8 真实条件 | 条件 | Windows 英文界面最小窗口已跑 | 截图 |',
  '### 功能分类',
].join('\n'))
const ACCEPT = [
  '## 独立验收', '- 验收线：V-x', '- 报告：D:/Nomi-coord-state/reports/V-x.md', '- 报告首行：V-x：有条件通过', '- 验收 HEAD：abcdef1', '实现线：I-x',
].join('\n')
const BOARDS = { Foo: { elements: [{ id: 'a', anchor: '[data-board="a"]', status: 'implemented' }, { id: 'b', anchor: '[data-board="b"]', status: 'implemented' }] } }
const judge = (body, files, { createdAt = '2026-10-23T00:00:00Z', boards = BOARDS } = {}) => evaluatePrBody({
  body, files, createdAt, table: TABLE, scenarios: SCENARIOS,
  evidence: { headSha: HEAD, readReport: () => undefined, readRaw: () => null, boards },
})
const modifiedTsx = [{ path: 'src/workbench/Foo.tsx', status: 'M' }]
const text = (result) => result.lines.join('\n')

test('改界面·好例：认领拍板图清单里的元素，且元素都 implemented → 过', () => {
  const result = judge(`${CARD}\n## 拍板图\n- Foo: a, b`, modifiedTsx)
  assert.equal(result.blocked, false, text(result))
})

test('改界面·既没认领清单也没写例外 → 红（旧判据：没有这一节就不报）', () => {
  const result = judge(CARD, modifiedTsx)
  assert.equal(result.blocked, true)
  assert.match(text(result), /拍板图/)
})

test('改界面·写「不适用」但理由不在已登记的例外里 → 红', () => {
  const result = judge(`${CARD}\n## 拍板图\n- 不适用：这次改动很小不用清单`, modifiedTsx)
  assert.equal(result.blocked, true)
  assert.match(text(result), /已登记的例外/)
})

test('改界面·已登记的例外 + 具体理由 → 过；理由太空 → 红', () => {
  const good = judge(`${CARD}\n## 拍板图\n- 不适用：pure-bugfix：点击生成按钮没有反应，只修事件绑定`, modifiedTsx)
  assert.equal(good.blocked, false, text(good))
  const empty = judge(`${CARD}\n## 拍板图\n- 不适用：pure-bugfix：修了`, modifiedTsx)
  assert.equal(empty.blocked, true)
})

test('改界面·新增了界面文件时不许用「纯 bug 修复」之类的例外（新界面必须有清单）', () => {
  const files = [{ path: 'src/workbench/NewPanel.tsx', status: 'A' }]
  const result = judge(`${FULL_CARD}\n${ACCEPT}\n## 拍板图\n- 不适用：pure-bugfix：点击生成按钮没有反应，只修事件绑定`, files)
  assert.equal(result.blocked, true)
  assert.match(text(result), /新增|新界面/)
  const claimed = judge(`${FULL_CARD}\n${ACCEPT}\n## 拍板图\n- Foo: a`, files)
  assert.equal(claimed.blocked, false, text(claimed))
})

test('改界面·认领了不存在的板 / 元素还没 implemented → 红', () => {
  assert.equal(judge(`${CARD}\n## 拍板图\n- Ghost: a`, modifiedTsx).blocked, true)
  const boards = { Foo: { elements: [{ id: 'a', status: 'missing', owner: '#1' }] } }
  assert.equal(judge(`${CARD}\n## 拍板图\n- Foo: a`, modifiedTsx, { boards }).blocked, true)
})

test('改界面·不碰界面的 PR 不要求清单；规则生效日之前开的 PR 不追溯', () => {
  assert.equal(judge(CARD.replace('- [x] 新界面 / 改交互', ''), [{ path: 'docs/x.md', status: 'M' }]).blocked, false)
  const old = judge(CARD, modifiedTsx, { createdAt: '2026-10-21T00:00:00Z' })
  assert.equal(old.blocked, false, text(old))
})

// ── 端到端：check-pr-judgement 用真 git 取 PR head、读报告 / 原始结果（默认输入，不靠调用方注入）─────────
function git(cwd, ...args) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`)
  return run.stdout
}

test('端到端：CLI 在生效日之后的 PR 上，验收 HEAD 对不上当前 head 就红，对上才绿', (t) => {
  const root = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'gates-evidence-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (rel, content) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), content) }
  git(root, 'init', '-q'); git(root, 'config', 'user.email', 't@t'); git(root, 'config', 'user.name', 't'); git(root, 'config', 'commit.gpgsign', 'false')
  write('docs/engineering/test-routing.json', JSON.stringify(TABLE))
  write('src/design/tokens.ts', 'export const v = 0\n')
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'base')
  const base = git(root, 'rev-parse', 'HEAD').trim()
  write('src/design/tokens.ts', 'export const v = 1\n')
  git(root, 'commit', '-qam', 'change design token')
  const head = git(root, 'rev-parse', 'HEAD').trim()
  const run = (body) => spawnSync(process.execPath, [path.join(here, 'check-pr-judgement.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, PR_JUDGEMENT_REPO_ROOT: root, PR_JUDGEMENT_BASE_REF: base, PR_JUDGEMENT_CREATED_AT: '2026-10-23T00:00:00Z', NOMI_PR_BODY: body, GITHUB_EVENT_NAME: '', GITHUB_EVENT_PATH: '', CI: '1' },
  })
  const body = (acceptHead) => [FULL_CARD, ACCEPT.replace('abcdef1', acceptHead), '## 拍板图', '- 不适用：single-element-restyle：只调了一个令牌的颜色值'].join('\n')
  const stale = run(body(base.slice(0, 12)))
  assert.equal(stale.status, 1, stale.stdout + stale.stderr)
  assert.match(stale.stdout, /验收 HEAD/)
  const fresh = run(body(head.slice(0, 12)))
  assert.match(fresh.stdout, /验收 HEAD/)
  assert.doesNotMatch(fresh.stdout, /✖ .*验收 HEAD/)
})

// ── 合并前扫描在本机读报告：本机路径读得到、读不到 / 外部链接 = null（判据按红处理），仓库内路径从 PR 头读 ──────────
test('合并前扫描读报告：本机绝对路径、仓库内路径、外部链接、读不到各是什么', async () => {
  const { readReportRef } = await import('./merge-preflight.mjs')
  const repo = (file) => (file === 'docs/evidence/r.md' ? '通过\n' : null)
  assert.equal(readReportRef('D:/Nomi-coord-state/reports/V-x.md', repo, () => '本机报告'), '本机报告')
  assert.equal(readReportRef('D:/Nomi-coord-state/reports/V-x.md', repo, () => { throw new Error('ENOENT') }), null)
  assert.equal(readReportRef('docs/evidence/r.md', repo), '通过\n')
  assert.equal(readReportRef('docs/evidence/ghost.md', repo), null)
  assert.equal(readReportRef('https://example.com/r', repo), null)
})

// ── 验收 HEAD 是 PR head 的祖先：之后只许干净合 main、docs/evidence 提交（协调审后改，严格相等会逼人绕门岗）──────────────
const gitIn = (root) => (args) => {
  const run = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (run.status !== 0) { const error = new Error(run.stderr); error.status = run.status; throw error }
  return run.stdout
}

function repoWith(t) {
  const root = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'gates-ancestry-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const g = (...args) => git(root, ...args).trim()
  const write = (rel, content) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), content) }
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false')
  write('a.txt', 'one\ntwo\nthree\n'); write('b.txt', 'b\n')
  g('add', '-A'); g('commit', '-q', '-m', 'base')
  g('update-ref', 'refs/remotes/origin/main', 'HEAD')
  g('checkout', '-q', '-b', 'pr')
  write('feature.txt', 'f\n'); g('add', '-A'); g('commit', '-q', '-m', 'feature')
  const accepted = g('rev-parse', 'HEAD')
  const advanceMain = (file, content) => {
    g('checkout', '-q', 'main'); write(file, content); g('add', '-A'); g('commit', '-q', '-m', `main ${file}`)
    g('update-ref', 'refs/remotes/origin/main', 'HEAD'); g('checkout', '-q', 'pr')
  }
  const ancestry = (from = accepted) => checkHeadAncestry({ git: gitIn(root), accepted: from, head: g('rev-parse', 'HEAD') })
  return { root, g, write, accepted, advanceMain, ancestry }
}

test('验收 HEAD 祖先·合了一次干净的 main（无冲突）之后 → 绿；再加只改 docs/evidence 的提交 → 仍绿', (t) => {
  const r = repoWith(t)
  r.advanceMain('b.txt', 'b changed on main\n')
  r.g('merge', '-q', '--no-ff', '-m', 'merge main', 'main')
  assert.equal(r.ancestry().ok, true, JSON.stringify(r.ancestry()))
  r.write('docs/evidence/report.md', 'x\n'); r.g('add', '-A'); r.g('commit', '-q', '-m', 'evidence')
  assert.equal(r.ancestry().ok, true, JSON.stringify(r.ancestry()))
})

test('验收 HEAD 祖先·合 main 时人工解过冲突（树和 merge-tree 的结果不同）→ 红', (t) => {
  const r = repoWith(t)
  r.advanceMain('a.txt', 'one\nMAIN\nthree\n')
  r.write('a.txt', 'one\nPR\nthree\n'); r.g('add', '-A'); r.g('commit', '-q', '-m', 'pr edit')
  const accepted = r.g('rev-parse', 'HEAD')
  assert.notEqual(spawnSync('git', ['merge', '--no-ff', '-m', 'merge main', 'main'], { cwd: r.root }).status, 0, '应当冲突')
  r.write('a.txt', 'one\nHAND RESOLVED\nthree\n'); r.g('add', '-A'); r.g('commit', '-q', '--no-edit')
  const result = r.ancestry(accepted)
  assert.equal(result.ok, false, JSON.stringify(result))
  assert.match(result.reason, /冲突|不是干净/)
})

test('验收 HEAD 祖先·验收后分支又加了代码提交 → 红；浅克隆算不了 → unknown（CI 只核正文）', (t) => {
  const r = repoWith(t)
  r.write('src.txt', 'code\n'); r.g('add', '-A'); r.g('commit', '-q', '-m', 'more code')
  const result = r.ancestry()
  assert.equal(result.ok, false)
  assert.match(result.reason, /非合并提交/)
  const shallow = checkHeadAncestry({ git: (args) => (args[1] === '--is-shallow-repository' ? 'true\n' : ''), accepted: r.accepted, head: r.accepted })
  assert.equal(shallow.unknown, true)
})

// ── 拍板图清单取 PR head：PR 自己新增的板，认领判绿（main 检出里读不到它）──────────────────────────────────────────
test('合并前扫描读 PR head 的清单：PR 认领它自己新增的板 → 绿；在 main 上找 → 找不到 → 红', (t) => {
  const r = repoWith(t)
  const manifest = { board: 'NewBoard', elements: [{ id: 'a', anchor: '[data-board="a"]', status: 'implemented' }] }
  r.write('docs/design/boards/2026-10-19/NewBoard.board.json', JSON.stringify(manifest)); r.g('add', '-A'); r.g('commit', '-q', '-m', 'add board')
  const claim = '## 拍板图\n- NewBoard: a'
  assert.deepEqual(checkPrBoardClaims(claim, boardsAtHead({ git: gitIn(r.root), sha: r.g('rev-parse', 'HEAD') })), [])
  assert.equal(checkPrBoardClaims(claim, boardsAtHead({ git: gitIn(r.root), sha: r.g('rev-parse', 'main') })).length, 1, 'main 上没有这张板')
})
