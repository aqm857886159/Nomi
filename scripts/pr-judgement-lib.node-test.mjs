import { makeTempDir } from './_test-temp.mjs'
// PR 正文判据（功能分类 → 测试路由 + 规则与门岗范围）的测试（R17：加规则必须先证明它会咬人）。
// 判据层喂假数据；另有真 git 仓库端到端（临时仓库里跑 check:pr-judgement CLI）。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'

import {
  addedLinesByFile,
  checkProtectedScope,
  checkRouting,
  checkRoutingCard,
  checkRoutingEvidence,
  evaluatePrJudgement,
  evidenceLineVerdict,
  evaluateProcessTier,
  deriveUiVerification,
  inferRoutes,
  isMissingTool,
  loadRoutingTable,
  paidSampleVerdict,
  requiredEvidence,
  routingEnforced,
  processTieringEnforced,
  toolGaps,
} from './pr-judgement-lib.mjs'
import { createGateMutationHarness } from './gate-mutation-harness.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const table = loadRoutingTable()
const r4Baseline = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/process-tiering-r4-baseline.json'), 'utf8'))
const M = (p, status = 'M') => ({ path: p, status })

test('路由表自身：每个类别有证据、证据 id 全局唯一、tool 只能是 exists / missing、missing 必须写出计划', () => {
  const ids = new Set()
  for (const [id, def] of Object.entries(table.categories)) {
    assert.ok(def.label && Array.isArray(def.evidence) && def.evidence.length > 0, `${id} 没有证据`)
    for (const item of def.evidence) {
      assert.ok(!ids.has(item.id), `证据 id 重复：${item.id}`)
      ids.add(item.id)
      assert.ok(item.tool === 'exists' || isMissingTool(item.tool), `${item.id} 的 tool 必须是 exists，或写计划接的工具加 (planned)（例：stagehand (planned)）`)
      assert.ok(item.toolRef && item.toolRef.length > 10, `${item.id} 必须写 toolRef（现有工具或计划接什么）`)
      if (isMissingTool(item.tool)) assert.match(item.toolRef, /计划/, `${item.id} 是 (planned)，toolRef 必须写「计划接什么」`)
    }
  }
  for (const rule of table.pathRules) for (const category of [].concat(rule.category)) assert.ok(table.categories[category], `pathRules 指向不存在的类别 ${category}`)
})

test('路径推类别：四类沿用旧判定（花钱 / 长跑 / 可打断 / 新界面），并推出其余类别；测试 / 文档 / json 不推', () => {
  const classify = (files, added = '') => inferRoutes(files, added, table)
  assert.deepEqual(classify([M('electron/productionRun/productionRunService.ts')]).classes, ['长跑'])
  assert.ok(classify([M('electron/generation/spendLedger.ts')]).classes.includes('花钱'))
  assert.ok(classify([M('src/workbench/ai/cancelGeneration.ts')]).classes.includes('可打断'))
  assert.ok(classify([M('src/workbench/NewPanel.tsx', 'A')]).classes.includes('新界面'))
  assert.ok(classify([M('src/utils/format.ts')], '+const c = new AbortController()').classes.includes('可打断'))
  const ids = (files) => classify(files).categories.map((category) => category.id)
  assert.ok(ids([M('src/workbench/ai/lane/x.ts')]).includes('agent'))
  assert.ok(ids([M('src/workbench/generationCanvas/canvasStore.ts')]).includes('scale'))
  assert.ok(ids([M('electron/shared/storyboard/compile.ts')]).includes('gen-quality'))
  assert.ok(ids([M('electron/projectMigration.ts')]).includes('data-format'))
  // 改交互（改已有 tsx）推 ui，但不算四类
  const modifiedTsx = classify([M('src/workbench/Panel.tsx')])
  assert.deepEqual(modifiedTsx.categories.map((c) => c.id), ['ui', 'perf'], '改交互同时落进「新增功能 / 性能」类（perf-scenario 证据）')
  assert.equal(modifiedTsx.fourClass, false)
  // 多选：一个 PR 同时落在几类
  assert.ok(ids([M('src/workbench/generationCanvas/spendCard.tsx', 'A')]).length >= 3)
  assert.deepEqual(classify([M('docs/x.md'), M('src/a.test.ts'), M('electron/b.json')]).categories, [])
})

const CARD = (boxes) => `## 设计卡\n\n### 功能分类\n${boxes}\n`

test('设计卡「功能分类」：路径推出的必须都勾，勾的只能更多；缺这一节红', () => {
  const inferred = inferRoutes([M('src/workbench/generationCanvas/spendCard.tsx', 'A')], '', table)
  const need = inferred.categories.map((category) => category.id)
  assert.ok(need.includes('ui') && need.includes('spend') && need.includes('scale') && need.includes('perf'))
  assert.match(checkRoutingCard('## 设计卡\nx', inferred, table).lines.join('\n'), /缺 `## 功能分类`/)
  const partial = checkRoutingCard(CARD('- [x] 新界面 / 改交互\n- [ ] 花钱'), inferred, table)
  assert.equal(partial.ok, false)
  assert.match(partial.lines.join('\n'), /花钱/)
  assert.match(partial.lines.join('\n'), /大数据量/)
  const full = checkRoutingCard(CARD('- [x] 新界面 / 改交互\n- [x] 花钱\n- [x] 大数据量 / 画布 / 长列表\n- [x] 新增功能 / 性能\n- [x] Agent 行为'), inferred, table)
  assert.equal(full.ok, true)
  assert.ok(full.union.includes('agent'), '多勾的类别并进必交证据')
  // 推不出类别（纯文档改动）：不要求这一节
  assert.equal(checkRoutingCard('随便', inferRoutes([M('docs/x.md')], '', table), table).ok, true)
  // 没勾上的框（- [ ]）不算
  assert.equal(checkRoutingCard(CARD('- [ ] 花钱'), inferRoutes([M('electron/spendLedger.ts')], '', table), table).ok, false)
})

test('证据行判据：链接 / 路径 / 截图 / 运行号 / PR 号算；「未验证：原因」算；空话不算', () => {
  for (const line of ['- ui-mockup：https://example.com/x', '- ui-screens：tests/ux/shots/a.png', '- x：见 artifacts/run/report.md', '- x：run 123456', '- x：#1029', '- x：未验证：工具未建']) {
    assert.equal(evidenceLineVerdict(line).ok, true, line)
  }
  assert.equal(evidenceLineVerdict('- ui-mockup：跑过了').ok, false)
  assert.equal(evidenceLineVerdict('- ui-mockup：未验证：').ok, false)
  assert.equal(evidenceLineVerdict('- x：未验证：无').ok, false, '一个字的理由不算')
})

test('验收证据：必交证据取并集；缺条目红；条目没证据红；未验证:工具未建 接受并列出缺口', () => {
  const req = requiredEvidence(['ui', 'spend'], table).map((item) => item.id)
  assert.deepEqual(req, ['ui-mockup', 'ui-click-census', 'ui-capability-unavailable', 'ui-ai-walk', 'ui-screens', 'ui-task-scorecard', 'spend-walks', 'spend-paid-sample', 'spend-fault-injection'])
  const none = checkRoutingEvidence('## 设计卡\nx', ['ui'], table)
  assert.equal(none.ok, false)
  assert.match(none.lines.join('\n'), /ui-mockup/)
  const bare = checkRoutingEvidence('## 验收证据\n- ui-mockup：跑过了\n', ['long-run'].concat([]), table)
  assert.equal(bare.ok, false, '要 run-e2e-chain，却没有这一项')
  const body = [
    '## 验收证据',
    '- ui-mockup：https://example.com/mockup',
    '- ui-click-census：未验证：工具未建',
    '- 按钮普查之外：无',
    '- ui-capability-unavailable：docs/plan/example-design-card.md',
    '- AI 用户走查：未验证：工具未建',
    '- ui-screens：tests/ux/shots/zh-CN.png、tests/ux/shots/en.png、tests/ux/shots/narrow.png',
    '- ui-task-scorecard：docs/evidence/2026-10-21-ux-scorecard/pr1264-rewrite.scorecard.md',
  ].join('\n')
  const ok = checkRoutingEvidence(body, ['ui'], table)
  assert.equal(ok.ok, true, ok.lines.join('\n'))
  assert.deepEqual(ok.gaps.map((gap) => gap.id), ['ui-click-census', 'ui-ai-walk'])
  assert.match(ok.lines.join('\n'), /缺工具：ui-click-census/)
  // 工具已有的证据写「未验证」也接受，但不进缺口
  const exists = checkRoutingEvidence('## 验收证据\n- ui-mockup：未验证：本次没有新界面\n- ui-click-census：未验证：工具未建\n- ui-capability-unavailable：未验证：本次没有要模型的动作\n- ui-ai-walk：未验证：工具未建\n- ui-screens：未验证：无窄窗\n- ui-task-scorecard：未验证：本次没有真人', ['ui'], table)
  assert.equal(exists.ok, true)
  assert.deepEqual(exists.gaps.map((gap) => gap.id), ['ui-click-census', 'ui-ai-walk'])
})

