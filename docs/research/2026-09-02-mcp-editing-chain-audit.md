# 剪辑链路真走查审计（#202 式）：MCP × 剪辑/时间轴工具族

日期：2026-09-02 · 基线：`origin/main@349529e6`（Merge PR #309）
性质：只审计 + 记录，不修产品代码。参照 #202（MCP 生成链事故审计）与 `docs/research/2026-09-02-mcp-survey.md` §3 的记法：E-ID / 现象 / 证据 file:line / 影响 / 修法一句。
服务对象：M2 slice-2（把剪辑族收敛成 `timeline_read` / `timeline_edit(preview|apply)` / `export_job(host-only)` / `media_query` 四个语义意图，见 `docs/architecture/agent-m0-tool-mapping.md` 行 26-38）。

## 0. 走查方法与诚实记分

**真走了的（两条腿，全部真代码真进程）：**

1. **MCP stdio 真客户端全链**：`pnpm build` 后用 `tests/ux/_mcpJourney.mjs` 的 `spawnMcpStdioClient` 起真 Electron stdio server（隔离 settings/userData/projects/capability 四目录 + mock vendor 目录），以 `clientInfo: Claude Code` 走 initialize → tools/list → 调用剪辑族 14 个工具名 → `nomi_create_project` → `nomi_session_open`（错参/对参各一次）→ `nomi_read_canvas` → `nomi_get_run`（未知 id）。逐步记录入参/返回/isError/structuredContent。首跑撞出服务端启动即退（见 E-02），补种 capability token + `NOMI_MCP_CLIENT/PROOF`（HMAC `nomi-mcp-client:v1:claude`）后走通。
2. **时间轴编辑内核真语义走查**：tsx 直驱 pi 工具链真正执行的模块（`src/workbench/timeline/kernel/timelineKernel.ts` 的 `applyTimelineOperations`/`timelineRevision`/`validateTimeline` + `electron/shared/agentCapabilities/timelineRead|timelineWrite|assetRead|exportCapabilities` 的 schema 与 pi 描述），种 30fps、双轨 4 clip + 字幕 + 转场的时间轴，走 propose 预览 → apply → 过期 revision → 未知 clip → 越界 trim → 重叠 move → 界外 split → 多操作原子性 → schema 拒绝 → ripple 字幕语义 → 全部 14 条工具描述转录。

**没走到的（诚实边界）：**
- pi 工具**全链**（fixture LLM → harness → 审批卡 → surface port IPC → renderer 执行器）没有活体走查：常驻 Agent host 在 main 上默认关闸（`src/utils/agentHostPreference.ts:24`，#194 未完成），且走查中发现时间轴审批 UI 根本没有挂载面（E-16），审计窗口内无法搭出可走的真 UI 链。apply/undo 的 store 层语义（undo token、共享撤销栈）为**代码级审计**（`src/workbench/timeline/agent/timelineCapabilityTarget.ts` 全文精读），非活体。
- 导出没有真起 ffmpeg job（审计纪律：到 gate 前沿）；`export_timeline/inspect/verify/cancel` 行为为代码级审计（`src/workbench/timeline/agent/exportToolCall.ts` + `electron/export/exportJobs.ts`）。
- 隔离 profile 走查，非用户真库。

**记分**：MCP 腿 8 步全走通（其中 3 步按预期红）；内核腿 12 步全走通。证据落盘：`/tmp/mcp-evidence-final.json`、`/tmp/timeline-kernel-audit-evidence.json`（走查脚本为一次性审计脚本，未入库）。

**做得对的（先说，免得下面像全盘否定）**：CAS revision 闸真实有效（K4 `stale_revision` 且回传当前 revision）；propose 预览与 apply 的 revision 确定性一致（K3 `sameAsPreviewRevision:true`）；plan 失败即整单不落（内核纯函数，store 只在 ok 才 commit）；工具描述对能力边界很诚实（"without claiming decoded media inspection"）；`export_timeline` 走的就是用户同款 MP4 管线（`exportToolCall.ts:127` → `exportTimelineToMp4`），空时间轴/过期 revision 在花钱前就拦（`exportToolCall.ts:180-186`）；search_media 有 limit/truncated（`mediaToolCall.ts:384-394`）；read_waveform 拒图片（`mediaToolCall.ts:230`）。

