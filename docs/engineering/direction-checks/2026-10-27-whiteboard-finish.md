# 方向检查：画板收尾（画框尺寸同步第二次出错，老画板卡片仍是空的）

触发：`node scripts/fix-churn.mjs` 判定 `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardDrawingTool.tsx` 本身命中——14 天里已有 3 个 fix（05521e29c、ccbbcea64、e26c56a65），这一刀会是第 4 个。设计卡：`docs/plan/2026-10-27-whiteboard-finish.md`。证据：10-24 独立验收报告（协调状态目录 `reports/V-whiteboard.md`，下称 V 报告），以及 10-22 的复盘 `2026-10-22-whiteboard-first-gesture-and-visible-result.md`。

> 状态：✅ 用户 10-27 拍板「换」（原话「五件都按推荐办」）。第 2 轮按第 6 节「换」实现：尺寸同步抽成 `useWhiteboardFrameSize`，撤销、比例、尺寸框、打开四扇门一次收进去；实现提交带 `Direction-Check:` trailer。

### 0. 一句话根因

画框到文档尺寸的同步是手写的「先记下尺寸，250ms 后提交」：提交时用的是观察那一刻的旧尺寸，而「画框又和文档一样了」这件事要靠每个早退分支自己记得撤销。每多一种「一样」的判法（#1189 的取整相等、10-22 的 1 像素容差），就多一个会漏撤的分支。另外 4 扇能改文档尺寸的写口根本不知道有一个待提交在排队。

### 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 05521e29c（10-17，评审 F2）文字框跟着内容变 | 文字对象的边界没有从内容派生 | 文字对象几何（与本单不同类，只是同在一个大文件里） |
| ccbbcea64（10-17，评审 F6）文字对象只有一条创建路径 | 两条创建路径分叉 | 文字对象几何（同上） |
| e26c56a65（10-22）① 默认工具恢复成画笔 | #1189 把初值改成 select，没有合同管「第一下」 | 首个手势（10-22 复盘已收） |
| e26c56a65（10-22）② 差不到 1 个屏幕像素就当同一尺寸 | 节点尺寸取整后被读回成「改尺寸」 | **画框 ↔ 文档尺寸同步** |
| 本单第 2 件：尺寸停在 64 / 90 / 100 这类中间值 | `:571` / `:573` 早退时不撤 `commitTimer`，250ms 后旧尺寸盖回去（V 报告 sizerace 18 次中 2 次） | **画框 ↔ 文档尺寸同步**（同一段第二次出错） |
| 本单第 1 件：老画板卡片是空的 | 卡片只认 `node.result`，不认 state 里的内容 | 完成后的可见结果（10-22 复盘的预测 3 应验，老数据那扇门） |

命中数里有两刀是文字对象，和尺寸同步不是一类；真正在复发的是「画框 ↔ 文档尺寸同步」这一段：10-22 改过一次，这次第二次。`WhiteboardDrawingTool.tsx` 有 657 行，装了工具、历史、文档、尺寸同步、文字、导入、抠图、面板八件事，所以不同类的修补都落在这一个文件里。

### 2. 为什么这一类会一直出现

- **决定和执行隔了 250ms，执行时不再看真值。** 观察回调算出 `dimensions`，闭包把它带进计时器，250ms 后照写。这期间画框可能回到原尺寸，用户也可能撤销、点比例、在尺寸框里打字（这三扇写口会直接改文档尺寸并调整节点），但计时器不知道，照样把旧值写回去。
- **「一样」的判据分散在多个分支里。** 量不到、差 1 像素、取整相等三处 `return`，每处都要自己记得「撤掉待提交、清 live 尺寸」。下一次再加一种「一样」（比如缩放后的容差），还会漏。
- **live 尺寸和待提交只归观察回调私有。** 文档尺寸一共 5 扇写口：比例、尺寸框、提交、撤销重做、初始值。只有一扇知道 live 和待提交。
- 体验铁律 ⑫「点了 = 以为的」：创作者输入 900，工具条和导出应该是 900。现在 18 次里有 2 次不是，而且没有任何提示。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 只按派工书在两个早退分支补一句撤销，撤销 / 点比例 / 尺寸框输入后 250ms 内，旧的待提交仍会把尺寸盖回去 | 单测：画框 S0 → S1，250ms 内调 `moveHistory('back')`（或 `setActiveRatio`），300ms 后读文档尺寸；真机：拖框后立刻按 ⌘Z |
| 打开时 `InlineWhiteboard.tsx:81-86` 把节点调成文档比例；如果 ResizeObserver 的首帧先量到旧比例（比如 4:3 的节点、16:9 的文档），打开就会把文档改成 4:3 | 单测：首帧画框 320×240、文档 1280×720，随后画框变 320×180，300ms 后读文档尺寸；真机：拿一块 320×240 的画板打开等 1s，读工具条 |
| 下一次再加一种「同尺寸」判法，又会少一处撤销 | 读代码：新增的 `return` 是否同时撤销并清 live；没有结构上的保证 |

