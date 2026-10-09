# 剪辑节点 / 时间轴手势（第一片）：走查与截图证据

设计卡与走查结果表：`docs/plan/2026-10-09-clip-gesture-ownership.md`。走查：`tests/ux/clip-gesture-ownership.walk.mjs`（屏外真 Electron、真鼠标、零花费夹具）。

## 日志

| 文件 | 内容 |
|---|---|
| `walk-main-baseline-zh-light.log` | main（PR 的合并基线 914f97531）上跑同一份走查：36 步里 23 步红 |
| `walk-fixed-zh-light.log` | 本分支，中文 / 浅色：36/36 |
| `walk-fixed-en-dark.log` | 本分支，英文 / 暗色：36/36 |

每个缩放档（50 / 100 / 150%）各跑一遍；P1 播放头压在片段上、P2 按下即选中、P3 手柄悬停即用、P7 被打断（画布内 + 全局时间轴）、P8 手势所有权。P4 / P5 / P6 在第二片。

## 截图（唯一的可见变化）

只有一处外观变化：**未选中的片段悬停时，两端显出裁剪手柄**（之前手柄只在片段被选中后才出现）。已选中片段的手柄外观不变（缩放 100% 下仍是 16px；窄片段或非 100% 缩放按屏幕像素换算，见设计卡）。

| 状态 | 改前（main） | 改后 |
|---|---|---|
| 悬停未选中片段 C，中文浅色 | `before-zh-light-hover-unselected.png` | `after-zh-light-hover-unselected.png` |
| 悬停未选中片段 C，中文暗色 | `before-zh-dark-hover-unselected.png` | `after-zh-dark-hover-unselected.png` |
| 悬停未选中片段 C，英文浅色 | `before-en-light-hover-unselected.png` | `after-en-light-hover-unselected.png` |
| 悬停未选中片段 C，英文暗色 | `before-en-dark-hover-unselected.png` | `after-en-dark-hover-unselected.png` |
| 点选片段 C 后（已选中，无变化） | `before-{zh,en}-{light,dark}-selected.png` | `after-{zh,en}-{light,dark}-selected.png` |

悬停时的手柄握把在浅色、暗色界面上都比较淡（握把用 paper 色，压在片段底色上）——与已选中状态是同一个握把设计，没有新样式；是否要更醒目留给设计评审。
