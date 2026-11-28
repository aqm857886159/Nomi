// 门岗瘦身（2026-10-01，用户按 docs/audit/2026-10-01-gate-ledger.md 拍板）与 SM-gates 退役回归钉：
//   · 删 / 降 / 合并之后，账本里那 17 次「真问题」对应的门岗**照样在 PR 的 Contracts 里、照样阻断**；
//   · 被删的不许悄悄回来，被降级的不许悄悄升回去（升回去要改这里并说明理由）；
//   · B1 / B2 折入 ESLint 与 dependency-cruiser 的规则具备内存正反变异单测（违规必红、合法全绿、删任一选择器必漏报变红、受控白名单锁死不扩散）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { ESLint, Linter } from 'eslint'
import { builtinRules } from 'eslint/use-at-your-own-risk'
import tseslint from 'typescript-eslint'

import depCruiserConfig from '../.dependency-cruiser.mjs'
import {
  ADOPTION_BRIDGE_EXEMPT_FILES,
  ADOPTION_BRIDGE_SELECTORS,
  E2E_LAUNCH_OWNER,
  E2E_LAUNCH_SELECTORS,
  LLM_SDK_BAN_SELECTORS,
  LLM_STREAM_OWNER_FILES,
  LLM_STREAM_OWNER_SELECTORS,
  OUTBOUND_ENV_ESCAPE_SELECTORS,
  OUTBOUND_ERROR_LAUNDERING_SELECTORS,
  PRIVATE_HOST_IMPORT_OWNERS,
  PRODUCTION_GENERATE_NODE_HOMES,
  RUN_GENERATION_NODE_HOMES,
} from '../eslint.config.mjs'
import { parseGateArgs } from './run-gates-contracts.mjs'
import {
  FROZEN_JUDGMENT_HOMES,
  MODEL_IDENTITY_FROZEN_ALLOWLIST,
  SCRIPT_NETWORK_RETRY_OWNER_FILES,
} from './t8-structural-guards.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const { gates, advisory } = parseGateArgs(pkg.scripts['gates:contracts'].split(/\s+/).slice(5))

const B2_RETIRED_GATES = [
  'check:mjs-parse',
  'check:llm-stream-owner',
  'check:model-availability',
  'check:model-identity',
  'check:adoption-bridge',
  'check:outbound-policy',
  'check:e2e-launch',
  'check:script-network-retry',
  'check:batch-machines',
]

const B2_DELETED_FILES = [
  'scripts/check-mjs-parse.mjs',
  'scripts/check-mjs-parse.node-test.mjs',
  'scripts/check-llm-stream-owner.mjs',
  'scripts/check-llm-stream-owner.node-test.mjs',
  'scripts/check-model-availability.mjs',
  'scripts/check-model-availability.node-test.mjs',
  'scripts/check-model-identity.mjs',
  'scripts/model-identity-baseline.json',
  'scripts/check-adoption-bridge.mjs',
  'scripts/check-adoption-bridge.test.mjs',
  'scripts/check-outbound-policy.mjs',
  'scripts/outbound-policy-baseline.json',
  'scripts/check-e2e-launch.mjs',
  'scripts/check-script-network-retry.mjs',
  'scripts/check-script-network-retry.node-test.mjs',
  'scripts/check-batch-machines.mjs',
  'scripts/check-batch-machines.test.mjs',
  'scripts/batch-machines-baseline.json',
]

// 账本里「真问题」的门岗。check:test-types 现在由 typecheck 编排器并发带起（见 scripts/typecheck.node-test.mjs），
// 所以在名单里以 typecheck 的身份出现。
const REAL_PROBLEM_GATES = [
  'typecheck', // 含 check:test-types（生产 tsc x3 + 测试类型棘轮）
  'check:filesize',
  'check:walkthroughs',
  'check:design-lab',
  'lint:ci',
  'check:test-waits',
  'check:vocabularies',
  'check:icon-semantics',
  // 纸面类里仍保留的两道：合同（只对 schema 阻断）/ PR 正文与先查别人（原 check:prior-art 于 2026-11-23 T-8 并入 check:pr-judgement）。概念写口 check:concept-owners 2026-10-02 降为警告档、2026-10-19 用户拍板「改回挡合并」，见下方 REAL_PROBLEM_GATES 的末项
  'check:root-cause-contracts',
  'check:pr-judgement',
  // 2026-10-19 用户拍板「改回挡合并（推荐）」：advisory 档下未登记边界从 37 攒到 121 而无人被拦，必须阻断
  'check:concept-owners',
]

test('账本里真问题的门岗：全都还在 PR 的 Contracts 里，且不是 advisory', () => {
  for (const gate of REAL_PROBLEM_GATES) {
    assert.ok(gates.includes(gate), `${gate} 不在 gates:contracts 里了`)
    assert.ok(!advisory.has(gate), `${gate} 被降成 advisory 了——账本里它抓到过真问题`)
  }
})

