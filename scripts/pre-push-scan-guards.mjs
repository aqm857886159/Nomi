// 「扫全仓 / 扫目录的守卫测试」在推送前钩子这边的去向（2026-10-10，同一天漏 4 个：#1156 offLedgerEgress.structure、#1142 fileIdentity /
// mcpClientRegistry / check-network-entry）。
//
// 为什么会漏：推送前的「相关单测」只挑「引用了改动文件」的测试（见 pre-push-related-tests.mjs）。类守卫自己遍历源码、对全集做断言，
// 不引用具体文件——有人在 electron/ 里新增一个违规文件，守卫红，可是没有任何测试「引用」那个新文件，所以本机全绿、到 CI 才红（每次白耗约 40 分钟）。
// 补法不是逐个把漏掉的登记上（只修这一处），而是：
//   · 本表是这类测试的唯一登记处；每条写明「它扫哪些目录」，改到这些目录才跑（SCAN_GUARDS → pre-push-contracts.mjs 的批量门岗 test:scan-guards）；
//   · 跑不进推送前的写进 SCAN_GUARD_CI_ONLY（附理由）；识别器的误判写进 NOT_SOURCE_SCANS（附理由）；
//   · 识别（语法树，scripts/lib/scanGuardDetect.mjs）+ 核对（scanGuardProblems）在 scripts/pre-push-structure.node-test.mjs 里：
//     以后新写的扫全仓测试，既没进本表、也没被别的门岗覆盖，那个结构测试直接红——不靠记性。
//
// 单跑耗时来自 2026-10-10 在 Windows 本机逐个 `vitest run <文件>` 的实测（含 vitest 起进程的 2–3 秒）；> 20 秒的不进推送前。

import path from 'node:path'

import { scanEvidence } from './lib/scanGuardDetect.mjs'
import { implementationFiles } from './pre-push-gate-inputs.mjs'

/** 默认只看代码类扩展名；扫非代码文件（技能 md、站点 html、json 夹具）的守卫在条目里写 exts: '*'。 */
const CODE_EXTS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs']
const ELECTRON = ['electron']
const SRC = ['src']
const WORKBENCH = ['src/workbench']
/** 测试样式文件（.test. / .spec.）与 vitest 配置：scripts/vitest-lanes.test.ts 遍历全仓找它们。 */
const TEST_STYLE_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$|^vitest(?:\.\w+)?\.config\.[cm]?[jt]s$/

/**
 * 推送前跑的扫描型守卫。字段：
 *   file   测试文件（唯一键）；.node-test.mjs 用 node:test 跑，其余用 vitest；
 *   roots  它实际遍历的目录（实测：给 fs.readdirSync 打桩记录，不是读代码猜的）；改到这些目录下的文件就跑；
 *   exts   这些目录里哪些扩展名算输入（默认代码类；'*' = 任意）；
 *   files  额外读的固定文件；match 额外的路径正则；all 为 true = 扫整个仓库（git grep），除 docs/ 外任何改动都跑。
 * 测试自己和它的相对 import 闭包被改，也会选中它（pre-push-contracts.mjs 的 touchesImplementation，不用在这里写）。
 */
