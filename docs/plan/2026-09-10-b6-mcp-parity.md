# B6 MCP 内外对等（C51 / C54）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：已实现，L1 / skills / packaged smoke 已通过，gates 执行中 · 2026-09-10 · 分支 fix/mcp-parity-20260910
> 基线：5c507a5cc（#646）；范围：工具 schema、verified client 拒绝、技能 resources/prompts。

## 先查别人

- 官方 MCP tools：https://modelcontextprotocol.io/specification/2025-11-25/server/tools （2026-09-10 实查）。工具输入是 object JSON Schema；输入校验失败用 isError。我们使用标准子集；领域上仍需租约及真人审批，annotations 不构成授权。
- 官方 MCP prompts：https://modelcontextprotocol.io/specification/2025-11-25/server/prompts （同日实查）。get 输入在 arguments，扩展元数据在 _meta；现有顶层 packageVersion/contentHash 是无领域理由偏差，C54 删除。
- 官方 MCP resources：https://modelcontextprotocol.io/specification/2025-11-25/server/resources （同日实查）。资源按 URI 分别读取，支持文本文件；技能附件不应只存在 hash 里却无法读取。
- 仓内已有 electron/shared/agentCapabilities/modelFacingToolRegistry.ts:98 + electron/agentLane/laneToolCatalog.ts:29：lane 是 internal 投影，含 deferred 才完整；不复制 12 工具目录。复用共享描述符，保留外部寻址与审批信封。
- 仓内已有 electron/capabilityCore/mcpTransportSchemaFromZod.ts:1：Zod→可广播 schema 转换，不新造转换器。electron/capabilityCore/mcpCapabilityProjection.ts:211 手写时间轴计划漏 action/约束，删除后从 lane 同源 model schema 投影。
- 反方独立复核（prior_art agent，2026-09-10）：timeline preview 内部 read / MCP edit 的审批与 lease 是领域差异，不能盲目把所有别名公开成免审批读工具；rpcServer.ts:188 丢认证 code，需一起修。

## 对等表

下表逐个覆盖 lane 核心与 deferred；名可为外部对象聚合，语义字段/边界必须同源。R=读，W=写；拒绝统一使用 capability_input_invalid（工具输入）和原领域 code。外部多一层 mcp_connection_unauthenticated / lease_*，内部身份由 lane 宿主绑定，因此不需要外部 proof。

