# MCP 全面侦察：工具面现状 · 贡献者 PR 盘点 · 链路问题对账 · 优化方案草案

日期：2026-09-02
复核基线：`origin/main@13a78c02`（Merge PR #301 m1/final-assembly-20260901）
性质：只侦察 + 起草，不改产品代码。三个侦察面各一节，末节为优化方案草案与实施量评估。
参照系：Claude Code 自身的 MCP 消费设计（一手信息）——deferred tools 只暴露名字不载 schema，模型用 ToolSearch 按需检索加载（`select:` 精确取 / 关键词搜整族），载入后才可调用；tool result 里 `structuredContent` 与 `text` 分离。

---

## 1. 侦察面 1：我们的 MCP 工具面 vs 延迟加载理想

### 1.1 现状盘点（全部实测，非猜测）

**工具数量与首包成本**（用 tsx 实际 evaluate `MCP_TOOL_RESOLVER.list()` 测得）：

| 指标 | 实测值 |
|---|---|
| 暴露工具总数 | **42 个**（一次 `tools/list` 全量返回） |
| tools/list JSON 载荷 | **22,941 bytes / 18,209 chars（含 2,355 个 CJK）** |
| 首包 token 估算 | **≈6,300 tokens**（CJK≈1 token/字 + ASCII/4） |
| 最重的单工具 | `nomi_operation_create` 1,226B、`nomi_start_playbook` 1,103B、`nomi_add_nodes` 954B |

42 个工具的构成（`electron/capabilityCore/mcpToolCatalog.ts:13-16` 五路拼装）：

| 族 | 数量 | 来源文件 |
|---|---|---|
| 项目会话 | 1（`nomi_session_open`） | `mcpProjectSessionTool.ts` |
| 语义生成 lifecycle | 10（context/create/submit/preview/gate×2/start/read/cancel/reconcile） | `mcpGenerationTools.ts:59-215` |
| ComfyUI 集成 | 10（`nomi_integration_*`） | `mcpIntegrationTools.ts` |
| 能力投影 | 1（`nomi_read_canvas`） | `mcpCapabilityProjection.ts:122`（adapter contract `aliases.mcp`，当前仅 canvasRead 挂了） |
| 显式目录 | 20（项目/模型/画布 CRUD/playbook/Run/artifact/门/收敛/导素材） | `mcpToolCatalog.ts:17-386` |

**协议边界现状**（2026-08-25 地基审计指出的缺口 → 当前 main 逐项复核）：

| 08-25 审计缺口 | 当前状态 | 证据 |
|---|---|---|
| 取消不绑定在飞操作 | ✅ 已修（#174）：request registry + `notifications/cancelled` + 断连中止全部在飞 | `mcpProtocol.ts:122,334-340,753-755`；`mcpStdioServer.ts:456-465` |
| 无版本协商交集 | ✅ 已修：4 版本降序交集，不支持回 -32602 | `mcpProtocol.ts:72-75,353-371` |
| schema 不是运行时校验边界 | ✅ 已修：`validateToolArguments` 为唯一边界，失败回 isError | `mcpProtocol.ts:417-427`；`mcpArgValidation.ts` |
| stdio 无行长上限 | ✅ 已修：4 MiB 上限整条丢弃 + 非 JSON 回 -32700 | `mcpStdioServer.ts:431-450` |
| 付费确认并发绑定 | ✅ 已修：challenge 单确认面 + 并发去重 | `mcpGateConfirmation.ts`（#174） |

即 08-25 审计的 MCP 协议层五缺口**已全部关闭**；「手写协议 vs SDK」的历史决定（`mcpProtocol.ts:1-6`）现阶段风险已大幅下降。

**已经做对的（对齐参照系）**：
- `structuredContent` / `text` 分离已落地：`nomiOutcome`（模型稳定字段）+ 文本兜底，`nomi_get_run` 族再挂 `structuredContent.nomiRunData` + MCP Apps widget（`mcpProtocol.ts:147-172`）。
- 只读工具标注 `readOnlyHint`（`mcpProtocol.ts:87-96`）——宿主据此免确认。
- 技能库走 resources/prompts 渐进披露：list 只元数据、read 才载正文（`mcpProtocol.ts:558-720`）。
- 全族统一 `nomi_` 前缀——在 Claude Code 这类 deferred-tools 客户端里，一次关键词检索「nomi」即可整族载入（参照系明确：整族载入优于逐个 select）。

### 1.2 对照延迟加载理想的差距清单