test('体验成绩单证据：新界面必交，生效日之前开的 PR 不要求，之后开的要求（since）', () => {
  const ids = (createdAt) => requiredEvidence(['ui'], table, createdAt).map((item) => item.id)
  assert.ok(ids('2026-10-21T00:00:00Z').every((id) => id !== 'ui-task-scorecard'))
  assert.ok(ids('2026-10-22T00:00:00Z').includes('ui-task-scorecard'))
  assert.ok(ids(null).includes('ui-task-scorecard'), '创建时间未知按已生效处理')
  const miss = checkRoutingEvidence('## 验收证据\n- ui-mockup：https://example.com/m\n', ['ui'], table)
  assert.match(miss.lines.join('\n'), /ui-task-scorecard/)
  assert.equal(table.categories.ui.evidence.find((item) => item.id === 'ui-task-scorecard').tool, 'exists')
})

test('真付费抽检严格判据（合并前扫描）：运行号 / 报告链接 / 协调豁免过；未验证、裸 PR 号、别名行、缺条目都红（#1203 就是写「未验证」被合进来的）', () => {
  for (const line of [
    '- spend-paid-sample：run 987654',
    '- spend-paid-sample：运行号 20261016',
    '- spend-paid-sample：https://github.com/o/r/actions/runs/12345',
    '- spend-paid-sample：报告 reports/G-paidkey.md',
    '- **spend-paid-sample**：D:/Nomi-coord-state/reports/H-paid-1203.md',
    '- spend-paid-sample：协调豁免：只改了文案，不碰供应商',
  ]) assert.equal(paidSampleVerdict(line).ok, true, line)
  assert.equal(paidSampleVerdict('- spend-paid-sample：协调豁免：只改了文案').waived, true)
  for (const line of [
    '- spend-paid-sample：未验证：待协调',
    '- spend-paid-sample：未验证：真付费还没跑 https://example.com/x',
    '- spend-paid-sample：#1203',
    '- spend-paid-sample：跑过了',
    '- spend-paid-sample：协调豁免：',
    '- spend-paid-sample：协调豁免：无',
    '- 真付费：https://example.com/report',
    '- paid：run 987654',
  ]) assert.equal(paidSampleVerdict(line).ok, false, line)

  const rest = '- spend-walks：tests/ux/agent-spend-card.walk.mjs\n- spend-fault-injection：tests/ux/full-walk/playbooks/pb07-failure-kinds.walk.mjs\n'
  const evidence = (paidLines) => `## 验收证据\n${rest}${paidLines}`
  const strict = (body) => checkRoutingEvidence(body, ['spend'], table, null, null, { paidStrict: true })
  const lenient = (body) => checkRoutingEvidence(body, ['spend'], table)

  // 现状（#1203 的写法）：宽口径放行，严格口径红
  const unverified = evidence('- spend-paid-sample：未验证：待协调真付费验收\n')
  assert.equal(lenient(unverified).ok, true, 'CI / 推送前的口径不变')
  const hit = strict(unverified)
  assert.equal(hit.ok, false)
  assert.match(hit.lines.join('\n'), /spend-paid-sample：花钱类 PR 不接受「未验证」/)
  // 缺条目：两种口径都红，严格口径多一句格式提示
  assert.equal(lenient(evidence('')).ok, false)
  assert.match(strict(evidence('')).lines.join('\n'), /spend-paid-sample：合并前扫描要求/)
  // 补上运行号 → 绿；协调豁免 → 绿且醒目打出理由
  assert.equal(strict(evidence('- spend-paid-sample：run 987654\n')).ok, true)
  const waived = strict(evidence('- spend-paid-sample：协调豁免：只改文案不碰供应商\n'))
  assert.equal(waived.ok, true)
  assert.match(waived.lines.join('\n'), /⚠ spend-paid-sample：协调豁免——只改文案不碰供应商/)
  // 别名行 / 别处提到 paid 的行不能顶替这一行
  assert.equal(strict(evidence('- 真付费：run 987654\n- ui-screens：paid https://example.com/x\n')).ok, false)
  // 裸 PR 号不算
  assert.equal(strict(evidence('- spend-paid-sample：#1203\n')).ok, false)
  // 不是花钱类（没有 spend 类别）时严格口径不要求这一行
  assert.equal(checkRoutingEvidence('## 验收证据\n', ['long-run'], table, null, null, { paidStrict: true }).lines.join('\n').includes('spend-paid-sample'), false)
})

test('整体：花钱类 PR 过 evaluatePrJudgement：paidStrict 才把「未验证」判红，CI / 推送前（不传）行为不变', () => {
  const files = [M('electron/capabilityCore/generationSpendDecision.ts')]
  const body = '## 设计卡\nx\n### 功能分类\n- [x] 花钱\n\n## 验收证据\n- spend-walks：tests/ux/agent-spend-card.walk.mjs\n- spend-paid-sample：未验证：待协调\n- spend-fault-injection：tests/ux/full-walk/playbooks/pb07-failure-kinds.walk.mjs\n'
  assert.equal(evaluatePrJudgement({ body, files, createdAt: '2026-10-16T00:00:00Z', table }).blocked, false)
  const strict = evaluatePrJudgement({ body, files, createdAt: '2026-10-16T00:00:00Z', table, paidStrict: true })
  assert.equal(strict.blocked, true)
  assert.match(strict.routing.lines.join('\n'), /不接受「未验证」/)
  // 补上运行号就过
  const fixed = body.replace('未验证：待协调', 'run 987654')
  assert.equal(evaluatePrJudgement({ body: fixed, files, createdAt: '2026-10-16T00:00:00Z', table, paidStrict: true }).blocked, false)
})

test('整体：路径推出的类别没勾 → 红；勾全且证据齐 → 绿；规则生效日之前开的 PR 路由只警告', () => {
  const files = [M('electron/spendLedger.ts')]
  const bad = checkRouting('## 设计卡\nx', inferRoutes(files, '', table), table)
  assert.equal(bad.ok, false)
  const good = '## 设计卡\n### 功能分类\n- [x] 花钱\n\n## 验收证据\n- spend-walks：tests/ux/agent-spend-card.walk.mjs\n- spend-paid-sample：run 987654\n- spend-fault-injection：tests/ux/full-walk/playbooks/pb07-failure-kinds.walk.mjs\n'
  assert.equal(checkRouting(good, inferRoutes(files, '', table), table).ok, true)
  const after = evaluatePrJudgement({ body: '## 设计卡\nx', files, createdAt: '2026-10-08T00:00:00Z', table })
  assert.equal(after.blocked, true)
  assert.equal(after.routing.blocking, true)
  const before = evaluatePrJudgement({ body: '## 设计卡\nx', files, createdAt: '2026-10-05T00:00:00Z', table })
  assert.equal(before.blocked, false, '旧 PR 只警告')
  assert.match(before.routing.lines.join('\n'), /⚠/)
  assert.doesNotMatch(before.routing.lines.join('\n'), /✖/)
  assert.equal(routingEnforced(null, table), true, '创建时间未知按已生效处理（fail-closed）')
})

