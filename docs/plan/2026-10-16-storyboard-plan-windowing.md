# 设计卡：打开分镜方案只挂看得见的行

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：分镜表窗口化（打开 320 镜方案 18.2 秒 → 只挂视口 + 缓冲）   线/负责人：P-plan   类别：[新界面][其他]
```

类别说明：没有新画界面，版面与交互逐像素不变；按任务书「新界面」类填满 9 格，因为它换掉了分镜页主体的渲染结构，用户可见的每个旧功能都要重新核一遍。

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我打开一份几百镜的方案，我想马上看到前几镜并开始改，而不是整个应用冻住十几秒。步骤：创作页 → 文稿菜单点方案 → 首屏几镜可编辑 → 滚动 / 键盘上下 / 多选 / 拖拽 / 增删 / 撤销 / 生成，和以前一样。**不做什么**：不改版面、不改任何按钮、不加「加载更多」、不分页。**已知坑**：浏览器原生 Ctrl+F 只搜得到挂着的行（应用内没有全文查找入口）。真实任务：① 320 镜方案冷启后第一次打开（`storyboard-plan-open` 场景同一份夹具）；② 在第 1 镜打字后滚到中段再回来撤销；③ 从第 1 镜 Shift 多选到第 40 镜交给 Agent。主指标：打开到首屏可编辑的毫秒；质量指标：旧功能普查逐条在；护栏：挂载行数 / 编辑器数 ≤ 首屏 + 缓冲、行宽测量次数为常数、素材池一份。基线 18.2 秒（C-trace 安静窗口五次中位数）/ 目标 ≤ 1 秒。人设：新手打开 AI 拆出来的大方案；老手在长片里来回改镜。预期 → 实际记录方式：`tests/ux/storyboard-windowing.walk.mjs` 每条 ✓/✗ 带实测值 | `tests/ux/storyboard-windowing.walk.mjs`、`tests/perf/document-switch-bench.mjs --scenario plan-open` |
| ★1b 连带界面 | 无新文案。页脚「N 镜 · 交给 Agent」计数、多选浮条、场组头小结、「已生成 x/320」全部读表的状态 / 行状态，与行是否挂载无关；Agent 回执不涉及 | walk ⑤（页脚计数 40）、⑩（视口外行挂上即最新状态） |
| ★2 谁说了算 | 方案数据 owner 不变（workbenchStore 的 `storyboardDesignsByDocumentId`）；行执行态仍由 `deriveStoryboardRowRuntimes` 单源 derive；选择集仍归表（`selectedShotIds`）。新增的只是表内「挂哪几项」的视图状态，归 `StoryboardShotTable` 里的 `useVirtualizer`；行宽档位归行容器（`useStoryboardRowsDensity`，`storyboard.table-structure` 概念的阈值 owner 仍是 `STORYBOARD_ROW_NARROW_BELOW`）；@ 候选素材池归 `useShotMentionPool`（整表一份）。同一份事实存了 1 份；没有靠「行不见了」猜意图 | `node scripts/door-map.mjs useElementWidth` / `useAssetPool` / `StoryboardShotTable`（结果写进 `docs/fixes/2026-10-16-storyboard-plan-windowing.root-cause.json`） |
| ★3 一致与复用 | 窗口化用仓库已在用的 `@tanstack/react-virtual`（锁定 3.14.2，core 3.17.0；素材库 `AssetLibraryPanel`、提示词库 `PromptLibraryPanel`、生成列表 `GenerationListView` 同一个库），写法对齐 `GenerationListView`（`measureElement` + `data-index` + `getItemKey`）。用到的官方能力：动态行高 `measureElement`、`scrollMargin`、`rangeExtractor` + `defaultRangeExtractor`、`scrollToIndex`、`initialRect`；出处 context7 `/tanstack/virtual`，<https://tanstack.com/virtual/latest/docs/api/virtualizer>（3.x 当前版）。不自写虚拟化，无新增自写登记 | `git grep useVirtualizer src` |
| ★4 全状态 | 空方案：0 项，表只剩外框（与以前相同，添加镜头按钮在表下）；少于一屏：全部挂上（计数测试「3 镜挂 3 行」）；加载：首帧按 `initialRect` 算首屏、布局前量到真实视口再修正，不闪白；成功：首屏可编辑；滚动中：缓冲 3 项，滚轮小步不见空白；快速滚动中新进来的行先是轻量占位（同一行外壳、预览框、提示词纯文本），停下后每帧换成一行完整行；生成中 / 失败 / 可找回 / 已锁定：行状态单源 derive，视口外的行挂上时就是最新态；场折叠：折叠组只剩组头；参考卡筛选：只摊平筛选后的镜；能力不可用：不适用（不调模型）；取消中：不适用（无长跑） | `StoryboardShotTable.windowing.test.ts`；walk ⑩ |
| 5 中途表 | 打开过程中切走 / 关窗 / 重启：表只是视图，切走即卸载，回来重新按视口挂；不花钱、无回执。编辑中滚走：焦点行钉住不卸（输入法组字、编辑器撤销栈保住）。焦点换走后这一行可以卸载：编辑器撤销历史按镜头 id 存在表里，重挂时接回（重做不跨卸载）。拖拽中滚动：被拖的行钉住不卸，`dragend` 照常触发。连点：无新增按钮。断网：不涉及 | walk ③（滚走后撤销仍可用）、⑥（拖拽） |
| 6 外部数据与失败 | 唯一外部依赖是 `@tanstack/react-virtual`（官方文档见 ★3）。我们的偏差：键盘上下移到挂着的相邻行时**不**用 `scrollToIndex`，直接 `focus()` 让浏览器滚进视口——core 3.17.0 的 `scrollToIndex` 会在 5 秒内持续校准到目标，方向键自己的原生滚动让它一直对不上，期间任何行高变化都会把视口拽回去（走查实测）；只有相邻行不在 DOM 里时才按估算偏移摆好再原生聚焦。定位到某一镜（居中）仍用 `scrollToIndex` | 源码 `virtual-core/dist/esm/index.js` `reconcileScroll`；walk ④ ④b ⑩ |
| ★7 性能 | ①操作：打开方案；滚动（含快速滚动：100 次滚轮 × 800px）；键盘上下移；定位到某一镜。②最坏规模：320 镜（场景夹具），计数测试另跑 1000 镜。③预算：打开到首屏可编辑 ≤ 1 秒；快速滚动中 0 个新建编辑器、长任务不多于 main（V-1210 的 main 对照 0 个）；挂载行数 / 编辑器数与总数无关（≤ 首屏 + 缓冲）；行宽测量次数常数；素材池一份。④场景 `storyboard-plan-open`（`tests/perf/scenarios/storyboard-plan-open.json`，判据随本刀改为「行区报出逻辑总数 + 视口行可编辑」，停表后另验末镜够得着）。修前 / 修后数字见 PR 正文 `## 验收证据` | `node tests/perf/document-switch-bench.mjs --scenario plan-open --runs 5` |
| 8 真实条件 | Windows ✓；英文 ✓（en 暗色）；最小窗口 1100×690 ✓（窄档）；真规模 320 镜 ✓；键盘 ✓（上下移、Shift 多选、Ctrl+Z）；干净安装 ✓（隔离资料目录）；真付费：不适用（不发生成，生成状态用走查桥改画布 store） | `tests/ux/storyboard-windowing.walk.mjs` 截图（zh 亮顶 / 中 / 底，en 暗窄窗顶 / 中 / 底） |
| 拍板图清单：链接 | 不适用：版面、元素、交互都不改（只改哪些行挂在 DOM 上）；截图与改前逐项一致 | walk 截图 |
| ★9 验收与回滚 | 验收：另一条线跑 `pnpm exec vitest run src/workbench/creation/storyboard/StoryboardShotTable.windowing.test.ts`（修前 4 红 / 修后全绿）、`node tests/ux/storyboard-windowing.walk.mjs`（先 `pnpm run build`）、`node tests/perf/document-switch-bench.mjs --scenario plan-open --runs 5`，并对着方向检查与旧功能普查逐条点；硬门 ⑫（点了 = 以为的：点开方案马上能改）。回滚：revert 本提交（单提交，含测试与量具判据） | `## 独立验收`：待验收线 |

