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

/**
 * 节点编辑器（R-B6 拦的那一侧）：画布生成框本体、参数控件、提示词工具、参考槽入口、节点写口。
 * 只列会**画出可改的东西或写节点**的模块；读节点的纯函数（参数取值 `controls/parameterControlModel`、比例读法
 * `aspectRatio`、模型身份……）不在此列——聊天卡片读节点正是 D2 的设计（一个东西一个家，卡只读）。
 */
export const NODE_EDITOR_MODULES = Object.freeze([
  // 生成框本体（画布 / 内嵌两种宿主）与文本节点的生成框
  'NodeGenerationComposer', 'LazyNodeGenerationComposer', 'TextNodeComposer',
  // 参数控件：参数面板、摘要 pill（点开就是参数面板）、参考槽入口
  'NodeParameterControls', 'InlineParameterBar', 'NodeInputReferenceEntry',
  // 提示词工具（优化 / 翻译 / 工具簇）
  'NodePromptToolCluster', 'NodePromptOptimizer', 'NodePromptTranslator',
  // 节点写口（旧卡的写口范围挂在这里）与参考槽写法
  'nodeWriteAccess', 'controls/referenceWrites',
])
const NODE_EDITOR_PATH = `^src/workbench/generationCanvas/nodes/(?:(?:${NODE_EDITOR_MODULES.join('|')})\\.tsx?|controls/[^/]+\\.tsx)$`

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
      // 设计实验室的 agent 通路归 R-B5 单独管（硬零，无 baseline）：它是 2026-09-06 起
      // 「UI 交付 = 实验室截图拍板 + 视觉基线绿」的那条通路，不该继承渲染层那 74 条历史欠账的豁免。
      // devlab 本身仍留在 R-B1 之外（它此前整个不在扫描范围内，见 options.exclude 的注释）——
      // 现存的 `catalogLiveness/states/01-listing.tsx -> electron/catalog/*` 三条是被这次纳扫
      // **照出来**的存量欠账，不是本 PR 新增的；把它们塞进 baseline 就是把基线抬高，所以不塞，
      // 留给「catalog 目录哪几个模块该搬进 shared」那次单独收（见 R-B5 注释末尾）。
      from: { path: '^src/', pathNot: '^src/devlab/' },
      to: { path: '^electron/', pathNot: '^electron/shared/' },
    },

    // R-B5 设计实验室只许吃中立契约层（当前 0，硬零，无 baseline）。
    //
    // 起因是一次真的白屏（#614）：`laneDrivenFixtures.ts` import 了主进程的
    // `electron/agentLane/laneProjection.mts`，而那个模块当时**运行时** import `@earendil-works/pi-ai`，
    // 于是整个 pi SDK（含它内部那条 CJS 的 `partial-json`）被拖进浏览器 bundle，实验室页面挂掉，
    // 只能靠 `vite.config.ts` 的 `optimizeDeps` 兜一层。止血贴治的是症状——一个人下次再
    // import 一个主进程实现文件，同样的白屏会以另一个包的名义回来（P2）。
    // 这条规则治的是那条边：实验室与渲染层同一条 bundle，能进浏览器的只有 `electron/shared/`。
    //
    // `import type` 不在此列：类型编译后一行不剩，devlab 直接 `import type` pi 的快照形状
    // 是它作为「新通路第一个消费者」的本分。所以规则靠 dependency-cruiser 的
    // `dependencyTypesNot: ['type-only']` 把纯类型边放掉，只拦**值导入**。
    //
    // `to` 只列 agent 那三个实现目录，不是整个 `electron/` 去掉 shared：把它纳扫的第一跑
    // 照出了三条存量欠账（`catalogLiveness/states/01-listing.tsx` 值导入 `electron/catalog/`
    // 的 apimartTexts / seedModelIdentity / modelListReconcile）。那三条要么改实验室、要么把
    // catalog 那几个模块搬进 shared，都不是本 PR 的范围；而把它们写进 baseline 等于抬高基线。
    // 所以这条规则今天先在 agent 通路上立成**硬零**，catalog 那三条另开一单收——
    // 一条今天就能守住的硬零，好过一条永远红着没人看的宽规则（R17）。
    {
      name: 'devlab-no-import-electron-impl',
      comment:
        '设计实验室（src/devlab/）只许 import src/ 与中立契约层 electron/shared/。主进程 agent 实现目录（agentLane / harness / projectAgentHost）禁止值导入——它们会把 pi SDK 等主进程依赖拖进浏览器 bundle。当前零违规，硬零。',
      severity: 'error',
      from: { path: '^src/devlab/' },
      to: {
        path: '^electron/(agentLane|harness|projectAgentHost)/',
        pathNot: '^electron/shared/',
        dependencyTypesNot: ['type-only'],
      },
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

    // R-B6 聊天卡片不许引用节点编辑器（当前 0，硬零，无 baseline；设计系统 §1.0「卡上一个可改的东西都没有」）。
    //
    // 2026-09-10 到 2026-10-24 之间，Agent 付费卡里装着一整件画布生成框（`NodeGenerationComposer host="panel"`）：
    // 卡上能改模型、参数、参考，于是节点与卡各存一份、两边拉锯——卡上改的冲掉节点上用户的改动、卡上看到的不是发出去的，
    // 一串根因合同（docs/fixes/2026-10-02-card-revise-merge-rule 起）。D2 第③步起卡只读节点（指向元素 + 一行只读摘要），想改就点指向元素
    // 去节点里改。这条规则从结构上拦住它长回去：Agent 面板（`src/workbench/ai/`：聊天卡片、指向元素、面板外壳、输入框）
    // 不许 import 节点编辑器（`NODE_EDITOR_MODULES`）。纯类型导入也拦：类型住在编辑器里，就说明卡在照编辑器的形状长。
    // 反例单测：scripts/check-boundaries.chat-card.test.mjs。
    {
      name: 'chat-card-no-import-node-editor',
      comment:
        'Agent 面板（src/workbench/ai/）不许 import 节点编辑器（画布生成框、参数控件、提示词工具、参考槽入口、节点写口）。卡只读节点，改去节点里改。当前零违规，硬零。',
      severity: 'error',
      from: { path: '^src/workbench/ai/' },
      to: { path: NODE_EDITOR_PATH },
    },

    // R-B7 渲染层的依赖图里不许有仓库自己的 CJS 文件（当前 0，硬零，无 baseline）。
    //
    // 和 #614 同一类白屏：#614 是主进程实现把一条 CJS 依赖拖进浏览器；这回是 `electron/shared/` 的模块直接 import 了
    // 一个 CJS 生成物，靠 `vite.config.ts` 里的别名换成 ESM 才跑得起来，而浏览器单测的夹具不读那份配置
    // （`configFile: false`），页面一起白屏。别名只修得了一个入口，所以不让 CJS 进这张图。
    // `reachable` 看整条传递路径：经 `electron/shared/`、经基线里冻结的越界边走到，都算。
    // 反例单测：scripts/check-boundaries.renderer-cjs.test.mjs。
    {
      name: 'renderer-no-reach-local-cjs',
      comment:
        '渲染层（src/）的依赖图里不许有仓库自己的 CJS 文件：浏览器不认 CJS，靠打包配置换格式只修得了一个入口。把用它的代码搬到主进程一侧，或生成 ESM。',
      severity: 'error',
      from: { path: '^src/' },
      to: { path: '^(?:src|electron)/.*\\.cjs$', reachable: true },
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
      // 只扫生产码：剔除测试 / testSupport / dev。
      // **devlab 不再剔除**（2026-09-08，阶段 4 前置 ④）：自 2026-09-06 起「UI 交付 = 设计实验室
      // 截图拍板 + 视觉基线绿」，实验室就是生产 UI 的取景台，和渲染层进同一条 bundle——
      // 把它排除在门岗之外，等于让唯一一条能把主进程依赖拖进浏览器的路没人看着（#614 白屏）。
      path: '(node_modules|\\.test\\.|\\.node-test\\.|/testSupport/|/dev/)',
    },
  },
}
