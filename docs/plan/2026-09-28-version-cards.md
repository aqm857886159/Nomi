# 节点版本卡片（原地铺开）· 实现方案

> 状态：🔨 V1 数据层已实现未推送（2026-10-06，线 L-vcard，分支 `feat/version-cards`）；V2 渲染等对账页里的一处拍板（见 [2026-10-06 对账与设计卡](2026-10-06-version-cards-reconcile.md)）。样张已获批：[docs/design/mockups/2026-09-28-version-cards/](../design/mockups/2026-09-28-version-cards/README.md)（在线 https://claude.ai/artifact/56CiBTTYaRwANu6PTSo3ry ）。
> 实现前先把本分支并上最新 `origin/main`；下文行号以 2026-09-28 的 `origin/main` 为准。

## 1. 要做成什么（用户视角）

一个节点反复生成会攒下好几版。现在挑版本要打开节点右边的小窗，在一列缩略图里点来点去，点别处小窗就关。改成：点节点右侧的版本图标，版本在**原地铺成一排卡片**，一直留在画布上，可以同时铺开好几个、接着处理别的节点；只有再点同一个图标才收起。

用户拍板（2026-09-28）：
1. 盖住邻居时**盖在上面**：被盖住的邻居点中就浮到最上面，被压住的标题先藏起来。
2. 版本卡默认**和节点一样大**（没选推荐的「紧凑」）。
3. 制作镜头的「重拍这镜」：**整排只放一张重拍卡**，放在新版本会出现的位置。
4. 删除**不弹确认框**，提示条里给「撤销」（⌘/Ctrl+Z 同样能撤）。

其余照样张：最新一版紧挨节点；超过 8 版先铺 8 张 +「+N」，点开换行成第二排；右边放不下往左铺；绝不挪别的节点、不动视口；点卡片＝预览大图（不改主图）；悬停条＝设为主图 / 下载 / 删除；视频卡悬停播放、拖进度；拖版本卡＝拖整组；Alt 拖出＝复制成独立素材卡；分组靠一条细线；版本卡没有连线把手。

## 2. 概念占用表（R33）

| 概念 | 唯一 owner | 允许谁消费 | 本次动作 |
|---|---|---|---|
| 节点的版本列表与主图（`result` + `history`） | `src/workbench/generationCanvas/model/nodeResultLifecycle.ts`（`listStableNodeMediaResults`、`removeNodeResult`） | 版本卡、预览、删除、设主图 | 补「设主图」「恢复」两个纯函数，旧托盘里的同类逻辑删掉 |
| 结果身份（同一版怎么认） | `nodeResultLifecycle.ts` 的 `resultIdentity` | 所有读写 history 的地方 | **修一个第二 owner**：`store/nodeRunOutcome.ts` 的 `mergeResultHistory` 自己拼了一份身份（少了 `assetRefId`/`assetId`），改为调用 `resultIdentity` |
| 版本序号「第 N 版」（持久、跟着版本走） | 新增：新结果进 history 的唯一入口（`nodeRunOutcome.ts` 合并新结果处）赋号 = 当前最大号 + 1；旧数据没有号时在画布快照读入的唯一规范化入口一次性补号（最早 = 1） | 版本卡标签、提示文案、预览 | 新字段；标签不再用列表下标（现状 `NodeResultStack.tsx:517` 的 `index + 1` 会随新增/删除漂移） |
| 铺开状态（按节点、存进项目） | 节点上的新可选字段（仿编组折叠 `generationCanvasTypes.ts:213` 的 `collapsed`），只经画布 store 的一个 action 写 | 节点组件、版本卡层 | 新字段；放置方向（左/右）由渲染时计算，不存 |
| 撤销 | `src/workbench/generationCanvas/events/canvasUndoJournal.ts`（事件日志 + barrier，最多 80 步） | 删除、设主图、提示条「撤销」 | 删除 / 设主图都作为可撤销的画布事件进日志；提示条「撤销」＝同一个撤销（只在它仍是最近一步时显示，之后任何手势让提示消失），**不另做第二套撤销** |
| 被删版本的文件何时真删 | `src/workbench/assets/deleteAssetResult.ts` | 撤销日志、项目卸载、App 退出 | 改两段式：先从版本里摘掉并存盘；**真删文件推迟到撤销日志再也回不到它**（被挤出 80 步、切换/关闭项目、退出 App）。现状是存盘后立刻 `deleteFiles`（`deleteAssetResult.ts:117-122` 一段），⌘Z 恢复后文件已经没了 |
| 遮挡避让（被压住的标签先藏） | 渲染层一个纯函数（画布坐标里求矩形交），不进 store | 节点标签、版本卡标签 | 新增 |
| 层级（铺开组介于普通节点与选中节点之间） | `reactFlow/generationCanvasReactFlow.css` 的层级表（选中节点在 `:35` 抬到 5） | 版本卡层 | 在同一张层级表里加一档；不打破「框 < 节点 < 折叠卡」 |
| 重拍这镜 | 只**消费**现有 `production/productionShotActions` 的 `reworkProductionShot`（`NodeResultStack.tsx:392` 现在的调用） | 排头重拍卡 | 不改语义（镜头认领 lane 正持有制作镜头的花钱语义，本 lane 只换入口位置） |
| 版本图标 | `src/vendor/tablerIcons.ts` + 设计系统 §6 登记 | 版本入口 | 新增 `IconVersions`（`@tabler/icons-react` 3.44.0 有 `dist/esm/icons/IconVersions.mjs`）；收起沿用已登记的 `IconArrowsDiagonalMinimize2`（`src/vendor/tablerIcons.ts:258`） |

