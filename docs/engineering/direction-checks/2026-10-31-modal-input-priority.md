# 方向检查：弹层开着，键盘还落在工作区（RW）

> **触发**：`node scripts/fix-churn.mjs --staged` 目录级命中：`src/design/` 14 天第 6 个 fix，`src/workbench/promptLibrary/` 第 5 个，`src/ui/app-shell/` 第 4 个；任务书写的时候 `src/workbench/generationCanvas/components/` 也命中（第 8 个）。**没有文件级命中**：本单要改的文件自身都没到第 3 刀。命中清单的原文见文末。
> **来源**：独立验收线在隐藏面输入统一的验收中发现（真实确认框开着按 Delete，画布选中的节点 1→0，中英两轨都红）。协调裁定带着它合入，本单另修。
> **范围**：共享输入边界 `src/workbench/shortcutSurface.ts`，加一条规则和它读的事实；没有界面变化。

## 0. 一句话根因

工作区面的快捷键都挂在 window 上，键盘事件永远打到焦点元素再冒泡到 window，而「现在有模态开着」这件事没有共享的真相：有的面自己查 DOM，有的看私有标记，多数根本不查。

## 1. 归类表

### 1a. 这一类的历次出现

| 提交 / 现象 | 直接原因 | 类 |
|---|---|---|
| 2026-09-09 `9aed7cd0d` 导演台弹窗开着，导演台快捷键还响 | 导演台给每个对话框贴私有标记 `data-nomi-escape-layer`，读的只有导演台 | 模态开着时工作区不让路，按对话框打补丁 |
| 2026-10-07 `710d4e62c` 版本灯箱开着按 Esc，把后面的宫格也收了 | 宫格监听里加了一个 `previewOpenRef` 让路 | 同上，按对话框打补丁 |
| 2026-10-09 `629e9fdb3` 列表详情的 Esc 抢弹层的 | 列表监听里查目标是不是 `[role="dialog"]` | 同上，靠 DOM 推断 |
| `ActionSelectModal` 从未贴标记 | 导演台那一套是「记得贴才生效」，漏一个没人知道 | 同上，打补丁打不全的证据 |
| **本次**：确认框开着按 Delete，画布节点 1→0 | `shouldIgnoreCanvasShortcut` 只让路给白板、文字编辑、不活动的面；`shortcutSurfaceMayHandle` 不知道有模态 | 同上，且画布、时间轴、预览都没有任何判断 |

### 1b. fix-churn 计入的 fix 没有一刀属于这一类

`generationCanvas/components/` 的 8 刀里，只有 `e57081ef0`（隐藏面输入统一）同族，它建立了本单依赖的边界；其余是站位、投影、外点监听、合同登记，只撞目录。`src/design/` 的 5 刀是外点监听、焦点复位、按钮色调和 popover 跟随，只撞目录。`src/ui/app-shell/` 的 3 刀是导演台收进画布格、开屏跳过按钮、外点监听；`src/workbench/promptLibrary/` 的 4 刀是提示词缓存、元信息颜色和删除快照，也只撞目录。这些都不需要回滚，也不是本次问题的来源。

## 2. 为什么这一类会一直出现

**症状**：按键落到看不见的地方，节点、片段被删，撤销栈被动，粘贴出东西。

**直接原因**：见 §1a 本次那一行。

**类根因（表示层）**：#1384 把「这一面现在有没有输入权」收进 `workspaceInputSurfaceIsActive`，但它只表示「宿主让这一面在前台」，没有表示「这一面上面盖着东西」。模态的开关状态散在各宿主里，没有一个读的地方，所以每个消费者要么自己猜，要么不管。

**为什么浏览器帮不上**：`aria-modal`、`inert`、`<dialog>.showModal()` 都不拦 window 级监听。设计卡「先查别人」第 2 条有 Electron 43 的实测：焦点在框内、在 body 上、指针点在 inert 区，window 上的监听全都收到。这不是用法不对，是规范就这样，所以规则只能住在监听的边界上。

**为什么没拦住**：单测和普查只覆盖「隐藏面」；没有一条测试同时开着真弹层又按工作区快捷键。

三条铁律：⑩ 不适用，不是意图或草稿参数；⑪ 不适用，不是模型档案入口；⑫ **适用**：用户按 Delete，以为作用在眼前的弹层，实际删了后面的节点。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 设置开着按 Cmd+Z，画布被撤销；付费确认卡开着按 Backspace，节点被删 | `tests/ux/modal-input-priority.walk.mjs` 修前的 A6、A8a（修前红表见报告） |
| 下一个手写模态（仓库现有 17 个）再漏让路，又要加一个特例 | `src/workbench/modalInputLayerCensus.test.ts` 去掉任一登记即红 |
| 灯箱开着按 Delete 既删节点；时间轴上的按键也会被画布吞 | 同一走查 A8c，矩阵「只盖画布那一格的层」 |

## 4. 靶子独立性检查

靶子是「模态开着，工作区状态不变」，由真窗走查用 store 和 DOM 的事实判定，不看实现。复现脚本出自独立验收线，走查逐字保留了它的断言。没有「修对了反而掉分」的先例。验收由另一条线按设计卡 ★9 从头核。

## 5. P0：这是我们独有的吗？现成方案有哪些

规则本身不是领域的，但「灯箱只盖画布那一格、旁边时间轴还能用」这个局部覆盖是我们的布局决定的。现成方案逐个查过（设计卡「先查别人」）：

