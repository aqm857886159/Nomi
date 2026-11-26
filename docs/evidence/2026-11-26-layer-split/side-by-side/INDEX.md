# 图层分离 PR1 · 拍板图 | 真截图 并排索引

- 板：docs/design/boards/2026-11-26-layer-split/LayerSplit.board.json（拍板稿 S-E 第 13 版渲染图，渲染图在协调会话目录 s-de-canvas/v-1126，不进仓库；渲染早于 C-D12 / C-D13，所以板图上还是旧位置、旧悬停）
- 真截图构建：分支源码提交 `573944e73`（第 2 轮全部修完 + 合 origin/main 之后）。final-zh-1280 / final-en-1280 / final-en-1100 / final-zh-700 = tests/ux/layer-split.walk.mjs 四档窗口；stA（中文浅色）/ stB（英文暗色）/ stC（英文暗色长标题）/ stD（中文浅色，只让拆图失败）= 同一构建上 tests/ux/ui.mjs 补拍。假 APIMart 替身；running 用替身延迟返回（pendingPolls），失败用 failTasks=1（只让第一个任务、也就是拆图失败）。
- 唯一例外：pro-fixed 中文那张沿用上一轮构建 f280a1bcd 的截图（本轮没改中文文案）。
- 元素状态（board.json 的 status）本 PR 不翻，等另一条线逐态核过再翻。

