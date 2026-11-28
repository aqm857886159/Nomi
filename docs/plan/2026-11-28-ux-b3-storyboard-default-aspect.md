# 设计卡 · 新建分镜方案默认画幅跟随当前项目画幅（UX-B3）

```
改动名：新建分镜方案默认画幅跟随当前项目画幅（UX-B3 / U-05）    线/负责人：impl-ux-b3    类别：[其他]（新增默认行为功能 feat）
```

> 依据：`docs/plan/2026-11-28-ux-simple-audit-phase1.md`（`U-05` / `B3`）与协调拍板 `#1586#issuecomment-7225334636`。
> 三条铁律：① 新建分镜方案默认跟随当前项目画幅（默认 `16:9`）；② 存量已建方案不迁不改、只读打开零写盘；③ 下拉菜单保留「按模型默认」（`''`）供创作者随时切回。

## ★0 先查别人

- https://linear.app/method/introduction · Linear Method（Opinionated Software & Defaults）：主干工作流由系统给出有主见的默认值，不把系统能推导的基础规格留成「未定」让用户每次手动确认 · **确认了**：新建分镜方案默认带入当前项目画幅（默认 `16:9`），不再以空白「按模型默认」开局。
- https://screen.studio/ 与 https://www.descript.com/ · 轻量桌面视频创作工具实践：新建项目或分镜时画面比例直接对齐项目导出画幅（横屏 `16:9` / 竖屏 `9:16`），防止出图与时间轴成片比例不一致导致返工 · **改了**：新建分镜方案不是硬编码死 `'16:9'`，而是动态读取当前项目 `selectPreviewAspectRatio`（默认 `'16:9'`，项目切为 `'9:16'` 后新建方案自动跟成 `'9:16'`）。
- `src/workbench/preview/previewAspectRatios.ts:36-38` · 仓库内既有项目画幅单一真相源 `selectPreviewAspectRatio`（缺省为 `PREVIEW_RATIOS[0].value = '16:9'`）与 `electron/shared/storyboard/storyboardShotScope.ts:96-99` 的 `planDefaultAspect` / `setPlanDefaultAspect` · **确认了**：复用现有 `selectPreviewAspectRatio` 与 `plan.aspectRatio` 字段，不新增第二份画幅存储键、不改 `storyboardShotScope.ts` 既有读时派生与透传契约。
- 出口：不涉及：本次只为新建分镜方案提供默认画幅值，不新增、扩大或挪动任何挡人保护、花钱拦截或长跑锁定。

## 设计卡全表（★0 + ★1–★9）

