# 2026-09-10 权限模型重做方案（调研版）

> 需求（用户 2026-09-10 拍板语义）：
> ① **默认权限**：付费工具被调用之前必须用户确认——支持单个确认与批量确认；
> ② **完全自主运行**：独立开关、用户自己打开、开启时有提醒；
> ③ 现有权限模式要**真能对应权限切换**，不是摆设。
> 参考：pi-permission-system（用户给）+ 顶尖产品调研（下）。
> 现状审计见 docs/plan/2026-09-10-ux-feedback-triage.md「权限控制全链路审计」。

## 先查别人

> 报告全文：`docs/research/2026-09-10-permission-model-rework/prior-art.md`（本节是结论摘要）。

**① 依赖里已有？**
- 本仓 embed 的 `@earendil-works/pi-agent-core@0.85.1`（`package.json`）**没有权限扩展点**：`node_modules/@earendil-works/pi-agent-core/dist/agent-loop.d.ts:12-21` 的 loop 入口只接 `AgentContext`/`AgentLoopConfig`/`streamFn`，`node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:122` 起的 `AgentLoopConfig` 接口无 permission/approval 字段；对全部 7 个 `.d.ts` 声明文件 `grep -lni permission` 零命中。用户给的 pi-permission-system 是 pi 生态里更上层的**宿主/CLI 扩展**，不随这个库版本进来——判据层必须在我们自己的宿主边界（`laneHost`/`capabilityApprovalPolicy.ts`）自建，不是漏接了依赖自带的东西。

**② 仓库里已有？**
- 单发付费收据链已是 HMAC+TTL+一次性：`electron/capabilityCore/approvalReceipt.ts:8-9`（`HUMAN_APPROVAL_ALGORITHM = "HMAC-SHA256"`）、`:239-241`（TTL 校验）、`:543`（`consumedAt` 一次性消费判据）。
- 判据 owner 已单点化：`electron/shared/agentCapabilities/capabilityApprovalPolicy.ts:105-108`（`capabilityIsHardGated`，硬地板）与 `:144-154`（`capabilityMayReuseSafeApproval`，档位×effectClass 复用判据——本方案 §4.1 升级的正是这张表）。
- 确认 UI 已单一收口：`src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx:12-18`（注释明写「三种来源共用这一个对话框，不另造并行卡」）+ `src/workbench/generationCanvas/spend/MultiShotContractSummary.tsx:8-14`（批量确认卡内容区）。

**③ 生态里已有？**
- Claude Code 官方安全文档（权限模式 + deny→ask→allow 规则表）：https://docs.claude.com/en/docs/claude-code/security
- Codex CLI 官方文档（sandbox_mode × approval_policy 双独立轴）：https://developers.openai.com/codex/agent-approvals-security
- Cursor CLI 官方文档（Auto-review：allowlist→sandbox→分类器三级流水线）：https://cursor.com/docs/agent/security/run-modes
- Cline 官方文档（Auto Approve 按动作类别逐项授权，YOLO 才全放行）：https://docs.cline.bot/features/auto-approve
- 结论：四家共同结构——规则宿主执行不靠模型自觉、危险/花钱类独立于档位的硬地板、自主/全放行是显式 opt-in。方案 §4.1 矩阵与 Claude Code/Cursor 同构，§4.2 自主开关对齐 Cline YOLO/Claude Code bypass 的「独立 opt-in」共识。

**④ TikHub 自媒体里怎么说？**
- 未检索。同日期目录 `docs/research/2026-09-10-ux-feedback-fixes/tikhub/tikhub-search.md` 是唯一现成检索产物，但关键词是「openai compatible api key 验证 401 models」（服务 B2 apimart 调研），与权限模型主题不相关，抽查其 80 条结果无一条涉及 agent 权限档位/审批流。本方案未另跑权限主题的 TikHub 检索，如实标注未检索。

**结论**：付费确认闸、判据 owner、UI 组件仓库里都已存在单点实现，方案不新增并行版，只在既有 owner 上升级判据矩阵（§4.1）与接入槽单轨化（§4.3）；自主开关（§4.2）是仓库新概念，但结构对齐 Cline YOLO / Claude Code bypass 两家生态先例；pi-agent-core 库本身不提供权限扩展点，判据层必须自建，这是宿主职责边界所在，不是遗漏。