export const SCAN_GUARDS = Object.freeze([
  // ── electron/ 全树（遍历 electron 找违规文件）──
  { file: 'electron/offLedgerEgress.structure.test.ts', roots: ELECTRON }, // #1156：新增 child_process 出网口没登记（5 秒）
  { file: 'electron/fileIdentity.test.ts', roots: ELECTRON }, // #1142：不许手写 dev / ino 比较（2 秒）
  { file: 'scripts/check-network-entry.test.mjs', roots: ELECTRON }, // #1142：Node 网络调用必须走共用传输；扫描器 scripts/check-network-entry.mjs 在闭包里（6 秒）
  { file: 'electron/shared/mcpClientRegistry.test.ts', roots: ['src', 'electron'] }, // #1142：不许手抄客户端清单（4 秒）
  { file: 'electron/capabilityCore/spendDoorSingleOwner.test.ts', roots: ELECTRON }, // 5 秒
  { file: 'electron/capabilityCore/mcpMigrationEntry.test.ts', roots: ['src', 'electron'] }, // #1142 合入后新增：MCP 宿主迁移入口只有登记的调用点（3 秒）
  { file: 'electron/catalog/modelListReconcile.test.ts', roots: ELECTRON }, // 3 秒
  { file: 'electron/catalog/storedApiKeyReaders.test.ts', roots: ELECTRON }, // 3 秒
  { file: 'electron/catalog/vendorAuthSpecReadPaths.test.ts', roots: ELECTRON }, // 5 秒
  { file: 'electron/nativeDialogParent.invariant.test.ts', roots: ELECTRON }, // 4 秒
  { file: 'electron/productionRun/landFirstOneAdmission.test.ts', roots: ELECTRON }, // 6 秒
  { file: 'electron/settings/sideBySideInstallSeed.test.ts', roots: ELECTRON }, // 3 秒
  { file: 'electron/update/installGate.structure.test.ts', roots: ELECTRON }, // 2 秒
  { file: 'electron/durability.test.ts', roots: ['electron', 'src', 'scripts', 'tests'] }, // 只有测试 harness 能翻成 ephemeral：四个根目录都扫（9 秒）
  { file: 'electron/providerAdapter/architecture.test.ts', roots: ['electron/providerAdapter'] }, // 2 秒
  { file: 'electron/capabilityCore/projectAgentProposalReceiptStore.test.ts', roots: ['electron/capabilityCore/__fixtures__/published-receipts'], exts: '*' }, // 回放已发布收据夹具目录（2 秒）
  { file: 'tests/ux/model-access-journeys/inventory.test.mjs', roots: ['electron/shared/modelArchetypes'] }, // 模型接入生产清单（2 秒）
  { file: 'electron/skills/builtinSkills.test.ts', roots: ['skills'], exts: '*', files: ['package.json'] }, // 4 秒
  { file: 'electron/skills/skillFrontmatter.test.ts', roots: ['skills'], exts: '*' }, // 4 秒
  { file: 'electron/catalog/curatedVideoSharedContracts.test.ts', all: true, exts: '*' }, // git grep 全仓找「已知缺口」豁免记号（docs/ 除外）；记号可以出现在任何文件里
  // ── src/ 全树 ──
  { file: 'src/bundleAssetUrlBoundary.test.ts', roots: SRC },
  { file: 'src/customEventWiring.test.ts', roots: SRC },
  { file: 'src/design/mediaOverlayInk.test.ts', roots: SRC },
  { file: 'src/design/menu.structure.test.ts', roots: SRC },
  { file: 'src/design/portalLayer.structure.test.ts', roots: SRC },
  { file: 'src/ui/browser/assetSurfaceInvariants.test.ts', roots: SRC }, // 7 秒
  { file: 'src/workbench/common/modelSelectStructure.test.ts', roots: SRC }, // 7 秒
  { file: 'src/workbench/generation/dockCollapsePrefs.test.ts', roots: SRC }, // 4 秒
  { file: 'src/workbench/generationCanvas/model/derivedOutput.test.ts', roots: SRC }, // 12 秒
  { file: 'src/workbench/generationCanvas/nodes/ToolbarActionMenu.structure.test.ts', roots: SRC },
  { file: 'src/workbench/generationCanvas/nodes/mediaPlaceholderShimmer.test.ts', roots: SRC },
  { file: 'src/workbench/generationCanvas/runner/assetUploadConsentRouting.test.ts', roots: SRC }, // 5 秒
  { file: 'scripts/viteOptimizeDeps.test.mjs', roots: SRC }, // 4 秒
  { file: 'scripts/build-tailwind.test.ts', roots: SRC, exts: [...CODE_EXTS, 'css', 'html'], files: ['tailwind.config.ts'] }, // 跑一次 tailwind content 扫描（12 秒）
  { file: 'src/workbench/project/projectActionIssuance.contract.test.ts', roots: ['src', 'electron'] }, // 13 秒
  { file: 'src/assets/vendor-logos/vendorLogos.test.ts', roots: ['src/assets/vendor-logos', 'src/config', 'src/design', 'src/ui', 'src/workbench'] },
  // ── src/workbench 及以下 ──
  { file: 'src/workbench/generationCanvas/components/canvasViewportMovers.structure.test.ts', roots: WORKBENCH }, // 5 秒
  { file: 'src/workbench/generationCanvas/nodes/fencedCanvas.invariant.test.ts', roots: WORKBENCH },
  { file: 'src/workbench/generationCanvas/store/canvasReadyOwner.test.ts', roots: WORKBENCH }, // 12 秒
  { file: 'src/workbench/generationCanvas/components/canvasControlsStructure.test.ts', roots: ['src/workbench/generationCanvas'] }, // 4 秒
  { file: 'src/workbench/generationCanvas/reactFlow/canvasViewportScale.test.ts', roots: ['src/workbench/generationCanvas'] },
  { file: 'src/workbench/generationCanvas/nodes/nodeInnerScrollNoWheel.test.ts', roots: ['src/workbench/generationCanvas/nodes'] },
  { file: 'src/workbench/generationCanvas/quickActions/deriveFromNode.noMoneyDoor.test.ts', roots: ['src/workbench/generationCanvas/quickActions'] },
  { file: 'src/workbench/generationCanvas/nodes/director/model/planOverrides.guard.test.ts', roots: ['src/workbench/generationCanvas/nodes/director/model'] },
  { file: 'src/workbench/generationCanvas/nodes/director/panels/inspector/crowdEntry.structure.test.ts', roots: ['src/workbench/generationCanvas/nodes/director/panels/inspector'] },
  { file: 'src/workbench/creation/storyboard/storyboardTableReach.structure.test.ts', roots: ['src/workbench/creation/storyboard'] },
  { file: 'src/workbench/timeline/timelineGesture.structure.test.ts', roots: ['src/workbench/timeline', 'src/workbench/generationCanvas/nodes', 'src/workbench/preview'] },
  // ── 脚本 / 走查 / 站点 / 测试清单 ──
  { file: 'scripts/agent-runtime-wiring.test.mjs', roots: ['tests/agent-runtime'], files: ['electron/tsconfig.json', 'tests/agent-runtime/tsconfig.json'] }, // 11 秒
  { file: 'scripts/marketing/serving-contract.test.mjs', roots: ['marketing'], exts: '*', files: ['wrangler.json'] },
  { file: 'scripts/vitest-lanes.test.ts', match: TEST_STYLE_FILE }, // 全仓每个测试样式文件都必须被某条车道认领；vitest.config.ts 在闭包里
  { file: 'tests/ux/_launchApp.test.mjs', roots: ['tests/ux', 'scripts'], exts: ['mjs'] }, // 每个字面凭据夹具都显式声明隔离合成存储（3 秒）
  { file: 'tests/ux/_paidRun.test.mjs', roots: ['tests/ux'], exts: ['mjs'] }, // 每个 *.paid.mjs 都走 openPaidWalk 或在例外表里
  { file: 'tests/ux/storyboard-editor-entry.test.mjs', roots: ['tests/ux'], exts: ['mjs'] }, // 走查不许自己点方案行进编辑器，只经 openStoryboardEditor（1 秒）
  { file: 'tests/ux/design-lab/labFailureTriage.test.mjs', roots: ['tests/ux'], exts: ['mjs'] }, // 每份设计实验室走查入口认领角色、不写死端口
])