test('被删的门岗不许悄悄回来：docs-index / doc-status / ledger 与 door-map 不在 PR 的 Contracts 里，脚本本身还在（docs-autosync 要用）', () => {
  for (const removed of [
    'check:docs-index', 'check:doc-status', 'check:ledger', 'check:door-map',
    'check:research-sources', 'check:symptom-cluster', 'check:archetype-defaults',
    'check:archetype-sources', 'check:standard-formats', 'check:dependency-capabilities',
    'check:main-console', 'check:renderer-sync-ipc', 'check:builtin-vendor-literals',
    'check:prior-art', 'check:canvas-edge-writers', 'check:cla-workflow',
    'check:transport-assembly', 'check:run-task-grant', 'check:asset-evidence',
    ...B2_RETIRED_GATES,
  ]) {
    assert.ok(!gates.includes(removed), `${removed} 回到了 gates:contracts`)
  }
  for (const kept of ['check:docs-index', 'check:doc-status', 'check:ledger']) {
    assert.ok(pkg.scripts[kept], `${kept} 的脚本不该删：docs-autosync 还要用`)
  }
  for (const gone of [
    'check:research-sources', 'check:symptom-cluster', 'check:archetype-defaults',
    'check:archetype-sources', 'check:standard-formats', 'check:dependency-capabilities',
    'check:i18n-dead-keys', 'check:audit', 'check:mcp-legacy-entry', 'check:handoff',
    'check:main-console', 'check:renderer-sync-ipc', 'check:builtin-vendor-literals',
    'check:prior-art', 'check:canvas-edge-writers', 'check:cla-workflow',
    'check:transport-assembly', 'check:run-task-grant', 'check:asset-evidence',
    ...B2_RETIRED_GATES,
  ]) {
    assert.equal(pkg.scripts[gone], undefined, `${gone} 已按门岗清理 / T-8 / SM-gates 收口删除，不许悄悄回来`)
  }
  for (const siteSub of ['data', 'editorial', 'pricing', 'links', 'locales', 'schema', 'descriptions', 'attribution']) {
    assert.equal(pkg.scripts[`check:site-${siteSub}`], undefined, `check:site-${siteSub} 已并进 check:site`)
  }
  assert.equal(pkg.scripts['check:door-map'], undefined, 'check:door-map 已并入 check:root-cause-contracts')
  for (const file of [
    'scripts/check-door-map.mjs', 'scripts/door-map-lib.mjs', 'scripts/check-cla-workflow.node-test.mjs',
    'scripts/check-transport-assembly.mjs', 'scripts/check-run-task-grant.mjs',
    'scripts/check-run-task-grant.node-test.mjs', 'scripts/check-asset-evidence.mjs',
    'scripts/asset-evidence-baseline.json',
    ...B2_DELETED_FILES,
  ]) {
    assert.ok(!fs.existsSync(path.join(repoRoot, file)), `${file} 应该已删除（P1：不留并行版）`)
  }
  // 生成门表的脚本与模型状态单一主人规则留着
  assert.ok(fs.existsSync(path.join(repoRoot, 'scripts/door-map.mjs')))
  assert.ok(fs.existsSync(path.join(repoRoot, 'scripts/model-status-one-home.mjs')))
})

test('降为提示的：advisory 名单是空的（concept-owners 2026-10-19 用户拍板改回挡合并；再降级要用户拍板并在这里写清理由）', () => {
  assert.deepEqual([...advisory].sort(), [])
})

test('Ponytail 已整套删除：脚本、模式开关、延后账本、check 与 review:branch 都不在了', () => {
  for (const file of ['scripts/ponytail-review-branch.mjs', 'scripts/ponytail-review-hook.mjs', 'scripts/check-ponytail-deferred.mjs', 'docs/engineering/ponytail-mode.json']) {
    assert.ok(!fs.existsSync(path.join(repoRoot, file)), file + ' 应该已删除（用合并前独立验收代替）')
  }
  assert.ok(!pkg.scripts['review:branch'])
  assert.ok(!gates.includes('check:ponytail-review'))
})

test('每轮注入的交付账本提醒已从 L0 hook 删掉；gen:ledger / ledger:brief 仍可按需跑', () => {
  const hook = fs.readFileSync(path.join(repoRoot, 'scripts/claude-hooks/self-check.sh'), 'utf8')
  assert.doesNotMatch(hook, /build-delivery-ledger/)
  assert.ok(pkg.scripts['gen:ledger'])
  assert.ok(pkg.scripts['ledger:brief'])
})

