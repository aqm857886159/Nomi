# PR #854 与后续发版方案（已确认）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

日期：2026-09-24  
范围：`codex/rc-batch-evidence-20260924` / PR #854 及其合入后的 RC，不扩大到新的产品功能。

已确认决策：版本 `0.22.0`；MCP C9b 重复红则另开 blocker PR；RC 使用 exact merged SHA；Unit 按 required check 等到终态或仓库明确 timeout。

## 先查别人

本方案先对照了仓库已有的批量门岗和分层规则，详见 [`docs/research/2026-09-24-release-efficiency/prior-art.md`](../research/2026-09-24-release-efficiency/prior-art.md)。结论是复用 `run-gates-contracts`、Quality Gate 的 `continue-on-error` + 末尾汇总、`validation-policy` 的风险分档和 workflow 结构门禁；只为桌面 RC 增加五条旅程的 timeout/summary/artifact 约束，不引入第二套编排器。外部 TikHub 未查，因为本次是内部 CI/发布流程问题，不是产品市场调研。

- 仓库已有「全部跑完再汇总」实现：`scripts/run-gates-contracts.mjs:3-12,104-161`。
- 仓库已有 workflow 的 `continue-on-error`、末尾 outcome 汇总和 fail-closed 判定：`.github/workflows/quality-gate.yml:171-220`。
- 仓库已有验证基础设施改动必须走 full unit/desktop/journeys/canvas 分档：`scripts/validation-policy.mjs:30-57`；外层 step timeout 使用 GitHub 官方 workflow 语法：<https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax>。

## 现状事实

- PR #854 提交 `52aad196a`，内容是 release-critical 验收的批量收集、Clip 走查判据修正、流程文档和门禁；没有生产功能改动。
- 本地 Clip 真实 Electron 走查全绿；本地 `pnpm run gates`、构建、Ponytail 均通过。
- PR CI run `35895869030` 已取消。取消前已确认：Core Flow Smoke empty/used、Mac Package、Canvas Acceptance 两条、真实用户旅程和 Golden Path 通过；E2E 汇总明确收集到唯一红项 MCP C9b `started=false`；Contracts 首次红因 PR 正文漏引用 recurring 根因合同，正文已补齐。以上只是诊断证据，不能替代当前 head 的新 required-check 结果。
- 当前不能把 PR 叫作可合入或可发版：需要在当前正文状态下重新拿到 required checks 结果，并处理 MCP C9b 的真实/偶发分类。

### 证据状态表（旧 run 仅作诊断）

| 证据 | source/run | 结果 | 是否可直接放行 |
|---|---|---|---|
| PR Contracts | run `35895869030` / job `Contracts` | fail：旧正文漏引用根因合同；正文已补 | 否，需当前 head 重跑 |
| E2E Walkthroughs | run `35895869030` / job `E2E Walkthroughs (Linux)` / step `mcp-journey` / C9b | fail：`started=false`；其余该 job 旅程通过 | 否，需重跑并分类 |
| Unit | run `35895869030` / job `Unit` | 人工取消前未终态 | 否，不能用 focused 替代 |
| Core Flow / Canvas / Mac | run `35895869030` | 多项 success | 仅作诊断，不能与当前 head 的失败项拼成绿 |
| Merged SHA receipt | 尚未产生 | pending | 必须在合入后生成 |
| Desktop RC | 尚未运行 | pending | 必须在 exact merged SHA 上生成 |
| Desktop release | 尚未运行 | pending | 仅 RC 全绿后允许 |

## 目标与不变项

目标是用最短可审计路径完成：PR required checks → 合入 → exact merged SHA 收据 → desktop RC 全部 release-critical 旅程 → 发版。  
不做：不把 PR #854 扩成用户功能改版；不修改 `main`；不把本地绿、重试或旧 SHA 当作合入证据。

## 推荐执行路径

### A. 重新取得有界 CI 证据