## 一、调研摘要（均为一手官方文档/实核文）

| 产品 | 模型 | 关键细节 |
|---|---|---|
| **Claude Code** | 规则表 + 模式 | 规则 `deny → ask → allow` 顺序评估、首个命中生效；**裸工具名 deny = 从模型上下文整个移除**（模型根本看不见）；模式 default/acceptEdits/plan/auto（分类器审）/dontAsk/bypass；「不再问」记忆分三级：Bash 命令/域名=永久落盘到 settings.local.json、文件编辑=仅本会话；bypass 需隔离环境且可被管理端禁用；「没有哪个模式会自动放行的动作」清单独立于模式存在 |
| **Codex CLI** | 双轴 | sandbox（read-only/workspace-write/danger-full-access）× approval_policy 两个独立轴，互不混装 |
| **Cursor CLI** | 三档 Run Modes | Auto-review（allowlist→sandbox→分类器流水线）/ Allowlist / Run Everything |
| **Cline** | 逐步审批 + always-allow | 默认每个动作都问；按工具名配 always_allow 跳过；治理型标杆 |
| **Antigravity CLI** | 四预设 | request-review / proceed-in-sandbox / always-proceed / strict（我们绕闸的那家自己也是 preset 制） |
| **pi-permission-system**（用户给，v0.8.0） | 三态规则 + YOLO | allow/deny/ask 三态、通配 last-match-wins；**deny 是跨层硬地板，项目层不可放松**；YOLO 独立 opt-in、批准不落盘；ask 卡四选项（一次/本会话/拒/拒并说理由）；被禁工具在 `before_agent_start` 从工具表+系统提示词移除；未知工具先于权限检查阻断 |
| **pi-permission-modes** | 模式即数据 | 模式=JSON 数据（可自定义）；项目层配置**只许收紧不许放松**（most-restrictive overlay）；protected paths（.git/.env/dotfiles）任何模式（除 YOLO）都硬阻断；首次使用询问 Allow once / this session / **forever（落盘）** / deny |
| **pi-auto-permissions** | 正则规则分级 | deny / convention / guarded 三级，多条命中取**最严者胜**；配置解析失败 fail-closed 整个 Bash 面阻断 |
| **21 工具横评**（dev.to 实核 21 家文档） | 行业基线 | 12/20 默认逐动作问；5 家全自动（Codex CLI、OpenCode 等）；「默认问」仍是主流默认 |

## 二、行业共识（我们的设计约束从这里来）

1. **规则由宿主执行，不靠模型自觉**（Claude Code 原话）——提示词约束不改变权限判定。
2. **deny 是硬地板**：跨层、跨模式、任何批准机制都不可放松（pi 系/Claude Code 一致）。
3. **危险/花钱类永不自动**：各家的 bypass/YOLO 都有独立清单「任何模式都不自动放行」的动作。
4. **首次使用询问 + 分级记忆**：一次 / 本会话（内存）/ 永久（落盘到设置），粒度随动作类型定。
5. **自主模式是独立 opt-in**，不是某个档位的隐含行为；开启时明确提醒；项目/不可信上下文只能收紧不能放松。
6. **确认卡要可读**：给摘要（目标+改动量），不给裸 JSON（pi 与 Claude Code 都这么做）。

## 三、现状对照（差距在哪）

**今天六棱柱案例的实证（2026-09-10 真机截图核验）**：Tasks 面板明示 "This draft has made no paid calls. Production starts only after you approve its summary"，花费 CN¥0.00——**付费动作根本没有发生**，确认闸没有被绕过。用户体感「没确认就做完了」的真相是三个呈现层差距：
1. **agent 话术越界**：把「已创建草稿（不花钱）」说成「已经提交生成」——输出铁律有「创建节点≠生成完成」，但缺「建草稿≠已提交付费」这条；
2. **确认卡不在面板**：真要点火付费时，确认走居中弹窗且需在画布点「生成/预览」才触发，聊天流全程安静，用户不知道有一张卡在等他；
3. **默认模型自选无提示**：默认模型为空=「自动选」，agent 自选 Seedream 4.5 且不告知这是它的选择。

