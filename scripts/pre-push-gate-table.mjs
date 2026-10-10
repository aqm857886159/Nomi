// gates:contracts（CI 的 Contracts job）里每一道门，在推送前钩子这边的去向：只有两种，必须明说——
//   · 推送前跑：它的名字在 pre-push-contracts.mjs 的 PRE_PUSH_GATES / SCAN_TESTS 里（或在下面 PRE_PUSH_ALIASES 里写明由哪个推送前门岗覆盖）；
//   · 只在 CI 跑：必须出现在下面 CI_ONLY，并写明理由。每道门恰好声明一次。
//
// 原则（2026-10-09 协调会话定）：推送前钩子是加速器，CI 才是最终裁判。
//   推送前的目标是「常见改动在本机就红，不用等 40 分钟 CI」；故意绕过不在范围内，靠评审抓。
//   所以这里不追求「语义等价证明」，追求的是：不许有「悄悄只在 CI 跑」的门、选择范围必须从正本派生、部分覆盖必须明说。
//
// 为什么要这张表（2026-10-09 实证）：#1135 / #1133 / #1137 三个 PR 推送前钩子全绿、CI 才红（icon-semantics、store-lifetime、整库 typecheck），
// 每次多一轮约 40 分钟——这些门当时「悄悄只在 CI 跑」，没人声明过。新登记进 gates:contracts 的门若没在这里表态，
// scripts/pre-push-contracts.node-test.mjs 的结构测试直接红（解析 gates:contracts 的完整门列表，不做名字前缀过滤）。
//
// 理由里的耗时来自 2026-10-09 在 Windows 本机逐项实测（pnpm run 单项，机器有其它负载时偏高）。

/** gates:contracts 的项 → 完整覆盖它的推送前门岗名（部分覆盖的不在这里，见 PARTIAL_LOCAL）。 */
export const PRE_PUSH_ALIASES = Object.freeze({
  'check:test-temp-static': { by: 'test:temp-helper', note: '走查 / 测试必须用共享临时目录助手，那条 node test 本身' },
})

/**
 * 只在 CI 跑、但推送前跑了其中一部分的门：{ 门: 推送前跑的那一部分 }。
 * 推送前的输出会把这类门单独点名（「完整版只在 CI 跑，本机只跑了 X」），不用同名别名掩盖只覆盖了一部分。
 */
export const PARTIAL_LOCAL = Object.freeze({
  'check:i18n': { by: 'check:test-copy-literals', note: '完整 check:i18n 本机 22–29 秒（2 个 node 单测 + 5 道检查，其中 2 道要 tsx）；推送前只跑了其中的「测试抄文案」一项' },
  'check:design-lab': { by: 'check:design-lab-mirrors', note: '完整版要 python 锁 + tsc + Playwright 像素比对（本机约 30 秒以上）；推送前只跑纯 node 的结构 + mirrors 行号检查（2–3 秒）' },
  'lint:ci': { by: 'lint:changed', note: '全库 eslint 总警告数只在 CI 数；推送前只查改动文件（警告数不得比 base 多、错误一律拦）' },
})

/** typecheck 不覆盖的目录（没有任何 tsc program 编译它们）：改了这些不会选中 typecheck，诚实标明，不假装覆盖。 */
export const TYPECHECK_NOT_COVERED = Object.freeze([
  'tests/ux/**（.tsx / .ts 走查与夹具）',
  'tests/agent-system/**',
  'evals/**（非 *.test.ts 的文件）',
  'packages/**、workers/**',
  'scripts/**/*.mts、*.cts（只有 *.ts 在 tsconfig.test.json 里）',
])

