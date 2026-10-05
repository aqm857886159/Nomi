// 自写登记门岗的判据测试（R17：加规则必须先证明它会咬人）。
// 判据层喂假数据；另有一条真 git 仓库的端到端（临时目录里建 base、加文件、跑 CLI），
// 证明「#945 那种新建一个同类文件」在警告期出警告、阻断期出红，领域目录与有登记的不报。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  SELF_WRITTEN_FILE,
  dueForReview,
  evaluateReviewDeadlines,
  evaluateSelfWritten,
  exemptionOf,
  pathMatches,
  registryChanges,
  staticPrefixOf,
  validateRegistry,
} from './self-written-lib.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')

const ENTRY = {
  id: 'lane-context-fit',
  capability: '每次模型请求的输入预算裁剪',
  status: 'justified',
  paths: ['electron/agentLane/laneContextFit.ts'],
  alternativesChecked: [{ name: 'pi transform_context 口', source: 'node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:150' }],
  whyNotIntegrated: '领域约束：画布 / 分镜的工具结果必须保留配对 id',
  revisitWhen: 'pi 提供回合内旧工具结果收起时',
}
const registry = (overrides = {}) => ({
  enforceFrom: '2026-10-09',
  domainRoots: [{ path: 'electron/productionRun/', reason: 'ProductionRun：按镜头花钱的持久编排，Nomi 独有' }],
  entries: [],
  ...overrides,
})
// 一个「同类文件」：通用能力（上下文裁剪），落在非领域目录
const FIT_FILE = { path: 'electron/agentLane/laneContextFitLike.ts', content: 'export function fitToBudget(messages: unknown[], budget: number) {\n  return messages.slice(-budget)\n}\n' }

test('咬人：领域目录之外新增一个通用能力文件、没有登记 → 报（警告期是警告，阻断期是红）', () => {
  const warn = evaluateSelfWritten({ registry: registry(), added: [FIT_FILE], today: '2026-10-02' })
  assert.deepEqual(warn.violations, [FIT_FILE.path])
  assert.equal(warn.errors.length, 0)
  assert.equal(warn.warnings.length, 1)
  assert.match(warn.warnings[0], /落在领域目录之外/)
  const hard = evaluateSelfWritten({ registry: registry(), added: [FIT_FILE], today: '2026-10-09' })
  assert.equal(hard.enforcing, true)
  assert.equal(hard.errors.length, 1)
  assert.match(hard.errors[0], /laneContextFitLike\.ts/)
})

test('不咬：领域目录里新建文件不报', () => {
  const file = { path: 'electron/productionRun/newShotThing.ts', content: 'export const x = 1\n' }
  const result = evaluateSelfWritten({ registry: registry(), added: [file], today: '2026-10-20' })
  assert.deepEqual(result.violations, [])
  assert.deepEqual(result.errors, [])
})

test('不咬：有登记的不报（精确文件、目录前缀、glob 三种写法）', () => {
  for (const paths of [['electron/agentLane/laneContextFitLike.ts'], ['electron/agentLane/'], ['electron/agentLane/laneContext*.ts']]) {
    const result = evaluateSelfWritten({
      registry: registry({ entries: [{ ...ENTRY, paths }] }), added: [FIT_FILE], today: '2026-10-20', exists: () => true,
    })
    assert.deepEqual(result.violations, [], paths.join(','))
    assert.deepEqual(result.errors, [], paths.join(','))
  }
})

test('豁免各有判据：测试、.d.ts、纯接线、纯类型 不报；有运行时语句的不豁免', () => {
  assert.equal(exemptionOf('electron/agentLane/foo.test.ts', 'x'), 'test')
  assert.equal(exemptionOf('src/utils/__fixtures__/a.ts', 'export const x = 1'), 'test')
  assert.equal(exemptionOf('src/workbench/ai/v4/testReactRenderer.ts', 'export const x = 1'), 'test')
  assert.equal(exemptionOf('electron/capabilityCore/agentPanelSpendConfirmTestUtils.ts', 'export const x = 1'), 'test')
  assert.equal(exemptionOf('electron/types.d.ts', 'declare const x: number'), 'declaration')
  assert.equal(exemptionOf('electron/agentLane/index.ts', "export { a, b } from './a'\nexport * from './b'\n"), 'wiring')
  assert.equal(exemptionOf('electron/agentLane/t.ts', "import type { A } from './a'\nexport type B = { f: (x: number) => string }\nexport interface C { y: string }\n"), 'types-only')
  assert.equal(exemptionOf('electron/agentLane/real.ts', 'export const x = 1\n'), null)
  assert.equal(exemptionOf('electron/agentLane/fit.ts', FIT_FILE.content), null)
  // 「import」开头的标识符不是 import 语句
  assert.equal(exemptionOf('electron/agentLane/sneaky.ts', "import x from './a'\nimportant()\n"), null)
  const exempted = [
    { path: 'electron/agentLane/foo.test.ts', content: 'x' },
    { path: 'electron/agentLane/index.ts', content: "export * from './a'\n" },
  ]
  assert.deepEqual(evaluateSelfWritten({ registry: registry(), added: exempted, today: '2026-10-20' }).violations, [])
})

