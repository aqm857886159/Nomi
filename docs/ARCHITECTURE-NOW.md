# 现在真正跑的是什么

> 状态：🚧 长期维护（这份文件不描述计划，只描述**当下 main 上真实运行的东西**）
> 最后核对：2026-08-27 · 核对基线：`origin/main` @ `8f9365ae`

## 这份文件为什么存在

2026-08-27，一个 AI 在本仓做调研，读了 `docs/plan/agent-merge-architecture.md`（2026-06，**零过期标记**），把它当成现状，于是整份方案建立在「引擎是 `electron/runtime.ts` 的 `runAgentChatV2`」这个**已经不成立**的前提上。它没做错任何一步流程——那份文档读起来和真相没有任何区别。

`docs/plan/` 有 397 篇方案。**方案文档天然会过期，这不是它们的错**——是缺一个「现在是什么」的落点。这份文件就是那个落点。

## 四条使用纪律

1. **只写现在跑的，不写要做的。** 计划、方案、取舍去 `docs/plan/`。这里出现「将要/计划/建议」= 写错地方了。
2. **每条必须带 `file:line`**，让读者能当场证伪。没有可验证锚点的条目不许进这张表——否则它三个月后就是下一个骗人的文档。
3. **「常见误解」列是这张表最值钱的部分。** 它直接写出「你可能在旧文档里读到的说法」，把踩坑挡在前面。发现有人（人或 AI）踩了新坑，就往这列加一行。
4. **开工前先扫一眼「在飞的 PR」，不只搜工作树。**

   ```bash
   gh pr list --state open --limit 50
   ```

   > 2026-08-27 交的学费：写完一份「自动剪辑」方案才发现 **PR #179 里已有一份更全的 E2 前置盘点**，开着 3 天了。仓库搜索、`docs/README.md`、`INDEX.md`、连本轮新加的 `check:docs-index` / `check:doc-status` **全都只扫工作树**，扫不到未合并分支上的文档——这是**门岗结构上拦不住**的一类，只能靠这条纪律。
   >
   > 命中可疑标题后，不用切分支也能读：
   > ```bash
   > gh pr diff <号> --name-only
   > ```
   > ```bash
   > git fetch origin <分支> && git show FETCH_HEAD:<路径>
   > ```

---

## 子系统现状