| lane 名 | 外部 MCP 名/分支 | 权限 | schema/拒绝裁决 |
|---|---|---|---|
| `read_full_text` | `nomi_document_read` | R | 必须一致：共享描述符；外部租约/寻址为有意不同 |
| `read_selection` | `nomi_document_read` | R | 必须一致：共享描述符；外部租约/寻址为有意不同 |
| `insert_at_cursor` | `nomi_document_edit` | W | 必须一致：共享描述符；外部租约/寻址为有意不同 |
| `replace_selection` | `nomi_document_edit` | W | 必须一致：共享描述符；外部租约/寻址为有意不同 |
| `append_to_end` | `nomi_document_edit` | W | 必须一致：共享描述符；外部租约/寻址为有意不同 |
| `nomi_canvas_read` | `nomi_read (canvas)` | R | 必须一致：共享描述符；外部租约/寻址为有意不同 |
| `nomi_canvas_write` | `nomi_canvas_edit` | W | 必须一致：共享描述符；外部租约/寻址为有意不同 |
| `nomi_storyboard_write` | `nomi_canvas_edit` | W | 必须一致：共享描述符；外部租约/寻址为有意不同 |
| `nomi_shot_reference_write` | `nomi_canvas_edit` | W | 必须一致：共享描述符；外部租约/寻址为有意不同 |
| `read_timeline` | `nomi_timeline_read` | R | 必须一致：共享描述符；外部租约/寻址为有意不同 |
| `inspect_timeline_range` | `nomi_timeline_read` | R | 必须一致：共享描述符；外部租约/寻址为有意不同 |
| `get_media` | `nomi_media_query` | R | 必须一致：共享描述符；外部租约/寻址为有意不同 |
| `inspect_media` | `nomi_media_query` | R | 必须一致：共享描述符；外部租约/寻址为有意不同 |
| `search_media` | `nomi_media_query` | R | 必须一致：共享描述符；外部租约/寻址为有意不同 |
| `inspect_source_range` | `nomi_media_query` | R | 必须一致：共享描述符；外部租约/寻址为有意不同 |
| `read_waveform` | `nomi_media_query` | R | 必须一致：共享描述符；外部租约/寻址为有意不同 |
| `propose_edit_plan` | `nomi_timeline_edit (preview)` | R | 必须一致：删除手写语义 schema，外部操作聚合/审批信封有意不同 |
| `apply_edit_plan` | `nomi_timeline_edit (apply)` | W | 必须一致：删除手写语义 schema，外部操作聚合/审批信封有意不同 |
| `undo_timeline_edit` | `nomi_timeline_edit (undo)` | W | 必须一致：删除手写语义 schema，外部操作聚合/审批信封有意不同 |
| `inspect_export_job` | `nomi_export_job (status)` | R | 必须一致：删除手写语义 schema，外部操作聚合/审批信封有意不同 |
| `verify_render` | `nomi_export_job (verify)` | R | 必须一致：删除手写语义 schema，外部操作聚合/审批信封有意不同 |
| `export_timeline` | `不暴露` | W | 有意不同：外部仅核验导出，导出写/取消仍由 Nomi 宿主授权 |
| `cancel_export_job` | `不暴露` | W | 有意不同：外部仅核验导出，导出写/取消仍由 Nomi 宿主授权 |
| `delete_canvas_nodes` | `nomi_canvas_maintenance` | W | 必须一致：删除手写语义 schema，外部操作聚合/审批信封有意不同 |
| `nomi_generation_plan` | `nomi_operation_plan / nomi_read` | W | 必须一致：共有语义字段从 lane 描述符 owner 派生；仅 project/run 寻址与 Run-owned 审批信封有意不同 |
| `nomi_generation_status` | `nomi_operation_control / nomi_read` | W | 必须一致：共有语义字段从 lane 描述符 owner 派生；仅 project/run 寻址与 Run-owned 审批信封有意不同 |
| `get_production_run` | `nomi_read (run)` | R | 必须一致：共有语义字段从 lane 描述符 owner 派生；仅 project/run 寻址与 Run-owned 审批信封有意不同 |
| `subscribe_production_run` | `nomi_read (run_events)` | R | 必须一致：共有语义字段从 lane 描述符 owner 派生；仅 project/run 寻址与 Run-owned 审批信封有意不同 |
| `read_production_artifact` | `nomi_read (artifact)` | R | 必须一致：共有语义字段从 lane 描述符 owner 派生；仅 project/run 寻址与 Run-owned 审批信封有意不同 |
| `read_production_artifact_content` | `nomi_read (artifact_content)` | R | 必须一致：共有语义字段从 lane 描述符 owner 派生；仅 project/run 寻址与 Run-owned 审批信封有意不同 |
| `start_production_run` | `nomi_run_start` | W | 必须一致：共有语义字段从 lane 描述符 owner 派生；仅 project/run 寻址与 Run-owned 审批信封有意不同 |
| `control_production_run` | `nomi_run_control` | W | 必须一致：共有语义字段从 lane 描述符 owner 派生；仅 project/run 寻址与 Run-owned 审批信封有意不同 |
| `decide_production_gate` | `nomi_run_gate` | W | 必须一致：共有语义字段从 lane 描述符 owner 派生；仅 project/run 寻址与 Run-owned 审批信封有意不同 |
| `revise_production_artifact` | `nomi_artifact_review` | W | 必须一致：共有语义字段从 lane 描述符 owner 派生；仅 project/run 寻址与 Run-owned 审批信封有意不同 |
| `review_production_artifact` | `nomi_artifact_review` | W | 必须一致：共有语义字段从 lane 描述符 owner 派生；仅 project/run 寻址与 Run-owned 审批信封有意不同 |
| `materialize_production_storyboard` | `nomi_run_gate` | W | 必须一致：共有语义字段从 lane 描述符 owner 派生；仅 project/run 寻址与 Run-owned 审批信封有意不同 |

## Schema 收口与预算

时间轴 plan/undo、导出 job、画布维护、production brief/control/gate/artifact 与 generation create/patch 的字段都复用 lane 同一 owner，删除手写字段表。独立补查见 `docs/plan/2026-09-10-b6-generation-schema-parity.md`。保留 object 聚合与 lease/vendor/modelKey 寻址别名。