test('不在 src/ 与 electron/ 下的新增不归这道门岗管；非代码文件不管', () => {
  const added = [
    { path: 'scripts/new-tool.mjs', content: 'export const x = 1' },
    { path: 'electron/agentLane/data.json', content: '{}' },
    { path: 'docs/plan/x.md', content: '# x' },
  ]
  assert.deepEqual(evaluateSelfWritten({ registry: registry(), added, today: '2026-10-20' }).violations, [])
})

test('登记表自己写坏了永远红（不分警告期）：缺理由、缺出处、to-replace 没计划、under-review 没期限', () => {
  const bad = registry({ entries: [
    { ...ENTRY, whyNotIntegrated: '' },
    { ...ENTRY, id: 'b', alternativesChecked: [{ name: '某库', source: '查过了' }] },
    { ...ENTRY, id: 'c', status: 'to-replace' },
    { ...ENTRY, id: 'd', status: 'under-review' },
    { ...ENTRY, id: 'e', alternativesChecked: [] },
    { ...ENTRY, id: 'f', status: 'maybe' },
  ] })
  const { errors } = evaluateSelfWritten({ registry: bad, added: [], today: '2026-10-02' })
  const text = errors.join('\n')
  assert.match(text, /缺 whyNotIntegrated/)
  assert.match(text, /没有出处/)
  assert.match(text, /to-replace 必须绑一份替换计划/)
  assert.match(text, /under-review 必须写 reviewBy/)
  assert.match(text, /alternativesChecked 至少一条/)
  assert.match(text, /status 必须是/)
  const dup = validateRegistry(registry({ entries: [ENTRY, ENTRY] }), { exists: () => true })
  assert.match(dup.errors.join('\n'), /id 重复/)
  const noReason = validateRegistry(registry({ domainRoots: [{ path: 'electron/x/', reason: '领域' }] }), { exists: () => true })
  assert.match(noReason.errors.join('\n'), /reason 必须写清/)
})

test('陈旧登记（路径不存在）：警告期是警告，阻断期是红', () => {
  const reg = registry({ entries: [ENTRY] })
  const warn = evaluateSelfWritten({ registry: reg, added: [], today: '2026-10-02', exists: () => false })
  assert.equal(warn.errors.length, 0)
  assert.ok(warn.warnings.some((message) => /陈旧登记/.test(message)))
  const hard = evaluateSelfWritten({ registry: reg, added: [], today: '2026-10-09', exists: () => false })
  assert.ok(hard.errors.some((message) => /陈旧登记/.test(message)))
})

test('registryChanges：新增 / 修改 entry 或扩大 domainRoots 算「新增通用能力」，只删不算', () => {
  const base = registry({ entries: [ENTRY] })
  assert.equal(registryChanges(base, base).changed, false)
  assert.deepEqual(registryChanges(base, registry({ entries: [ENTRY, { ...ENTRY, id: 'new-one' }] })).changedEntries, ['new-one'])
  assert.deepEqual(registryChanges(base, registry({ entries: [{ ...ENTRY, whyNotIntegrated: '改了理由' }] })).changedEntries, ['lane-context-fit'])
  assert.deepEqual(registryChanges(base, registry({ entries: [ENTRY], domainRoots: [...base.domainRoots, { path: 'electron/ai/', reason: '把通用栈划成领域' }] })).addedRoots, ['electron/ai/'])
  assert.equal(registryChanges(base, registry({ entries: [] })).changed, false)
})

