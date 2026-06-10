# 执行计划：助手面板收敛（双面板 → 单上下文助手）

> 依据：`docs/audit/2026-06-07-assistant-architecture-audit.md`（决策 B + §10 复核修正）。
> 本文是 R4 执行文档：范围 / 不动项 / 分阶段 / 回滚 / 验收门。实现按阶段推进，阶段 2 的可见改动须先过 R8 样张（见 `docs/mockup/2026-06-07-unified-assistant-panel.html`）。

## 0. 目标与非目标

**目标**：把「创作区助手」「生成区助手」两块面对用户的面板，收敛为**一个跟随当前活跃区切换工具域的助手**；把「拆镜头/定妆」从面板按钮 + window 事件桥，降级为这个助手的**结构化工具**。

**非目标**：
- 不做真·多 Agent（C 方案，audit 已否）。
- 不动后端 runtime / session / store / runner —— 复核确认它们已组件无关（audit §10.2）。
- **不删定妆任一路径** —— 两条是不同阶段的不同操作（audit §10.1）。本计划只拆桥 + 消歧义。

## 1. 范围（动什么）

| 阶段 | 改动文件（预估） | 性质 |
|---|---|---|
| 1a | `generationCanvas/components/CanvasAssistantPanel.tsx`（抽执行层）、新增 `generationCanvas/agent/applyCanvasToolCall.ts` | 抽共享执行模块 |
| 1b | `creation/CreationAiPanel.tsx`、`generationCanvas/agent/storyboardLauncher.ts`、`fixationLauncher.ts` | 拆 window 事件桥 → 工具调用 |
| 1c | `nodes/NodeImageEditToolbar.tsx`、`creation/CreationAiPanel.tsx` 的定妆入口文案 | 消除定妆命名歧义 |
| 2 | 合并 `CreationAiPanel` + `CanvasAssistantPanel` → 单一上下文助手组件；统一模式/模型选择器；**空间行为**（折叠小入口 ↔ 右侧停靠 + 拖宽手柄，**不做自由浮窗**） | **可见大改，R8 样张已拍板** |
| 3（可选） | 工具膨胀后 subagent-as-tools | 远期 |

## 2. 不动项（明确不碰，防止 scope 蔓延）

- `workbench/ai/workbenchAgentRunner.ts`（runtime + sessionKey，已统一）。
- `generationCanvas/store/generationCanvasStore.ts`、`runner/`、`generationCanvasTools.ts` 的 store action 落地逻辑。
- `fixation/buildFixationNode.ts`、`fixation/fixationPromptTemplates.ts`（共用抽象，正确）。
- 定妆两条路径的**行为**（只改触发方式与文案，不改产物）。

## 3. 分阶段 + 每阶段验收门

> 每阶段：① P1 加新同 commit 删旧 ② 五门全过（filesize→lint:ci→typecheck→test→build）③ Playwright 真机走查（R13）。

### 阶段 1a — 抽共享画布工具执行层
- 把 `CanvasAssistantPanel.tsx:155-212` 的 `applyConfirmedToolCall` switch 抽到 `applyCanvasToolCall.ts`，复用/合并 `generationCanvasAgentClient.ts:109-172` 的 `defaultExecuteToolCall`（消除这份重复，P1）。
- **验收**：画布助手行为不变（建/连/删/改提示词/生成/送时间轴全过走查）；两份重复执行逻辑收敛为一份。

### 阶段 1b — 拆 window 事件桥
- 删 `STORYBOARD_PLANNING_EVENT` / `FIXATION_PLANNING_EVENT` 派发 + 监听 + `setTimeout(60)`（`CreationAiPanel.tsx:145` 一带）。
- 拆镜头/立角色卡改为助手直接走工具循环（创作区助手可调画布工具，复核已证可行）。
- **验收**：说人话「把这段拆成镜头」「给这段剧本立角色卡」能触发，无 DOM 事件、无时序 hack；旧桥代码已删（P1）。

