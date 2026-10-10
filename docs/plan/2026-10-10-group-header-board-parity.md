# 分组框头对齐拍板样张（2026-10-10）· 设计卡 + 功能普查

> 线：I-groupheader 第二段（框头改版）。第一段（z 序）已提交 `ee1368885`，见 `docs/engineering/direction-check-2026-10-10-group-layer-order.md`。
> 流程（用户 10-10 拍板）：探索图 → 用生产组件搭出来（设计实验室）→ 出清单（状态覆盖 + 旧功能普查）→ 用户点头 → 实现。
> 本文件只覆盖到「差异清单」。**生产代码未动**，停在清单，等用户拍板。
> 拍板样张：`C:/Users/23732/Desktop/Nomi-交接-20261008/V-1136-approved-renders/Main-1280.png`（亮）、`Main-dark-1280.png`（暗）；源 `design-approved-1008/source/Main.dc.html`（`.grp` / `.grp-h` / `.pillbtn`，约 53–57 行）。

## 设计卡（★ 格）

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当「我在画布上摆好一组镜头，想一眼看到组名、镜数，并直接点『生成全部』」时，框的标题和动作都在框里，不跟节点抢位置。不做：框外标签、框外图标、框头里的重复入口。已知坑：框头被节点压住时要还能点到（见差异 D6）。 | 真实任务：分镜组 6 镜（`docs/evidence/2026-10-06-grouping-compare/`）；人工 |
| ★1b 连带界面 | 「生成全部」与工具条「生成整组」共用一条派发，回执文案不变；折叠 / 删除 / 改名的入口移到右键菜单，文案不变 | `FrameContextMenu` 的 i18n 键，`check:i18n` |
| ★2 谁说了算 | 框的组名 / 说明 / 计数归 `NodeGroup`（store）；「生成全部」只读 `groupEligibleNodeIds`，不另存一份；层级归 `canvasLayerOrder.ts`（已完成） | `node scripts/door-map.mjs runGroupGenerate` |
| ★3 一致与复用 | 按钮用 `WorkbenchButton`（设计系统现有件）；框体用 `GROUP_VISUAL_CLASS.frame`；不新增样式体系。样张的 pill 形（圆角 999、高 26）与现役 `WorkbenchButton`（圆角 workbench-control、高 28）不同，见差异 D3 | `git grep "WorkbenchButton"` |
| ★4 全状态 | 默认 / 悬停 / 选中（工具条露出）/ 拖动中计数 / 改名编辑 / 长组名 / 空组 / 分镜组 / 普通组 / 中英 / 暗色，见下表 | 实验室屏 `canvas-group-header` |
| ★9 验收与回滚 | 本段只出清单，不改生产；拍板后另起一段实现。回滚：revert 实现提交 | 本文件 + 实验室截图 |

## 功能普查（框外标签 → 改版后去处）

来源：`src/workbench/generationCanvas/components/GroupFrameHeader.tsx`（`outside` 分支，生产里 `GroupFrame.tsx:185` 恒传 `outside`）、`GroupFrame.tsx`、`CanvasGroupToolbar.tsx`、`FrameContextMenu.tsx`、`useCanvasFrameActions.ts`。

