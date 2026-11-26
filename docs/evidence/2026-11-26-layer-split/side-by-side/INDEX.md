# 图层分离 PR1 · 拍板图 | 真截图 并排索引

- 板：docs/design/boards/2026-11-26-layer-split/LayerSplit.board.json（拍板稿 S-E 第 13 版渲染图，仓库外 /Users/aoqimin/Nomi-coord/tmp/s-de-canvas/v-1126/se-*.png）
- 真截图构建：分支源码提交 `a28f3c313`（walk10-zh / walk10-en = tests/ux/layer-split.walk.mjs；runC = 同一构建上 ui.mjs 补拍），假 APIMart 替身。
- 元素状态全部保持 in-progress（待另一条线逐态核过才标 implemented）。

| 元素 id | 状态 | 并排图 | 真截图来源 | 断言 / 说明 | 提交 |
|---|---|---|---|---|---|
| layers.entry | zh 浅色 · 菜单展开 | [entry.zh-light.png](entry.zh-light.png) | walk10-zh/LS01-refine-menu.zh-CN.light.png | layer-split.walk.mjs LS01：「生成新图」第一项 + IconStack2 | a28f3c313 |
| layers.entry | en 暗色 · 1100×690 | [entry.en-dark.png](entry.en-dark.png) | walk10-en/LS01-refine-menu.en.dark.png | walk10-en LS01 | a28f3c313 |
| layers.entry | 缺模型（不灰 · 点名去接） | [entry.no-model.png](entry.no-model.png) | walk10-zh/LS09-no-model-guide.zh-CN.light.png | LS09 / LS10：第二行点名 APIMart，点了打开接入页（D-1126-se-missing-model-guide 取代板上「灰 + 原因」） | a28f3c313 |
| layers.entry-whiteboard-hint | 悬停（原生 title） | [whiteboard-hint.zh-light.png](whiteboard-hint.zh-light.png) | walk10-zh/LS04-split-landed.zh-CN.light.png | 原生 title 截图拍不到，走查断言 title =「在画板中编辑图层」/ en「Edit the layers on the whiteboard」 | a28f3c313 |
| layers.derived-node | zh 浅色 · 已备好 · 未生成 | [derived-node.zh-light.png](derived-node.zh-light.png) | walk10-zh/LS02-derived-composer.zh-CN.light.png | LS02：1 节点 1 边，提示词空，0 次请求（vendor-requests.json） | a28f3c313 |
| layers.derived-node | en 暗色 | [derived-node.en-dark.png](derived-node.en-dark.png) | walk10-en/LS02-derived-composer.en.dark.png | walk10-en LS02 | a28f3c313 |
| layers.composer-cell | zh 浅色 · 默认 | [composer-cell.zh-light.png](composer-cell.zh-light.png) | walk10-zh/LS02-derived-composer.zh-CN.light.png | 「图层分离 · 30 层 · 自动」；让位顺序单测 composerBarYield.layerSplit.test.ts | a28f3c313 |
| layers.composer-cell | en 暗色 · 1100×690 | [composer-cell.en-dark.png](composer-cell.en-dark.png) | walk10-en/LS02-derived-composer.en.dark.png | 「Split layers · 30 · Auto」 | a28f3c313 |
| layers.params-panel | zh 浅色 · 打开 | [params-panel.zh-light.png](params-panel.zh-light.png) | walk10-zh/LS03-params-panel.zh-CN.light.png | LS03：8 / 16 / 30 / 自定义、清晰度、识别文字 | a28f3c313 |
| layers.params-panel | en 暗色 · 打开 | [params-panel.en-dark.png](params-panel.en-dark.png) | walk10-en/LS03-params-panel.en.dark.png | walk10-en LS03 | a28f3c313 |
| layers.prompt-placeholder | zh 浅色 · 空 | [prompt-placeholder.zh-light.png](prompt-placeholder.zh-light.png) | walk10-zh/LS02-derived-composer.zh-CN.light.png | 同 composer-cell 那张图（同态复用） | a28f3c313 |
| layers.send-price | zh 浅色 · 印约价 | [send-price.zh-light.png](send-price.zh-light.png) | walk10-zh/LS02-derived-composer.zh-CN.light.png | 和板一样印「≤」：键上「≤8.46」（按层数上限 30 估、出完按实际层数结算），悬停「最多约 8.46 积分…按层数上限估」（走查断言 aria-description）；数字来自替身价目，只在本机替身下成立 | a28f3c313 |
| layers.send-price | 算不出价（5.0 Pro） | [send-price.unknown.png](send-price.unknown.png) | runC/C11-pro-fixed.zh-CN.light.png | 发送键不印数字、不印 0；单测 vendorPricePreview.test.ts | a28f3c313 |
| layers.no-image-hint | 0 张图 · 悬停 | [no-image-hint.zh-light.png](no-image-hint.zh-light.png) | runC/C12-zero-images.zh-CN.light.png | 发送键灰，悬停「先放一张要拆的图」 | a28f3c313 |
| layers.pro-fixed | 5.0 Pro 写死 | [pro-fixed.zh-light.png](pro-fixed.zh-light.png) | runC/C11-pro-fixed.zh-CN.light.png | 「图层分离 · 最多 17 层」+ 一句说明 | a28f3c313 |
| layers.node-status | 拆完 · 未选中 | [node-status.zh-light.png](node-status.zh-light.png) | runC/C13-node-status.zh-CN.light.png | 「3 层」（替身回底图 + 2 层）；en 文案「Layers 3 · incl. base」见 walk10-en 断言 | a28f3c313 |
| layers.node-composite | 拆完 · 合成图 | [node-composite.zh-light.png](node-composite.zh-light.png) | walk10-zh/LS04-split-landed.zh-CN.light.png | LS04：底图 + 人物 + 标题文字叠好 | a28f3c313 |
| layers.done | 完成 → 新一版 | [done.zh-light.png](done.zh-light.png) | walk10-zh/LS08-done-new-version.zh-CN.light.png | LS08：版本角标 2；工具条与「完成」见 LS05 | a28f3c313 |
| layers.done | 工具条（en 暗色） | [done.en-dark.png](done.en-dark.png) | walk10-en/LS05-board-layers.en.dark.png | walk10-en LS05「Done」 | a28f3c313 |
| layers.whiteboard-scale | 选中 · 拖角等比 | [whiteboard-scale.zh-light.png](whiteboard-scale.zh-light.png) | walk10-zh/LS06-corner-scaled.zh-CN.light.png | LS06：editor 四角手柄，拖角后宽高比不变（走查断言） | a28f3c313 |
| layers.panel-row | zh 浅色 | [panel-row.zh-light.png](panel-row.zh-light.png) | walk10-zh/LS05-board-layers.zh-CN.light.png | 行名取接口 name；能删的有垃圾桶，背景不可删；面板位置是今天的（PR2 挪） | a28f3c313 |
| layers.panel-row | en 暗色 | [panel-row.en-dark.png](panel-row.en-dark.png) | walk10-en/LS05-board-layers.en.dark.png | 「背景」在英文界面仍是中文：今天所有画板都这样（getDefaultLayers 写死），报协调 | a28f3c313 |
| layers.two-images-hint | 2 张图 | — | — | 未拍：真窗口里参考容量 1 张，造不出 2 张；单测 layerSplitComposerState 覆盖文案与取第 1 张 | a28f3c313 |
| layers.running | 拆图层中 | — | — | 未拍：替身秒回；用的是今天的等待面，没有新画的东西 | a28f3c313 |