MCP 规范（2025-11-25 现役版，Context7 实查 `modelcontextprotocol.io/specification/2025-11-25/server/tools`）没有「服务端延迟给 schema」原语——延迟加载是**客户端行为**（Claude Code 的 ToolSearch）。服务端能做的是把「可延迟性」做足：

| # | 差距 | 现状证据 | 规范依据 |
|---|---|---|---|
| G1 | **未声明 `tools.listChanged`，也从不发 `notifications/tools/list_changed`** | `mcpProtocol.ts:374` capabilities 是 `{ tools: {}, resources: {}, prompts: {} }` 空对象；全仓无 list_changed 发射点 | spec：server 应声明 `tools:{listChanged:true}` 并在目录变化时通知。我们的目录**确实会变**（`nomi_start_playbook` 的 playbook enum 从注册表 derive、能力投影随 adapter 注册），长连接宿主看到的是过期目录 |
| G2 | **`tools/list` 不支持 `cursor` 分页** | `mcpProtocol.ts:383-407` 忽略 params 一次性全回 | spec：`PaginatedRequestParams.cursor` + `nextCursor`。42 个工具尚可接受，但 ComfyUI 集成族还会涨 |
| G3 | **无 `title` 字段**（2025-11-25 工具可带 title/icons） | 目录只有 name/description/inputSchema | 对 deferred 客户端，name+title 是检索命中的第一素材；`description` 当 title 用太重 |
| G4 | **description 写成小型说明书**：单工具最重 1.2KB，42 个合计 ~23KB。对不做延迟加载的宿主（今天多数）这是每会话固定开销 | 实测 TOP10 见上；`nomi_list_models`、`nomi_decide_gate`、`nomi_control_run` 的行为规则全内嵌在 description | 参照系做法：schema 延迟载入的前提是「名字自解释、描述可分层」——首层一句话，细则挪到 tool result 引导 / prompts |
| G5 | **长任务未用 2025-11-25 的 `execution.taskSupport`** | 仅 2 个工具挂 progressToken 心跳（`mcpProtocol.ts:435-441`） | spec 新增 task 语义，长生成天然适配（可作为 J07 后续演进，非急） |
| G6 | 42 工具里 ComfyUI 集成占 10 个，对多数会话是死重 | `mcpIntegrationTools.ts` | 配合 G1：按「项目会话上下文」动态收窄目录 + listChanged，比一次全摊开更贴延迟加载精神 |

一句话：**协议地基（取消/校验/协商/边界）已经及格，差的是「目录的动态性与轻量化」**——listChanged、分页、title、描述分层、按需收窄。

---

## 2. 侦察面 2：PR 里贡献者提供的 MCP

搜索方法：`gh pr list --state all --search`（mcp / MCP / 链路 / chain / tool call / error / 问题），全量含 closed/merged，共 400 条 PR 里筛出 MCP 相关。外部贡献者的 MCP 供给其实只有 2 个 PR；另有 3 个我们自己的 rescue 档开放 PR 顺带盘点。

### 2.1 逐 PR 裁决表

