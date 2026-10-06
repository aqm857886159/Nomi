# 分镜方案真实 Playwright/Chromium 验收审计（2026-10-05）

## 结论先行

本轮使用真实 Nomi Electron 窗口（Playwright + Chromium）完成了现有分镜入口、计划生命周期、画幅/模型策略、首帧与部分恢复路径的首轮走查。**没有修改任何产品代码，也没有合并或发布。**已有用户改动保持原样；本文件是本轮唯一新增的审计交付物。

首批阻塞集中在三类边界：

1. 多个旧 walk 仍要求已经移除的入口或 data attribute，导致真实 UI 尚未进入参考图、@ 引用和生成确认断言。
2. 分镜表格执行态出现实际不一致：一镜 `waiting-refs` 被观测为 `ready`，另一镜的参考变更标记没有落到行上。
3. 画布表格双击、进行中/排队镜头选取和刷新恢复没有走到目标 DOM；现有触点断言在失败前退出，不能把这些路径记为通过。

## 运行身份与边界

- 工作目录：`/Users/aoqimin/Documents/Codex/2026-10-03/task/nomi-qr`
- 分支：`codex/refresh-wechat-qr-20261009`
- HEAD：`03f7d224975c6110bb4284f961f25e65bc630fdd`
- 工作树：开始审计前已有 14 个修改文件与 2 个未跟踪文件；本轮未触碰、未回滚、未重排这些改动。
- 运行方式：项目自己的 `tests/ux/_launchApp.mjs`，启动真实 Electron/Chromium 窗口；真实 UI 输入、点击、重启和页面截图；没有通过 store 注入替代用户动作。
- 证据：测试输出 JSON/日志、截图、feel 记录，以及一次 Playwright trace。trace：`/tmp/nomi-audit-storyboard-trace.zip`（约 3.1 MB）；配套截图：`/tmp/nomi-audit-trace-after-input.png`。
- 本轮目标是验收审计，不是修复。失败项保留为可复现的第一批清单，待下一轮根因修复后重跑。

### 任务初始化与门岗

- `pnpm run intake:radar`：失败，拿不到 Cloudflare 凭据且 `wrangler whoami` 超时；因此不能声称“没有新反馈”。
- `pnpm run radar:models`：失败，tsx pipe 报 `listen EPERM`；因此不能声称“没有新模型”。
- `pnpm run delivery:preflight`：失败，git fetch 无法写入 `.git/FETCH_HEAD`（`Operation not permitted`）。
- `pnpm build`：被 `check:electron-install` 阻塞。当前 `node_modules` 是指向 `/Users/aoqimin/Desktop/Nomi/node_modules` 的共享 symlink，声明/安装 Electron 为 43.4.1，但运行时检查缺失。
- 为获得当前 UI 产物，已在不改产品代码的前提下单独运行 `pnpm run build:renderer` 与 `pnpm run build:electron`，两者成功；忽略的 build stamp 记录了当前 dirty tree。
- `pnpm run check:real-media-fixture`：通过 14 项检查。登记的真实媒体存在，但 `walkthrough-real-media` 与本轮 J4/J5 仍带到期日 `2026-10-14` 的债务：参考图生成与编辑/导出需用登记素材并记录冷开时间。

## 真实走查证据

状态含义：`通过` 表示该 walk 的断言闭环完成；`失败` 表示真实断言已经失败；`阻塞` 表示在目标断言前无法到达入口或目标 DOM；`弱通过` 表示脚本退出 0，但其日志暴露了未被硬断言的失败条件。

