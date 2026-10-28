# 设计卡：导演台收进生成页（修右侧漏画布、切页出不去、小球被盖）

```
改动名：导演台（和全景查看器）改挂生成页那一格    线/负责人：I-director-layer-in-page    类别：[其他]（纯 bug 修复；版面是用户当面对比选定的，不新增界面）
```

> 方向检查：[`2026-10-29-director-layer-in-page.direction-check.md`](2026-10-29-director-layer-in-page.direction-check.md)。复现与 before 截图：`coord-handoff/reports/R-blockers-repro.md` 第 3–5 节。
> 用户原话与拍板：「2.导演台 我打开以后 画布右侧还有漏出」；「点入导演台之后呢？然后我点其他页面我都出不去了。我点创作也出不去，预览也出不去。」；对比里选「**收进生成页（推荐）**」——导演台变成生成页里的一块，点创作 / 预览就切走、回到生成页它还开着；右边 Agent 不管停靠、浮窗还是小球，都不漏画布、不被盖住；左栏点得到。

## ★1 用户怎么用

当我打开导演台看预演，我想一边和右边的 Agent 说话改它，一边随时切去创作页看文稿、再切回来，导演台还是刚才的样子。

1. 生成页选中导演台 → 点「进入」。
2. 导演台占满生成页那一格；Agent 停靠时在右边，浮窗或小球时浮在它上面，点得到。
3. 点顶栏「创作」→ 看到创作页，导演台不见了。
4. 点「生成」→ 导演台还开着，镜头和选中都没变。
5. 左栏任意按钮都点得到。
6. ← 或 Esc → 确认 → 退出。

**不做什么**：不改导演台内部（视口、时间轴、顶栏五簇）；不改外壳布局；不加控件，不改文案。

**已知坑**（动手前列全，★9 逐条验）：

- Esc：导演层的 Esc 监听在 window 捕获期、会 `stopPropagation`。切到别的页面时导演层藏着，不许吃掉那一页的 Esc。
- 导演台快捷键（`useDirectorHotkeys` 在 window 捕获期 `preventDefault + stopImmediatePropagation`）、视口漫游键、创作模式 Esc、面板 Esc：隐藏时一律不触发。
- 隐藏时 3D 渲染循环停（R3F 的 `frameloop`），至少不能拖慢别的页面；暗色锁（导演台永远暗，锁是整个 App 的）隐藏时释放，否则创作页会跟着变暗。
- 设置 / 帮助 / 手机连接对话框、退出确认框、浮层菜单本来就在 body 上走全局层级刻度，照样在最上面（核）。
- 停靠栏开关、拖宽变窄时，3D 画布要跟着改尺寸（页格变了，R3F 的 ResizeObserver 接得住，走查量）。
- 生成页「画布 | 列表」：列表开着时导演层也跟着藏（和切页同一条规矩，不留第二个「出不去」）。
- Windows 的 40px 系统拖拽带：页格本来就在顶栏下面，导演层的顶偏移那套对它不再需要，同提交删掉；删前核 `docs/fixes/2026-09-04-fullscreen-overlay-windows-windowbar.root-cause.json` 的场景仍成立（页格与顶栏矩形由构造不相交，仍成立）。
- 回项目库时导演层要卸载（现状就是，核）。

**2–3 条真实任务**（隔离资料目录、零额度，不碰用户真实项目；不调 Agent 真模型）：

- T1：新建项目 → 生成页 → 加导演台节点 →「进入」→ Agent 在三种形态间切（停靠 / 浮窗 / 小球）→ 每种都量几何与命中 → 点创作、预览、再回生成。
- T2：导演台开着，点小球叫出 Agent，浮窗拖到导演层上面，再收回小球。
- T3：← 退出确认、Esc 退出确认；在创作页按 Esc 不出现导演台退出确认；回项目库后导演层不在 DOM。

**指标**（目标 → 信号 → 指标，量具都点名）：

