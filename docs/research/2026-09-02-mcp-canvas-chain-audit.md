# 画布结构链真走查审计（#202 式）：MCP × 画布/文档工具族

日期：2026-09-02 · 基线：`origin/main@147fcd42`（Merge PR #337，slice-2 editing-a 已入）
性质：只审计 + 记录，不修产品代码。五链配方第三链（生成 #202 ✅ / 剪辑 #321 ✅ / **画布=本文** / 项目会话 ⬜ / 技能 ⬜）。记法沿用 #202/#321：C-ID / 现象 / 证据 file:line / 影响 / 修法一句。
服务对象：M2 slice-3（把画布族收敛成 `canvas_read` / `canvas_plan` / `canvas_edit` / `canvas_maintenance` + `document_read` / `document_edit`，见 `docs/architecture/agent-m0-tool-mapping.md` 行 9-24）。

## 0. 走查方法与诚实记分

**真走了的（真代码真进程）：**

1. **MCP stdio 真客户端全链**：`pnpm build` 后用 `tests/ux/_mcpJourney.mjs` 的 `spawnMcpStdioClient`（#324 的 verified-client 种子已内置，运输层一次通）起真 Electron headless stdio server（隔离 settings/userData/projects/capability 四目录），以 `clientInfo: Claude Code` + elicitation 能力走：initialize → tools/list → 未知工具探测 → create_project → session_open（拿 leaseHandle）→ read_canvas（空/缺租约/假租约/跨项目/多余参数）→ add_nodes（单节点、16 节点全 kind 矩阵含 model3d 与瞎编 kind）→ connect_nodes（合法/非法 mode/幽灵端点/自环/重复/语义坏边）→ set_node_prompt（合法/幽灵节点/空串/300k 字）→ delete_nodes(带边删/幽灵/16 节点一刀全删) → materialize_storyboard 错误路径 → progressToken 探测。**19 组 43 步全部走通**（其中 6 步按预期红），服务端全程零 crash 零挂死。证据落盘 `/tmp/canvas-chain-evidence.json`（一次性审计脚本 `/tmp/canvas-chain-walk.mjs`，未入库）。
2. **RL2 旧账复核（canvasRead 挂死）**：`pnpm exec vitest run electron/capabilityCore/canvasReadCapturedSnapshotFlow.test.ts` → **绿 2/2**（sealed A 切 Surface 后仍读规范快照并拒 replay）；配合本走查 headless 连读 6 次画布 0 挂——M0 RL2 修复在 main 上实证仍有效。
3. **代码级对账**：canvas 10 + document 6 descriptor 的 pi 契约与 MCP 直投逐文件精读（`electron/shared/agentCapabilities/canvas{Read,ReadCompact,Write,Delete}.ts`、`document{Read,Write}.ts`、`electron/capabilityCore/{mcpToolCatalog,mcpCapabilityProjection,mcpProtocol,mcpToolErrorResults,canvasGraph,nodeKindDomain,dispatcher}.ts`、渲染层 `canvasSnapshotNormalizer.ts` / `nodes/registry.ts`）。

**没走到的（诚实边界）：**
- **A 模式**（Nomi App 开着、写经渲染层网关 + 方案卡）没有活体走查——本走查全程 headless B 模式（直写盘、confirmPlan 自动放行、elicitation 0 次符合设计）。方案卡/会话级信任（`mcpPlanTrust.ts`）行为为代码级审计。
- pi 面画布/文档工具全链（fixture LLM → harness → 审批卡）未活体走查（同 #321 E-16 的边界：Agent host 默认关闸）；pi 侧结论为 schema/契约级。
- `nomi_materialize_storyboard` 只走了前置错误路径（不存在 run），完整「run → 分镜批准 → 落画布」链归 #202 生成链已审。
- 生成未起（`model3d` 等节点只验「建卡+读回」，#333 的派发修复没做生成级复验）。

**做得对的（先说）**：RL2 已修实证；跨项目租约拒绝正确（lease A + projectId B → `project_scope_changed` + 完整 recovery，S16c）；幽灵端点/自环/重复连线全部拒绝且给 reason（S11c/d）；删除清悬挂边（S15c dangling=0）；镜号只发给 shots 分类的 image/video/shot/keyframe（S10）；15 个合法 kind 建卡全通含 model3d/scene3d/panorama；`nomi_read_canvas` 的 text 与 structuredContent 双轨一致（canonical 同源，S7b）；租约错误族的 recovery 是全链最好的错误样板（S16a）；批量建节点自动分层布局不重叠不压旧内容。