| 走查 | 真实输入 → 观测状态 → 输出 | 状态 | 证据 |
|---|---|---|---|
| `core-a-blank-storyboard.e2e.mjs` | UI 新建空白项目 → 创建区文档/计划、选择、落画布、重启冷恢复 → 四个计划恢复 | 通过 | `/tmp/nomi-audit-blank`；`artifacts/feel/blank-storyboard-486db641-4f0b-40dd-8f0a-00b082bc1d78` |
| `core-a-storyboard-undo.e2e.mjs` | 真实编辑/删除 → undo/redo → 冷重开并切 English → 文档与计划保留 | 通过（4 checks） | `/tmp/nomi-audit-undo`；`artifacts/feel/ir02-storyboard-undo-0c61bd9c-cfd8-4d6a-87e4-cac0065f79ca` |
| `core-a-creation-plans.e2e.mjs` | 创建、命名、文档归属、侧栏切换、落画布、冷恢复 → 计划身份和模型/runner 输出保留 | 通过（18 checks） | `tests/ux/shots/core-a-creation-plans`；`artifacts/feel/core-a-creation-plans-0f8fbcb7-...` |
| `storyboard-film-aspect-passthrough.walk.mjs` | 批量条选择 9:16 → 行/画布投影 → 出站请求 | 通过 | `/tmp/nomi-audit-aspect`；`artifacts/feel/storyboard-film-aspect-9ddd21ea-5b2f-490e-bc62-372c5068293c` |
| `storyboard-model-same-name.walk.mjs` | 相同显示名模型分别从镜头卡、批量条、锚行选择 → vendor 出站报文 | 通过 | `tests/ux/shots/storyboard-model-same-name/zh-CN`；`artifacts/feel/storyboard-model-same-name-zh-CN-e8454632-...` |
| `storyboard-strategy-resolve.walk.mjs` | 真实模型目录 → 策略面板 → split/merge 建议 → 采用 split → 重新检查 | 通过（5 screenshots） | `/tmp/nomi-audit-strategy`；`artifacts/feel/storyboard-strategy-resolve-82f59def-...` |
| `storyboard-strategy-no-model.walk.mjs` | 禁用全部视频模型 → 冷重启 → 无模型状态/设置 CTA | 通过 | `/tmp/nomi-audit-strategy-no-model`；`artifacts/feel/storyboard-strategy-no-model-bb2c1bd9-...` |
| `storyboard-first-frame-false-alarms.walk.mjs` | 首帧模型/时长门槛 → 首帧附加 → 批量执行 → 真生成后复核 | 通过（zh-CN） | `tests/ux/shots/storyboard-first-frame-false-alarms/zh-CN`；`artifacts/feel/storyboard-first-frame-false-alarms-zh-CN-a71b99c3-...` |
| `storyboard-narrow-row.walk.mjs` | zh/en、窄/宽、参考槽展开/收起、真实文本 | 通过 | `/tmp/nomi-audit-narrow`；含 row/ref/prompt/overflow 指标 |
| `storyboard-reference-slots.walk.mjs` | 进入项目 → 选择侧栏计划 → 旧 walk 点击“打开分镜/再次编辑” | 失败/入口过时 | `/tmp/nomi-audit-refslots/99-failure.png` |
| `storyboard-table-exec.walk.mjs` | 执行计划 → 读取镜头状态和参考变更 badge | 失败 | `/tmp/nomi-audit-exec/99-failure.png`；`artifacts/feel/storyboard-table-exec-ed6b975d-d1f7-4e7c-8690-cea0045f7e88` |
| `agent-storyboard-generate-confirm.walk.mjs` | 能力边界写入设计 → 请求生成确认 | 阻塞/测试契约过时 | `artifacts/feel/pi-storyboard-generate-confirm-8183c5e2-...` |
| `storyboard-anchor-policy.walk.mjs` | 打开编辑器 → 检查锚卡消费提示 → 选择模型/参考 | 阻塞/旧 data attribute | `artifacts/feel/storyboard-anchor-policy-be7dccd7-...` |
| `storyboard-table-phasec.walk.mjs` | 输入 `@` → 读取当前/相邻镜头引用组 → 添加/移除 capsule | 阻塞/@ picker 未出现目标组 | `/tmp/nomi-audit-phasec/00-skeleton-menu.png`、`99-failure.png` |
| `shot-table-storyboard-projection.walk.mjs` | UI 输入脚本 → 真实模型规划 → 表格生成 → 双击画布表格镜头 | 阻塞/未到 full-page rows | `tests/ux/shots/shot-table-storyboard-projection`；`artifacts/feel/shot-table-storyboard-projection-0759deeb-...` |
| `agent-inflight-shots-reload.walk.mjs` | 进入生成中画布 → 选取进行中镜头 → 刷新恢复 | 阻塞/未命中真实节点 | `artifacts/feel/pi-inflight-shots-reload-d87e4ec9-...`；`.tmp/pi-inflight-.../FAIL.png` |
| `agent-queued-shot-not-regenerable.walk.mjs` | 启动多镜头队列 → 选取第二镜 → 验证排队镜头不可重复生成 | 阻塞/未找到 queued 节点 | `artifacts/feel/pi-queued-shot-not-regenerable-5683cef5-...`；`.tmp/pi-queued-.../01..06` |
| `storyboard-trigger.walk.mjs` | 输入“把这个故事整成一段段画面” → 观察动作卡/Run → 点击后进入规划师 | 弱通过（脚本 exit 0） | 日志写明 `cardShown=false`、`run button count: 0`、`launched=true`；`artifacts/feel/storyboard-trigger-95a51660-...` |
| 自定义 trace walk | 新建空白项目 → contenteditable 真实输入 → 截图并停止 tracing | 通过（证据捕获） | `/tmp/nomi-audit-storyboard-trace.zip`、`/tmp/nomi-audit-trace-after-input.png` |