test('流程档位生效日按带时区 ISO 瞬时点核实：跨日边界按 +08:00 比较', () => {
  assert.equal(processTieringEnforced('2026-10-27T15:59:59Z'), false, '台北 10-27 23:59:59 仍是旧规')
  assert.equal(processTieringEnforced('2026-10-27T16:00:00Z'), true, '台北 10-28 00:00:00 进入新规')
  assert.equal(processTieringEnforced('2026-10-27T21:26:05Z'), true)
})

test('规则与门岗改动范围：移到判据库后行为不变；旧 PR 也不吃路由宽限（#1032 型回退）', () => {
  const protectedFile = M('scripts/check-self-written.mjs')
  assert.equal(checkProtectedScope('随便', [protectedFile]).ok, false)
  assert.equal(checkProtectedScope('## 碰到的规则与门岗\n- scripts/check-self-written.mjs：加固', [protectedFile]).ok, true)
  assert.equal(checkProtectedScope('随便', [M('docs/engineering/test-routing.json')]).ok, false, '路由表本身受保护')
  assert.equal(checkProtectedScope('随便', [M('scripts/pr-judgement-lib.mjs')]).ok, false, '判据库受保护')
  assert.equal(checkProtectedScope('随便', [M('scripts/check-pr-judgement.mjs')]).ok, false, '新门岗受保护')
  assert.equal(checkProtectedScope('## 碰到的规则与门岗\n- scripts/check-x.mjs：删除：已被替换', [{ path: 'scripts/check-x.mjs', status: 'D' }]).ok, true)
  assert.equal(checkProtectedScope('## 碰到的规则与门岗\n- scripts/check-x.mjs', [{ path: 'scripts/check-x.mjs', status: 'D' }]).ok, false)
  assert.equal(checkProtectedScope('x', [], { ledgerRemovedIds: ['LAW12-a'] }).ok, false)
  // 概念登记拆成目录（一个概念一个文件）：保护单位仍是这本登记——点名目录或具体文件都算；删掉一个概念文件照旧要写「删除：理由」
  const concept = { path: 'docs/engineering/concept-owners/catalog.vendor-landing.json', status: 'A' }
  assert.equal(checkProtectedScope('随便', [concept]).ok, false, '概念登记的文件受保护')
  assert.equal(checkProtectedScope('## 碰到的规则与门岗\n- docs/engineering/concept-owners/：登记新概念', [concept]).ok, true)
  assert.equal(checkProtectedScope('## 碰到的规则与门岗\n- docs/engineering/concept-owners/catalog.vendor-landing.json：新概念', [concept]).ok, true)
  assert.equal(checkProtectedScope('## 碰到的规则与门岗\n- docs/engineering/concept-owners/：改登记', [{ ...concept, status: 'D' }]).ok, false)
  assert.equal(checkProtectedScope('## 碰到的规则与门岗\n- docs/engineering/concept-owners/：删除：概念并进别处', [{ ...concept, status: 'D' }]).ok, true)
  assert.equal(checkProtectedScope('## 碰到的规则与门岗\n- docs/engineering/：改了', [concept]).ok, false, '只写上一级目录不算点名')
  const old = evaluatePrJudgement({ body: '随便', files: [protectedFile], createdAt: '2026-09-01T00:00:00Z', table })
  assert.equal(old.blocked, true)
})

test('体检：路由表里的缺工具清单（tool: missing 的证据 + 层级缺口）', () => {
  const ids = toolGaps(table).map((gap) => gap.id)
  for (const expected of ['ui-click-census', 'ui-ai-walk', 'gen-eval-set', 'layer-health']) assert.ok(ids.includes(expected), expected)
  const run = spawnSync(process.execPath, [path.join(here, 'check-pr-judgement.mjs'), '--gaps'], { encoding: 'utf8' })
  assert.equal(run.status, 0)
  assert.match(run.stdout, /工具缺口/)
  assert.match(run.stdout, /ui-click-census/)
  assert.ok(!ids.includes('perf-real-scale'), 'perf-real-scale 的工具（perf:scenarios）已建')
})

// 推送前 / CI 与合并前扫描同一口径后（2026-10-08），端到端正文里也要有设计卡 ★ 格（四类 9 格）与独立验收
const CARD_LINES = [
  '| ★1 用户怎么用 | 谁在什么时刻 | 创作者批量生成时先看到总价以便决定要不要继续 | 人工 |',
  '| ★2 谁说了算 | 状态归谁 | 生成批次归主进程的生产队列 owner | door-map |',
  '| ★3 一致与复用 | 同类别处 | 复用现有花钱卡，没有第二份定义 | git grep |',
  '| ★4 全状态 | 每个状态 | 空 加载 成功 失败 取消中 各一句话 | 截图 |',
  '| 5 中途表 | 打断 | 关窗时不扣费，回执在账本里留痕 | 脚本 |',
  '| 6 外部数据与失败 | 外部来源 | 供应商返回异常时提示重试，不甩锅给 key | 文档 |',
  '| 7 性能预算 | 规模 | 不适用：本改动不碰渲染热路径 | 人工 |',
  '| 8 真实条件 | 条件 | Windows 英文界面最小窗口已跑 | 截图 |',
  '| ★9 验收与回滚 | 验收 | 另一条线跑核心冒烟，回滚 revert 本提交 | 命令 |',
]
const ACCEPTANCE_LINES = ['## 独立验收', '报告：https://example.com/report 验收线：线 B', '实现线：线 A']

