# 2026-08-24 测试系统审计

## 结论先说

最新远端基线不是“缺测试”，而是“测试很多、分层已经成形，但缺少一套可持续的质量信号和统一执行入口”。

- 最新 `origin/main`：`dd376785`（2026-08-23）。在干净 sibling worktree `/Users/aoqimin/Desktop/Nomi-latest-main` 实测：`694` 个测试文件通过、`1` 个跳过；`6137` 个断言通过、`1` 个跳过；总耗时约 `36.57s`。
- 同一基线用 V8 覆盖率实测：statements `68.63%`、branches `60.86%`、functions `68.66%`、lines `71.70%`。
- 构建与 Electron smoke 也实测通过：`pnpm run build` 成功（有既存 chunk-size/dynamic-import warning），`pnpm run test:e2e` 通过 `14` 条断言。
- 当前主工作树 `/Users/aoqimin/Desktop/Nomi` 有未解决 merge conflict（例如 `electron/catalog/apimartVideos.ts`、`electron/catalog/archetypeWireDefaults.generated.ts`、`src/config/modelArchetypes/index.ts`）。在这份工作树直接跑测试会产生 `146` 个 failed suite，其中大量是 transform 失败，不应拿来评价测试质量；本审计以最新干净基线为准。
- 当前工作树新增的 APIMart H3/Seedance 真实 E2E 有一条很好的协议契约单测（`electron/catalog/apimartSeedance25H3.test.ts`），但它的真实脚本 `tests/ux/apimart-seedance25-h3.e2e.mjs` 仍直接调用 `electron.launch`，并有 `1500ms` 固定等待与 `10s` 轮询；与 `task-center.walk.mjs`、`toolbar-order.walk.mjs` 一起会让 `pnpm run check:e2e-launch` 失败（3 处 direct launch）。这不是最新 `origin/main` 的问题，而是当前工作树合并前必须收口的分支回归。
- 本轮已把这 3 个脚本统一改为 `tests/ux/_launchApp.mjs` 入口；当前分支的 `pnpm run check:e2e-launch` 已通过，三个文件也通过 `node --check`。其中 H3 的 provider 轮询仍保留，因为它是外部任务完成信号，不应与启动等待混为一谈；后续再把它迁到可观测的任务状态等待。

## 现状地图

| 层 | 当前事实 | 判断 |
|---|---|---|
| Vitest 单元/集成 | `696` 个 `*.test.*` 文件；electron `345`、src `334`、evals `3`、scripts `11`、tests `3` | 规模足够，主要风险从“没有测试”转为“重复/慢/低信号” |
| Electron/UI 走查 | `tests/ux` 有 `145` 个 `walk/e2e/visual/static` 脚本，另有 `167` 个 `.mjs` | 行为覆盖广，但不在一个 Playwright project/fixture runner 下统一治理 |
| 能力矩阵 | `tests/system/capabilities.json` 声明 `22` 能力、`normal/boundary/failure/persistence` 四维 | 方向正确；仍有空白维度（如 `node.panorama-whiteboard` 四格、`node.audio.failure`） |
| 系统档位 | `quick/ci/full-local/release` 由 `tests/system/profiles.mjs` 编排 | 有层级，但 `unit` 只有一个总入口，缺 coverage、flaky、shard、单文件快速档 |
| 旅程评测 | `scripts/eval-journey.mjs` 支持 `--ci/--smoke/--only/--k`，会产 `output.jsonl/scores.json/report.md` | 已有证据链；仍应把“跳过、基础设施错误、产品失败”作为门禁级别明确分开 |
| Electron 启动隔离 | `_launchApp.mjs` 已集中 env、三目录隔离、stderr 尾部诊断 | 这是现有体系里最值得保留并扩展的基建 |

## 发现

### P0：当前主工作树先修复合并状态，再谈红灯

`pnpm test` 在冲突工作树里会被源码里的 `<<<<<<<` 直接挡住，红灯不代表测试失败。先把合并冲突落地成一个可编译提交；否则任何测试优化都会被噪音淹没。这个判断来自实际 transform error，不是推测。

另外，当前分支没有 `check:walkthroughs` package script，而最新 `origin/main` 已有该门岗；这说明分支本身还落后于测试治理入口。合并完成后应以最新基线的脚本/门禁为准，不要在旧分支上继续扩充第二套入口。