### 功能分类
- [x] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能

## 旧功能普查（改前先列，改后逐条核）

| # | 现在能做的事 | 改后在哪里 / 怎么保住 | 核对 |
|---|---|---|---|
| 1 | 行高随内容自动变（变体抽屉、首帧提示词、警示行、窄档） | 每项 `measureElement` 实测回写，ResizeObserver 跟踪 | walk ②：打字后、窗口变窄（265→201）各项首尾相接 |
| 2 | 拖拽排序 | 原样；被拖的行由 `rangeExtractor` 钉住不卸 | walk ⑥（按真实顺序派发 HTML5 事件）；原生鼠标拖到滚动区边缘的自动滚动 `unverified`：Playwright `dragTo` 在 main 上也触发不了原生拖放 |
| 3 | 多选（点、Ctrl/⌘ 点、Shift 区间、复选框、浮条） | 选择集按 shotId 存在表里，与挂载无关 | walk ⑤：跨屏 Shift 选 40 镜 |
| 4 | 键盘：↑↓ 移焦点、Alt+↑↓ 移镜、Enter 进提示词、⌘Enter 生成 | ↑↓：相邻行挂着就原生聚焦；不在 DOM 里按估算偏移摆好再聚焦。其余键原样 | walk ④（到原先没挂的第 14 镜）、④b（焦点行滚远后按 ↓） |
| 5 | 跳到某一镜（`storyboardRowFocus`，展开折叠的场、居中、聚焦、选中） | 按项目下标 `scrollToIndex(center)`，挂上后聚焦；筛选挡住时等编辑器清掉筛选 | 代码路径保留；当前没有生产调用方（`openStoryboardPlanRow` 无调用者），walk 只验了同一机制的键盘路径——记 `unverified` |
| 6 | 新增 / 删除镜头后的滚动位置 | 项目按 shotId 作 key，测量缓存跟 key 走；加镜后总数 +1、滚到底够得着 | walk ⑦ |
| 7 | 撤销（编辑器内 Ctrl+Z、删镜后编辑器级 Ctrl+Z 恢复） | 焦点行钉住不卸；焦点换走、行卸载后，编辑器历史按镜头 id 存表、重挂接回（`promptHistoryCarry`）；删镜撤销是方案级、与挂载无关 | walk ③、③b（V-1210 首轮阻断项：修前红、修后恢复原文）、⑦；`promptHistoryCarry.test.ts` |
| 8 | 生成中的状态刷新 | 行状态每次渲染从画布节点 derive；视口外的行挂上时就是最新态 | walk ⑩ |
| 9 | 应用内搜索 / 定位 | 应用内本来就没有分镜全文搜索（Ctrl+F 不出查找框）；参考卡筛选照常。窗口化后 DOM 文本只覆盖视口附近约 5 行：长方案找一句台词只能滚动辨认，影响中到高；建议另开「按镜号 / 文本定位」入口（消费端已按下标滚动） | 方向检查第 6 节「查找」 |
| 10 | 中英文和窄窗 | 行宽档位由行区量一次（640 宽 → 窄档） | walk ⑨：en 暗色 1100×690 |
| 11 | 场组头（折叠、小结、播放本场） | 组头是列表里的一项，随视口挂；小结与播放读整组 rows，与挂载无关 | 计数测试（场景组头路径）、设计实验室 03-zone |
| 12 | 行间「＋插入」线 | 与行同在一项里，原样 | walk 截图 |
| 13 | 多选浮条 sticky 跟屏 | 浮条仍在裁切行区之外（结构测试 `storyboardTableReach.structure.test.ts`） | 既有结构测试绿；walk 中段截图浮条在视口底 |
| 14 | @ 引用候选（参考卡、某镜结果、素材库、上传） | 素材池整表一份递给每行，候选内容不变 | `useShotMentionSource` 结构用例 |
| 15 | 快速滚动不卡 | 滚动中新进来的行先挂轻量占位、不建编辑器；停下每帧升级一行（`storyboardMountPlan`） | walk ⑪：滚动中新建编辑器 294 → 0、长任务 5 → 0；`storyboardMountPlan.test.ts` |
| 16 | 点占位行马上打字（V-1210 复验 R2-1） | 占位行在 pointerdown 那一刻同步升级成完整行（flushSync），焦点直接进提示词编辑器（点在内容列）或行上，并拦下这一下的默认聚焦 | walk ⑫：修前字落到编辑器外（红），修后进第 23 镜提示词 |
| 17 | 重挂后接着改再撤销（V-1210 复验 R2-2） | 重放历史后封一次组边界，之后的新编辑另起一组 | walk ⑬（修前红）；`promptHistoryCarry.test.ts`「重挂后马上接着改」（修前红） |
| — | 已知限制：动态状态行首次滚入时的位移 | 占位按估高摆，失败 / 警示等运行状态让完整行更高（复验实测 16:9 失败行 208 → 263），停下换成完整行时下方镜头下移；停下后仍首尾相接，不丢数据。不挡合并，协调已记待办 | V-1210 复验第 4 节 |