| 指标 | 基线（main 构建） | 目标 | 量具 |
|---|---|---|---|
| 主：导演层矩形 = 页格矩形（3 种 Agent 形态 × 2 种窗口尺寸） | 浮窗 2/2 不等（右缘多留 `assistantWidth + 8`），小球 / 停靠矩形碰巧近似但不是页格 | 6/6 相等（±1px） | `tests/ux/director-layer-in-page.walk.mjs` 的几何段 |
| 护栏 1：点创作 / 预览后导演层不可见 | 0/3（点了仍盖在最上） | 3/3 | 同上「切页」段 |
| 护栏 2：切回生成后导演台还在、镜头与选中不变 | 不适用（切不走） | 全保持 | 同上 |
| 护栏 3：导演台开着时左栏按钮命中落在按钮上 | 0/2（命中落在导演层上） | 2/2（文稿、素材） | 同上「左栏」段 |
| 护栏 4：隐藏时 3D 渲染循环停 | 不适用（切不走） | 隐藏 3 秒内 WebGL 绘制调用 = 0；CPU 接近空闲 | 同上「隐藏时不渲染」段（`app.getAppMetrics` + 绘制计数），前后数字进报告 |
| 守门：body 级全屏层必须登记 | 0 条登记 | 每个 `createPortal(…, document.body)` / `<BodyPortal>` 都有登记，没登记就红 | `src/workbench/pageLayerCensus.test.ts`，登记在 `scripts/pre-push-scan-guards.mjs` |

## ★1b 连带界面

- Agent 浮窗和小球的层级：在导演层之上（页格内导演层 `z-[40]`，Agent 层 `z-[60]`）。
- 退出确认框、导演台设置 / 帮助 / 手机连接对话框：走全局刻度，仍在最上面。
- 全景查看器（`PanoramaViewer`，同类）：同一挂法，见 ★9-9。
- 文案不变（i18n 零改动）。

## ★2 谁说了算

- 版面归 `GenerationWorkspace` 的网格（画布那一格 `.workbench-generation__canvas`）。导演层不再自己算右边：删 `assistantPaneWidth` / `projectAgentDockCollapsed` / `currentFullscreenOverlayTopOffset` / `FULLSCREEN_Z_INDEX` 在导演层里的读法。
- 「页内全屏层挂在哪」的挂载点由 `GenerationWorkspace` 提供并命名，唯一一处：`src/workbench/generation/pageLayer.tsx`（组件 `GenerationPageLayer`）+ `pageLayerContext.ts`（上下文：挂载点元素 + 这一格此刻看不看得见）；`DirectorNode` / `PanoramaViewer` 经 `GenerationPageLayer` 挂进来。
- 「看不看得见」归 `WorkbenchShell`：生成页槽位的 `active`（它本来就写 `hidden`）经 `GenerationWorkspace` 的 `active` 传进挂载点；`GenerationWorkspace` 再叠上「画布 | 列表」视图，得到这一格的 `active`，一份。
- `open` 仍是节点本地的（`DirectorNode`），事实只有一份。
- 概念：新增 `ui.generation-page-layer`（`docs/engineering/concept-owners/`），只占这一个；`ui.window-chrome-band` 的说明里把导演台 / 全景从「让开顶栏的全屏层」名单拿掉。`node scripts/door-map.mjs GenerationPageLayer` 数入口。

## ★3 一致与复用

- 生成页里已有的、浮在画布上的层：Agent 小球 / 浮窗所在层（`z-[60]`）、迷你预览（`z-[8]`）、列表（`z-[8]`）、返回对话（`z-[61]`）；画布内的浮件最高 `z-[30]`。导演层放在它们下面一档（`z-[40]`），不新造第二套 z-index 常量。
- 画布那一格里已有三处按 class 名查找 `.workbench-generation__canvas` 再 `createPortal` 的旧例（`NodeMediaPreviewDialog` / `NodeShotCutPanel` / `ScreenshotCropOverlay`，行为是盖住 Agent 的模态灯箱）。它们的找法是第二种，本 PR 不改它们的行为（设计实验室有四个夹具靠这个 class 活着）；普查把它们登记为「存量，只减不增」，不许再多一处。
- `FULLSCREEN_Z_INDEX`：唯一的生产用户是导演层，换挂法后没有用户，同提交删，连同 `scripts/overlay-z-baseline.json` 里的基线和 `feedbackLayer.test.ts` 里的相关断言。
- 层级刻度（`overlayLayers`）照旧：页内层是页格里的局部层叠（地板以下，非 fixed），不进刻度；body 上的全局层仍走刻度。