## 3. 要删的旧东西（P1：新替旧同 commit 删）

- `nodes/NodeResultStack.tsx` 的浮动托盘整体删除（571 行）；它里面的视频悬停播放 / 拖进度搬进版本卡，别复制一份。
- `nodes/useNodeResultHistory.ts` 里「只在选中时有效、点别处就失效」的打开条件删除（铺开改成持久、可多开）。
- `nodes/BaseGenerationNode.tsx` 里所有 `!resultStackOpen` 条件删除：`:126`（预览）、`:196`（拖进时间轴把手）、`:221`（生成浮框）、`:255`（空节点工具条）、`:294`，以及 `:488` 的托盘挂载——铺着也要能接着生成。
- `components/CardStackPeeks.tsx`：背后叠卡边缘保留（收起态照旧），触发用的「N 版」胶囊换成版本图标 + 数字。
- i18n `generationCommon.resultStack.*` 里只属于托盘的键随托盘删除；新增图标悬停名、「第 N 版」、提示文案（中英都要）。

## 4. 分段派工（每段一个新的 Codex 会话，medium；上一段验收过才派下一段）

- **V1 数据层**（不碰界面）：结果身份单一化；持久序号 + 旧数据补号；铺开状态字段 + store action；设主图 / 删除走可撤销画布事件；删除两段式 + 延后真删文件（撤销日志挤出、项目卸载、App 退出三个触发点，一个执行点）；单测 + 变异校验（把 `mergeResultHistory` 改回自拼身份、把真删改回立刻删，相应测试必须红）。
- **V2 画布渲染**：版本卡层（同节点大小默认、右放不下往左、8 张 +「+N」换行、分组细线、遮挡避让、层级）；入口图标；悬停条；点卡片预览；视频卡；拖卡＝拖组；Alt 拖出复制；排头重拍卡；提示条（设主图写明下游几个节点「下次生成会用它」、删主图写明哪一版成为主图）；删旧托盘与 `!resultStackOpen`。
- **V3 验收**（协调会话主导，Codex 修问题）：见 §6。

## 5. 不动项

- 「新生成的版本自动变主图」维持现状（样张 README 第 17 条，要改归下一刀）。
- 分镜表、制作流程与镜头认领的语义。
- 下游节点换主图后不自动重跑、不自动花钱（提示文案照样张写「下次生成会用它」）。

## 6. 验收门（缺一不算完成）

- **样张逐项对账**：样张 README「样张里能做的」10 条 + §1.5 控件层级表逐行，在真实应用里一条条走，截图并排。
- **真机走查**（R13 眼见链）：Windows 开发版，真实素材（`NOMI_REAL_MEDIA_DIR` 登记过的图片与视频），中英两套截图我亲眼看过：收起态、铺开、同时铺开两个再拖第三个、悬停条、设主图提示、删除 + 撤销（按钮与 ⌘/Ctrl+Z 两条路）、12 版的「+N」、贴右边往左铺、制作镜头的重拍卡、视频卡拖进度。
- **真实用户任务 ≥3 条**跑通：①反复出图后挑一张定主图、下游节点再生成用的是新主图；②删掉两张废片、撤销一张、关项目再开，被删的文件真的没了、撤销的那张还在；③制作镜头点重拍卡，新版本落在排头、编号接着涨。冒出的问题全修掉。
- **持久化**：铺开状态、版本序号关项目再开仍在；旧项目（没有序号字段）打开后编号从 1 连续。
- **性能**：一个节点铺开 12 版、画布上同时铺开 3 组时拖动画布不掉帧（用现有画布性能门岗的真实素材跑）。
- 门岗：`check:filesize`、`check:tokens`、`check:i18n`、`check:icon-semantics`、`check:vocabularies`、核心冒烟（空项目 / 用过的项目）。

## 7. 回滚

新字段都是可选的：回滚＝撤掉版本卡层、恢复旧托盘（git revert），项目里留下的序号与铺开字段被旧版忽略，无害。延后删除的文件在回滚后照旧由「项目卸载 / App 退出」删掉；万一崩溃留下没被引用的生成文件，只占空间（记 TODO：启动时清理未被引用的生成文件）。

## 先查别人

- 卡片解剖借 AI Elements 的 Artifact（头＝标题 + 动作组，内容是纯媒体、永不被盖）与 Queue（悬停才出动作）：映射表 `docs/design/2026-09-01-agent-ui-final-redesign.md:124`、`:129`。
- 动作条浮在目标上方、不压内容：Beautiful UI 的 Selection Actions（https://beautifului.dev ，样张子代理 2026-09-28 实查现役页面）。
- React Flow 自带「选中节点提层」`elevateNodesOnSelect`，默认开（https://github.com/xyflow/xyflow/blob/main/_autodocs/api-reference/react-flow.md ）；Nomi 关掉了它（`src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowViewport.tsx:209`），改由自己的样式把选中节点抬到 5（`src/workbench/generationCanvas/reactFlow/generationCanvasReactFlow.css:35`），版本卡的层级沿用这一张表，不重新打开内核提层（内核会越过框 / 折叠卡的分层）。
- 竞品：LibTV 做的是画布级全局「历史记录」（`docs/product/2026-09-07-libtv-full-feature-by-feature-comparison.md:51`），节点级版本怎么摆没有竞品证据，这版是自家推导。
- 撤销沿用仓库已有的事件日志（`src/workbench/generationCanvas/events/canvasUndoJournal.ts:1`），不另写一套。
