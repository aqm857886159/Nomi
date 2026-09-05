# Nomi Convergence Handoff — 新会话直接接手

日期：2026-09-05（Asia/Shanghai）
文档性质：handoff；只提供事实、边界、证据和下一步，不代表功能已完成。
Canonical ledger：[2026-09-05-nomi-canonical-m0-m5-plan-status-ledger.md](2026-09-05-nomi-canonical-m0-m5-plan-status-ledger.md)
真实全旅程合同：[2026-09-05-nomi-canonical-real-user-journey-contract.md](../qa/2026-09-05-nomi-canonical-real-user-journey-contract.md)

## 1. 唯一目标

把 Nomi 收敛成一条真实用户可完成、可观察、可审计、可重启、可打包重复的 M0–M5 纵向闭环：真实用户从 Codex task/session 的自然中文多轮对话从零开始，经过真实 Nomi MCP 产生项目、剧本、分镜、画布、媒体、时间线和导出，最终得到真实 Provider 生成的完整可播放视频；途中所有补充、否定、改口、单镜修改、预览、审批、拒绝、分步/部分生成、重试、画布操作、剪辑、失败恢复和关闭重启续接都必须留下项目、receipt、revision 证据。

M0–M5 是这条真实全旅程里的工程毕业闸门，不是先交付“一个 MCP 项目”再另做 M0–M5。MCP 是 Codex→Nomi 的真实执行通道；MCP 全能力矩阵和完整视频用户任务是同一方案的两个互补验收层。

当前结论：`BLOCKED_ENVIRONMENT / NOT_GRADUATED`。真实 Codex host 可运行测试入口目前缺失；完整真实 Provider canary 和完整可播放视频在当前基线上尚未形成收据。禁止用 fake、静态 transcript、假用户、假视频或 CI 迎合来填空。

## 2. 正确边界：双入口，不是二选一

**必须保留双入口、同一 M0–M5 核心和同一 capability/effect owner：A) 真实用户在 Codex task/session 自然中文多轮对话 → Nomi MCP → 项目/分镜/画布/effect；B) 用户在 Nomi 内部 Agent UI 多轮操作 → Agent Host → 同一 capability/effect owner。两条入口都要独立验收，并对照同一项目、receipt、revision、restart；B 不能冒充 A 的最终 Codex 用户验收。**

| 入口 | 必须证明 | 不得替代 |
|---|---|---|
| **A：最终 Codex 用户入口** | 真实 Codex task/session、真实 MCP transport、同一 session 连续上下文、全 MCP 工具调用、真实 effect、真实媒体/Provider、approval/deny、receipt/revision、重启续接、packaged 重复 | Nomi UI、fake MCP、direct `callTool`、静态 transcript、单个 patch_shots 测试 |
| **B：内部 Agent UI/Host 入口** | 真实 UI 多轮操作、Agent Host、界面/交互、Skill/model/context、审批、分镜联动、视觉、Host receipt/revision/restart | A 的真实 Codex 用户任务；B 绿只能标 `INTERNAL_AGENT_UI_CERTIFIED` |

入口变化只能改变 transport/orchestration，不得改变 schema、capability、proposal、effect owner、项目文件、revision CAS、receipt 生命周期、幂等、撤销或 reconcile。每个 paired run 使用同一 `projectId`/项目代际，比较同一 capability/target/diff、receipt schema/operation identity、revisionBefore/After、重启读回和用户可观察结果；相同 operationId 重放必须是同一 receipt/replay，不得第二次 effect。

## 3. M0–M5 映射

