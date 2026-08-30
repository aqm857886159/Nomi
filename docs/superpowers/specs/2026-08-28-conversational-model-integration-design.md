# 对话式模型接入与认证闭环设计

日期：2026-08-28
状态：六角色复审通过，进入实现
目标版本：Nomi v0.22 之后的桌面安装版

## 1. 要解决的真实问题

目标不是「让 Agent 帮用户填完一张接入表」，而是：用户只有安装版 Nomi、Codex / Claude Code / WorkBuddy 和供应商资料，没有 Nomi 仓库，也能在对话中把一批 API 模型或一份 ComfyUI 工作流接成**升级或重启后仍真正可用**的能力。

历史反馈证明「保存成功」与「可以使用」不是一回事：

- [#4](https://github.com/aqm857886159/Nomi/issues/4) / [#8](https://github.com/aqm857886159/Nomi/issues/8)：文档地址与 BaseURL 混为一谈，无文档中转无法接。
- [#9](https://github.com/aqm857886159/Nomi/issues/9)：生成模型接进来了，但创作助手缺文本大脑。
- [#19](https://github.com/aqm857886159/Nomi/issues/19)：BaseURL 自带版本段时，端点被错误拼接。
- [#23](https://github.com/aqm857886159/Nomi/issues/23)：未知模型类型让整个模型设置页崩溃。
- [#42](https://github.com/aqm857886159/Nomi/issues/42)：后台桥缺失时永久停在加载态。
- [#62](https://github.com/aqm857886159/Nomi/issues/62)：本地地址文档发现产生无效 URL；同源私网产物又被验证阶段的 SSRF 防护拒绝。
- 本轮用户反馈：Kling 3.0 Omni 多图和 MiniMax H3 ComfyUI 工作流分别暴露了媒体角色被位置猜测、UI workflow 的 `widgets_values` 被错误映射为 API input 等问题。

这些不是一两个供应商的特例，而是旧流程缺少统一的不变量：**只有真实生产任务完整通过并完成耐久提交，才算接入完成。** 这次不能只新增 MCP 外壳；现有手工 HTTP / ComfyUI 新增和编辑入口也必须迁移到同一认证与提升边界，删除“保存后直接启用”的旧旁路。

## 2. 产品判断与取舍

| 方案 | 用户看到什么 | 代价 | 结论 |
|---|---|---|---|
| Agent 直接改 Catalog JSON | 很快，但密钥、Schema、升级兼容和半成品都暴露给 Agent | 极易写坏；无法证明生产可用 | 不采用 |
| 每个供应商独立 Skill | 某一家体验好 | 供应商越多，规则越漂；又回到补丁模式 | 不采用 |
| 新会话层包住旧保存流程 | 对话看起来通了 | 旧 UI 和 ComfyUI 仍可绕过认证直接启用 | 不采用 |
| 通用会话 + 唯一 canonical certification run + 薄 Skill | Agent 负责询问和选择，Nomi 负责安全写入、真实认证和持久化 | 必须迁移旧入口并增加安装包 E2E | 采用 |

核心取舍：**少追求“任何 API 看一眼就自动猜对”，多保证“没验证过的绝不冒充已接好”。** 不知道的字段进入 `needs_input`；未通过的模式只在设置页显示，不进入普通模型选择器。

另一个取舍是**不强迫每位用户为接入重启 App、再付一次模型调用费**。生产可用由第一次真实生产任务证明；持久化由 journal、fresh-process readback 和安装包崩溃/升级 E2E 证明。真实 App 重启后的再次生产调用是发布验收门，不是每次接入的用户摩擦。

## 3. 外部依据：采用成熟边界，不另造协议

### 3.1 Agent 与 Nomi 之间：MCP + Agent Skills

- [Agent Skills 规范](https://agentskills.io/specification)规定 `SKILL.md` 的渐进披露形态。Nomi 把 `model-integration` 作为明确允许的内置 MCP resource 暴露，不依赖仓库或客户端安装脚本。
- [MCP Elicitation](https://modelcontextprotocol.io/specification/draft/client/elicitation)明确要求：普通选择可用 form mode；API key 等敏感信息不得经过 form/LLM，必须走 URL mode或等价的站外安全界面。
- API key 统一在 Nomi 安全 UI 输入。MCP 参数、结果、resource、日志、URL 和错误字符串都不允许承载密钥。
- 不依赖客户端主动读取 resources：`tools/list` 的工具描述本身必须足以完成流程；Skill 只是让 Agent 更稳定。
- Codex、Claude Code 使用现有签名安装配置。WorkBuddy 若没有 Nomi 专用配置写入器，使用同一个带客户端签名的“复制通用 MCP 配置”入口；不能把未签名 `external` 身份提升为可写接入客户端。J0 同时验证 resources-aware 与 tools-only 客户端。

### 3.2 HTTP API 模型：协议发现与手工声明并存

- Open WebUI 当前 `backend/open_webui/routers/openai.py:120-128` 把 OpenAI-compatible 的模型发现稳定落在 `{base}/models`；同文件 `:265-272` 会先去掉 `/api/v1`、`/api/v0`、`/v1` 再做某些管理请求，说明 BaseURL 规范化应是显式协议逻辑，不是字符串随手拼接。
- Dify 的模型插件规则把 provider、credential schema、预定义模型、可自定义模型和远端拉取模型分开；我们采用同一层次，但不引入 Dify 插件运行时。
- [OpenAPI](https://spec.openapis.org/oas/latest.html)是 API 契约的标准输入。OpenAPI、公开文档 URL、粘贴文本或本地文档文件都只生成候选请求；最终真相仍是生产路径的真实请求。
- 供应商可能有 `/models`（如 [BananaRouter 模型列表](https://bananarouter.com/docs)），也可能没有或不完整。候选必须保留 `remote | manual | docs | runtime` 证据来源，不把接口缺失误判为「没有模型」。
- BaseURL、create、poll、upload 和结果提取统一复用 Nomi 的 `buildHttpRequest` / URL join / request transform 原语，发现层不得另写字符串拼接规则。

### 3.3 ComfyUI：API workflow + 官方转换，不读 UI 控件位置

- [ComfyUI 官方 Server Routes](https://docs.comfy.org/development/comfyui-server/comms_routes)提供 `/features`、`/models`、`/workflow_templates`、`/object_info`、`/upload/image`、`/prompt`、`/history/{prompt_id}`、`/view` 和 `/ws`。
- ComfyUI `server.py:342-354` 返回模型目录，`:800-817` 返回节点 `object_info`，`:1072+` 的 `/prompt` 接收 API workflow 并先校验。
- 输入可以是 API workflow，也可以是普通 Save/UI workflow。UI workflow 必须复用现有 `comfyuiGraphConvert` / `analyzeComfyWorkflowTextSmart`，借当前 ComfyUI 前端转换为 API workflow；Nomi 永远不按 `widgets_values` 位置 zip 字段。
- 当前版本只承诺原生 ComfyUI Server 协议。平台专用 Cloud/Serverless API 若不是这套 routes，按普通 HTTP provider 独立接入，不能只加一个 key 输入框就宣称支持。

## 4. 用户旅程

### 4.0 J0：先建立安装版入口

1. Nomi 为 Codex、Claude Code 提供一键配置，为 WorkBuddy / 其他 MCP Host 提供带签名客户端身份的通用配置复制入口。
2. 外部 Host 从空目录启动，只连接安装版 Nomi；不能读取 Nomi 仓库、源码路径或用户 Catalog 文件。
3. `tools/list` 必须直接出现全部 integration tools；`resources/list` 支持时还能发现 `nomi-skill://model-integration`。
4. 未签名客户端只能读取公开描述，不能创建会话、打开凭据页或启动会消耗额度的认证。

### 4.1 HTTP API / 多模型

1. 用户说：「把 BananaRouter 的 Kling / 图片 / 文本模型接进 Nomi。」
2. Agent 调 `nomi_integration_begin`，提交名称、BaseURL、文档 URL/文件/粘贴文本（可选）和协议提示（可选）。
3. Nomi 规范化并冻结目标 origin，建立带 owner、revision、capability 的持久化 draft。
4. 若需要密钥，Nomi 打开现有「设置 → 模型」外壳里的 session credential 页面。页面明确显示：发起客户端、规范化 origin、auth 类型、header/query 名、新建/复用/覆盖范围，以及“密钥会在测试和生成时发送到该地址”。用户确认后才保存；safeStorage 不可用则阻断，不落明文。
5. 保存只显示「密钥已安全保存，尚未验证」，绝不显示「已接入」。Agent 只能读取 `credentialStatus=ready`，读不到密钥或凭据引用内部值。
6. `discover` 返回可分页、搜索、按能力分组的候选。每项包含准确 model ID、kind、声明 modes、证据来源、分类状态和预计认证调用次数；禁止静默截断。
7. 用户一次选择多个模型；未知 kind 或缺少编译用文本模型时，会话进入带完整 `unresolvedFields[]` 的 `needs_input`，Agent 一次问全并用 `resolve_input` 提交。
8. `start` 先显示不可变认证合同：模型/modes、测试参数、最大尝试次数、预计调用数和最高成本。确认后创建一个 canonical run；同一幂等键重复调用只能返回原 run。
9. 每个 mode 直接通过正式生产执行入口完成 create → poll/reconcile → artifact 落入 Nomi 管理存储 → 解码。提交响应未知时只允许根据已持久化 remote task id 查询，禁止自动重复 create。
10. 通过项进入不可见 staging；失败项按 auth / balance / quota / input / server / network / contract / security 分类。批次可 `partial`。
11. prepared journal、Catalog revision 和 session revision 原子收敛；fresh-process 重新读取并重新解析 mapping/credential 后才提交可见状态。只有 verified mode 才进入选择器和 `nomi_list_models`。
12. Agent 返回短清单：哪些已可用、哪些待处理、每个失败项唯一下一步。重启/升级后同一 session 与已通过模型仍可读；发布级 E2E 再从正式入口真实生成一次。

### 4.2 ComfyUI

1. 用户提供 ComfyUI 地址和 API workflow、普通 UI workflow 文本或文件。
2. `begin(kind='comfyui')` 探测原生 server routes；私网实例需要 Nomi UI 对精确 origin/IP 授权。
3. Nomi 用现有 smart conversion、`analyzeComfyWorkflow` 和 `/object_info` 生成显式候选：prompt、negative prompt、任意数量图片/视频槽、参数、输出节点。
4. 如果有歧义，一次返回完整 `unresolvedFields[]`。仅靠 node ID 无法理解时才打开现有工作流页面并高亮候选；否则直接在对话中一次确认。
5. 绑定持久化为 `{nodeId,inputKey,paramKey,mediaKind}`。每个媒体槽使用可区分、可说明来源的内置测试素材，走正式 `/upload/image` 链；图片文件名只写入绑定的媒体 input，`frame_rate` 等数值槽始终保持 number。
6. canonical run 经 `/prompt`、`/history/{prompt_id}`、目标 output、`/view` 和真实解码后进入同一 staging / journal / promotion 边界。现有手工导入页也改调该 run，不能直接启用 Catalog。

## 5. 系统结构

```text
Codex / Claude / WorkBuddy（无仓库）        现有 Nomi 手工设置 UI
                │ MCP tools / skill                 │
                └──────────────┬─────────────────────┘
                               ▼
                    IntegrationSessionService
                    （只编排、owner/revision/handoff）
                               │ childRunRef
                               ▼
                 ConnectionCertificationService
                 （唯一 canonical run / ledger / promotion）
                    ├── HttpProviderConnector
                    │     └── 迁移现有 ProviderAdapter compile/repair
                    └── ComfyUiConnector
                          └── 现有 smart conversion / binding parser
                               │
                               ▼
             正式生产执行入口 → 管理资产 → 受限解码 → staging
                               │ prepared journal + CAS
                               ▼
                    Catalog（仅 verified 可见）
```

### 5.1 单一真相源与迁移

- `IntegrationSessionService` 不保存第二份 mode 认证结果，只引用 `childRunRef` / `revisionDigest`。
- `ConnectionCertificationService` 取代执行型 `IntegrationCertification`，是 HTTP 与 ComfyUI 新增/编辑的唯一 run owner。现有 `ProviderAdapterService` 的 compile/repair/verify 迁为 HTTP connector 原语；旧手工 UI 和 MCP 都创建同一种 run。
- HTTP/ComfyUI 现有 `stage enabled:true`、`import → enabled:true` 旁路删除。未认证连接/模型只能在设置页显示「已配置、未认证」。
- 可用性按 verified modes 派生，不再仅按 `enabled + keyStatus` 判断。mode verified 才启用 mapping；model 至少一个核心 mode verified 才 enabled；vendor 至少一个可执行 verified model 才 enabled。
- repair 失败时保留完整旧 active revision，禁止混用「旧 mapping + 新 model」。存量 active revision 保持可用；任何新建/编辑必须走新边界。旧明文凭据标为 `needs_credential_resave`，不能产生新的 completed run。

### 5.2 持久化会话与 canonical run

```ts
type IntegrationSession = {
  schemaVersion: 1
  id: string
  revision: number
  ownerClientId: string
  capabilityDigest: string
  kind: 'http-api-provider' | 'comfyui-workflow'
  stage:
    | 'draft' | 'needs_credential' | 'needs_input' | 'discovering'
    | 'needs_selection' | 'needs_spend_confirmation' | 'certifying'
    | 'committing' | 'completed' | 'partial' | 'failed' | 'cancelled'
  configDigest: string
  credentialStatus: 'missing' | 'ready' | 'needs_resave' | 'unavailable'
  childRunRef?: { runId: string; revisionDigest: string }
  unresolvedFields: Array<{ key: string; reasonCode: string; candidates?: unknown[] }>
  blockingReason?: { code: string; params?: Record<string, string | number> }
  persistenceProof?: { journalId: string; freshProcessBootId: string; catalogRevision: number }
  createdAt: string
  updatedAt: string
}
```

CredentialRef 是 service 内部 opaque reference，绑定不可变 `origin + authType + authHeader/query + session owner + model scope`；MCP 和 session JSON 都不含其值。配置任一安全字段变化会让凭据失效并要求再次确认。

canonical run 另有持久化 operation ledger：`idempotencyKey`、`contractDigest`、`lease`、`attempt`、`checkpoint`、`remoteTaskId`、`submissionState(submitting|submitted|unknown|settled)`、artifact digest/媒体元数据、decoder evidence。网络 create 前先落 checkpoint；崩溃后只能 reconcile，不重复提交。

session、run 与 Catalog 用 schema 校验、revision/CAS、跨进程锁和 prepared journal 协调。损坏文件进入可诊断恢复状态，禁止静默回退为空。`completed/partial` 只在 journal commit 后产生；fresh-process readback 只验证持久化和正式解析，不产生第二次付费调用。

### 5.3 MCP 工具合同

| 工具 | 允许阶段 | 关键参数 | 幂等/额度 |
|---|---|---|---|
| `nomi_integration_begin` | 新建 | kind、公开连接资料、clientRequestId | clientRequestId 幂等；不花额度 |
| `nomi_integration_open_credentials` | needs_credential | sessionId、expectedRevision | 重复只聚焦同一请求；不接收密钥 |
| `nomi_integration_discover` | draft/ready/needs_input | sessionId、expectedRevision、page/search | 只读公开资料或使用已绑定凭据拉模型；不生成 |
| `nomi_integration_select` | needs_selection | sessionId、expectedRevision、精确 selections | CAS；不花额度 |
| `nomi_integration_submit_workflow` | draft/needs_input | sessionId、expectedRevision、workflow text/file reference | 大小/节点/深度限制；不直接入 Catalog |
| `nomi_integration_resolve_input` | needs_input | sessionId、expectedRevision、answers | 一次覆盖全部 unresolved fields；CAS |
| `nomi_integration_start` | needs_spend_confirmation | sessionId、expectedRevision、idempotencyKey、Nomi 确认 receipt | 最多一个 canonical run；可能花额度 |
| `nomi_integration_get` | 任意 | sessionId | 只读；分页返回候选/结果 |
| `nomi_integration_cancel` | 非终态 | sessionId、expectedRevision、idempotencyKey | 只取消未提交/可取消任务；不伪装退款 |

所有写工具绑定签名客户端 owner/capability、`expectedRevision` 和速率限制；未知字段拒绝。返回值使用稳定 `reasonCode + params`、`nextActions[]`、结构化计数；`safeSummary` 由本地化层生成，禁止返回凭据、Authorization、签名 URL、绝对路径、连接指纹或原始供应商错误页。

### 5.4 内置 Skill

`skills/model-integration/SKILL.md` 是外部允许列表中的薄工作流，不承载供应商逻辑：

- 先读官方资料和 Nomi 返回的证据；不凭记忆猜端点。
- 绝不在对话中索要、接收或回显密钥。
- 候选可分页/搜索；一次选择多个模型，不静默漏项。
- 把全部 `unresolvedFields` 一次问完。
- 不把 `partial`、`密钥已保存`、`候选探测通过`说成完成。
- ComfyUI 只按 nodeId/inputKey/paramKey 绑定，禁止 widget 位置推断。
- auth/balance/quota/security 不盲重试；contract 才进入有上限的 repair。

## 6. UI 范围与 handoff

不新增 AppBar 常驻按钮，也不新造「Agent 接入中心」。复用 SettingsDialog、OnboardingDrawer、连接页、ComfyUI 工作流页、验证任务页和设计组件，但**不复用“保存即成功/直接写 Catalog”的行为**。

主进程维护持久化 handoff queue；目标是带 `requestId/sessionId/revision` 的判别联合：`credential | connection | workflow | verification`。preload 提供订阅与 ack；应用关闭时先排队再唤醒，页面挂载后消费。不能只靠可能丢失的 `window.CustomEvent`。已有未保存编辑时不覆盖导航，显示非破坏性待处理提示。

credential 页面必须显示发起客户端和冻结后的安全 scope，主操作叫「安全保存并继续验证」。来源 `DesignAlert` 在实际可见页面上，包括 ComfyUI 全屏页。保存后跳到 session 验证页；状态用真实计数和 `aria-live`。partial 按模型/mode 显示「可用 / 尚不可用 / 原因 / 唯一下一步」，关闭只是转后台，取消必须显式操作。

所有文案走 `reasonCode → zh-CN/en` 映射，复用 token 和组件，不新增全局 CSS。

## 7. 认证与提升不变量

一次认证请求直接走用户实际使用的正式生产入口，不做「底层 verify 一次、production replay 再一次」的双提交。

| 能力 | 必须验证 |
|---|---|
| text | 正式文本管线返回非空文本；若声明工具调用则测一次工具调用 |
| image | create；最终内容流式落临时文件；magic bytes；受限解码；复制到 Nomi 管理存储 |
| video | create + poll/reconcile；ffprobe 读容器、时长、视频流和至少一帧；管理存储可回读 |
| audio | create + poll；解码器读音频流和时长 |
| model3d | create + poll；类型与声明一致；现有导入器可读 |
| ComfyUI | upload 每个媒体槽；`/prompt`；目标输出；`/history`；`/view`；解码；绑定 round-trip 不漂移 |

媒体下载必须流式限制总字节；在解码前校验 Content-Type 与 magic；限制像素、帧数、时长、流数和嵌套；sharp/ffprobe/导入器有超时、输出上限、禁网络协议和 kill-tree。HTML/XML 错误页必须在进入解码器前转成供应商响应错误，不能再出现 `glib XML parse error` 这种二次误导。

提升顺序：candidate evidence → canonical run verified → invisible staging → prepared journal → fresh-process readback → atomic Catalog commit → `completed/partial`。任何失败模式保持 disabled；repair 后全量回归，失败则保留旧 active revision。

## 8. 安全、网络与成本

- 新建或编辑凭据一律 fail-closed：safeStorage 不可用时不保存；`enc=plain` / legacy plaintext 只能读作待迁移，不能完成新 run。
- Nomi UI 确认并冻结 origin、auth scope 和模型范围。所有带凭据的 create/poll/upload 请求只能访问该 scope；OpenAPI `servers` 不得静默改写目标。
- 出站请求连接前解析 DNS 并检查全部地址；redirect 逐跳 manual 校验；默认拒绝 metadata、link-local 和地址类别变化。私网/loopback ComfyUI 只在用户授予精确 origin/IP grant 后允许；防 DNS rebinding需要在连接时绑定已验证地址。
- 文档抓取绝不带 auth。产物 CDN 必须来自 contract 明确 allowlist；跨 origin 需要 Nomi UI 再确认，禁止任意 redirect。
- workflow 限制体积、节点数、深度、字符串长度和 prototype keys。
- 成本确认绑定不可变 contract、模型/modes、测试参数、最大尝试次数、最高成本和 idempotency key。Agent 不能确认费用或铸造 receipt。
- submission `unknown` 状态只 reconcile；取消不自动重复 create，不承诺已提交任务退款。

## 9. 真实任务测试系统

### J0 安装版、无仓库入口

Codex、Claude Code、WorkBuddy/generic MCP harness 分别从空目录连接安装版 Nomi；验证 tools-only 和 resources-aware 两种路径、签名身份、Skill 发现、Nomi 关闭时 handoff 排队和 GUI 唤醒。真实 WorkBuddy 宿主不可获得时必须诚实标注，generic harness 不能冒充真宿主证据。

### J1 BananaRouter 多模型接入

输入：官方 docs/BaseURL、Nomi 安全 UI 中输入的测试账号 key。选择账号实际开放的 text/image/video。验证候选分页、多选、成本确认、一次 canonical run、真实产物解码、partial、fresh-process readback、普通模型列表只出现通过项。测试进程无权访问仓库和凭据文件。

### J2 ComfyUI 工作流接入

分别输入普通 UI workflow 与 API workflow；覆盖两个以上媒体槽。验证一次歧义确认、显式绑定、每槽差异化测试素材、正式上传、`frame_rate` 保持 number、`/history`/`/view`/解码和重启后再次正式执行。

### J3 故障与旧事故矩阵

- BaseURL：`/v1`、`/api/v3`、无版本、尾斜杠；模型列表成功/404/401/分页/手工 ID。
- kind：text/image/video/audio/model3d/未知值；缺编译文本模型。
- 媒体：HTML/XML 伪装 200、超大/解码炸弹、跨源 redirect、签名 URL、同源私网。
- 安全：safeStorage 不可用、旧明文、origin 换绑、DNS rebinding、metadata redirect。
- 恢复：重复 start、提交响应丢失、start/cancel 并发、同 vendor 双 session、prepared commit 各点杀进程、损坏 session/journal。
- 入口一致性：现有手工 UI 与 MCP 生成同一种 canonical run；失败模式在模型选择器与 `nomi_list_models` 中都不可见。
- 打包重启/升级：停止并重启真实 App 与 Agent，从同一 session 继续，不重输 key、不重复已提交 create，并再次从正式入口生成。

## 10. 范围与不动项

本期做：迁移手工 HTTP/ComfyUI 新增编辑入口、canonical run/ledger/promotion、安装版 MCP tools、持久化 session、Nomi 安全 handoff、HTTP/ComfyUI connectors、媒体验真、安全存储收紧、内置 Skill、README/指南、无仓库 E2E。

本期不做：

- 不让 Agent 直接编辑源码或 Catalog 文件。
- 不实现远程多租户 MCP 服务；只服务本机安装版。
- 不承诺缺少契约的私有 API 自动猜中；会停在可恢复状态。
- 不为每家供应商写 UI/代码分支。
- 不把平台专用 Comfy Cloud/Serverless API 冒充原生 ComfyUI Server。
- 不强迫每位用户重启并重复付费；真实重启调用由发布/E2E 测试账号承担。

## 11. 回滚与迁移

这不是可单独移除的 MCP 外壳：新入口与手工 UI 都迁到同一 certification owner，旧直接启用路径在同一改动删除。回滚以 migration journal 和旧 active revision 为边界：未提交 staging 可丢弃；完整旧 active revision 保留；已经完成的 journal 可幂等重放。禁止恢复旧“保存即启用”旁路。

## 12. 六角色初审处理

- **CTO**：接受“必须迁移旧入口、删除平行认证”的意见；改为唯一 canonical run owner，session 只引用 child run。
- **设计**：凭据页改为安全授权面板；保存只表示已安全保存，partial 有逐项恢复动作。
- **产品**：增加 J0、候选分页/搜索/完整证据、UI workflow 支持和明确成本合同。
- **前端**：增加持久化 handoff queue + ack，不只靠 CustomEvent；safeStorage fail-closed 与 reasonCode i18n。
- **后端/安全**：增加 credential scope、operation ledger、幂等/unknown reconcile、journal/CAS、DNS/redirect 与受限解码。
- **真实用户**：支持普通 Save workflow；一次收齐所有歧义；tools-only 也能开始。
- **有意不采纳“每个用户必须重启并再次付费才 completed”**：这会制造不必要摩擦和重复成本。改为首次真实生产调用 + fresh-process 持久化读回作为产品完成门，真实重启后的再次生产调用作为安装包发布门；两者分别证明“能力能用”和“升级后仍在”。

## 13. 设计完成与功能完成判据

六角色复审已一致接受修订方案；共同要求 fresh-process 必须是同安装包身份、同 userData、无共享内存的独立进程，且零网络读回不得重复 create。发布级真实重启 E2E 仍是阻断门。

功能完成必须同时满足：

- 手工 UI 与外部 Agent 都不能绕过认证直接启用模型。
- 无仓库 Agent 完成 J0、J1、J2；J3 自动回归通过。
- 新/编辑凭据没有明文 fallback；未授权 origin、MCP 结果、日志、session 文件收到零字节凭据。
- 每个 idempotency key 最多一次 create；崩溃后从 remote task id 恢复。
- 只有真实生产调用、产物落盘和受限解码通过的 modes 进入模型列表。
- zh-CN/en、明暗模式、应用关闭/已开且有脏编辑的 UI handoff 截图走查通过。
- README 用户只需复制一句自然语言，不要求理解 MCP JSON 或 Git。
- 全仓 push gates、安装包 E2E 和最终代码审查通过。