/**
 * 扫描型守卫但不放进推送前的：{ reason, files }。理由只认「推送前真跑不了 / 太慢」，不认「懒得接」。
 */
export const SCAN_GUARD_CI_ONLY = Object.freeze([
  {
    reason: '编译车道（test:agent-runtime：tsc -p tests/agent-runtime → .tmp → node --test）：推送前入口不做 tsc 编译，改用 tsx 直跑实测 lane-open-graph 8 条里 5 条红、skill-catalog-migration 24 条里 2 条红（路径按编译产物目录写死），跑了也只会假红',
    files: ['tests/agent-runtime/lane-open-graph.test.mts', 'tests/agent-runtime/skill-catalog-migration.test.mts'],
  },
])

/**
 * 同一份全仓扫描已经由推送前的某道门岗在本机跑了：{ 测试文件: 那道门岗名 }。门岗名必须真在 PRE_PUSH_GATES 里（结构测试核对）。
 */
export const SCAN_GUARD_COVERED_BY_GATE = Object.freeze({
  // 单跑 31 秒；它测的正是 check:nul-bytes 门岗对真仓库的扫描，那道门岗推送前总跑（本机约 3 秒）
  'scripts/check-source-nul-bytes.test.ts': 'check:nul-bytes',
})

/**
 * 识别器认成「扫描型」、其实不是对仓库源码做全集断言的测试：{ 测试文件: 理由 }。每条必须真被识别器认到（否则是陈旧项，结构测试红）。
 */