## 首批失败清单（真实 file:line）

### SB-F01：参考图走查被旧入口选择器拦住

- 真实影响：用户侧栏选中计划后直接打开编辑器；旧 walk 仍等待“打开分镜/再次编辑”按钮，参考图添加、移除、预览和后续状态机完全没有被验证。
- 证据：`storyboard-reference-slots.walk.mjs` 在 `tests/ux/storyboard-reference-slots.walk.mjs:104-107` 使用 `getByRole('button', { name: /打开分镜|再次编辑/ })`；运行在 `/tmp/nomi-audit-refslots/99-failure.png` 失败。
- 边界判断：这是验收入口契约过时，不能直接归因产品按钮消失为回归。下一轮先按当前侧栏直达行为修 walk，再重跑完整参考槽路径。

### SB-F02：执行态派生与参考变更 badge 不一致

- 真实影响：同一执行计划中，第二镜期望等待参考图却显示 `ready`；第八镜已有参考变更，但行上未出现“已变更”标记，用户无法判断哪些镜头能生成、哪些参考图已失效。
- 证据：`tests/ux/storyboard-table-exec.walk.mjs:154-164`；截图 `/tmp/nomi-audit-exec/99-failure.png`。
- 相关生产边界：`src/workbench/creation/storyboard/shotRow/StoryboardShotFrame.tsx:130-136` 仅在 `exec.changedRefs.length > 0` 时渲染 `data-storyboard-ref-changed="true"`；需检查 exec hydration/derive 的共享入口，而不是在行上补一个显示层判断。
- 状态：真实失败，待根因审计；本轮不改代码。

### SB-F03：生成确认 walk 漏传 initiator

- 真实影响：生成确认状态机尚未开始就被能力边界拒绝，剩余生成/跟进方案/视频生成状态无法取得证据。
- 证据：`tests/ux/agent-storyboard-generate-confirm.walk.mjs:62-66` 调用 `__nomiCapabilityApply('storyboard.upsert-design', ...)` 时未传 `initiator`，真实报错 `storyboard_initiator_required`。
- 生产契约：`src/workbench/creation/storyboard/agentStoryboardDesign.ts:30-33` 明确要求 `initiator` 为 `user` 或 `agent`。
- 边界判断：优先修验收 harness 的契约输入并重跑；不能把这次 harness 失败写成产品生成状态机通过或回归。

### SB-F04：@ 引用 picker 未出现 current 组

- 真实影响：自动引用、跨镜头引用、capsule 添加/移除及引用预览没有进入真实断言。
- 证据：`tests/ux/storyboard-table-phasec.walk.mjs:111-117` 在输入 `@` 后等待 `[data-mention-group="current"]`，`/tmp/nomi-audit-phasec/99-failure.png` 显示目标组缺失。
- 状态：入口/数据装配阻塞，需先确认当前项目是否有可引用的镜头资料，再决定是数据前置缺失还是 picker 派生回归。

### SB-F05：画布表格双击没有到完整分镜表