已有且保留：会话级 grant 只在内存（对齐 pi）、介入卡四动作骨架、SpendConfirmDialog 单镜+MultiShotContractSummary 批量卡、三档真控权链路。

| 需求 | 现状 | 差距 |
|---|---|---|
| ①付费必确认 | generation.gate 存在，但只覆盖画布内路径 | 外部 CLI 工具（antigravity generate_image）绕闸；付费确认走居中弹窗不进面板介入槽（双轨）；面板内「看起来没问」 |
| ②自主 opt-in | 无此概念；project 档不是自主也不自动花钱 | 缺一个真正的自主开关 + 开启提醒 |
| ③真能切换 | 三档链路真控权 | spend 轴零消费者；三档体感差不多（差异只在可撤销写入类） |

## 四、目标模型（具体设计）

### 4.1 判据层：从「档位×effectClass」升级为「动作 × 档位」矩阵（单一 owner）

工具能力按 **effectClass + 是否花钱** 归四类（数据全部已有，capabilityApprovalPolicy.ts 是唯一 owner）：

| 动作类 | step | safe-auto（默认） | project（自主） |
|---|---|---|---|
| 只读 | 放 | 放 | 放 |
| 可撤销写（草稿/画布节点） | **问** | 放 | 放 |
| **付费（含外部 CLI 付费工具）** | **问** | **问**（单个或批量卡） | **问**（除非自主开关已开） |
| 危险/不可逆（删除项目数据等） | 问 | 问 | 问（**硬地板，自主开关也不放**） |

- 付费类判定 = 现有 hard-gate（effectClass!=='reversible_local'）∪ 工具契约 `spend` 字段。**spend 轴从「零消费者」变成付费判据的输入**——这就是把假轴做真。
- **deny 硬地板**：危险类不随任何档位/自主开关放宽（对齐行业共识 3）。

### 4.2 自主运行开关（需求②）

- UI：权限按钮旁独立「自主运行」开关（或 project 档开启时的二次确认开关），**默认关**。
- 开启时：一次性红色提醒卡（「自主模式下 Nomi 将不再逐步确认，付费仍按预算策略执行」）。
- 开启后：可撤销写不再问；付费动作二选一（用户在开启时选：每次确认 / 按会话预算自动）；危险类照问。
- 语义对齐 pi YOLO：批准不落盘、切换回来后恢复逐项确认。**deny 硬地板不受它影响。**

### 4.3 付费确认卡：接入介入槽 + 可调整（需求①）

- **单轨化**：面板运行中的付费确认一律渲染在 v4 介入槽（不再弹居中窗双轨）；画布内直接点「生成」保留现有弹窗（那是用户主动动作，不是 agent 代发）。
- **可调整**：介入卡上模型/参数可改再放行。落地取**方案 B（allow-with-overrides）**：
  - `LaneApprovalAction` 增加 `allow-with-overrides`，codec/gate 沿既有 `answer` 通道带 overrides；
  - gate settle 后 laneHost 在放行前用 overrides 覆写 `event.args`（pending 里本就带完整 args，`laneApprovalGate.ts:255-263`）；
  - 卡的 UI：模型下拉 + 关键参数（比例/时长/数量）+ 成本行，改完成本行实时重算；
  - 方案 A（返回修改重走 agent）作为编辑体验的补充入口，不做唯一路径。
- **批量确认**：一次回合内多个付费调用合并为一张批量卡（数据已有 MultiShotContractSummary），逐项可改，支持「全部放行」。

### 4.4 外部 CLI 工具收编（堵 antigravity 绕闸）

- 外部 CLI 工具在工具注册处声明 `spend`（它们真实花钱）→ 自动落入 4.1 付费类，被闸覆盖；
- 若某工具宿主无法强制（CLI 自带交互），则对齐 pi「工具面移除」：默认从模型可用清单剔除，用户显式开启才出现（并标注「此工具自管审批」）。

### 4.5 首次使用询问（P2，对齐行业共识 4）

- 新工具/新供应商付费能力首次被 agent 调用时弹卡，选项：一次 / 本会话 / 永久（落盘设置）/ 拒绝。
- 落盘位置复用现有设置体系（capability 合同），不做新存储。