| 阶段 | 架构语义 | A 用户检查点 | B 用户检查点 | 共同证据 |
|---|---|---|---|---|
| M0 | 项目、session、context、lease、owner、工具面；冷启动接入门 | 新用户从 Codex 空 task 说“想做视频”；MCP 先发现无可用模型，Agent 用人话询问一个中转站/供应商文档地址和 API key；Codex 通过受保护 MCP 参数一次性传给 Nomi，Nomi 自动读文档、识别能力、加密保存、验证并只返回掩码状态；仅在发现可用图片/视频模型后创建/绑定制作项目 | 新用户从 Nomi 空项目进入 Agent UI/Host，独立完成同一冷启动接入/验证，再创建/续接项目和 context | project/session/context identity、空态、无模型、接入成功/文档歧义/接口冲突/缺失/锁定/网络/超时/重试/重启恢复、无 secret 泄漏 |
| M1 | 分镜版本、真实目标行选择、snapshot/CAS | 创建剧本/分镜；说“只改第三镜”，MCP 选择真实第三行并显示版本/diff | UI 选择同一第三行、改口、切换版本，Host 绑定同一 target | selected row、storyboard version、未点名字段保持、旧 revision/空选择拒绝 |
| M2 | canonical proposal/effect、MCP durable idempotency | canonical `nomi_canvas_plan`/`args.operation` 等真实 MCP proposal→preview→approval→effect；重复 operationId replay | Host 生成同一 proposal/effect owner；approve/deny/undo 与 A 一致 | effect path、receipt、revision、实际项目文件、无第二次 effect |
| M3 | 同一 Codex session 的 context、Skill、model、scope 连续性 | 上传参考资料，选择/切换 Skill、模式、模型，同一 Codex session 继续追问不丢上下文 | UI/Host 独立验收 Skill/model/context 显示、切换、失败、恢复 | session/task identity、skill source/hash、model/provider identity、scope、重启 continuity |
| M4 | approval/deny、trust/provenance、receipt、no-op | Codex 内先预览后批准/拒绝；拒绝、过期、错 revision、失败、重复确认均可观察且无假写 | UI approval card、deny、撤销、trust/taint、错误态、视觉 | approval scope、deny no-op、replay、receipt/revision、真实 effect |
| M5 | project/storyboard/canvas readback、restart/reconcile、packaged | 关闭/重启后同一 Codex task 继续追问；读回并 reconcile，packaged 重复 | UI/Host 关闭重启后读回同一 paired project，packaged UI/视觉走查 | current SHA build、真实媒体、可播放导出、restart/reconcile、A/B 对照 |

## 4. 当前 main 与 PR 状态

### 4.1 精确基线

已执行：

```bash
git fetch origin main --prune
git rev-parse origin/main
git show -s --format='%H%n%P%n%cI%n%s' origin/main
git status --short --branch
```

当前基线：

```text
origin/main = 163bddf157b613bde1d8291098b8813cea2bc80b
tree        = cbb5546342ace3554e5f8008b272c84ad48f17e8
commit      = Merge pull request #481 from aqm857886159/codex/pr412-shell-debt-migration-20260905
commit time = 2026-09-05T02:05:12+08:00
```

本 handoff 所在分支：`codex/nomi-canonical-plan-status-ledger-20260905`，从该 SHA 建立；本 PR 只应包含 docs/plan、docs/qa 或测试合同文件。

### 4.2 相关 PR ledger

| PR | 状态 | base SHA | head SHA | 当前证据/阻塞 |
|---|---|---|---|---|
| #468 real user journey gates | `MERGED` | `15fdc9b8fd9af118f699f1408d54470fc4b7c4ff` | `20a146a42a263e25b42f913c9820643770b7e4ca` | 门和 blocked-live 规则已进主线；不等于 live Provider/完整视频 |
| #469 M0/M1 runtime matrix | `MERGED` | `77672dcb4b45b0ac8c29d57db7eab02e4b6b41a0` | `3c52893a27c0bde90bb16f0917b4c9ab135957c5` | 局部 M0/M1 证据已进主线；不等于完整 Host/重启毕业 |
| #470 long-video contract | `MERGED` | `15fdc9b8fd9af118f699f1408d54470fc4b7c4ff` | `fe1ecb8cf5bdb1a00c359079b17de000e663948d` | 合同/runner 已进主线；历史 live canary blocked，未证明真实视频成功 |
| #471 Agent UI design contract | `MERGED` | `3e997f2547d019b6ed6021f917074927e08cbf36` | `fad3f46fc36b3d33d20c1f740922c215583aab5f` | computable UI contract；不等于 UI 人工视觉或 A 完成 |
| #474 storyboard Skill picker | `MERGED` | `89dcd9131025cc8d5f74e5afe3432ea9eb142faf` | `8c710600dde1c7c71ca97e6e8f402735310336e1` | Skill visibility 修复已进主线；不等于 Skill/model/live/provider 全链 |
| #481 shell-debt migration | `MERGED / current main` | — | — | 当前 `origin/main` 的精确 commit，作为本 handoff 基线 |
| **#476 canvas durable receipt** | **`OPEN / MUST REWORK`** | `163bddf157b613bde1d8291098b8813cea2bc80b` | `c212093159cdcba100829cbd51f5692f43f43eb1` | 远端 Unit、E2E Walkthroughs、Quality Gate 失败；先修远端失败，再做独立审查，不能提前算 M2 green |
| **#484 Agent M0–M5 red contract** | **`OPEN / MUST CORRECT`** | `163bddf157b613bde1d8291098b8813cea2bc80b` | `acd7939b2af4aaef9ce0e11517db32118c7667c5` | Contracts、Quality Gate 失败；red contract 还需纠正真实入口、断言索引和 M0–M5 语义，再以同一命令复核 |

