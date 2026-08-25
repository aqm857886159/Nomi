# Track C 外部体验分期实施计划（2026-08-26）

> 状态：实施合同；本轮只写计划，不写产品实现。
>
> Track C 的目标不是再造一套外部产品，而是让 Claude Code / Codex 用户在一句话后沿用 Nomi 同一控制面、语义工具、Pack、确认和 Run。规模估算后接铁律：**超过上限必须停下复盘，不得靠继续加代码掩盖范围漂移**。

## 0. 现状盘点与目标边界

### MCP 工具面已经有什么

`electron/capabilityCore/mcpToolCatalog.ts:13-14` 以 `MCP_GENERATION_TOOL_CATALOG` 加基础目录；当前可见的 `nomi_*` 已覆盖项目/画布（`nomi_list_projects/create_project/read_canvas/add_nodes/connect_nodes/set_node_prompt/delete_nodes`）、生产 Run（`nomi_start_playbook/get_run/subscribe_run/control_run/decide_gate/get_artifact/read_artifact/request_*_revision/review_artifact/materialize_storyboard`）、单镜语义生成（`nomi_session_open/operation_create/operation_read/preview_execution/submit_generation_plan/request_generation_gate/decide_generation_gate/start_generation/reconcile_generation/cancel_generation/steer_generation`）和兼容的 `nomi_generate`/模型/素材工具。生产草稿与 gate 的真实行为由 `productionRunRepository.ts:219-284`、`mcpToolCatalog.ts:120-165,312-350` 约束。

### Skill/Workflow 包装已有基础

- `electron/capabilityCore/mcpProtocol.ts:656-760` 已把 `skills.list/read` 映射成 `resources/list/read` 与 `prompts/list/get`，且只返元数据后按需读正文；`mcpProtocol.ts:404-411` 的 initialize instructions 已提示先读技能再组装画布。
- `electron/skills/skillStore.ts:58-92` 读取 `skill.json` + `SKILL.md`；`electron/skills/skillManifestSchema.ts:81-109` 的 `stages/tools/requiredProviders/permissions` 可作为渐进披露元数据，但这仍是 Skill，不是 L6 Pack 合同。
- 现有 `nomi_start_playbook` 文案已经说明“只创建可审阅草稿、不批准预算、不调用付费模型”（`mcpToolCatalog.ts:120-165`），但没有“一句话小说→一集”的 Pack 引导、强度档投影和 E2/E3 后续动作。

### elicitation 与三宿主现状

- `mcpProtocol.ts:131-145,236-265,375-407` 在 initialize 捕获 `capabilities.elicitation`，向支持客户端发 `elicitation/create`；`mcpProtocol.ts:563-628` 已锁定付费确认路由：支持 elicitation→客户端内嵌；不支持但 Nomi 开着→应用内确认；两者都无→诚实暂停。
- `electron/capabilityCore/nomiMcpElicitation.test.ts:85-145` 已覆盖四象限和“不因 Nomi 开着就赶人回 App”的语义；这是协议单测，不是真机 Claude Code 证据。
- 系统通知已有 `electron/notificationIpc.ts:1-53`，生产 Run 通知已有 `electron/productionRun/productionNotificationsDesktop.ts:1-43`，只负责交给 OS、点击回 Nomi 深链；仓内尚未查到一个通用“外部确认 + 置顶浮窗”宿主。**置顶浮窗是 Track C 的待建/待拍板面，不得把现有 toast 或 browser asset overlay 当成已存在的确认宿主。**
- 当前工作机 `claude --version` 实测为 `2.1.232`（执行时仍需重新核对，最低探针门槛为 ≥2.1.76）。这只证明 CLI 版本，不证明它对 Nomi MCP 连接实际声明 elicitation。

## 1. 分期总览