## 四·补 参数错位根因（2026-09-10 实核，接走查反馈 #10 后半）

**根因一句话：agent 的参数写进主进程 ProductionRun 的 `generationPlan.candidate`，画布节点/任务卡读的是画布 store 的 `node.meta`——两条链路各自落库、零同步零互读（全 src 无任何代码读 candidate，grep 零命中），且两边默认模型解析器不同源，必然错位。**

逐跳实核：
- 写入链：`nomi_generation_plan` create/patch → `semanticCandidateFromParams`（缺省模型取「设置默认」，semanticGenerationCandidate.ts:198）→ durable 落 `productionGenerationOperationStore.ts:47-87` 的 `run.generationPlan`；patch 只改 run，**不触碰画布**。
- 节点链：`create_canvas_nodes`/`materialize-storyboard` 另起一链，prompt 用调用参数、modelKey 缺省回落 `resolveStoryboardImageDefault()`（capabilityApplyHandler.ts:608-619，选型规则「GPT Image→Nano Banana→第一个可用」，availableModels.ts:107-113）——与上面是**两个不同解析器**；且 plan 存 catalog `modelId`、节点存 `modelKey`，连命名空间都不通。
- 读取链：节点卡/浮动 composer/Tasks 面板全读 `node.meta`（NodeGenerationComposer.tsx:120、TaskCenterPanel.tsx:55,87-90）。
- 多节点堆积：storyboard 物化每锚一卡 + 每镜一节点是设计；但 `create_canvas_nodes` **无去重**（applyCanvasToolCall.ts:377+ 每次全量新建），重试即堆积。

**修法（并入 P1，与 4.3 单轨化同批）**：
1. **单一真相源**：节点 meta 的 prompt/modelKey 从 `generationPlan.candidate` 投影（写入时回填 + patch 时重绑定），消灭两条链；modelId/modelKey 统一命名空间（转换层一处）。
2. `create_canvas_nodes` 按 plan operationId 幂等（对齐 materialize 路径现成的 `materializationOperationId` 机制）。
3. agent 回复的话术与数据状态绑定：draft 时只能说「草稿已建，参数以确认卡/节点为准」，收据后才可说「已提交」（与 §七 P0 话术铁律合并）。

**修法（并入 P1，与 4.3 单轨化同批）**：
1. **单一真相源**：节点 meta 的 prompt/modelKey 从 `generationPlan.candidate` 投影（写入时回填 + patch 时重绑定），消灭两条链；modelId/modelKey 统一命名空间（转换层一处）。
2. `create_canvas_nodes` 按 plan operationId 幂等（对齐 materialize 路径现成的 `materializationOperationId` 机制）。
3. agent 回复的话术与数据状态绑定：draft 时只能说「草稿已建，参数以确认卡/节点为准」，收据后才可说「已提交」（与 §七 P0 话术铁律合并）。

## 四·补2 全仓同类扫描（2026-09-10，「双账本」类根因横扫）

用户问「其他地方会不会也有类似问题」——按同一套路全仓配对了「agent 写入的 durable 状态 ↔ 渲染层读取源」，结果：

**同类高危（修法全部并入 P1 单一真相源改造）**：
| # | 双账本 | 证据 | 后果 |
|---|---|---|---|
| 1 | `run.generationPlan.candidate` 主候选：**src 零读取**（grep 确认），唯二读者只有锚复用卡 `spend/anchorCheckpointView.ts`（且只读 shots） | `productionGenerationOperationStore.ts:13,29,67` 写；节点卡读 `node.meta`（BaseGenerationNode.tsx:169,528） | 锚复用卡与节点卡同镜两处显示不同 prompt/参考；agent 改稿只改一边 |
| 2 | **默认模型解析器共 4 份**：主进程 `generationDefaultModelResolver.ts:123`（settings 源）↔ 渲染层硬编码正则 `availableModels.ts:107-113` ↔ 节点自愈 effect `useNodeModelAutoSelect.ts:105-134`（注释自认会覆盖 agent 选择）↔ 死代码 `src/config/models.ts:57-58`（gemini-3.1-flash-image-preview，消费 0 命中，静默地雷） | 各写各的默认 | 设置里改默认模型后两边不同步；agent 选的模型被节点自愈覆盖 |
| 3 | 多镜批量确认卡读 Run 投影（`productionContractView.ts:61`），落画布 meta 走解析器 2 号 | `capabilityApplyHandler.ts:196-203` | 确认卡上显示的模型 ≠ 节点实跑模型 |