PR open、局部 CI green、已合入测试合同或历史截图都不能升级 M0–M5。后续每个 PR 要重新 fetch、记录 base/head/merge SHA、命令、原始证据、阻塞和下一步；不合并本 handoff PR。

## 5. 全 MCP 矩阵：A 的完整工具层

全 MCP 矩阵与全视频用户任务是两个互补层。矩阵分母来自真实 Codex→Nomi MCP `tools/list`，动态校验 name、顺序、schema、annotations；当前 main 历史审计记录 24 项，不能手填旧数量。每个工具必须分别留下 Happy/Boundary/Error/Timeout/Network：

- read 工具：真实 Codex `tools/call` 读到真实 target、schema、身份和 revision，无写副作用；本地能力必须证明网络 request count 为 0。
- write 工具：隔离项目真实 approval/deny、真实 effect、幂等 replay、receipt、revision、项目文件、关闭重启、失败恢复；不得把 plan 或卡片出现写成 effect。
- 所有失败必须用户可观察、结构化、可恢复或明确 blocked；不得假成功、静默 catch 或第二套 owner。

当前外部 MCP 目录：

| # | tool | capability / owner |
|---:|---|---|
| 1 | `nomi_session_open` | project session / lease |
| 2 | `nomi_read` | project/canvas/model/run/artifact/integration read projection |
| 3 | `nomi_canvas_edit` | `canvas.write` semantic edit |
| 4 | `nomi_asset_import` | `asset.import` |
| 5 | `nomi_operation_plan` | generation plan/create/patch |
| 6 | `nomi_operation_preview` | generation preview |
| 7 | `nomi_operation_gate` | generation gate / approval receipt |
| 8 | `nomi_operation_execute` | approved generation submit |
| 9 | `nomi_operation_control` | cancel/reconcile generation |
| 10 | `nomi_run_start` | durable `production.start` |
| 11 | `nomi_run_control` | pause/resume/cancel/set_trust |
| 12 | `nomi_artifact_review` | artifact review/revise/CAS |
| 13 | `nomi_run_gate` | creative gate/storyboard materialize |
| 14 | `nomi_integration` | integration begin/preflight/credential/declare/get |
| 15 | `nomi_integration_manage` | integration vendor/session mutation |
| 16 | `nomi_project_create` | `project.create` |
| 17 | `nomi_canvas_plan` | canonical `canvas.write` semantic plan |
| 18 | `nomi_canvas_maintenance` | canvas delete/destructive undo |
| 19 | `nomi_document_read` | `document.read` |
| 20 | `nomi_document_edit` | `document.write` proposal |
| 21 | `nomi_timeline_read` | `timeline.read` |
| 22 | `nomi_timeline_edit` | `timeline.write` preview/apply/undo |
| 23 | `nomi_export_job` | `export.read`; start/cancel remains Host-only |
| 24 | `nomi_media_query` | media metadata/source/waveform read |

`nomi_canvas_plan` + `args.operation=patch_shots` 只是一行，不是全 MCP 验收。辅助 `mcp-l1-handshake`、`mcp-l2-journeys`、`test:mcp-elicitation`、unit/integration、fake/loopback、direct `callTool` 和静态 transcript 只能证明各自范围，不能冒充 A 的全工具或最终用户完成。