/** 只在 CI 跑的门及理由。每个门只能出现一次；理由是写给下一个想把它接进来的人看的。 */
export const CI_ONLY = Object.freeze([
  {
    reason: '慢：单项本机 > 15 秒（或 90 秒内跑不完），超出推送前「典型 PR 60 秒内」的预算',
    gates: [
      'check:root-cause-contracts', // > 90 秒（含 54 条合同校验测试）
      'check:claude-hooks', // > 90 秒
      'check:hook-behavior', // > 90 秒
      'check:generation-entrances', // 约 85 秒
      'check:concept-owners', // 约 77 秒，且已被拍板为 advisory
      'check:packaged-deps', // 约 47 秒
      'check:git-delivery', // 约 43 秒
      'check:framework-surface', // 约 41 秒
      'check:secrets', // 约 32 秒（提交时 pre-commit 已扫暂存区）
      'check:main-guard', // 约 27 秒
      'check:boundaries', // 约 24 秒
      'check:i18n', // 22–29 秒（完整版）；推送前只跑其中的抄文案一项，见 PARTIAL_LOCAL
      'check:quality-gate-workflow', // 约 13 秒，且只在改 .github / 校验策略时有意义
      'check:llm-stream-owner', // 本机 11–16 秒：全库四个根目录逐文件解 TS 语法树，几乎每个 PR 都会命中输入范围
      'lint:ci', // 全库 eslint；推送前只查改动文件，见 PARTIAL_LOCAL
    ],
  },
  {
    reason: '要 tsx 运行器（`pnpm exec tsx`）：推送前入口目前只认 node 命令；单项 3–15 秒，是下一批最该接的候选（接法：gateCommands 认 tsx + 在 GATE_INPUTS 里登记各自的输入范围）',
    gates: [
      'check:orphan-cables',
      'check:mcp-payload',
      'check:mcp-scope-reachable',
      'check:mcp-tool-refs',
      'check:skill-tool-binding',
      'check:walkthrough-tool-args',
      'check:credential-origin',
      'check:agent-facing-tool-names',
      'check:tool-face',
      'check:agent-tool-face-usecases',
      'check:reference-contract',
      'check:model-schema',
      'check:release-notes',
    ],
  },
  {
    reason: '要网络 / 浏览器 / 构建产物 / python 锁 / electron 二进制，或随机器环境而变',
    gates: [
      'check:design-lab',
      'check:package-budget',
      'check:feedback-worker',
      'check:e2e-launch',
      'check:site',
      'check:gates-lock', // python3 锁（Windows 上 python3 商店别名会让它假红）
      'check:electron-install', // 要 electron 二进制已下载
    ],
  },
  {
    reason: '2026-10-09 在本机 Windows 上对 main 就是红的（与改动无关）：接进来会拦住所有人的推送，先由协调会话核实是 Windows 专属还是仓库已有问题',
    gates: [
      'check:storyboard-owner',
      'check:mcp-operation-constructible',
      'check:model-face-frozen',
      'check:verb-host-conformance',
      'check:transport-assembly',
      'check:spend-receipt',
    ],
  },
])

/** gates:contracts 脚本里的完整门列表：`run-gates-contracts.mjs` 之后所有不以 `--` 开头的词，不按名字前缀过滤。 */
export function parseContractGates(scriptText) {
  const words = String(scriptText).split(/\s+/).filter(Boolean)
  const runner = words.findIndex((word) => word.endsWith('run-gates-contracts.mjs'))
  if (runner < 0) throw new Error('gates:contracts 里找不到 run-gates-contracts.mjs——解析器需要同步')
  const advisory = words.slice(runner + 1).filter((word) => word.startsWith('--advisory='))
  const gates = words.slice(runner + 1).filter((word) => !word.startsWith('--'))
  return { gates, advisory }
}

/**
 * 声明核对：每道门必须恰好声明一次（推送前 / 别名 / 只在 CI 三选一）。返回问题列表（空 = 通过）。
 * prePushNames：推送前实际会跑的门岗名（PRE_PUSH_GATES + SCAN_TESTS + lint:changed + 正文门岗）。
 */
export function declarationProblems(gates, prePushNames, { aliases = PRE_PUSH_ALIASES, ciOnly = CI_ONLY, partial = PARTIAL_LOCAL } = {}) {
  const problems = []
  const ciOnlyFlat = ciOnly.flatMap((group) => group.gates)
  const unique = [...new Set(gates)]
  for (const gate of unique) {
    const declared = [prePushNames.has(gate), gate in aliases, ciOnlyFlat.includes(gate)].filter(Boolean).length
    if (declared === 0) problems.push(`${gate}：没有声明（加进 PRE_PUSH_GATES / SCAN_TESTS，或在 CI_ONLY 写明理由）`)
    if (declared > 1) problems.push(`${gate}：重复声明（推送前 / 别名 / 只在 CI 只能选一个）`)
  }
  for (const [index, gate] of ciOnlyFlat.entries()) {
    if (ciOnlyFlat.indexOf(gate) !== index) problems.push(`${gate}：在 CI_ONLY 里出现多次`)
    if (!unique.includes(gate)) problems.push(`${gate}：CI_ONLY 里的陈旧项（已不在 gates:contracts）`)
  }
  for (const [gate, { by }] of Object.entries(aliases)) {
    if (!unique.includes(gate)) problems.push(`${gate}：别名里的陈旧项`)
    if (!prePushNames.has(by)) problems.push(`${gate}：别名指向不存在的推送前门岗 ${by}`)
  }
  for (const [gate, { by }] of Object.entries(partial)) {
    if (!ciOnlyFlat.includes(gate)) problems.push(`${gate}：PARTIAL_LOCAL 里的门必须同时是 CI_ONLY（完整版只在 CI 跑）`)
    if (!prePushNames.has(by)) problems.push(`${gate}：PARTIAL_LOCAL 指向不存在的推送前门岗 ${by}`)
  }
  for (const group of ciOnly) if (String(group.reason).length < 10) problems.push(`CI_ONLY 有一组没写理由：${group.gates.join('、')}`)
  return problems
}