| 期次 | 性质 | 目标 | 规模估算 | 独立回滚点 |
|---|---|---|---:|---|
| C-0 | 外部契约/工具盘点 | 锁一句话路径、工具缺口、SKILL 渐进披露和三宿主路由 | 新增约 180–280 行文档/fixture；代码 0 | 删除本期契约/fixture |
| C-1 | MCP Skill/Workflow 包装 | 让 Claude Code/Codex 能从一句话发现 Pack、读取最小引导并推进到 Run 草稿 | 新增约 360–580 行；删除约 80–140 行重复引导 | 停止新 resources/prompts 暴露，旧工具照常 |
| C-2 | 一句话真实闭环 | 打通“文本→Pack→草稿→门→P4/E1/E2”的外部任务卡，保留 Nomi 作为重操作归宿 | 新增约 420–700 行；删除约 100–180 行旧脚本式旁路 | 关闭 workflow wrapper，保留底层 `nomi_*` |
| C-3 | Claude Code elicitation 真机探针 | 证明 ≥2.1.76 CLI 真实声明/响应 `elicitation/create`，记录兼容矩阵 | 新增约 260–430 行探针/证据；删除 0 | 仅禁用 elicitation 优先，回退已存在宿主路由 |
| C-4 | 置顶浮窗兜底与系统通知 | 对不支持 elicitation 且用户不在 Nomi 的情况提供一次确认入口与回 Nomi 深链 | 新增约 420–680 行；删除约 60–120 行重复通知分支 | 关闭浮窗 feature，保留 OS 通知/应用内卡 |
| C-5 | 三宿主验收 | 内部 Nomi、外部 elicitation、外部无 elicitation 的同一语义/预算/Run 证据 | 新增约 300–500 行测试/证据；删除 0 | 关闭 Track C 暴露，历史 Run/receipt 只读 |

## 2. 分期执行卡

### C-0 外部契约与工具缺口期

- **目标**：把“一句话出片”写成不依赖模型记忆的最小序列：`resources/list → 按需 resources/read/prompt → nomi_session_open/nomi_start_playbook → nomi_get_run/subscribe_run → gate/receipt → artifact → E1/E2 下一步`。强度档来自 L6 Pack，不在外部 wrapper 另造 mode。
- **涉及文件**：新增 `docs/plan/` fixture/工具矩阵；只读 `electron/capabilityCore/mcpToolCatalog.ts:13-14,120-165,167-350`、`mcpGenerationTools.ts`、`mcpProtocol.ts:404-411,656-760`、`electron/skills/skillStore.ts:58-92`。用 `rg` 生成实际 `nomi_*` 名单，不能按 marketing 文案猜工具数。
- **验收门**：每条一句话路径都能指向现有工具或明确列“缺口”；区分 read/propose/paid/project_write；明确导出/发布仍回 Nomi；SKILL.md 只给方法，不含权限承诺；工具缺口矩阵让 owner 一眼看到是补 wrapper、补说明还是补真实能力。
- **回滚方式**：删除矩阵/fixture；不改 MCP catalog 或 Skill。

### C-1 MCP Skill/Workflow 包装期

- **目标**：新增一个薄的 Workflow Pack 外部入口/引导，复用 `resources/list/read`、`prompts/list/get` 和现有语义工具；SKILL.md 采用渐进披露：第一层只说一句话入口/强度档/安全边界，第二层按当前 stage 读方法，第三层只在需要时读失败/恢复/成本细节。
- **涉及文件**：建议新增 `skills/workflow.novel-to-episode/SKILL.md`、`skill.json`（或仓库约定的内置 Skill 根）；必要的包装适配放 `electron/capabilityCore/workflowPackMcpAdapter.ts`，接入 `mcpProtocol.ts:656-760` 和 `mcpToolCatalog.ts`。不得把 Pack 合同复制成 MCP 私有 schema；MCP 只投影。
- **验收门**：Claude Code/Codex 从 `resources/list` 能发现 Pack 但不会收到全文；首轮只读最小 SKILL，明确三档门与“付费/项目写必须真人确认”；调用 wrapper 后返回 `runId/strengthTier/currentStage/nextAction/frozenFields`；不支持 resources/prompts 的宿主仍能依赖 tools/list 的短 description 完成同一序列；没有新权限、新账本、新画布。
- **回滚方式**：撤掉 Pack resource/prompt 和 wrapper 注册；现有 `nomi_*` catalog、skill 资源和 Run 不动。禁止保留一个“旧 wrapper + 新 wrapper”双路径。

### C-2 一句话真实闭环期

- **目标**：用真实外部任务验证“帮我把这段小说做成一集”能自动选择默认强度档并推进到**可审阅草稿**，在每个付费/项目写 gate 停下；用户可从外部结果深链回 Nomi 继续 E1/E2，不在外部做第二套剪辑器。
- **涉及文件**：新增 `tests/ux/mcp-workflow-pack.e2e.mjs`、`electron/capabilityCore/workflowPackMcpAdapter.test.ts`、`docs/audit/` 证据；只调用现有 `nomi_start_playbook`（`mcpToolCatalog.ts:120-165`）、Run/artifact/revision 工具和已交付 E1 bridge。若需要 E2 计划卡，只引用 `docs/plan/2026-08-26-p5-e2-structured-rough-cut.md:102-108,156-174`，不在 Track C 新做。
- **验收门**：J1 文本→草稿，J2 草稿→方向/剧本/分镜候选，J3 付费前停住并展示预估/冻结项，J4 断开外部客户端后 Run 仍能在 Nomi 恢复；每一步的 next action 是可执行工具/深链，不让模型背格式；外部 wrapper 返回的状态与 Nomi `ProductionRun` projection 相同。无真实额度时使用 loopback/stub，真实付费另走确认。
- **回滚方式**：关闭 wrapper feature；底层 tools 仍可用，已建 Run 不删除、不重放、不重扣费。

