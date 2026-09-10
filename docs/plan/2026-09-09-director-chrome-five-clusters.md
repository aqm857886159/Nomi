# 导演台外壳重排：四条控件带收成五个悬浮簇

状态：🚧 三期实现完成，验证中，未提交。样张已获用户拍板，见 artifact「导演台重设计」。
第 1 期顶栏五簇 + 删三条视口浮层、第 2 期右栏改成浮起的双卡、第 3 期时间轴空态收成一条，均已落地并过真机走查。

导演台现在是设计系统 §1.5.4 点名的那个反例：一整行顶栏之外，视口上还压着三条控件带 —— 左缘竖排 4 个创建按钮、底部中央一条塞了 8 个功能簇却只有一根分隔线且没有段名、右下角还有第四条显示模式。用户在画面中央工作，动作却散在四条边上，且「加灯光 / 加几何体」在创建栏和资产库各有一个家，违反一功能一个家。

本次按设计系统 §1.5.3 的手法优先级搬迁：**先分组、再去重、再归位，收纳只用在画幅与显示偏好这两类低频项**。收成五个常驻簇 —— 场景 ▾ ｜ 视图 ▾ ｜ 工具 ｜ ＋添加与历史 ｜ 交付，正好卡住 L1「每个面 ≤5 个功能簇」的预算。没有功能被删，也不留第二个入口当逃生口。

## 范围（第 1 期）

改：`DirectorEditor.tsx`（三个创建模式 hook 上提到 EditorBody，顶栏改悬浮五簇）、`DirectorViewport.tsx`（改吃 props、去掉三条浮层挂载）、`ViewportToolbar.tsx`（降级成五簇里的「工具」簇）。
新增：`panels/topbar/DirectorTopBar.tsx`、`panels/topbar/AddObjectMenu.tsx`、`panels/topbar/ViewMenu.tsx`、`panels/CreationModeContext.ts`。
删除：`panels/CreationBar.tsx`、`panels/BottomBar.tsx`、`panels/ModelDisplayModeSwitch.tsx`（同 commit 删，不留并行版）。
连带：i18n 新键、6 份走查的选择器（`_directorLab.mjs` 是共享助手，改它覆盖大半）、三份 L2 `CLAUDE.md`。

**不动项**：three 世界与 `scene/` 全部；检查器内部字段；画中画的进出机位与 FOV（`进入视角` 本来就住它的底栏）；POV 卡；骨骼页交互（2026-09-09 用户拍板：沿用现状）；上下两卡的分栏比例键 `director.side`。

## 第 2 期：右栏改成浮起的双卡（已实现）

`SidePanels` 从「带左边框的实心列」改成浮起的双卡：圆角 / 描边 / 阴影与顶栏五簇同一套浮层语言，卡间留空让壳底色透出来。列宽自持久到 `nomi:director:sideWidth`（左缘拖把手 + 方向键 + Home/End，与 `EditorSplit` 同手感）。横向分栏键 `director.main` 随之退役，同 commit 删掉读取点；上下两卡的比例键 `director.side` 不变，老用户的分栏记忆不丢。

**先做错了一版，记在这里防复发。** 最初照样张做成绝对定位、浮在视口之上，让 3D 画面从卡片下连贯穿过。真机走查当场红：j1 的「方块落地」等不到 —— 世界坐标右侧那条区域**看得见但点不到**，指针先被卡片吃掉，射线拾取根本没机会跑；同一张截图里画中画的剪裁矩形还被画到了镜像位置。两个现象一个根：**卡片一浮起来，3D 画布的可用几何就和它错位**，而点选、剪裁、取景框全都从那个几何 derive。

视口是要按像素点选和取景的面，不允许有「看得见点不到」的暗区（与控件契约 C1 同类）。最终形态因此是**浮起来的样子 + 仍留在布局流里**：视口按 flex 让出宽度，几何回到同一个坐标系，一个暗区不留。相比样张只损失一点 —— 3D 网格在卡片处止步，不再从底下穿过去。判据写进了 `SidePanels` 的 POS 注释，防止后来者再改回绝对定位。

**第二个坑：`backdrop-blur` 会吃掉真实鼠标事件。** 卡片最初照顶栏五簇的样子加了 `backdrop-blur`，资产走查随即红在「双击资产入场」：
行还在、命中测试也命中它，但 React 的 `onDoubleClick` 收不到。用 JS 派发一次 `dblclick` 却立刻生效 —— 也就是说
**只有真实输入被吃掉，合成事件不受影响**，单测、类型、门岗全都发现不了，只有真机走查能撞见。
判定：装着可拖拽行的容器上不要用 `backdrop-filter`。这里的卡片压的是壳底色而非 3D 画面，模糊本来也换不来什么，去掉即恢复。
顶栏五簇没有可拖拽行，`backdrop-blur` 保留。

## 第 3 期：时间轴空态收成一条（已实现，与样张有一处有意偏离）

