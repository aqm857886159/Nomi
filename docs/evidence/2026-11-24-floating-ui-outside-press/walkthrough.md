# 7 大替换第⑤刀真桌面走查证据（`@floating-ui/react` `useDismiss` 外点收起）

- 实现线：`t8-r5-impl`
- 驱动方式：隔离 Electron 实例（`node tests/ux/ui.mjs up --size 1280x800 --theme light`，分别验证 `--locale zh-CN` 与 `--locale en`，`doctor` 构建戳均为当前源码、`problems: []`）
- 视觉结论：`internal-no-visible-change`——浮层尺寸、圆角、阴影、排版、文案与像素位置零改动；点击画布平移面（`xy:640,520`，含 React Flow `d3-zoom` `mousedown` `stopImmediatePropagation`）与预览区外部空白处均单次干净收起，且收起后触发钮无悬停 Tooltip 残留（`tooltips: 0`）。

## 逐项前后截图与读回值

### 1. 任务中心浮卡（`TaskCenterPanel`）

| 语言 | 打开态（`[data-nomi-right-panel="tasks"]` = `true`） | 点击画布平移面后（`= false`） |
|---|---|---|
| `zh-CN` | `01-task-center-open.zh-CN.light.png` | `02-task-center-dismissed.zh-CN.light.png` |
| `en` | `01-task-center-open.en.light.png` | `02-task-center-dismissed.en.light.png` |

### 2. 画布左下「视图选项 / View options」锚点浮层（`AnchoredPopover` / `CanvasControlsHelpPopover`）

| 语言 | 打开态（`.nokey` 浮层数 = `1`） | 点击画布平移面后（`popovers: 0, tooltips: 0`） |
|---|---|---|
| `zh-CN` | `03-canvas-view-options-open.zh-CN.light.png` | `04-canvas-view-options-dismissed.zh-CN.light.png` |
| `en` | `03-canvas-view-options-open.en.light.png` | `04-canvas-view-options-dismissed.en.light.png` |

### 3. 预览工作区顶栏「布局 / Layout」菜单（`EditingLayoutMenu`）

| 语言 | 打开态（`[role="menu"]` = `true`） | 点击外部空白处后（`= false`） |
|---|---|---|
| `zh-CN` | `05-editing-layout-open.zh-CN.light.png` | `06-editing-layout-dismissed.zh-CN.light.png` |
| `en` | `05-editing-layout-open.en.light.png` | `06-editing-layout-dismissed.en.light.png` |