## 1. 问题清单 E-01…E-16

| ID | 现象 | 证据 | 影响 | 修法一句 |
|---|---|---|---|---|
| **E-01 (P0 结构)** | **剪辑族 14 个工具在 MCP 面 100% 缺席**：tools/list 42 个工具零个 timeline/media/export；描述与 initialize instructions 也零提及「时间轴/剪辑」；唯一有 `aliases.mcp` 的能力是 canvas.read | 实测 tools/list（editingFamilyPresent=[]）；`electron/shared/agentCapabilities/canvasRead.ts:297-300` 有 `mcp:` 别名 vs `timelineRead.ts:289`、`timelineWrite.ts:113`、`exportCapabilities.ts:177,193`、`assetRead.ts:218` 全部只有 `pi:` | 外部 AI 完全不能读/剪/导时间轴；而 pi 面又在默认关闸的 Agent host 里（`agentHostPreference.ts:24`）——**main 上不存在任何用户可达的 AI 剪辑链**。slice-2 的「收敛」对象在 MCP 面实为「从零投影」 | slice-2 按 mapping 行 26-38 给四个语义工具挂 `aliases.mcp`（export_job 守 host-only 语义） |
| **E-02 (P0 网破)** | **旧 MCP 旗舰旅程在 main 上是红的**：stdio server 启动即退 `[nomi:mcp-stdio] 启动失败: A verified MCP client connection is required`，exit 1 | 控制组实跑旧旅程 → 初始化失败 `process exited code=1`；根因 `0b6441c6`（M1 round-2，09-01 经 #301 合入）让 `createProductionMcpStdioProjectSessionBinding`（`mcpStdioProjectSessionBinding.ts:21-24`）在启动时无条件要求已验证客户端，而旅程 spawn 不带 `NOMI_MCP_CLIENT/PROOF` | MCP 回归网在 slice-2 开工前夜整体失效；真实外部客户端若配置里缺这对 env（手写配置者）也是同样「秒死且 stderr 才有原因」 | 旅程 harness 补种 token+proof（本审计已验证 3 行即通）；顺手加「启动失败原因回 stdout JSON-RPC error」讨论 |
| E-03 | 调不存在的工具只回 `-32602 未知工具: read_timeline`，无「可用工具族提示/最近似名」 | 实测 call read_timeline/export_timeline/apply_edit_plan 三连 | 外部 AI 按 mapping 文档名探测时得不到任何转向线索，只能盲试 | 未知工具错误附「用 tools/list 查目录」+ 近似名建议 |
| E-04 | **会话链关键数据不在 structuredContent**：`nomi_create_project` 的 id/projectSelectionHandle、`nomi_session_open` 的 leaseHandle、`nomi_read_canvas` 的画布事实全部只在 text 的 prose-JSON 里，`structuredContent.nomiOutcome` 恒为 `{}` | 实测三步 outcome 均空对象（evidence steps）；对照 `nomi_get_run` 族有 `nomiRunData`（memory 已交过学费：text 是人话不是 JSON） | 模型被迫从文本里抠 JSON 才能续链——本审计自己第一轮就因此把 projectId 读成 undefined，错误连锁到后两步 | 会话链三件套把稳定字段进 nomiOutcome（A6 契约既有形状） |
| E-05 | 校验类错误 `errorCode: null` + `recoveryActions: []` 成系统性缺省；`nomi_session_open` 空参时 recovery 是「请重新选择当前项目 / reselect_project」——外部 AI 没有选择 UI，真正的下一步（用 create_project 回的 projectSelectionHandle）只字未提 | 实测：空参 → `lease_required` + 误导 recovery；错参名 → 「未知参数（这个工具只接受：projectSelectionHandle / bootstrap）」（这条反而不错）；bad-args read_canvas/get_run → errorCode null、recoveryActions [] | #202 的「错误给恢复动作」教训在剪辑入口链上没落地；AI 无法自纠 | 校验错误统一带 errorCode + 至少一条指向来源工具的 recovery |
| E-06 | 项目租约 5 分钟过期（issuedAt 20:05:05 / expiresAt 20:10:05），工具结果不提示续租方式 | 实测 leaseHandle base64 解码 | 长剪辑会话中途 lease 过期时模型只会撞 `lease_required`（是否自动续未验证，标注为开放问题） | slice-2 明确租约生命周期投影（剩余时长/续租动作） |
| E-07 | 唯一的 MCP 读工具 `nomi_read_canvas` 零时间轴事实（只有 nodes/edges/groups/selectedNodeIds） | 实测返回体；`mentionsTimeline:false` | 外部 AI 连「这个项目有没有时间轴内容」都无法得知——状态不可见先于操作不可达 | timeline_read 落 MCP（E-01 同源，消费面不同故单列） |
| E-08 | **diff 投影把 before/after 全剥掉**：内核 diff 有值级信息（K2 样例 `clips[0].endFrame 120→60`），pi 投影只给 `{path, change}` | 内核实测 vs `timelineCapabilityTarget.ts:125-145`（`projectTimelineDiff` 只留 path+change 三态） | 模型 apply 后无法核对改动是否符合意图，只能整份重读时间轴（token 反噬） | diff 条目保留 before/after（url/thumbnail 已有过滤可续用） |
| E-09 | **diff 是按数组下标的位置式 diff**：一次 split 产生 18 条目、把 `clips[1..]` 的 id/label/sourceNodeId 全部「改写」（`clips[1].id: v2→v1-split` 看起来像换血）；上限 4096 截断 | 内核实测 K2（diffEntryCount 18）；`timelineRead.ts:131`（TIMELINE_DIFF_ENTRY_LIMIT=4096） | 长时间轴开头插一刀 → 数千条目 → 截断；「发生了什么」永远无法从 diff 读出，是 E-08 的放大器 | diff 以 clip 身份（id）为键或补 op 级语义摘要（"split v1 at 60 → v1+v1-split"） |
| E-10 | 越界 trim 静默钳制：`deltaFrame:-500` → `ok:true` + warning `trim_clamped`，但不说钳到了哪（有效 delta/结果帧） | 内核实测 K6 | 模型以为剪了 500 帧，实际剪了多少要再读一遍才知道——「回执与真实状态一致」镜头下的半诚实 | trim_clamped 附 effectiveDelta/resulting start,endFrame |
| E-11 | `stale_revision` 回传当前 revision（好）但无 recovery 动作（「重读时间轴再重排 plan」） | 内核实测 K4；写路径错误码见 `timelineTransportAdapters.ts:20-39`（纯 code 无动作） | 协作冲突是 AI 剪辑最高频失败；每次都靠模型自悟 | 冲突错误统一带 refresh→rebase 建议 |
| E-12 | ripple 默认不动字幕（`includeText` 默认 false）：整体后移 30 帧后 caption 仍在 0-60，无任何 warning | 内核实测 K11；`timelineKernel.ts:40-45` | 模型「把所有内容后移」的自然指令会静默造成音画字不同步 | ripple 范围覆盖 textClips 时发 warning 诊断（或默认 includeText:true 过设计裁决） |
| E-13 | undo 是「共享撤销栈栈顶、仅一步」：apply A→B 后 undo(A) = `undo_token_invalid`；用户手动剪一刀也会顶掉 agent 的 token；错误码不区分「已被顶掉/已撤过/token 错」 | `timelineCapabilityTarget.ts:317-327`（只查 `timelineUndoStack.at(-1)` 的 metadata）；`workbenchStore.ts:424`（用户编辑同栈 push） | 描述承诺「undo the exact most recent Agent timeline edit」是诚实的，但失败时模型分不清三种原因，也不知道 Cmd+Z 栈已被用户占用 | undo 失败附 typed reason（superseded_by_user_edit / already_undone / unknown_token） |
| E-14 | `cancel_export_job` 编造结果状态：成功路径直接返回 `{cancelled:true, status:'cancelled'}`，不回读 job 真状态（与完成竞态时会说谎）；取消也不带原因/善后 | `exportToolCall.ts:221-226`（cancelJob 后无 re-read；对照 `exportJobs.ts:358-368` cancel 是异步 abort） | #202 J02（取消无成因）在导出族的镜像 + 「验证物=所见物」违背：回执是断言不是观察 | cancel 后回读 snapshot 投影真状态 |
| E-15 | 导出警告只给计数不给内容：`warningCount: N`，全工具面无处读警告文本 | `exportToolCall.ts:105` | 模型看见 warningCount=3 之后无事可做——不可行动的信息（R2） | inspect_export_job 附 warnings 摘要（bounded） |
| E-16 | **时间轴编辑审批 UI 是无挂载死代码 + 守它的测试读不存在的文件**：`AssistantTimeline.tsx`/`TimelineEditPlanCard.tsx` 无任何非测试 import；`tests/ux/timeline-agent-ui.node-test.mjs` 读 `CanvasAssistantPanel.tsx`/`useTimelineAgentUi.ts`（两文件已随 host cutover 删除，跑必 ENOENT）且未接进任何 runner | grep 全仓 import 零命中；`ls src/workbench/generationCanvas/components/` 无 CanvasAssistantPanel；package.json 无该 node-test 引用 | apply_edit_plan 的「用户审批」在 main 上没有渲染面（常驻壳自带 residentToolDisplay 是另一套）；R1 违背（新家建了旧家没拆）+ 假守卫误导读者 | slice-2 裁决审批卡归宿后删死码死测（不修，留给施工班） |