test('dueForReview：待替换、评估中 / 评估到期、复查日已到，列进周期审计', () => {
  const rows = dueForReview(registry({ entries: [
    { ...ENTRY, id: 'a', status: 'to-replace', plan: 'docs/plan/x.md' },
    { ...ENTRY, id: 'b', status: 'under-review', reviewBy: '2026-10-05' },
    { ...ENTRY, id: 'c', revisitBy: '2026-10-01' },
    { ...ENTRY, id: 'd', revisitBy: '2027-01-01' },
  ] }), '2026-10-10')
  assert.deepEqual(rows.map((row) => row.id), ['a', 'b', 'c'])
  assert.match(rows[1].why, /评估已到期/)
})

test('pathMatches：目录前缀、精确文件、glob', () => {
  assert.equal(pathMatches('electron/a/', 'electron/a/b/c.ts'), true)
  assert.equal(pathMatches('electron/a', 'electron/ab.ts'), false)
  assert.equal(pathMatches('electron/a/b.ts', 'electron/a/b.ts'), true)
  assert.equal(pathMatches('electron/a/*.ts', 'electron/a/b/c.ts'), false)
  assert.equal(pathMatches('electron/**/lane*.ts', 'electron/a/b/laneX.ts'), true)
})

test('真实登记表：形状完整、领域目录与登记路径都存在', () => {
  const real = JSON.parse(fs.readFileSync(path.join(repoRoot, SELF_WRITTEN_FILE), 'utf8'))
  const exists = (file) => fs.existsSync(path.join(repoRoot, staticPrefixOf(file)))
  const shape = validateRegistry(real, { exists })
  assert.deepEqual(shape.errors, [])
  assert.deepEqual(shape.stale, [])
})

test('领域目录是概念级的：顶层树里混着的通用代码（hooks、协议层、缓存、IPC、存储、深比较）新文件一律要登记', () => {
  const real = JSON.parse(fs.readFileSync(path.join(repoRoot, SELF_WRITTEN_FILE), 'utf8'))
  const flagged = (file) => evaluateSelfWritten({
    registry: real, added: [{ path: file, content: 'export function f() { return 1 }\n' }], today: '2026-10-20', exists: () => true,
  }).violations.length === 1
  // 领域：不报
  for (const file of [
    'electron/productionRun/newShotThing.ts',
    'electron/capabilityCore/canvasNewThing.ts',
    'electron/capabilityCore/generationNewThing.ts',
    'electron/shared/agentCapabilities/newVerb.ts',
    'electron/catalog/newVendorAdapter.ts',
    'src/workbench/generationCanvas/nodes/NewNode.tsx',
    'src/workbench/production/NewRunCard.tsx',
    'src/workbench/ai/v4/agentPanelSpendCardV2.ts',
    'src/workbench/ai/v4/AgentPanelV4ReceiptV2.tsx',
    'src/workbench/ai/lane/laneNewThing.ts',
    'src/workbench/ai/systemPrompt/NewPromptThing.tsx',
    'electron/memory/projectMemoryV2.ts',
    'electron/experience/experienceThing.ts',
    'electron/connectors/tikhubNewEndpoint.ts',
    'src/workbench/creation/newStoryboardThing.ts',
  ]) assert.equal(flagged(file), false, `${file} 是领域，不该报`)
  // 通用：报（这些在旧版「整棵顶层树都算领域」下全部漏过去）
  for (const file of [
    'electron/capabilityCore/mcpNewProtocolPart.ts',
    'electron/agentLane/laneContextFitLike.ts',
    'electron/downloads/newDownloader.ts',
    'electron/preload/newBridge.ts',
    'electron/events/eventLogRepository2.ts',
    'electron/settings/newPortableConfig.ts',
    'electron/browser/chrome/newChromeThing.ts',
    'electron/tasks/taskCacheV2.ts',
    'electron/backgroundNewThing.ts',
    'src/workbench/ai/v4/useAgentPanelNewPolling.ts',
    'src/workbench/generation/useNewDockThing.ts',
    'src/workbench/ai/v4/shareEqualDeep.ts',
    'src/workbench/generation/dockCollapsePrefs.ts',
    'src/workbench/ai/hooks/anything.ts',
    'src/workbench/common/NewMarkdown.tsx',
    'src/workbench/api/newApi.ts',
    'src/ui/newToast.tsx',
    // 通用聊天界面：0.24 要换成品组件、最容易再造轮子的地方
    'src/workbench/ai/v4/AgentPanelV4MarkdownV2.tsx',
    'src/workbench/ai/v4/AgentPanelV4MessageV2.tsx',
    'src/workbench/ai/v4/AgentPanelV4RowV2.tsx',
    'src/workbench/ai/v4/AgentPanelV4ComposerV2.tsx',
    'src/workbench/ai/v4/agentPanelV4ScrollMemoryV2.ts',
    'src/workbench/ai/v4/agentPanelV4CollapseV2.ts',
    'src/workbench/ai/v4/formatMoneyV2.ts',
    'src/workbench/ai/v4/vendor/aiElementsPrimitivesV2.tsx',
    'src/workbench/ai/composer/AutoGrowTextareaV2.tsx',
    'src/workbench/ai/resident/residentTranscriptScrollV2.ts',
    'electron/conversations/conversationsStoreV2.ts',
    'electron/connectors/connectorPrefsStoreV2.ts',
    'src/design/NewPopover.tsx',
  ]) assert.equal(flagged(file), true, `${file} 是通用代码，应该报`)
})