### C-3 Claude Code elicitation 真机探针期

- **目标**：不是再测 Vitest，而是用真实 Claude Code CLI 证明：Nomi MCP server 收到 initialize 的 `capabilities.elicitation`，服务端发出的 `elicitation/create` 在 CLI 中确实出现表单，accept/decline/timeout 的响应按同一 challenge 路由，且 App 开着时不双问。
- **探针步骤**：
  1. `claude --version`，若 `<2.1.76` 立即记为版本阻塞，不降级宣称通过；记录 OS、CLI、Nomi commit、MCP server 启动命令和 `NOMI_RPC_TIMEOUT_MS`。
  2. 用临时项目/临时 keyStatus=ok 的零额度 stub 配置 MCP，启动 `NOMI_MCP_STDIO=1`；在 Claude Code 会话里发送“只创建制作草稿，不要花钱”，抓取 initialize/tools/list 与 stderr（stdout 只能 JSON-RPC）。
  3. 触发一个需要 paid gate 的 `nomi_request_generation_gate` 或 `nomi_generate` stub；记录 Nomi 是否发 `elicitation/create`、CLI 是否显示 `requestedSchema` 的 confirm 字段、用户 decline 后是否无 provider/Run side effect。
  4. 重新跑 accept；检查服务端收到 `action:'accept' + content.confirm:true`，只给本次 invoke `spendConfirmed/planConfirmed`，不写全局 env，不弹第二张 Nomi 卡；重复请求、timeout、Ctrl-C/`notifications/cancelled` 分别记录。
  5. 让 Nomi GUI 开着再跑一次；判据仍是客户端支持就地弹表单。最后保存 `initialize` 帧、elicitation 帧、tool result、Run/receipt diff 和人眼截图。
- **验收门**：必须有真实 CLI stdout/stderr、截图/屏幕录制或等价可读证据；不能只引用 `nomiMcpElicitation.test.ts:85-145`。判定矩阵至少包含 support×App open/closed×accept/decline/timeout；确认没有重复扣费/双问；任何“CLI 未声明 elicitation”都记录为事实，不强行改 server 判据。
- **回滚方式**：探针只用临时项目、stub、可删除日志；不改生产协议。若 CLI 不支持/行为不稳定，标记未通过并走 C-4/C-5 fallback，不提高超时或放宽 receipt。

### C-4 置顶浮窗 + 系统通知兜底期

- **目标**：落实三宿主最后一格：外部客户端不支持 elicitation **且用户不在 Nomi** 时，置顶浮窗承载同一确认表单，系统通知只负责召唤/深链；浮窗不是第四套语义，不持有预算或 receipt。
- **涉及文件**：先复核 `electron/notificationIpc.ts:1-53`、`electron/productionRun/productionNotificationsDesktop.ts:1-43` 的通知/深链；新增建议落点 `electron/confirmationSurface/`（challenge broker、topmost window adapter）与 `src/confirmation/`（同一表单投影）。仓内当前没有通用 confirmation floating host，不能把 browser overlay 当现成实现；若 owner 不接受新窗口，必须在本期停下拍板。
- **验收门**：无 elicitation+App 关时，paid 请求不直接执行；系统通知不展示绝对路径/密钥，点击可拉起 Nomi 或浮窗；浮窗能显示 plan/price/freeze/accept/decline/timeout，accept 只消费一次 challenge 并回原 request；关闭/断线/过期均 fail-closed；App 开着或客户端支持 elicitation 时不出现第二个浮窗。
- **回滚方式**：关闭 topmost host adapter，回到已有 App 内确认或诚实暂停；系统通知 listener 可独立关闭；不回滚已签发/已消费 receipt。

### C-5 三宿主体验验收期

