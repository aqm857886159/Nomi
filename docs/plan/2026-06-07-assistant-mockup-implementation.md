# 实施规范：助手面板对齐样张（R8 完整版 · token 驱动）

> 设计真相源：`docs/mockups/unified-assistant-panel.html`（已拍板）。
> 本文是 R8 要求的「实现规范」（精确 token + DOM 结构 + 状态 + 数据绑定 + 逐项验收清单）。
> **教训（根因）**：之前没在出样张时同时出本规范，且把样张裸 px 直接抄进代码（违反 R8 token-only）。
> 本规范把样张每个裸值映射成设计 token；实现只用 token；改完跑 `tests/ux/design-fidelity.e2e.mjs`
> 把规范写成 computed-style 断言（机器抓 twMerge/CSS !important 覆盖），再逐项对账。

## 0. 范围（用户拍板）

- **不合并面板**；保留 CreationAiPanel（创作）/ CanvasAssistantPanel（生成）两组件、各自工具域。
- **把样张的「面板视觉设计」逐元素套到这两个面板**（头部 / 工具折叠 / 消息 / composer）。
- 布局：创作右侧 344（基准，不动）；生成右侧**可拖宽**；预览/剪辑右侧**加同款助手** + **去掉最左文件树**。
- 样张的「单一浮动 dock」**不要**（已 revert，破坏布局）。

## 1. Token 映射表（样张裸值 → 设计 token，唯一允许写的值）

| 样张裸值 | 设计 token / Tailwind 类 | 来源 |
|---|---|---|
| 圆角 10 | `rounded-nomi`（panel 10px） | §2.4 |
| 圆角 14/16 | `rounded-nomi-lg`（modal 14px）| §2.4 |
| 圆角 999 | `rounded-full`（pill）| §2.4 |
| 字 10/10.5/11 | `text-micro`（11）| §2.3 |
| 字 11.5/12/12.5 | `text-caption`（12）| §2.3 |
| 字 13/13.5 | `text-bodySm`（13）| §2.3 |
| 标题 16 | `text-title`（16）| §2.3 |
| 高 21（tool chip）| `h-6`（24，最近 token）| 控件最小档 |
| 高 26（pill）/ 28（send）| `h-7`（28，= NomiSelect sm）| 统一控件高 |
| 间距 4/5 | `gap-1`（4）| §2.2 |
| 间距 6/7 | `gap-2`（8）| §2.2 |
| padding 9/10 | `p-2`（8）或 `p-3`（12）| §2.2 |
| padding 12 | `p-3`（12）| §2.2 |
| 阴影 card | `shadow-nomi-sm` | §2.5 |
| 颜色 | 仅 `nomi-ink*/line*/accent*/paper` 类 | §2.1 |

**禁止**：任何 `h-[26px]`/`text-[11.5px]`/`rounded-[10px]`/`gap-[5px]`/`pl-2.5` 等裸值（R8 明令）。
**需修正**：S1/S2 已提交的 `h-[26px]/text-[11.5px]/rounded-[10px]/w-[28px]/gap-1.5/pl-2.5` 全部换成上表 token。

## 2. 逐元素规范（样张 → 实现）

### 2.1 面板外壳 `.panel`
- 样张：border line / radius 16 / shadow-card。
- 实现：`border border-nomi-line rounded-nomi-lg shadow-nomi-sm bg-nomi-paper`（= 现 `.workbench-creation-ai` CSS，保留）。

### 2.2 头部 `.head`（**两面板都缺，需补齐**）
- 样张：`[Nomi M 标 18] 助手(name)` ···（ml-auto）`[tabler 图标 13] 创作/生成/时间轴(ctx)`。
  - `.head`：flex items-center `gap-2` `p-3`(py 收一点用 `px-3 py-2`) border-b line-soft。
  - `.name`：`text-bodySm font-semibold text-nomi-ink`，文案「助手」。
  - `.ctx`：ml-auto inline-flex items-center `gap-1` `text-micro text-nomi-ink-40`；icon = tabler（创作 Pencil / 生成 Sparkles / 时间轴 Movie），`size 13 stroke 1.7`。
- 现状：创作/生成头部是 `NomiAILabel suffix="创作/生成"`（"Nomi 创作"）+ 动作图标（模型接入/新对话）。
- 决策：头部左 = `NomiLogoMark` + 「助手」；右 = ctx 胶囊 + 动作图标（模型接入/新对话保留，放 ctx 右侧或同组，需走查不挤）。