| 子系统 | 现在跑的是什么 | 权威锚点 | ⚠️ 常见误解（旧文档里的说法） |
|---|---|---|---|
| **Agent 运行时** | pi SDK `0.84.3`（`@earendil-works/pi-agent-core` / `-ai` / `-coding-agent`），主进程经私有 ESM 接缝调用 | `electron/harness/runtime/pi/*.mts`、`package.json:106-108` | ❌「引擎是 `electron/runtime.ts` 的 `runAgentChatV2`（`streamText`+工具）」——2026-08 已被取代。见 `docs/plan/2026-08-26-pi-r1-runtime-cutover.md` |
| **Agent 工具组怎么选** | 按 **`capability`** 选，不是按 skillKey。`creation-editor`→全部文稿工具；`creation-chat`→3 个只读；`canvas-agent`→全部画布工具；`canvas-refine`→仅 `set_node_prompt`；`storyboard`→`read_canvas_state`+`propose_storyboard_plan`；其余（含 `single-shot`）→**空工具集** | `electron/harness/agentChatPolicy.ts:35` | ❌「按 skillKey 选工具组」——旧 `agent-merge-architecture.md` Phase 2 的说法，已不成立。**Skill 只提供方法，不授予工具权限** |
| **Agent 工具作用域守卫** | 主进程按 capability 校验工具名；`canvas-refine` 另校验 nodeId 必须在选中集内 | `electron/harness/agentChatPolicy.ts:46` | ❌ 以为只要 descriptor 存在就能调用 |
| **Agent 会话归属** | 仍是 **两个 area**：`creation \| generation`，**两份独立历史**。这是 R1 的过渡边界 | `src/workbench/ai/agentSessionKey.ts:3` | ❌「跨区记忆已经打通」——**没有**。项目级统一会话是 R2-U1 的未交付范围 |
| **预览区 Agent** | **没有**。`PreviewWorkspace` 不挂 AI 面板 | `src/workbench/WorkbenchShell.tsx:292` | ❌ 以为「传个 `aiSidebar` 就行」——R2-U1 明确「这不是只移动 JSX 就能解决的外观问题」，预览要接**共同宿主**，不是第三个 owner/历史 |
| **步数上限** | `storyboard`=24 步，其余=8 步，`single-shot`=1 步且零工具 | `electron/ai/agentChatV2.ts:102` | — |
| **非 Agent 文本链** | 仍是 `ai@4` 的 `streamText`（**没有**跟着换 pi） | `electron/ai/streamTextTask.ts:8`、`package.json:132` | ❌ 以为换芯是全局的 |
| **生成画布 renderer** | `@xyflow/react` 单内核，`GenerationCanvas` 是唯一稳定入口 | R21 · `src/workbench/generationCanvas/` | ❌ 以为还有第二 renderer / engine flag / fallback |
| **时间轴数据模型** | 固定 **3 轨**（image/video/audio）+ 独立 `textClips[]` + `transitions[]`。无任意图层、无变速、无每 clip 音量 | `src/workbench/timeline/timelineTypes.ts:23` | — |
| **分镜 → 时间轴** | `planStoryboardTimeline` 只按 `shotIndex` 排序选片；**落轴归采纳桥** `adoptStoryboardBatch`（整批一次写定、一层撤销、带 Proposal 幂等键 replay/stale/needs_attention） | `storyboardTimelinePlan.ts:58`、`adoptStoryboardBatch.ts` | ❌ 只读 planner 就断言「意图被丢掉了」——**字幕和转场是在采纳桥里落的**，planner 里看不到 |
| **字幕/转场落轴** | **已实现**：`node.meta.subtitle\|dialogue` → `textClips`；`node.meta.transition` → `transitions[]` | `adoptStoryboardBatch.ts:79`（caption）、`:88`（transition）、`:199`、`:217` | ❌ 以为字幕只能手打 |
| **两条分镜产出路径** | 渲染端 planner（`storyboardPlan.ts:180-182`）**声明** subtitle/dialogue/transition；Agent 工具 `propose_storyboard_plan`（`canvasDescriptors.ts:81`）**不声明**。→ 走 Agent 出的分镜没有字幕/转场 | 两处 schema 自行比对 | ⚠️ 这是**真实缺口**，不是设计意图 |
| **转场渲染** | **未实现**。`transitions[]` 是纯元数据，导出侧无 `xfade`/`acrossfade`，dissolve 导出即硬切且无警告 | `electron/export/ffmpegFiltergraph.ts`（全文无 xfade） | ❌ 以为授权了 dissolve 就会出效果。注意 `timelineSubtitleTransitionContract.ts:169` **要求**至少 2 个显式转场——校验通过 ≠ 渲染得出来 |
| **导出** | ffmpeg filtergraph：视觉链（scale+overlay+时间窗）/ 音频链（atrim→adelay→amix）/ 文字链（全画幅 PNG overlay，**接在最后一层**）。任一素材有音轨 → `aac/mixdown` | `ffmpegFiltergraph.ts:259/192/339`、`exportJobs.ts:169` | ❌ 以为导出是静音的（`renderManifest.ts` 里的 `audioMode:'mute'` 会被 `exportJobs` 覆盖） |
| **对外 MCP** | 顶层目录是 `mcpToolCatalog.ts`；`mcpGenerationTools.ts` 只是**生成语义子目录**（11 个工具全是生成，无剪辑）。`tools/list` 广播的 JSON Schema 同时是唯一运行时校验边界 | `electron/capabilityCore/mcpToolCatalog.ts:12`、`mcpProtocol.ts:445` | ❌ 把非生成类工具塞进 `mcpGenerationTools.ts` |
| **内部 Agent vs MCP** | **两套入口合同，一套领域实现**。两边各有自己的 schema/权限链，但最终调同一个领域函数 | `applyCanvasToolCall.ts:595` 与 `capabilityApplyHandler.ts:543` 都调 `sendStoryboardToTimeline.ts:77` | ❌ 以为有共享的工具定义层——**没有**，共享点在领域 helper |
| **自动剪辑总纲** | 已有已批准方案：**E1 采纳桥（已实现）/ E2 结构化粗剪 / E3 理解式剪辑**，核心对象是 **EditPlan + 剪辑计划卡** | `docs/superpowers/plans/2026-08-24-unified-agent-master-plan.md` §5.1 | ❌ 另起炉灶重新发明（搜「自动剪辑」搜不到它，见 `docs/GLOSSARY.md`） |
| **生产流程引擎** | `productionRun`（阶段机+门+预算账本+审批回执+幂等+制品+事件流）。playbook 阶段：brief→direction→script→storyboard→build→generate→qa→**assemble**→export | `electron/productionRun/productionPlaybooks.ts:33` | ❌ 以为自动剪辑要新建管线——`assemble` 阶段已存在，目前只有一行 |

---

## 怎么维护这张表

- **改了架构 → 同一个 PR 里改这张表。** 和「加新必删旧」（P1）同一个道理：新实现落地，旧描述必须同时死掉。
- **发现有人被旧文档骗了 → 往「常见误解」列加一行**，写清「旧说法」和「真相」。这列是靠事故长出来的，不是靠设计。
- **每条锚点会随代码漂移。** 行号不准不算错，但**文件路径或结论不对就是错**，当 bug 修。
- 这张表**只增不肥**：一个子系统一行；细节留在锚点指向的代码和 `docs/plan/` 里。
