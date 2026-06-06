# 文件库梳理审计（2026-06-06）

> 触发：用户反馈"文件库太大，难读"。目标：删没必要的、简化没用的、合并并行版。
> 方法：4 维并行 subagent（死文件 / 并行版 / docs+依赖 / 巨壳结构）+ 人工 grep 复核关键论断（规则 14）。
> 规模基线：src 206 + electron 107 个 TS 文件，约 44.8k 行非测试代码，5 个巨壳白名单，CSS 1943 行。

## 分级结论 + 执行分层

### Tier 0 — 立即删，零风险（已人工 grep 核实无引用，CI 门兜底，git 可回滚）

| 项 | 证据 | 动作 |
|---|---|---|
| `@dnd-kit/core` `@dnd-kit/modifiers` `@dnd-kit/sortable`（3 个 dep） | 全仓 `grep dnd-kit` 0 命中（除 package.json/lock） | `pnpm remove` |
| `src/utils/motionPresets.ts`（97 行） | `grep motionPresets` 0 命中 | 删文件 |
| `src/workbench/generationCanvasV2/index.ts`（barrel，12 行） | `grep "from '…/generationCanvasV2'"` 0 命中（消费方都走深路径） | 删文件 |
| `public/X Bot.glb`、`public/humanoid+figure+3d+model.glb` | 0 引用；实际用的是 `src/assets/x-bot.glb` | 删文件 |
| `electron/systemProxy.ts::getActiveProxyLabel` | 本次新增即未用（describeNetworkError 直接读模块变量） | 删该 export |
| `docs/.DS_Store` | macOS 元数据 | 删 + `.gitignore` 加 `**/.DS_Store` |

### Tier 1 — 删旧并行版（规则 1：不留 fallback 逃生口；已核实死链路）

**v1 agent chat 整条链路**。核实：`sendWorkbenchAiMessage(input, handlers?)` 唯一调用方
`workbenchAgentRunner.ts:96` 永远传 `handlers`（76–94 字面量构造）→ `workbenchAiClient.ts:52` 的
`if (!handlers)` 分支不可达 → 走 v1 的 `workbenchAgentsChat` 永不执行；`agentsChat` 0 调用方。

涉及（同 commit 删干净）：
- `electron/runtime.ts:2285` `runAgentChat`（v1，注释自承"kept as a fallback"）
- `electron/main.ts:25` import、`:288` `ipcMain.handle("nomi:agents:chat", …)`
- `electron/preload.ts` 的 `chat` 暴露 + `src/desktop/bridge.ts` 的 `chat` 类型
- `src/api/desktopClient.ts:404` `agentsChat`、`:390` `agentsChatStream`（死壳，注意保留 `workbenchAgentsChatStream`）、`:408` `workbenchAgentsChat`
- `src/workbench/ai/workbenchAiClient.ts:52-54` 的 `if (!handlers)` 兜底分支 + 其 import

**轻量类型去重**（1 行修改，零风险）：
- `electron/ai/buildAiSdkModel.ts:20` 的 `AiSdkProviderKind` 改为 `import` 自 `catalog/types.ts`（单一真相源，注释已声明）。

### Tier 2 — 整理 / 合并（低风险，大范围 touch，建议单独成 commit）

- **docs 归档**：22 份已 ship 的 plan/audit（v0.7/v0.8/onboarding 系列）移入
  `docs/archive/{v0.7-shipped,v0.8-shipped,onboarding-2026-05}/`；过期 handoff 2 份归档。
- **双 mockup 目录**：`docs/mockups/`(3) 并入 `docs/design/mockups/`（消除"双目录漂移"）。
- **目录命名误导**：`generationCanvasV2/` → `generationCanvas/`（V1 已不存在，留 V2 后缀让人反复确认"是不是并行版"；改 ~30 import）。**需用户拍**（大范围、纯命名收益）。

### Tier 3 — 拆巨壳（架构重构，多会话，每项先写 plan 文档，规则 4/9）

按 ROI（痛 × 频繁 × 低风险）排序：
1. `electron/runtime.ts`（2623 行，5 个领域）→ 拆进已存在的 `catalog/ export/ tasks/ assets/ skills/ ai/` 子目录。**最高 ROI、低风险**（每个 export 都是 IPC 边界，无 in-file 状态耦合）。
2. `generationCanvasV2/components/GenerationCanvas.tsx`（1186）→ 抽 `useCanvasViewport` 等 hook（一刀减 250 行，零风险）。
3. `generationCanvasV2/store/generationCanvasStore.ts`（1122）→ **把 AI 抽屉 UI 态拆成独立 store**（顺手修一个"UI 混进领域 store"的规则 9 分层 bug）+ nodeOps/groupOps 拆纯函数。
4. `nodes/BaseGenerationNode.tsx`（1406）→ 抽 `useNodeDragResize`（中风险，RAF cleanup 要跟走）。
5. `scene3d/Scene3DFullscreen.tsx`（4598）→ 最痛但改动不频繁、R3F 闭包耦合风险中高，**最后拆**，先摘纯函数 `poseData.ts`/`scene3dMath.ts` 热身。

### 需用户确认（不自行处理）

- `electron/skills/skillManifestSchema.ts`（+test，75 行）：只被自己 test 引用，runtime 未消费。
  是废弃功能还是计划中的 skill 校验？→ 用户定。
- `@vitest/coverage-v8`：无脚本/CI 跑 coverage，是否还本地用？
- 更大范围的"死导出"清扫：建议用 `knip`/`ts-prune` 做 AST 级精确扫描，单独一轮。

## 不动什么

- CSS（规则 10 单独治理，当前 1943 行已健康）。
- 任何"需确认/需 migration 核实"的（如 ProjectCategory.icon 旧字段、legacy meta keys 兜底）——
  涉及线上用户数据形态，不在本轮擅动。

## 验收门

每个 Tier 落地后跑全套：`check:filesize` + `lint:ci` + `typecheck` + `vitest run` + `build` 全绿。

## 执行结果（回填）

- **Tier 0 ✅**：删 3 个 dnd-kit 依赖、`motionPresets.ts`、`generationCanvasV2/index.ts` barrel、
  2 个孤儿 `.glb`、`getActiveProxyLabel` 死导出、`docs/.DS_Store`。
- **Tier 1 ✅**：删 v1 agent chat 整条死链路（`runAgentChat` + IPC `nomi:agents:chat` + preload.chat +
  bridge.chat + `agentsChat`/`agentsChatStream`/`workbenchAgentsChat` + 不可达 `if(!handlers)` 分支 +
  连带死掉的 `createDesktopAgentResponse`）；`sendWorkbenchAiMessage` 的 handlers 改必填；
  `buildAiSdkModel` 的 `AiSdkProviderKind` 改 re-export 单一真相源。
- 验收：5 门全绿（filesize/lint 96<98/typecheck/647 vitest/build）+ e2e 冒烟 10 断言全过（app 启动、主链路完好）。
- **Tier 2/3：待用户拍板范围**（见下方对用户的提问）。