**中危（P2）**：`document.write` schema 声明 `documentId` 但渲染层 handler 忽略之、写死活动文稿（`capabilityApplyHandler.ts:395-403`），转发链无「id≠active 即拒」守卫——多文档场景会写错本。

**已验证干净（防漏报）**：时间轴（revision 守卫单源，`timelineCapabilityTarget.ts:360`）、资产（agent 面只读+receipt 单点写）、artifact（asset store 单源）、taskCenter（直读 ProductionRunSummary）、storyboard designs（单 store 状态机）。

**防复发门岗（P2）**：新增机器检查「agent 写入的每个 durable 字段必须有渲染层读者（或显式登记为内部中间态）」——挂进 check 套件，防下一个双账本长出来；默认模型解析收敛后删死代码 `config/models.ts`。

## 五、接线点（审计已实核 file:line）
| 改动 | 落点 |
|---|---|
| 判据矩阵 | `electron/shared/agentCapabilities/capabilityApprovalPolicy.ts:144-154`（唯一 owner，升级为矩阵） |
| spend 接入 | 工具契约 schema（agentCapabilities）+ `laneApproval.ts:95-125` 预检 |
| 自主开关 | UI `AgentPanelV4Composer` 权限钮旁；传输复用 `workspace-policy`（laneClient.ts:175）+ 新字段 |
| overrides 回写 | `LaneApprovalAction`（laneCommandCodec.ts:93-115）+ `laneApprovalGate.ts:199-220` settle + `laneHost.mts:346+` before_tool 改写 args |
| 介入槽单轨化 | `useAgentPanelV4Data.ts:194-197` 槽位 + `AgentPanelV4Cards.tsx:173-340` V4Intervention |
| 批量卡 | `spend/MultiShotContractSummary.tsx` 数据复用，渲染迁到介入槽 |
| 外部 CLI 收编 | `catalog/antigravityCatalog.ts:96` + 工具注册处 spend 声明 |
| 可编辑卡 UI | V4Intervention 内嵌编辑态（复用 V4ModelPopover 的 NomiSelect 行组件） |

## 五·补 全量工具面梳理 + MCP 直连生成风险审查（2026-09-10 实核，对照 Claude tool-use 文档）

**A. agent 模型面（干净）**：常驻 eager 9 个（文稿 5 + 画布 4）+ 延迟组（timeline/export/production/generation），全部过 laneHost before_tool 闸；付费能力 generation.gate 不投影 internal（paidBoundary.ts:78-80），模型结构上够不着钱；常驻 9≤12 满足工具增长纪律。operation 分档漏档有指纹门岗+装配期不变量双保险（modelFacingTools.ts:610-635、paidBoundary.ts:134-155）。

**B. MCP 对外面 25 个**（mcpToolCatalog.ts:306-320，stdio+loopback、每客户端签名 proof）。**单发生成收据链完整、无法绕过**（decide 硬阻断无收据 mcpGenerationTools.ts:663-665，收据 HMAC+5min TTL+一次性）。**但 R1（高）**：Run/playbook 批量侧生产装配 `productionRunRuntime.ts:66` 未注入 approvalReceiptAuthority，而 `productionRunApprovalReceipt.ts:34` 在 authority 缺席时**直接放行**——外部客户端 `nomi_run_gate action=decide` 只需一次 boolean elicitation 同意即可批准整批付费 shot；且 `set_trust=budget_only`（productionRunService.ts:298-303）会自动批准等待中的 shot 门，本身无收据要求。**一次同意=整批烧钱。**

