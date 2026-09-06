# 第三刀 · 投影清零：分镜单 owner 单名字

> 状态：🚧 进行中

## 范围与现状

分镜设计的生产真相源是 `src/workbench/workbenchDocumentSlice.ts` 的 `storyboardDesignsByDocumentId`：它保存每篇文稿的完整 `StoryboardDesign[]`，并由 `activeStoryboardId` 选择当前设计。现状同时维护 `storyboardPlans`（按文稿索引的兼容投影）以及 `storyboardPlan`/`storyboardPlanCommitted`（活动方案单字段投影）；写入 action 在两套字段之间手工同步，导致新真源与旧投影漂移。

盘点分组（以本分支起点行号为基线，实施后用 `rg -n` 更新）：

- **owner/写者**：`src/workbench/workbenchDocumentSlice.ts:102-417` 的初始化、`setActiveStoryboardId`、`addStoryboardDesign`、`renameStoryboardDesign`、`deleteStoryboardDesign`、`setStoryboardPlan`、`commitStoryboardPlan`、`discardStoryboardPlan`、hydrate actions。它们当前同时写两个映射。
- **持久化读写**：`src/workbench/project/workbenchProjectSession.ts:10-55` 读取/恢复两套映射；`src/workbench/project/projectNormalize.ts:95-130` 从旧单字段/映射重建并再次输出投影；`src/workbench/project/projectRecordSchema.ts:69-89,154-159` 声明三套字段；`src/workbench/project/projectRepository.ts:157` 种子写入旧映射。
- **UI/画布/Agent 读者**：`src/workbench/creation/storyboard/StoryboardWorkspace.tsx:16-24`、`StoryboardPlanCard.tsx:26-38`、`StoryboardPlanEditor.tsx:56`、`StoryboardNudge.tsx:35-42`、`src/workbench/generationCanvas/agent/applyCanvasToolCall.ts:247-260` 等直接读 `storyboardPlans`；应改为从 owner 数组按 `activeStoryboardId`/首项派生。
- **取证/走查**：`tests/ux/agent-runtime-walk-support.mjs` 与 `tests/ux/agent-runtime-production.walk.mjs` 仍从 `.nomi/agent-session.json` 读取；canonical Host snapshot 已由 `electron/projectAgentHost` 维护，应只读该快照。
- **其他影子状态**：`src/workbench/ai/ProjectAgentResidentShell.tsx` 的 `residentToolProjections` 是会话内工具结果缓存，不是分镜持久化投影；它没有写入项目 payload，也不与 storyboard design 同名，因此保留，补充其“短生命周期 UI 缓存、非领域真相源”说明。

## 决定

- 唯一 owner 与持久化名字：`storyboardDesignsByDocumentId`。
- 删除 renderer state/payload 的 `storyboardPlans`、`storyboardPlan`、`storyboardPlanCommitted` 兼容字段及所有双写；当前方案统一由 owner 数组和 `activeStoryboardId` selector 派生。
- 保留领域类型/纯函数名 `StoryboardPlan`、`setStoryboardPlan`、`storyboardPlanToCreateNodesArgs`，因为它们表示方案值或动作，不是第二份状态；禁止新增同义状态字段。
- 旧 `.nomi` 项目加载时仅读旧字段一次：`normalizePayload` 将旧单字段/映射转换成 `storyboardDesignsByDocumentId`；归一化输出只含 owner。后续保存与重启不再写回旧字段。若新 owner 与旧字段同时存在，以 owner 为准并丢弃旧字段。
- `agent-session.json` 仅保留 Host 迁移测试覆盖；取证 runner 改读 Host snapshot，不再把退役上下文文件当成证据。

## 删除清单

1. `WorkbenchDocumentSlice` 的 `storyboardPlans` 状态、`StoryboardPlanEntry` 兼容类型、双写分支和 `hydrateStoryboardPlans`。
2. 项目 payload/schema/normalize/session/repository 的旧字段读写与导出。
3. UI、Agent、画布读取旧映射的调用点，统一改为 owner selector/数组查找。
4. 旧投影相关测试断言；新增单写入点结构测试，扫描 `src/workbench` 禁止 `storyboardPlans` 以及持久化字段 `storyboardPlanCommitted`。

## 迁移与回滚

迁移是字段重建式且单向：读取旧 payload → 构造带 id/status/timestamps 的 `StoryboardDesign[]` → 返回只含 owner 的 payload；保存一次后旧字段消失。回滚使用本提交前的分支/PR 头恢复代码；已保存的新格式需在旧版本打开前由 git revert 恢复兼容读取，不能通过重新双写制造并行真相源。

## 验收门

- 方案文档已挂 `docs/plan/INDEX.md`；schema-v3 recurring 根因合同通过 `check:root-cause-contracts`。
- `rg` 结构门岗证明 src/workbench 无 `storyboardPlans` 状态/持久化字段；只有 owner 的写入点，`residentToolProjections` 仅内存缓存。
- 现有分镜/Agent/画布测试不删断言并继续通过；新增旧格式迁移、重启后不再复现旧字段、单写入点测试。
- `pnpm run test:golden`、三条 storyboard UX 走查、`pnpm run gates` 通过；截图保存于 `.tmp/`。