## 1. 问题清单 C-01…C-13

| ID | 现象 | 证据 | 影响 | 修法一句 |
|---|---|---|---|---|
| **C-01 (P0 结构)** | **三族三个世界**：剪辑族已语义化（`nomi_timeline_read/edit/export_job/media_query` 挂 `aliases.mcp`），画布族还是 5 个旧 descriptor 直投（add/connect/set_prompt/delete + read），**文档族 MCP 面 0 个工具**——外部 AI 完全读不了也写不了创作区剧本文档；canvas_plan 族（propose_storyboard_plan / arrange_storyboard_to_timeline / create_staging_reference / create_camera_move / tidy_canvas）MCP 面也是 0，排镜只剩绕道 production run 的 `nomi_materialize_storyboard` 一条重路 | 实测 tools/list 46 个（S2）；`documentRead.ts:52` `documentWrite.ts:54` `exposure: internal_only` 且 aliases 仅 pi；`canvasWrite.ts:415` 同；对照 `timelineRead.ts:289` `mcp: "nomi_timeline_read"` | slice-3 的「收敛」在画布族是改造 5 个直投、在文档族是从零投影；AI 想「按剧本改分镜」时剧本侧断链 | slice-3 按 mapping 行 9-24 落 6 个语义工具，旧 5 直投同 PR 删（P1） |
| **C-02 (P0 状态骗人)** | **未知 kind 静默落盘、再静默蒸发**：`kind:"hologram"` 被 add_nodes 接受、持久化、read_canvas 读得到（回执+读回双双"确认存在"）；渲染层载入时 `isGenerationNodeKind` 静默丢弃 → 用户在 UI 里什么都看不见，渲染层随后任何一次落盘把它永久抹掉（load→save 往返蒸发，save 侧为代码级推断）。kind 真相源有三套：pi enum 9 个（`canvasWrite.ts:14-24`，缺 audio/clip/scene3d/whiteboard/model3d/asset）vs MCP 自由字符串 vs 渲染注册表 15 个 | 实测 S9/S10（hologramPersisted:true）；`canvasSnapshotNormalizer.ts:52-56`（unknown kind → 丢）；`nodes/registry.ts:63-281`（15 kinds） | AI 视角最重的一种「状态骗人」：两个只读面对同一画布给出不同事实；瞎编 kind 的批量落卡 = 无声数据损失 | add_nodes 的 kind 从 `nodeKindDomain` derive 成 enum(15)，未知当场拒 |
| **C-03 (P0 权限倒挂)** | **读要租约、写不要**：`nomi_read_canvas` 强制 leaseHandle（scopeSet `["canvas:read"]`、5 分钟过期，S6b 解码实证）；add/connect/set_prompt/delete 只要裸 projectId——无租约、无 scope、无 session 绑定，实测无租约写入成功（S8 writeWithoutLeaseWorked:true）。整套 session/scope/revocation 授权体系恰好把**破坏性操作**放在门外 | 实测 S5（无租约读被拒 `capability_input_invalid`）vs S8（无租约写成功）；`mcpToolCatalog.ts:51-113`（写族 schema 无 leaseHandle）vs `mcpCapabilityProjection.ts:277-291`（读 transport 必带 lease） | 撤销租约/换项目对写操作零效力；AI 心智割裂（读走会话链、写走裸 id）；lease 的 scopeSet 里也根本没有 canvas:write 可发 | slice-3 写族统一走 project_session 授权（canvas:write scope），无租约 → `lease_required` |
| **C-04** | **写族 structuredContent 全缺**：add_nodes / connect / set_prompt / delete / create_project / session_open 六个工具 structuredContent 恒缺席，ids/leaseHandle/changed 全部只在 text 的 prose-JSON 里；`buildToolOutcome` 对整个画布写族无 handler → JSON.stringify 兜底 | 实测 S4/S6/S8/S9/S11/S13/S15 全部 structuredKeys:null；`mcpToolResults.ts:309-647`（无画布 case）；对照 read_canvas 走 `buildCanonicalMcpToolResult` 双轨（S7） | #321 E-04 同族但更全：模型续链（拿 ids 去连线）被迫抠文本；已交过学费（memory：text 是人话不是 JSON） | 语义工具统一 `buildCanonicalMcpToolResult`（canonical 双轨） |
| **C-05** | **删除无确认、无 undo、无破坏性标注**：16 节点一刀全删 0 确认（elicitations 恒 0；协议层只有 add_nodes 有 elicitation 方案门分支，delete 没有——App 开着也不问）；回执无任何恢复线索；tools/list 无 `destructiveHint`。对照 pi 面 `canvas.delete` 是 `approval:"proposal"` + "reversible proposal transaction" | 实测 S15e/S15f（deleted 16、undoHint:false）；`mcpProtocol.ts:495-517`（仅 nomi_add_nodes 分支）；`canvasDelete.ts:57-63`（pi 契约） | 建 2 个节点要方案门、删 24 个不用——威胁模型倒着长；删带结果的节点即不可逆丢引用 | delete 收进 canvas_maintenance 硬门（elicitation/审批 + destructiveHint + 回执带恢复语义） |
| **C-06** | **无预算读 + 无上限写 = token 炸弹**：set_node_prompt 无长度上限（pi 262,144 上限，MCP 路 `String(params.prompt)` 直通），300k 字实收；read_canvas 回吐全量——text 305,104 B + structuredContent 303,182 B **双份 ≈ 600KB**，无任何 truncated 标志。pi 面有 12k 字符预算的 compact 投影（`canvasReadCompact.ts:3`），MCP 面没有 | 实测 S13d/S14b（textBytes 305104、truncationSignal:false）；`dispatcher.ts:493-499`（无上限）；`canvasWrite.ts:6`（pi 上限） | 一次读画布即可爆掉模型上下文；大画布（几十节点长 prompt）常态化后每次读都是反噬 | 写侧对齐 262,144 上限；读侧加 bounded 投影（预算 + truncated:true + per-node prompt 摘要，全文走按需单读） |
| **C-07** | **非法 edge mode 静默降级**：mode `"style"`（打错 style_ref）→ 边照建、skipped=[]、读回 mode=`"reference"`——AI 以为绑了风格参考，实际是泛化引用，生成时语义丢失且无人知道 | 实测 S11b（edgeIds 有值 skipped 空）+ S12b（mode:"reference"）；`canvasGraph.ts:204`（非法 mode 悄悄回落） | 参考语义是画布链的核心价值（谁是 character1/谁定风格）；静默降级把它变成骰子 | 非法 mode 进 skipped（reason: unsupported_mode）或 schema enum 拒绝 |
| **C-08** | **参考可达性零校验**：text→video 的 `first_frame` 边建立成功并落盘（pi 面 schema 明文「text/shot/output 不能当参考源，不支持的边会 skippedEdges 回报」，MCP 面只查存在/自环/重复） | 实测 S11e + S12b（first_frame 边在）；`canvasWrite.ts:84-95`（pi 契约描述）；`canvasGraph.ts:195-226`（MCP 实查项） | 坏边落盘后生成侧静默无效——AI 铺完全链跑生成才发现参考没进去，且没有任何一步告诉过它 | connect 复用 referenceReachability 判据回 skipped（与 pi 面同一份真相源） |
| **C-09** | **幽灵目标静默无操作**：set_node_prompt 打错 nodeId → `{changed:false}` 非 isError、无原因无 recovery；空 prompt `""` 被接受（changed:true，抹除提示词；pi 面 nonBlank 拒绝）；delete 幽灵 id → `{deleted:[]}` 同样静默 | 实测 S13b/S13c/S15d；`canvasGraph.ts:229-244`（未命中原样返回）；`canvasWrite.ts:7-12`（pi nonBlank） | AI 打错 id（画布链最高频笔误）得到的是「没变」而不是「你打错了」，自纠链路断 | 未命中回 isError + `node_not_found` + 近似 id 提示；空串走 pi 同款 nonBlank |
| **C-10** | **非租约类错误恢复动作系统性缺席**：项目不存在 / run 不存在 → `errorCode:null` + `recoveryActions:[]`（不指 nomi_list_projects / nomi_get_run）；schema 校验错 `capability_input_invalid` 连 message 都只是码本身——不说哪个字段错、不列可收字段。对照租约族错误有码有话有动作（S16a 好样板） | 实测 S17/S18a（errorCode null）/S5/S18b（message=码）；`mcpToolErrorResults.ts:40-58`（SAFE_CANVAS_READ_CODES 把 message 整个吞成码）；`mcpToolErrorResults.ts:7-23`（ERROR_HINT 只登记 2 个码） | #202「错误给恢复动作」的教训在画布链一半没落地；AI 撞 input_invalid 只能盲猜字段 | 校验错误带字段级 detail + 指向来源工具的 recovery（错误码登记表补画布族） |
| C-11 | 租约错误码错位：malformed leaseHandle → `project_scope_changed`（「项目范围已变化」）而非 lease_invalid——recovery 恰好通用所以能自愈，但码在撒谎（范围没变，是句柄坏了） | 实测 S16a（message "Project lease handle is malformed" + errorCode project_scope_changed） | 依赖 errorCode 分支的客户端会把「重试同一句柄」当合理选项 | malformed → `lease_invalid` |
| C-12 | add_nodes 工具描述漏报一半能力：15 个 kind 都能建，描述只讲 7 个（video/image/text/audio/shot/character/scene）——keyframe/panorama/scene3d/model3d/whiteboard/asset/clip/output 从工具面不可发现；nodes 数组无 maxItems（pi 24 上限） | `mcpToolCatalog.ts:46-76`；实测 S9（16 个一批全收） | 模型不知道 Nomi 有 3D/全景/白板可建；无上限批量与 C-02 叠加成放大器 | kind 枚举与描述从 nodeKindDomain derive；nodes 加 maxItems |
| C-13 | 建卡无编组：16 节点批量落卡 groups 恒空——「批量产出要自动编组、整批一个 Cmd+Z」是既有产品拍板（memory：batch-output-appears-progressively-and-grouped），MCP 路无编组也无成批撤销 | 实测 S10（groups:[]）；`canvasGraph.ts:146-188`（无 group 逻辑） | 外部 AI 铺一整条片的画布后，用户收到一摊散卡 | canvas_edit 批量落卡按同批建 group（与 UI 同款语义） |