test('SM-gates-B1 ESLint 规则：run-task-grant 拦截各类类型断言逃生口，untrustedRendererIpc 仅限 assetsIpc.ts', async () => {
  const eslint = new ESLint({ cwd: repoRoot })
  const grantRule = 'run-task-grant/no-restricted-syntax'
  const untrustedRule = 'asset-untrusted-ipc-owner/no-restricted-syntax'
  const probeFile = 'electron/capabilityCore/b1Probe.ts'

  const blockedGrantCases = [
    'runTask({ vendor: "relay", request: { kind: "text_to_image", prompt: "hi" } });',
    'runTask({ vendor: "relay", request: { kind: "text_to_image", prompt: "hi" } } as unknown);',
    'runTask({ vendor: "relay", request: { kind: "text_to_image", prompt: "hi" } } as unknown as Record<string, unknown>);',
    'deps.runTaskFn({ vendor: "relay", request: { kind: "text_to_image", prompt: "hi" } } satisfies Record<string, unknown>);',
    'runTask(<unknown>{ vendor: "relay", request: { kind: "text_to_image", prompt: "hi" } });',
    'runTask((<unknown>{ vendor: "relay", "request": { kind: "text_to_image", prompt: "hi" } }) as Record<string, unknown>);',
    'runTask(({ vendor: "relay", request: { kind: "text_to_image", prompt: "hi" } } as unknown)!);',
    'deps["runTaskFn"]({ vendor: "relay", request: { kind: "text_to_image", prompt: "hi" } } satisfies Record<string, unknown>);',
    'runTask({ vendor: "relay", request: { kind: "text_to_image", prompt: "hi" } as unknown });',
  ]
  for (const code of blockedGrantCases) {
    const [result] = await eslint.lintText(code, { filePath: probeFile })
    assert.ok(
      result.messages.some((m) => m.ruleId === grantRule && m.severity === 2),
      `应被 ${grantRule} 拦截：${code}`,
    )
  }

  const allowedGrantCases = [
    'runTask({ vendor: "relay", request: { kind: "text_to_image", prompt: "hi" }, extras: { grantId: "g1" } } as unknown as Record<string, unknown>);',
    'deps.runTaskFn({ vendor: "relay", request: { kind: "text_to_image", prompt: "hi" }, grantId: "g1" } satisfies Record<string, unknown>);',
    'runTask(payload as unknown as Record<string, unknown>);',
    'deps.runTaskFn(payload satisfies Record<string, unknown>);',
    'runTask(<unknown>payload);',
  ]
  for (const code of allowedGrantCases) {
    const [result] = await eslint.lintText(code, { filePath: probeFile })
    assert.ok(
      !result.messages.some((m) => m.ruleId === grantRule),
      `不应误伤合法写法：${code}`,
    )
  }

  const blockedUntrustedCases = [
    'importRemoteAsset(payload, { untrustedRendererIpc: true });',
    'importRemoteAsset(payload, { "untrustedRendererIpc": true });',
    'opts.untrustedRendererIpc = true;',
    'opts["untrustedRendererIpc"] = true;',
  ]
  for (const code of blockedUntrustedCases) {
    const [result] = await eslint.lintText(code, { filePath: 'electron/connectors/b1Probe.ts' })
    assert.ok(
      result.messages.some((m) => m.ruleId === untrustedRule && m.severity === 2),
      `非 assetsIpc.ts 应被 ${untrustedRule} 拦截：${code}`,
    )
  }

  const [ipcResult] = await eslint.lintText(
    'importRemoteAsset(payload, { assertCurrent, untrustedRendererIpc: true });',
    { filePath: 'electron/assets/assetsIpc.ts' },
  )
  assert.ok(!ipcResult.messages.some((m) => m.ruleId === untrustedRule), 'assetsIpc.ts 应允许 untrustedRendererIpc')

  const [evidenceResult] = await eslint.lintFiles([path.join(repoRoot, 'electron/assets/assetSourceEvidence.ts')])
  assert.ok(!evidenceResult.messages.some((m) => m.ruleId === untrustedRule), 'assetSourceEvidence.ts 类型声明不应被误伤')
})

/**
 * 变异证明工具：验证选择器数组 SELECTORS 中的**每一条**选择器都不是死分支——
 * 完整选择器集必抓对应探针 probe[i]，而一旦删掉第 i 条选择器，probe[i] 立即漏网（0 报错）。
 */
function assertEverySelectorNecessary(label, selectors, probesByIndex) {
  assert.equal(
    selectors.length,
    probesByIndex.length,
    `${label} 选择器条数（${selectors.length}）与一一对应变异探针数（${probesByIndex.length}）必须严格相等`,
  )
  const linter = new Linter({ configType: 'flat' })
  const noRestrictedSyntax = builtinRules.get('no-restricted-syntax')
  for (let i = 0; i < selectors.length; i += 1) {
    const code = probesByIndex[i]
    const fullHits = linter.verify(code, [{
      files: ['**/*.ts'],
      languageOptions: { parser: tseslint.parser, ecmaVersion: 2022, sourceType: 'module' },
      plugins: { probe: { rules: { 'no-restricted-syntax': noRestrictedSyntax } } },
      rules: { 'probe/no-restricted-syntax': ['error', ...selectors] },
    }], 'probe.ts')
    assert.ok(fullHits.length > 0, `${label}[${i}] 完整选择器集应命中探针：${code}`)

    const mutated = selectors.filter((_, idx) => idx !== i)
    const mutatedHits = linter.verify(code, [{
      files: ['**/*.ts'],
      languageOptions: { parser: tseslint.parser, ecmaVersion: 2022, sourceType: 'module' },
      plugins: { probe: { rules: { 'no-restricted-syntax': noRestrictedSyntax } } },
      rules: { 'probe/no-restricted-syntax': ['error', ...mutated] },
    }], 'probe.ts')
    assert.equal(
      mutatedHits.length,
      0,
      `${label}[${i}] 删掉后探针仍被其它选择器覆盖（存在冗余或映射错位）：${selectors[i].selector} :: ${code}`,
    )
  }
}