真实 Codex host runner 当前缺失，状态固定为 `BLOCKED_ENVIRONMENT`。不得用下面的占位伪造成功：

```bash
<REAL_CODEX_HOST_MCP_ALL_TOOLS_RUNNER> --project-root <isolated-project> --evidence <dir>
```

只有环境 owner 提供真实 Codex task/session runner 后，才可按 tools/list 动态全量执行，并记录每个工具的 H/B/E/T/N、request count、effect、receipt、revision、persistence/restart 和 packaged 状态。

## 6. 真实全视频用户任务

### 6.1 从零到可播放导出

A 必须由真实用户在真实 Codex task/session 现场多轮完成，下面是任务检查点而非可预录 transcript：

1. 从空 task 说“从零做一支完整短片”；MCP 先发现无可用模型，Agent 不给按钮、工具名或 M0–M5 提示，而是用人话询问中转站地址。用户最多提供一个中转站/供应商文档地址和 API key，不要求用户提供模型名、modelId、能力列表、参数或路由；只有文档缺失、歧义或接口冲突时，才用人话询问最少必要问题并给选项。
2. Codex/Agent 通过 Nomi MCP 自动读取文档，识别认证、图片/视频模型与能力，建立目录和路由，并用受保护参数/一次性传输把 secret 交给 Nomi；Nomi 加密存储，用 key 做受控连通性/能力验证，只返回已接入能力和掩码状态。覆盖接入成功、文档/地址/能力错误、缺失/锁定 key、图片模型误用于视频、网络/超时、重试和关闭重启恢复；只有验证出可用图片/视频模型后才进入制作。
3. 创作剧本和分镜版本；上传真实参考图片/视频/文档；选择 Skill、切换 Skill；调整模式；选择已接入模型、切换到另一套当前目录中已有且可用的模型。正常模型调用/切换是全旅程必经步骤，不是新增产品范围。
4. 让 Agent 补充、否定、改口；先预览 proposal；拒绝一次，验证项目/revision 不变；重新提出并批准。
5. 说“只改第三镜，其他不要动”；真实选择第三行，验证 diff 和未点名字段保持；继续单镜微调、撤销和重做/重试。
6. 分步/部分生成，走空态、草稿、loading；在受控 Provider/transport 边界经历失败、timeout、network error，看到错误、取消/恢复/重试，不能产生假成功。
7. 真实画布编排和节点操作：选择、移动、连接、分组、删除、撤销；生成真实图片和真实视频媒体，验证可加载 source、尺寸、时长、项目引用。
8. 使用当前范围内的剪辑工具改片段/顺序/时间线/音视频或字幕；预览完整作品，继续用 Codex 多轮微调。
9. 通过真实 approval/trust boundary 导出真实可播放视频；用播放器/`ffprobe` 验证文件、编码、时长和可打开性，项目/receipt/revision 与结果一致。
10. 关闭 Nomi，重新打开同一项目并继续同一 Codex task；读回 project/storyboard/canvas/timeline/media/receipt/revision，reconcile 未完成操作，不重复提交或扣费。
11. 用当前 SHA 新构建 packaged app 重复关键 A 路径；再在同一 paired project 做 B 内部 UI/Host 对照和视觉走查。

### 6.2 全状态证据

空态、草稿、加载、成功、失败、超时、网络、撤销、恢复每一项都要有用户可观察结果，以及项目/receipt/revision 证据。故障可在 transport/provider adapter 边界做确定性注入，但最终成功视频、图片、导出必须是真实 Provider/真实媒体；不得用 fake video、假用户、预置状态、旧二进制或静态 transcript。