P0 裁定：E-01/E-02 为 P0（一个是「链路整体不存在于 MCP」的结构性事实，一个是回归网中断）；无崩溃级（服务端全程无 crash——E-02 是受控 exit 1）。

## 2. slice-2 红灯建议（假 vendor 网 / 走查网里该常红→翻绿的条目）

按 survey §4.3 C-list 风格，每条=可复演断言+今天预期色：

| # | 红灯 | 锚 | 今天 |
|---|---|---|---|
| R1 | tools/list 含 `timeline_read`/`timeline_edit`/`media_query`，且 `export_job` 语义按 host-only 投影 | E-01 | 红 |
| R2 | `pnpm run test:mcp-journey` 全绿（harness 种 token+proof 后） | E-02 | 红（3 行可翻绿，先修网再施工） |
| R3 | 会话链三件套（create_project/session_open/read_canvas）`structuredContent.nomiOutcome` 非空且含续链字段 | E-04 | 红 |
| R4 | 任意 isError 结果 `errorCode ≠ null` 且 `recoveryActions.length ≥ 1`，且 session_open 空参的 recovery 指向 projectSelectionHandle 来源 | E-05 | 红 |
| R5 | apply→(用户改一刀)→undo 返回 typed reason 而非裸 `undo_token_invalid` | E-13 | 红 |
| R6 | 一次 split 的 diff 可读性预算：条目 ≤ 阈值 或带 op 级摘要；条目含 before/after | E-08/E-09 | 红 |
| R7 | cancel_export_job 的 status 来自 cancel 后回读 | E-14 | 红 |
| R8 | ripple 覆盖 textClips 且未 includeText 时出 warning 诊断 | E-12 | 红 |

建网次序建议：R2 最先（它是其余一切红灯的运输层）；R1/R3/R4 随 slice-2 主体；R5-R8 是 timeline_edit 语义细化，可与假 vendor L2 网（survey C7-C12）同班。

## 3. 开放问题（未验证，别当结论用）

- 租约是否有静默续期（E-06 只解了 handle 没等 5 分钟实测过期行为）。
- pi 全链活体走查（fixture LLM → 审批卡 → surface port）待 #194 开闸或专班搭 fixture；本审计的内核/代码级结论在该层之上可能还有新摩擦（尤其审批卡文案与 E-16 的归宿）。
- `verify_render` 的 verification 投影形状（`exportJobs.ts:345` → exportJobManager.verifyJobOutputForProject）没实跑 job 故未观察实物。