修法（并入 P1，需求①「付费必确认」的 MCP 侧补全）：
1. 生产装配注入 approvalReceiptAuthority，付费门一律收据结算（authority 缺席从 fail-open 改 **fail-closed**）；
2. `set_trust` 降档（尤其 budget_only）需主进程手势/收据，不能由客户端工具调用单方完成；
3. elicitation 确认摘要展开逐镜价目（R2，现仅 model+maximumCost 布尔弹窗）；
4. tools/list 对付费工具按相位标注（R3，现 schema_only 相位也全量广播）。

对照 Claude 最佳实践的合规确认：25 个对外工具 schema 三要素齐备（additionalProperties:false + immutable 快照）、未知工具先于权限 -32602 阻断（mcpProtocol.ts:392-394）、价格未知 fail-closed 永不造 ¥0。#646 型 schema 问题已被门岗封住。

## 六、分期与验收


| 期 | 内容 | 验收 |
|---|---|---|
| P1 付费收全 + 卡可调 | 判据矩阵 + spend 接入 + 外部 CLI 收编 + 介入槽单轨 + allow-with-overrides 可编辑卡 + 批量卡 | 真实任务：agent 代发单次生成（弹卡→改模型→放行）、批量生成（一卡逐项改→全放）、antigravity 路径被闸覆盖；contracts 全绿 |
| P2 自主开关 | 独立 opt-in + 提醒 + 付费二选一策略 | 开关关=默认行为不变；开=可撤销写不问、付费按所选策略、危险必问；重启后开关状态如实还原 |
| P3 首次使用询问 | first-use 卡 + 永久落盘 | 新供应商首用弹卡；选永久后写入设置且可查/可撤销 |

**不做**：通配符规则文件（pi 式 jsonc 策略文件）——当前工具面 ~25 个，矩阵足够；等工具面失控再引入（R20）。
**红线**：危险类硬地板任何情况下不放；提示词不参与权限判定（宿主强制）。

## 七、待拍板

0. **新增 P0（今天案例直接暴露）**：话术铁律补一条「创建草稿 ≠ 已提交付费；只有付费闸出收据后才能说『已提交』」——挂进 `agentContext.ts` 输出铁律 + composeAgentSystemPrompt 测试镜像；成本低、立刻消除「没确认就扣费」的错觉源头。

1. 4.3 可编辑卡取方案 B（直接回写 overrides，动三层合同）——推荐，A 作补充。
2. 4.2 自主模式下付费动作的二选一策略（每次确认 / 会话预算自动）默认取哪个——推荐默认「每次确认」。
3. 批量卡的「全部放行」是否需要二次确认——推荐不要（卡上逐项可改已经是确认本身）。

---

## P1.1a（2026-09-11）：审批卡永不空闲超时 + 「确认 → 真的开始生成」端到端夹具

> 用户已拍板的两件确定项，不再讨论：**① 审批卡永不因空闲超时（去掉倒计时）；② 付费与不可逆永远问（全自动也问钱）。**
> 本节是这一轮的范围/不动项/验收。先查别人见本文件开头的「先查别人」一节（行业共识 3「危险/花钱类永不自动」正是这条拍板的同构依据）。

### 范围（做了什么）

**① 删干净倒计时与一切「空闲到点自动决定」**（P1：不留开关、不留 fallback）

| 删掉的东西 | 落点 |
|---|---|
| 确认卡倒计时状态机（每 200ms tick、到点 `resolvePending(false)`） | `src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx` |
| 多镜卡「交互即暂停」（它只为倒计时存在，倒计时没了它也没有意义） | 同上 |
| 两条倒计时进度条 + `data-production-countdown` 锚点 | 同上 |
| 请求契约上的 `countdownMs` 字段 | `src/workbench/generationCanvas/spend/spendConfirm.ts` |
| 四处 `countdownMs` 调用点（外部 MCP 付费门 / 多镜合同门 / 单镜生成门 / 方案门） | `src/workbench/capability/capabilityApplyHandler.ts` |
| 锚检查点卡的「N 分钟无操作将自动开拍」脚注 | `src/workbench/generationCanvas/spend/AnchorCheckpointCard.tsx` |
| 锚检查点的**自动放行超时**（`anchorAutoReleaseMs` 选项 + `auto_release` 状态 + `autoReleaseCheckpoint` 命令） | `electron/productionRun/batchScheduleDerivation.ts`、`multiShotBatchScheduler.ts` |
| 对应 i18n（`spend.autoIgnore`、`production.batch.countdownPaused/countdownAuto`、`production.checkpoint.autoRelease`，zh+en） | `src/i18n/locales/generationCommon.ts` |
| **主进程那半边的同一件事**：等真人按确认卡的四处墙钟兜底（`RENDERER_SPEND_TIMEOUT_MS = 65_000` ×2、`taskSpend` 写死的 `65_000`、生成闸的 `60_000`） | `electron/capabilityCore/gateway.ts`、`electron/tasks/taskSpend.ts`、`electron/capabilityCore/appIntegrationAuthorities.ts` |