未知用户问题发现流程是每个阶段的硬门，不只修当前已知摩擦：Fresh user 从无项目、无模型、仅有中转站信息开始；只给真实目标和必要素材，不提供按钮、工具名或 M0–M5 提示。观察并记录用户意图、看见的内容、下一步是否可理解、停顿/回退/改口、技术词、跳转 Nomi、坏预览、上下文丢失、工作丢失和放弃点。把未知行为分类到产品逻辑、Agent 理解、MCP 契约、UI、模型中转、持久化或测试基础设施；每项都建立红测→修复→同任务无提示真实用户任务重跑→绿证。A 与 B 都必须独立进行“无提示真实用户任务走查”，该走查只用于发现用户行为和可发现性问题，并用同项目、receipt、revision、restart 对照；已知摩擦只是起始样本，不是发现流程的上限。

视觉验收必须同时具备：已确认的设计稿/视觉合同、真实 Electron 与 packaged 截图、DOM/计算样式/几何与 design token 对照、overlay/diff，以及人工视觉确认；静态图、旧截图或单独的机器断言不能替代视觉通过。

敏感凭据边界固定为：真实用户可以直接在 Codex 提供中转站文档地址和 API key；Codex 接收 secret，经 MCP 受保护参数/一次性传输交给 Nomi；Nomi 加密存储并验证；assistant 回答、MCP tool result、日志、receipt、截图、测试报告和 Git 只返回/保存掩码状态，绝不回显或持久化明文 key。接入成功后的发现/生成，以及错误、缺失、锁定 key、图片模型误用于视频、网络、超时和重试，都必须同时验证不泄露。

### 6.3 模型接入专项验收（已有产品能力，不新增产品范围）

这里的“模型接入”不是新增产品范围，也不是要求用户填写模型名、modelId、能力列表、参数或路由。定义固定为：外部用户最多提供一个自建中转站/供应商文档地址和 API key，通过 MCP 接入 Nomi；Codex/Agent 自动读取文档，识别认证、图片/视频模型与能力，建立目录和路由，之后可以发现、选择和调用已接入能力。只有文档缺失、歧义或接口冲突，才询问最少必要问题并给选项。完整视频中的正常模型调用/切换是该既有能力在真实用户任务中的必经验证。

已合入、但仍必须在真实 Codex→Nomi MCP 全旅程复验的实现线索：

| PR | merge SHA | 已合入内容 | 代表性文件/证据 | 当前结论 |
|---|---|---|---|---|
| #221 | `69fce09ed636542edb178d89c10abc4ee9e22a4a` | 对话式模型接入边界 | `docs/guide/conversational-model-integration.md`；`docs/handoff/2026-08-28-conversational-model-integration-handoff.md`；`electron/capabilityCore/{appIntegration,dispatcher,mcpStdioServer,rpcServer,mcpIntegrationTools}.ts`；`electron/ai/onboarding/*`；`electron/catalog/*` | 已合入基础；待真实 A 全旅程复验 |
| #282 | `6a0c3ca26b819faa297db677a4dbaa26ecd5ea68` | per-connection provider proxy / onboarding | `electron/providerNetwork.ts`；`electron/providerAdapter/*`；`electron/ai/onboarding/*`；`src/ui/onboarding/*` | 已合入基础；待真实 A 全旅程复验 |
| #416 | `beeb3bbba210992e1077b9de9d2aa2d4fa0d9057` | 自建中转接入四连环与统一验证/反馈回路 | `docs/plan/2026-09-03-self-hosted-relay-conformance-harness.md`；`electron/providerAdapter/relayConformance*`；`electron/catalog/multipartOperation*` | 已合入基础；待真实 A 全旅程复验 |
| #431 | `b12fdee591e0b44860b55414bf7ac542f94e0969` | 自建中转视频/音频真实验收覆盖 | `docs/research/2026-09-03-self-hosted-relay-coverage-matrix.md`；`electron/providerAdapter/relayConformanceVideoAudio.integration.test.ts` 等 | 已合入专项测试；待真实 A 全旅程复验 |
| #446 | `45912ae01a155a3f6592f65368d0ce3d12fc034e` | relay + catalog 能力对齐 | `electron/catalog/*`；`electron/providerAdapter/relayConformanceVideoAudio.integration.test.ts`；`electron/shared/videoCapabilities/*` | 已合入对齐修复；待真实 A 全旅程复验 |
| #241 | `47dd0af10a701dc62cf83cabd19e50306b5e89b9` | provider expansion / model catalog 扩展基础 | `docs/plan/2026-08-30-provider-model-expansion-and-runtime.md`；`docs/plan/2026-08-30-unified-model-integration-certification.md`；`docs/integration-certification/model-certification-ledger.json`；`electron/catalog/*` | 仅 catalog/provider 基础；不作为独立模型验收范围，不新增范围 |

