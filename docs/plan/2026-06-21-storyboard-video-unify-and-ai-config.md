# 拆镜头：统一成视频 + AI 产/改配置（RC6 + P0-9 全量）

> 2026-06-21。用户拍板：① RC6 统一成视频；③ P0-9 全量（AI 产模型/参数/负面词 + 迭代改现方案）。
> 依据 `docs/audit/2026-06-20-two-agents-persona-ux-audit.md`。延续 `docs/plan/2026-06-20-two-agents-ux-fixes.md`。

## 协作 / push 边界
- 并行会话在改记忆/spend-gate/capability-core；本单文件与之**不重叠**（RC6 动 `generationCanvasAgentClient.ts`，已 committed-clean；P0-9 动 `canvasTools.ts`/`storyboardPlan.ts`/`storyboardLauncher.ts`/`SKILL.md`/编辑器，均非其热区）。
- 只 `git add` 指名文件；push 仍被其 `runtime.ts:755>745` 红门拦，边做边本地 commit，待 main 转绿整批推。

## 决策记录（覆盖旧拍板，留痕）
- **RC6 反转 2026-06-15 image-first 拍板**（commit 1e774e5）。理由：分镜产物就是视频，出图不合逻辑；且主链路（`storyboardPlan.ts`）本就 video，只剩生成区 free-build 路径出 image，统一到 video 消除双真相源。代价（用户已知悉）：视频→视频不自动连首尾帧（能力未实现）、改一镜更贵。
- **P0-9 全量**：AI 产 modelKey/modeId/params/negative_prompt + 能基于现方案迭代改。前提：把可用模型清单 + 各自参数 schema 注入规划师（否则 AI 瞎填无效模型必坏）。

---

## Slice 1 · RC6 视频统一（小、先做）

**根因**：生成区 free-build 拆镜头默认 image + 连 shot→shot 链（`generationCanvasAgentClient.ts:85-86`），与主链路 video + 不连链矛盾。

**改**：
1. `generationCanvasAgentClient.ts:85-86` 两条硬约束：
   - `拆镜头默认建 kind=image` → `kind=video`（对齐主链路；用户明确要「只要图/先出图」时才 image）。
   - `相邻镜头默认连成时序链 n1→n2→n3` → 默认**不连**（视频→视频首尾帧接力未实现，连了裸跑；连贯靠共享角色卡/场景卡。用户明确要连时才连）。
2. eval `evals/datasets/storyboard.mjs`：把对应期望从「image + 连链」翻成「video + 不连链」（先读现状再改，别盲改）。
3. 查生成区 canvas SKILL（若有镜头默认表述）同步，保单一真相源。

**验收**：eval storyboard 跑通（期望对齐）；typecheck/build 绿；真机生成区说「拆镜头」→ 落 video 节点、不自动连链。

---

## Slice 2 · P0-9 地基：schema 开字段 + 喂模型清单（无 UI）

**根因**：后端 `storyboardShotSchema`（`canvasTools.ts:95-100`）只有 index/durationSec/anchorIds/prompt，AI 产不出 model/params/negative；渲染层 `PlanShot`（`storyboardPlan.ts:47-51`）其实**已支持** modelKey/modeId/params，缺后端口径 + AI 不知有哪些模型。

**改**：
1. `canvasTools.ts` `storyboardShotSchema` 加可选 `modelKey` / `modeId` / `params`（含 `negativePrompt`）。describe 写清「从注入的模型清单里选，别编不存在的」。
2. 规划师上下文注入「可用视频模型清单 + 各模型可调参数/模式」：复用 `availableModels.ts` 的 `listAvailableModelsForAgent` + archetype 参数 schema，拼成简洁清单喂进 `runStoryboardPlanner` 的 system/user（参生成区 `modelsBlock`）。
3. 渲染层 `parseStoryboardPlan` / `storyboardPlanToCreateNodesArgs`：确认 AI 产的 model/params 正确透传落画布（已支持，补 negativePrompt 落 params）。

**验收**：单测覆盖 schema 接受新字段 + 落画布带上；真机拆镜头 → 镜头节点带 AI 选的模型/参数/负面词（无效模型被钳回默认，不崩）。

---

## Slice 3 · P0-9 迭代回路：AI 改现方案

**根因**：`propose_storyboard_plan` 一次性（SKILL「只发一次」），无法「基于现方案改」。

**改**：
1. 规划师能读当前 `storyboardPlan`（已落 store）：`runStoryboardPlanner` 注入现方案 JSON 作为上下文；用户说「重拆/把所有镜头加负面词/统一冷调/第 3 镜改特写」时，AI 基于现方案产出**新整份方案**（仍走 propose_storyboard_plan，覆盖）。
2. SKILL.md（storyboard-planner）：去掉「只发一次」的绝对化，改为「首次产整份；用户要求修改时，读现方案、只改要改的、保留其余，再产整份」。
3. 创作区意图：复用拆镜头入口（已有方案时，"拆镜头/改方案"类话 → 带现方案进规划师）。

**验收**：真机——拆完说「全部加负面词、统一冷调」→ AI 产出的新方案保留原镜头只补负面词/风格，未推倒重来。

---

## Slice 4 · 编辑器呈现 AI 产的配置（UI，R8）

**根因**：编辑器已有每镜模型选择器 + `ShotParamControls`（`StoryboardShotCard.tsx`）。AI 产的值要在这些控件里**预选显示**，让用户看到/微调；负面词要有入口。

**改**（先读设计系统 + 现控件，token-only）：
1. AI 产的 modelKey/modeId/params → 编辑器控件预填（复用现控件，不造新组件）。
2. 负面词：若所选模型 archetype 有 negative_prompt 抽屉则填进去；做一个「AI 建议」轻标记让用户知道哪些是 AI 填的（渐进展开，不堆砌）。
3. 真机逐项打开交互态看遮挡/溢出（R13）。

**验收**：与现编辑器视觉一致；真机截图人眼判断 AI 预填值可见可改；`design-fidelity` 断言不破。

---

## 不在本单（仍延后）
P0-7 景别字段（暂缓）/ P0-6 分段拆（等记忆重设计）/ P0-11 一键出片（不做）。

## 回滚
逐 slice 独立 commit，按文件回退。Slice 1 与 2/3/4 解耦（一个改 free-build 提示，一组改 plan 链路）。