> **第四处是删完卡上倒计时之后才露出来的，值得单记一笔。** 主进程原本有一道「比卡的 60s 倒计时略长」的防挂死兜底（65s）。倒计时一删，它就从「兜底」变成了「暗面倒计时」：卡还好端端地在屏幕上等人，请求却已经在用户看不见的地方被替他答成「否」，pending 被删掉；他三分钟后按下「生成 ¥0.50」，那条回复没人认领，界面一动不动。比原来的「自动按了未确认」更难懂——连卡消失这个线索都没有。
>
> 写那道兜底的人没错：一个请求确实不能永远挂着。**错的是活性判据选成了「等了多久」，而正确的判据是「那个要按按钮的界面还在不在」。** 所以修法不是把 65s 改成 65 天，而是把两种等法在 API 上分开：
>
> - `requestRenderer(op, payload, timeoutMs)` —— 等**渲染层自己干活**（读写 store、物化分镜、导出）。等太久就是它卡住了，超时正是对的。
> - `requestRendererDecision(op, payload)` —— 等**人**。不接受时长参数（调用方连表达一个审批期限的位置都没有）；只在窗口销毁 / 渲染进程没了 / 主窗口被换掉时 fail-closed 地 reject。人还在看着卡的时候，等多久都行。
>
> 活性一分没少，时间彻底退出审批。回归测试在 `electron/capabilityCore/rendererBridge.test.ts`，做过变异验证（把 `until-recipient-gone` 换回 10ms 超时 → 三条当场全红）。

**不动项（这些是防重放/幂等的安全语义，不是空闲超时，删了会开安全洞）**：

| 留着的 TTL | 为什么它不是「空闲自动决定」 |
|---|---|
| `electron/capabilityCore/approvalReceipt.ts` 的收据 TTL + 一次性消费 | 收据过期 = 这张凭据不能再用（防重放），**不等于替用户答了「不」**。过期后卡照样等人按。 |
| `electron/spendQuote.ts` / `electron/spendGrant.ts` 的 TTL | 报价与授权令牌的新鲜度，过期只会让下一次提交要求重新报价，不会自己决定门。 |
| `electron/submissionLedger.ts` 的 `expiresAt` | 幂等去重窗口（同一条提交重放多久内算同一次），与审批无关。 |
| `productionContractView` / gate 的 `expiresAt` 显示 | 告诉用户这道门的凭据什么时候失效，是**信息**不是动作。 |
| `electron/capabilityCore/mcpElicitation.ts` 的 300s 请求超时 | 那张卡是**外部 MCP 客户端**（Claude Desktop / Codex）自己画的，我们这边只是一条发给外部进程的 JSON-RPC。MCP 规范为请求设超时，而外部客户端静默断开时这也是唯一能收尾的手段。拍板管的是「Nomi 自己的审批卡永不空闲超时」，不是替别人家的客户端决定它的 UI 该等多久。 |
| `productionRunDriverOps` / `productionRunArtifactOperations` / `productionRunService` 的 5–30 分钟 `requestRenderer` 超时 | 等的是渲染层**自己在干活**（导出、逐镜校验、物化分镜），不是等人按按钮。等太久就是它卡住了。 |

**② 「确认 → 真的开始生成」零额度端到端夹具**