- 原生 `inert` / `showModal`：拦不住 window 监听，实测排除。
- Radix DismissableLayer / FocusScope：栈的形状可取，但它是传递依赖、不是公开原语，Mantine Modal 不往里登记，焦点栈也不管全局按键。
- Mantine Modal：只有每个弹窗自己的 Esc，没有读接口。
- tldraw：宿主登记、快捷键读状态，是同一个做法，但属于它的编辑器内部。
- Excalidraw：逐弹窗特例，正是要避开的形状。

所以只写一个约 30 行的小栈，登记进 `self-written.json`，退出条件写在条目里。**当前这个边界自己写是临时的吗**：不是回避，是现成的库没有局部覆盖；换了浮层库就删。

## 6. 选项

| 选项 | 改法 | 代价 |
|---|---|---|
| A 按对话框打补丁 | 每个消费者再查一次 DOM 或标记 | 新增特例，手写模态漏了没人知道，直接违反任务书 |
| B 宿主登记 + 边界一条规则（**本单**） | `workspaceInputSurfaceIsActive` 加一条「被盖住就不算活动」，所有面自动继承；宿主登记由普查钉死 | 手写模态每个加一行；有一个小自写模块 |
| C 全部手写模态改走 DesignModal | 模态只有一个入口，连登记都不用 | 付费卡、灯箱的结构 Mantine 给不了，要动界面，超出本单 |

选 B。C 不矛盾，将来每收掉一个手写模态，普查表就少一行。

## 7. 为什么这属于「换」

- **没有新增分支或特例**：规则只有一条，写在 `workspaceInputSurfaceIsActive`，所有消费者经它继承，一个消费者的代码都不用为它改。
- **同一个提交删掉了被替代的散落判断**：
  1. `NodeVersionCardsHost.tsx` 的 `previewOpenRef`：灯箱开着让宫格的 Esc 让路，现在画布被盖住，宫格的监听根本收不到。
  2. 导演台三个对话框的 `data-nomi-escape-layer="director-help|director-settings|director-mobile-dialog"`：它们都是 DesignModal，已经由层管住。标记的读者还在，只为非模态的导演台浮层服务。
  3. `TimelinePanel` 里 `onHelp` 的 toggle 关闭和 Esc 关闭：帮助框现在是模态，关闭归它自己，面只负责打开。
  4. 三个灯箱经 `canvasWindowInput` / `canvasDocumentInput` 的监听：灯箱不再借「画布活动」的门，改成自己的门（画布宿主活动且自己在最上面），否则它会被自己的层挡住。
  5. `ShellAgentHost` 的 Mod+J / Mod+\\ 从绕过变成经过边界。
- **同一条规则的另一半，不是新特例**：关掉这层的那个事件派发完之前，这层还算数。Mantine 在 window 捕获期关弹层，React 紧接着提交，同一个 Esc 再走到灯箱和画布时层已经摘了，不留这一拍就会一下关两层。只改栈的生命周期（`src/design/modalInputLayer.ts`），消费者不知道这件事。
- **这条规则带来的副作用当场收掉**：工作区不接 Cmd+A / Cmd+Z 之后，默认动作落到浏览器头上（全选把框后面的字都选中，撤销撤掉框后面刚打的字，修前这两个键被画布 `preventDefault` 吃了所以看不见）。同样只在 `shortcutSurface.ts` 里处理一次，消费者不知道。
- **有意留下的判断**（它们管的不是这件事）：`GenerationListView` 的 `[role="dialog"]`（还要管任务中心这类非模态对话框）；`escapeBelongsToVersionGrid`（同上，还管菜单和下拉）；`ShellRail` 的 DOM 判断（含菜单和非模态对话框，比输入层宽）；`hasOpenDialogAbove`（模态之间的 Esc 仲裁，另一件事）；`useBrowserAssetActions` 的素材盒键（文件级热点，不动；它只在素材盒开着时生效，不碰工作区）。

## 核心取舍

手写模态要多写一行登记，换来规则只有一处，以及用户任何时候按键都不会动到看不见的东西。漏登记由普查测试当场拦住，不靠记性。

## 特征测试清单

- 红→绿：`src/workbench/shortcutSurface.modalLayer.matrix.test.ts`（开 / 关 × 整窗 / 画布格 / 嵌套 × 四面 × 六键）
- 真窗：`tests/ux/modal-input-priority.walk.mjs`（中英两轨，A1–A13，修前红表见报告）
- 结构：`src/workbench/modalInputLayerCensus.test.ts`（模态宿主、全局监听全表）

## fix-churn 原文

```
【方向检查 · RW】这一刀碰的地方已经被反复修，先别再补：
  · src/design/modalInputLayer.ts：目录 src/design/ 近 14 天已有 5 个 fix（只涉及 5 个文件，算同一概念），这一刀是第 6 个
  · src/design/overlays.tsx：目录 src/design/ 近 14 天已有 5 个 fix（只涉及 5 个文件，算同一概念），这一刀是第 6 个
  · src/ui/app-shell/UpdateDialog.tsx：目录 src/ui/app-shell/ 近 14 天已有 3 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 4 个
  · src/workbench/promptLibrary/PromptPreviewOverlay.tsx：目录 src/workbench/promptLibrary/ 近 14 天已有 4 个 fix（只涉及 4 个文件，算同一概念），这一刀是第 5 个
动作：停止派 / 打修补，先做「类根因复盘」（模板 docs/engineering/direction-check-template.md，产出一页文档），结构性结论交用户拍板（例外：只因概念 / 目录 / 自写登记口径命中、文件本身没命中，且改法是换或删、不新增分支——由协调代批、事后报用户）；复盘前先写特征测试钉住现状。
提交 fix 时在信息里加一行 `Direction-Check: <复盘文档路径>`（git commit-msg 会校验）。
```

## 裁定

协调按 P1 例外代批，事后报用户
