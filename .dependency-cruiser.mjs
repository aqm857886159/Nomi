// dependency-cruiser 规则集 —— check:boundaries 门岗的唯一真源（R21）。
//
// 这份文件只声明「禁止哪些方向的依赖」。存量违规的冻结名单在
// scripts/boundaries-baseline.json，差集逻辑在 scripts/check-boundaries.mjs。
// 分工：规则=方向禁令（本文件）；基线=存量身份（json）；棘轮=差集报红（check 脚本）。
//
// 为什么规则住这里而不是内联进 check 脚本：这是 dependency-cruiser 的标准配置文件，
// 想手动 debug 时 `pnpm exec depcruise --config .dependency-cruiser.mjs src electron`
// 能直接复用同一套规则，不会和门岗漂移。
//
// 依赖方向的分层背景见 docs/architecture/module-ownership-map.md 与
// docs/audit/2026-08-31-architecture-coupling-audit.md（分析二/五）。

/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    // R-B1 渲染层不得直捅主进程。
    // 存量 131 条（62 type-only + 51 value）先由 baseline 冻结、只减不增。
    // 中立契约层 electron/shared/（renderer+main 都可合法 import；实现型主进程模块仍禁止直捅）。
    {
      name: 'src-no-import-electron',
      comment:
        '渲染层（src/）不得直接 import 主进程（electron/）。走 desktop bridge 或中立契约层。存量见 boundaries-baseline.json，只减不增。',
      severity: 'error',
      from: { path: '^src/' },
      to: { path: '^electron/', pathNot: '^electron/shared/' },
    },

    // R-B2 主进程不得反向 import 渲染层（当前 0，硬零，无 baseline）。
    {
      name: 'electron-no-import-src',
      comment: '主进程（electron/）禁止反向 import 渲染层（src/）。当前零违规，硬零。',
      severity: 'error',
      from: { path: '^electron/' },
      to: { path: '^src/' },
    },

    // R-B3 UI 不得捅门岗脚本（当前 0，硬零，无 baseline）。
    {
      name: 'src-no-import-scripts',
      comment: '渲染层（src/）禁止 import 门岗脚本（scripts/）。当前零违规，硬零。',
      severity: 'error',
      from: { path: '^src/' },
      to: { path: '^scripts/' },
    },

    // R-B4 禁新增「完全静态」循环。
    // viaOnly dependencyTypesNot=[dynamic-import,type-only]：只认「每条环边都不是懒加载、
    // 也不是纯类型」的硬环——即真·加载顺序风险。软的 499 个 lazy import() 环故意不入规则，
    // 避免门岗永红被无视（R17 教训：被忽略的门岗等于不存在）。存量 37 个硬环由 baseline 冻结。
    {
      name: 'no-new-static-circular',
      comment:
        '禁止新增完全静态循环依赖（每条环边都非 dynamic-import / 非 type-only）。存量 37 个硬环见 boundaries-baseline.json，只减不增；软的懒加载环不算。',
      severity: 'error',
      from: {},
      to: {
        circular: true,
        viaOnly: { dependencyTypesNot: ['dynamic-import', 'type-only'] },
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.base.json' },
    // 含 type-only 边（渲染层伸手拿 electron 类型也要拦）；dynamic-import 单独标记以分软硬环。
    tsPreCompilationDeps: true,
    moduleSystems: ['es6', 'cjs'],
    exclude: {
      // 只扫生产码：剔除测试 / testSupport / dev / devlab，与审计范围一致。
      path: '(node_modules|\\.test\\.|\\.node-test\\.|/testSupport/|/dev/|/devlab/)',
    },
  },
}
