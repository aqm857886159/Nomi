// 推送前钩子的「结构 / 契约」用例（纯函数 + 读文件，不起 git 副本；唯一的子进程是下面 isolatedRun 起的假慢测试，几秒内跑完）。
//
// 为什么单独一个文件（2026-10-09 #1147 / #1141 实证）：这些用例原来和「真 git 副本里跑真入口」的慢用例同在
// pre-push-contracts.node-test.mjs，整份 > 90 秒所以推送前钩子跑不了，只在 CI 的 check:claude-hooks 里跑——
// 于是「往 GATE_INPUTS 加了门、没补 SCANNER_READS」「main 上新加的门没在门表声明」这类只改登记表的错，本机全绿、CI 才红。
// 拆出来以后它自己是推送前的一道门（SCAN_TESTS 的 test:pre-push-structure，输入范围在 GATE_INPUTS 登记），
// 改了 package.json / 门表 / 输入声明 / 入口脚本就会跑。慢用例（真入口、tsc 探针、超时）留在原文件，仍在 CI 跑。
// 拆法的取舍：按「文件」拆而不是用 --test-name-pattern 按名字挑——名字模式要靠人记得给新用例起对前缀，漏了就悄悄不跑；按文件拆，新增用例放哪个文件由「要不要起 git 副本」自然决定。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { makeTempDir } from './_test-temp.mjs'
import { gitPaths } from './lib/gitPaths.mjs'
import { TEST_FILE, scanEvidence, walkSites } from './lib/scanGuardDetect.mjs'

import { judgeLint } from './lint-changed.mjs'
import { DERIVED_INPUT_GATES, GATE_INPUTS, touchesGateInputs } from './pre-push-gate-inputs.mjs'
import { CI_ONLY, PARTIAL_LOCAL, PRE_PUSH_ALIASES, TYPECHECK_NOT_COVERED, declarationProblems, parseContractGates } from './pre-push-gate-table.mjs'
import {
  BODY_GATES,
  LINT_GATE,
  PRE_PUSH_GATES,
  SCAN_TESTS,
  TAG_IN_MAIN_NOTICE,
  failedGuardSummary,
  formatSummary,
  gateCommands,
  gateEntryFiles,
  parsePushRefs,
  pushDecision,
  runNode,
  scanGuardsToRun,
  selectGates,
  softenTimeout,
} from './pre-push-contracts.mjs'
import { NOT_SOURCE_SCANS, SCAN_GUARDS, SCAN_GUARD_CI_ONLY, SCAN_GUARD_COVERED_BY_GATE, SCAN_GUARDS_GATE, gateImplementation, scanGuardProblems, touchesScanGuard } from './pre-push-scan-guards.mjs'
import { MAX_RELATED_FILES, NODE_TEST_ARGV_PREFIX, RELATED_TESTS_GATE, SLOW_TEST_FILES, relatedTests, runRelatedTests, stemOf } from './pre-push-related-tests.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8')
const pkg = JSON.parse(read('package.json'))

// 入口里不许有绕过开关：SKIP / NO_VERIFY / BYPASS 字样，或读任何带 SKIP / DISABLE / OFF 的环境变量（正文来源 NOMI_PR_BODY* 除外）
const BYPASS_PATTERN = /SKIP|NO_VERIFY|BYPASS|process\.env\.(?!NOMI_PR_BODY)\w*(?:SKIP|DISABLE|OFF)/i


// ── 选择器与扫描器同一份声明：契约测试（10-09 复审：tokens 漏 .css 与依赖脚本、vocabularies 漏 .mts / .cts）──────────────

/** 每道门岗的扫描器「实际会读」的样例路径：新增 / 改动任何一个，选择器都必须选中它。改扫描范围不改 GATE_INPUTS，这条就红。 */
const SCANNER_READS = {
  'check:store-lifetime': ['src/workbench/x/useXStore.ts', 'src/ui/Y.tsx', 'scripts/check-store-lifetime.mjs'],
  'check:icon-semantics': ['src/ui/Icon.tsx', 'electron/x.ts', 'scripts/check-icon-semantics.mjs', 'scripts/icon-semantics-baseline.json', 'docs/design/nomi-design-system.md'],
  'check:error-surface': ['src/a.tsx', 'electron/b.ts', 'scripts/error-surface-baseline.json', 'scripts/check-error-surface.mjs'],
  'check:heavy-path': ['src/a.ts', 'electron/b.mts', 'electron/c.cts', 'scripts/heavy-path-baseline.json'],
  'check:builtin-vendor-literals': ['src/a.tsx', 'electron/b.ts', 'scripts/check-builtin-vendor-literals.mjs'],
  'check:read-path-writes': ['src/a.ts', 'electron/b.tsx', 'scripts/read-path-writes-baseline.json'],
  'check:batch-machines': ['src/a.ts', 'electron/b.cts', 'scripts/batch-machines-baseline.json'],
  'check:capability-lifecycle': ['src/a.tsx', 'electron/b.ts', 'scripts/check-capability-lifecycle.mjs'],
  'check:no-default-overwrite': ['src/a.ts', 'electron/b.ts', 'workers/c.ts', 'scripts/no-default-overwrite-baseline.json'],
  'check:main-console': ['electron/a.ts', 'electron/b.mts', 'scripts/check-main-console.mjs'],
  'check:asset-evidence': ['electron/a.ts', 'electron/b.cts', 'scripts/asset-evidence-baseline.json'],
  'check:media-import-owner': ['electron/a.ts', 'src/b.tsx', 'scripts/media-import-owner-baseline.json'],
  'check:script-network-retry': ['scripts/some-delivery-script.mjs', 'scripts/lib/transientRetry.mjs', 'scripts/probe.ts', 'scripts/check-script-network-retry.mjs'],
  'check:canvas-edge-writers': ['src/workbench/generationCanvas/store/x.ts', 'src/workbench/project/y.tsx', 'electron/capabilityCore/z.ts', 'electron/shared/canvas/w.ts', 'scripts/check-canvas-edge-writers.mjs'],
  'check:storyboard-owner': ['src/workbench/a.ts', 'src/workbench/creation/b.tsx', 'scripts/check-storyboard-owner.mjs', 'scripts/lib/repoPaths.mjs'],
  'check:transport-assembly': ['electron/capabilityCore/mcpProtocol.ts', 'electron/capabilityCore/mcpNodeLauncher.ts', 'electron/capabilityCore/mcpStdioServer.ts', 'electron/capabilityCore/mcpHttpServer.ts', 'scripts/check-transport-assembly.mjs', 'scripts/lib/repoPaths.mjs'],
  'check:spend-receipt': ['electron/capabilityCore/mcpGateConfirmation.ts', 'electron/capabilityCore/mcpSemanticGenerationFlow.ts', 'electron/capabilityCore/generationDispatcher.ts', 'scripts/spend-confirmation-receipt-baseline.json', 'scripts/check-spend-confirmation-receipt.mjs'],
  'check:dangling-tokens': ['src/theme/nomi-tokens.css', 'src/a.tsx', 'tailwind.config.ts', 'scripts/check-dangling-tokens.mjs'],
  'check:dangling-tailwind': ['src/a.css', 'src/b.tsx', 'tailwind.config.ts', 'scripts/dangling-tailwind-baseline.json'],
  'check:design-lab-mirrors': ['src/devlab/designLab/a.tsx', 'src/workbench/x/Y.tsx', 'tests/ux/design-lab/baselines/a.png', 'scripts/check-design-lab.mjs'],
  'check:walkthroughs': ['tests/ux/a.walk.mjs', 'tests/ux/g1/cases.node-test.mjs', 'tests/ux/x.json', 'src/a.css', 'src/b.tsx', 'scripts/walkthrough-baseline.json', 'scripts/check-walkthroughs.mjs'],
  'check:tokens': ['src/theme/nomi-tokens.css', 'src/ui/A.tsx', 'src/a.ts', 'src/a.mts', 'electron/x.ts', 'electron/theme.css', 'tailwind.config.ts', 'scripts/check-design-tokens.mjs', 'scripts/lib/colorMixHue.mjs', 'scripts/lib/scopedTokenScan.mjs', 'scripts/lib/gitPaths.mjs'],
  'check:vocabularies': ['src/a.ts', 'src/a.tsx', 'src/a.mts', 'src/a.cts', 'electron/b.cts', 'electron/b.mts', 'scripts/check-vocabularies.mjs', 'scripts/check-vocabularies-scan.mjs', 'scripts/vocabularies-baseline.json'],
  'check:controls': ['src/ui/B.tsx', 'scripts/check-control-contract.mjs', 'scripts/control-contract-copy.mjs', 'scripts/control-contract-discarded-commands.mjs', 'scripts/control-copy-baseline.json'],
  'test:temp-helper': ['scripts/x.node-test.mjs', 'tests/ux/y.walk.mjs', 'tests/ux/z.probe.mjs', 'scripts/check-test-temp-static.node-test.mjs', 'scripts/_test-temp.mjs'],
  'check:test-copy-literals': ['src/a.test.ts', 'electron/b.test.ts', 'scripts/c.node-test.mjs', 'tests/ux/d.walk.mjs', 'tests/ux/exempt.json', 'evals/e.test.mjs', 'packages/p/f.test.ts', 'src/i18n/locales/zh.ts', 'electron/desktopStrings.ts', 'scripts/check-test-copy-literals.mjs'],
  'test:control-contract': ['scripts/check-control-contract.test.mjs', 'scripts/control-contract-copy.mjs', 'scripts/control-contract-discarded-commands.mjs', 'scripts/_test-temp.mjs'],
  'test:pre-push-structure': ['package.json', 'scripts/git-hooks.json', 'scripts/pre-push-structure.node-test.mjs', 'scripts/pre-push-gate-table.mjs', 'scripts/pre-push-gate-inputs.mjs', 'scripts/pre-push-contracts.mjs', 'scripts/pre-push-related-tests.mjs'],
  'test:quit-lifecycle-guard': ['electron/quitLifecycleGuard.test.ts', 'electron/main.ts', 'electron/x.mts', 'eslint.config.mjs'],
}