1. 以 PR #854 当前正文和当前 head 为准重新取得 required checks；旧 run 的通过项只作诊断，不作放行证据。
2. Contracts 先复跑，确认根因合同路径已被 `check:door-map --pr` 读取；若 GitHub 不能只重跑取消的 Unit，则接受一次完整 Quality Gate，不手工拼接结果。
3. E2E 只复跑一次；如果 MCP C9b 通过，记录为环境波动；如果仍然 `started=false`，保留完整报告并把它单独升级为发版阻断。
4. Unit full lane 因本次改动属于 `validation_infrastructure`，不能用 focused 测试替代，也不设未经验证的 15 分钟硬切；等待到 job 的终态或仓库已配置的明确 timeout。手动取消、runner 无进展和测试失败分别记录，不能混成通过。

### B. 处理 MCP C9b

- 只在复跑仍红时做根因复现：读取 `mcp-l2-journeys.e2e.mjs` 的 C9b 证据，区分“真实业务拒绝”“测试数据/时序问题”“Linux runner 资源问题”。
- 若根因不在 PR #854 的改动面，另开一个小范围 blocker 修复 PR；PR #854 保持流程固化的单一职责。
- 若证明是本次 workflow 拆分造成的回归，才在 PR #854 修复并重新跑变更相关证据。

### C. 合入与发版

1. 只有 required checks 全绿才合入 PR #854。
2. 合入后立即 `delivery:verify-merged -- --expected-sha <merge-sha>`，保存 exact SHA 收据。
3. 以已确认的 `0.22.0` 为目标；在 PR #854 合入后的 exact SHA 上另开版本号与 release notes 变更，形成新的 release candidate source SHA。以该 SHA 运行 desktop RC，workflow `version` 使用 `0.22.0`；不跟随漂移的 `main`。新工作流必须先完成 Clip、Production MCP、MCP suite、elicitation、canvas performance 五条串行旅程，再由 summary 一次判定并上传证据；每条旅程必须有明确 timeout，防止 hang 阻塞后续证据。
4. RC 全绿后，以 `rc_run_id` + `v0.22.0` tag dispatch desktop release；任一真实阻断则停在 RC，不发包。
5. 发版后按 `docs/release-process.md` 做直链验收：latest tag、三个安装包直链、官网下载/app update URL、latest yml 必须返回非 HTML；同时保留打包 sandbox `active:true` 证据和 production-release reviewer/结果。

## 核心取舍（需要确认）

| 取舍 | 推荐 | 代价 |
|---|---|---|
| PR #854 是否继续承载 MCP C9b 修复 | 分离：#854 只交付批量 RC 流程；C9b 重复红则另开 blocker PR | 可能多一个 PR，但避免流程改动和业务修复互相污染 |
| Unit full lane 长时间无结果怎么办 | 按 job 的终态/明确 timeout 处理；不以未经验证的时间阈值代替 required check | 可能需要等待一次完整 Quality Gate，但不能拼接旧结果 |
| 是否把用户体验改动塞进本轮 | 不塞；另起产品 PR | 本轮没有直接用户可见变化 |
| 发版版本 | `0.22.0`（已确认） | 在 PR #854 合入后另开版本/notes 变更，RC `version` 与 release tag 必须一致 |
| RC 使用的 ref | exact merged SHA（推荐） | 需要额外记录 SHA，避免 `main` 在 RC 期间漂移 |

## 验收门

- PR：required checks 全绿，PR 正文含根因合同路径和 Ponytail 结论。
- 合入：exact merged SHA 收据存在，Core Flow Smoke empty/used success。
- RC：exact merged SHA 上五条 release-critical 旅程全部有 outcome；每条有 timeout；未知/失败/取消均阻断；证据制品可下载。
- 发版：新版本 tag 的 RC 全绿后才允许 dispatch release workflow；否则报告 BLOCKED 和完整证据链接。
- 发布后：latest tag、三个安装包、官网/app update URL、latest yml、sandbox active:true 和 reviewer 结果全部有直链/原始证据。