test('SM-gates-B2 锁死受控主人白名单、package.json 禁包与 dependency-cruiser 禁边不扩散', () => {
  // 1) package.json 全依赖字段禁回流 ai / @ai-sdk/*
  const bannedDeps = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
    .flatMap((field) => Object.keys(pkg[field] ?? {}).filter((name) => name === 'ai' || name.startsWith('@ai-sdk/')))
  const bannedOverrides = Object.keys(pkg.pnpm?.overrides ?? {}).filter((name) => name === 'ai' || name.startsWith('@ai-sdk/'))
  assert.deepEqual([...bannedDeps, ...bannedOverrides], [], 'package.json 禁止重新引入 ai 或 @ai-sdk/*')

  // 2) e2e-launch 与 script-network-retry 附带的 4 个单测已并入 test:eng-system
  for (const suite of [
    './scripts/e2e-launch-capability.node-test.mjs',
    './scripts/launch-build-gate.node-test.mjs',
    './tests/ux/_walkInstances.node-test.mjs',
    './scripts/lib/transientRetry.node-test.mjs',
  ]) {
    assert.ok(pkg.scripts['test:eng-system'].includes(suite), `test:eng-system 缺少 ${suite}`)
  }

  // 3) 全部受控白名单精确锁死（新增豁免必须改这里并经评审）
  assert.deepEqual([...LLM_STREAM_OWNER_FILES], [
    'electron/agentLane/laneModelCall.mts',
    'electron/agentLane/laneModelProvider.mts',
    'electron/agentLane/laneProviderGuard.mts',
  ])
  assert.deepEqual([...ADOPTION_BRIDGE_EXEMPT_FILES], ['src/workbench/timeline/addAssetToTimeline.ts'])
  const addAssetSource = fs.readFileSync(path.join(repoRoot, 'src/workbench/timeline/addAssetToTimeline.ts'), 'utf8')
  const addAssetCalls = addAssetSource.match(/\baddTimelineClipAtFrame\s*\(/g) ?? []
  assert.ok(addAssetCalls.length <= 2, `addAssetToTimeline.ts 的 addTimelineClipAtFrame 调用数超出冻结上限 2（实际 ${addAssetCalls.length}）`)

  assert.deepEqual([...PRIVATE_HOST_IMPORT_OWNERS], [
    'electron/networkHostPolicy.ts',
    'electron/networkOutboundPolicy.ts',
    'electron/integrationCertification/httpConnector.ts',
    'electron/systemProxy.ts',
  ])
  assert.equal(E2E_LAUNCH_OWNER, 'tests/ux/_launchApp.mjs')
  assert.deepEqual([...RUN_GENERATION_NODE_HOMES], [
    'src/workbench/generationCanvas/runner/generationRunController.ts',
    'src/workbench/generationCanvas/agent/generationCanvasTools.ts',
    'src/workbench/capability/capabilityApplyHandler.ts',
  ])
  assert.deepEqual([...PRODUCTION_GENERATE_NODE_HOMES], ['electron/productionRun/productionRunE2eFixture.ts'])
  assert.deepEqual([...FROZEN_JUDGMENT_HOMES], [
    'electron/capabilityCore/anchorBible.ts',
    'src/workbench/generationCanvas/model/anchorBibleKeys.ts',
  ])
  assert.deepEqual(Object.keys(MODEL_IDENTITY_FROZEN_ALLOWLIST).sort(), [
    'src/workbench/ai/assistantModelIdentity.ts',
    'src/workbench/api/taskApi.ts',
    'src/workbench/generationCanvas/nodes/controls/archetypeMeta.ts',
    'src/workbench/observability/classifyError.ts',
  ])
  assert.equal(Object.values(MODEL_IDENTITY_FROZEN_ALLOWLIST).flat().length, 5)
  assert.deepEqual([...SCRIPT_NETWORK_RETRY_OWNER_FILES], ['scripts/lib/transientRetry.mjs'])

  // 4) .dependency-cruiser.mjs 两条新增硬零模块边在位且正则精确
  const aiRule = depCruiserConfig.forbidden.find((r) => r.name === 'no-vercel-ai-sdk')
  assert.ok(aiRule, '.dependency-cruiser.mjs 缺少 no-vercel-ai-sdk')
  const aiRe = new RegExp(aiRule.to.path)
  assert.ok(aiRe.test('ai') && aiRe.test('@ai-sdk/openai') && aiRe.test('node_modules/ai/index.js') && aiRe.test('node_modules/@ai-sdk/anthropic/index.js'))
  assert.ok(!aiRe.test('@earendil-works/pi-ai') && !aiRe.test('electron/ai/modelCallBridge.ts'))

  const hostRule = depCruiserConfig.forbidden.find((r) => r.name === 'private-host-classifier-single-owner')
  assert.ok(hostRule, '.dependency-cruiser.mjs 缺少 private-host-classifier-single-owner')
  const hostFromNotRe = new RegExp(hostRule.from.pathNot)
  const hostToRe = new RegExp(hostRule.to.path)
  assert.ok(hostToRe.test('electron/networkHostPolicy.ts'))
  for (const owner of PRIVATE_HOST_IMPORT_OWNERS) assert.ok(hostFromNotRe.test(owner), `${owner} 应豁免`)
  assert.ok(!hostFromNotRe.test('electron/otherCaller.ts'))
})

test('SM-gates-B2 选择器逐条变异证明：删掉任一选择器对应逃生探针立即漏网', () => {
  assertEverySelectorNecessary('LLM_SDK_BAN_SELECTORS', LLM_SDK_BAN_SELECTORS, [
    'export const m = () => import("ai");',
    'export const m = () => import(`@ai-sdk/openai`);',
    'export const m = require("ai");',
    'export const m = require(`@ai-sdk/anthropic`);',
    'import ai = require("ai"); export { ai };',
    'export type M = import("ai").LanguageModelV1;',
    'export * from "ai";',
  ])

  assertEverySelectorNecessary('LLM_STREAM_OWNER_SELECTORS', LLM_STREAM_OWNER_SELECTORS, [
    'export const f = (m: any) => (m as unknown as any).streamSimple();',
    'export const f = (m: any) => m["completeSimple"]();',
    'export const f = (m: any) => m[`streamSimple`]();',
    'export const f = (m: any) => { const { streamSimple } = m; return streamSimple; };',
  ])

  assertEverySelectorNecessary('ADOPTION_BRIDGE_SELECTORS', ADOPTION_BRIDGE_SELECTORS, [
    'addTimelineClipAtFrame(clip, "video", 0);',
    '(addTimelineClipAtFrame as unknown as (...args: unknown[]) => void)(clip, "video", 0);',
    'store.addTimelineClipAtFrame(clip, "video", 0);',
    'store[`addTimelineClipAtFrame`](clip, "video", 0);',
    'const { addTimelineClipAtFrame: writeClip } = store;',
  ])

  assertEverySelectorNecessary('OUTBOUND_ENV_ESCAPE_SELECTORS', OUTBOUND_ENV_ESCAPE_SELECTORS, [
    'export const x = process.env.LAB_ALLOW_LOCALHOST;',
    'export const x = process.env["ALLOW_PRIVATE_NET"];',
    'export const x = process.env[`DISABLE_SSRF`];',
    'const { ALLOW_LOCALHOST } = process.env; export { ALLOW_LOCALHOST };',
  ])

  assertEverySelectorNecessary('OUTBOUND_ERROR_LAUNDERING_SELECTORS', OUTBOUND_ERROR_LAUNDERING_SELECTORS, [
    'export const msg = (err: any) => err?.message || "生成失败";',
    'export const msg = (err: any) => err?.message ?? `Unknown error`;',
    'export const msg = (err: any) => err?.message || ("请求失败" as string);',
    'export const msg = (err: any) => err?.message ?? (<string>`Generation failed`);',
    'export const msg = (err: any) => err?.message ? err.message : "拉取结果失败";',
    'export const msg = (err: any) => !err?.message ? `出错了` : err.message;',
    'export const msg = (err: any) => err?.message ? err.message : ("Something went wrong" as const);',
    'export const msg = (err: any) => !err?.message ? (`Request failed` satisfies string) : err.message;',
  ])

  assertEverySelectorNecessary('E2E_LAUNCH_SELECTORS', E2E_LAUNCH_SELECTORS, [
    'export const go = (electron: any) => electron.launch({});',
    'export const go = (_electron: any) => _electron["launch"]({});',
    'export const go = (electron: any) => electron[`launch`]({});',
    'export const go = (electron: any) => { const { launch } = electron; return launch; };',
  ])
})

test('SM-gates-B2 全量真实 ESLint 配置内存正反单测（9 道退役门岗逐一验红与验绿）', async () => {
  const eslint = new ESLint({ cwd: repoRoot })
  const errorsOf = async (filePath, code) => {
    const [res] = await eslint.lintText(code, { filePath: path.join(repoRoot, filePath) })
    return res.messages.filter((m) => m.severity === 2)
  }

  // ── B2-1: mjs-parse（unicode-bom + transport-spike 纳管 + 语法错误 / 重复声明必红）──
  assert.equal(await eslint.isPathIgnored(path.join(repoRoot, 'tests/transport-spike/probe.mjs')), false)
  assert.equal(await eslint.isPathIgnored(path.join(repoRoot, 'tests/transport-spike/probe.cjs')), false)
  for (const bomFile of ['scripts/bomProbe.mjs', 'tests/transport-spike/bomProbe.cjs', 'electron/bomProbe.ts']) {
    const hits = await errorsOf(bomFile, '\uFEFF#!/usr/bin/env node\nexport const ok = 1;\n')
    assert.ok(hits.some((m) => m.ruleId === 'unicode-bom'), `${bomFile} 含 UTF-8 BOM 应被 unicode-bom 拦截`)
  }
  const spikeSyntaxErr = await errorsOf('tests/transport-spike/badSyntax.mjs', 'const broken = {\n')
  assert.ok(spikeSyntaxErr.some((m) => m.fatal), 'transport-spike 语法错必红')
  const spikeDupEsm = await errorsOf('tests/transport-spike/dup.mjs', 'const X = 1\nconst X = 2\nexport { X }\n')
  assert.ok(spikeDupEsm.some((m) => m.ruleId === 'no-redeclare'), 'transport-spike ESM 重复声明必红')
  const spikeDupCjs = await errorsOf('tests/transport-spike/dup.cjs', 'const fs = require("node:fs")\nconst X = 1\nconst X = 2\nmodule.exports = { fs, X }\n')
  assert.ok(spikeDupCjs.some((m) => m.ruleId === 'no-redeclare'), 'transport-spike CJS 重复声明必红')
  const spikeCleanCjs = await errorsOf('tests/transport-spike/clean.cjs', 'const fs = require("node:fs")\nmodule.exports = { ok: Boolean(fs) }\n')
  assert.deepEqual(spikeCleanCjs, [], '干净的 transport-spike CJS 必须全绿')

  // ── B2-2: llm-stream-owner（禁 ai/@ai-sdk/* + 禁非主人 .streamSimple/.completeSimple）──
  for (const badImport of [
    'import { streamText } from "ai"; export { streamText };',
    'import type { LanguageModelV1 } from "ai"; export type X = LanguageModelV1;',
    'import { createOpenAI } from "@ai-sdk/openai"; export { createOpenAI };',
    'export const load = () => import("@ai-sdk/anthropic");',
    'export const r = require("ai");',
    'export type T = import("ai").LanguageModelV1;',
    'export * from "ai";',
  ]) {
    const hits = await errorsOf('electron/ai/rogueSdk.ts', badImport)
    assert.ok(
      hits.some((m) => m.ruleId?.startsWith('llm-sdk-ban/')),
      `应拦截已卸载 SDK 引用：${badImport}`,
    )
  }
  for (const badStream of [
    'export const f = (models: any, m: any, c: any) => models.streamSimple(m, c);',
    'export const f = (models: any, m: any, c: any) => (models as unknown as any).completeSimple(m, c);',
    'export const f = (models: any, m: any, c: any) => models["streamSimple"](m, c);',
    'export const f = (models: any) => { const { completeSimple } = models; return completeSimple; };',
  ]) {
    const hits = await errorsOf('electron/ai/rogueCall.ts', badStream)
    assert.ok(
      hits.some((m) => m.ruleId === 'llm-stream-owner/no-restricted-syntax'),
      `非主人文件应拦截单次流式直调：${badStream}`,
    )
  }
  for (const ownerFile of LLM_STREAM_OWNER_FILES) {
    const hits = await errorsOf(ownerFile, 'export const f = (models: any, m: any, c: any) => models.streamSimple(m, c);\n')
    assert.ok(!hits.some((m) => m.ruleId === 'llm-stream-owner/no-restricted-syntax'), `${ownerFile} 主人应放行`)
  }

  // ── B2-3: model-availability（CREDENTIAL && PUBLICATION 并入 nomi/model-status-one-home）──
  const availRed = await errorsOf('src/workbench/ai/rogueAvail.ts', 'export const ok = (m: any, v: any) => m.published && v.hasApiKey;\n')
  assert.ok(availRed.some((m) => m.ruleId === 'nomi/model-status-one-home'))
  const availGreen = await errorsOf('src/workbench/ai/okAvail.ts', 'export const ok = (m: any) => m.availability.usable && m.kind === "text";\n')
  assert.ok(!availGreen.some((m) => m.ruleId === 'nomi/model-status-one-home'))

  // ── B2-4: model-identity（裸 modelKey/modelAlias 必带 vendor；冻结文件内多加 1 处照样必红）──
  for (const badIdentity of [
    'export interface PlanShot { modelKey: string; prompt: string }',
    'export type BareLiteral = { ["modelKey"]: string }',
    'export type BareTemplate = { [`modelAlias`]: string }',
    'export function recordHealth(modelKey: string, now?: number) { return [modelKey, now]; }',
    'export const pick = (modelKey = "gpt-5") => modelKey;',
    'export function untypedDestructure({ modelKey }) { return modelKey; }',
  ]) {
    const hits = await errorsOf('src/workbench/rogueIdentity.ts', badIdentity)
    assert.ok(
      hits.some((m) => m.ruleId === 'model-identity-vendor/require-vendor'),
      `应拦截裸 modelKey/modelAlias：${badIdentity}`,
    )
  }
  for (const goodIdentity of [
    'export interface PlanShot { modelVendor: string; modelKey: string }',
    'export type Paired = { vendorKey: string; modelKey: string }',
    'export function recordHealth(vendor: string, modelKey: string) { return [vendor, modelKey]; }',
  ]) {
    const hits = await errorsOf('src/workbench/goodIdentity.ts', goodIdentity)
    assert.ok(!hits.some((m) => m.ruleId === 'model-identity-vendor/require-vendor'), `配对 vendor 不应误伤：${goodIdentity}`)
  }
  const realAssistantIdentity = fs.readFileSync(path.join(repoRoot, 'src/workbench/ai/assistantModelIdentity.ts'), 'utf8')
  const frozenOk = await errorsOf('src/workbench/ai/assistantModelIdentity.ts', realAssistantIdentity)
  assert.ok(!frozenOk.some((m) => m.ruleId === 'model-identity-vendor/require-vendor'), '受控存量原文件应全绿')
  const frozenGrown = await errorsOf(
    'src/workbench/ai/assistantModelIdentity.ts',
    `${realAssistantIdentity}\nexport type RogueExtra = { modelKey: string }\n`,
  )
  assert.ok(
    frozenGrown.some((m) => m.ruleId === 'model-identity-vendor/require-vendor'),
    '受控文件内再多加 1 处裸 modelKey 必须当场报红（非整文件盲豁免）',
  )

  // ── B2-5: adoption-bridge（禁绕过 Proposal 直调 addTimelineClipAtFrame）──
  for (const target of [
    'src/workbench/generationCanvas/rogueAdopt.ts',
    'src/workbench/timeline/TimelineRogueTrack.tsx',
    'src/workbench/preview/roguePreviewAdopt.ts',
  ]) {
    const hits = await errorsOf(target, 'export const go = (s: any, c: any) => s["addTimelineClipAtFrame"](c, "video", 0);\n')
    assert.ok(hits.some((m) => m.ruleId === 'adoption-bridge/no-restricted-syntax'), `${target} 直写时间轴必红`)
  }
  const adoptOwnerHits = await errorsOf(
    'src/workbench/timeline/addAssetToTimeline.ts',
    'export const go = (s: any, c: any) => s.addTimelineClipAtFrame(c, "video", 0);\n',
  )
  assert.ok(!adoptOwnerHits.some((m) => m.ruleId === 'adoption-bridge/no-restricted-syntax'))

  // ── B2-6: outbound-policy（env 逃生口 + isPrivateHost 唯一主人 + 错误洗白字面量）──
  const envEscapeHits = await errorsOf('electron/rogueOutbound.ts', 'export const allow = process.env["ALLOW_LOCALHOST"];\n')
  assert.ok(envEscapeHits.some((m) => m.ruleId === 'outbound-env-escape/no-restricted-syntax'))

  for (const badHostImport of [
    'import { isPrivateHost } from "./networkHostPolicy"; export { isPrivateHost };',
    'export const load = async () => { const { isPrivateHost } = await import("./networkHostPolicy"); return isPrivateHost; };',
    'export type Check = typeof import("./networkHostPolicy").isPrivateHost;',
  ]) {
    const hits = await errorsOf('electron/rogueHostCheck.ts', badHostImport)
    assert.ok(hits.some((m) => m.ruleId?.startsWith('outbound-private-host-owner/')), `非主人引 isPrivateHost 必红：${badHostImport}`)
  }
  const hostOwnerHits = await errorsOf('electron/networkOutboundPolicy.ts', 'import { isPrivateHost } from "./networkHostPolicy"; export { isPrivateHost };\n')
  assert.ok(!hostOwnerHits.some((m) => m.ruleId?.startsWith('outbound-private-host-owner/')))

  for (const badLaunder of [
    'export const f = (e: any) => e?.message || "生成失败";',
    'export const f = (e: any) => (e?.message ?? ("Unknown error" as string));',
    'export const f = (e: any) => e?.message ? e.message : `拉取结果失败`;',
    'export const f = (e: any) => !e?.message ? "Something went wrong" : e.message;',
  ]) {
    const hits = await errorsOf('electron/rogueLaunder.ts', badLaunder)
    assert.ok(hits.some((m) => m.ruleId === 'outbound-error-laundering/no-restricted-syntax'), `错误洗白必红：${badLaunder}`)
  }
  const localeGreen = await errorsOf('src/i18n/locales/probe.ts', 'export const dict = { fallback: "" || "生成失败" };\n')
  assert.ok(!localeGreen.some((m) => m.ruleId === 'outbound-error-laundering/no-restricted-syntax'))
  const commentGreen = await errorsOf('src/workbench/observability/opaqueFailure.ts', '// error.message || "生成失败"\nexport const ok = 1;\n')
  assert.ok(!commentGreen.some((m) => m.ruleId === 'outbound-error-laundering/no-restricted-syntax'))

  // ── B2-7: e2e-launch（禁直接调 electron.launch / _electron.launch）──
  for (const target of ['tests/ux/rogue.walk.mjs', 'evals/rogue.mjs', 'scripts/rogueWalk.mjs']) {
    const hits = await errorsOf(target, 'export const start = (_electron) => _electron["launch"]({});\n')
    assert.ok(hits.some((m) => m.ruleId === 'e2e-launch/no-restricted-syntax'), `${target} 直调 electron.launch 必红`)
  }
  const launcherGreen = await errorsOf('tests/ux/_launchApp.mjs', 'export const start = (electron) => electron.launch({});\n')
  assert.ok(!launcherGreen.some((m) => m.ruleId === 'e2e-launch/no-restricted-syntax'))

  // ── B2-8: script-network-retry（scripts/ 裸 gh / git 网络 / 控制面裸 fetch 必红）──
  for (const badScript of [
    'import { execFileSync } from "node:child_process"; execFileSync("gh", ["pr", "view"]);',
    'import { execFileSync } from "node:child_process"; export const go = (opts, args) => execFileSync(opts.bin ?? "gh", args);',
    'import { execFileSync } from "node:child_process"; execFileSync("git", ["fetch", "origin"]);',
    'import { execSync } from "node:child_process"; execSync("git ls-remote origin");',
    'const API = "https://api.github.com"; await fetch(`${API}/repos`);',
    'const API = "https://api.github.com"; export async function f({ fetchImpl }) { return fetchImpl(API); }',
    'const API = "https://api.github.com"; export async function f({ fetchImpl = fetch }) { return [API, fetchImpl]; }',
    'const API = "https://api.cloudflare.com/client/v4/x"; export const send = [API, globalThis["fetch"]];',
  ]) {
    const hits = await errorsOf('scripts/rogueNet.mjs', badScript)
    assert.ok(
      hits.some((m) => m.ruleId === 'script-network-retry/require-transient-retry'),
      `scripts/ 绕过瞬断重试必红：${badScript}`,
    )
  }
  for (const goodScript of [
    'import { execGhReadSync } from "./lib/transientRetry.mjs"; execGhReadSync(["pr", "view"]);',
    'import { retryTransientSync } from "./lib/transientRetry.mjs"; import { execFileSync } from "node:child_process"; retryTransientSync(() => execFileSync("gh", ["pr", "view"]));',
    'import { execFileSync } from "node:child_process"; execFileSync("git", ["rev-parse", "HEAD"]);',
    'import { fetchWithRetry } from "./lib/transientRetry.mjs"; const API = "https://api.github.com"; export const run = (fetchImpl) => fetchWithRetry(API, {}, { fetchImpl });',
    'await fetch("http://127.0.0.1:8188/queue");',
  ]) {
    const hits = await errorsOf('scripts/goodNet.mjs', goodScript)
    assert.ok(
      !hits.some((m) => m.ruleId === 'script-network-retry/require-transient-retry'),
      `合法脚本不应误报：${goodScript}`,
    )
  }
  const retryOwnerGreen = await errorsOf('scripts/lib/transientRetry.mjs', 'import { execFileSync } from "node:child_process"; execFileSync("gh", ["pr", "view"]);\n')
  assert.ok(!retryOwnerGreen.some((m) => m.ruleId === 'script-network-retry/require-transient-retry'))

  // ── B2-9: batch-machines（runGenerationNode / production.generate-node / frozen.at>0 / second-scope-home）──
  const rogueBatch = await errorsOf('src/workbench/generationCanvas/rogueMachine.ts', 'export const go = (runGenerationNode: any, id: string) => (runGenerationNode as any)(id);\n')
  assert.ok(rogueBatch.some((m) => m.ruleId === 'batch-renderer-submit/no-restricted-syntax'))
  const memberNotBatch = await errorsOf('src/workbench/generationCanvas/notMachine.ts', 'export const go = (ctrl: any, id: string) => ctrl.runGenerationNode(id);\n')
  assert.ok(!memberNotBatch.some((m) => m.ruleId === 'batch-renderer-submit/no-restricted-syntax'))

  const rogueDurable = await errorsOf('electron/productionRun/rogueDriver.ts', 'export const op = `production.generate-node`;\n')
  assert.ok(rogueDurable.some((m) => m.ruleId === 'batch-durable-submit/no-restricted-syntax'))
  const durableFixture = await errorsOf('electron/productionRun/productionRunE2eFixture.ts', 'export const op = "production.generate-node";\n')
  assert.ok(!durableFixture.some((m) => m.ruleId === 'batch-durable-submit/no-restricted-syntax'))

  for (const badFrozen of [
    'export const isFrozen = (meta: any) => { const mark = meta.frozen; return typeof mark.at === "number" && mark.at > 0; };',
    'export const isFrozen = (meta: any) => Number.isFinite(meta.frozen?.at) && 0 < (meta.frozen["at"] as number);',
  ]) {
    const hits = await errorsOf('src/workbench/generationCanvas/rogueFrozen.ts', badFrozen)
    assert.ok(hits.some((m) => m.ruleId === 'batch-frozen-judgment/single-frozen-judgment'), `第三份冻结判据必红：${badFrozen}`)
  }
  for (const goodFrozen of [
    'export const notFrozenRule = (meta: any) => meta.referenceSheet === true;',
    'export const readOnly = (node: any) => node.meta?.frozen;',
    '// const mark = meta.frozen; if (typeof mark.at === "number" && mark.at > 0) return true;\nexport const ok = 1;',
  ]) {
    const hits = await errorsOf('src/workbench/generationCanvas/goodFrozen.ts', goodFrozen)
    assert.ok(!hits.some((m) => m.ruleId === 'batch-frozen-judgment/single-frozen-judgment'))
  }
  for (const home of FROZEN_JUDGMENT_HOMES) {
    const hits = await errorsOf(home, 'export const isFrozen = (meta: any) => { const mark = meta.frozen; return typeof mark.at === "number" && mark.at > 0; };\n')
    assert.ok(!hits.some((m) => m.ruleId === 'batch-frozen-judgment/single-frozen-judgment'))
  }

  for (const badScope of [
    'export function buildDependencyWaves(ids: string[]) { return ids; }',
    'export const eligibleGenerationNodeIds = (nodes: unknown[]) => nodes;',
    'export const pushWave = (waves: string[][], w: string[]) => waves["push"](w);',
  ]) {
    const hits = await errorsOf('src/workbench/generationCanvas/rogueScope.ts', badScope)
    assert.ok(hits.some((m) => m.ruleId === 'generation-scope-one-home/no-restricted-syntax'), `第二份范围算法必红：${badScope}`)
  }
  const propWavesGreen = await errorsOf('src/workbench/generationCanvas/okScope.ts', 'export const append = (state: any, extra: any) => state.plan.waves.push(extra);\n')
  assert.ok(!propWavesGreen.some((m) => m.ruleId === 'generation-scope-one-home/no-restricted-syntax'))
})