- 真实影响：用户从生成画布表格进入完整分镜编辑页的入口不成立，后续编辑、勾选、参考图和批量操作无法闭环。
- 证据：`tests/ux/shot-table-storyboard-projection.walk.mjs:63-67` 双击后找不到 `[data-storyboard-rows] [data-storyboard-row="1"]`。
- 生产接触面：`src/workbench/creation/storyboard/StoryboardShotTable.tsx:273` 提供 `[data-storyboard-rows]`；`src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx:511` 提供 `data-storyboard-row`。需审双击事件到侧栏/编辑器的共享导航边界。

### SB-F06：进行中与排队镜头的选取/刷新路径未到达目标节点

- 真实影响：无法证明生成中镜头刷新后保留状态，也无法证明排队镜头被锁定而不能重复生成。
- 证据：`agent-inflight-shots-reload.walk.mjs:50-58` 的命中点探针返回 null；`agent-queued-shot-not-regenerable.walk.mjs:92-98` 找不到第二个 queued 节点。
- 状态：真实恢复路径未验证；不要用截图存在替代节点命中、刷新后状态和按钮 disabled 证据。

### SB-F07：动作卡 walk 是弱通过，实际观测为缺失

- 真实影响：用户输入故事后是否出现可理解的动作卡和显式运行按钮没有被保证；脚本仍以 `launched=true` 退出，可能是后台自动触发，用户看不到入口。
- 证据：`tests/ux/storyboard-trigger.walk.mjs:142-155` 只打印 `cardShown=false` 与 `run button count: 0`，没有失败断言；最终日志 `RESULT cardShown=false launched=true`。
- 状态：应改成硬断言并重新走査入口、取消、重复点击和返回路径；本轮不改产品/测试代码。

### SB-F08：真实媒体/外部真实模型路径被安全边界阻塞

- 真实影响：本轮没有把私有 4K 用户视频派生参考帧上传到外部真实模型，因此不能声称参考图生成、冷开解码和导出性能通过。
- 原因：自动审查拒绝了向未明确授权的外部模型目的地上传私有 4K 用户视频派生素材。已停止该路径，没有绕过审查。
- 当前替代证据：`check:real-media-fixture` 通过登记检查，但 J4/J5 仍是 `2026-10-14` 到期债务；窄行 walk 只证明布局指标，未证明图像 decode/冷开时间。

## 覆盖矩阵与回归要求

| ID | 用户任务 | 通过不变量 | 当前状态 | 重跑入口 |
|---|---|---|---|---|
| SB-01 | 进入项目、切换项目、刷新/冷重开 | 项目身份、文档、计划不丢；返回后仍在正确入口 | 部分通过：blank/creation/undo 冷恢复通过；inflight 未验证 | `core-a-blank-storyboard.e2e.mjs`、`core-a-creation-plans.e2e.mjs` |
| SB-02 | 创建/命名/编辑/删除/复制/撤销 | 每次动作只有一个 owner，撤销/重做与冷恢复一致 | 创建、编辑、删除、undo/redo 通过；复制需在修正后的计划入口补证 | `core-a-storyboard-undo.e2e.mjs`、`core-a-creation-plans.e2e.mjs` |
| SB-03 | 表格勾选、全选、批量栏 | 勾选集合与行状态逐字一致；取消/重复点击幂等 | 表格执行态先被 SB-F02 阻塞 | `storyboard-table-exec.walk.mjs` |
| SB-04 | 参考图添加/移除/预览 | 添加、移除、预览立即反映到行、出站和恢复状态 | 入口被 SB-F01 阻塞；需修 selector 后重跑 | `storyboard-reference-slots.walk.mjs` |
| SB-05 | 自动引用与跨镜头 @ 选择 | picker 显示 current/nearby/all 语义组；capsule 可加可删 | SB-F04 阻塞 | `storyboard-table-phasec.walk.mjs` |
| SB-06 | 跨镜头一致画幅、模型选项 | 批量选择、行值、画布投影、出站报文一致 | 9:16 画幅和同名模型通过 | `storyboard-film-aspect-passthrough.walk.mjs`、`storyboard-model-same-name.walk.mjs` |
| SB-07 | 剩余生成/跟进方案/视频状态机 | waiting/ready/generating/succeeded/failed/queued 的迁移可见且恢复 | 生成确认 harness 被 SB-F03 阻塞；inflight/queued 被 SB-F06 阻塞 | `agent-storyboard-generate-confirm.walk.mjs`、`agent-inflight-shots-reload.walk.mjs`、`agent-queued-shot-not-regenerable.walk.mjs` |
| SB-08 | 首帧和视频模型/时长门 | 超限阻断、合法首帧入批量、完成后不误报 | 通过 | `storyboard-first-frame-false-alarms.walk.mjs` |
| SB-09 | 策略 split/merge 与无模型 | 建议可解释；采用后再次检查；无模型给可执行 CTA | 通过 | `storyboard-strategy-resolve.walk.mjs`、`storyboard-strategy-no-model.walk.mjs` |
| SB-10 | 画布表格双击进入完整编辑 | 双击后 `[data-storyboard-rows]`、首行和上下文存在 | SB-F05 阻塞 | `shot-table-storyboard-projection.walk.mjs` |
| SB-11 | 取消、返回、重复点击、网络失败恢复 | 取消只结束当前请求；重复点击幂等；网络失败可恢复且不丢输入 | 取消/网络失败未取得完整证据；动作卡还受 SB-F07 影响 | `storyboard-trigger.walk.mjs` + 生成确认修正后补测 |
| SB-12 | 参考图加载性能 | 真实登记素材冷开、首屏、切换、移除都有时间戳和失败恢复 | 未验证；J4/J5 真实媒体债务未清 | `check:real-media-fixture` 通过后按登记素材补跑 |