### 阶段 1c — 定妆消歧义
- 节点级入口文案 → 「基于此图定妆」；剧本级入口文案 → 「剧本立角色/场景卡」。
- **验收**：用户能分清两种定妆；不再出现「点定妆却没参考我的图」的错配。

### 阶段 2 — 合并面板 + 空间行为（R8 样张已拍板）
- **前置**：`docs/mockups/unified-assistant-panel.html` 已经用户拍板（v4：三工作区停靠 + 折叠；砍掉 S/M/L 只留拖宽手柄）。
- 合并两组件为单一上下文感知助手；工具域随活跃区（编辑器/画布/时间轴）切换；统一模式语义 + 模型选择器常驻。
- **可用工具默认折叠**成「N 个工具 ⌄」一行（不做常驻大条）；工具调用指示统一横排一行、超长省略。
- **空间行为**：折叠态 = 右下角带 Nomi 标 + ✦ 的小入口；展开态 = 右侧停靠 + 左缘拖宽手柄（无级调宽）+ `»` 折回。**明确不做自由浮窗**（避免窗口管理税 / 盖节点 / 飘出屏）。
- 图标统一用设计系统 tabler 细线（创作 Pencil / 生成 Sparkles / 时间轴 Movie），顶栏品牌 M 标（`identity.tsx`）。
- **验收**：单面板跨创作/生成/时间轴连续工作；控件不再「时有时无」；折叠↔展开 + 拖宽顺畅；窄停靠时头部不换行。

## 4. 回滚策略

- 阶段 1a/1b/1c 各为独立 commit，可单独 revert。
- 阶段 2 合并面板前打 tag；若走查暴露体验回归，revert 到 tag，双面板恢复（但阶段 1 的工具化收益保留——它们不依赖面板合并）。

## 5. 风险登记

| 风险 | 缓解 |
|---|---|
| 创作区助手确认 UX 与画布的 pending-queue 不一致 | 阶段 1a 统一确认模型，或创作区走 auto-execute（需在样张明确） |
| 合并面板后「此刻能用哪些工具」不可见 | 样张必须含工具域可见指示，走查人眼验证 |
| §4 外部佐证无出处 | 决策不依赖它；如需对外，补真实出处或降级为假设（audit §10.4） |

## 6. 当前进度
- [x] 阶段 0：审计 + 复核修正（audit §10）
- [x] R8 样张：`docs/mockups/unified-assistant-panel.html` v4 已用户拍板
- [x] 阶段 1a：抽共享执行层 applyCanvasToolCall
- [x] 阶段 1c：定妆命名消歧义（立角色卡 / 基于此图定妆）
- [×] 阶段 2：尝试过 app 级 dock（WorkbenchAssistantDock，step1 跟随上下文 / step2 整高
      停靠+占位 / step3 token 读数），但**反复破坏原始布局**（遮挡底部、间距与原始不符、
      底部按钮错位）。用户多轮反馈后判定：app 级提升与两面板各自嵌在 workspace 网格的现状
      强耦合，硬提升=持续的布局回归。**已 revert，从 git 精确还原 C-2 之前的原始布局**
      （创作 grid-cols-[minmax(0,900px)_344px] gap-5 / 生成 sidebar+overlay launcher），
      真机走查确认与原始一致。
- **教训**：两面板是各自完整、且与所在 workspace 布局耦合的 panel；「一个跟随上下文的
      持久助手」要做对，需先解决「panel body 与 workspace 布局解耦」，不能直接把整 panel
      提到 app 级浮层/侧栏（会丢原始网格的精确尺寸与留白）。后续若再做，应：① 先把每个 body
      的 chrome/布局契约抽清；② 在不改原始网格尺寸的前提下注入统一容器；③ 每步真机走查对齐
      原始基线像素。**当前保留原始双面板布局 + 已落地的 harness/C-1a/C-1c/#8 读数。**
- 保留：H1（Stop/真abort/read try-catch）、C-1c（定妆消歧义）、#8 token 读数（在 header）。