| 元素 id | 状态 | 并排图 | 真截图来源 | 断言 / 说明 | 提交 |
|---|---|---|---|---|---|
| layers.entry | zh 浅色 · 菜单展开 | [entry.zh-light.png](entry.zh-light.png) | final-zh-1280/LS01-refine-menu.zh-CN.light.png | layer-split.walk.mjs LS01：「生成新图」第一项 + 叠层图标 | 573944e73 |
| layers.entry | en 暗色 · 菜单展开 | [entry.en-dark.png](entry.en-dark.png) | final-en-1280/LS01-refine-menu.en.dark.png | 英文轨 LS01「Split layers」 | 573944e73 |
| layers.entry | 缺模型（不灰 · 点名去接） | [entry.no-model.png](entry.no-model.png) | final-zh-1280/LS09-no-model-guide.zh-CN.light.png | LS09 / LS10：第二行点名 APIMart，点了打开接入页（D-1126-se-missing-model-guide 取代板上「灰 + 原因」） | 573944e73 |
| layers.entry-whiteboard-hint | 悬停（原生 title） | [whiteboard-hint.zh-light.png](whiteboard-hint.zh-light.png) | final-zh-1280/LS04-split-landed.zh-CN.light.png | 原生 title 截图拍不到，走查断言 title =「在画板中编辑图层」/ en「Edit the layers on the whiteboard」 | 573944e73 |
| layers.derived-node | zh 浅色 · 1280×800 · 选中 · 已备好 · 未生成 | [derived-node.zh-light.png](derived-node.zh-light.png) | final-zh-1280/LS02-derived-composer.zh-CN.light.png | 第 5 项：新节点在原图右边（走查断言 LS01b 落点）；1 节点 1 边，提示词空，0 次请求 | 573944e73 |
| layers.derived-node | zh 浅色 · 1280×800 · 刚派生（原图工具条在上） | [derived-node.zh-landed.png](derived-node.zh-landed.png) | final-zh-1280/LS01b-derived-landed.zh-CN.light.png | LS01b 整屏：原图右边、和原图顶对齐；派生后不动画布（D-0925-no-auto-pan） | 573944e73 |
| layers.derived-node | en 暗色 · 1280×800 | [derived-node.en-dark.png](derived-node.en-dark.png) | final-en-1280/LS02-derived-composer.en.dark.png | 「Split layers · Image」+「Ready · not generated」；暗色板上没画派生节点，对照中文浅色板 | 573944e73 |
| layers.derived-node | en 暗色 · 1100×690 | [derived-node.en-1100.png](derived-node.en-1100.png) | final-en-1100/LS01b-derived-landed.en.dark.png | 1100×690 也在原图右边（画布 80%，见差异） | 573944e73 |
| layers.derived-node | zh 浅色 · 700×720 · 落在视口外 | [derived-node.zh-700.png](derived-node.zh-700.png) | final-zh-700/LS01c-arrival-hint.zh-CN.light.png | 700×720 新节点在原图右边、视口外，出「新节点在右侧 →」到达提示，不自动平移（D-0925-no-auto-pan） | 573944e73 |
| layers.composer-cell | zh 浅色 · 默认 | [composer-cell.zh-light.png](composer-cell.zh-light.png) | final-zh-1280/LS02-derived-composer.zh-CN.light.png | 「图层分离 · 30 层 · 自动」 | 573944e73 |
| layers.composer-cell | en 暗色 | [composer-cell.en-dark.png](composer-cell.en-dark.png) | final-en-1280/LS02-derived-composer.en.dark.png | 「Split layers · 30 · Auto」 | 573944e73 |
| layers.params-panel | zh 浅色 · 打开 | [params-panel.zh-light.png](params-panel.zh-light.png) | final-zh-1280/LS03-params-panel.zh-CN.light.png | LS03：8 / 16 / 30 / 自定义、清晰度、识别文字 | 573944e73 |
| layers.params-panel | en 暗色 · 打开 | [params-panel.en-dark.png](params-panel.en-dark.png) | final-en-1280/LS03-params-panel.en.dark.png | 第 10 项：开关「Read text」与说明「Read the text in the image…」同一个动词 | 573944e73 |
| layers.prompt-placeholder | zh 浅色 · 空 | [prompt-placeholder.zh-light.png](prompt-placeholder.zh-light.png) | final-zh-1280/LS02-derived-composer.zh-CN.light.png | 第 8 项：走查断言占位 =「描述希望拆分的图层，留空将自动识别并拆分」，空提示词照样能发 | 573944e73 |
| layers.prompt-placeholder | en 暗色 · 空（长句） | [prompt-placeholder.en-dark.png](prompt-placeholder.en-dark.png) | final-en-1280/LS02-derived-composer.en.dark.png | 英文轨同一断言「Describe the layers to split, or leave it empty to split automatically」 | 573944e73 |
| layers.send-price | zh 浅色 · 印约价 | [send-price.zh-light.png](send-price.zh-light.png) | final-zh-1280/LS02-derived-composer.zh-CN.light.png | 键上「≤8.46」（按层数上限估）；数字来自替身价目，只在本机替身下成立 | 573944e73 |
| layers.send-price | 算不出价（5.0 Pro · en 暗色） | [send-price.unknown.png](send-price.unknown.png) | stB/B04-pro-fixed.en.dark.png | 发送键不印数字、不印 0；单测 vendorPricePreview.test.ts | 573944e73 |
| layers.no-image-hint | zh 浅色 · 0 张图 · 悬停 | [no-image-hint.zh-light.png](no-image-hint.zh-light.png) | stA/A23-no-image-hover.zh-CN.light.png | 第 7 项按板改（C-D13）：悬停第一行「先放一张要拆的图」，下面接发送键通用的约价说明 | 573944e73 |
| layers.no-image-hint | en 暗色 · 0 张图 · 悬停 | [no-image-hint.en-dark.png](no-image-hint.en-dark.png) | stB/B09-no-image-hover.en.dark.png | 「Add one image to split first」+ 通用约价说明 | 573944e73 |
| layers.two-images-hint | 拖第二张图 → 拒 | [two-images.drag-refused.png](two-images.drag-refused.png) | stA/A05-after-drag.zh-CN.light.png | 拖线走 connectToNode → 按声明容量 max 1 拒，提示「目标模型不支持这种参考连线」，边数不变 | 573944e73 |
| layers.two-images-hint | 加参考 → 点选第二张 | [two-images.pick-refused.png](two-images.pick-refused.png) | stD/D04-after-pick.zh-CN.light.png | 点选模式下其余节点全部淡显，点第二张不连（读回边数 1） | 573944e73 |
| layers.two-images-hint | @ 菜单 | [two-images.mention.png](two-images.mention.png) | stD/D05-mention-menu.zh-CN.light.png | @ 只列当前参考「图片1」，选不到第二张 | 573944e73 |
| layers.pro-fixed | zh 浅色 · 5.0 Pro 写死 | [pro-fixed.zh-light.png](pro-fixed.zh-light.png) | I-SE/runC2/C11-pro-fixed.zh-CN.light.png | 本轮没改中文文案，沿用上一轮构建的截图 | f280a1bcd |
| layers.pro-fixed | en 暗色 · 5.0 Pro 写死（长句两行） | [pro-fixed.en-dark.png](pro-fixed.en-dark.png) | stB/B04-pro-fixed.en.dark.png | 第 10 项：「Split layers · up to 17」+ 整句说明，折两行不截断 | 573944e73 |
| layers.node-status | zh 浅色 · 拆完 · 选中 | [node-status.zh-selected.png](node-status.zh-selected.png) | final-zh-1280/LS04-split-landed.zh-CN.light.png | 第 3 + 6 项：「3 层」在节点上方标签行右侧，生成框盖不到（走查断言） | 573944e73 |
| layers.node-status | zh 浅色 · 拆完 · 未选中 | [node-status.zh-light.png](node-status.zh-light.png) | final-zh-1280/LS04b-split-unselected.zh-CN.light.png | 未选中同一位置 | 573944e73 |
| layers.node-status | en 暗色 · 长标题 | [node-status.en-long-title.png](node-status.en-long-title.png) | stC/C02-long-title-unselected.en.dark.png | 标题「Split layers · Seaside short film…」截断，「Layers 3 · incl. base」整块不截 | 573944e73 |
| layers.node-status | zh 浅色 · 700×720 | [node-status.zh-700.png](node-status.zh-700.png) | final-zh-700/LS04b-split-unselected.zh-CN.light.png | 窄窗同一位置 | 573944e73 |
| layers.node-composite | 拆完 · 合成图 | [node-composite.zh-light.png](node-composite.zh-light.png) | final-zh-1280/LS04b-split-unselected.zh-CN.light.png | 底图 + 人物 + 标题文字叠好 | 573944e73 |
| layers.running | zh 浅色 · 拆图层中 | [running.zh-light.png](running.zh-light.png) | stA/A08-running-later.zh-CN.light.png | 替身延迟 10 秒返回抓中间态：今天的等待面 + 状态条「生成中 · 已等 10 秒」（板注「用今天的等待面和状态条」；文案差异见下） | 573944e73 |
| layers.running | en 暗色 · 拆图层中 | [running.en-dark.png](running.en-dark.png) | stB/B05-running.en.dark.png | 「Generating · 3s elaps…」被浮动复制按钮盖住尾巴（今天通用状态条的老问题，见差异） | 573944e73 |
| layers.failed | zh 浅色 · 只让拆图失败 | [failed.zh-light.png](failed.zh-light.png) | stD/D07-failed-unselected.zh-CN.light.png | 替身 failTasks=1：今天通用的失败卡（服务商原话 + 重试 / 换模型）；板上「没拆成 · 没扣费」整句属后续，元素仍是 missing | 573944e73 |
| layers.failed | en 暗色 · 只让拆图失败 | [failed.en-dark.png](failed.en-dark.png) | stB/B07-failed-unselected.en.dark.png | 同上；状态条「generation failed ups…」同样被复制按钮盖住 | 573944e73 |
| layers.done | zh 浅色 · 工具条 | [done.zh-light.png](done.zh-light.png) | final-zh-1280/LS05-board-layers.zh-CN.light.png | LS05：「完成」在画板工具条第二行 | 573944e73 |
| layers.done | zh 浅色 · 悬停 | [done.zh-hover.png](done.zh-hover.png) | stA/A16-done-hover.zh-CN.light.png | 悬停浅蓝底 | 573944e73 |
| layers.done | zh 浅色 · 完成 → 新一版 | [done.zh-new-version.png](done.zh-new-version.png) | final-zh-1280/LS08-done-new-version.zh-CN.light.png | LS08：版本角标 2 | 573944e73 |
| layers.done | en 暗色 · 工具条 | [done.en-dark.png](done.en-dark.png) | final-en-1280/LS05-board-layers.en.dark.png | 「Done」 | 573944e73 |
| layers.whiteboard-scale | 选中 · 四角手柄 | [whiteboard-scale.zh-selected.png](whiteboard-scale.zh-selected.png) | stA/A14-scale-selected.zh-CN.light.png | 选中人物层出四角手柄 | 573944e73 |
| layers.whiteboard-scale | 拖角后等比 | [whiteboard-scale.zh-light.png](whiteboard-scale.zh-light.png) | final-zh-1280/LS06-corner-scaled.zh-CN.light.png | LS06：拖角后宽高比不变（走查断言） | 573944e73 |
| layers.panel-row | zh 浅色 | [panel-row.zh-light.png](panel-row.zh-light.png) | final-zh-1280/LS05-board-layers.zh-CN.light.png | 行名取接口 name；能删的有垃圾桶，背景不可删 | 573944e73 |
| layers.panel-row | zh 浅色 · 悬停删除 | [panel-row.zh-hover.png](panel-row.zh-hover.png) | stA/A13-panel-row-delete-hover.zh-CN.light.png | 行底变灰，垃圾桶变红 | 573944e73 |
| layers.panel-row | zh 浅色 · 长图层名 | [panel-row.zh-long-text.png](panel-row.zh-long-text.png) | stA/A17-panel-row-long-names-simulated.zh-CN.light.png | 模拟：真窗口里把两行名字换成长中文 / 长英文（DOM 文本替换），单行省略号、眼睛和垃圾桶不被挤走；数据通路未验证 | 573944e73 |
| layers.panel-row | en 暗色 | [panel-row.en-dark.png](panel-row.en-dark.png) | final-en-1280/LS05-board-layers.en.dark.png | 「背景」在英文界面仍是中文：今天所有画板都这样，报协调 | 573944e73 |
| layers.done | loading / disabled | — | — | 未拍：本机保存在一帧内完成，按钮点完即卸载（读回 `gone`），截不到忙态 | 573944e73 |
| layers.whiteboard-scale | hover（角上光标） | — | — | 未拍：截图不含系统光标；A15 拍的是悬停在角上的画面，看不出光标形状 | 573944e73 |
| layers.panel-row | selected / disabled | — | — | 未单独拍：选中层在画布上出手柄（见 whiteboard-scale.zh-selected）；背景行不可删 = 没有垃圾桶（见 panel-row.zh-light） | 573944e73 |

