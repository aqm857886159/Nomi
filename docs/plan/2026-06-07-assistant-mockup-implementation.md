# 实施文档：助手面板对齐样张 HTML（三区右侧停靠 + 样张设计）

> 设计真相源：`docs/mockups/unified-assistant-panel.html`（已拍板）。
> 本文把样张的**设计规格**与用户口述的**布局要求**落成可执行步骤；每步用 R13 常驻驱动
> （`tests/ux/ui-driver.mjs` + `ui.mjs`）真机走查验收，验证通过才 commit。
> 工作方式（来自记忆 r13-walkthrough-gotchas）：改前 `pkill -f "electron@31.7.7"` 清场；
> **每次重建后必重启驱动**（防 stale-chunk）；只保持一个驱动实例。

## 0. 目标（用户口述）

1. **创作区**：右侧助手面板位置已是基准（grid `[minmax(0,900px)_344px]`），不变。
2. **生成区**：助手面板放到**右侧**（像创作区那样在布局流内、占位不遮挡），**可拖宽**；**去掉 S/M/L**。
3. **剪辑/预览区**：右侧也放一个**与创作区右侧同款**的助手面板；**去掉最左边的文件树**（ProjectExplorerSidebar）；布局相应调整。
4. 三区右侧助手统一套用**样张设计**（见 §1）。

## 1. 从样张提取的设计规格（composer / 控件）

| 元素 | 样张规格（`unified-assistant-panel.html`） |
|---|---|
| composer 容器 | `border-top: 1px var(--nomi-line-soft)`；`padding:10px 12px`；flex column；`gap:8px` |
| **输入框 .input** | **`border:1px var(--nomi-line)`；`border-radius:10px`；`padding:0 10px`**；空态 `color:ink-40`；`font-size:12px`（真实是多行 textarea → 给它 border+radius+padding 的盒子） |
| ctrls 行 | `display:flex; align-items:center; gap:6px` |
| **pill（模式/模型）** | **`height:26px`**；`padding:0 8px`；`gap:5px`；`border:1px line`；`border-radius:999px`；`bg:paper`；`font-size:11.5px`；`.k`(标签)`10px ink-40`；`.v`(值)`ink-80`；chevron `ink-40` |
| **发送 .gen** | **`28×28`**；`border-radius:999px`；`bg:var(--nomi-ink)`；白色；`margin-left:auto` |
| 面板卡 | `border:1px line`；`border-radius:var(--nomi-radius-lg)`；`box-shadow:var(--nomi-shadow-sm)`（= 现 `.workbench-creation-ai` 原始设计） |

**与现状差异（需改）**：① 输入框现无边框 → 改带边框圆角盒；② pill 现 24px(xs) → 26px；
③ 发送现 30px → 28px；④ ctrls 间距对齐 6px；⑤ 生成区 S/M/L 残留确认清除。

## 2. 布局实施（核心）

把「内容 + 右侧助手」做成三区一致的布局（创作区 grid 为模板）：

| 区 | 现状 | 目标 |
|---|---|---|
| 创作 | grid `[900_344]`，右侧 CreationAiPanel | 不变（基准）；只套 §1 设计 |
| 生成 | 助手 overlay/sidebar（折叠 launcher） | 右侧**在布局流内停靠**（占位）、**可拖宽**；去 S/M/L |
| 预览/剪辑 | 仅 TimelinePreview + TimelinePanel，**左侧有文件树**？ | 右侧加助手（同创作右侧）；**去掉最左文件树**；调 grid |

注：左侧文件树 = `ProjectExplorerSidebar`，当前在 `WorkbenchShell` 里 `workspaceMode !== "creation"` 时渲染（生成/预览都有）。预览区要去掉它。

## 3. 分步（每步：改 → 重建 → 重启驱动 → 真机走查 → 过五门 → commit）

- **S1 样张设计落到创作区 composer**（基准区先对齐）：输入框带边框圆角盒、pill h26、发送 28、gap6。R13 走查 + 1.7x 放大核对与样张一致。
- **S2 生成区助手改右侧停靠 + 可拖宽**：复用 §1 设计；去 S/M/L；占位不遮挡（画布/时间轴反流）。
- **S3 预览/剪辑区加右侧助手 + 去左侧文件树**：调 grid 布局。
- **S4 三区一致性复核**：常驻驱动逐区放大截图对账，控件尺寸/输入框/发送钮三区一致且 == 样张。

## 4. 不动项 / 风险 / 回滚

- 不动：runtime/store/工具执行层（harness 已稳）；定妆/拆镜头逻辑；C-1a/H 系列成果。
- 风险：改 `WorkbenchShell`/各 workspace 布局易回归——**每步真机走查对齐原始/样张基线**，不靠数值自证（教训：之前只量数值仍不一致）。
- 回滚：每步独立 commit，可单独 revert；布局文件改前记基线截图。

## 5. 待澄清（实施中按默认推进，撞到再问）

- 预览/剪辑区助手的**工具域**：暂用与生成同源（画布/时间轴工具）或只读问答；不阻塞布局。
- 生成区助手是否保留**折叠**：用户强调「可拖」，未提折叠；默认保留可折叠 + 可拖宽。