## 和拍板稿的差异（逐条有理由）

- 图层分离方式下参数栏没有「高级设置」图标：参数格由档案数据驱动，这一方式没有高级参数，不是漏画。
- 面板行没有缩略图、没有拖动把手：排序 / 缩略图属 PR2（D-1126-se-split-prs）；面板仍挂在工具条下面，PR2 挪位。
- 英文界面里画板图层「背景」「图层 1」仍是中文：今天所有画板都这样（getDefaultLayers 写死），不是本 PR 带来的；已报协调排后续。
- 入口缺模型：板上画的是「灰 + 原因」，实现是不灰、第二行点名 APIMart、点了打开接入页（D-1126-se-missing-model-guide 取代原稿）。
- 5.0 Pro 写死格：板上发送键画了「≤6.9」，实现不印数——5.0 Pro 的图层分离价目算不出，协调裁定 5.0 Pro 不印数（算不出价时不印数字、不印 0）。
- 0 张图悬停：板上只画了「先放一张要拆的图」，实现在原因下面接着约价那一句——发送键对所有模型都是「灰的原因 + 约价说明」同一个悬停，不为图层分离拆开（runC 整张截图见 C12）。
- 英文暗色面板行里「标题文字」「人物」是替身返回的层名（接口 layers[i].name 原样显示），不是界面文案；真 APIMart 返回什么名字就显示什么。

PR2 / 后续的元素（whiteboard-panel、panel-reorder、panel-multiselect、panel-virtual、base-row；failed、extract-button、extract-result、agent-pointer）本 PR 没做，不出并排图。