function git(cwd, ...args) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`)
  return run.stdout
}

test('端到端：临时 git 仓库里跑 CI 脚本——没勾分类 / 缺证据 / 没点名受保护文件 → 红；补齐 → 绿；非 PR 环境跳过', (t) => {
  const root = makeTempDir('pr-judgement-')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), content)
  }
  git(root, 'init', '-q'); git(root, 'config', 'user.email', 't@t'); git(root, 'config', 'user.name', 't'); git(root, 'config', 'commit.gpgsign', 'false')
  // 政策表取 base 版本（G-perfreg）：fixture 的 base 带上真实路由表
  fs.mkdirSync(path.join(root, 'docs/engineering'), { recursive: true }); fs.copyFileSync(path.join(here, '..', 'docs/engineering/test-routing.json'), path.join(root, 'docs/engineering/test-routing.json'))
  write('electron/spendLedger.ts', 'export const v = 0\n')
  write('scripts/check-x.mjs', 'export const x = 0\n')
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'base')
  const base = git(root, 'rev-parse', 'HEAD').trim()
  write('electron/spendLedger.ts', 'export const v = 1\n')
  write('scripts/check-x.mjs', 'export const x = 1\n')
  git(root, 'commit', '-qam', 'change spend and a gate')
  const run = (body, env = {}) => spawnSync(process.execPath, [path.join(here, 'check-pr-judgement.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, PR_JUDGEMENT_REPO_ROOT: root, PR_JUDGEMENT_BASE_REF: base, PR_JUDGEMENT_CREATED_AT: '2026-10-08T00:00:00Z', NOMI_PR_BODY: body, GITHUB_EVENT_NAME: '', ...env },
  })
  const red = run('## 设计卡\nx')
  assert.equal(red.status, 1, red.stdout + red.stderr)
  assert.match(red.stdout, /功能分类/)
  assert.match(red.stdout, /scripts\/check-x\.mjs/)
  const full = [
    '## 设计卡', ...CARD_LINES, '### 功能分类', '- [x] 花钱', ...ACCEPTANCE_LINES,
    '## 验收证据', '- spend-walks：tests/ux/agent-spend-card.walk.mjs', '- spend-paid-sample：run 987654', '- spend-fault-injection：tests/ux/full-walk/playbooks/pb07-failure-kinds.walk.mjs',
    '## 碰到的规则与门岗', '- scripts/check-x.mjs：改了判据',
  ].join('\n')
  const green = run(full)
  assert.equal(green.status, 0, green.stdout + green.stderr)
  assert.match(green.stdout, /通过/)
  // 缺证据条目：红
  const noEvidence = run(full.replace('- spend-fault-injection：tests/ux/full-walk/playbooks/pb07-failure-kinds.walk.mjs', ''))
  assert.equal(noEvidence.status, 1)
  assert.match(noEvidence.stdout, /spend-fault-injection/)
  // pull_request 事件里取不到正文 = 红（fail-closed）
  const noBody = spawnSync(process.execPath, [path.join(here, 'check-pr-judgement.mjs')], {
    encoding: 'utf8', env: { ...process.env, PR_JUDGEMENT_REPO_ROOT: root, NOMI_PR_BODY: undefined, GITHUB_EVENT_NAME: 'pull_request', NOMI_PR_NUMBER: '999999999', PATH: '' },
  })
  assert.notEqual(noBody.status, 0)
})

test('推送前判据：本机 color.ui / diff.noprefix / diff.mnemonicPrefix 配置不改变 AbortController 的可打断命中', (t) => {
  const root = makeTempDir('pr-judgement-diff-config-')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), content)
  }
  git(root, 'init', '-q'); git(root, 'config', 'user.email', 't@t'); git(root, 'config', 'user.name', 't'); git(root, 'config', 'commit.gpgsign', 'false')
  fs.mkdirSync(path.join(root, 'docs/engineering'), { recursive: true })
  fs.copyFileSync(path.join(here, '..', 'docs/engineering/test-routing.json'), path.join(root, 'docs/engineering/test-routing.json'))
  write('src/workbench/ai/stream.ts', 'export const stream = 1\n')
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'base')
  const base = git(root, 'rev-parse', 'HEAD').trim()
  write('src/workbench/ai/stream.ts', 'export const stream = 1\nexport const controller = new AbortController()\n')
  git(root, 'commit', '-qam', 'add cancellation')
  const run = () => spawnSync(process.execPath, [path.join(here, 'check-pr-judgement.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, PR_JUDGEMENT_REPO_ROOT: root, PR_JUDGEMENT_BASE_REF: base, PR_JUDGEMENT_CREATED_AT: '2026-10-24T00:00:00Z', NOMI_PR_BODY: '## 设计卡\nx', GITHUB_EVENT_NAME: '' },
  })
  const clean = run()
  assert.match(clean.stdout, /四类：命中（[^）]*可打断/)
  for (const [key, value] of [['color.ui', 'always'], ['diff.noprefix', 'true'], ['diff.mnemonicPrefix', 'true']]) git(root, 'config', key, value)
  const configured = run()
  assert.match(configured.stdout, /四类：命中（[^）]*可打断/)
  assert.equal(configured.stdout, clean.stdout, '推送前判据输出不能受本机 git diff 配置影响')
  assert.equal(configured.stderr, clean.stderr)
})

test('端到端：逃逸账本一条一个文件——条目文件被删（base 有、HEAD 没有）→ 红并点名 id；只新增 / 改状态 → 不报删除', (t) => {
  const root = makeTempDir('pr-judgement-ledger-')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const dir = path.join(root, 'tests/ux/full-walk/escapeLedger')
  fs.mkdirSync(dir, { recursive: true })
  const put = (name, value) => fs.writeFileSync(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`)
  git(root, 'init', '-q'); git(root, 'config', 'user.email', 't@t'); git(root, 'config', 'user.name', 't'); git(root, 'config', 'commit.gpgsign', 'false')
  // 政策表取 base 版本（G-perfreg）：fixture 的 base 带上真实路由表
  fs.mkdirSync(path.join(root, 'docs/engineering'), { recursive: true }); fs.copyFileSync(path.join(here, '..', 'docs/engineering/test-routing.json'), path.join(root, 'docs/engineering/test-routing.json'))
  put('_meta.json', { $schemaVersion: 1 })
  put('LAW12-a.json', { id: 'LAW12-a', status: 'candidate' })
  put('LAW12-b.json', { id: 'LAW12-b', status: 'candidate' })
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'base')
  const base = git(root, 'rev-parse', 'HEAD').trim()
  const run = () => spawnSync(process.execPath, [path.join(here, 'check-pr-judgement.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, PR_JUDGEMENT_REPO_ROOT: root, PR_JUDGEMENT_BASE_REF: base, PR_JUDGEMENT_CREATED_AT: '2026-10-08T00:00:00Z', NOMI_PR_BODY: ['## 设计卡', ...CARD_LINES, '## 为什么', '加一条逃逸'].join('\n'), GITHUB_EVENT_NAME: '' },
  })
  put('LAW12-a.json', { id: 'LAW12-a', status: 'reviewed' })
  put('LAW12-c.json', { id: 'LAW12-c', status: 'candidate' })
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'add c, review a')
  const added = run()
  assert.equal(added.status, 0, added.stdout + added.stderr)
  assert.doesNotMatch(added.stdout + added.stderr, /条目被删掉/)

  fs.rmSync(path.join(dir, 'LAW12-b.json'))
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'drop b')
  const dropped = run()
  assert.equal(dropped.status, 1, dropped.stdout + dropped.stderr)
  assert.match(dropped.stdout, /逃逸账本里有条目被删掉：LAW12-b（/)
})

test('端到端：真实 committed reviewed 逃逸只准首次 push 警告；CI/merge、缺证据与错绑合同仍红', (t) => {
  const root = makeTempDir('pr-judgement-reviewed-')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (rel, value) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), typeof value === 'string' ? value : JSON.stringify(value))
  }
  git(root, 'init', '-q'); git(root, 'config', 'user.email', 't@t'); git(root, 'config', 'user.name', 't'); git(root, 'config', 'commit.gpgsign', 'false')
  write('README.md', 'base')
  // 政策表取 base 版本（G-perfreg）：fixture 的 base 带上真实路由表
  write('docs/engineering/test-routing.json', fs.readFileSync(path.join(here, '..', 'docs/engineering/test-routing.json'), 'utf8'))
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'base')
  const base = git(root, 'rev-parse', 'HEAD').trim()
  const contractFile = 'docs/fixes/2026-10-12-fixture.root-cause.json'
  const checkFile = 'tests/ux/fixture.walk.mjs'
  const ledgerFile = 'tests/ux/full-walk/escapeLedger/FB-fixture.json'
  const contract = { detected_by: 'user', prevention: { kind: 'centralized-boundary' }, class_regression_tests: [checkFile] }
  const entry = { id: 'FB-fixture', status: 'reviewed', manualReview: 'reviewed', rootCauseContract: contractFile,
    classCheck: { kind: 'matrix', file: checkFile }, evidence: ['real task receipt'], completionCommits: [base] }
  write(contractFile, contract)
  write(checkFile, 'const matrix = []; for (const row of matrix) verify(row)')
  const body = ['## 设计卡', ...CARD_LINES].join('\n')
  const run = (env = {}) => spawnSync(process.execPath, [path.join(here, 'check-pr-judgement.mjs')], {
    encoding: 'utf8', env: { ...process.env, PR_JUDGEMENT_REPO_ROOT: root, PR_JUDGEMENT_BASE_REF: base,
      PR_JUDGEMENT_CREATED_AT: '2026-10-12T00:00:00Z', NOMI_PR_BODY: body, NOMI_PR_JUDGEMENT_STAGE: 'push',
      GITHUB_EVENT_NAME: '', CI: '', ...env },
  })
  const commitEntry = (value) => { write(ledgerFile, value); git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'review evidence') }
  commitEntry(entry)
  const push = run()
  assert.equal(push.status, 0, push.stdout + push.stderr)
  assert.match(push.stdout, /⚠.*reviewed/)
  assert.equal(JSON.parse(git(root, 'show', `HEAD:${ledgerFile}`)).status, 'reviewed', 'admission never fabricates fixed')
  for (const env of [{ NOMI_PR_JUDGEMENT_STAGE: 'merge' }, { CI: 'true' }]) {
    assert.equal(run(env).status, 1, 'merge/CI must retain settlement requirement')
  }
  const unrelatedCommit = git(root, 'commit-tree', 'HEAD^{tree}', '-m', 'unrelated root commit').trim()
  for (const invalid of [
    { ...entry, id: 'FB-other' }, { ...entry, status: 'candidate' }, { ...entry, manualReview: 'pending' }, { ...entry, evidence: [] },
    { ...entry, completionCommits: [] }, { ...entry, completionCommits: ['f'.repeat(40)] },
    { ...entry, completionCommits: [unrelatedCommit] },
    { ...entry, classCheck: { kind: 'matrix', file: 'tests/ux/missing.walk.mjs' } },
    { ...entry, rootCauseContract: 'docs/fixes/2026-10-12-other.root-cause.json' },
  ]) { commitEntry(invalid); assert.equal(run().status, 1, `invalid preparation admitted: ${JSON.stringify(invalid)}`) }
  commitEntry(entry)
  write(checkFile, 'verifyOneExample()'); git(root, 'commit', '-qam', 'not a class check')
  assert.equal(run().status, 1, 'existence alone is insufficient: check must be class-level')
})