- **目标**：证明内部 Nomi、支持 elicitation 的 Claude Code、无 elicitation 且用户离开 Nomi 三条路是一份语义两个投影：相同 Pack/Run/challenge/frozenFields/cost，差异只在 UI surface。
- **涉及文件**：新增/维护 `tests/ux/mcp-workflow-pack.e2e.mjs`、`tests/ux/mcp-elicitation-real-probe.mjs`、`tests/ux/mcp-floating-confirmation.walk.mjs`、`docs/audit/` 证据；只读/复用 `electron/capabilityCore/nomiMcpElicitation.test.ts:85-145`、`mcpProtocol.ts:563-628`。
- **验收门**：每宿主至少跑“一句话→草稿→付费前停住→一次确认→Run/receipt/artifact→回 Nomi”；支持 elicitation 和浮窗各跑 decline/accept/timeout；断开客户端后 Run 不依赖客户端存活；`check:walkthroughs` 只静态扫描，必须亲跑并记录退出码、截图 mtime 和人眼判断；gates 绿不能冒充真机探针。
- **回滚方式**：关闭 Track C 暴露；保留历史 Run/receipt/artifact 只读，底层 Nomi 工具不删除。

## 3. 不动项清单（具体保护路径）

- `electron/productionRun/productionRunRepository.ts`、`productionRunIntentLog.ts`、`productionRunService.ts`、`multiShotBatchScheduler.ts`：Run 账本、预算/收据/幂等、WAL/fencing、恢复与调度，外部包装只能通过 service/dispatcher。
- `electron/capabilityCore/{generationDispatcher,dispatcher,security,approvalReceipt,mcpGateConfirmation,mcpRequestRegistry}.ts`：能力核权限、来源绑定、receipt、challenge 单次消费、取消/断线语义永不被 SKILL.md 或 wrapper 绕过。
- `src/workbench/generationCanvas/agent/{proposalTxn,applyCanvasToolCall,proposalUndo}.ts`、`electron/productionRun/anchorCheckpoint.ts`：Proposal/撤销/锚一致性是唯一写轴/检查点语义。
- `electron/events/` 两条日志不物理合并；Thread/Turn/Item 使用 Nomi 自有 union；`package.json` 保持 `ai@4`；不新增第二画布或外部独立编辑器。
- 所有自动化保留“回 Nomi/单镜手动/取消”逃生口；外部一句话是快路，不是把用户锁在 MCP 内。

## 4. 验收与回滚纪律

每期开始记录分支、`origin/main`、工具清单快照、CLI 版本、MCP 帧和 diff stat。门岗固定：

```bash
pnpm run gates > /tmp/gates-track-c.log 2>&1; echo exit=$?
```

禁止 `| tail`，禁止用管道状态代替 test/build/gates 真实退出码。真机探针与走查另跑、另记退出码；`check:walkthroughs` 只检查静态声明，从不执行走查。任何真实付费必须在 owner 已确认的费用边界内进行，默认 probe 使用零额度 stub。

## 5. 风险、未知与待 owner 拍板

1. **C-DEC-1（最大未知）**：Claude Code ≥2.1.76 是否在本机实际声明 elicitation、表单是否稳定回传 `requestedSchema`/`content.confirm`，目前只有协议单测和版本命令，没有真机证据；C-3 必须先探，不得把“支持版本”写成“已验证”。
2. 仓内没有已确认的通用置顶确认浮窗；是新建独立 BrowserWindow，还是把确认挂进现有 Nomi 窗口/overlay，影响安全焦点、窗口生命周期和桌面体验，**待 owner 拍板且需样张**。本计划只锁三宿主语义，不选视觉/窗口方案。
3. 当前 `nomi_*` 工具面足以驱动草稿/Run/产物，但“一句话”缺 Pack-specific wrapper、强度档/冻结字段与 E2 下一步引导；要补多少工具 vs 只补 Skill/Prompt 是范围岔路，**待 owner 拍板**，默认先薄包装、不增加底层工具。
4. `resources/list/read` 与 `prompts/list/get` 已有渐进披露，但不同外部宿主对 resources/prompts 的呈现不一致；是否为 Claude/Codex 各写一份宿主专属 SKILL 违反通用第一，默认一份语义两个投影，具体文案需样张/真机验证。
5. 系统通知 `Notification.isSupported()` 的异步失败只能落 `notification:failed`（`notificationIpc.ts:35-52`），不能当作用户已看到；浮窗/通知双失败时的最后一步是要求打开 Nomi，**待 owner 拍板**是否允许只返回暂停而不继续轮询。
6. 外部宿主是否支持 MCP Apps widget 与 elicitation 是两条独立能力；不能把 `ui://` widget 渲染成功当作表单能力，必须分矩阵验收。

## 6. 阶段完成判定

Track C 只有在一句话路径、三宿主确认、真实 Claude Code elicitation 探针、浮窗/通知 fallback、Run/receipt 对账和可独立回滚均有证据时才算完成。gates 绿仅证明静态/自动化门通过；没有真机帧、截图、人眼判断与真实退出码，只能称“已实现计划”，不能称外部体验已解决。