export const NOT_SOURCE_SCANS = Object.freeze({
  'scripts/eng-metrics.node-test.mjs': '测指标脚本：readContracts 喂的是测试自建的临时 docs/fixes 夹具（运行时实测没有遍历仓库目录）',
  'scripts/check-site-attribution.node-test.mjs': '测站点扫描函数：喂测试自建的夹具目录（运行时实测没有遍历仓库目录）；站点整体检查是 CI_ONLY 的 check:site',
  'scripts/check-site-descriptions.node-test.mjs': '同 check-site-attribution：站点扫描函数的夹具单测',
  'scripts/check-site-editorial.node-test.mjs': '同 check-site-attribution：站点扫描函数的夹具单测',
  'scripts/check-site-links.node-test.mjs': '同 check-site-attribution：站点扫描函数的夹具单测',
  'scripts/check-site-locales.node-test.mjs': '同 check-site-attribution：站点扫描函数的夹具单测',
  'scripts/check-site-pricing.node-test.mjs': '同 check-site-attribution：站点扫描函数的夹具单测',
  'scripts/check-site-schema.node-test.mjs': '同 check-site-attribution：站点扫描函数的夹具单测',
  'tests/ux/feel-policy.test.mjs': '测 feel-nightly 的收集函数：喂 makeTempDir 建的夹具目录',
})

/** 推送前里这一项的名字（pre-push-contracts.mjs 的 SCAN_TESTS 里有它）：所有登记的守卫在一个 vitest 进程里批量跑。 */
export const SCAN_GUARDS_GATE = 'test:scan-guards'

/** 这次改动要不要跑这个守卫（扫的目录里有改动）。 */
export function touchesScanGuard(guard, changedFiles) {
  const exts = guard.exts === '*' ? null : (guard.exts ?? CODE_EXTS)
  return changedFiles.map((file) => file.split(path.win32.sep).join('/')).some((file) => {
    if (guard.files?.includes(file)) return true
    if (guard.match?.test(file)) return true
    const ext = path.posix.extname(file).slice(1)
    if (exts !== null && !exts.includes(ext)) return false
    if (guard.all) return !file.startsWith('docs/')
    return (guard.roots ?? []).some((dir) => file === dir || file.startsWith(`${dir}/`))
  })
}

/**
 * 核对账：仓库里每个「扫描型守卫测试」都必须有去处。返回问题列表（空 = 通过）。
 * input：
 *   root           仓库根（临时副本里测用）
 *   testFiles      被 git 跟踪的测试文件（相对路径）
 *   scanTests      推送前 SCAN_TESTS 已登记的测试文件集合（含 SCAN_GUARDS 派生的）
 *   gateScripts    gates:contracts 里每道门的 package.json 命令文本（拼成一段）
 *   gateImplFiles  这些门岗命令引用的脚本及其 import 闭包
 *   prePushGates   推送前门岗名集合（核对 COVERED_BY_GATE 指向的门真在推送前）
 *   guards / ciOnly / covered / notScans  本文件四张表（测试里可换成夹具）
 */