test('exclude：设计实验室（src/devlab）的 tsx 不算「改交互」；真界面照算', () => {
  assert.deepEqual(inferRoutes([M('src/devlab/designLab/Kit.tsx')], '', table).categories, [])
  assert.deepEqual(inferRoutes([M('src/workbench/Panel.tsx')], '', table).categories.map((c) => c.id), ['ui', 'perf'])
})

test('可打断：AbortController 只在非测试文件的新增行里认；只出现在测试里不算四类（#1038 误判）', () => {
  const diff = [
    'diff --git a/electron/foo.test.ts b/electron/foo.test.ts',
    '--- a/electron/foo.test.ts', '+++ b/electron/foo.test.ts', '@@ -0,0 +1 @@',
    '+const signal = new AbortController().signal',
    'diff --git a/tests/ux/loop.walk.mjs b/tests/ux/loop.walk.mjs',
    '--- a/tests/ux/loop.walk.mjs', '+++ b/tests/ux/loop.walk.mjs', '@@ -0,0 +1 @@',
    '+const c = new AbortController()',
    'diff --git a/src/utils/format.ts b/src/utils/format.ts',
    '--- a/src/utils/format.ts', '+++ b/src/utils/format.ts', '@@ -0,0 +1 @@',
    '+export const f = 1',
  ].join('\n')
  const byFile = addedLinesByFile(diff)
  assert.match(byFile.get('electron/foo.test.ts'), /AbortController/)
  const files = [M('electron/foo.test.ts'), M('tests/ux/loop.walk.mjs'), M('src/utils/format.ts')].map((file) => ({ ...file, added: byFile.get(file.path) ?? '' }))
  const onlyTests = inferRoutes(files, '', table)
  assert.equal(onlyTests.fourClass, false)
  assert.ok(!onlyTests.classes.includes('可打断'))
  // 生产文件里新增 → 照样算
  const prod = [...files, { ...M('src/workbench/ai/stream.ts'), added: '+const c = new AbortController()' }]
  assert.ok(inferRoutes(prod, '', table).classes.includes('可打断'))
  // 经整体判据入口（merge-preflight / CI 走的路径）同样不算
  const judged = evaluatePrJudgement({ body: '随便', files: [M('electron/foo.test.ts'), M('src/utils/format.ts')], addedByFile: byFile, createdAt: '2026-10-08T00:00:00Z', table })
  assert.equal(judged.inferred.fourClass, false)
  // 旧用法（没有逐文件新增行、只给整段文本）保持不变
  assert.ok(inferRoutes([M('src/utils/format.ts')], '+const c = new AbortController()', table).classes.includes('可打断'))
})

test('可打断：AbortController 只在产品代码（src / electron）里认；门岗脚本、文档里提到它不算（#1037 自己被误判）', () => {
  const tooling = [
    { ...M('scripts/pr-judgement-lib.mjs'), added: '+ * 测试里为了造取消场景写 new AbortController 不是「可打断」功能' },
    { ...M('docs/plan/x.md'), added: '+new AbortController 的说明' },
  ]
  assert.ok(!inferRoutes(tooling, '', table).classes.includes('可打断'))
  assert.ok(inferRoutes([...tooling, { ...M('electron/agentLane/run.ts'), added: '+const c = new AbortController()' }], '', table).classes.includes('可打断'))
})

const INTENT = (tier = '短', intent = '纯修复', ui = '无界面差异') => `## 变更意图\n- 意图：${intent}\n- 候选档位：${tier}\n- 单一意图：是\n- 声明：${intent === '纯修复' ? '纯修复：不改用户可见元素、布局、文案' : '新增一项能力'}\n- 界面核实：${ui}\n`

test('三档判定：声明 + base/head 清单核实；硬线永远严，短档核实未知降标准', () => {
  const inferred = (files, added = '') => inferRoutes(files.map((path) => M(path)), added, table)
  const short = evaluateProcessTier({ body: INTENT(), files: [M('src/ui/onboarding/focus.ts')], inferred: inferred(['src/ui/onboarding/focus.ts']), uiVerification: { known: true, changed: false, reason: 'fixture parity' } })
  assert.equal(short.tier, 'short')
  assert.equal(short.ok, true)

  const changed = evaluateProcessTier({ body: INTENT(), files: [M('src/ui/onboarding/focus.ts')], inferred: inferred(['src/ui/onboarding/focus.ts']), uiVerification: { known: true, changed: true, reason: 'button label changed' } })
  assert.equal(changed.tier, 'strict')
  assert.match(changed.lines.join('\n'), /界面差异核实不通过/)

  const unknown = evaluateProcessTier({ body: INTENT(), files: [M('src/ui/onboarding/focus.ts')], inferred: inferred(['src/ui/onboarding/focus.ts']) })
  assert.equal(unknown.tier, 'standard')
  assert.match(unknown.lines.join('\n'), /短档候选但界面差异核实未知，降为标准档/)

  const spend = evaluateProcessTier({ body: INTENT(), files: [M('electron/generation/spendLedger.ts')], inferred: inferred(['electron/generation/spendLedger.ts']), uiVerification: { known: true, changed: false } })
  assert.equal(spend.tier, 'strict')
  assert.match(spend.lines.join('\n'), /花钱路径/)

  const standard = evaluateProcessTier({ body: INTENT('标准', '新增功能', '有差异'), files: [M('electron/catalog/catalog.ts')], inferred: inferred(['electron/catalog/catalog.ts']), uiVerification: { known: true, changed: false } })
  assert.equal(standard.tier, 'standard')
})

test('r3：没声明的产品改动按标准；花钱、短档界面冲突、账本 fixed 仍严，短档界面未知降标准', () => {
  const product = [M('src/workbench/timeline/clip.tsx')]
  const productResult = evaluateProcessTier({ body: '## 做了什么\n改了时间轴交互\n', files: product, inferred: inferRoutes(product, '', table) })
  assert.equal(productResult.tier, 'standard')
  assert.equal(productResult.ok, true)
  assert.doesNotMatch(productResult.lines.join('\n'), /缺少变更意图声明/)

  const spend = [M('electron/generation/spendLedger.ts')]
  const spendResult = evaluateProcessTier({ body: '', files: spend, inferred: { classes: ['花钱'], categories: [] } })
  assert.equal(spendResult.tier, 'strict')
  assert.match(spendResult.lines.join('\n'), /花钱路径/)

  const unknown = evaluateProcessTier({ body: INTENT(), files: product, inferred: inferRoutes(product, '', table), uiVerification: { known: false, changed: null, reason: 'base/head 清单缺失' } })
  assert.equal(unknown.tier, 'standard')
  assert.match(unknown.lines.join('\n'), /降为标准档：base\/head 清单缺失/)

  const changed = evaluateProcessTier({ body: INTENT(), files: product, inferred: inferRoutes(product, '', table), uiVerification: { known: true, changed: true, reason: '新增按钮' } })
  assert.equal(changed.tier, 'strict')
  assert.match(changed.lines.join('\n'), /界面差异核实不通过/)

  const unchanged = evaluateProcessTier({ body: INTENT(), files: product, inferred: inferRoutes(product, '', table), uiVerification: { known: true, changed: false, reason: '清单一致' } })
  assert.equal(unchanged.tier, 'short')

  const fixed = evaluateProcessTier({ body: '', files: product, inferred: inferRoutes(product, '', table), ledgerTransitions: ['FB-r3-fixed'] })
  assert.equal(fixed.tier, 'strict')
  assert.match(fixed.lines.join('\n'), /逃逸账本转 fixed/)
})