// ── 本机与 CI 对齐：gates:contracts 的每一道门都必须在推送前表态（10-09：#1135 / #1133 / #1137 推送前全绿、CI 才红）────────────

const { gates: CI_GATES } = parseContractGates(pkg.scripts['gates:contracts'])
const PRE_PUSH_NAMES = new Set([...PRE_PUSH_GATES.map((gate) => gate.name), ...SCAN_TESTS.map((scan) => scan.name), LINT_GATE.name, ...BODY_GATES])


test('门岗清单：每一项都在 package.json 的 gates:contracts 里、命令是 node 脚本（命令只此一份，不另抄）', () => {
  const contracts = pkg.scripts['gates:contracts']
  for (const name of [...PRE_PUSH_GATES.map((gate) => gate.name), ...BODY_GATES]) {
    assert.ok(contracts.split(/\s+/).includes(name), `${name} 不在 gates:contracts 里：推送前跑的门岗必须是 CI 也跑的那一个`)
    assert.doesNotThrow(() => gateCommands(pkg.scripts[name], []), `${name} 的命令不是 node 脚本`)
  }
  assert.ok(contracts.split(/\s+/).includes('lint:ci'), 'lint:changed 是 lint:ci 的子集，CI 侧必须还在跑 lint:ci')
  assert.equal(LINT_GATE.name, 'lint:changed')
})

test('命令选取：平时只跑检查脚本本体；改到门岗自己的单测 / 脚本时连单测一起跑', () => {
  const script = pkg.scripts['check:mjs-parse']
  assert.deepEqual(gateCommands(script, ['src/a.ts']), [['./scripts/check-mjs-parse.mjs']])
  const withTests = gateCommands(script, ['scripts/check-mjs-parse.node-test.mjs'])
  assert.equal(withTests.length, 2)
  assert.deepEqual(withTests[0].slice(0, 2), ['--test', './scripts/check-mjs-parse.node-test.mjs'])
  assert.throws(() => gateCommands('pnpm exec tsx scripts/x.ts', []), /只认 node 命令/)
})

test('按改动选门岗：该片地没动就不跑；纯文档只跑登记类；算不出改动全跑', () => {
  const always = PRE_PUSH_GATES.filter((gate) => gate.when === null).map((gate) => gate.name)
  assert.ok(always.includes('check:filesize') && always.includes('check:self-written') && always.includes('check:boundary-owners'))
  assert.deepEqual(selectGates(['docs/engineering/x.md']), always)
  const electron = selectGates(['electron/main.ts'])
  assert.ok(electron.includes('check:ipc-sender-binding') && electron.includes('check:test-waits') && electron.includes('lint:changed'))
  assert.ok(!electron.includes('check:mjs-parse'), 'electron/ 下没有 .mjs/.cjs 改动，不必跑 mjs-parse')
  const scripts = selectGates(['scripts/foo.mjs'])
  assert.ok(scripts.includes('check:mjs-parse') && !scripts.includes('check:ipc-sender-binding'))
  const everything = selectGates(null)
  for (const gate of PRE_PUSH_GATES) assert.ok(everything.includes(gate.name))
  assert.ok(everything.includes('lint:changed'))
})

test('推送判定：依据远端 ref + 本地 SHA，不看 localRef 写法；删除跳过；tag 看是否已在 origin/main；SHA ≠ HEAD 拒绝', () => {
  const head = 'a'.repeat(40)
  const zero = '0'.repeat(40)
  const decide = (line, inMain) => pushDecision(parsePushRefs(line + '\n'), head, inMain)
  assert.deepEqual(decide(`HEAD ${head} refs/heads/x ${zero}`), { check: true })
  assert.deepEqual(decide(`refs/heads/x ${head} refs/heads/x ${zero}`), { check: true })
  assert.equal(decide(`(delete) ${zero} refs/heads/x ${head}`).check, false)
  assert.equal(decide(`refs/tags/v1 ${head} refs/tags/v1 ${zero}`, () => false).check, true)
  assert.equal(decide(`refs/tags/v1 ${head} refs/tags/v1 ${zero}`, () => true).check, false)
  assert.match(decide(`refs/heads/y ${'b'.repeat(40)} refs/heads/y ${zero}`).blocked, /先 checkout/)
  assert.match(decide(`HEAD ${'b'.repeat(40)} refs/heads/y ${zero}`).blocked, /先 checkout/)
})

