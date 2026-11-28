# 设计卡：项目库单来源隐藏无效筛选与卡片删除钮收归标题行（UX-A8）

改动名：项目库单来源隐藏来源筛选胶囊 + 删除封面右上角删除浮钮并收归标题行动作区（UX-A8）  
线/负责人：impl-ux-a8  
类别：[其他]（路径命中现有 `.tsx` 界面与性能路由，非新增 `.tsx` / 非 `src/design/`；协调按 P1 2026-10-22 例外代批采用独立方向检查 `docs/plan/2026-11-28-direction-check-library-card-actions.md` 的 **方案 2B + 原始列表维度显隐**）

## ★0 先查别人

- `docs/design/nomi-design-system.md:231` · §1.5.3 规定「动作不许压在内容上」，且 §1.5.2 第 5 条要求「删掉它创作者不会做错的，就删」 · **确认了** 删除封面遮罩右上角红垃圾桶与单来源库隐藏空筛选胶囊两个决定。
- `src/workbench/promptLibrary/PromptCard.tsx:26` · 兄弟库卡片封面保持纯净不压字与管理动作，编辑 / 删除放在标题行且通过悬停与键盘聚焦露出 · **确认了** 将删除钮收归标题行右侧动作区并补齐 `group-focus-within:opacity-100` 键盘可达。
- `docs/design/boards/2026-10-08/Library.board.json:271` · 登记 `library.card.delete` 绑定 `library.deleteNamedProject` 名称与既有悬停点删走查契约（`tests/ux/shell-redesign.walk.mjs:180`、`tests/ux/project-location-owner.walk.mjs:244`） · **改了** 实现路线为方案 2B（标题行直排静音图标，保留原 `aria-label` 与 `title`，零额外点击且无需改 `.board.json`）。
- 出口：不涉及：本次未新增、扩大或挪动会挡住用户的保护逻辑（仅隐藏无意义筛选态并将既有删除入口移出封面误触区，二次确认与回收站路径保持原样）。