test('r4：安全严线只来自登记路由；关键词、方向检查文档不会抬档', () => {
  const securityFiles = [M('electron/settings/assetRelaySettings.ts')]
  const security = evaluateProcessTier({ body: '', files: securityFiles, inferred: inferRoutes(securityFiles, '', table) })
  assert.equal(security.tier, 'strict')
  assert.match(security.lines.join('\n'), /安全路径/)

  const authNamed = [M('src/features/authentication.ts')]
  const authResult = evaluateProcessTier({ body: '', files: authNamed, inferred: inferRoutes(authNamed, '', table) })
  assert.equal(authResult.tier, 'standard', '未登记的 auth 文件不能靠关键词进入严档')

  const directionDoc = [M('docs/engineering/direction-checks/2026-10-28-process-tiering.md')]
  const directionResult = evaluateProcessTier({ body: '安全 security direction-check', files: directionDoc, inferred: inferRoutes(directionDoc, '', table) })
  assert.equal(directionResult.tier, 'short', '方向检查文档只记录结论，不是安全路由')

  const spend = [M('electron/generation/spendLedger.ts')]
  assert.equal(evaluateProcessTier({ body: '', files: spend, inferred: inferRoutes(spend, '', table) }).tier, 'strict')
  assert.equal(evaluateProcessTier({ body: '', files: authNamed, inferred: inferRoutes(authNamed, '', table), ledgerTransitions: ['FB-r4-fixed'] }).tier, 'strict')
})

test('r4 护栏：新严档集合不得扩大，且旧花钱 / 长跑 / 可打断 / fixed 名单全保留', () => {
  const results = r4Baseline.prs.map((entry) => {
    const files = entry.files
    const inferred = inferRoutes(files, '', table)
    return {
      number: entry.number,
      tier: evaluateProcessTier({
        body: '',
        files,
        inferred,
        ledgerTransitions: entry.ledgerFixed ? ['historical-fixed'] : [],
        uiVerification: deriveUiVerification({ files }),
      }).tier,
    }
  })
  const strict = results.filter((entry) => entry.tier === 'strict').map((entry) => entry.number)
  assert.ok(strict.length <= r4Baseline.currentStrictCount, `新严档 ${strict.length} > 现行严档 ${r4Baseline.currentStrictCount}`)
  const strictSet = new Set(strict)
  for (const number of r4Baseline.mustStrictNumbers) assert.ok(strictSet.has(number), `必须严档 PR #${number} 被降档`)
})

test('r4 真红：关键词、安全登记、花钱硬线、方向文档四个反例逐字节变异后都会红', () => {
  const target = 'scripts/pr-judgement-lib.mjs'
  const harness = createGateMutationHarness({ gate: target, shareDirs: ['docs', 'src', 'tests', 'evals', 'outputs', 'worker', 'workers', 'infra'] })
  const fixturePath = path.join(harness.repoRoot, 'scripts/fixtures/process-tiering-r4-baseline.json')
  const run = (mutations, condition) => harness.withMutation(mutations, () => {
    const copy = harness.copyRootForTests()
    const moduleUrl = pathToFileURL(path.join(copy, target)).href
    const fixtureUrl = pathToFileURL(path.join(copy, 'scripts/fixtures/process-tiering-r4-baseline.json')).href
    const script = `
      import fs from 'node:fs'
      import { evaluateProcessTier, inferRoutes, deriveUiVerification } from ${JSON.stringify(moduleUrl)}
      const baseline = JSON.parse(fs.readFileSync(new URL(${JSON.stringify(fixtureUrl)}), 'utf8'))
      const filesOf = (entry) => entry.files
      const replay = (entry) => {
        const files = filesOf(entry)
        const inferred = inferRoutes(files)
        return evaluateProcessTier({ body: '', files, inferred, ledgerTransitions: entry.ledgerFixed ? ['historical-fixed'] : [], uiVerification: deriveUiVerification({ files }) })
      }
      const strict = baseline.prs.filter((entry) => replay(entry).tier === 'strict').map((entry) => entry.number)
      const guard = strict.length <= baseline.currentStrictCount && baseline.mustStrictNumbers.every((number) => strict.includes(number))
      const result = (${condition})
      process.exit(result ? 0 : 1)
    `
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: copy, encoding: 'utf8' })
    return child.status === 0
  })
  const authInput = `const files = [{ path: 'src/features/authentication.ts', status: 'M' }]
const result = evaluateProcessTier({ body: '', files, inferred: inferRoutes(files) })
result.tier === 'standard' && guard`
  const keywordMutation = "  const hard = []\n  const HARD_PATH = /auth/i\n  if (normalized.some((file) => HARD_PATH.test(file))) addHard('关键词路径')"
  const hardAnchor = '  const hard = []'
  assert.equal(run([[target, hardAnchor, keywordMutation]], authInput), false, '加回 HARD_PATH 后，未登记 auth 与严档数护栏都应真红')

  const securityAnchor = "  return JSON.parse(fs.readFileSync(path.join(root, ROUTING_FILE), 'utf8'))"
  const securityMutation = "  const table = JSON.parse(fs.readFileSync(path.join(root, ROUTING_FILE), 'utf8'))\n  table.pathRules = table.pathRules.filter((rule) => !(rule.category === 'security' && rule.pattern === '^electron/settings/assetRelaySettings\\\\.ts$'))\n  return table"
  const securityInput = `const files = [{ path: 'electron/settings/assetRelaySettings.ts', status: 'M' }]
const result = evaluateProcessTier({ body: '', files, inferred: inferRoutes(files) })
result.tier === 'strict'`
  assert.equal(run([[target, securityAnchor, securityMutation]], securityInput), false, '删掉安全登记后，登记文件严档测试应真红')

  const moneyAnchor = "  if (classes.has('花钱')) addHard('花钱路径')"
  assert.equal(run([[target, moneyAnchor, '']], 'guard'), false, '删掉花钱硬线后，必须严名单护栏应真红')

  const directionAnchor = '  const normalized = files.map((file) => norm(file.path))'
  const directionMutation = `${directionAnchor}\n  if (normalized.some((file) => file.includes('direction-checks/'))) addHard('方向检查路径')`
  const directionInput = `const files = [{ path: 'docs/engineering/direction-checks/2026-10-28-process-tiering.md', status: 'M' }]
const result = evaluateProcessTier({ body: '', files, inferred: { classes: [], categories: [] } })
result.tier !== 'strict'`
  assert.equal(run([[target, directionAnchor, directionMutation]], directionInput), false, '方向检查文档恢复硬线后，对应测试应真红')
})

test('r3 真红：三条旧判法逐字节变异会红，还原副本后回绿', () => {
  const target = 'scripts/pr-judgement-lib.mjs'
  const harness = createGateMutationHarness({ gate: target, shareDirs: ['docs', 'src', 'tests', 'evals', 'outputs', 'worker', 'workers', 'infra'] })
  const run = (mutations, assertion) => harness.withMutation(mutations, () => {
    const copy = harness.copyRootForTests()
    const moduleUrl = pathToFileURL(path.join(copy, target)).href
    const script = `import { evaluateProcessTier } from ${JSON.stringify(moduleUrl)}\nconst M = path => ({ path, status: 'M' })\nconst result = evaluateProcessTier(${JSON.stringify(assertion.input)}); if (${assertion.expect}) process.exit(0); process.exit(1)`
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: copy, encoding: 'utf8' })
    return child.status === 0
  })
  const noDeclaration = { input: { body: '', files: [{ path: 'src/workbench/timeline/clip.tsx', status: 'M' }], inferred: { classes: [], categories: [] } }, expect: "result.tier === 'standard'" }
  const money = { input: { body: '', files: [{ path: 'electron/generation/spendLedger.ts', status: 'M' }], inferred: { classes: ['花钱'], categories: [] } }, expect: "result.tier === 'strict'" }
  const unknown = { input: { body: INTENT(), files: [{ path: 'src/workbench/timeline/clip.tsx', status: 'M' }], inferred: { classes: [], categories: [] } }, expect: "result.tier === 'standard'" }
  const oldMissingDeclaration = "  const ui = uiVerification && typeof uiVerification === 'object' ? uiVerification : null"
  const missingDeclarationMutation = `${oldMissingDeclaration}\n  if (!declaration.present && !autoShort) addHard('缺少变更意图声明')`
  const oldUnknown = "      // 取不到两边清单只能证明不了短档；它不是产品风险硬线，降到标准让标准档证据承接。"
  const unknownMutation = "      if (!ui || ui.known !== true) addHard(`界面差异核实未知：${ui?.reason || '未提供 base/head 清单核实'}`)"
  const oldMoney = "  if (classes.has('花钱')) addHard('花钱路径')"
  assert.equal(run([[target, oldMissingDeclaration, missingDeclarationMutation]], noDeclaration), false, '缺少声明恢复硬线后，未声明产品应真红')
  assert.equal(run([[target, oldUnknown, unknownMutation]], unknown), false, 'UI 未知恢复判严后，短档未知应真红')
  assert.equal(run([[target, oldMoney, '']], money), false, '去掉花钱硬线后，花钱改动应真红')
})