- `electron/capabilityCore/agentPanelSpendConfirm.e2e.test.ts`（新）——本轮的 CI 门。真 loopback HTTP 供应商（零额度），其余全真：durable Run → 草稿落画布 → 面板付费卡投影 → 卡上改参数（`generation.revise`，撤旧授权 + 候选推一版）→ 确认（`requestGenerationGate` 重封印 → 主进程手势 → 铸收据 → `authorizeGeneration` 决门 → 一次性消费 → `start`）→ 提交-轮询-落库 → 产物回到同一个画布节点。逐条断言：**收据信封里冻的 `candidateRevision` = 执行时的候选版本**、**供应商真正收到的 body 就是卡上改后那份**、**三次落地共用 `canvas-landing:{runId}` 一个章 → 始终一个节点**、以及无窗口时 fail-closed 与确认后不重复扣费。
  幂等那条做过变异验证：把 `canvasLandingOperationId` 改成每次带序号，断言当场红。
- `tests/ux/agent-spend-confirm-executes.walk.mjs`（新）——真人路径那一半：一个窗口、界面动作、在卡上点开尺寸下拉选一项、按那颗印着价的按钮。与 `agent-spend-card.walk.mjs` 同样是手动档走查（该族 agent 面板走查全部未进 CI 清单，本轮不改这条既有编排）。

### P1.1a 已知缺口（实测发现，**本轮不修**，各自需要独立裁决）

1. **非 apimart 的供应商，付费卡按下去必然失败。** `electron/capabilityCore/generationProviderBootstrap.ts` 只把 `apimart` 装成可提交的生成供应商，其余 vendor 一律 `providerReady:false` → 付费卡确认返回「供应商缺少必需能力：configured_provider」。这与「用户接官方端点 / 自建中转」的方向直接冲突，但改它是供应商装配层的结构裁决，不属于本轮两件确定项。走查因此只走到「按下去 → 宿主拒绝」，真正跑起来那一段由上面的 vitest 夹具覆盖（文件头写明了为什么，不假绿）。
2. **卡上换模型会被 Run 白名单挡下。** `allowedModels` 是建草稿那一刻从候选身份冻下来的（`productionGenerationOperationStore.create`），而卡上的模型 chip 允许用户换。`agentPanelSpendConfirm.e2e.test.ts` 里有一条【已知缺口】测试把现状钉住——修好之后它会红，届时改成正向断言而不是删掉。

### 顺手修掉的一条（属于本轮卡的行为，非缺口）

`src/workbench/ai/v4/useAgentPanelSpendConfirm.ts` 的 `act` 此前是 `.catch(() => undefined)`：主进程返回的 `{ok:false, message}` 和抛出来的异常一起被吞掉，用户按下「生成 ¥0.50」之后界面一动不动、一个字的解释都没有。**按了没反应是最贵的一种沉默**（用户只会再按一次，或者以为 Nomi 坏了）。现在宿主说不行就当场 toast 出来。**印给用户的是 i18n 那一句**（`agentPanelV4.spendActionFailed`：「这一步没成，Nomi 没有开始生成，也没有花钱。」），宿主原话只进控制台——主进程的 message 混着内部术语和英文（实测那句是 `Provider agent-runtime-loopback lacks required recovery capabilities: configured_provider`），直接印出去等于把状态机糊在中文用户脸上（R15 / R2）。走查第 ④ 条两头都断：必须说人话、且不许出现 `configured_provider`。

### 验收

- `pnpm run gates` 全绿（contracts + unit + build）。
- `npx vitest run electron/capabilityCore/agentPanelSpendConfirm.e2e.test.ts` 4 条全绿，幂等断言过变异验证。
- `node tests/ux/agent-spend-confirm-executes.walk.mjs` 真机绿（截图在 `.tmp/pi-spend-confirm-executes-*`）。
- `npx vitest run electron/capabilityCore/rendererBridge.test.ts` 5 条全绿，新增 3 条过变异验证。
- 全仓 `grep -rn -i -E 'countdown|倒计时|autoApproveAfter|idleTimeout' src electron` 只剩本节这份说明与「没有倒计时」的断言本身。
- 补扫 `grep -rn 'requestRenderer(' electron/ | grep -v test` 逐条判「等的是渲染层还是人」，等人的四处全部走 `requestRendererDecision`。（**同类扫描的词表要按语义展开，不要按命名展开**——第一轮漏掉主进程那三处，正是因为它们叫「timeout」而不叫「countdown」。）
