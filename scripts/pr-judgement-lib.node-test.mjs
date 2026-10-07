// PR 正文判据（功能分类 → 测试路由 + 规则与门岗范围）的测试（R17：加规则必须先证明它会咬人）。
// 判据层喂假数据；另有真 git 仓库端到端（临时仓库里跑 check:pr-judgement CLI）。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  addedLinesByFile,
  checkProtectedScope,
  checkRouting,
  checkRoutingCard,
  checkRoutingEvidence,
  evaluatePrJudgement,
  evidenceLineVerdict,
  inferRoutes,
  isMissingTool,
  loadRoutingTable,
  requiredEvidence,
  routingEnforced,
  toolGaps,
} from './pr-judgement-lib.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const table = loadRoutingTable()
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
  for (const rule of table.pathRules) assert.ok(table.categories[rule.category], `pathRules 指向不存在的类别 ${rule.category}`)
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
  assert.deepEqual(modifiedTsx.categories.map((c) => c.id), ['ui'])
  assert.equal(modifiedTsx.fourClass, false)
  // 多选：一个 PR 同时落在几类
  assert.ok(ids([M('src/workbench/generationCanvas/spendCard.tsx', 'A')]).length >= 3)
  assert.deepEqual(classify([M('docs/x.md'), M('src/a.test.ts'), M('electron/b.json')]).categories, [])
})

const CARD = (boxes) => `## 设计卡\n\n### 功能分类\n${boxes}\n`

test('设计卡「功能分类」：路径推出的必须都勾，勾的只能更多；缺这一节红', () => {
  const inferred = inferRoutes([M('src/workbench/generationCanvas/spendCard.tsx', 'A')], '', table)
  const need = inferred.categories.map((category) => category.id)
  assert.ok(need.includes('ui') && need.includes('spend') && need.includes('scale'))
  assert.match(checkRoutingCard('## 设计卡\nx', inferred, table).lines.join('\n'), /缺 `## 功能分类`/)
  const partial = checkRoutingCard(CARD('- [x] 新界面 / 改交互\n- [ ] 花钱'), inferred, table)
  assert.equal(partial.ok, false)
  assert.match(partial.lines.join('\n'), /花钱/)
  assert.match(partial.lines.join('\n'), /大数据量/)
  const full = checkRoutingCard(CARD('- [x] 新界面 / 改交互\n- [x] 花钱\n- [x] 大数据量 / 画布 / 长列表\n- [x] Agent 行为'), inferred, table)
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
  assert.deepEqual(req, ['ui-mockup', 'ui-click-census', 'ui-capability-unavailable', 'ui-ai-walk', 'ui-screens', 'spend-paid-sample', 'spend-fault-injection'])
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
  ].join('\n')
  const ok = checkRoutingEvidence(body, ['ui'], table)
  assert.equal(ok.ok, true, ok.lines.join('\n'))
  assert.deepEqual(ok.gaps.map((gap) => gap.id), ['ui-click-census', 'ui-ai-walk'])
  assert.match(ok.lines.join('\n'), /缺工具：ui-click-census/)
  // 工具已有的证据写「未验证」也接受，但不进缺口
  const exists = checkRoutingEvidence('## 验收证据\n- ui-mockup：未验证：本次没有新界面\n- ui-click-census：未验证：工具未建\n- ui-capability-unavailable：未验证：本次没有要模型的动作\n- ui-ai-walk：未验证：工具未建\n- ui-screens：未验证：无窄窗', ['ui'], table)
  assert.equal(exists.ok, true)
  assert.deepEqual(exists.gaps.map((gap) => gap.id), ['ui-click-census', 'ui-ai-walk'])
})

test('整体：路径推出的类别没勾 → 红；勾全且证据齐 → 绿；规则生效日之前开的 PR 路由只警告', () => {
  const files = [M('electron/spendLedger.ts')]
  const bad = checkRouting('## 设计卡\nx', inferRoutes(files, '', table), table)
  assert.equal(bad.ok, false)
  const good = '## 设计卡\n### 功能分类\n- [x] 花钱\n\n## 验收证据\n- spend-paid-sample：run 987654\n- spend-fault-injection：tests/ux/full-walk/playbooks/pb07-failure-kinds.walk.mjs\n'
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
  const old = evaluatePrJudgement({ body: '随便', files: [protectedFile], createdAt: '2026-09-01T00:00:00Z', table })
  assert.equal(old.blocked, true)
})

test('体检：路由表里的缺工具清单（tool: missing 的证据 + 层级缺口）', () => {
  const ids = toolGaps(table).map((gap) => gap.id)
  for (const expected of ['ui-click-census', 'ui-ai-walk', 'perf-real-scale', 'gen-eval-set', 'layer-health']) assert.ok(ids.includes(expected), expected)
  const run = spawnSync(process.execPath, [path.join(here, 'check-pr-judgement.mjs'), '--gaps'], { encoding: 'utf8' })
  assert.equal(run.status, 0)
  assert.match(run.stdout, /工具缺口/)
  assert.match(run.stdout, /perf-real-scale/)
})

function git(cwd, ...args) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`)
  return run.stdout
}

test('端到端：临时 git 仓库里跑 CI 脚本——没勾分类 / 缺证据 / 没点名受保护文件 → 红；补齐 → 绿；非 PR 环境跳过', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-judgement-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), content)
  }
  git(root, 'init', '-q'); git(root, 'config', 'user.email', 't@t'); git(root, 'config', 'user.name', 't'); git(root, 'config', 'commit.gpgsign', 'false')
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
    '## 设计卡', '### 功能分类', '- [x] 花钱',
    '## 验收证据', '- spend-paid-sample：run 987654', '- spend-fault-injection：tests/ux/full-walk/playbooks/pb07-failure-kinds.walk.mjs',
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

test('exclude：设计实验室（src/devlab）的 tsx 不算「改交互」；真界面照算', () => {
  assert.deepEqual(inferRoutes([M('src/devlab/designLab/Kit.tsx')], '', table).categories, [])
  assert.deepEqual(inferRoutes([M('src/workbench/Panel.tsx')], '', table).categories.map((c) => c.id), ['ui'])
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