专项复验顺序是：新用户在 Codex 直接提供文档地址和 key → MCP 受保护接收/一次性传输 → Nomi 自动读取文档、识别认证/图片/视频能力并加密保存/验证 → 仅返回已接入能力和掩码状态 → 发现可用图片/视频模型 → 真实生成和正常模型切换 → 项目/receipt/revision/restart 对账。缺失/锁定 key、错误文档/地址/能力、图片模型误用于视频、网络/超时/重试都必须用户可见、fail-closed、按需证明 0 request，并完成 secret scan；敏感 key 不进入回答、tool result、日志、receipt、截图、测试报告或 Git。TikHub/APIMart 的具体连接器、视频拆解和商业/额度扩展仍是 post-M5 队列，不扩展本次范围。

## 7. 已知证据和阻塞

| 项目 | 当前事实 | 状态 | 下一动作 |
|---|---|---|---|
| #476 | 远端失败，未独立审查 | `BLOCKED / MUST REWORK` | 修远端失败→刷新 SHA/checks→独立审查→再进入 M2 |
| #484 | red contract 的真实入口/索引/语义需纠正；Contracts/Quality Gate 失败 | `RED_CAPTURED / MUST CORRECT` | 修合同语义而非放宽断言→同一 red/green 命令重跑 |
| 新版分镜编辑器 | 代码已有；新建空项目 runner 前置条件不对 | `BLOCKED_PRODUCT/TEST_INFRASTRUCTURE` | 从空项目修最小前置条件并重跑；不能预置项目 |
| 分镜设计初版 | 初版存在但未确认；旧锚行/参数条方向已否定 | `WAITING_DECISION` | Prompt Brief→新样张/image2→确认→design contract；确认前不做新视觉实现 |
| 真实 Codex host | 可运行的真实 Codex task/session 测试入口当前缺失 | `BLOCKED_ENVIRONMENT` | 环境 owner 提供真实 runner；禁止 fake runner/direct callTool/静态 transcript |
| MCP confirmation | confirmation chain 有 hardcoded `in_nomi` | `BLOCKED_PRODUCT` | 统一客户端/入口/Host confirmation identity；A/B 共同核对 approval/deny/receipt/no-op |
| thumbnail | 私有 thumbnail URL 可能不可加载 | `BLOCKED_PRODUCT` | 用真实可加载 source/asset evidence；不可加载必须显示失败，不能写成功 |
| locale | MCP/Agent/分镜链 locale 混杂 | `BLOCKED_PRODUCT` | 固定 i18n source/locale contract，逐态跑 A/B 和 packaged 视觉 |
| 当前 live Nomi 项目/运行 | 只能作为现有环境的只读、不花额度探针 | `PROBE_ONLY` | 只读 project/storyboard/canvas/status/receipt/revision；不得 start/execute/retry、访问或记录 key、调用 Provider/TikHub/APIMart |

live probe 的任何结果都不能升级 A、B、全 MCP、全视频或 M0–M5 状态；probe 只用于确认当前项目/运行/receipt 的可读性和不花额度边界。

## 8. 固定状态生命周期

每个 M 阶段、工具、能力和 PR 固定走：

```text
未开始
→ 红测已捕获
→ 实现中
→ 绿测
→ 真实 Codex 用户任务
→ 持久化/重启
→ 视觉走查
→ packaged
→ 合入 main
```

每一格必须记录：`featureId/stage/entry/pairedRunId`、base/head/merge SHA、完整命令和 exit code、原始 stdout/stderr/JSONL/截图、H/B/E/T/N、effect path、project/revision、operation/receipt、persistence/restart/reconcile、provider/model/keyStatus/request count、visual/package、blocker、owner、next step。缺证据就写 `NOT_STARTED`、`BLOCKED_ENVIRONMENT` 或 `WAITING_DECISION`，不写“差不多完成”。

## 9. 新会话严格下一步

