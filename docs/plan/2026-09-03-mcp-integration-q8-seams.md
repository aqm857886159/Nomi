# Q8：MCP 接入面收敛与接入管理动词

状态：🚧 进行中

## 背景与边界

用户原则是「确定性归我们，情境性归模型」。Nomi 只把密钥、落库、乐观锁、付费确认、认证 run 和删除这类必须一次做对的边界做成能力；供应商发现、翻页、读取杂牌中转站文档、拼 workflow、补未决字段由驱动方 Agent 用 web/Bash/重试完成。群反馈的「自定义中转站验证不过去 / no message / 非 imagen 报 500 / 要逐个写脚本」都属于流程编排无法覆盖真实方差。

本班只改 T14 接入面、接入管理后端能力、接入 playbook 与 L2 测试；不改 UI，不改 MAC、定价、receipt 消费/落账或 confirm→start 两相付费 seam。

## 现状：9 个写 transition 的真实职责

| 旧 action | 当前 handler | 真实职责与 CAS 语义 | Q8 去向 |
|---|---|---|---|
| `begin` | `IntegrationSessionService.begin` | 校验公开连接资料，创建 session，revision 从 1 开始；不收 key | 保留 |
| `open_credentials` | `openCredentials` | 以 owner + `expectedRevision` 写 session 并发起 Nomi 安全页 handoff；key 只由可信 UI 写入 | 保留 |
| `discover` | `discover` | 用凭据调用供应商/本地 runtime 拉候选，分页/检索并把结果写回 session | 删除：Agent 自己发现/翻页 |
| `select` | `select` | 从 session 候选中挑选模型，写入 selections 并进入花费确认 | 删除：选择随 `propose` 一次提交 |
| `request_confirmation` | `requestConfirmation` | 基于 selections 建不可变签名挑战，入 pending challenge；付费确认第一相 | 重命名为 `confirm`，底层 method 不变 |
| `submit_workflow` | `submitWorkflow` | 保存 Comfy workflow/binding，并进入未决输入阶段 | 删除：Agent 自己整理最终 workflow，交给 `propose` |
| `resolve_input` | `resolveInput` | 校验 answers 覆盖 unresolvedFields，清空未决字段后进入确认 | 删除：Agent 在外部情境中自行补字段 |
| `start` | `start` | 校验 receipt/MAC、幂等键、CAS；持久化 start intent、消费 receipt，启动 canonical certification run | 保留；付费第二相，不能与 confirm 原子化 |
| `cancel` | `cancel` | owner + CAS；终态幂等返回，认证中拒绝取消，其余标记 cancelled 并落盘 | 保留 |

`mutate()` 是普通写 transition 的共享 CAS 边界：先找 session、校验 owner、要求 `expectedRevision === session.revision`、要求可写 stage，再执行变更，成功后递增 session/state revision 并持久化。`requestConfirmation`/`start` 有额外的收据与认证约束，保持原实现，不把付费 seam 合并。

## 新 T14：五个确定性缝

`nomi_integration` 的 action 只允许：

1. `open_credentials`：需要 `sessionId` 与 `expectedRevision`，只发起 Nomi 安全页 handoff；MCP 输入禁止 `apiKey`、`authorization`、receipt token 等密钥形字段。
2. `propose`：需要 `sessionId`、`expectedRevision`、`proposal`。HTTP proposal 必须一次携带唯一候选集和非空 selections；ComfyUI proposal 必须携带最终 workflow。服务端在落库前做强校验，失败返回带路径的可读原因，不产生任何持久化变化；修正后以返回的新 revision 再次 propose，形成 patch 循环。
3. `confirm`：仍路由到 `integration.request_confirmation`，只建立不可变花费挑战；真人确认仍由可信 Nomi UI 完成。
4. `start`：仍路由到 `integration.start`，必须带 idempotency key 与 opaque receipt；认证 run 验真与收据消费原样保留。
5. `cancel`：仍路由到 `integration.cancel`。

`propose` schema 的公开形状如下，字段 `additionalProperties: false`；条件必填由 handler 给出字段路径诊断，不使用 `oneOf/if-then`：