test('exclude 与 genericZones 的语义：exclude 只作用于它所在的领域目录；genericZones 覆盖一切领域目录', () => {
  const reg = registry({
    domainRoots: [{ path: 'electron/tasks/', reason: '生成任务的提交、轮询、取片与本地化', exclude: ['electron/tasks/taskCache*'] }],
    genericZones: [{ path: '**/hooks/', reason: '通用 hooks 子树' }],
  })
  const run = (file) => evaluateSelfWritten({ registry: reg, added: [{ path: file, content: 'export const x = 1\n' }], today: '2026-10-20' }).violations
  assert.deepEqual(run('electron/tasks/taskSpendV2.ts'), [])
  assert.deepEqual(run('electron/tasks/taskCacheV2.ts'), ['electron/tasks/taskCacheV2.ts'])
  const hooks = evaluateSelfWritten({
    registry: registry({ domainRoots: [{ path: 'src/workbench/ai/', reason: 'Agent 面板与对话投影的界面' }], genericZones: [{ path: '**/hooks/', reason: '通用 hooks 子树' }] }),
    added: [{ path: 'src/workbench/ai/hooks/useX.ts', content: 'export const x = 1\n' }], today: '2026-10-20',
  })
  assert.deepEqual(hooks.violations, ['src/workbench/ai/hooks/useX.ts'])
})

