# 对话式模型接入与认证闭环验收记录

> 状态：🚧 进行中（本地自动化、真实 ModelScope 最小切片和 fresh-process 幂等读回已通过；原生 ComfyUI、真实 WorkBuddy、完整多供应商矩阵和安装包升级门仍是外部发布验收项。）

日期：2026-08-29

范围：Nomi v0.22 之后桌面安装版的 J0-J5 验收与最终交付。

## 证据口径

本记录把 `implemented`、`verified`、`committed`、`pushed` 和 `live` 分开记录。保存凭据、模型发现、Catalog 写入或 mock 请求，都不能替代真实生产任务、受限媒体验真、journal/CAS 提交和 fresh-process 读回。

所有结果均为脱敏摘要。API key、CredentialRef、Authorization、签名 URL、绝对路径和供应商原始错误页不进入 manifest、日志或 MCP 结果。

## 当前验证结果

| 项目 | 当前结果 | 证据 |
|---|---|---|
| 完整系统门禁 | PASS | `pnpm run test:system:full`：5/5；Vitest 913 files passed、1 skipped，8656 tests passed、1 skipped；React Flow canvas 14/14；J3/J5 2/2；typecheck、lint、renderer/Electron build 通过 |
| J0 安装版 MCP | PASS（本地安装包） | `tests/ux/packaged-mcp-smoke.e2e.mjs`：43 tools、25 resources；签名身份可写，未签名 generic host 写入被拒 |
| J0 无仓库 harness | PASS | `pnpm run test:model-integration:no-repo`：isolated cwd；43 tools、25 resources；unsigned write rejected；provider requests=0；credential bytes=0 |
| J3 故障矩阵 | PASS（本地自动化） | `pnpm run test:model-integration:fault-matrix`：8 个聚焦 fail-closed suite；provider requests=0 |
| J4 打包重启读回 | PASS（无花费 smoke） | `pnpm run test:model-integration:packaged`：同 session/revision 在 stop/restart 后读回；零重复 create；credential bytes=0 |
| J5 既有接入回归 | PASS | 现有 provider/catalog suites，加 `test:journeys` J3/J5 2/2 |
| 模型设置页 UI 走查 | PASS（真实 Electron） | `node tests/ux/model-onboarding.walk.mjs`：默认分层、连接页、亮色、暗色 4 张截图 |
| React Flow 批量控件 | PASS（真实 Electron） | 比例 15 档保持分段按钮；同模型多供应商逐行可选；批量生成、取消、依赖波次、失败重试、暗色模式通过 |
| J1 真实 provider 最小切片 | PASS（范围受限） | 隔离复制加密 Catalog；ModelScope 远端发现 47 个模型；选择 1 个文本模型；`chat` 1 次尝试 verified；run completed |
| J1 fresh-process 幂等 | PASS（同一最小切片） | 关闭并重启隔离 profile 后 run 仍 completed；同一 idempotency key 返回同一 run；attempts 保持 1 |

真实 provider 测试只复制加密 Catalog 到临时 profile。没有读取、输出或重新保存密钥，没有修改正式 Catalog；测试结束后临时 profile 已删除。

## 外部验收状态

### J1 HTTP 多模型

当前为 `partial`。真实 ModelScope 最小切片已经证明：保存凭据可由当前应用身份解密、远端模型发现成功、canonical certification 会发出真实模型请求、通过的 `chat` mode 能完成提交，并且 fresh-process 幂等重放不会再次执行。

这仍不等于完整 J1。尚未覆盖 BananaRouter/第二个 blind provider、完整多供应商分页、多模型/多 capability、逐 mode partial 结果和可核对的供应商账单，因此不能写成“HTTP 多模型发布验收完成”。

### J2 原生 ComfyUI

当前为 `unverified`。本地配置中存在 ComfyUI vendor 和已发布 workflow，但验收时没有运行中的原生 ComfyUI Server。mock 已覆盖 API/UI workflow 转换、显式多媒体槽、`frame_rate` number 和安全失败；不能把它升级为 `/upload/image`、`/prompt`、`/history`、`/view` 的真实 J2。

### WorkBuddy

当前为 `unverified`。generic MCP harness 已验证 tools-only/签名边界；真实 WorkBuddy 宿主未提供，不能把 generic 结果升级为真宿主证据。

### 安装包升级

stop/restart smoke 和真实 provider fresh-process readback 已通过；从旧安装包升级到候选安装包后再次执行真实生产调用尚未验证。

## 后续发布验收

- [ ] 用至少两个真实 provider 完成多模型、多 mode、分页和 partial 结果矩阵，登记真实请求数与供应商账单。
- [ ] 用原生 ComfyUI 完成 UI workflow + API workflow，两个以上不同媒体槽，重启后再次从正式入口执行。
- [ ] 用真实 WorkBuddy 宿主完成 signed MCP 工具发现、接入会话和恢复。
- [ ] 完成旧安装包到候选安装包的 upgrade + 真实生产 replay。

这些外部项不改变本 PR 已验证的安全边界；未完成前必须继续标为 `partial` / `unverified`，不得用 mock 或单模型成功替代。

脱敏模板与当前摘要见 [`evals/model-integration/manifest.template.json`](../../evals/model-integration/manifest.template.json) 和 [`evals/model-integration/local-automated-2026-08-29.json`](../../evals/model-integration/local-automated-2026-08-29.json)。