补齐约束后通过精简重复工具标题和共享 workflow 指南的同义冗长表达释放空间；不删除字段、枚举、上限或校验，不提高 payload 基线。指南仍包含参考载体、场景分组、图片/视频/首帧、模型参数、站位/运镜预设及 fallback 的所有语义要求，且两 profile 仍读同一数组。

JSON Schema 顶层 `$schema` 方言声明不嵌入 plan 字段；numeric exclusiveMinimum 保留数字形式。generation parameters 保留递归 JSON union 与本地 $ref，仍接受任意嵌套 JSON；typed candidate/reference/shot 字段完整发布。

## 外部特有工具与偏差

nomi_session_open 是外部 verified project lease 建立；nomi_project_create / nomi_asset_import 是显式项目寻址与本机文件导入；nomi_operation_preview / nomi_operation_start 等付费相位只经 Run-owned gate；nomi_integration / nomi_integration_manage 是宿主接入管理；layout read/write 是外部剪辑工作区控制。不得因对等打开 lane 付费权限或取消外部 lease。

## 实施与验收

1. 保留外部已发布名字与动作值；人类标题只保留任务名，去除与描述/字段枚举重复的文字，以原 payload 上限容纳完整 schema；用 lane 同源 schema 组装外部传输字段，删除 timeline/export/canvas maintenance 另一份属性表。
2. verified client 校验前移到共享 MCP 请求边界，两种 stdio 都返回 -32001 + data.code；loopback 403 保留同一码，工具执行错误保留 isError 形式。
3. C54 按独立方案 `docs/plan/2026-09-10-b6-mcp-skill-content.md` 执行。
4. 先红后绿：L1、skills integration、共享边界单测；打包 smoke；gates（等待锁）→ commit/push → PR。
5. 6 角色自审：CTO 同源边界；设计不改页面布局；PM 不扩大付费权限；前端保留工具标题；后端验证先于副作用；真实用户收到可诊断拒绝、可读完整技能。

## 证据

- 基线红：`.tmp/b6/unit-red.log` 8 failed；`.tmp/b6/l1-red.log` 未验证 Electron 客户端启动即退出；`.tmp/b6/production-red.log` 真基线 build 的 durationSeconds=number，lane=integer。
- C54 红 6 / 局部绿 23；generation 红 3 / 局部绿 4；总验证日志在 `.tmp/b6/`，最终交接 `b6-mcp-parity-LAST.md`。
- 改前真机截图 `docs/evidence/b6-mcp-parity/before.png` 来自 macOS Terminal 展示真实隔离 Electron stdio 响应；不是 Claude/WorkBuddy 私有 UI 模拟。改后同脚本/同窗口取证。
- 全套 gates 和打包 smoke 未完成前不宣称完成。prompt-only shots 在两条路同样被共同 owner 拒绝，本任务不改候选默认值或付费行为。


## 递归参数发布与执行边界

旧 transportSchemaFromZod 将 generation 的递归 JSON 值抹成 additionalProperties:true，新增嵌套参数触发 empty-schema。选择复用 toPublishedJsonSchema 对完整外部 envelope 一次投影，确保引用相对最终根成立。使用已在 lockfile 的 Ajv 8.20.0（提升直接依赖）替换自研 JSON Schema 执行器，保留中文错误和不修改参数；拒绝增加债基线或继续扩自研 $ref 解释器。官方来源：https://ajv.js.org/json-schema.html 和 https://ajv.js.org/options.html 。风险：既有错误诊断兼容、递归引用、未知字段、数值边界；均以回归测试覆盖。

## 已执行验证（2026-09-10）

- 单 worker 窄回归：递归/非法 schema/数值边界先红5条；修复后通过。MCP 59文件472条首轮471通过，唯一旧空提示词放行断言强化为 capability_input_invalid 且无生成调用，相关16条复测通过。
- Electron tsc、根因合同、prior-art、model-schema、28 operation constructible、payload 均通过。payload 44002 / 45822字节；删除5条已修复空schema豁免，不增加任何基线。
- 真 Electron stdio L1通过；Claude + WorkBuddy skills integration累计28断言；macOS arm64打包 smoke通过（25 tools / 165 resources / director body 7886 chars）。
- 实际Terminal改前改后截图与复跑脚本：docs/evidence/b6-mcp-parity/。
- 新增Ajv使用官方draft-07语义；未知schema关键字及悬空/外部引用均fail-closed，不加载远程schema、不改写参数。