新会话按以下顺序执行，不跳步、不并行制造第二条主线：

1. 在干净独立 worktree `fetch origin main --prune`，记录新的精确 `origin/main` SHA/tree、branch、dirty 状态；确认没有生产改动混入。
2. 先处理 #476 的远端失败并安排独立审查；同时纠正 #484 的入口、索引和 M0–M5 语义。两者未收口前，不把它们的局部 green 当阶段 green。
3. 修复/验证新版分镜编辑器从“新建空项目”启动的 runner 前置条件；单独记录设计初版仍未确认，不实现被否定视觉。
4. 建立真实 Codex host runner；若环境仍缺失，保持 `BLOCKED_ENVIRONMENT`，只完成不花额度的合同/阻断验证，不伪造 A。
5. 以真实 Codex `tools/list` 动态目录建立全 MCP matrix，逐工具 H/B/E/T/N；读工具真实返回，写工具隔离项目验证 approval/deny、幂等、receipt、revision、持久化/重启、失败恢复；不能只跑 patch_shots。
6. 按既有模型接入能力复验冷启动路径：真实用户在 Codex 最多提供一个中转站/供应商文档地址和 API key，MCP 受保护接收并一次性传输，Nomi 自动读取文档、识别认证/图片/视频能力、加密保存/验证且只返回掩码状态；覆盖接入成功、文档/地址/能力错误、缺失/锁定 key、图片模型误用于视频、网络/超时/重试和重启恢复。不要新增模型或扩展接入范围；全视频只选一套已接入且 preflight/预算通过的模型完成真实调用与切换。
7. 在同一真实 Codex task 完成全视频任务：剧本/分镜、上传、Skill/模式/model 切换、Agent 多轮改稿/单镜/预览/审批/拒绝/分步/部分/重试、画布、图片/视频、剪辑、预览、导出、失败恢复、重启续接；保存真实可播放视频。
8. 对同一 project/receipt/revision/restart 执行 B 内部 Agent UI/Host paired comparison，补界面/交互/视觉证据；B 不回填 A。
9. 当前 SHA 重新 build/package，重复关键 A/B 读回和视觉；所有阶段/PR 收据完整后才允许 PR 合入 main。

## 10. 禁止重做和禁止误报

- 不重做已经在 main 的 M0 文档、MCP catalog、Skill visibility、真实用户合同或 computable UI contract；先读本 handoff 与 canonical ledger，缺口才新开 scoped PR。
- 不整体 cherry-pick #476/#484 或旧 stacked/冲突 PR；先 patch/file compare、修失败、独立 review，再决定唯一 owner。
- 不把 `nomi_canvas_plan/patch_shots`、MCP `tools/list`、unit/integration、L1/L2、fake/loopback、direct `callTool`、Nomi 内 Agent UI、静态 transcript、旧截图、旧 packaged、按钮点击或 CI 单 job 当作 A 完成。
- 不把 B 内部 Agent UI/Host 成功写成真实 Codex 用户成功；两入口必须分别标记并做 paired comparison。
- 不把当前 live Nomi 项目/运行用于生成、重试、付费、Provider/TikHub/APIMart 请求；它们只做不花额度的只读探针，不记录密钥。
- 允许真实用户直接在 Codex 提供中转站文档地址和 API key，但必须走“Codex 接收 secret → MCP 受保护参数/一次性传输 → Nomi 加密存储并验证 → 仅返回掩码状态”；不得在 assistant 回答、MCP tool result、日志、receipt、截图、测试报告或 Git 中回显/持久化明文 key。缺 key/locked 必须用户可见阻断并按能力证明 0 request。
- 不用假视频、假媒体、假用户、预置项目、扩大 timeout、宽 selector、改名、换 fixture、`|| true`、`--passWithNoTests` 或静默 `SKIP` 让红灯消失。
- 不在真实 Provider canary 前跳过 contract/sample/预算 preflight；不把 TikHub/APIMart 后置扩展当作 M0–M5 现成证据。
- 不在项目、receipt、revision、restart、视觉、packaged 或真实可播放导出证据缺失时写“已毕业”“已解决”“全 MCP 完成”或“全旅程通过”。