| PR | 作者 | 状态 | 内容 | 裁决建议 | 理由 |
|---|---|---|---|---|---|
| **#298** feat(mcp): generalize MCP client identity | @wanvfx（外部） | OPEN（2026-09-01 10:38 开） | 把硬编码 `'claude'\|'codex'\|'cursor'` 客户端身份改成可注册 profile（`mcp-client-profiles.json`），任意 MCP-stdio 工具（WorkBuddy/Doubao/Cline）可作为一等客户端接入；HMAC/127.0.0.1/默认不信任保持不变；`nomi_start_playbook` 的 actorId 改为优先取签名验证过的身份而非自报 `clientHost` | **改造后收** | 方向完全贴 P4（通用第一）+ P1（内置三家变 registry 种子、union 类型删除）；还顺手修了一个真实弱点——当前 main `mcpProtocol.ts:344-352` 的 clientHost 仍靠 `clientInfo.name` 自报。质量信号好：带 docs/plan、走查脚本、测试。但必须返工三点：① 与同日合入的 M1（#301，0b6441c6 重写 dispatcher/mcpProtocol/mcpStdioServer）必然冲突，需 rebase 到 post-M1 main（gh mergeable 已查不出=UNKNOWN）；② 新增 3 条 **sync IPC** 通道，逆着 08-25 审计「读路径异步化」方向，应改 async 并进 ipcSenderGuard 基线（PR 自己也标了这点）；③ 长尾客户端档案的产品位（设置里第 N 张卡）需过设计系统 §1.5 控件预算，或按作者提供的备选「curated 三家 + copy-config」收窄 |
| **#51** 接入 Codex 本地生图/改图 | @qq471231311（外部） | CLOSED（已收） | codex-local 生图供应商：本机 `codex exec` 调 `$imagegen`，异步 job 落盘、接入状态跟随 Codex MCP 配置 | **已收，无需动作**（榜样案例） | 未走 PR merge 而是 cherry-pick 保署名合入 `785c21e0` + 跟修 `722b12a3`（GUI Electron PATH 极简导致 spawn ENOENT，照 dreaminaCli 家法修）。设计贴 main 家法：process transport 复用、种子照 comfyui-local、异步 job 走既有可找回链路 |
| #29 vendor management（Stepfun/自定义/即梦） | @wanvfx | CLOSED | 供应商管理 | **谢绝维持原判**（非 MCP） | body 无一处 MCP 内容（grep 验证）；仅因 "tool call" 关键词误中。供应商管理已由后续自研版覆盖 |
| #255 recover production MCP budget UX | 自己（rescue） | OPEN | 死工作台打捞：MCP 预算 UX | **返工后收**（B 档既定裁决） | 2026-09-01 作战图已判：B 档 11 个须返工、别原样合——基于的 main 已漂移一个 M1 |
| #252 recover production pipeline hardening | 自己（rescue） | OPEN | 制作管线加固打捞 | 同上 B 档 | 同上 |
| #223 project agent host phase 1 | 自己 | OPEN | Agent Host 底座（含 MCP 面） | **按既定开闸三条件走**，不在本侦察改判 | 样张拍板 + 12 条交互不一致修完 + EN-DOM 网过（见 agent-host-flag-gate-conditions） |

结论：**外部 MCP 供给 = 2 收 0 谢绝**（#51 已收、#298 改造后收、#29 不算 MCP）。#298 是当前唯一等裁决的活 PR，建议本周内给作者回复（他明说了「say the word and I'll drop」，晾着最伤贡献者）。

### 2.2 我们自己的 MCP 演进主线（供上下文，不裁决）

出生 #10（能力核外露）→ #89/#97（体验大修）→ #103（付费确认）→ #114（对话生成 W1-W3）→ #155-#167（P4 多镜语义化）→ #174（生命周期/边界加固）→ #181（pi SDK）→ #202（事故审计，见第 3 节）→ #301/M1（Host 移植 + 删 `nomi_generate`）。

---

## 3. 侦察面 3：「MCP 工具在问题链路中有问题」的那个 PR = #202