| 格 | 结论 | 证据 |
|---|---|---|
| **★0 先查别人** | 见上方 3 条带出处调研（Linear Method、Screen Studio / Descript、仓库既有 `selectPreviewAspectRatio` 与 `storyboardShotScope`）及出口说明。 | `src/workbench/preview/previewAspectRatios.ts:36-38` · `electron/shared/storyboard/storyboardShotScope.ts:96-99` |
| **★1 用户怎么用** | 当创作者新建项目、在创作侧栏新建分镜方案、或用 Agent / 划词拆镜产出新分镜方案时，我想在顶栏一眼看到全片将出 `16:9`（或与当前项目预览一致的画幅）而不是含糊的「按模型默认」，以便整组出片前就能确认横竖屏、避免花钱出图进时间轴后才发现比例反了。步骤：① 新建项目或点侧栏 `+` 新建方案 → ② 进分镜表见顶栏显示 `整片画幅 16:9`（英文 `Film aspect 16:9`）→ ③ 如项目预览已切 `9:16`，再新建方案直接显示 `9:16` → ④ 若需模型原生默认，点开顶栏下拉切回「按模型默认」（`''`）→ ⑤ 重开项目或打开老项目时各保原值。**不做什么 + 已知坑**：不迁移/不回填存量已建方案、不修改复制既有方案的原画幅、不新增项目创建弹窗。**真实任务**：① 隔离空库新建项目进分镜表核对中英双轨顶栏直显 `16:9` 并切回「按模型默认」读回；② 项目切 `9:16` 后侧栏新建方案核对默认 `9:16`；③ 读取无 `aspectRatio` 的存量老项目（`tests/fixtures/readonlyOpenProjects.ts` 与 `tests/ux/storyboard-film-aspect-passthrough.walk.mjs`）确认 0 写盘且保持 `model-default`。**指标（目标 → 信号 → 指标）**：新建方案首次进入即具明确画幅比例从 `0%` 升至 `100%`（量具：`storyboardPlanLifecycle.test.ts` + `projectRepository.workspace.test.ts` + `ui.mjs` 真窗口双轨走查）；老项目只读打开写盘次数护栏 `= 0`（量具：`projectPersistenceService.test.ts` + `tests/ux/storyboard-film-aspect-passthrough.walk.mjs`）。 | `src/workbench/creation/storyboard/storyboardPlanLifecycle.test.ts` · `src/workbench/project/projectPersistenceService.test.ts` · `tests/ux/storyboard-film-aspect-passthrough.walk.mjs` |
| **★1b 连带界面** | ① 分镜表顶栏 `StoryboardFilmAspect.tsx`（读取 `planDefaultAspect(plan)`，新建方案直显 `整片画幅 16:9` / `Film aspect 16:9`，下拉仍保留 `按模型默认` / `Model default`）；② 分镜表格画面格 `StoryboardShotTable.tsx`（`frameMediaBox(planDefaultAspect(plan))`，新建空白方案直接呈横屏 `16:9` 框而非兜底竖框）；③ 生成列表视图 `GenerationListView.tsx`（读取 `planDefaultAspect(design.plan)`）；④ Agent 新建方案回执文案不变（不新增 Agent 工具）。 | 真窗口双轨截图（仓库外）+ `shotFrameGeometry.test.ts` |
| **★1c 老用户** | 存量已建项目与存量分镜方案升级后**原样保留、零迁移、零写盘**：`projectNormalize.ts` / `readLocalProject` / `hydrateStoryboardDesigns` 完全不调用默认值填充；老方案中 `plan.aspectRatio === undefined`（或 `''`）打开后仍由 `planDefaultAspect` 读出 `''`（显示「按模型默认」），若全镜共同写着 `9:16` 仍读出 `9:16`；复制老方案也原样保留源方案画幅。退回上一版完全可读（`plan.aspectRatio` 为既有字段，无 schema 变更）。 | `src/workbench/project/projectPersistenceService.test.ts` · `src/workbench/project/projectSaveDraftContract.test.ts` |
| **★2 谁说了算** | 涉及 2 个既有概念，均复用原 owner，不增新状态：① 项目画幅由 `preview.aspect-choice`（`src/workbench/preview/previewAspectRatios.ts#selectPreviewAspectRatio`）唯一给出；② 分镜整片画幅由 `electron/shared/storyboard/storyboardShotScope.ts`（`planDefaultAspect` / `setPlanDefaultAspect` / `resolveShotParams`）唯一读写；③ 新建分镜方案的默认画幅装配收口于 `src/workbench/generationCanvas/agent/storyboardPlan.ts`（`createEmptyStoryboardPlan` + `withDefaultStoryboardAspect`）。全部新建入口经 `door-map` 普查共 4 扇：① `projectRepository.ts:createLocalProject`（新空白项目起手式）；② `workbenchDocumentSlice.ts:addStoryboardDesign`（手动新建空白方案）；③ `agentStoryboardDesign.ts:upsertAgentStoryboardDesign`（Agent / 划词拆镜新建方案，仅 `!existing`）；④ `applyCanvasToolCall.ts:propose_storyboard_plan`（规划器新建方案，仅 `!storyboardId`）。排除入口：`duplicateStoryboardDesign`（有 `source`）、`hydrateStoryboardDesigns` / `projectNormalize.ts`（读盘）、`restoreStoryboardDesign`（撤销），均不改画幅。一致性由共享构造器 + 写入口校验保证，不靠猜用户意图。 | `node scripts/door-map.mjs --write=addStoryboardDesign,duplicateStoryboardDesign,createEmptyStoryboardPlan,setPlanDefaultAspect --read=createEmptyStoryboardPlan,isEmptyStoryboardPlan,planDefaultAspect,previewAspectRatio,selectPreviewAspectRatio` |
| **★3 一致与复用** | 以前定过：2026-09-12 确立 `plan.aspectRatio` 为整片默认唯一真相源、`resolveShotParams` 透传画布（仍算数）；2026-10-30 确立草稿面允许 `aspectRatio: ''` 而严格面拒空串（仍算数）。三条路对比：① 沿原方向修（只改 UI 展示默认值）→ 会造成「UI 显示 16:9 但发给模型不带画幅」的两份真相，否决；② **换做法：新建方案入口统一写入当前项目画幅（选定）**→ UI 显示、预览框几何、落画布参数全走 `planDefaultAspect` 一份真相，且不碰存量；③ 删掉「按模型默认」→ 剥夺用户使用模型原生比例的控制权，否决。复用既有 `selectPreviewAspectRatio`、`planDefaultAspect`、`StoryboardFilmAspect.tsx`，不新增通用库。 | `git grep` · `pnpm run check:self-written` |
| **★4 全状态** | ① 空态（新建空白 2 镜起手式）：顶栏显示 `整片画幅 16:9`（或当前项目画幅），`isEmptyStoryboardPlan` 仍为 `true`，不弹未填提示词红条；② 加载态：读盘不改 `aspectRatio`；③ 成功态：切 `9:16` 或 `按模型默认` 即时生效并持久化；④ 失败态：不支持该画幅的模型由现有 `unsupportedFilmDefaultKeys` 如实提示，不静默撒谎；⑤ 部分成功 / 取消中 / 过期：不适用（纯同步内存初始化，无异步状态）；⑥ 能力不可用：未接模型时 `storyboardBulkAspectOptions` 仍保留 `['', current]` 两项，可自由切回「按模型默认」或连接模型；⑦ 撑开边界：只展示短比例值（如 `16:9` / `21:9`），既有 `NomiSelect` 宽度不变；文案沿用既有 `storyboardEditor.aspectScope.*`（中英已齐，无费用文案）。 | 双轨真窗口截图 · `pnpm run check:i18n` |
| **5 中途表** | 纯同步内存对象初始化，无长跑/网络/花钱过程。① 新建后未编辑即关窗/重启：空白起手式已随新建项目或新建方案落盘 `aspectRatio: '16:9'`，重开仍为 `16:9`（不扣费，无回执）；② 改画幅为 `''` 后关窗/重启：经防抖/退出刷盘保存为 `aspectRatio: ''`，重开显示「按模型默认」；③ 断网：全本地操作不受影响；④ 连点新建：每次生成独立 id 与唯一标题，均带当前项目画幅。 | `src/workbench/project/projectSaveDraftContract.test.ts` · `tests/ux/storyboard-film-aspect-passthrough.walk.mjs` |
| **6 外部数据与失败** | 外部输入仅来自：① 磁盘存量 `project.json`（规范：`storyboardDraftPlanSchema`，缺 `aspectRatio` 或为 `''` 均合法并原样保留，不回填）；② Agent 传入 `storyboardPlanSchema`（规范：`electron/shared/storyboard/storyboardPlanSchema.ts:100`，`aspectRatio: ''` 严格面仍拒收；缺省且无全镜共同画幅/片种声明时在新建落库入口补入当前项目画幅）。 | `electron/shared/storyboard/storyboardPlanSchema.ts:80-103` |
| **★7 性能** | **不适用（纯内存初始化，0 额外渲染与 IO 开销）**：① 新增操作：无新交互控件，仅在已有新建分镜方案同步路径中读取一次内存字段 `state.previewAspect?.ratio ?? '16:9'`（O(1) 字符串读取）；② 最坏规模：1000 镜方案新建时仅设置顶层 1 个标量字段 `plan.aspectRatio`，不遍历镜头写每行；③ 预算：单次初始化额外耗时 `< 0.01ms`，0 额外重渲染、0 额外磁盘 IO、0 长任务；④ 性能场景：不新增独立性能场景（沿用既有 `project-open-stages` 与空白方案新建回归，不增加启动/打开耗时）。 | 静态分析 + 既有单测耗时 |
| **8 真实条件** | macOS 隔离真窗口：中文浅色 (`zh-CN / light / 1280x800`)、英文深色 (`en / dark / 1280x800`) 改前/改后对比截图均亲眼 `read_file` 核验；真 Electron 走查（空白新建 + 整片画幅贯通 + 草稿保存契约）实跑通过；Windows / 干净打包安装包 / 真付费记 `unverified`（本次不涉及付费链路与平台特有代码）。 | 仓库外截图目录 + Electron 走查命令 |
| **拍板图清单** | 不适用：本次不新增、删除或修改任何 `.tsx` 组件、布局、文案或 `.board.json` 拍板锚点，仅更新新建分镜方案的数据层默认画幅值。 | `pnpm run check:board-parity` |
| **★9 验收与回滚** | 见下方「验收清单与反例」及回滚说明。回滚：`git revert <commit>` 单提交即可无损退回（不涉及数据迁移或 schema 变更）。 | 单元/属性/对等测试 + Electron 走查 + 门岗全绿 |

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能