轨道区一个实体都没有时，时间轴钉成 `TIMELINE_EMPTY_PX`（头部 36 + 一条 26），有轨道立刻回到用户自己的分栏比例，比例记忆不动。

**与样张的偏离**：样张里空态只剩一句提示。照做会把「+ 添加轨道 ▾」一起收掉，而那是把实体放上时间轴的**主路径**，收了就是死胡同（控件契约 C1 的同类问题）。所以这条窄条左边放提示、右边保留完整的「轨道列表 (0) ｜ + 添加轨道 ▾」，复用 `TrackListHeader` 本体而不是另写一个按钮。

**回滚**：三期改动都在同一 commit，`git revert` 即回到四条带的形态；没有数据结构变更，工程文件不受影响。localStorage 只新增 `nomi:director:sideWidth` 一个键，`director.main` 退役后不再读（旧值留着无害）。

## 搬迁表（逐条，一功能一个家）

| 原来住哪 | 现在住哪 | 手法 |
|---|---|---|
| 视口左缘 · 角色 / 机位 / 灯光 / 方块 | ＋添加 ▾ | 归位（本来就是一个心智） |
| 底栏 · 导入 720 全景 | ＋添加 ▾ › 导入 | 归位 |
| 底栏 · 群众矩阵 | 角色属性卡 | 归位（选中角色才有意义 = 情境层） |
| 底栏 · 骨骼与 IK 把手 | 视图 ▾ | 归位（它是视口显示开关，不是角色属性） |
| 底栏 · 画幅与分辨率 / 三分线 | 视图 ▾ | 收纳（低频） |
| 右下 · 实体 / 半透 / 白模 + 设置 + 帮助 | 视图 ▾ | 收纳（低频） |
| 底栏 · 撤销 / 重做 | ＋添加与历史簇 | 分组 |
| 底栏 · 截图 / 产出 | 交付簇（右上） | 分组 |
| 底栏 · AI 搭场景 | 视口底部中央常驻胶囊（折叠即入口，展开成浮条） | 归位 |

## 先查别人

- 依赖里已有？浮层定位不自己造：`src/workbench/generationCanvas/nodes/director/panels/Popover.tsx:1` 已是 BodyPortal + 按触发器矩形 fixed 定位 + 外点/Esc 关闭的原语，五簇的两个菜单直接复用它；`NomiSegmented` / `WorkbenchIconButton` 出自 `src/design`，不新写按钮。
- 仓库里已有？悬浮顶栏必须让开 Windows 自绘窗口栏，判据与唯一入口是 `src/ui/app-shell/windowChrome.ts` 的 `currentFullscreenOverlayTopOffset()`，根因合同 `docs/fixes/2026-09-04-fullscreen-overlay-windows-windowbar.root-cause.json` 已把这条钉死；本次顶栏沿用它，不另算偏移。
- 生态里已有？把控件浮在一整块视口上、而不是切分窗口，是 3D 编辑器的通行做法：Blender 的区域与浮动面板（https://docs.blender.org/manual/en/latest/interface/window_system/regions.html）。判据不抄外观，只取「画面连贯优先」这一条。
- 判据来源在自己家：控件该住哪一层由设计系统 §1.5 决定（L1 ≤5 个功能簇、一功能一个家、收纳是最后一招），本次搬迁表逐条对着它写，`docs/design/nomi-design-system.md:109`。
- 结论：没有可引的现成实现，也不需要 —— 这是把已有控件按自家层级规则重新归位，新增代码只有两个菜单的装配。

## 验收门

1. 门岗：`check:controls` / `check:i18n` / `check:dangling-tailwind` / `check:root-cause-contracts` / `check:filesize` / `check:boundaries` / `check:walkthroughs` / `check:test-waits` / `lint:ci` / `typecheck` / `check:test-types` 全绿。
   （`check:vocabularies` 红的是 `contextService.ts` / `productionShotActions.ts` 两处类型联合，本次未碰这两个文件，是分支相对 origin/main 的存量漂移。）
2. 八条导演台走查串行全绿：真机 `director-electron`、j1 三人场景、j3 三机位、j6 产出、j7 骨骼、j8 项目交互、windowbar 窗口栏、assets 资产库。**必须串行**：并行跑时机器争用会把视觉安定检查和 8 分钟首屏等待逼红，本轮已误判两次。
3. 亲眼核对截图（R13）：顶栏五簇在位且不压画中画 / 右栏页签；视口四边不再有控件带；空态时间轴只剩一条且「+ 添加轨道」还在；右侧卡片浮起但不制造点不到的暗区。
4. 与获批样张逐项对账（R8）：五簇的成员与顺序、两个菜单的分组名与条目、双卡的圆角与卡间留空。
5. windowbar 走查实测顶栏按钮最高 `top ≥ 32`（Windows 自绘窗口栏拖拽带之外）——这条是 2026-09-04 根因合同钉住的不变量，顶栏改悬浮后必须重验。
