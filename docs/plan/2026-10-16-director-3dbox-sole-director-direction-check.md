# 方向检查：3D-BOX 成为唯一导演台——删开关与旧导演台分支（2026-10-16）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 触发：`fix-churn` 命中 `verbs/writeVerbs.ts`（14 天第 5 个）、`agentLane/laneHost.mts`（第 5 个）、`preload.ts`（第 5 个）、`agentLane/laneDesktopTools.ts`（第 3 个）、`DirectorEditor.tsx`（第 3 个）、`ai/resident/residentToolDisplay.ts`（第 5 个，目录第 7 个；本刀在那里只补 §8 那一处，它的门岗本来就从注册表派生、是它抓到的，缺的是「开关开」这一支从来不跑单测——类根因就是开关分叉，本刀删掉）。
> 用户 10-16：「我觉得可以打开给大家用吧 因为本身这部分也是提升用户价值的」；「为什么要切回旧导演台？功能完全一致、还优化了交互，它为什么要去切换呢？」协调采纳，按 P1「加新必删旧」：默认打开，同一个 PR 删掉开关和旧导演台分支，不留并行版、不留切回入口、不留 fallback。
> 方案正本 `docs/plan/2026-10-04-director-3dbox-phase3.md` §11「切换 PR」。旧导演台功能普查：`docs/design/boards/2026-10-16/Director3dbox.board.json` 的 functionCensus（22 项）。

### 0. 一句话根因

这几个文件 14 天里的 fix 有相当一部分就是「开关两张面」造成的：工具面、预演闸、取证白名单、技能可选性、导演台外壳都要按开关各写一支，任何一支漏改就是一个 fix（3a 外壳的开关握手、3b 的门岗、#1151 的工具预算、S2 的写回规矩）。开关本身是临时债（登记到期 2026-11-15）；用户决定打开，最好的修法是**删掉分叉**，不是再给分叉补规矩。

### 1. 归类表

| 处 | 现在 | 删后 |
|---|---|---|
| 工具面（`writeVerbs` / `registry` / `canvasWrite` 别名） | 两份 `stage_shot`、`director.write` 条件注册 | 只有 `director.write` 那一份 `stage_shot` |
| 读面（`canvasRead` 3D-BOX 摘要）、预演闸（`laneDesktopTools`）、取证白名单（`surfacePortPreloadBridge`）、技能可选（`skillStore`） | 按开关开 / 关 | 恒开 |
| 开关取证（`featureFlags/*`、`preload`、`mainWindowWebPreferences`、`laneHost`、`mcpStdioServer`、`src/featureFlags`、`bridge.ts` 类型、`vite.config.ts`、`write-feature-flags.mjs`、`check-packaged-flags.mjs`） | 每个进程首个导入、指纹核对、烤进包里 | 整套删除 |
| 门岗 / CI（`director3dbox-face` job、第二份面快照、`requiresFlag` 用例、`requires-flag` 技能字段） | 两张面各比一次 | 只有一张面 |
| 导演台外壳（`DirectorEditor` / `DirectorRefineShell` / `DirectorViewport`） | 开关关 = 旧导演台（全屏、底部 AI 胶囊、无导演视图） | 只有 3D-BOX：导演视图默认，精修一键；AI 胶囊删除（去处 = 右侧 Agent 面板，10-03 样张删除表） |

### 2. 不能删的（如实列出）

- **对外 MCP 的摆位参考 / 运镜参考**（`nomi_canvas_edit` 的 `create_staging_reference` / `create_camera_move`）：外部 Agent 在用，按协调要求保留。它们建出来的就是导演节点，打开即进 3D-BOX 导演台（现在唯一的导演台），所以「迁到新导演台」不需要改它们的执行体；只把**内部** Agent 的旧 `stage_shot`（同一组操作的内部别名）删掉，内部改走 `director.write`。保留理由写进 `stagingBuilder` / `cameraMoveBuilder` 的头注释。
- `DirectorHeadlessCapture` 的 `waitForActionClips` 选项：MCP 运镜参考仍走「不等动作片段」的旧出片节奏，预演走「等」；它不是开关分叉，不在本刀范围。

### 3. 不删的话会冒出什么

| 预测 | 验证 |
|---|---|
| 开关到期日（11-15）一到自写登记审计红；任何新工具改动都要改两张面 | `self-written-review` 的 `revisitBy` |
| 默认打开但留着关的分支，旧导演台那一支没人测、悄悄坏掉（例如本轮发现的写回规矩差点跟着开关切） | S2 方向检查 |

### 4. 靶子独立性检查

工具面快照：删后唯一的 `model-face-baseline.json` / `tool-face-baseline.json` 就是此前 CI 里一直在比的「开关开」那份（`*.director3dbox.json`），逐字节采用，不重新生成；用户 10-16「开了吧」即对这张面的签字。

### 5. P0

不涉及通用能力。删除为主。

### 6. 补 / 换 / 删

| 选项 | 推荐 |
|---|---|
| 补（默认值改开，分叉留着） | 否：P1，并行版 + fallback |
| **删** | **是**：同一个 PR 删开关与旧导演台分支 |

### 7. 用户要权衡的核心

已由用户 10-16 定。

### 8. 删掉开关以后才露出来的（开关开的那一支以前没人测）

单测默认开关关，「开关开」那张面只在 CI 一个 job 里跑工具面快照。默认打开以后整套单测第一次跑在 3D-BOX 上，红了一处真缺口：

- `director.write` 这个契约在工具条 / 审批卡上没有自己的名字，会落成通用的「工具」（`residentToolDisplay.test.ts` 的「每个契约都有人话名」）。修法：只有一个动词的契约按它那个动词说话（`CONTRACT_SOLE_VERB`，`director.write` → `stage_shot` 的说法）。

另外三条契约 / 注册表测试（`registry.test.ts`、`canvasWrite.test.ts`）写的是开关关的面，改成唯一那张面。

### 9. 官网技能库

`skills/director-3dbox` 去掉 `requires-flag` 后，官网导出（`scripts/site/export-site-data.mts`）不再按开关把它藏起来：技能库多一张「3D-BOX 预演」卡（配图是真产品截图），相关页面的推荐卡跟着重排（`pnpm run build:site` 重新导出，63 个页面）。应用里人人可用，官网目录与应用一致。

## 特征测试清单

- 旧导演台功能普查 22 项逐项钉住：`src/workbench/generationCanvas/nodes/director/directorFunctionCensus.test.ts`（读清单的 functionCensus，每项一条探针，清单里多一项没探针 = 红）。
- MCP 两个操作还在、还能建导演节点：`electron/capabilityCore/director3dboxToolFace.test.ts` 改写为「对外面仍有这两个操作」+ 既有 `stagingBuilder.test.ts` / `cameraMoveBuilder.test.ts`。