## 验收清单与反例（动手前定）

| 编号 | 检查项 / 反例 | 预期结果 | 验证证据 |
|---|---|---|---|
| C1 | 新建空白项目（`createLocalProject`） | 起手式 `plan.aspectRatio === '16:9'`，`isEmptyStoryboardPlan(plan) === true`，`planDefaultAspect(plan) === '16:9'` | `projectRepository.workspace.test.ts` |
| C2 | 项目默认画幅下手动新建分镜方案（`addStoryboardDesign` 无 `source`） | `plan.aspectRatio === '16:9'`，`isEmptyStoryboardPlan(plan) === true` | `storyboardPlanLifecycle.test.ts` |
| C3 | 项目预览画幅切为 `'9:16'` 后再手动新建分镜方案 | `plan.aspectRatio === '9:16'`，跟随当前项目画幅而非写死 `16:9` | `storyboardPlanLifecycle.test.ts` |
| C4 | 在顶栏将新建方案从 `16:9` 切回「按模型默认」（`''`）并保存重开 | `plan.aspectRatio === ''`，`planDefaultAspect(plan) === ''`，持久化与 JSON 往返完全保真；严格面 `parseStoryboardPlan` 仍拒绝 `''` | `projectSaveDraftContract.test.ts` · `editorPersistability.property.test.ts` |
| C5 | **反例（存量不迁）**：读取存量无 `aspectRatio` 的老分镜方案（`normalizeRecord` / `hydrateStoryboardDesigns` / 只读打开老项目） | `plan.aspectRatio` 仍为 `undefined`，`planDefaultAspect(plan)` 保持 `''`（若全镜同画幅则保持原派生值），只读打开 0 写盘 | `projectPersistenceService.test.ts` · `storyboardPlanLifecycle.test.ts` |
| C6 | **反例（复制不强刷）**：复制一份手选「按模型默认」（`''`）或存量未设画幅（`undefined`）的方案（`duplicateStoryboardDesign`） | 复制品原样保留 `''` / `undefined`，不被强刷为项目画幅 | `storyboardPlanLifecycle.test.ts` |
| C7 | **反例（Agent 新建不覆盖显式选择）**：Agent / 划词拆镜新建方案（`upsertAgentStoryboardDesign` / `propose_storyboard_plan`）：① 未指定画幅且各镜未统一画幅 → 跟随项目画幅；② 显式指定 `aspectRatio: '9:16'` 或全镜钉死 `'9:16'` 或带短剧 `profileKey` → 原样保留 `'9:16'`；③ 替换已有方案（`existing`）→ 不篡改 | 三种分支均精确成立 | `agentStoryboardDesign.test.ts` |
| C8 | 真窗口中英双轨（`zh-CN/light`、`en/dark`）新建项目进分镜表 | 改前 `model-default`（`整片画幅按模型默认` / `Film aspect Model default`）；改后 `16:9`（`整片画幅 16:9` / `Film aspect 16:9`）；点开下拉可见「按模型默认」仍可选；选回后从 DOM 与存量方案走查验证 | 仓库外改前/改后对比截图 + `tests/ux/storyboard-film-aspect-passthrough.walk.mjs` |
| C9 | 既有分镜对等与几何回归 | `paramValueType.parity.test.ts`、`shotFrameGeometry.test.ts`、`storyboardShotScope.test.ts`、`storyboardPlan.test.ts` 全部通过 | `VITEST_MAX_WORKERS=2 pnpm exec vitest run ...` |