## ★4 全状态

| 状态 | 用户看到什么 |
|---|---|
| 打开（停靠 / 浮窗 / 小球） | 导演台占满页格；停靠时 Agent 在右边列里，浮窗 / 小球浮在导演台上面，点得到 |
| 切走（点创作 / 预览） | 导演台随生成页一起隐藏；创作 / 预览页按它们自己的明暗显示（暗色锁释放） |
| 切回 | 导演台原样还在（视图面、选中、播放头都没变），暗色锁重新生效 |
| 列表视图 | 列表开着时导演台隐藏，切回画布还在 |
| 退出确认中 | 确认框在最上面（全局层，9300） |
| 回项目库 | 导演层卸载（`editorInDom = 0`） |
| 窗口很小（1280×720） | 照样不漏、不盖左栏；导演台在更小的页格里排版（截图核对） |
| 栏宽变化（停靠栏拖宽 / 变窄、时间轴展开） | 3D 画布跟着页格改尺寸 |
| Windows | 无系统拖拽带冲突（页格在顶栏之下由构造保证；真机未测 → `unverified`） |
| 能力不可用 / 取消中 | 不适用：不涉及模型或外部资源 |

## ★9 验收与回滚

实现线自验，附「反例 → 结果 → 证据」表；验收线只核这份。「页格」= `.workbench-generation__canvas` 的矩形（`GenerationPageLayer` 的外层元素与它同矩形）。

1. 浮窗：1440×900、1920×1080 下，导演层右缘 = 页格右缘，导演层外没有可点的画布（命中测试：页格右侧一排点位命中 Agent 层 / 外壳，不是 `director-node` 或画布元素）。
2. 停靠：导演层不和停靠栏重叠（导演层右缘 ≤ 停靠栏左缘）。
3. 小球：小球在导演层之上，可见、可点，点开 Agent 正常（先变浮窗，输入框可聚焦）。
4. 点「创作」「预览」→ 导演层不可见；点回「生成」→ 导演层可见，选中的镜头没变。
5. 导演台开着时，左栏「文稿」「素材」点得到（命中测试落在按钮上，真点一次抽屉能开）。
6. ← / Esc → 确认 → 退出正常；在创作页按 Esc 不会触发藏着的导演台退出（不出现确认框）。
7. 隐藏时导演台快捷键不触发（在创作页按导演台的快捷键，如 `1` `2` `3` / Delete / Cmd+Z，导演台状态不变、事件没被吞）。
8. 中英两轨截图覆盖 1–5，自己亲眼看过（Read），和 before 截图并排放进报告。
9. PanoramaViewer：照 2c 的步骤复现。有同样的问题就同一 PR 同样修；没有就写证据。（先在未改的 main 构建上复现，改后再验。）
10. **结构门岗**：
    - 普查测试：`src/workbench` 里所有 `createPortal(…, document.body)`（含 `<BodyPortal>`）都要登记归属（页格内 / 外壳模态 / 锚定浮层）和生命周期，没登记就红，登记里多出来的（文件已经不是 body portal）也红。
    - 导演层、全景查看器登记为页格内（经 `GenerationPageLayer` 挂载，不再是 body portal）。
    - 测试文件登记进 `scripts/pre-push-scan-guards.mjs` 的 `SCAN_GUARDS`（`roots: ['src/workbench']`）。
    - `windowChrome.test.ts` 的名单同步改：导演台 / 全景从「让开顶栏的全屏层」名单搬到页格内；整窗 fixed 根分类补认 `fixed inset-x-0`。
11. 现成走查 `tests/ux/director-3dbox-shell.walk.mjs`（及导演台相关 e2e：`director-windowbar`、`shell-redesign` #50、`smoke`）中英都过；`director-3dbox-shell` 加 `--en`。