### 2.3 工具折叠条 `.tools-fold`（**两面板都缺，需补齐**）
- 样张：border-b line-soft，`px-3 py-1`，`text-micro text-nomi-ink-40`，`[Tool icon 13] N 个工具 [chev]`；hover ink-60；点开展开 chips。
- 实现：头部下、消息上插一行折叠条；N = 当前 skill 工具数；点开列出工具 chip（`.tool`：`h-6 px-2 rounded-full border-nomi-line text-micro text-nomi-ink-80`）。

### 2.4 消息区 `.msgs` / 气泡 `.m`
- 样张：`p-3 gap-2`；气泡 max-w 88% `text-caption rounded-nomi p-2`；user `bg-nomi-accent-soft text-nomi-ink` 右；assistant `bg-nomi-ink-05 text-nomi-ink-80` 左。
- 工具调用指示 `.tcall`：一行不换行 `text-micro text-nomi-ink-60`，code 片段 `rounded-nomi-sm border-nomi-line px-1.5`。
- 现状气泡样式需对齐到上述 token。

### 2.5 Composer `.composer`（S1/S2 已做雏形，**裸值需改 token**）
- 容器：border-t line-soft `p-3` flex-col `gap-2`。
- 输入框 `.input`：`border border-nomi-line rounded-nomi p-2 text-bodySm`，focus `border-nomi-accent`（多行 textarea，min-h 用 `min-h-14`=56）。
- ctrls：flex items-center `gap-2`。
- pill（模式/模型）：`h-7 rounded-full border-nomi-line bg-nomi-paper text-caption`；`.k` `text-micro text-nomi-ink-40`、`.v` `text-nomi-ink-80`、chev ink-40。（NomiSelect 用 `size="sm"`= h-7，去掉 `h-[26px]`）
- 动作 chip（拆镜头/立角色卡，仅创作）：与 pill 同 chrome（纯 `<button>`，`h-7 rounded-full border-nomi-line text-caption`，前置 tabler 图标 13 ink-40）。
- send `.gen`：`h-7 w-7 rounded-full bg-nomi-ink text-nomi-paper`，`ml-auto`；停止同尺寸。

## 3. 布局（位置/拖拽/预览）

- **创作**：grid `[minmax(0,900px)_344px]` 不变。
- **生成**：助手右侧停靠（在布局流内、占位不遮挡，像创作），**左缘拖宽**（宽度存 store，clamp）。
- **预览/剪辑**：grid 加右侧助手列；**`WorkbenchShell` 中预览不再渲染 `ProjectExplorerSidebar`**（现 `workspaceMode !== "creation"` 才渲染 → 改成仅 `generation`）。

## 4. 验收（R8 逐项对账 + 机器断言）

把 §2 每条写进 `tests/ux/design-fidelity.e2e.mjs` 的 computed-style 断言：
- [ ] 头部：logo 在、name="助手"、ctx 胶囊存在且 icon 对（创作 Pencil/生成 Sparkles）
- [ ] 工具折叠条存在、micro/ink-40、可展开
- [ ] 气泡 token（圆角/字号/底色）对
- [ ] composer 输入框 rounded-nomi + border、pill h-7、send h-7 w-7、全程**无裸 px**
- [ ] 创作/生成两面板上述元素 computed-style 一致
- [ ] 布局：生成可拖宽；预览有助手且无左侧文件树
- 然后常驻驱动（`ui-driver.mjs`）逐区放大截图与样张并排，列差异。

## 5. 实施顺序（每步：改 → 重建 → 重启驱动 → fidelity 断言 + 走查 → 过五门 → commit）

1. **P0 修正 token 违规**：把 S1/S2 的裸值全换成 §1 token（先把已踩的坑填平）。
2. **P1 头部**：补 logo+助手+ctx 胶囊（两面板）。
3. **P2 工具折叠条**：补「N 个工具」（两面板）。
4. **P3 消息气泡 token 对齐**。
5. **P4 composer token 收口**（pill/input/send 全 token）。
6. **P5 布局**：生成可拖宽；预览加助手 + 去左侧文件树。
7. **P6 fidelity 断言 + 逐区对账**收尾。

## 6. 不动项 / 回滚
- 不动 runtime/store/工具执行层 / 定妆拆镜头逻辑 / harness 成果。
- 每步独立 commit 可 revert；布局改前记基线截图。