test('具名豁免：只对「已在 origin/main 的 tag」；其余非零更新一律先校验 SHA === HEAD', () => {
  const head = 'a'.repeat(40)
  const old = 'c'.repeat(40)
  const zero = '0'.repeat(40)
  const inMain = (sha) => sha === old
  const decide = (line) => pushDecision(parsePushRefs(line + '\n'), head, inMain)
  const tagInMain = decide(`refs/tags/v1 ${old} refs/tags/v1 ${zero}`)
  assert.equal(tagInMain.check, false)
  assert.equal(tagInMain.reason, TAG_IN_MAIN_NOTICE)
  assert.match(TAG_IN_MAIN_NOTICE, /tag 指向已在 origin\/main 的提交，不带新内容，跳过门岗/)
  assert.deepEqual(decide(`refs/tags/v1 ${head} refs/tags/v1 ${zero}`), { check: true }, '不在 main 的 tag（= HEAD）要跑门岗')
  assert.match(decide(`refs/tags/v1 ${'d'.repeat(40)} refs/tags/v1 ${zero}`).blocked, /先 checkout/, '不在 main 的 tag 且 ≠ HEAD：阻断')
  assert.match(decide(`refs/heads/x ${old} refs/heads/x ${zero}`).blocked, /先 checkout/, '分支指向 main 上的旧提交也不豁免')
  assert.match(decide(`refs/notes/x ${old} refs/notes/x ${zero}`).blocked, /先 checkout/, '非 tag 的其它 ref 同理')
  assert.match(decide(`refs/tags/v1 ${old} refs/heads/x ${zero}`).blocked, /先 checkout/, '远端 ref 不是 tag 就不豁免（看远端 ref，不看本地写法）')
})

test('汇总：失败项一次全部列出（不是第一项红就停），并给出只重跑失败项的命令', () => {
  const { text, failed } = formatSummary([
    { name: 'check:filesize', status: 1, output: 'a\nb', ms: 1000 },
    { name: 'check:self-written', status: 0, output: '', ms: 500 },
    { name: 'check:ipc-sender-binding', status: 1, output: 'c', ms: 800 },
  ])
  assert.equal(failed.length, 2)
  assert.match(text, /BLOCKED：2 项没过：check:filesize、check:ipc-sender-binding/)
  assert.match(text, /pnpm run check:filesize/)
  assert.match(text, /pnpm run check:ipc-sender-binding/)
  assert.doesNotMatch(text, /--only/, '重跑提示不走钩子入口，也没有缩小门岗集合的参数')
})

test('lint 子集：错误一律拦；警告只在比 base 多时拦并指出新增的那几条', () => {
  const warn = (ruleId, message) => ({ severity: 1, ruleId, message, line: 1, column: 1 })
  const error = (ruleId, message) => ({ severity: 2, ruleId, message, line: 2, column: 1 })
  assert.deepEqual(judgeLint([{ file: 'a.ts', head: [warn('x', 'm')], base: [warn('x', 'm')] }]), [], '存量警告不拦')
  assert.deepEqual(judgeLint([{ file: 'a.ts', head: [], base: [warn('x', 'm')] }]), [], '瘦身不拦')
  const more = judgeLint([{ file: 'a.ts', head: [warn('x', 'm'), warn('y', 'new')], base: [warn('x', 'm')] }])
  assert.equal(more.length, 1)
  assert.match(more[0], /警告 1 → 2/)
  assert.match(more[0], /新增 1:1 y new/)
  assert.equal(judgeLint([{ file: 'a.ts', head: [error('z', 'bad')], base: [error('z', 'bad')] }]).length, 1, '错误不看 base')
})

test('判据库被两边共用：推送前入口（check-pr-judgement）与合并前扫描（merge-preflight）都从 pr-body-criteria.mjs 判，谁也没有自己的设计卡实现', () => {
  for (const file of ['scripts/check-pr-judgement.mjs', 'scripts/merge-preflight.mjs']) {
    assert.match(read(file), /from '\.\/pr-body-criteria\.mjs'/, `${file} 没有 import 判据库`)
    assert.doesNotMatch(read(file), /function (?:checkDesignCard|checkIndependentAcceptance|checkEscapeContract|cellFilled|ledgerChanges)\b/, `${file} 里又长出了自己的判据实现`)
  }
  assert.match(read('scripts/pr-body-criteria.mjs'), /export function checkDesignCard/)
  assert.ok(!fs.existsSync(path.join(repoRoot, 'scripts/check-pr-body-gates.mjs')), '旧的正文门岗入口应已并入 pre-push-contracts.mjs（P1）')
})

test('钩子入口：pre-push 由分发入口 git-hook.mjs 指向 pre-push-contracts.mjs，钩子文件里不写脚本名，也没有绕过开关', () => {
  const table = JSON.parse(read('scripts/git-hooks.json'))
  assert.deepEqual(table['pre-push'], [['scripts/pre-push-contracts.mjs']])
  assert.doesNotMatch(read('scripts/install-git-hooks.cjs'), /pre-push-contracts/, '安装器不许再写死脚本名')
  const entry = read('scripts/pre-push-contracts.mjs')
  // 门岗名（如 check:push-bypass）是被跑的对象，不是旁路开关：先摘掉带引号的 check: 名字再查
  assert.doesNotMatch(entry.replace(/'check:[a-z-]+'/g, "''"), BYPASS_PATTERN)
})

test('绕过开关的判据本身有牙：NOMI_SKIP / NOMI_DISABLE / NOMI_OFF 都被拒，正文变量不误伤', () => {
  assert.match('process.env.NOMI_SKIP', BYPASS_PATTERN)
  assert.match('process.env.NOMI_DISABLE_GATES', BYPASS_PATTERN)
  assert.match('process.env.NOMI_OFF', BYPASS_PATTERN)
  assert.doesNotMatch('process.env.NOMI_PR_BODY_FILE', BYPASS_PATTERN)
  assert.doesNotMatch('process.env.NOMI_GIT_HOOK_DISPATCH', BYPASS_PATTERN)
})

test('按改动路径选门岗：只改 docs 不跑新增的；改 tests/ 跑临时目录与抄文案；改 src tsx 跑 tokens / vocabularies / controls；改 electron 跑退出守卫', () => {
  const docs = selectGates(['docs/a.md'])
  for (const name of ['check:tokens', 'check:vocabularies', 'check:controls', 'test:temp-helper', 'check:test-copy-literals', 'test:quit-lifecycle-guard']) assert.ok(!docs.includes(name), `docs 改动不该跑 ${name}`)
  const tests = selectGates(['tests/ux/x.walk.mjs'])
  assert.ok(tests.includes('test:temp-helper') && tests.includes('check:test-copy-literals'))
  assert.ok(!tests.includes('check:tokens'))
  const tsx = selectGates(['src/ui/A.tsx'])
  for (const name of ['check:tokens', 'check:vocabularies', 'check:controls', 'check:test-copy-literals']) assert.ok(tsx.includes(name), name)
  assert.ok(selectGates(['electron/main.ts']).includes('test:quit-lifecycle-guard'))
  assert.ok(selectGates(['scripts/control-contract-copy.mjs']).includes('test:control-contract'))
  assert.ok(selectGates(null).includes('test:control-contract'), '算不出改动 = 全跑')
})

test('契约：每道按路径选的新门岗都在 GATE_INPUTS 里登记，且扫描器会读的样例路径（css / mts / cts / 依赖脚本 / 基线）都选得中', () => {
  assert.deepEqual(Object.keys(SCANNER_READS).sort(), Object.keys(GATE_INPUTS).sort(), '样例表与输入声明的门岗集合必须一致')
  for (const [name, samples] of Object.entries(SCANNER_READS)) {
    for (const sample of samples) assert.ok(touchesGateInputs(name, [sample]), `${name} 应被 ${sample} 选中（扫描器会读它）`)
    assert.ok(!touchesGateInputs(name, ['docs/engineering/x.md']), `${name} 不该被纯文档选中`)
  }
})

