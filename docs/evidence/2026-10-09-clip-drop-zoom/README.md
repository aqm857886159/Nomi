# 剪辑节点第二片（拖放接收 / 窄片段命中 / 边缘滚动 / 同类入口）：走查与截图证据

设计卡：`docs/plan/2026-10-09-clip-drop-zoom.md`。走查：`tests/ux/clip-drop-zoom.walk.mjs`（屏外真 Electron、真鼠标、零花费夹具，缩放 50 / 100 / 150% 各一遍）。

## 日志

| 文件 | 内容 |
|---|---|
| `walk-main-baseline-zh-light.log` | main（be0de1919）上同一份走查：27 步里 24 步红（余下 3 步是外观取证，不判对错） |
| `walk-fixed-zh-light.log` | 本分支，中文 / 浅色：27/27 |
| `walk-fixed-en-dark.log` | 本分支，英文 / 暗色：27/27 |

步骤：P4 素材拖进剪辑节点（落点出插入指示、插入 / 追加、素材库载荷）、P5 拖放把手不靠悬停、P6A 窄片段命中下限、P6B 边缘自动滚动、G1 全局时间轴手柄悬停即用、O1 预览取景拖动被打断回到拖之前。
拖放驱动方式：Electron 里 Playwright 的鼠标只能触发到 dragstart。「拖出」一半是真鼠标（确认 dragstart 真发生在把手上），载荷由把手自己的 dragstart 处理函数写出；「落下」一半用同一份载荷、同一组 MIME 在真实屏幕坐标上派发 dragenter / dragover / drop（先取最顶层元素再派发，被谁挡住就是谁收到）。

## 截图（可见变化：剪辑节点手柄悬停 / 选中的可见度）

悬停与选中现在用同一套 accent 底色（token），浅色下不再发白。中 / 英、浅 / 暗各一组，改前（`before-*`）改后（`after-*`）；`hover-unselected` 是悬停未选中片段 C，`selected` 是点选后。