test('r2：纯文档 / 测试 / 配置无声明自动短档；逃逸账本 fixed 仍强制严档', () => {
  const replay = (files, transitions = []) => evaluateProcessTier({
    body: '## 设计卡\n旧正文没有变更意图声明\n',
    files,
    inferred: inferRoutes(files, '', table),
    ledgerTransitions: transitions,
    uiVerification: { known: true, changed: false, reason: 'non-product fixture' },
  })
  const docs = replay([M('docs/plan/process-tiering.md')])
  assert.equal(docs.tier, 'short')
  assert.equal(docs.autoShort, true)
  assert.equal(docs.ok, true)
  const tests = replay([M('tests/pr-judgement-lib.node-test.mjs')])
  assert.equal(tests.tier, 'short')
  assert.equal(tests.autoShort, true)
  const electronTests = replay([M('electron/capabilityCore/sameShotOnceDoors.e2e.test.ts')])
  assert.equal(electronTests.tier, 'short')
  assert.equal(electronTests.autoShort, true)
  const config = replay([M('package.json')])
  assert.equal(config.tier, 'short')
  assert.equal(config.autoShort, true)
  const fixed = replay([M('tests/fixtures/ledger.json')], ['FB-r2-fixed'])
  assert.equal(fixed.tier, 'strict')
  assert.equal(fixed.autoShort, false)
  assert.match(fixed.lines.join('\n'), /逃逸账本转 fixed/)
})

test('改法一历史回放夹具：#1359 短；#1356/#1347 严；#1314/#1299 清单无差异短；ledger fixed 严', () => {
  const replay = (pr, file, tier, transitions = []) => {
    const files = [M(file)]
    const result = evaluateProcessTier({
      body: INTENT(),
      files,
      inferred: inferRoutes(files, '', table),
      ledgerTransitions: transitions,
      uiVerification: { known: true, changed: false, reason: `replay #${pr}` },
    })
    assert.equal(result.tier, tier, `#${pr}: ${result.lines.join('\n')}`)
  }
  replay(1359, 'src/ui/onboarding/focus.ts', 'short')
  replay(1356, 'electron/productionRun/generationTask.ts', 'strict')
  replay(1347, 'electron/assets/importTranscodeLifecycle.ts', 'strict')
  replay(1314, 'src/design/actions.tsx', 'short')
  replay(1299, 'src/workbench/common/richTextActions.tsx', 'short')
  replay(1203, 'docs/fixes/2026-10-08-receipt.root-cause.json', 'strict', ['FB-20261008-pending-spend-presentation'])
})

test('界面清单对账 fail-closed：两边都有清单才给确定结果', () => {
  assert.deepEqual(deriveUiVerification({ files: [M('docs/plan/a.md')] }), { known: true, changed: false, reason: '改动没有界面候选文件' })
  assert.equal(deriveUiVerification({ files: [M('src/ui/a.tsx')], baseBoards: {}, headBoards: {} }).known, false)
  assert.equal(deriveUiVerification({ files: [M('src/ui/a.tsx')], baseBoards: { A: { board: 'A' } }, headBoards: { A: { board: 'A' } } }).changed, false)
})

test('when / paid：每项证据 when 只有 pr | manual-full；manual-full 不进 PR 必交，只在报告里提示由手动全量覆盖', () => {
  for (const def of Object.values(table.categories)) {
    for (const item of def.evidence) {
      assert.ok(['pr', 'manual-full'].includes(item.when), `${item.id} 的 when 只能是 pr / manual-full`)
      assert.equal(typeof item.paid, 'boolean', `${item.id} 必须写 paid（真付费 / 真模型 = true：PR 上只要求正文交证据，不在 CI 自动跑）`)
      if (item.paid) assert.equal(item.when, 'pr', `${item.id} 是付费层，不进手动全量跑`)
    }
  }
  assert.ok(!requiredEvidence(['scale'], table).some((item) => item.id === 'perf-real-scale'))
  const result = checkRoutingEvidence('随便', ['scale'], table)
  assert.equal(result.ok, true)
  assert.match(result.lines.join('\n'), /手动全量跑覆盖.*perf-real-scale/)
  // 付费的仍要求正文交证据
  assert.ok(requiredEvidence(['spend'], table).some((item) => item.id === 'spend-paid-sample' && item.paid))
})