test('契约：选择器只用 GATE_INPUTS，pre-push-contracts.mjs 里没有手写的这七道门岗的路径正则', () => {
  const entry = read('scripts/pre-push-contracts.mjs')
  for (const name of [...Object.keys(GATE_INPUTS), ...DERIVED_INPUT_GATES]) {
    const line = entry.split('\n').find((text) => text.includes(`name: '${name}'`))
    assert.ok(line, `${name} 应在入口里登记`)
    assert.match(line, /touchesGateInputs\(/, `${name} 的选择器必须来自 GATE_INPUTS`)
    assert.doesNotMatch(line, /\.test\(file\)/, `${name} 不许再手写路径正则`)
  }
})

test('结构：gates:contracts 的完整门列表（不按名字前缀过滤）里，每道门恰好声明一次——推送前跑 / 别名 / 只在 CI + 理由', () => {
  assert.ok(CI_GATES.length > 90, `解析出的门数量不对：${CI_GATES.length}`)
  assert.deepEqual(declarationProblems(CI_GATES, PRE_PUSH_NAMES), [])
})

test('必红：新登记的门（不管叫 check: / test: / run: 什么）没在选择表声明就红；改名、重复声明、别名指向无关门、陈旧项都红', () => {
  const base = { aliases: PRE_PUSH_ALIASES, ciOnly: CI_ONLY, partial: PARTIAL_LOCAL }
  // 新门：名字不带 check: 前缀也必须被要求声明
  assert.match(declarationProblems([...CI_GATES, 'test:new-gate'], PRE_PUSH_NAMES).join('\n'), /test:new-gate：没有声明/)
  assert.match(declarationProblems([...CI_GATES, 'run:policy'], PRE_PUSH_NAMES).join('\n'), /run:policy：没有声明/)
  // 改名：旧名还在声明里 = 陈旧项；新名没声明
  const renamed = CI_GATES.map((gate) => (gate === 'check:site' ? 'check:site-v2' : gate))
  const renamedProblems = declarationProblems(renamed, PRE_PUSH_NAMES).join('\n')
  assert.match(renamedProblems, /check:site-v2：没有声明/)
  assert.match(renamedProblems, /check:site：CI_ONLY 里的陈旧项/)
  // 重复声明：同一道门既推送前跑又只在 CI
  const dup = [...PRE_PUSH_NAMES].find((name) => CI_GATES.includes(name))
  assert.ok(dup)
  const dupOnly = [...CI_ONLY, { reason: '重复声明探针（故意）', gates: [dup] }]
  assert.match(declarationProblems(CI_GATES, PRE_PUSH_NAMES, { ...base, ciOnly: dupOnly }).join('\n'), new RegExp(`${dup}：重复声明`))
  // 别名指向不存在的推送前门岗
  const badAlias = { ...PRE_PUSH_ALIASES, 'check:test-temp-static': { by: 'check:no-such-gate', note: 'x' } }
  assert.match(declarationProblems(CI_GATES, PRE_PUSH_NAMES, { ...base, aliases: badAlias }).join('\n'), /别名指向不存在的推送前门岗/)
  // PARTIAL_LOCAL 里的门必须同时是 CI_ONLY
  const badPartial = { ...PARTIAL_LOCAL, 'check:filesize': { by: 'lint:changed', note: 'x' } }
  assert.match(declarationProblems(CI_GATES, PRE_PUSH_NAMES, { ...base, partial: badPartial }).join('\n'), /check:filesize：PARTIAL_LOCAL 里的门必须同时是 CI_ONLY/)
})

test('check:i18n 如实标成「只在 CI 跑」：不再有同名别名掩盖只覆盖了一部分，部分覆盖单独点名', () => {
  assert.ok(!('check:i18n' in PRE_PUSH_ALIASES))
  assert.ok(CI_ONLY.some((group) => group.gates.includes('check:i18n')))
  assert.equal(PARTIAL_LOCAL['check:i18n'].by, 'check:test-copy-literals')
  assert.ok(PRE_PUSH_NAMES.has('check:test-copy-literals'))
})

test('typecheck 不覆盖的目录诚实地不选中（tests/ux 的 tsx、evals 非 test、packages 等），（tsconfig 配置文件本身另测：任何 tsconfig*.json 都选中）', () => {
  for (const file of ['tests/ux/fixtures/foo.tsx', 'tests/ux/walk.ts', 'tests/agent-system/schema.mts', 'evals/director/binding.ts', 'packages/p/index.ts', 'workers/w.ts']) {
    assert.equal(touchesGateInputs('typecheck', [file]), false, `${file} 不在任何 tsc program 里，不该选中 typecheck`)
  }
  assert.ok(TYPECHECK_NOT_COVERED.length >= 4, '不覆盖的目录要在选择表里如实标明')
  // 影响结果的非根文件：依赖版本、棘轮基线、公共配置
  for (const file of ['package.json', 'pnpm-lock.yaml', 'scripts/test-types-baseline.json', 'tsconfig.base.json', 'tsconfig.app.json']) assert.ok(touchesGateInputs('typecheck', [file]), file)
})

test('解析器：gates:contracts 的门不按名字前缀过滤（test: / run: 开头的新门也解析得出来），--advisory 是参数不是门', () => {
  const parsed = parseContractGates('python3 scripts/with-gates-lock.py -- node scripts/run-gates-contracts.mjs --advisory=check:a check:b test:new-gate run:policy typecheck')
  assert.deepEqual(parsed.gates, ['check:b', 'test:new-gate', 'run:policy', 'typecheck'])
  assert.deepEqual(parsed.advisory, ['--advisory=check:a'])
  assert.throws(() => parseContractGates('node something-else.mjs a b'), /找不到 run-gates-contracts/)
})

test('必红：改了 typecheck 自己的入口脚本（typecheck.mjs / check-test-types.mjs / lib/typecheckProjects.mjs）或任何 tsconfig*.json → 选中 typecheck', () => {
  for (const file of ['scripts/typecheck.mjs', 'scripts/check-test-types.mjs', 'scripts/lib/typecheckProjects.mjs', 'tsconfig.devlab.json', 'tests/agent-system/tsconfig.json', 'electron/tsconfig.pi.json']) {
    assert.ok(touchesGateInputs('typecheck', [file]), `${file} 应选中 typecheck`)
    assert.ok(selectGates([file]).includes('typecheck'), `selectGates([${file}]) 应包含 typecheck`)
  }
})

test('通用规则：每道推送前门的实现脚本（package.json 命令 / argv 引用的脚本及其 import 闭包）被改时，选中这道门本身', () => {
  const names = [...PRE_PUSH_GATES.map((gate) => gate.name), ...SCAN_TESTS.map((scan) => scan.name), LINT_GATE.name]
  let checked = 0
  for (const name of names) {
    const entries = gateEntryFiles(name)
    if (entries.length === 0) continue // 命令里没有仓库内脚本（理论上不该发生）
    for (const entry of entries.filter((file) => /^scripts\//.test(file))) {
      assert.ok(selectGates([entry]).includes(name), `改了 ${entry} 应选中 ${name}`)
      checked += 1
    }
  }
  assert.ok(checked > 40, `核对的 (门, 实现脚本) 对太少：${checked}`)
  // 之前漏过的例子：ipc-sender-binding 只看 electron/，它自己的脚本被改却不会选中它
  assert.ok(selectGates(['scripts/check-ipc-sender-binding.mjs']).includes('check:ipc-sender-binding'))
})

// ── 相关单测（#1148：改了 build-electron.mjs，electron-build.test.mjs 必红，推送前只跑固定几条）──────────────────────

/** 本文件里起子进程的唯一入口：CI 的 *_BASE_REF / NOMI_CHANGED_BASE 置空，子进程不会拿整个 PR 的 diff 当夹具 diff（协调会话 10-09 提醒）。 */
const isolatedRun = (argv, env, options) => {
  const blanked = Object.fromEntries(Object.keys(process.env).filter((key) => /_BASE_REF$/.test(key) || key === 'NOMI_CHANGED_BASE').map((key) => [key, '']))
  return runNode(argv, { ...blanked, ...env }, options)
}

test('结构：本文件里只有 isolatedRun 一处直接起子进程（runNode 只调用一次），谁绕开它就红', () => {
  const source = read('scripts/pre-push-structure.node-test.mjs')
  assert.equal(source.match(/\brunNode\(/g).length, 1, 'runNode 的调用只许出现在 isolatedRun 里')
  assert.doesNotMatch(source.replace(/^\s*\/\/.*$/gm, ''), /\b(?:spawn|spawnSync|execFileSync|execSync|exec)\(/, '本文件不许直接起子进程')
})

test('必红：钩子环境里的 GIT_DIR / GIT_INDEX_FILE 等不传给门岗与测试子进程（10-10 测试的 git init 把真仓库改成 bare）', async () => {
  const probe = ['-e', 'process.stdout.write(JSON.stringify(Object.keys(process.env).filter((k) => /^GIT_/.test(k))))']
  const result = await isolatedRun(probe, { GIT_DIR: 'C:/should-not-leak/.git', GIT_INDEX_FILE: 'x', GIT_WORK_TREE: 'y', GIT_COMMON_DIR: 'z' }, { name: 'git-env-probe', timeoutMs: 20_000 })
  assert.equal(result.status, 0, result.output)
  assert.deepEqual(JSON.parse(result.output), [])
})

test('必红：造一个改了 build 脚本的改动集 → 选中 scripts/electron-build.test.mjs（vitest 依赖图看不见它：它用计算路径动态 import + 拷贝文件名清单）', () => {
  for (const changed of ['scripts/build-electron.mjs', 'scripts/electron-build-artifacts.mjs']) {
    const selection = relatedTests([changed], { root: repoRoot })
    assert.ok(selection.vitest.includes('scripts/electron-build.test.mjs'), `${changed} 应选中 electron-build.test.mjs，实际：${JSON.stringify(selection)}`)
  }
})

test('选择规则：改动的测试自己、同名测试、按引号提到它的测试都选中；纯文档 / 配置不触发；node:test 与 vitest 分路', () => {
  assert.deepEqual(relatedTests(['docs/engineering/x.md', 'package.json'], { root: repoRoot }), { vitest: [], node: [], skipped: [], truncated: 0 })
  // 改动的测试文件本身
  assert.deepEqual(relatedTests(['scripts/electron-build.test.mjs'], { root: repoRoot }).vitest, ['scripts/electron-build.test.mjs'])
  // 同名约定：foo.mjs ↔ foo.node-test.mjs
  assert.ok(relatedTests(['scripts/check-mjs-parse.mjs'], { root: repoRoot }).node.includes('scripts/check-mjs-parse.node-test.mjs'))
  // 已有别的门岗跑的测试不重复
  assert.ok(!relatedTests(['scripts/check-mjs-parse.mjs'], { root: repoRoot, exclude: new Set(['scripts/check-mjs-parse.node-test.mjs']) }).node.includes('scripts/check-mjs-parse.node-test.mjs'))
  // 文件主名规则
  assert.equal(stemOf('src/ui/Foo.test.tsx'), 'Foo')
  assert.equal(stemOf('scripts/a.node-test.mjs'), 'a')
  // 上限：超出的如实计数
  const capped = relatedTests(['scripts/_test-temp.mjs'], { root: repoRoot, maxFiles: 3 })
  assert.equal(capped.vitest.length + capped.node.length, 3)
  assert.ok(capped.truncated > 0)
  assert.ok(MAX_RELATED_FILES >= 10)
})

test('慢测试不进相关单测：pre-push-contracts.node-test.mjs 被命中时进 skipped 并写明原因，快用例在 test:pre-push-structure', () => {
  const selection = relatedTests(['scripts/pre-push-contracts.mjs'], { root: repoRoot })
  assert.ok(!selection.node.includes('scripts/pre-push-contracts.node-test.mjs'))
  assert.ok(selection.skipped.some((item) => item.file === 'scripts/pre-push-contracts.node-test.mjs' && /pre-push-structure/.test(item.reason)))
  for (const file of Object.keys(SLOW_TEST_FILES)) assert.ok(fs.existsSync(path.join(repoRoot, file)), `SLOW_TEST_FILES 里的 ${file} 已不存在`)
})

test('必红：假慢测试（永不退出）→ 到上限被终止、不算红、note 点名文件并说「没跑完，CI 会跑」；真红的测试照样红', async () => {
  const dir = makeTempDir('nomi-related-')
  const slow = path.join(dir, 'slow.node-test.mjs')
  const red = path.join(dir, 'red.node-test.mjs')
  fs.writeFileSync(slow, ["import test from 'node:test'", "test('hang', () => new Promise(() => setInterval(() => {}, 1000)))", ''].join('\n'))
  fs.writeFileSync(red, ["import test from 'node:test'", "import assert from 'node:assert/strict'", "test('red', () => assert.equal(1, 2))", ''].join('\n'))
  const started = Date.now()
  const timedOut = await runRelatedTests({ vitest: [], node: [slow], skipped: [], truncated: 0 }, isolatedRun, { budgetMs: 1500 })
  assert.ok(Date.now() - started < 30_000, '超时上限没生效')
  assert.equal(timedOut.status, 0, '超时不算红')
  assert.match(timedOut.note, /相关单测没跑完/)
  assert.match(timedOut.note, /CI 会跑/)
  assert.ok(timedOut.note.includes(slow), '要点名没跑的文件')
  const failed = await runRelatedTests({ vitest: [], node: [red], skipped: [], truncated: 0 }, isolatedRun, { budgetMs: 60_000 })
  assert.notEqual(failed.status, 0, '上限内真红必须拦')
})

test('必红：被选中的 node:test 要加载 .mts / .ts（CI 里是 tsx --test 跑的那类）→ 相关单测也能真跑通，不再 ERR_UNKNOWN_FILE_EXTENSION', async () => {
  const dir = makeTempDir('nomi-related-tsx-')
  const helper = path.join(dir, 'helper.mts')
  const needsTsx = path.join(dir, 'needs-tsx.node-test.mjs')
  fs.writeFileSync(helper, 'export const answer: number = 42')
  fs.writeFileSync(needsTsx, ["import test from 'node:test'", "import assert from 'node:assert/strict'", "import { pathToFileURL } from 'node:url'", "test('加载 .mts', async () => {", `  const mod = await import(pathToFileURL(${JSON.stringify(helper)}).href)`, '  assert.equal(mod.answer, 42)', '})', ''].join(String.fromCharCode(10)))
  const result = await runRelatedTests({ vitest: [], node: [needsTsx], skipped: [], truncated: 0 }, isolatedRun, { budgetMs: 60_000 })
  assert.equal(result.status, 0, result.output)
  assert.match(result.note, /node:test 1 个文件通过/)
  assert.deepEqual([...NODE_TEST_ARGV_PREFIX], ['--import', 'tsx', '--test'])
})

test('登记（C）：相关单测与结构门岗在选择表 / 输入声明 / 入口里都登记了，删掉任何一处这里就红', () => {
  // 结构门岗：SCAN_TESTS + GATE_INPUTS + SCANNER_READS 三处
  assert.ok(SCAN_TESTS.some((scan) => scan.name === 'test:pre-push-structure' && scan.argv.includes('scripts/pre-push-structure.node-test.mjs')), 'SCAN_TESTS 缺 test:pre-push-structure')
  assert.ok('test:pre-push-structure' in GATE_INPUTS, 'GATE_INPUTS 缺 test:pre-push-structure')
  assert.ok('test:pre-push-structure' in SCANNER_READS, 'SCANNER_READS 缺 test:pre-push-structure')
  // 改了门岗登记相关文件 → 一定选中结构门岗（B）
  for (const file of ['package.json', 'scripts/pre-push-gate-inputs.mjs', 'scripts/pre-push-gate-table.mjs', 'scripts/pre-push-contracts.mjs', 'scripts/pre-push-related-tests.mjs', 'scripts/pre-push-structure.node-test.mjs']) {
    assert.ok(selectGates([file]).includes('test:pre-push-structure'), `改了 ${file} 应选中 test:pre-push-structure`)
  }
  assert.ok(!selectGates(['docs/engineering/x.md']).includes('test:pre-push-structure'))
  // CI 里仍然跑它（check:claude-hooks 的命令列着）
  assert.match(pkg.scripts['check:claude-hooks'], /pre-push-structure\.node-test\.mjs/)
  // 相关单测：源码改动选中、纯文档不选、算不出改动全选；入口里真的接了线
  assert.ok(selectGates(['src/ui/A.tsx']).includes(RELATED_TESTS_GATE.name))
  assert.ok(selectGates(['scripts/foo.mjs']).includes(RELATED_TESTS_GATE.name))
  assert.ok(!selectGates(['docs/engineering/x.md']).includes(RELATED_TESTS_GATE.name))
  assert.ok(selectGates(null).includes(RELATED_TESTS_GATE.name))
  const entry = read('scripts/pre-push-contracts.mjs')
  assert.match(entry, /runRelatedTests\(relatedTests\(/, '入口没接相关单测')
  assert.match(entry, /--list[\s\S]*known/, '入口的 known 清单')
  assert.ok(entry.includes('RELATED_TESTS_GATE.name, ...BODY_GATES'), '相关单测要在入口的 known 清单里')
})

// ── 超时不等于红（10-10：合 main 后 typecheck 冷缓存 240.5 秒被当红拦推送，重推同一提交就过了）────────────────────

test('必红：typecheck 超时 → 推送不被拦（状态 0）、输出写明「本机没跑完，CI 会跑」；其它门挂住照旧按红处理', async () => {
  const typecheck = SCAN_TESTS.find((scan) => scan.name === 'typecheck')
  assert.equal(typecheck.softTimeout, true, 'typecheck 要标 softTimeout')
  const hung = await isolatedRun(['-e', 'setInterval(() => {}, 1000)'], {}, { timeoutMs: 1000, name: 'typecheck' })
  assert.equal(hung.status, 124, '先确认这是真超时')
  const softened = softenTimeout(typecheck, { name: 'typecheck', ...hung })
  assert.equal(softened.status, 0)
  assert.match(softened.note, /本机没跑完/)
  assert.match(softened.note, /CI 会跑/)
  const { text, failed } = formatSummary([softened])
  assert.equal(failed.length, 0)
  assert.match(text, /没跑完/)
  // 不带 softTimeout 的门：超时仍是红；真红（非 124）的 typecheck 仍是红
  const strict = SCAN_TESTS.find((scan) => scan.name !== 'typecheck')
  assert.equal(softenTimeout(strict, { name: strict.name, ...hung }).status, 124)
  assert.equal(softenTimeout(typecheck, { name: 'typecheck', status: 1, output: 'TS2345', ms: 5 }).status, 1)
  assert.deepEqual(SCAN_TESTS.filter((scan) => scan.softTimeout).map((scan) => scan.name), ['typecheck'], '只有 typecheck 可以软超时')
})

// ── 扫全仓 / 扫目录的守卫测试必须有去处（2026-10-10 一天漏 4 个：#1156 offLedgerEgress.structure、#1142 fileIdentity / mcpClientRegistry / check-network-entry）──

/** 把仓库（或夹具根）整理成 scanGuardProblems 要的输入：被跟踪的测试、推送前已登记的测试、gates:contracts 各门的命令与实现闭包。 */
function scanGuardInputs(root, trackedFiles, packageJson) {
  const gateNames = parseContractGates(packageJson.scripts['gates:contracts']).gates
  const scriptTexts = gateNames.map((name) => packageJson.scripts[name]).filter(Boolean)
  return {
    root,
    testFiles: trackedFiles.filter((file) => TEST_FILE.test(file)),
    scanTests: new Set(SCAN_TESTS.flatMap((scan) => gateEntryFiles(scan.name))),
    gateScripts: scriptTexts.join('\n'),
    gateImplFiles: gateImplementation(scriptTexts, root, (file) => fs.existsSync(path.join(root, file))),
    prePushGates: new Set(PRE_PUSH_GATES.map((gate) => gate.name)),
  }
}

test('扫描型守卫：仓库里每个「遍历源码并对全集断言」的测试都有去处——推送前登记 / CI_ONLY（附理由）/ 已被推送前门岗覆盖 / 识别器误判（附理由）', () => {
  const tracked = gitPaths(['ls-files'], { cwd: repoRoot, maxBuffer: 256 * 1024 * 1024 })
  const problems = scanGuardProblems(scanGuardInputs(repoRoot, tracked, pkg))
  assert.deepEqual(problems, [], `\n${problems.join('\n')}\n`)
  assert.ok(SCAN_GUARDS.length >= 40, `登记的扫描型守卫太少：${SCAN_GUARDS.length}`)
})

test('扫描型守卫登记：每条的测试文件、扫描目录、固定文件真实存在（改名或挪目录后这里红，不会悄悄不跑）；批量门岗按改动只带该带的', () => {
  const batch = SCAN_TESTS.find((scan) => scan.name === SCAN_GUARDS_GATE)
  assert.ok(batch && typeof batch.argvFor === 'function', 'SCAN_TESTS 里缺批量门岗 test:scan-guards')
  assert.deepEqual(batch.argvFor(null).slice(2).filter((arg) => !arg.startsWith('--')), SCAN_GUARDS.map((guard) => guard.file), '算不出改动 = 全部守卫都跑')
  // 扫描耗时跟着机器负载走：批量必须带放宽的用例超时，否则满载时假红（2026-10-10 #1128 推送被 30 秒默认超时拦过一次）
  for (const argv of [batch.argv, batch.argvFor(null)]) {
    const timeout = argv.find((arg) => arg.startsWith('--testTimeout='))
    assert.ok(timeout && Number(timeout.split('=')[1]) >= 120000, '批量门岗没带放宽的 --testTimeout（≥ 120 秒）')
  }
  for (const guard of SCAN_GUARDS) {
    assert.ok(fs.existsSync(path.join(repoRoot, guard.file)), `${guard.file} 不存在`)
    for (const dir of guard.roots ?? []) assert.ok(fs.existsSync(path.join(repoRoot, dir)), `${guard.file} 登记的扫描目录 ${dir} 不存在`)
    for (const file of guard.files ?? []) assert.ok(fs.existsSync(path.join(repoRoot, file)), `${guard.file} 登记的固定文件 ${file} 不存在`)
    assert.ok(batch.argv.includes(guard.file), `批量门岗的入口里没有 ${guard.file}`)
    assert.ok(selectGates([guard.file]).includes(SCAN_GUARDS_GATE), `改了守卫测试自己应选中批量门岗：${guard.file}`)
    assert.ok(batch.argvFor([guard.file]).includes(guard.file), `改了守卫测试自己，批量里要带上它：${guard.file}`)
  }
  assert.equal(new Set(SCAN_GUARDS.map((guard) => guard.file)).size, SCAN_GUARDS.length, '同一个守卫登记了两次')
  for (const group of SCAN_GUARD_CI_ONLY) for (const file of group.files) assert.ok(fs.existsSync(path.join(repoRoot, file)), `${file} 不存在`)
  for (const file of [...Object.keys(SCAN_GUARD_COVERED_BY_GATE), ...Object.keys(NOT_SOURCE_SCANS)]) assert.ok(fs.existsSync(path.join(repoRoot, file)), `${file} 不存在`)
})

test('扫描型守卫的选择规则：改到它扫的目录里的代码就跑；别的目录、非代码扩展名、纯文档不跑；exts 星号 = 任意扩展名；all = 除 docs 外任何改动', () => {
  const electronOnly = { file: 'x.test.ts', roots: ['electron'] }
  assert.ok(touchesScanGuard(electronOnly, ['electron/a/b.ts']))
  assert.ok(touchesScanGuard(electronOnly, ['electron/new/dir/zz.mts']))
  assert.ok(!touchesScanGuard(electronOnly, ['electron/readme.md']))
  assert.ok(!touchesScanGuard(electronOnly, ['src/a.ts']))
  assert.ok(!touchesScanGuard(electronOnly, ['electronic/a.ts']), '目录名前缀相同的兄弟目录不算')
  assert.ok(!touchesScanGuard(electronOnly, ['docs/engineering/x.md']))
  assert.ok(touchesScanGuard({ file: 'y.test.ts', roots: ['skills'], exts: '*' }, ['skills/new/SKILL.md']))
  assert.ok(touchesScanGuard({ file: 'z.test.ts', all: true, exts: '*' }, ['marketing/a.html']))
  assert.ok(!touchesScanGuard({ file: 'z.test.ts', all: true, exts: '*' }, ['docs/a.md']))
  assert.ok(touchesScanGuard({ file: 'w.test.ts', roots: ['a'], files: ['package.json'] }, ['package.json']))
})

/** 夹具仓库：造出各种写法的测试文件，喂识别器与核对函数。 */
function fixtureRepo(files) {
  const root = makeTempDir('nomi-scan-guard-')
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  return root
}

const WALKS_ELECTRON = [
  "import fs from 'node:fs'",
  "import path from 'node:path'",
  'const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))',
  "const files = walk(path.join(process.cwd(), 'electron'))",
  "test('没有违规', () => { for (const file of files) if (fs.readFileSync(file, 'utf8').includes('BAD')) throw new Error(file) })",
].join('\n')

test('必红：新写一个扫 electron 的守卫测试，既没进 SCAN_GUARDS 也没进 CI_ONLY → 核对函数红并点名；登记后绿', () => {
  const root = fixtureRepo({ 'electron/a.ts': 'export {}', 'electron/newRule.structure.test.ts': WALKS_ELECTRON })
  const inputs = { root, testFiles: ['electron/newRule.structure.test.ts'], scanTests: new Set(), gateScripts: '', gateImplFiles: new Set(), prePushGates: new Set(), guards: [], ciOnly: [], covered: {}, notScans: {} }
  const red = scanGuardProblems(inputs)
  assert.equal(red.length, 1, red.join('\n'))
  assert.match(red[0], /electron\/newRule\.structure\.test\.ts：扫描型守卫测试没有去处/)
  assert.match(red[0], /SCAN_GUARDS/)
  assert.deepEqual(scanGuardProblems({ ...inputs, guards: [{ file: 'electron/newRule.structure.test.ts', roots: ['electron'] }] }), [])
  assert.deepEqual(scanGuardProblems({ ...inputs, ciOnly: [{ reason: '假设本机跑不了：需要编译产物', files: ['electron/newRule.structure.test.ts'] }] }), [])
  assert.deepEqual(scanGuardProblems({ ...inputs, notScans: { 'electron/newRule.structure.test.ts': '识别器误判的假设理由' } }), [])
  assert.deepEqual(scanGuardProblems({ ...inputs, scanTests: new Set(['electron/newRule.structure.test.ts']) }), [], '已在 SCAN_TESTS 里（别的门岗登记）也算有去处')
  // 理由写得空 / 写在两张表里 / 没写扫哪些目录，都红
  assert.match(scanGuardProblems({ ...inputs, ciOnly: [{ reason: '', files: ['electron/newRule.structure.test.ts'] }] }).join('\n'), /缺理由/)
  assert.match(scanGuardProblems({ ...inputs, guards: [{ file: 'electron/newRule.structure.test.ts', roots: ['electron'] }], notScans: { 'electron/newRule.structure.test.ts': '同时写在两张表里' } }).join('\n'), /同时声明在/)
  assert.match(scanGuardProblems({ ...inputs, guards: [{ file: 'electron/newRule.structure.test.ts' }] }).join('\n'), /没写它扫哪些目录/)
})

test('必红：登记了却不再是扫描型（文件改了不再遍历）/ 文件已不存在 → 陈旧项红；COVERED_BY_GATE 指向的门岗不在推送前也红', () => {
  const root = fixtureRepo({ 'electron/plain.test.ts': "test('x', () => {})" })
  const inputs = { root, testFiles: ['electron/plain.test.ts'], scanTests: new Set(), gateScripts: '', gateImplFiles: new Set(), prePushGates: new Set(['check:real']), guards: [], ciOnly: [], covered: {}, notScans: {} }
  assert.match(scanGuardProblems({ ...inputs, guards: [{ file: 'electron/plain.test.ts', roots: ['electron'] }] }).join('\n'), /不再被识别为扫描型守卫（陈旧项/)
  assert.match(scanGuardProblems({ ...inputs, guards: [{ file: 'electron/gone.test.ts', roots: ['electron'] }] }).join('\n'), /不是被跟踪的测试文件/)
  assert.match(scanGuardProblems({ ...inputs, covered: { 'electron/plain.test.ts': 'check:imaginary' } }).join('\n'), /不是推送前门岗/)
})

// 夹具文本里要写子进程调用名，但本文件自己不许出现直接起子进程的写法（上面的结构用例按文本查），所以拼出来
const RUN = ['exec', 'FileSync'].join('')
// 同理：临时目录助手的静态检查（check-test-temp-static）按文本查直接建系统临时目录的写法，夹具文本里的这一处也拼出来
const TMP = ['os', 'tmpdir'].join('.')

test('必红：用 git ls-files / git grep 扫全仓的测试、以及 import 了「在仓库里遍历」的扫描器模块的测试，同样被识别（#1142 的 check-network-entry.test.mjs 就是第二种）', () => {
  const root = fixtureRepo({
    'scripts/scanner.mjs': [
      "import { readdirSync } from 'node:fs'",
      "import path from 'node:path'",
      "const root = path.resolve(import.meta.dirname, '..')",
      'export function scanAll(directory = root) { return readdirSync(path.join(directory, "electron")) }',
    ].join('\n'),
    'scripts/scanner.test.mjs': "import { scanAll } from './scanner.mjs'\ntest('x', () => expect(scanAll()).toEqual([]))",
    'scripts/lsfiles.test.mjs': `import { ${RUN} } from 'node:child_process'\nconst files = ${RUN}('git', ['ls-files'], { cwd: process.cwd() })\ntest('x', () => files)`,
    'electron/gitgrep.test.ts': `import { ${RUN} } from 'node:child_process'\nconst hits = ${RUN}('git', ['grep', '-n', 'MARK'], { cwd: process.cwd() })\ntest('x', () => hits)`,
  })
  assert.deepEqual(scanEvidence('scripts/scanner.test.mjs', root).map((item) => item.file), ['scripts/scanner.mjs'])
  assert.equal(scanEvidence('scripts/lsfiles.test.mjs', root)[0].kind, 'git ls-files|grep')
  assert.equal(scanEvidence('electron/gitgrep.test.ts', root)[0].kind, 'git ls-files|grep')
})

test('不误伤：只在测试自建的临时目录里 readdir、遍历用户目录的生产模块、只读固定文件的测试，都不算扫描型守卫', () => {
  const root = fixtureRepo({
    'electron/tmpOnly.test.ts': [
      "import fs from 'node:fs'",
      "import os from 'node:os'",
      "import path from 'node:path'",
      `const dir = fs.mkdtempSync(path.join(${TMP}(), 'x-'))`,
      "test('x', () => { expect(fs.readdirSync(dir)).toEqual([]) })",
    ].join('\n'),
    'electron/userDirs.ts': "import fs from 'node:fs'\nexport const list = (dir: string) => fs.readdirSync(dir)",
    'electron/usesProduction.test.ts': "import { list } from './userDirs'\ntest('x', () => expect(list('/nowhere')).toEqual([]))",
    'electron/fixedFile.test.ts': "import fs from 'node:fs'\nconst text = fs.readFileSync(new URL('./a.ts', import.meta.url), 'utf8')\ntest('x', () => text)",
    'electron/a.ts': 'export {}',
  })
  for (const file of ['electron/tmpOnly.test.ts', 'electron/usesProduction.test.ts', 'electron/fixedFile.test.ts']) assert.deepEqual(scanEvidence(file, root), [], file)
  // 同一个文件里一处扫仓库、一处扫临时目录：同名变量不互相带偏
  const mixed = fixtureRepo({
    'electron/mixed.test.ts': [
      "import fs from 'node:fs'",
      "import os from 'node:os'",
      "import path from 'node:path'",
      'let root: string',
      `test('临时', () => { root = fs.mkdtempSync(path.join(${TMP}(), 'x-')); fs.readdirSync(root) })`,
      "test('扫仓库', () => { root = path.resolve(__dirname); fs.readdirSync(root) })",
    ].join('\n'),
  })
  assert.ok(walkSites('electron/mixed.test.ts', fs.readFileSync(path.join(mixed, 'electron/mixed.test.ts'), 'utf8')).some((site) => site.anchored), '扫仓库那一处要认得出')
})

test('回归：今天漏掉的 4 个守卫——对应的违规改动现在会在推送前选中它们，而旧的「相关单测」挑法挑不中', () => {
  const cases = [
    // #1156：electron 里新增一个 child_process 出网口没登记 → offLedgerEgress.structure.test.ts 红
    { change: ['electron/ipc/newChildProcessEgress.ts'], guard: 'electron/offLedgerEgress.structure.test.ts' },
    // #1142：手写 dev / ino 比较 → fileIdentity.test.ts
    { change: ['electron/storage/handRolledIdentity.ts'], guard: 'electron/fileIdentity.test.ts' },
    // #1142：手抄 MCP 客户端清单（src 或 electron 任一处）→ mcpClientRegistry.test.ts
    { change: ['src/settings/handCopiedClients.ts'], guard: 'electron/shared/mcpClientRegistry.test.ts' },
    { change: ['electron/settings/handCopiedClients.ts'], guard: 'electron/shared/mcpClientRegistry.test.ts' },
    // #1142：裸 fetch / 原生 http 客户端 → check-network-entry.test.mjs（扫描器 scripts/check-network-entry.mjs 在它的闭包里）
    { change: ['electron/net/bareFetch.ts'], guard: 'scripts/check-network-entry.test.mjs' },
  ]
  for (const { change, guard } of cases) {
    const selected = selectGates(change)
    assert.ok(selected.includes(SCAN_GUARDS_GATE), `改 ${change.join('、')} 应选中 ${SCAN_GUARDS_GATE}`)
    assert.ok(scanGuardsToRun(change).some((item) => item.file === guard), `改 ${change.join('、')} 批量里应带上 ${guard}`)
    // 旧机制为什么漏：新增的违规文件没有任何测试「引用」它，相关单测只能靠引用挑
    const related = relatedTests(change, { root: repoRoot })
    assert.ok(![...related.vitest, ...related.node].includes(guard), `相关单测不该靠引用挑中 ${guard}（挑中了就不是这类「不引用具体文件」的守卫了）`)
  }
  // 扫描器本身被改也选中；纯文档、不相干目录不跑；算不出改动 = 全跑
  assert.ok(scanGuardsToRun(['scripts/check-network-entry.mjs']).some((item) => item.file === 'scripts/check-network-entry.test.mjs'))
  assert.ok(!selectGates(['docs/engineering/x.md']).includes(SCAN_GUARDS_GATE))
  assert.ok(!scanGuardsToRun(['marketing/index.html']).some((item) => item.file === 'electron/offLedgerEgress.structure.test.ts'))
  assert.ok(!scanGuardsToRun(['src/ui/A.tsx']).some((item) => item.file === 'electron/offLedgerEgress.structure.test.ts'), '只改 src 不该带只扫 electron 的守卫')
  assert.ok(selectGates(null).includes(SCAN_GUARDS_GATE) && scanGuardsToRun(null).length === SCAN_GUARDS.length, '算不出改动 = 全跑')
})

test('批量守卫红了：失败输出只回放最后 25 行，所以红的守卫测试文件要在输出末尾逐个点名，并给出只重跑它们的命令', () => {
  const output = [' FAIL  electron/fileIdentity.test.ts > class guard > x', 'AssertionError: …', ' FAIL  electron/shared/mcpClientRegistry.test.ts > y', '…', ' Test Files  2 failed | 13 passed (15)'].join('\n')
  const ran = ['electron/fileIdentity.test.ts', 'electron/offLedgerEgress.structure.test.ts', 'electron/shared/mcpClientRegistry.test.ts']
  const summary = failedGuardSummary(output, ran)
  assert.match(summary, /红的守卫测试 2 个/)
  assert.match(summary, /electron\/fileIdentity\.test\.ts/)
  assert.match(summary, /electron\/shared\/mcpClientRegistry\.test\.ts/)
  assert.doesNotMatch(summary, /offLedgerEgress/, '绿的不点名')
  assert.match(summary, /vitest\.mjs run electron\/fileIdentity\.test\.ts electron\/shared\/mcpClientRegistry\.test\.ts/)
  assert.match(failedGuardSummary('boom', ran), /没认出是哪几个/)
})