| # | 功能 | 现在在哪 | 改后在哪 | 测试 ID / 证据 | 备注 |
|---|---|---|---|---|---|
| F1 | 堆叠图标（Stack2） | 框外标签最前 | 删（样张无图标） | — | 纯装饰，不是功能 |
| F2 | 标题前的组色圆点 `[data-group-color-dot]` | 框外标签 | **已在工具条**：颜色菜单的图标显示当前色 | `CanvasGroupToolbar` 的 `group-color` | 框头圆点删 |
| F3 | 组名显示 `[data-frame-title]` | 框外标签 | 框内左上，与计数同一行 | 样张 | 样张另加「分镜 · 」前缀，见差异 D1 |
| F4 | 双击组名改名 | 框外标题双击 | 框内标题双击（保留） | `canvas-frame.walk.mjs`「双击标题进编辑态」 | 编辑态见 hdr-05 |
| F5 | 说明文字（灰字）`[data-frame-description]`，双击编辑 | 框外标题之后 | **拿不准**，见下「需要拍板 P1」 | `canvas-frame.walk.mjs` | 样张没有说明 |
| F6 | 成员计数 `[data-frame-count]` | 框外标签里是 **sr-only**（肉眼不可见） | 框内标题行「· 6 镜」可见（样张） | 样张 | 现役计数不可见，是回归，见差异 D2 |
| F7 | 拖动预览计数「3 → 2」 | 同 F6，只写进 aria-label，**肉眼不可见** | 框内标题行显示（样张要求） | hdr-04 | 同上 |
| F8 | 折叠按钮（小堆叠图标）`aria-label=collapseNamed` | 框外标签右侧 | 删按钮（重复入口）；折叠保留在右键菜单「折叠」 | `FrameContextMenu` `collapse` | 有去处，删重复 |
| F9 | ⋯ 按钮 `[data-frame-more]` | 框外标签最右，打开 `FrameContextMenu` | 样张无 ⋯。菜单内容见 F10–F15 去处 | `canvas-frame-06-menu` | 见 P2 |
| F10 | 菜单「编辑」（改名 / 说明） | ⋯ 菜单 | 右键菜单（框边右键同一份菜单，`useCanvasContextNodeMenu` → `onFrameMenu`） | `canvas-frame-06-menu` | 有去处 |
| F11 | 菜单「生成整框」 | ⋯ 菜单 | 框内「生成全部」+ 工具条「生成整组」（同一派发） | `groupGenerate` 走查 | 已在工具条 |
| F12 | 菜单「进时间轴」 | ⋯ 菜单 | 工具条「进时间轴」 | `CanvasGroupToolbar` | 已在工具条 |
| F13 | 菜单「折叠」 | ⋯ 菜单 | 右键菜单 | `FrameContextMenu` | 有去处 |
| F14 | 菜单「解组」 | ⋯ 菜单 | 工具条「解组」 | `CanvasGroupToolbar` | 已在工具条 |
| F15 | 菜单「删除」（框和成员一起删） | ⋯ 菜单 | 右键菜单 + 选中框按 Delete（`useCanvasFrameActions.ts:112` 同一条） | `useCanvasFrameActions` | 有去处 |
| F16 | 拖动整个组（框体把手） | 框体 | 框体（不变） | `canvas-frame.walk.mjs` | 已在框体 |
| F17 | 标题区不参与拖动（点标题直接改名） | `claimPointer` | 框内标题保留同一规则 | `canvas-frame.walk.mjs` | 保留 |
| F18 | 连线待落点时头部变装饰 | `connectable` | 保留 | `groupConnectionPorts` | 保留 |
| F19 | 「生成全部」（样张新增） | 无 | 框内右上，走 `runGroupGenerate` / `groupEligibleNodeIds` | 同 F11；付费确认只点到确认框为止 | 新入口，同一执行口，不另开口 |

## 需要拍板（停在这里，请用户定）

- **P1 说明字段（F5）去处**。推荐 A：说明并入右键菜单「编辑」（同一个编辑态，名字下面一行说明输入），框内标题只留组名。理由：说明不在样张里，但删掉会丢功能（「改设计不能丢功能」）。备选 B：说明放框内标题行计数之后（会挤长组名）；备选 C：删除说明（丢功能，不推荐）。
- **P2 ⋯ 按钮是否保留**。样张没有 ⋯。推荐删：右键菜单已经是同一份菜单（F10–F15 全有去处）。备选：保留 ⋯ 作为框内右上「生成全部」旁的小入口（与样张不一致）。
- **P3 「生成全部」的付费语义**。它与工具条「生成整组」共用 `runGroupGenerate` 与同一张付费确认。推荐：不改语义，只点到确认框为止。

## 实验室屏（设计实验室，生产组件搭建）

屏 id `canvas-group-header`，登记方式同 `canvas-frame`（`labScreens.ts` + `labStates.mjs` + `calibration.json` 的 `pendingApprovalScreens`）。格子用生产 `WorkbenchButton`、`GROUP_VISUAL_CLASS.frame`、`CanvasGroupToolbar`、`getCanvasGroupBoxes`。基线只能在 darwin 录，本段不录，屏登记在 `pendingApprovalScreens`。