### P1：测试分层有了，但统一执行面不够清晰

`vitest.config.ts:5-8` 只定义了一个 `node` project；UI 走查脚本则由多个 package script 和人工命令分散触发（`package.json:76-88`）。这会导致：

1. 开发者能很快跑全量 unit，却不知道某个改动需要哪个 UX/系统档位。
2. Playwright 的 fixture/isolation/retry/report 能力没有成为统一约束。
3. coverage 只能手敲 CLI，且 package 没有 `test:coverage` 入口，历史审计里的覆盖率数字很容易过期。

### P1：UX 走查存在可量化的脆弱信号

对最新基线只读扫描得到：

- `148` 个 UX 文件使用固定等待（`waitForTimeout/setTimeout/sleep`），共 `1331` 处。
- `126` 个 UX 文件使用 `.first/.last/.nth`；这类选择器在 DOM 增删后可能点到另一个元素。
- `89` 个 UX 文件出现 `aria-label` 选择器，说明已有大量显式契约，应优先统一成 `getByRole/getByLabel` 或 `data-testid`，不要继续手写 CSS。
- 单测里有约 `12` 个环境条件 skip/skipIf（workspace symlink/unreadable、Windows executable bits、pose solver 等）；它们本身可以诚实跳过，但汇总必须和 pass 分栏，不能让“本机没跑到”看起来像功能已覆盖。
- 只有 `1` 个文件匹配最明显的空 catch 模式，但大量 `.catch(() => {})` 是“可选控件”与“真正断言”混在一起的信号；走查脚本必须把可选前置动作与验收断言分开。