test('不设定时触发：路由表与文档里没有「每晚 / nightly」，全量跑 workflow 只有 workflow_dispatch、没有 schedule', () => {
  const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8')
  const workflow = read('.github/workflows/full-experience-run.yml')
  assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:/m)
  assert.doesNotMatch(workflow.replace(/^\s*#.*$/gm, ''), /schedule\s*:|cron\s*:/)
  assert.equal(table.fullRun.trigger, 'workflow_dispatch')
  for (const rel of ['docs/engineering/test-routing.json', 'docs/engineering/experience-system.md', 'docs/plan/2026-10-06-test-routing.md']) {
    assert.doesNotMatch(read(rel), /每晚|nightly/i, rel)
  }
})

test('全量跑：路由表 fullRun.commands 里的每一层都是真实存在的 package.json 脚本，id 唯一，一层红了后面照跑，报告列出没覆盖的', async () => {
  const { selectCommands, runFull, renderReport } = await import('./experience-full-run.mjs')
  const scripts = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).scripts
  const ids = new Set()
  for (const item of table.fullRun.commands) {
    assert.ok(scripts[item.script], `${item.id}：package.json 里没有脚本 ${item.script}`)
    assert.ok(!ids.has(item.id), `层 id 重复：${item.id}`)
    ids.add(item.id)
  }
  assert.ok(scripts['test:experience:full'])
  assert.throws(() => selectCommands(table, ['no-such-layer']), /不存在的层/)
  assert.deepEqual(selectCommands(table, ['laws']).map((item) => item.id), ['laws'])
  const calls = []
  const results = await runFull(table.fullRun.commands.slice(0, 3), async (item) => { calls.push(item.id); return { code: item.id === 'laws' ? 1 : 0, output: `${item.id} out\nline2` } })
  assert.deepEqual(calls, ['catalog', 'laws', 'feel'], '中间一层红了，后面照跑')
  const report = renderReport(results, table, { when: 'T' })
  assert.match(report, /3 层，2 过，1 红/)
  assert.match(report, /## laws 失败输出/)
  assert.match(report, /没有覆盖的/)
  assert.match(report, /spend-paid-sample/)
  assert.match(report, /ui-click-census/)
  // 抛错的层按红处理，不拖垮整轮
  const thrown = await runFull([table.fullRun.commands[0]], async () => { throw new Error('boom') })
  assert.equal(thrown[0].code, 1)
})

test('AI 用户走查的工具先试 Stagehand（planned）；缺工具的证据仍列缺口（planned 也算没建）', () => {
  const walk = table.categories.ui.evidence.find((item) => item.id === 'ui-ai-walk')
  assert.equal(walk.tool, 'stagehand (planned)')
  assert.match(walk.toolRef, /Stagehand/)
  assert.match(walk.toolRef, /Playwright _electron/)
  assert.equal(isMissingTool('stagehand (planned)'), true)
  assert.equal(isMissingTool('exists'), false)
  assert.ok(toolGaps(table).some((gap) => gap.id === 'ui-ai-walk'))
})

test('按钮预期表字段集：七个字段、catalogField 都落在 ⑫ catalog.mjs 的预期表字段（必填 + 可选）里；ui-click-census 证据按这七字段写', async () => {
  const { CLICK_TARGET_CONTRACT, STORYBOARD_CLICK_TARGETS } = await import('../tests/ux/full-walk/catalog.mjs')
  const known = new Set([...CLICK_TARGET_CONTRACT.fields, ...CLICK_TARGET_CONTRACT.optionalFields, ...Object.keys(STORYBOARD_CLICK_TARGETS[0])])
  const fields = table.buttonExpectationFields.fields
  assert.deepEqual(fields.map((field) => field.id), ['designSource', 'variantState', 'roleName', 'userAction', 'expectedState', 'testId', 'evidence'])
  for (const field of fields) {
    assert.ok(field.catalogField.length > 0, field.id)
    for (const name of field.catalogField) assert.ok(known.has(name), `${field.id} 映射到 catalog 里不存在的字段 ${name}`)
  }
  const census = table.categories.ui.evidence.find((item) => item.id === 'ui-click-census')
  for (const field of fields) assert.ok(census.label.includes(field.label.split(' / ')[0].split('（')[0]), `ui-click-census 的要求里没写到「${field.label}」`)
})

test('性能场景证据（2026-10-11）：界面 / 画布 / 长跑改动必交 perf-scenario；未验证红、id 不在登记表红、不适用要有理由', () => {
  const perfFiles = [M('src/workbench/Panel.tsx'), M('src/workbench/generationCanvas/canvasStore.ts'), M('electron/projectExportTask.ts')]
  for (const file of perfFiles) assert.ok(inferRoutes([file], '', table).categories.some((category) => category.id === 'perf'), file.path)
  assert.deepEqual(inferRoutes([M('docs/x.md'), M('scripts/check-x.mjs')], '', table).categories, [])
  assert.deepEqual(requiredEvidence(['perf'], table).map((item) => item.id), ['perf-scenario'])
  const check = (line) => checkRoutingEvidence(`## 验收证据\n${line}`, ['perf'], table, '2026-10-12T00:00:00Z')
  const good = check('- perf-scenario：canvas-drag-20-nodes 中位数 20 / p95 24 / 预算 33')
  assert.equal(good.ok, true, good.lines.join('\n'))
  assert.equal(checkRoutingEvidence('随便', ['perf'], table).ok, false, '没有这一行红')
  const unverified = check('- perf-scenario：未验证：工具未建')
  assert.equal(unverified.ok, false, '性能证据不接受「未验证」')
  assert.match(unverified.lines.join('\n'), /不接受「未验证」/)
  const ghost = check('- perf-scenario：ghost-scenario 中位数 1 / p95 2 / 预算 3')
  assert.equal(ghost.ok, false)
  assert.match(ghost.lines.join('\n'), /不在登记表/)
  assert.equal(check('- perf-scenario：不适用：只改了一行文案，没有新增交互').ok, true)
  assert.equal(check('- perf-scenario：不适用：无').ok, false)
  // 生效日之前开的 PR 不要求（创建时间未知 = 要求，fail-closed）
  assert.deepEqual(requiredEvidence(['perf'], table, '2026-10-05T00:00:00Z'), [])
  assert.equal(requiredEvidence(['perf'], table, '2026-10-12T00:00:00Z').length, 1)
  assert.equal(requiredEvidence(['perf'], table, null).length, 1)
  assert.equal(evaluatePrJudgement({ body: '## 设计卡\n### 功能分类\n- [x] 新增功能 / 性能', files: [M('src/workbench/generationCanvas/canvasStore.ts')], createdAt: '2026-10-12T00:00:00Z', table }).routing.ok, false)
})

// G-perfreg（2026-10-15）：合并前扫描的检出是 origin/main，PR 新增的场景文件不在检出里。已知 id = (基线 − 本 PR 删掉的) ∪ 本 PR 新增 / 改动的文件；取不到 PR 头内容 / JSON 坏 → 判红并说人话（fail-closed）。
// 用公开判据入口 checkRoutingEvidence，输入的 scenarios 形状与 knownScenarios 的返回一致（测试不依赖新导出，修前红的原因是「不在登记表」）。
test('性能场景：基线没有 X、PR 新增 X → 判过；基线也没有、PR 也没新增的 Y → 红（走 knownScenarios 的真实组合）', async () => {
  const { knownScenarios } = await import('./perf-scenarios-lib.mjs')
  const SC = (id) => JSON.stringify({ id, feature: '样例：拖动节点', script: 'tests/perf/canvas-scale-bench.mjs', args: [], scale: '150 个图片节点', metrics: ['frameGapP95'], budget: 33, baseline: { median: 20, p95: 24, runs: 5, machine: 't', date: '2026-10-15', commit: 'abc1234' } })
  const perfLine = (id) => `## 验收证据
- perf-scenario：${id} 中位数 20 / p95 24 / 预算 33`
  const base = [{ file: 'tests/perf/scenarios/base-one.json', data: JSON.parse(SC('base-one')) }]
  const known = knownScenarios({ baseEntries: base, prFiles: [{ file: 'tests/perf/scenarios/new-one.json', content: SC('new-one') }] })
  assert.deepEqual(known.problems, [])
  assert.equal(checkRoutingEvidence(perfLine('new-one'), ['perf'], table, '2026-10-12T00:00:00Z', known).ok, true, '正文引用本 PR 新增的 new-one，判过')
  assert.equal(checkRoutingEvidence(perfLine('base-one'), ['perf'], table, '2026-10-12T00:00:00Z', known).ok, true, '基线登记表里的 base-one 照样过')
  const ghost = checkRoutingEvidence(perfLine('ghost-y'), ['perf'], table, '2026-10-12T00:00:00Z', known)
  assert.equal(ghost.ok, false, 'Y 既不在基线、也不是本 PR 新增，必须红')
  assert.match(ghost.lines.join('\n'), /不在登记表/)
})

test('性能场景：PR 头文件取不到 / JSON 解析不了 → 判红并说人话（fail-closed）', async () => {
  const { knownScenarios } = await import('./perf-scenarios-lib.mjs')
  const SC = (id) => JSON.stringify({ id, feature: '样例：拖动节点', script: 'tests/perf/canvas-scale-bench.mjs', args: [], scale: '150 个图片节点', metrics: ['frameGapP95'], budget: 33, baseline: { median: 20, p95: 24, runs: 5, machine: 't', date: '2026-10-15', commit: 'abc1234' } })
  const perfLine = (id) => `## 验收证据
- perf-scenario：${id} 中位数 20 / p95 24 / 预算 33`
  const base = [{ file: 'tests/perf/scenarios/base-one.json', data: JSON.parse(SC('base-one')) }]
  const lost = knownScenarios({ baseEntries: base, prFiles: [{ file: 'tests/perf/scenarios/new-one.json', content: null }] })
  const unreadable = checkRoutingEvidence(perfLine('base-one'), ['perf'], table, '2026-10-12T00:00:00Z', lost)
  assert.equal(unreadable.ok, false, 'PR 头内容取不到必须红（fail-closed）')
  assert.match(unreadable.lines.join('\n'), /PR 头内容取不到/, '要说人话写出原因')
  const broken = knownScenarios({ baseEntries: base, prFiles: [{ file: 'tests/perf/scenarios/new-one.json', content: '{ not json' }] })
  assert.equal(checkRoutingEvidence(perfLine('base-one'), ['perf'], table, '2026-10-12T00:00:00Z', broken).ok, false, 'JSON 解析不了必须红')
  assert.match(checkRoutingEvidence(perfLine('base-one'), ['perf'], table, '2026-10-12T00:00:00Z', broken).lines.join('\n'), /JSON 读不了/)
  const removed = knownScenarios({ baseEntries: base, prFiles: [], removedFiles: ['tests/perf/scenarios/base-one.json'] })
  assert.equal(checkRoutingEvidence(perfLine('base-one'), ['perf'], table, '2026-10-12T00:00:00Z', removed).ok, false, '本 PR 删掉的基线场景不再认得')
})
