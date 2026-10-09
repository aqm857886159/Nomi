// gates:contracts（CI 的 Contracts job）里每一道门，在推送前钩子这边的去向：只有两种，必须明说——
//   · 推送前跑：它的名字在 pre-push-contracts.mjs 的 PRE_PUSH_GATES / SCAN_TESTS 里（或在下面 PRE_PUSH_ALIASES 里写明由哪个推送前门岗覆盖）；
//   · 只在 CI 跑：必须出现在下面 CI_ONLY，并写明理由。
// 为什么要这张表（2026-10-09 实证）：#1135 / #1133 / #1137 三个 PR 推送前钩子全绿、CI 才红（icon-semantics、store-lifetime、整库 typecheck），
// 每次多一轮约 40 分钟——这些门当时「悄悄只在 CI 跑」，没人声明过。新登记进 gates:contracts 的门若没在这里表态，
// scripts/pre-push-contracts.node-test.mjs 的结构测试直接红，所以以后不会再有「悄悄只在 CI 跑」的门。
//
// 理由里的耗时来自 2026-10-09 在 Windows 本机逐项实测（pnpm run 单项，机器有其它负载时偏高）。

/** gates:contracts 的项 → 覆盖它（部分覆盖也算，写在 note 里）的推送前门岗名。 */
export const PRE_PUSH_ALIASES = Object.freeze({
  'lint:ci': { by: 'lint:changed', note: '只查改动文件，警告数不得比 base 多；全库总警告数留在 CI' },
  'check:i18n': { by: 'check:test-copy-literals', note: '只接了其中的「测试抄文案」一项（3 秒）；其余四项各 6–13 秒且要 tsx，留在 CI' },
  'check:test-temp-static': { by: 'test:temp-helper', note: '走查 / 测试必须用共享临时目录助手，那条 node test 本身' },
})

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
      'check:quality-gate-workflow', // 约 13 秒，且只在改 .github / 校验策略时有意义
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