| 状态 id | 内容 |
|---|---|
| hdr-01-default-storyboard | 分镜组默认（6 镜，「生成全部」） |
| hdr-02-hover | 悬停「生成全部」 |
| hdr-03-selected-toolbar | 选中：工具条露出 |
| hdr-04-drag-count | 拖动中计数「6 → 5」 |
| hdr-05-rename | 改名编辑态 |
| hdr-06-long-name | 长组名截断 |
| hdr-07-empty-group | 空组（虚线框、0 镜、「生成全部」禁用） |
| hdr-08-normal-group | 普通组（无「分镜 · 」前缀） |
| hdr-09-en-storyboard | 英文分镜组 |
| hdr-10-dark-storyboard | 暗色分镜组 |

## 差异清单（样张 vs 实验室搭出来）

截图：`tests/ux/shots/group-header-parity/compare-zh-light.png`、`compare-zh-dark.png`、`compare-en-dark.png`（左样张裁切，右实验室）；实验室原图在 `tests/ux/shots/design-lab-canvas-group-header/`。

| 编号 | 图上 | 搭出来 | 为什么不同 | 要不要改 |
|---|---|---|---|---|
| D1 组名前缀 | 「分镜 · 雨夜便利店」 | 同（分镜组加前缀，普通组不加） | 生产组名只有用户起的名字，没有「分镜 · 」；前缀是类别还是组名要定 | **拍板**：前缀是显示规则还是组名本身 |
| D2 计数可见 | 「6 镜」灰字可见 | 同可见 | 现役 outside 标签里计数是 `sr-only`，肉眼不可见（现役回归） | 改（按样张） |
| D3 按钮形状 | 胶囊：圆角 999、高 26、1px 环 | `WorkbenchButton size=sm`：圆角 workbench-control、高 28、边框 soft | 设计系统现役按钮没有胶囊形变体 | **拍板**：接受现役按钮形，还是给设计系统加胶囊变体 |
| D4 框体 | 无边框，只有 inset 1px 环（lineSoft），底色 ink05 约 70% | `GROUP_VISUAL_CLASS.frame`：1.5px 边框 + paper 32% + 阴影 | 框体常驻装饰是现役契约（groupVisualContract），与样张不同 | **拍板**：框体按样张改（动 groupVisualContract）还是保留现役 |
| D5 工具条落点 | 选中时工具条在框上方 | 同，但 `resolveGroupToolbarPlacement` 仍按框外标签预留 `GROUP_LABEL_RISE` | 框外标签删掉后这段预留应为 0 | 改（实现时删 GROUP_LABEL_RISE 的框外用途） |
| D6 框头被压 | 样张无节点压框头 | 框头在框内顶部留 40px 以上，成员不压框头 | 与 `getCanvasGroupBoxes` 的 padding 有关，已量 | 不改，实现时补一条断言 |
| D7 占位卡 | 卡上有「镜 01 雨棚」标签 | 占位块无标签 | 标签属于节点，不属于框头，不在本段范围 | 不改（本段只对框头） |

功能普查里的 P1（说明去处）、P2（⋯ 是否保留）、P3（生成全部付费语义）仍待拍板，见上文「需要拍板」。

**停在这里**：生产代码未动（`GroupFrameHeader.tsx` 等仍是框外标签）。等用户对 D1、D3、D4、P1、P2 拍板，再开实现段。

## 先查别人

1. 依赖里已有？`node_modules/@xyflow/react/dist/style.css:123`（`.react-flow__viewport` 为 z-index 2）、`node_modules/@xyflow/react/dist/style.css:211`（`.react-flow__nodes` 无 z）、`node_modules/@xyflow/react/dist/style.css:342`（`.react-flow__viewport-portal` 无 z）。框架只给层叠上下文，没有跨 ViewportPortal 与节点层的统一 z 接口：层级表必须自己写，但只是几十个数字，不含通用逻辑。
2. 仓库里已有？`src/design/actions.tsx:268`（`WorkbenchButton`，设计系统现役按钮）直接复用，不加胶囊变体（D3）。`src/design/overlayLayers.ts:7`（`NOMI_OVERLAY_Z_INDEX`）管模态浮层（弹窗、菜单），不管画布内的框与节点层，不复用。
3. 生态里已有？`node_modules/@xyflow/react/dist/esm/index.mjs:3273`：视口的子元素顺序是 EdgeRenderer、NodeRenderer（节点层）、viewport-portal（我们的框层挂在这里），框架自己不给框与节点之间的先后。在线文档本次没有检索（Context7 未用），这是诚实的缺口；若框架日后提供跨层 z 管理，按 `docs/engineering/self-written.json` 的 `canvas-layer-order` 条目的 revisitWhen 复查。