**找到了**：PR [#202](https://github.com/aqm857886159/Nomi/pull/202) `docs: audit the MCP generation journey`（MERGED 2026-08-31），产出 `docs/audit/2026-08-27-mcp-generation-journey-incident-review.md`——用 v0.21.0 真实四镜宣传片制作旅程（外部 AI 经 MCP 驱动 Nomi 全链）钉下 **13 个链路问题**（MCP-J01…J13），每项带落盘证据与当时 main（`8f9365ae`）状态。

### 3.1 13 项在当前 main（13a78c02）的逐项对账

| ID | 问题 | 当时判 | **现判（本次实核）** | 证据 file:line |
|---|---|---|---|---|
| J01 | 有语义 operation 却走 legacy `nomi_add_nodes + nomi_generate` | 现行确认 | **半修**：`nomi_generate` 已从目录删除（0b6441c6，#301，09-01）——付费 legacy MCP 生成路**不存在了**；但 widget 资源仍只挂 4 个 run 工具、10 个语义生成工具一个不挂，语义路在宿主里的可视反馈弱势依旧 | 目录已无 generate（实测 42 工具名单）；`mcpProtocol.ts:50-55` TOOL_UI_RESOURCE 仅 playbook/get_run/subscribe_run/get_artifact |
| J02 | 批量落节点取消只回 `{ids:[],cancelled:true}` 无原因 | 现行确认 | **仍开**：decline/超时/应用内拒绝三种成因仍收敛成同一形状 | `mcpProtocol.ts:500-502`；`core.ts:299` |
| J03 | 客户端不能确认时被迫跨应用找卡 | 依宿主能力 | **仍开**（结构性）：第三确认表面仍不存在，#223 未合 | `mcpProtocol.ts:204-234` elicitation→Nomi 卡→拒绝 三级不变 |
| J04 | 付费确认只显示参考「数量」不显示是哪几张 | 现行确认 | **仍开** | `mcpGateConfirmation.ts:19,88`（referenceCount） |
| J05 | 切模型静默清旧参数套新默认，无变更说明 | 现行确认 | **仍开** | `src/workbench/generationCanvas/nodes/buildNodeModelChangePatch.ts:49-56` |
| J06 | 视频 ETA 固定 40 秒/条 vs 真实 8-17 分钟 | 现行确认 | **仍开** | `src/workbench/generationCanvas/spend/spendConfirm.ts:195`（`perItemSec = video? 40`） |
| J07 | legacy 生成把提交/轮询/结果挤进一次 MCP 调用 | 现行确认 | ✅ **已修（根除）**：`nomi_generate` 删除后，MCP 侧长任务只剩语义路 start→`nomi_operation_read`/`nomi_subscribe_run` 异步生命周期 | 0b6441c6 diff（`-name: 'nomi_generate'`）；`mcpGenerationTools.ts:179-215` |
| J08 | MCP 视频结果无可审片 poster/播放器 | 现行确认 | **仍开**：无 thumbnailUrl 就明确不出图不抽帧 | `mcpPreviewImage.ts:52-68` |
| J09 | 全屏预览短暂「无法播放」 | 运行观察 | **仍开**（证据缺口未补：无 readyState/协议响应留痕） | 无新增 instrumentation |
| J10 | 章节标题非语义化叙事节拍 | 产品表达缺口 | **仍开**：timeline 无 chapter 语义（grep 零命中） | `src/workbench/timeline/` |
| J11 | 持久化导出 manifest 与真实 ffmpeg 事实相反（说静音零轨道） | 现行确认（P0） | ✅ **已修**（08-29，`8784ec77` preserve canonical job audit truth + `31801f91`）：createJob 改存 `createExportAuditManifest`（backend+effectiveProfile+digest 关联） | `electron/export/exportJobs.ts:316-323`；`exportJobManager.ts:130-160` |
| J12 | 导出成功只有瞬时 toast，无项目内持久结果身份 | 现行确认 | **仍开**：无导出历史 UI（grep 零命中） | `src/workbench/` |
| J13 | 项目/作业不记录 build/commit，事故无法绑定二进制 | 证据缺口 | **仍开**：全仓无 buildSha 落盘；export-execution.json 也只有 schemaVersion/owner/digest | `electron/export/exportJobs.ts:259-267` |

### 3.2 记分

**13 项：2 项已修（J07、J11——恰好是两个 P0/最重项）+ 1 项半修（J01）+ 10 项仍开**（J02-J06、J08-J10、J12、J13；其中 J03 等 #223、J09 是补 instrumentation、J10/J12 是产品缺口）。#202 的问题记录质量很高（版本边界诚实、已修项明确排除、逐项落盘证据），**它本身就是本次优化方案的验收对象清单**——不需要另立一份。

---

## 4. 优化方案草案

三条线：目录轻量化（面 1 差距）、链路补洞（面 3 余账）、测试系统（用户点名最重要）。全部对齐 2025-11-25 规范（Context7 实查，非记忆）。

### 4.1 A 线：目录的动态性与轻量化（对齐延迟加载）

1. **声明 `tools: { listChanged: true }` 并真发通知**（修 G1）：`mcpProtocol.ts:374` 一行 + 在 playbook 注册表/能力投影变化处发 `notifications/tools/list_changed`。这是纯增量、规范原文背书，先做。
2. **`tools/list` 支持 `cursor`**（修 G2）：42 个暂可单页返回（规范允许无 nextCursor），但把 PaginatedRequestParams 解析进协议层，为 ComfyUI 集成族增长留门。低优先。
3. **描述分层**（修 G3/G4，收益最大）：每工具补 `title`（一句话）；description 瘦身目标 **首包从 ~23KB/6.3k tokens 降到 ≤10KB/3k tokens**。行为细则三个去处：① 挪进 `structuredContent.nomiOutcome` 的引导字段（错误时才给恢复动作，现有 A6 契约已这么做）；② 挪进 prompts（技能库已有渐进披露管道）；③ 挪进 initialize `instructions`（一次性）。红线：**不许**为省 token 删掉安全语义（如「传其它值会被拒绝」的 enum 说明）。
4. **按会话收窄目录**（修 G6，配 1）：ComfyUI 未配置的会话不广告 10 个 `nomi_integration_*`，配置事件触发 list_changed。这是「服务端能做的延迟加载」的正解——比等所有宿主都实现 ToolSearch 更实际。
5. 不做的：不引 `@modelcontextprotocol/sdk` 重写（08-25 审计判的 compatibility spike 前置条件已被 #174 补齐，但换 SDK 收益现在证不出——五缺口已关，等测试系统（4.3）建成后有回归网再议）；不做 `execution.taskSupport`（G5，等宿主生态跟上）。

### 4.2 B 线：链路余账修法（按 J-ID 锚定）

| J-ID | 修法一句话 | 改哪 |
|---|---|---|
| J02 | 取消结果带 typed reason：`{ids:[],cancelled:true,reason:'declined'\|'timeout'\|'app_dismissed'\|'client_cannot_confirm'\|'mcp_cancelled'}` + 文本给下一步 | `mcpProtocol.ts:500-502`、`core.ts:299`、`mcpPlanTrust.ts` 漏斗 |
| J04 | 付费确认卡投影实际参考媒体（缩略图+角色标签）；#183 的媒体槽身份已存在，只是没投到确认卡 | `mcpGateConfirmation.ts` challenge projection + `capabilityApplyHandler.ts` 卡渲染 |
| J05 | 切模型出「参数变更说明」diff（保留/删除/改默认三列），确认卡失效要显式 | `buildNodeModelChangePatch.ts:47-70` 返回 changeset 而非静默 patch |
| J06 | ETA 按 vendor×model×kind 历史 P50/P90 落盘统计，冷启动给区间不给点值 | `spendConfirm.ts:195` + `.nomi/events` 已有 requested/completed 时间戳可直接算 |
| J08 | 视频产物物化时抽首帧当 poster（ffmpeg 已在手），`mcpPreviewImage` 才有图可用；widget `<img>`→`<video poster>` | `generationOutputMaterializer.ts` + `mcpPreviewImage.ts:52-68` + `mcpAppWidget.ts` |
| J09 | 播放失败留痕：video element readyState/networkState + nomi-local 响应码进 events | preview 层 |
| J12 | 导出结果登记为项目内 Artifact（jobId/版本/入链已在 `.nomi/jobs`，缺的是 UI 面） | export 面板 + J11 已修的 audit manifest 直接可展示 |
| J13 | 项目事件与 export job 落 `appVersion+buildSha+packaged` 三元组；一处写（app 启动读 build info），处处带 | events sidecar + `exportJobs.ts:259` execution json |

J03/J10 是产品级（第三确认表面=#223 开闸、章节语义=时间轴新能力），不塞进本草案。

### 4.3 C 线：测试系统设计（最重要）

**原则：锚「真实生产链路」**——外部 AI 经 MCP stdio 驱动 Nomi 完成真实创作任务的全链：连接→发现工具→建节点→跑生成→收产物→查状态。现有 8,000+ 单测证协议形状，证不了「一个真实 MCP 客户端能把片子做出来」。#202 的 13 个问题**没有一个**是单测红出来的，全是真人走真旅程撞出来的——测试系统的使命就是把那次旅程变成可复演的红灯。

**分三层，红灯式验收清单**（每条=可复现命令+预期；「红灯式」= 先让它在当前 main 上按预期红/绿跑一遍再入库）：

**L1 协议握手层（进 CI，零额度，已有基础设施）**
真 stdio 起服务端（`NOMI_MCP_STDIO` 模式跑打包前 electron main），脚本扮演 MCP 客户端：

| # | 验收条 | 命令（哨兵法） | 预期 |
|---|---|---|---|
| C1 | initialize 版本交集 | 发 `initialize protocolVersion:'2025-11-25'` / `'1999-01-01'` | 前者回显协商版；后者 -32602 + supported 数组 |
| C2 | tools/list 全量+预算 | `tools/list` 计 bytes | 42 工具（目录快照断言）；**载荷 ≤ 预算基线（棘轮：只减不增，当前 22,941B）**——把 G4 瘦身做成门岗 |
| C3 | 未知工具/坏参数 | call 不存在工具；call `nomi_add_nodes` 缺 projectId | -32602；isError + nomiOutcome 诊断码 |
| C4 | 取消绑定 | call 长工具后发 `notifications/cancelled` | 不再回响应；在飞中止 |
| C5 | 超长行/非 JSON | 写 5MiB 无换行行；写 `not-json\n` | 整条丢弃仅日志；-32700 |
| C6 | listChanged（A 线做完后） | 改 playbook 注册表 | 收到 `notifications/tools/list_changed` |

**L2 真实任务链层（进 CI，零额度，假 vendor）**
关键解锁：**测试专用假供应商**（走真 catalog/runtime 合同、真落盘物化，唯 HTTP 层换本地 fixture——`comfyui-local`/`codex-local` 已证明 process-transport 供应商可插）。然后跑「#202 旅程的可复演版」：

| # | 验收条 | 链路 | 预期（红灯锚 J-ID） |
|---|---|---|---|
| C7 | 冷连接→开项目 | initialize→`nomi_list_projects`→`nomi_session_open` | leaseHandle 可用 |
| C8 | 建四镜画布 | `nomi_add_nodes`(4)→elicitation decline | **回 typed reason（今天红：只有 cancelled:true）= J02 红灯** |
| C9 | 语义生成全链 | `nomi_get_generation_context`→`operation_create`(shots[4])→`submit_plan`→`request_gate`→`decide_gate`→`start_generation`→`operation_read` 至终态 | 四镜物化、artifact 路径投影带 projectRelativePath；**gate challenge 含实际参考媒体投影（今天红 = J04 红灯）** |
| C10 | 断连回收 | C9 进行中 kill 客户端 stdin | 在飞取消日志 + reconcile 后账本一致，无孤儿付费提交 |
| C11 | 产物审片 | `nomi_get_artifact` 视频产物 | **structuredContent 带 poster 可显（今天红 = J08 红灯）**；读 `structuredContent.nomiRunData`（text 是人话不是 JSON——已交学费） |
| C12 | 导出对账 | 时间轴编排→导出→读 job.json/manifest | manifest 的 tracks/assets/audio 与 ffmpeg.log 一致（J11 回归网）+ **落盘含 buildSha（今天红 = J13 红灯）** |

**L3 真宿主·真额度层（不进 CI，发版前手动，评测额度默认授权）**

| # | 验收条 | 做法 | 预期 |
|---|---|---|---|
| C13 | 真 Claude Code 全链 | 装机版 app 配进 claude mcp，一条 brief 让它自主做 2 镜短片（APIMart 小额） | 全程零次「切回 Nomi 找卡」以外的跨端摩擦（J03 除外）；ETA 与真实耗时同数量级（J06） |
| C14 | 真 Codex 全链 | 同上（`default_tools_approval_mode="writes"` 验 readOnlyHint 生效） | 只读工具不弹确认 |
| C15 | 弱宿主降级 | 不声明 elicitation 的最小客户端 | intake/确认按「不假装问过」路径降级 |

**CI 归属**：L1/L2 进 `pnpm run test:e2e` 旁的新 `test:mcp-journey`（真 Electron headless，Playwright 走查同款基建；win32 注意最小窗口坑）；C2 载荷预算做成 `check:*` 棘轮门岗（P2 家法）。L3 写成 runbook 挂发版检查单。

---

## 5. 实施量评估

| 切片 | 内容 | 量级 |
|---|---|---|
| A1 | listChanged 声明+通知（G1） | S（半天） |
| A2 | title + 描述瘦身 + C2 载荷棘轮门岗 | M（1-2 天，含 i18n 对齐） |
| A3 | 会话级目录收窄（G6） | M |
| B | J02/J04/J05/J06/J08/J13 六洞 | M-L（各 S-M，合计 3-4 天；J04/J08 碰确认卡 UI 要过样张） |
| C-L1 | 协议握手红灯 6 条 | M（1-2 天，最高杠杆——先做它，后面 A/B 全在它的网里改） |
| C-L2 | 假 vendor + 任务链 6 条 | **L**（3-5 天，假 vendor 是主要成本，但一次建成 A/B 线全部受益） |
| C-L3 | 真宿主 runbook | S（半天 + 每次发版 1 小时额度） |

**总量：L。建议施工方式：新窗口 chip 分两班**——第一班「测试系统 C-L1+C-L2」（先建网），第二班「A 线+B 线」（网里改，每修一洞翻绿一条红灯）；A1（S）可搭任一班顺手做。**不建议当前会话切片**：假 vendor + 走查基建是 3 天级独立工程，超出侦察班授权（本班只侦察+起草）。另一件当周就该做的小事：回复 #298（改造后收的三点返工要求），不让贡献者晾着。

---

*侦察方法备注：工具面数字用 tsx 实测 evaluate 目录（非静态数）；PR 全量翻自 gh CLI（400 条）；13 项对账逐条 grep/read 当前 main 源码；规范条目引 Context7 `/websites/modelcontextprotocol_io_specification_2025-11-25`（listChanged/cursor/title/taskSupport 均有原文）。*