Playwright 官方建议使用用户可见 locator、web-first assertions 和每测例隔离；固定 sleep、`isVisible()` 立即判断、宽泛 `.first()` 都会削弱这些保证。[Playwright Best Practices](https://playwright.dev/docs/best-practices)、[Assertions](https://playwright.dev/docs/test-assertions)、[Locators](https://playwright.dev/docs/locators)

### P1：覆盖率是“总分不错、关键低覆盖区明显”

V8 总体 `68.63/60.86/68.66/71.70` 不能直接当质量门槛。基线中仍有关键路径低于 20%（例如 `electron/browser/core`、`electron/browser/overlay`、部分 `generationCanvas`/`project`/`export` 边界模块），也有数个 0% 文件。这说明应按能力矩阵和风险打点，而不是全仓一刀切 80%。Vitest 官方支持 V8/ Istanbul，并明确 coverage 默认只统计被测试导入的文件，需显式配置 include/exclude 才能成为稳定的质量信号。[Vitest Coverage](https://vitest.dev/config/coverage)

### P2：结构契约测试很多，需把“为什么测”与实现字符串解耦

扫描到 `77` 个测试文件直接读取源码，`240` 个测试文件使用 `toContain/toMatch`。这类测试并非都错：对“禁止并行实现”“入口唯一”“门岗存在”很有价值；但对普通组件结构和文案，容易把重构误报成回归。Testing Library 的原则是测试尽量接近用户使用方式，避免内部 state、method、lifecycle 和 child-component 细节。[Testing Library](https://testing-library.com/docs/)

## 该替换、该保留、该新加

### 保留并扩展

- `tests/ux/_launchApp.mjs`：统一启动、隔离目录、错误诊断，继续作为唯一 Electron 入口。
- `tests/system/profiles.mjs` + `capabilities.json`：保留矩阵，但把它变成唯一的“能力 → 命令 → 证据”索引。
- 关键业务的纯函数/协议/迁移/错误分类测试：这部分反馈快、定位准，应继续往下压，不要用 E2E 重复覆盖。

### 替换（不建议一次性全仓重写）

1. **固定等待 → 状态等待**：优先改高风险/高频 helpers 和 CI 旅程。用 `expect(locator).toBeVisible/toHaveText/toHaveCount`、`waitForFunction` 或领域事件等待；动画只保留一个最小且有注释的 settle wait。
2. **宽泛 `.first/.nth` → 显式契约**：优先改会产生副作用的 click/submit；使用 role + accessible name，无法表达时补 `data-testid`。
3. **源码字符串结构测 → 行为/契约测**：保留真正的反并行版/门岗断言；普通布局、文案、组件存在性改成可见用户行为或导出的纯结构函数测试。
4. **散落 `.walk.mjs` → Playwright Test projects/fixtures**：不要求一轮迁完；先迁 `smoke`、`task-center`、`onboarding` 三条高价值路径，旧脚本在迁移期只保留为回退证据，迁完一个就删除旧入口，避免双轨。

### 新增

- `test:coverage`：固定 provider、include/exclude、输出 `text/json-summary/html`，并在 CI 记录基线差异；不先设全仓硬阈值，先对高风险能力设 ratchet。
- `test:unit:changed`/`test:ux:smoke`/`test:journeys:ci` 三个开发者快速入口，避免每次用 36s 全量 unit 或手找 145 个脚本。
- 失败分类：`product`、`infra`、`skipped` 三类必须在 system summary 分开；`skipped` 不能算 pass，`infra` 不能伪装成产品失败。
- 选择器与等待门岗：禁止新增裸 `waitForTimeout`（允许显式 `settle` helper）；禁止新增无解释 `.first/.nth`；测试 lint 只阻止新增，存量按文件逐步下降。
- 能力矩阵缺口：优先补 `node.audio.failure/persistence`、`timeline.preview.boundary/failure`、`experience.window-and-popovers.failure/persistence`、`node.panorama-whiteboard` 四格；它们是当前矩阵中最直观的空洞。

## 分阶段执行（建议顺序）

| 阶段 | 交付 | 验收 |
|---|---|---|
| 0 | 清掉当前工作树冲突；固定最新 `origin/main` 为基线 | `pnpm test` 在干净树稳定绿 |
| 1 | 加 coverage/changed/smoke 入口；system summary 分离 skip/infra | 三条命令可直接运行；coverage 可复现 |
| 2 | 迁移三条高价值 UX 流程到统一 fixture；替换 20 个最高频固定等待 | 新增脚本零裸 sleep；迁移路径连续跑 3 次结果一致 |
| 3 | 按能力矩阵补 8 个缺口；把 KeyFrame-Compass/VGIF 的诊断字段接到 eval 结果 | 每个高风险能力至少有 normal+boundary+failure+persistence 或诚实 unsupported |
| 4 | 逐步删除被新路径完全替代的旧 `.walk.mjs`；更新过期审计数字 | 删除旧入口后，`pnpm test:system:ci`、smoke、journey 仍全绿 |

## 外部原则如何落到 Nomi

1. 测试金字塔仍成立：越接近真实用户越少、越慢；高层 E2E 只证明低层测不到的 seam，不重复所有边界分支。[Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html)
2. 用户行为优先：DOM/React 内部结构不是用户体验；可见 role/label/contract 是稳定边界。[Testing Library](https://testing-library.com/docs/)、[Playwright Locators](https://playwright.dev/docs/locators)
3. 隔离优先：每个 Playwright 测例独立 context/profile/项目目录；Vitest 的 mock、文件和临时目录也必须 afterEach 清理。[Playwright Fixtures](https://playwright.dev/docs/test-fixtures)、[Playwright Parallelism](https://playwright.dev/docs/test-parallel)
4. 可重复网络：上游 provider 默认 mock/fixture/HAR，只有少数真实生成档位显式标记并单独计费；Playwright 官方支持 route/HAR/WebSocket mocking。[Playwright Mock APIs](https://playwright.dev/docs/mock)
5. 反偶然绿：定期用 Vitest shuffle/seed 检查测试顺序依赖；失败时记录 seed 便于重放。[Vitest Sequence](https://vitest.dev/config/sequence)

## 验收命令记录

```text
干净最新基线：pnpm test -- --reporter=dot
结果：694 passed / 1 skipped files；6137 passed / 1 skipped tests；36.57s

覆盖率：pnpm exec vitest run --coverage --reporter=dot
结果：同样全绿；V8 68.63% statements / 60.86% branches / 68.66% functions / 71.70% lines

构建与 smoke：pnpm run build && pnpm run test:e2e
结果：build 成功（仅既存 bundle warning）；Electron smoke `14` 条断言通过
```

说明：当前主工作树的冲突红灯不纳入上述结果；它是工作树状态问题，需先完成合并再复跑。