export function scanGuardProblems({ root, testFiles, scanTests, gateScripts, gateImplFiles, prePushGates, guards = SCAN_GUARDS, ciOnly = SCAN_GUARD_CI_ONLY, covered = SCAN_GUARD_COVERED_BY_GATE, notScans = NOT_SOURCE_SCANS, detect = scanEvidence }) {
  const problems = []
  const evidence = new Map()
  for (const file of testFiles) {
    const found = detect(file, root)
    if (found.length > 0) evidence.set(file, found)
  }
  const ciOnlyFiles = ciOnly.flatMap((group) => group.files)
  const declared = [
    ['SCAN_GUARDS', guards.map((guard) => guard.file)],
    ['SCAN_GUARD_CI_ONLY', ciOnlyFiles],
    ['SCAN_GUARD_COVERED_BY_GATE', Object.keys(covered)],
    ['NOT_SOURCE_SCANS', Object.keys(notScans)],
  ]
  // 每个文件至多声明一次
  const counts = new Map()
  for (const [table, files] of declared) for (const file of files) counts.set(file, [...(counts.get(file) ?? []), table])
  for (const [file, tables] of counts) if (tables.length > 1) problems.push(`${file}：同时声明在 ${tables.join(' 和 ')} 里，只能一处`)
  // 陈旧项：声明了却不再是扫描型 / 文件没了
  const tracked = new Set(testFiles)
  for (const [table, files] of declared) {
    for (const file of files) {
      if (!tracked.has(file)) problems.push(`${table}：${file} 不是被跟踪的测试文件（改名或删除了？）`)
      else if (!evidence.has(file)) problems.push(`${table}：${file} 不再被识别为扫描型守卫（陈旧项，删掉这一条）`)
    }
  }
  for (const [file, gate] of Object.entries(covered)) if (!prePushGates.has(gate)) problems.push(`SCAN_GUARD_COVERED_BY_GATE：${file} 指向的 ${gate} 不是推送前门岗`)
  for (const group of ciOnly) if (!group.reason || String(group.reason).length < 12) problems.push(`SCAN_GUARD_CI_ONLY：${group.files.join('、')} 缺理由`)
  for (const [file, reason] of Object.entries(notScans)) if (!reason || String(reason).length < 8) problems.push(`NOT_SOURCE_SCANS：${file} 缺理由`)
  for (const guard of guards) {
    if (/\.node-test\.[cm]?[jt]s$/.test(guard.file)) problems.push(`SCAN_GUARDS：${guard.file} 是 node:test 文件，批量门岗目前只跑 vitest；要登记 node:test 守卫先给 SCAN_TESTS 加 node 批`)
    if (!guard.all && !(guard.roots?.length) && !(guard.files?.length) && !guard.match) problems.push(`SCAN_GUARDS：${guard.file} 没写它扫哪些目录（roots / files / match / all）`)
  }
  // 未登记：识别为扫描型、又没有任何去处
  const declaredFiles = new Set(counts.keys())
  for (const [file, found] of evidence) {
    if (declaredFiles.has(file) || scanTests.has(file)) continue
    const direct = found.some((item) => item.file === file)
    if (direct && gateScripts.includes(file)) continue // 测试本身就写在某道 gates:contracts 门岗的命令里，那道门岗的去向已在门表声明
    if (!direct && found.every((item) => gateImplFiles.has(item.file))) continue // 间接扫描，扫描器就是某道已声明门岗的实现，同一份扫描由那道门岗在真仓库上跑
    const where = [...new Set(found.map((item) => `${item.file}:${item.line}（${item.kind}）`))].slice(0, 3).join('、')
    problems.push(`${file}：扫描型守卫测试没有去处——它遍历仓库源码并对全集断言（${where}），而推送前的「相关单测」只挑引用了改动文件的测试，新增违规文件挑不中它、CI 才红。` +
      '处理：在 scripts/pre-push-scan-guards.mjs 登记进 SCAN_GUARDS（写明它扫哪些目录，改到才跑）；单跑 > 20 秒或本机跑不了就进 SCAN_GUARD_CI_ONLY（写理由）；识别器误判进 NOT_SOURCE_SCANS（写理由）')
  }
  return problems
}

/** 门岗命令里引用的脚本及其 import 闭包（给 scanGuardProblems 的 gateImplFiles）。 */
export function gateImplementation(scriptTexts, root, exists) {
  const refs = new Set()
  for (const text of scriptTexts) for (const match of String(text).matchAll(/[A-Za-z0-9_./-]+\.(?:mjs|cjs|js|ts)\b/g)) {
    const ref = match[0].replace(/^\.\//, '')
    if (exists(ref)) refs.add(ref)
  }
  return implementationFiles([...refs], root)
}