// —— 端到端：真 git 仓库里跑 CLI ——
function git(cwd, ...args) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`)
  return run.stdout
}

test('端到端：新建一个同类文件，警告期放行并出警告，阻断期退出 1；领域目录与有登记的不报', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'self-written-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), content)
  }
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 't@example.com')
  git(root, 'config', 'user.name', 't')
  git(root, 'config', 'commit.gpgsign', 'false')
  write(SELF_WRITTEN_FILE, JSON.stringify(registry({ entries: [{ ...ENTRY, paths: ['electron/agentLane/covered.ts'] }] })))
  write('electron/productionRun/seed.ts', 'export const seed = 1\n')
  write('electron/agentLane/covered.ts', 'export const covered = 0\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'base')
  const base = git(root, 'rev-parse', 'HEAD').trim()

  write('electron/agentLane/laneContextFitLike.ts', FIT_FILE.content)
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'add generic capability')
  const run = (today) => spawnSync(process.execPath, [path.join(here, 'check-self-written.mjs')], {
    encoding: 'utf8', env: { ...process.env, SELF_WRITTEN_REPO_ROOT: root, SELF_WRITTEN_BASE_REF: base, SELF_WRITTEN_TODAY: today },
  })
  const warn = run('2026-10-02')
  assert.equal(warn.status, 0, warn.stderr)
  assert.match(warn.stderr, /警告期/)
  assert.match(warn.stderr, /laneContextFitLike\.ts/)
  const hard = run('2026-10-09')
  assert.equal(hard.status, 1)
  assert.match(hard.stderr, /laneContextFitLike\.ts/)

  // 领域目录里新建、有登记的新建：都不报
  git(root, 'rm', '-q', '-f', 'electron/agentLane/laneContextFitLike.ts')
  write('electron/productionRun/another.ts', 'export const another = 1\n')
  write('electron/agentLane/covered2.ts', 'export const c = 1\n')
  const reg = JSON.parse(fs.readFileSync(path.join(root, SELF_WRITTEN_FILE), 'utf8'))
  reg.entries[0].paths.push('electron/agentLane/covered2.ts')
  write(SELF_WRITTEN_FILE, JSON.stringify(reg))
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'only domain + registered')
  const quiet = run('2026-10-20')
  assert.equal(quiet.status, 0, quiet.stderr)
  assert.doesNotMatch(quiet.stderr, /落在领域目录之外/)
})

test('端到端：新增文件路径带中文时门岗仍然认得出（git 默认会把中文路径转义成八进制串，按行读会漏判）', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'self-written-cjk-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), content)
  }
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 't@example.com')
  git(root, 'config', 'user.name', 't')
  git(root, 'config', 'commit.gpgsign', 'false')
  write(SELF_WRITTEN_FILE, JSON.stringify(registry()))
  write('electron/productionRun/seed.ts', 'export const seed = 1\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'base')
  const base = git(root, 'rev-parse', 'HEAD').trim()
  write('electron/agentLane/中文通用能力.ts', FIT_FILE.content)
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'add generic capability with a CJK file name')
  const run = spawnSync(process.execPath, [path.join(here, 'check-self-written.mjs')], {
    encoding: 'utf8', env: { ...process.env, SELF_WRITTEN_REPO_ROOT: root, SELF_WRITTEN_BASE_REF: base, SELF_WRITTEN_TODAY: '2026-10-09' },
  })
  assert.equal(run.status, 1, run.stdout + run.stderr)
  assert.match(run.stderr, /electron\/agentLane\/中文通用能力\.ts/)
})

// —— 评估到期真拦 / 登记死账 ——
const REVIEWING = { ...ENTRY, id: 'mcp-like', status: 'under-review', reviewBy: '2026-11-15', paths: ['electron/mcp/protocol.ts', 'electron/mcp/launcher.ts'] }
const deadlines = (entry, extra = {}) => evaluateReviewDeadlines({ registry: registry({ entries: [entry] }), today: '2026-11-20', ...extra })

test('评估到期：过期的 under-review，这次改动碰了它的 paths → 红；没碰 → 不红；改离 under-review（评估 / 替换完）→ 不红', () => {
  assert.match(deadlines(REVIEWING, { changedFiles: ['electron/mcp/launcher.ts'] }).join(), /评估已过期/)
  assert.deepEqual(deadlines(REVIEWING, { changedFiles: ['electron/other/x.ts'] }), [])
  assert.deepEqual(deadlines({ ...REVIEWING, status: 'to-replace', plan: 'docs/plan/x.md' }, { changedFiles: ['electron/mcp/launcher.ts'] }), [])
  assert.deepEqual(deadlines({ ...REVIEWING, reviewBy: '2026-11-20' }, { changedFiles: ['electron/mcp/launcher.ts'] }), [], '到期当天还没过期')
  assert.deepEqual(deadlines(REVIEWING, { changedFiles: null }), [], '拿不到改动清单（无 base）不判，不拿算不出来当红')
})

test('新登记的 under-review：reviewBy 距今不超过 30 天；存量条目的日期不动、不追溯', () => {
  const base = registry({ entries: [{ ...REVIEWING, reviewBy: '2026-12-31' }] })
  const far = { ...ENTRY, id: 'fresh', status: 'under-review', reviewBy: '2026-12-31' }
  const text = evaluateReviewDeadlines({ registry: registry({ entries: [far] }), baseRegistry: base, today: '2026-11-20', changedFiles: [] }).join()
  assert.match(text, /不得超过 30 天/)
  const ok = { ...far, reviewBy: '2026-12-20' }
  assert.deepEqual(evaluateReviewDeadlines({ registry: registry({ entries: [ok] }), baseRegistry: base, today: '2026-11-20', changedFiles: [] }), [])
  // 存量（base 里就是 under-review，日期没动）：远期日期不追溯
  assert.deepEqual(evaluateReviewDeadlines({ registry: base, baseRegistry: base, today: '2026-11-20', changedFiles: [] }), [])
  // 刚从 justified 改成 under-review 算新登记
  const wasJustified = registry({ entries: [{ ...far, status: 'justified' }] })
  assert.match(evaluateReviewDeadlines({ registry: registry({ entries: [far] }), baseRegistry: wasJustified, today: '2026-11-20', changedFiles: [] }).join(), /不得超过 30 天/)
})

test('续期：往后推 reviewBy 必须同时加 renewed 记录，续后仍 ≤ 30 天，最多续一次', () => {
  const base = registry({ entries: [{ ...REVIEWING, reviewBy: '2026-11-25' }] })
  const run = (entry) => evaluateReviewDeadlines({ registry: registry({ entries: [entry] }), baseRegistry: base, today: '2026-11-20', changedFiles: [] })
  assert.match(run({ ...REVIEWING, reviewBy: '2026-12-10' }).join(), /必须同时在 renewed 里加一条记录/)
  const renewal = { on: '2026-11-20', from: '2026-11-25', reason: '要等 SDK 发 1.0 才能评估' }
  assert.deepEqual(run({ ...REVIEWING, reviewBy: '2026-12-10', renewed: [renewal] }), [])
  assert.match(run({ ...REVIEWING, reviewBy: '2027-02-10', renewed: [renewal] }).join(), /续期后的 reviewBy/)
  // 第二次续：形状层直接报
  const twice = validateRegistry(registry({ entries: [{ ...REVIEWING, renewed: [renewal, { ...renewal, on: '2026-12-10', from: '2026-12-10' }] }] }), { exists: () => true })
  assert.match(twice.errors.join(), /最多续 1 次/)
  const sloppy = validateRegistry(registry({ entries: [{ ...REVIEWING, renewed: [{ on: '2026-11-20' }] }] }), { exists: () => true })
  assert.match(sloppy.errors.join(), /renewed 必须是/)
})

test('to-replace 的 paths 已经全部不存在 → 红（已替换，请删登记）；还有一个在就不红', () => {
  const entry = { ...ENTRY, id: 'gone', status: 'to-replace', plan: 'docs/plan/x.md', paths: ['electron/a.ts', 'electron/b.ts'] }
  const none = validateRegistry(registry({ entries: [entry] }), { exists: () => false })
  assert.match(none.errors.join(), /已替换，请删这条登记/)
  const some = validateRegistry(registry({ entries: [entry] }), { exists: (file) => file === 'electron/b.ts' })
  assert.deepEqual(some.errors.filter((message) => /已替换/.test(message)), [])
  // 阻断期前也是红（不进警告期分档）
  assert.ok(evaluateSelfWritten({ registry: registry({ entries: [entry] }), added: [], today: '2026-10-01', exists: () => false }).errors.some((m) => /已替换/.test(m)))
})

test('端到端：过期的 under-review 条目，改动碰它的文件时 CLI 退出 1，没碰时退出 0，改成 to-replace 后退出 0', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'self-written-due-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), content)
  }
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 't@example.com')
  git(root, 'config', 'user.name', 't')
  git(root, 'config', 'commit.gpgsign', 'false')
  const entry = { ...REVIEWING, reviewBy: '2026-11-15' }
  write(SELF_WRITTEN_FILE, JSON.stringify(registry({ entries: [entry] })))
  write('electron/mcp/protocol.ts', 'export const v = 0\n')
  write('electron/mcp/launcher.ts', 'export const l = 0\n')
  write('electron/productionRun/seed.ts', 'export const seed = 1\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'base')
  const base = git(root, 'rev-parse', 'HEAD').trim()
  const run = (today) => spawnSync(process.execPath, [path.join(here, 'check-self-written.mjs')], {
    encoding: 'utf8', env: { ...process.env, SELF_WRITTEN_REPO_ROOT: root, SELF_WRITTEN_BASE_REF: base, SELF_WRITTEN_TODAY: today },
  })
  write('electron/productionRun/seed.ts', 'export const seed = 2\n')
  git(root, 'commit', '-q', '-am', 'touch domain only')
  assert.equal(run('2026-11-20').status, 0, '没碰 mcp 的 paths：不被过期条目拖住')
  write('electron/mcp/launcher.ts', 'export const l = 1\n')
  git(root, 'commit', '-q', '-am', 'fix(mcp): patch launcher')
  const red = run('2026-11-20')
  assert.equal(red.status, 1)
  assert.match(red.stderr, /评估已过期/)
  assert.equal(run('2026-11-10').status, 0, '没过期：不拦')
  const reg = JSON.parse(fs.readFileSync(path.join(root, SELF_WRITTEN_FILE), 'utf8'))
  Object.assign(reg.entries[0], { status: 'to-replace', plan: SELF_WRITTEN_FILE })
  write(SELF_WRITTEN_FILE, JSON.stringify(reg))
  git(root, 'commit', '-q', '-am', 'evaluate: switch to official sdk')
  assert.equal(run('2026-11-20').status, 0, '同一次改动把它改离 under-review：评估 / 替换本身，放行')
})
