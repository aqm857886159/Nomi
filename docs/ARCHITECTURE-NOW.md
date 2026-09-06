# 现在真正跑的是什么

> 状态：🚧 长期维护（这份文件不描述计划，只描述**当下 main 上真实运行的东西**）
> 最后核对：2026-08-31 · 核对基线：`origin/main`

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
| **Agent 运行时** | pi SDK `0.85.1`（`@earendil-works/pi-agent-core` / `-ai` / `-coding-agent`），主进程经私有 ESM 接缝调用 | `electron/harness/runtime/pi/*.mts`、`package.json:194-196` | ❌「引擎是 `electron/runtime.ts` 的 `runAgentChatV2`（`streamText`+工具）」——2026-08 已被取代。见 `docs/plan/2026-08-26-pi-r1-runtime-cutover.md` |
| **经验沉淀闭环** | canonical `ProjectAgentHost` 在提交成功终态后异步写入本地 `agent.turn.finished` 证据，再只接受带真实 EventLog seq 的显式 learning envelope；按证据完整度和风险路由到 project memory / Skill / Runbook / Gate / ADR / training-data。green fact 可自动投影到现有 memory；yellow 先 shadow；red 只隔离，不自动改生产代码或上传数据 | `electron/projectAgentHost/projectAgentTurnExecution.ts`、`electron/experience/projectAgentExperience.ts`、`electron/experience/experienceExtractor.ts`、`electron/experience/experiencePolicy.ts`、`electron/experience/experienceRepository.ts` | ❌「回答过一次就会自动写进 Skill/模型」——没有问题→行动→结果→验证四段证据和可追溯 EventLog seq 不会激活；当前仍需显式 envelope，未以真实用户任务宣称完成 |
| **Agent 工具组怎么选** | 按 **`capability`** 选，不是按 skillKey。`creation-editor`→全部文稿工具；`creation-chat`→3 个只读；`canvas-agent`→画布 + 时间轴控制 + 项目媒体读取工具；`canvas-refine`→仅 `set_node_prompt`；`storyboard`→`read_canvas_state`+`propose_storyboard_plan`；其余（含 `single-shot`）→**空工具集** | `electron/harness/agentChatPolicy.ts:35`、`electron/harness/tools/timelineDescriptors.ts` | ❌「按 skillKey 选工具组」——旧 `agent-merge-architecture.md` Phase 2 的说法，已不成立。**Skill 只提供方法，不授予工具权限** |
| **Agent 工具作用域守卫** | 主进程按 capability 校验工具名；`canvas-refine` 另校验 nodeId 必须在选中集内 | `electron/harness/agentChatPolicy.ts:46` | ❌ 以为只要 descriptor 存在就能调用 |
| **Agent 会话归属** | 仍是 **两个 area**：`creation \| generation`，**两份独立历史**。这是 R1 的过渡边界 | `src/workbench/ai/agentSessionKey.ts:3` | ❌「跨区记忆已经打通」——**没有**。项目级统一会话是 R2-U1 的未交付范围 |
| **预览区 Agent** | **没有**。`PreviewWorkspace` 不挂 AI 面板 | `src/workbench/WorkbenchShell.tsx:292` | ❌ 以为「传个 `aiSidebar` 就行」——R2-U1 明确「这不是只移动 JSX 就能解决的外观问题」，预览要接**共同宿主**，不是第三个 owner/历史 |
| **步数上限** | `storyboard`=24 步，其余=8 步，`single-shot`=1 步且零工具 | `electron/ai/agentChatV2.ts:102` | — |
| **非 Agent 文本链** | 仍是 `ai@4` 的 `streamText`（**没有**跟着换 pi） | `electron/ai/streamTextTask.ts:8`、`package.json:132` | ❌ 以为换芯是全局的 |
| **生成画布 renderer** | `@xyflow/react` 单内核，`GenerationCanvas` 是唯一稳定入口 | R21 · `src/workbench/generationCanvas/` | ❌ 以为还有第二 renderer / engine flag / fallback |
| **模型参考槽（「这个模型能接什么参考」）** | **档案里的一等声明式数据**，不是每个模型手写的 UI。`ArchetypeReferenceSlotKind` 六种：`first_frame \| last_frame \| image_ref \| video_ref \| audio_ref \| source_video`；`ArchetypeMode.slots: ArchetypeReferenceSlot[]`，每槽带 `kind / label / min / max? / inputKey? / asArray? / characterIndexed? / requiresAnyOf? / roleName?`（`max` 缺省 = 供应商没公布上限）。**`modeId` 决定一切**——哪些槽、哪些参数、transport task kind；切模式只改变「显示哪些槽」，参考值按 slot 键**全局**存在 flat meta 里、跨模式持久不清空 | `electron/shared/videoCapabilities/types.ts:31`（六种 kind）、`:39`（槽字段）、`src/config/modelArchetypes/types.ts:92`（`ArchetypeMode.slots`）、`src/workbench/generationCanvas/nodes/controls/archetypeMeta.ts:7`（切模式不清空） | ❌「参考槽还得新建一套抽象」——已经有了，直接消费；❌「`ShotParamControls.tsx` 是参考槽的先例」——它只管**标量参数**，不管参考槽 |
| **参考槽渲染与请求体映射** | 渲染器已拍板存在：`AssetReference` 吃 `slots[]`——单帧槽横排并列（≥2 个才显小标签区分），数组槽**合并成一排 + 一个「+」**。请求体映射是声明式的：`slot.inputKey` → `buildArchetypeInputParams`（只打**当前模式**声明的槽键）→ `extras.archetypeInput` → runtime 铺进 params → 供应商 mapping body | `src/workbench/assets/AssetReference.tsx:69`、`src/workbench/generationCanvas/nodes/controls/archetypeMeta.ts:688` | ❌ 以为要为每个模型各写一套参考 UI（那是并行版，违反 P1/P4）；⚠️ `slot.max` 是**声明上限**，不是能显示给用户的有效上限——运行时另有压制，见 `docs/lessons/nomi-reference-slots-are-already-declarative.md` |
| **本地资产上传路由** | 普通 mapping、自定义调用和 Replicate 拆解都在付费供应商请求前经过同一 `AssetIngestion` resolver；按图片/视频/音频能力排序为目标/已配置供应商上传 API → 用户自定义 Relay → Nomi 受限公共 Relay → 匿名链。支持 KIE、APIMart、fal、Replicate、Runway、RunningHub 的声明式上传协议；自定义 Relay Token 由主进程系统安全存储 | `electron/catalog/assetLocalization.ts:745`、`electron/catalog/assetRelayRuntimeConfig.ts:1`、`electron/settings/assetRelaySettings.ts:1`、`electron/runtime.ts:263`、`electron/catalog/customCallDispatch.ts:76`、`electron/image/decomposeLayers.ts:62` | ❌「只要有匿名图床就解决了」——匿名 host 仍是最后兜底；公共 Relay 有总量/过期/限流保护，供应商 key/额度/模型输入字段仍需分别验证 |
| **资源库发现层** | 项目、提示词、技能、素材仍各自使用原有 store/API；renderer 仅通过 `libraryDiscovery.ts`/`libraryAdapters.ts` 统一多词搜索、确定性筛选与最近使用排序，不保存资源正文、不提供 Agent 入口 | `src/workbench/library/libraryDiscovery.ts`、`src/workbench/library/libraryAdapters.ts`、各库 `*Library*` 组件 | ❌ 以为这会新增一个“概览/超级资源库”或替换 #223 Agent 能力边界 |
| **时间轴数据模型** | 固定 **3 轨**（image/video/audio）+ 独立 `textClips[]` + `transitions[]`。video/audio clip 可选带 `audio`（-60..0 dB、mute、帧级 fade-in/out）；无任意图层、无变速 | `src/workbench/timeline/timelineTypes.ts`、`src/workbench/timeline/clipAudio.ts` | ❌ 以为片段音量只有预览全局滑杆——clip 音频参数已经落盘并进入导出 |
| **分镜 → 时间轴** | `planStoryboardTimeline` 只按 `shotIndex` 排序选片；**落轴归采纳桥** `adoptStoryboardBatch`（整批一次写定、一层撤销、带 Proposal 幂等键 replay/stale/needs_attention） | `storyboardTimelinePlan.ts:58`、`adoptStoryboardBatch.ts` | ❌ 只读 planner 就断言「意图被丢掉了」——**字幕和转场是在采纳桥里落的**，planner 里看不到 |
| **字幕/转场落轴** | **已实现**：`node.meta.subtitle\|dialogue` → `textClips`；`node.meta.transition` → `transitions[]` | `adoptStoryboardBatch.ts:79`（caption）、`:88`（transition）、`:199`、`:217` | ❌ 以为字幕只能手打 |
| **两条分镜产出路径** | 渲染端 planner（`storyboardPlan.ts:180-182`）**声明** subtitle/dialogue/transition；Agent 工具 `propose_storyboard_plan`（`canvasDescriptors.ts:81`）**不声明**。→ 走 Agent 出的分镜没有字幕/转场 | 两处 schema 自行比对 | ⚠️ 这是**真实缺口**，不是设计意图 |
| **转场渲染** | **部分实现**。导出 manifest 保留 `transitions[]`；同轨连续片段的 `dissolve`/`fade` 使用 FFmpeg `blend`（兼容当前 FFmpeg 4.x，等价于 xfade 语义）渲染，预览和 WebM 导出复用同一帧级 resolver；`cut` 保持硬切，`match_cut`/`whip_pan` 明确 warning 后保持硬切 | `electron/export/ffmpegFiltergraph.ts`、`src/workbench/timeline/timelineTransition.ts`、`electron/export/exportManifest.ts` | ⚠️ 音频 `acrossfade` 仍未实现：当前固定 audio 轨禁止 overlap，且没有 audio-transition 实体；match-cut/whip-pan 仍待真实 backend parity |
| **Agent 媒体读取与输出** | `get_media` / `inspect_media` / `search_media` / `inspect_source_range` / `read_waveform`，以及项目绑定的 `export_timeline` / `inspect_export_job` / `verify_render` / `cancel_export_job` 已接入 `canvas-agent`。全部绑定 active project，只返回稳定 asset ID、白名单元数据或无路径的任务回执；本地 URL/相对路径/绝对路径不出工具结果。波形在 renderer 本地真实解码，导出验证明确是 receipt-level，不冒充逐帧/音频质量检查 | `src/workbench/timeline/agent/{mediaToolCall,exportToolCall}.ts`、`electron/harness/tools/timelineDescriptors.ts` | ⚠️ `inspect_media` 是技术元数据，不冒充视觉理解/ASR；语义镜头理解和 transcript 仍未实现 |
| **导出** | ffmpeg filtergraph：视觉链（scale+overlay+时间窗）/ 音频链（atrim→asetpts→clip volume/afade→adelay→amix）/ 文字链（全画幅 PNG overlay，**接在最后一层**）。片段 gain/mute/fade 与预览共用同一帧语义；任一素材有音轨 → `aac/mixdown` | `electron/export/ffmpegFiltergraph.ts`、`src/workbench/timeline/clipAudio.ts`、`electron/export/exportJobs.ts` | ❌ 以为 clip 音频字段校验失败会静默回退 WebM——坏 manifest 现在明确报错；缺省字段才保持旧项目原行为 |
| **对外 MCP** | 顶层目录是 `mcpToolCatalog.ts`；`mcpGenerationTools.ts` 只是**生成语义子目录**（11 个工具全是生成，无剪辑）。`tools/list` 广播的 JSON Schema 同时是唯一运行时校验边界 | `electron/capabilityCore/mcpToolCatalog.ts:12`、`mcpProtocol.ts:445` | ❌ 把非生成类工具塞进 `mcpGenerationTools.ts` |
| **对话式模型接入** | MCP 只提交公开连接资料并驱动 `begin -> credentials -> discover -> select -> request_confirmation -> start`；密钥只在 Nomi 可信页面保存，付费认证由签名 challenge 和 opaque receipt 授权。只有 canonical certification 真调用与制品验真通过后，模型才发布进普通目录 | `electron/capabilityCore/mcpIntegrationTools.ts:5`、`electron/integrationCertification/integrationSession.ts:1239`、`src/ui/onboarding/IntegrationConfirmationPanel.tsx:21` | ❌「Agent 能直接拿 API key、自己确认花费或写一行 seed 就算接入」——三者都不成立；静态内置档案和用户对话接入共享执行/认证边界，但信任入口不同 |
| **LocalAI 本地模型** | 只是 **external connector**：复用现有 OpenAI-compatible 添加供应商与认证流程，按 well-known/readiness/capabilities/models 证据增强发现。Nomi 不捆绑 LocalAI、不下载权重、不启动或监管 sidecar；发现到媒体能力也仍是 `uncertified`，通过对应 executor 认证前不会冒充可生成 | `electron/localRuntime/localAiExternalProbe.ts:278`、`electron/integrationCertification/httpConnector.ts:19`、`electron/integrationCertification/integrationSession.ts:515` | ❌「接 LocalAI 会让安装包多几个 GB」或「发现到 image/audio 就已经能用」——连接器代码很小，模型和进程始终由用户外部管理；发现证据不等于生产认证 |
| **内部 Agent vs MCP** | **两套入口合同，一套领域实现**。两边各有自己的 schema/权限链，但最终调同一个领域函数 | `applyCanvasToolCall.ts:595` 与 `capabilityApplyHandler.ts:543` 都调 `sendStoryboardToTimeline.ts:77` | ❌ 以为有共享的工具定义层——**没有**，共享点在领域 helper |
| **自动剪辑总纲** | 已有已批准方案：**E1 采纳桥（已实现）/ E2 结构化粗剪 / E3 理解式剪辑**，核心对象是 **EditPlan + 剪辑计划卡** | `docs/superpowers/plans/2026-08-24-unified-agent-master-plan.md` §5.1 | ❌ 另起炉灶重新发明（搜「自动剪辑」搜不到它，见 `docs/GLOSSARY.md`） |
| **生产流程引擎** | `productionRun`（阶段机+门+预算账本+审批回执+幂等+制品+事件流）。playbook 阶段：brief→direction→script→storyboard→build→generate→qa→**assemble**→export | `electron/productionRun/productionPlaybooks.ts:33` | ❌ 以为自动剪辑要新建管线——`assemble` 阶段已存在，目前只有一行 |

---

## 怎么维护这张表

- **改了架构 → 同一个 PR 里改这张表。** 和「加新必删旧」（P1）同一个道理：新实现落地，旧描述必须同时死掉。
- **发现有人被旧文档骗了 → 往「常见误解」列加一行**，写清「旧说法」和「真相」。这列是靠事故长出来的，不是靠设计。
- **每条锚点会随代码漂移。** 行号不准不算错，但**文件路径或结论不对就是错**，当 bug 修。
- 这张表**只增不肥**：一个子系统一行；细节留在锚点指向的代码和 `docs/plan/` 里。