## 设计卡正文

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当创作者在项目库浏览已有本地项目、准备打开或清理某个项目时，我想只看到有意义的顶栏控件并在不误触封面的前提下找到删除入口，以便安心打开作品且安全管理项目。步骤：① 打开项目库；② 仅本地项目时顶栏直接是页签 + 搜索 + 右侧动作，无「外部文件夹 0」死角筛选；③ 挂载外部文件夹后自动出现三段筛选；④ 悬停或键盘 Tab 聚焦项目卡，封面仅保留「继续创作」，标题行右侧静默露出编辑 / 打开文件夹 / 删除图标；⑤ 点删除图标进入既有二次确认框（本地项目移至废纸篓/回收站，外部或失效灰卡从库移除）。**不做什么**：不改 `.board.json`、不改删除确认与回收站逻辑、不新增右键菜单（2A 留作后续演进）；**已知坑**：搜索词未命中外部目录时不可按 `sourceCounts.folder` 隐藏筛选条，必须按原始 `projects` 列表判断。真实任务：① 仅本地项目库悬停打开/删除确认（`tests/ux/shell-redesign.walk.mjs` #47）；② 缺失外部目录灰卡移除（`tests/ux/project-location-owner.walk.mjs`）；③ 700px 窄窗项目库无横向溢出（`tests/ux/window-narrow-shell.walk.mjs`）。目标→信号→指标：单来源库空筛选胶囊出现率 100% → 0%（量具：`ProjectLibraryPage.filterAndActions.test.tsx`）；封面区破坏性按钮数 1 → 0、标题行键盘可达率 0% → 100%（量具：`ProjectLibraryPage.filterAndActions.test.tsx` + `shell-redesign.walk.mjs`）；护栏：既有 #47 删除确认与 700px 窄窗布局 100% 通过（量具：`shell-redesign.walk.mjs`、`window-narrow-shell.walk.mjs`）。 | `src/workbench/library/ProjectLibraryPage.filterAndActions.test.tsx` / `tests/ux/shell-redesign.walk.mjs` / `tests/ux/window-narrow-shell.walk.mjs` |
| ★1b 连带界面 | 确认弹窗文案、移入回收站 / 废纸篓提示 toast、找不到文件夹灰卡的角标与「从库移除」确认文案全部沿用既有词典与 `NomiStudioApp` 处理链，无新增或修改连带文案。 | `tests/ux/library-delete-copy.test.mjs` |
| ★1c 老用户 | 老用户的本地项目、外部文件夹项目与缺失文件夹灰卡数据结构完全不变；仅本地项目的老用户升级后顶栏更清爽；已有外部文件夹项目的老用户升级后三段来源筛选原样可用；删除入口仍在同一张卡片上（从封面右上角收归标题行最右），悬停与键盘聚焦均可见，二次确认与回收站还原机制不变。 | `src/workbench/library/ProjectLibraryPage.folderMissing.test.tsx` / `tests/ux/shell-redesign.walk.mjs` |
| ★2 谁说了算 | 概念 `library.project-card-actions` 唯一 owner 为 `src/workbench/library/ProjectLibraryPage.tsx`（`ProjectLibraryPage`），允许消费者仅 `src/workbench/NomiStudioApp.tsx` 与 `src/devlab/designLab/updateReminder/updateReminderLabKit.tsx`。`door-map` 核对 `ProjectLibraryPage`（2 扇读门）、`onDeleteProject`（2 扇读门 + 1 扇写门 `ProjectLibraryPage.tsx`）、`sourceFilter`（`ProjectLibraryPage.tsx` 与项目内 `AssetLibraryPanel.tsx` / `AssetLibraryToolbar.tsx` 各自独立状态）。来源筛选显隐与有效值仅在 `ProjectLibraryPage` 一处由原始 `projects` 列表派生（`hasFolderProjects` / `effectiveSourceFilter`），无第二份推断；删除请求经唯一 `onDeleteProject` 显式回调交由宿主完成确认与落盘，不靠状态消失猜用户意图。 | `docs/engineering/concept-owners/library.project-card-actions.json` / `node scripts/door-map.mjs onDeleteProject` |
| ★3 一致与复用 | 过去定过：`Library.board.json:271` 保留 `library.card.delete` 的名称与删除确认语义；设计系统 §1.5.3 规定动作不压内容；`PromptCard.tsx` 已实现封面纯净 + 标题行悬停/聚焦露出。三条路对比见 `docs/plan/2026-11-28-direction-check-library-card-actions.md` §6：协调代批采用 **方案 2B（删封面红垃圾桶、收归标题行直排静音图标）+ 原始列表维度显隐**，零额外点击、完全兼容现有板清单与走查。样式复用 `CARD_ACTION_BASE_CLASS` 既有设计 token 与 `workbench-danger` 危险色 token，不新增全局 CSS。 | `docs/plan/2026-11-28-direction-check-library-card-actions.md` / `pnpm run check:tokens` |
| ★4 全状态 | 空库（`firstRun`）：不显示工具栏与筛选胶囊；加载中：骨架屏占位；成功（单来源全本地）：不渲染来源筛选胶囊，卡片封面仅在悬停出「继续创作」，标题行右侧静音露出编辑 / 打开文件夹 / 删除图标；成功（多来源含外部目录）：渲染三段来源筛选胶囊，搜索未命中外部目录时不闪隐，清空最后一个外部目录后自动复位为 `all` 并显示剩余本地项目；失败（读库失败）：显示既有错误空态与重试按钮；部分成功 / 不可用灰卡（缺失或清单损坏）：封面下沿显示不可用说明且无删除浮钮，标题行隐藏编辑与打开文件夹、保留删除/移除图标并可触发 `onDeleteProject`；取消中 / 过期：不适用（本页无独立长跑任务，删除在确认弹窗取消即原样保留）；能力不可用：不适用（本地筛选与标题行图标不依赖模型或外部网络）。长项目名通过 `min-w-0` + `truncate` 截断，700px 窄窗下 3 枚 `size-8` 图标与标题行无横向溢出；文案全部走既有 i18n 键（zh / en）。 | 真窗中英亮暗改前改后截图 / `pnpm run check:i18n` / `tests/ux/window-narrow-shell.walk.mjs` |
| ★7 性能 | 不适用：本次为纯视图条件渲染与按钮 DOM 位置收敛，未新增网络请求、定时器、列表规模变化或新交互热点。 | `tests/ux/window-narrow-shell.walk.mjs` / `tests/ux/shell-redesign.walk.mjs` |
| ★9 验收与回滚 | 验收清单与反例：① 单来源（全本地）项目库不渲染 `library.sourceFilter` 且卡片正常渲染（反例：直接不渲染卡片或删掉多来源筛选 → 单测红）；② 多来源含外部目录时渲染 `library.sourceFilter`，输入仅命中本地项目的搜索词时筛选条不消失（反例：按 `sourceCounts.folder > 0` 判显隐 → 单测红）；③ 选中 `folder` 档后移除最后一个外部目录，筛选条隐藏且自动复位 `all` 显示本地项目（反例：不复位停留在空态 → 单测红）；④ 封面 `.aspect-video` 内 0 个删除按钮，标题行动作区包含 `library.deleteNamedProject`（含 `group-focus-within:opacity-100` 与 hover/focus 才亮危险色），正常卡与 `unavailable` 灰卡点击均可触发 `onDeleteProject` 且不触发 `onOpenProject`（反例：保留封面删除钮或漏掉 `unavailable` 卡删除钮 → 单测与走查红）；⑤ 中英亮暗双轨真窗截图对照与 `library-layout` / `window-narrow-shell` / `shell-redesign` 三条真实 Electron 走查全绿。回滚：单 commit `git revert` 即可无损还原，无数据迁移副作用。 | `src/workbench/library/ProjectLibraryPage.filterAndActions.test.tsx` / `tests/ux/shell-redesign.walk.mjs` / `tests/ux/window-narrow-shell.walk.mjs` / `tests/ux/library-layout.walk.mjs` |

### 功能分类

- [x] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能