## 通用验收规则、指标和证据格式

1. 每条用户任务记录四段：**输入**（真实页面/真实控件）→ **状态**（可见 badge、按钮、行属性、请求阶段）→ **输出**（页面、出站报文或恢复结果）→ **证据**（截图、日志、trace 路径）。
2. 只允许真实应用窗口和真实页面输入；不以 store/state 注入代替用户路径。能力边界测试可使用项目已有的测试 harness，但必须传完整公开契约字段（例如 `initiator`），并把它标成 harness 前置而不是产品证据。
3. 入口断言必须是硬断言：按钮/动作卡/行/节点找不到即失败；不能仅打印 `false` 后以 exit 0 记通过。
4. 状态机断言必须同时检查可见状态和操作能力：badge/phase、按钮 disabled 或可点击、重复点击幂等、取消后的恢复、刷新后的持久化。
5. 参考图测试至少覆盖添加、移除、预览、自动引用、跨镜头引用和失败恢复；每个步骤都要记录引用 ID/数量、缩略图/预览是否可见及出站字段。
6. 跨镜头一致性至少对照四份数据：批量控件、行数据、画布节点投影、出站请求；同一输入四处逐字节相同或有明确标准化规则。
7. 性能指标使用真实登记素材：项目进入冷开、参考图首帧可见、切换镜头、移除后回收；记录 p50/p95、失败率和网络失败恢复时间。没有真实媒体时标 `unverified`，不能用合成夹具绿灯代替。
8. 每次失败保留最小复现截图和 trace；修复后要重跑原失败路径、相邻入口和对应的 zh/en 轨，确认没有把 selector 改成另一个并行入口。
9. 交工前必须补一次真实用户任务闭环：进入项目 → 选择计划 → 表格勾选 → 参考图/自动引用 → 生成/失败恢复 → 返回/刷新 → 冷重开；缺任何一段不算完成。

## 当前阻塞与下一步

- **构建/基线**：共享 `node_modules` symlink 的 Electron runtime 检查和 `.git/FETCH_HEAD` 写权限仍阻塞 canonical `delivery:preflight`/`pnpm build` 收据；本轮只用成功的 renderer/electron 子构建完成真实走查。
- **验收 harness**：先修正 SB-F01、SB-F03、SB-F07 的 walk 入口/契约/硬断言，再重跑参考图、生成确认和动作卡链路。
- **生产状态**：SB-F02、SB-F05 需要根因级审计（共享 derive/navigation 边界），不能在渲染层补偿。
- **真实媒体**：外部私有 4K 上传被自动审查拒绝；若要继续该条，需用户明确授权具体模型/供应商和允许上传的素材范围。当前未上传任何私有 4K 参考帧。
- **交付纪律**：本轮不提交、不 push、不合并、不发布；该文档和已有证据供协调会话决定后续根因修复与复验顺序。
