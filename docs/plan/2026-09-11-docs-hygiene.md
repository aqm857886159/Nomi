# 卫生 PR：竞品方案包入库 + ARCHITECTURE-NOW 去过时 + 删两个死控制器

> 状态：✅ 已交付（2026-09-11 定稿并实施）

## 范围

三件互不依赖的卫生事项，合成一个 PR：

1. 把桌面上的 `/Users/aoqimin/Desktop/Nomi-竞品研究方案包-20260909/docs/{research,plan,product}` 搬进仓库对应目录，文件名不变，补齐状态标记与索引登记。
2. 修 `docs/ARCHITECTURE-NOW.md` 三行过时描述（Agent 运行时阶段判断、经验沉淀闭环文件、内部 Agent vs MCP 工具定义层现状），全部按当日实核 file:line 改写。
3. 删两个零生产引用的死控制器文件（`canvasTurnController.ts` / `creationTurnController.ts`）+ 其测试，保留一处必要的活测试迁移。

不动项：`creationToolContracts.ts`（活版，仍被 `creationAiReplyText.ts` 使用）；方案包源目录只读，不改动。

## 先查别人

- [`docs/design/nomi-agent-interaction.md:419`](../design/nomi-agent-interaction.md) 的「🔴 删掉重做」拆迁清单点名 `creationTurnController` 那套单独确认路径是与生成区「提议事务 + 对账」并行的第二套写法，判定应删——本 PR 的删除方向与此设计判断一致。核实：该文档实际只点名**一次**（原任务书说「两次」，实核后仅一处，已在报告中如实标注这个偏差）。
- [`docs/plan/2026-09-08-agent-lane-stage4-switch.md`](2026-09-08-agent-lane-stage4-switch.md) 是 #646（pi lane 原子切换）当天的删除清单与承接点账本，确认了 `electron/projectAgentHost/` 与旧运行时随该 PR 一起删除——这是 ARCHITECTURE-NOW.md 两行过时描述（阶段 1 影子期、经验沉淀闭环）的根因背景：#646 已把「影子期」原子切成「唯一通路」，旧宿主整个消失。
- [`docs/plan/2026-09-09-competitive-response-plans/INDEX.md`](2026-09-09-competitive-response-plans/INDEX.md)（方案包自带总索引）确认了这批方案文件之间的依赖关系与开工纪律（「#646 过门之前不开任何新战线」），入库时原样保留、只补状态标记，不改内容判断。

## 实施记录

### ① 方案包入库

- 复制 19 个文件（不含 `.DS_Store`）：research 9 篇、`docs/plan/2026-09-09-agent-native-editing-plan.md` 1 篇、`docs/plan/2026-09-09-competitive-response-plans/` 8 篇（含其自带 `INDEX.md`）、product 3 篇。目标目录与源目录深度一致（都是 `docs/{research,plan,product}` 直接子级），相对链接原样可用。
- 逐个 `test -f`/`test -d` 校验全部相对链接（60 处，排除 http/锚点后）：发现源包自身一处预先存在的死链——`docs/research/2026-09-09-nomi-editing-architecture-analysis.md` 里 `[agent 原生剪辑方案](2026-09-09-agent-native-editing-plan.md)` 少了 `../plan/` 前缀（该文件实际在 `docs/plan/` 不在 `docs/research/`）。已在入库时一并修正为 `../plan/2026-09-09-agent-native-editing-plan.md`。
- 9 个 plan 文件（顶层 1 个 + `competitive-response-plans/` 8 个含 INDEX）前 12 行均缺状态标记，统一补 `> 状态：📋 方案待拍板（2026-09-09 定稿，2026-09-11 归档入库）`（插在标题后、原有 `>` 说明块之前，符合 `scripts/doc-status-lib.mjs` 的 `STATUS_HEAD_LINES=12` 窗口）。
- `pnpm run check:docs-index`：这条门岗在 clean `origin/main` 上本来就是红的（历史存量的大量未登记 evidence/README 文件，与本 PR 无关，已用 `git stash` 验证过 pre-existing）。本 PR 新增文件里唯一被判「未登记」的是 `docs/plan/2026-09-09-agent-native-editing-plan.md`，已在 `docs/plan/INDEX.md` 的「🤖 自动收录」区补一行链接（同时引用了 `competitive-response-plans/INDEX.md` 方便导航）；`competitive-response-plans/` 下的其余 8 个文件因为被同目录的 `INDEX.md` 自引用而已经算「已收录」，无需额外登记。
- `pnpm run check:doc-status`：本来就红（同样是历史存量），本 PR 新增的 9 个 plan 文件全部带了状态标记，未新增违规。
- `pnpm run check:ledger`：绿（`✅ 文档生成物同步：现役欠账 115 篇，共扫描 714 篇方案`）。
- research/product 目录没有独立的 `INDEX.md`（`check:docs-index` 不覆盖这两棵树，只覆盖 `docs/plan/**`、`docs/superpowers/plans/**`、`docs/lessons/**`），故未新建索引文件，符合「不能抬高 baseline」的最小改动原则。

### ② ARCHITECTURE-NOW.md 三行更新