**反例 → 结果 → 证据**（动手前列，实现后填）：

| 反例 | 期望 |
|---|---|
| Windows 顶偏移 | 页格由构造在顶栏下；`windowChrome` 相关断言通过；真机 `unverified` |
| 导演台开着时关项目（项目菜单「回项目库」） | 导演层卸载，库页 DOM 里没有 `director-editor` |
| HMR / StrictMode 重挂 | 挂载点是 GenerationWorkspace 里一个 state（ref 回调只在整格卸载时才给 null，结构测试钉住这个写法）；Fast Refresh 保留 state / ref。仓库的单测环境没有 DOM，渲染期行为靠走查（反复退出再进入、第二个节点先后打开）；Fast Refresh 本身是 dev 专属、未单独验，记 unverified |
| 两个导演台节点先后打开 | 第一个关闭后第二个正常挂进同一挂载点，页格里始终最多一层 |
| 浮窗拖到导演层上面 | 浮窗仍在导演层之上，点得到 |
| 停靠栏拖宽或变窄 | 3D 画布 canvas 尺寸跟着页格变（走查量 `canvas` 的 clientWidth） |
| 时间轴面板展开 / 收起 | 页格高度变，导演层跟着，不被时间轴盖也不盖时间轴 |
| 导演台里按 Delete / 滚轮 | 不删画布节点、不缩放画布（事件被壳根拦住，页格是画布的兄弟） |
| 隐藏时的 Esc / 数字键 / 撤销键 | 创作页（或预览页）自己的处理照常，导演台不动 |
| 列表视图切换 | 切到列表时导演层隐藏，切回还在；列表里 Esc 不触发导演台退出 |
| 录运镜中切走 | 录制不在后台悄悄继续（切走即放弃本次录制，和 Esc 同语义） |

**回滚**：revert 这一个 PR。数据格式不变，没有迁移。

**证据口径**：这是用户当面拍板的版面改动（before 截图在复现报告里）。门岗按路径特征判（新增了生产 `.tsx` 文件 `generation/pageLayer.tsx`，且路径落在 `src/design`/`generationCanvas`/`nodes/director/`），所以这个 PR 属于「新界面」四类，不能用例外：**协调 2026-10-29 拍板走认领拍板图这一条路**——不改代码绕门岗（不把组件改写成 `.ts` 去避开「新增 .tsx」的判法），也不改门岗例外。拍板图清单是 [`docs/design/boards/2026-10-29/DirectorInPage.board.json`](../design/boards/2026-10-29/DirectorInPage.board.json)：没有画布与候选文件的轻量人工普查板（17 个元素：16 个 implemented、1 个 missing——全景「回到生成页还开着」没做到，见板里 `panorama.back-keeps` 与报告；19 条旧功能去处、3 条先查别人），断言名都挂在 `tests/ux/director-layer-in-page.walk.mjs` 里。PR 正文 `## 拍板图` 认领那 16 个 implemented 的元素；`## 验收证据` 写拍板原话与 before / after 截图路径（`docs/evidence/2026-10-29-director-layer-in-page/`）；清单的批准身份由协调确认（哈希），不由 PR 自己给。

### 功能分类
门岗对「功能分类」的口径是只许比路径推出的多、不许少，所以路径推出的四类全勾；右边写的是这一刀实际动了什么。
- [x] 新界面 / 改交互（改版面：导演台、全景查看器的挂载位置；不新增控件、不改文案）
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [x] 大数据量 / 画布 / 长列表（路径推出：`src/workbench/generationCanvas/`；实际不碰数据规模，只是画布那一格里多挂一层）
- [x] 生成效果（路径推出：`nodes/director/`；实际不碰任何生成链路，只动挂载、可见性与键盘 / 渲染监听）
- [ ] 数据格式
- [x] 新增功能 / 性能（路径推出：`.tsx`；实际没有新增功能，唯一的性能后果是藏着时停 3D 渲染循环——只会更省，前后数字见走查报告）