```json
{
  "action": "propose",
  "sessionId": "integration-…",
  "expectedRevision": 2,
  "proposal": {
    "candidates": [{
      "modelKey": "image-model",
      "kind": "image"
    }],
    "selections": [{"modelKey": "image-model"}]
  }
}
```

一个 proposal 只能属于一种接入：HTTP 只接受 candidates + selections，不接受 workflow；ComfyUI 只接受 workflow，不接受 candidates/selections。候选 key 必须唯一、selection 必须引用本次 proposal 的候选；workflow 必须能被现有 Comfy parser/analyzer 接受。所有拒绝均在 CAS 写入前发生，返回例如：`propose rejected: proposal.selections[0].modelKey "not-listed" 未出现在 proposal.candidates；请先把该模型加入候选集，或修正选择后用返回的 expectedRevision 重提。` 失败不改变 revision。

## 接入管理动词

新增独立写工具 `nomi_integration_manage`，不扩张 T14 五 action：

- `update_vendor`：按 `vendorKey` 更新 `baseUrlHint`、`authType`、`authHeader`、`authQueryParam`、`providerKind` 或展示名。只交公开连接配置，不接受 API key；通过 `upsertModelCatalogVendor` 的既有校验与加密边界写入，未提供字段保持原值。
- `delete_vendor`：调用 `deleteModelCatalogVendor`，复用 vendor lineage 恢复/删除语义，一次删供应商及其模型、mapping、凭据关联。
- `delete_model`：调用 `deleteModelCatalogModel`，一次删模型和绑定 mapping。
- `set_proxy`：按 `vendorKey` + `enabled` 管理单 API 出站代理。MCP 只传开关，不传可能含 user:pass 的 proxy URL；开启复用已在 Nomi 安全配置中的加密地址，关闭只写 `proxyEnabled=false`，地址保留以便再次开启。`readCatalog` 的唯一解密 overlay 让后续出站请求立即生效。这里的「API」是一个 vendor connection，不是全局代理。UI 需另出样张，本班只交后端能力。

选择 catalog 而非 session FSM 的原因：已接入的供应商/模型和每 API 网络路由的持久真相在 `model-catalog.json`；session 是一次认证草稿，生命周期结束后不应成为管理入口。所有管理写都没有付费动作，也不返回凭据值。

## 迁移与回滚

- MCP 旧 integration action 与其 dispatcher case 同 commit 删除；`discover/select` 的服务路径随 MCP 路由退役，`submitWorkflow/resolveInput` 因 `integrationSessionIpc.ts` 仍直接共用而保留能力。四个 action 均从 MCP catalog/dispatcher 删除，不为 MCP 留 alias；交付报告列出实际共用者与保留边界。
- 已落盘 session schema 不改版本；历史 `needs_selection`/`needs_input` 会被 `nomi_read` 如实读出，Agent 可取消并新建 propose，不做静默重写。
- catalog 管理复用现有迁移/加密版本，不新增 secret 格式。回滚为回滚本班提交；旧 catalog/session 文件可继续由上一版本读取。UI 不随本班回滚范围变化。

## 验收门

1. `check:docs-index`、`check:doc-status`、`check:root-cause-contracts`、`check:test-waits`。
2. catalog 单元/结构测试：五 action 与新 management tool 的 schema、旧 action/handler 退役、propose 路由和拒绝原因；管理更新、删除与 proxy 开关持久化/出站读取。
3. `tests/ux/mcp-l2-journeys.e2e.mjs`：假供应商 propose 被打回→按新 revision 修正→通过；confirm/start 两相不能绕过；管理改 baseUrl/authType/proxy 后读回生效。
4. 运行 focused unit、L2 journey、build、全量 gates；报告区分代码绿、测试绿、gates 退出码、PR 待合入状态。

## 未在本班裁决的事实

若 live main 显示 GUI 仍依赖被删 transition，保留该 GUI capability 并只撤 MCP 暴露；若发现管理写会绕过 certification-owned connection 的既有保护，记录为开放问题并不自行改变认证策略。