逐条改前先 `sed -n` 实核当前代码行号（部分与任务书给的行号有 1 行漂移，已按实际行号写入）：

- **Agent 运行时**：原「阶段 1 影子期」行改写为「现役 = pi lane」。核实：`electron/projectAgentHost/` 整个目录已不存在（`ls` 报 No such file）；生产 IPC 注册在 `electron/main.ts:403`（`desktopLaneIpc = registerAgentLaneIpc(createDesktopLaneDependencies(...))`，与任务书行号一致）；面板订阅在 `src/workbench/ai/v4/useAgentPanelV4Data.ts:69`（`React.useSyncExternalStore(laneClient.subscribe, ...)`，与任务书行号一致）。（中途曾因分支落后 origin/main 一个 commit，本地一度是 68 行；`git merge origin/main` 追平后恢复到 69 行，已按合并后的最终行号核对写入文档，避免留一个会随 merge 漂移的引用。）
- **经验沉淀闭环**：核实 `electron/projectAgentHost/projectAgentTurnExecution.ts`、`electron/experience/projectAgentExperience.ts` 均已不存在；`experienceExtractor.ts`/`experiencePolicy.ts`/`experienceRepository.ts` 三个文件还在，但 `grep -rl` 全仓确认零生产调用者，只剩各自的单测——已标 `⚠️ 随 #646 退役，待重接`，不再声称闭环仍在跑。
- **内部 Agent vs MCP**：原「没有共享的工具定义层」判断已不成立。核实 `electron/shared/agentCapabilities/modelFacingToolRegistry.ts:92` 的 `modelFacingToolSpecs()` 是内部（lane）与外部（MCP）共用的唯一注册表，按 `spec.profiles` 声明投影；改写时顺带发现原有的两处领域函数调用点引用（`applyCanvasToolCall.ts:595`、`capabilityApplyHandler.ts:543` 调 `sendStoryboardToTimeline.ts:77`）已经行号漂移+函数改名（实际是 `applyCanvasToolCall.ts:674`、`capabilityApplyHandler.ts:716` 调 `arrangeStoryboardToTimeline`，定义在 `sendStoryboardToTimeline.ts:84`），一并修正。仍存在的两处未收编例外原样保留标注：`electron/agentLane/laneModelRead.mts:5` 的第二份 `nomi_read`、`electron/capabilityCore/mcpGenerationToolCatalog.ts:59-134` 手写的五个生成工具。

### ③ 删两个死文件

- `grep -rn` 全仓确认：`canvasTurnController.ts` 与 `creationTurnController.ts` 均**零生产引用**。
- `creationTurnController.ts` 情况与任务书假设一致：只被 `creationTurnController.test.ts`（自测试）和 `creationMessageIdentity.test.ts`（纯测 `nextMessageId`，不涉及其他任何活代码）引用，三个文件一并删除。
- `canvasTurnController.ts` 情况比任务书假设复杂一步：除了 `laneDesktopStructure.test.ts:111` 的「禁止导入」结构守卫外，还被 `agentTurnMutations.test.ts` 引用——但这个测试文件**不是** `canvasTurnController` 的自测试，它测的是仍然存活的生产函数 `applyCanvasToolCall`/`applyProposalBatch`（`canvasWriteTarget.ts` 里两处仍在生产调用），只是拿 `useCanvasTurnStore` 当一个方便的 turn-handle 构造器。核实生产侧（`canvasWriteTarget.ts:255`、`:448`）早已改用内联 `{ canWrite: () => assertExecutionCurrent(request) }`，根本不经 `canvasTurnController`——说明这个 store 确实是死的，但删它不能连带删掉仍有价值的测试覆盖。处理：删 `canvasTurnController.ts` 本体，把 `agentTurnMutations.test.ts` 里的 `import { useCanvasTurnStore } from './canvasTurnController'` 换成测试本地构造的同款 store（`create<AgentTurnState>((set, get) => createAgentTurnState(set, get))`，和原文件里的写法逐字一致），保留全部既有断言与覆盖率，只是不再依赖一个只为它而活着的死模块。
- 结构守卫 `laneDesktopStructure.test.ts` 的「keeps retired area turn controllers out of the production import graph」用例本身不会因文件删除而失效（它断言的是**其他**生产文件不导入这两个名字，不是这两个文件本身的内容），但按任务书要求「保持守卫意义」，追加了两条 `expect(exists(...)).toBe(false)`，让这条测试同时确认文件真的已经不在了，而不只是「没人导入一个可能仍存在的文件」。
- 验证：`pnpm run typecheck` 全绿；`pnpm run check:filesize` 门岗通过（几个基线以下的文件是历史存量瘦身，与本次改动无关）；`npx vitest run src/workbench/creation src/workbench/generationCanvas/agent electron/agentLane/laneDesktopStructure.test.ts` 全绿（70 个测试文件 / 715+ 用例）。

## 回滚

三块互相独立，任一块出问题可以单独 revert 对应的文件改动，不影响另外两块。

## 验收门

- `pnpm run typecheck` 绿
- `pnpm run check:filesize` 绿
- 相关 vitest 套件绿
- `python3 scripts/with-gates-lock.py -- pnpm run gates` 全绿后再 push