## 和拍板稿的差异（逐条有理由）

- 「N 层」：板上画在节点下方，实现放在节点上方标签行右侧（协调裁定 C-D12，依据用户 09-25 拍板「生成框钉在节点正下方」：选中时生成框会盖住下方那一行）。
- 0 张图悬停：板已按发送键的通用规则改过（C-D13）：第一行原因「先放一张要拆的图」，下面接约价说明，发送键对所有模型同一个悬停。
- two-images-hint（只拆第 1 张）：板上画的「放了 2 张图」在真窗口三扇手动入口都造不出（拖线、点选、@，见 two-images.* 三张）；但 Agent 画布工具 connect_nodes 和 MCP connectProjectNodes 只核种类、不核容量，能建出第二条边，按本 PR 的设计多出的那张淡显「不会发」，所以提示行保留作诚实兜底（单测 layerSplitComposerState 覆盖文案与只取第 1 张）。「容量并进建边总闸」另开一件做，那件里同一提交删提示。
- running：板上画的是节点内左下「● 拆图层中」，板注写「用今天的等待面和状态条」；实现就是今天的等待面 + 节点上方状态条，文案是通用的「生成中 · 已等 N 秒」，没有为图层分离单写「拆图层中」。
- 英文状态条（running / failed）尾巴被节点右上的浮动复制按钮盖住（Generating · 3s elaps… / generation failed ups…）：今天所有节点的通用状态条都这样，不是本 PR 带来的；已报协调。
- failed：board 里 layers.failed 仍是 missing（「没拆成 · 没扣费」整句属后续），本 PR 用今天通用的失败卡；这里只交「只让拆图失败」时的真窗口样子。
- 图层分离方式下参数栏没有「高级设置」图标：参数格由档案数据驱动，这一方式没有高级参数，不是漏画。
- 面板行没有缩略图、没有拖动把手：排序 / 缩略图属 PR2（D-1126-se-split-prs）；面板仍挂在工具条下面，PR2 挪位。
- 英文界面里画板图层「背景」仍是中文：今天所有画板都这样（getDefaultLayers 写死），不是本 PR 带来的；已报协调排后续。英文面板里「标题文字」「人物」是替身返回的层名（接口 layers[i].name 原样显示）。
- 入口缺模型：板上画的是「灰 + 原因」，实现是不灰、第二行点名 APIMart、点了打开接入页（D-1126-se-missing-model-guide 取代原稿）。
- 5.0 Pro 写死格：板上发送键画了「≤6.9」，实现不印数——5.0 Pro 的图层分离价目算不出，协调裁定算不出价时不印数字、不印 0。
- 清晰度下的小字写「2K / 自动 价更高」，板上是「2K 价更高。」：「自动」按高档计价，只写 2K 会让人以为自动便宜。
- 面板行每个能删的层都有垃圾桶（含底图），板上行只画了眼睛：协调 C-E4 裁定「每个能删的行都有垃圾桶」；背景行不可删、没有垃圾桶。
- 「完成」那一格：真截图是画笔刚用完的状态（多出颜色 / 粗细），板上是选择工具；工具条本 PR 没改。
- 英文 1100×690 这一轮画布停在 80%（1280×800 两轨是 100%）：缩放为什么不同没查明（未验证），本 PR 没碰画布首次适配的代码；落点断言按节点相对位置，与缩放无关。

PR2 / 后续的元素（whiteboard-panel、panel-reorder、panel-multiselect、panel-virtual、base-row；extract-button、extract-result、agent-pointer）本 PR 没做，不出并排图；failed 只交今天通用失败卡的真窗口样子（见上）。