**P0 裁定**：C-01（结构性缺位）/ C-02（静默数据蒸发）/ C-03（权限倒挂）为 P0；**无崩溃级**——服务端 43 步全程零 crash 零挂死（RL2 老病灶复核为绿）。

## 2. slice-3 红灯建议（可复演断言 + 今天预期色）

| # | 红灯 | 锚 | 今天 |
|---|---|---|---|
| R1 | tools/list 含 `canvas_read`/`canvas_plan`/`canvas_edit`/`canvas_maintenance`/`document_read`/`document_edit` 语义工具，且旧 5 直投（nomi_add_nodes 族）同 PR 消失 | C-01 | 红 |
| R2 | 画布写操作缺租约 → `lease_required`（而非成功）；lease scopeSet 含 canvas:write | C-03 | 红 |
| R3 | `kind:"hologram"` 建节点 → isError（枚举拒绝），合法 15 kind 全通 | C-02 | 红 |
| R4 | 画布写族每个成功结果 structuredContent 非空且与 text JSON deep-equal | C-04 | 红 |
| R5 | 批量删除触发确认门（headless 拒绝或 elicitation），工具带 destructiveHint | C-05 | 红 |
| R6 | 300k-prompt 画布 read → 回体 ≤ 预算且带 truncated:true；全文有按需单读路径 | C-06 | 红 |
| R7 | mode:"style" / text→video first_frame → skipped[reason]，读回不出现降级边 | C-07/C-08 | 红 |
| R8 | 幽灵 nodeId 的 set_prompt/delete → isError + node_not_found + recovery ≥1 | C-09/C-10 | 红 |

建网次序：R1/R2 随 slice-3 主体（授权模型是其余一切的地基）；R3/R4/R8 是同一批 schema/投影工作；R5 需要一次「破坏性操作确认面」设计裁决（与 #321 R5 的 undo typed reason 同班）；R6/R7 是读写语义细化。

## 3. 开放问题（未验证，别当结论用）

- **A 模式行为**：App 开着时写走渲染层网关 + 方案卡（`mcpPlanTrust` 会话级信任），本走查全程 headless——方案卡文案、拒绝路径、同项目信任衰减未活体验证。
- 未知 kind 蒸发的 save 侧（「渲染层落盘抹掉」）是 normalizer 行为的推断，未起 GUI 实测 load→save 往返。
- `model3d` 节点的**生成级**派发（#333 修复面）只验了建卡+读回，未跑生成。
- 租约 5 分钟过期后的画布读行为（是否静默续期）与 #321 E-06 同款未实测。