### 4. 靶子独立性检查

- 现有走查 `whiteboard-refactor.walk.mjs` 的尺寸步骤（`:226-251`）都是逐个值 `fill` 再等盘上的值，没覆盖「连敲」和「来回」。它和 #1189、10-22 的实现出自同一条线，靶子偏向实现的写法。V 报告是独立线，sizerace 探针是它写的，所以本单的基线（2/18）来自独立靶子。
- 没有「修对反而掉分」的先例。
- 走查自己也有「不等就量」的毛病（本单第 3 件，`:92`），会把偶发失败误判成产品问题，所以要先修靶子。

### 5. P0：这些是我们独有的吗

- 「画框尺寸 → 画板文档尺寸」的映射是领域的：画板文档范围和节点框各管各的几何（`self-written.json` 的 `whiteboard-canvas-document-adapter` 已登记）。但**防抖是通用能力**，现在手写在 `setTimeout` 里。Mantine 8.3.18 的 `useDebouncedCallback`（带 `cancel` 和 `flush`）已在依赖里，Mantine 的 `useStateHistory` 也已经在这个文件里用。
- 「创作者在拖框」这个信号，框架本身就有：@xyflow/react 12.11.5 的 `NodeResizer` 有 `onResize` / `onResizeEnd`。用它，可以从根上去掉「用 ResizeObserver 猜是不是用户在拖」。但它挂在节点外壳 `GenerationCanvasReactFlowNodes.tsx` 里，本单的不碰清单里有外壳。
- 第 1 件的「state → 图」复用现有 Leafer 2.1.7 和 `renderWhiteboardScene`，不另写渲染器。

### 6. 选项对比

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案（完整版） | 文档尺寸改由 `NodeResizer.onResize` / `onResizeEnd` 驱动（@xyflow/react 12.11.5，`GenerationCanvasReactFlowNodes.tsx:258-293`），删掉 ResizeObserver 和 250ms 防抖；其它写口本来就直接改文档 | 要改节点外壳，把缩放手势转给画板，外壳多一条通道 | 外壳是共享热点，牵动所有节点；超出本线不碰清单 | 中长期推荐，另立一单 |
| 换（本单推荐） | 尺寸同步抽成单独的小 hook（新文件），防抖用 Mantine `useDebouncedCallback`。观察和提交共用一个判断函数，判「量不到 / 一样 / 不一样」：「一样」就 `cancel()` 并清 live；提交的那一刻重新判一次，只写画框此刻的尺寸。撤销、比例、尺寸框三扇门不用知道防抖存在 | 中：`WhiteboardDrawingTool.tsx` 删掉内联 effect，改为调用 hook；新文件约 40 行，加单测（假 ResizeObserver 和假计时器） | 时间行为有变化，要单测钉住；仍然靠 ResizeObserver 推断，拖框信号没接框架 | **是** |
| 补（派工书原话） | `:571`、`:573` 两个早退分支各加 `clearTimeout` 和 `setLiveDimensions(null)` | 最小 | 第 3 节预测 1、2 照旧；下一个早退分支还会漏 | 否 |
| 删 | 去掉「拖框改文档尺寸」，只留尺寸面板 | 小 | 丢功能（板清单「节点内画板与独立范围」） | 否 |

两个可选项都要改 `WhiteboardDrawingTool.tsx`，所以无论选哪个，都要用户在这里拍板。

### 7. 用户要权衡的核心

画框尺寸同步是现在就换成「提交时再看一眼真值」（改热点文件，一次收掉撤销、比例、输入、打开这几扇门），还是只按派工书补两句撤销（改得最少，但这几扇门 250ms 内仍会被旧值盖回去）。

## 特征测试清单

第 1 轮停在设计卡时列的清单，第 2 轮落成下面这些（都在动结构前写，先在旧代码上跑红）：

- `src/workbench/generationCanvas/nodes/whiteboard/useWhiteboardFrameSize.test.tsx`：渲染真的 `WhiteboardDrawingTool`，用假 ResizeObserver 和假计时器。往返（观察到 / 没观察到回原尺寸）、取整相等、量不到；撤销、比例、尺寸框三扇门各一格（门之后适配晚落地）；尺寸框连敲；打开时节点和文档比例不同。旧代码上往返、三扇门、打开都红。
- `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardCardBody.test.tsx`：老画板显示现画的预览、空画板显示启动器、有结果不现画、缓存与一次一张、失败回启动器、不写盘。旧代码上「老画板」那格红。
- `src/workbench/generationCanvas/nodes/whiteboard/whiteboardProjectContext.test.ts` 的 board Done 组：落盘返回空时的提示键。旧代码上红（旧键）。
- `src/workbench/generationCanvas/nodes/whiteboard/whiteboardFailureCopy.test.ts`：两个新键中英都在、旧键都不在、出图那句不点名按钮。
- 走查 `tests/ux/whiteboard-refactor.walk.mjs`：第 2 轮派工书只许加「量前先等就绪」，老画板的真机核对改在本线探针里做（不进仓库），截图中英各一份。
