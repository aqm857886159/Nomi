# 对话式模型接入与认证闭环：完整续做交接

日期：2026-08-28
交接对象：下一位 Codex / Claude Code / WorkBuddy 工程 Agent
状态：**Tasks 1–8 已实现并通过完整本地门禁；Task 9 已补真实 ModelScope 最小切片和 fresh-process 幂等读回，原生 ComfyUI、真实 WorkBuddy、完整多供应商与升级矩阵仍是外部发布验收项。**

> 这份文档用于在没有本轮聊天上下文的情况下继续执行。不要仅凭某次“全绿”宣布完成；本文严格区分“已实现”“已验证”“已提交”“已推送”。

## 2026-08-29 PR #221 最终交付事实（优先于下方历史恢复记录）

- PR #221 已合并：`origin/main@69fce09e`；原 head 为 `codex/model-onboarding-20260828`。
- 生产生成画布保持只有 `@xyflow/react` 单内核，Zustand/domain/project snapshot 仍是业务与持久化真相源。
- `pnpm run test:system:full` 已通过 5/5；React Flow canvas 14/14；J3/J5 2/2。
- 模型接入 J0/J3/J4 专项已在最终代码上通过：43 tools、25 resources、8 组 fail-closed、打包重启读回、provider requests=0、credential bytes=0。
- 真实 ModelScope 最小切片已通过：远端发现 47 个模型，选择 1 个文本模型，`chat` 1 次验证完成；重启后同一幂等键仍返回同一 completed run，attempts 保持 1。
- 真实测试只使用临时 profile 中复制的加密 Catalog，没有读取或输出密钥，没有修改正式 Catalog；临时 profile 已删除。
- 原生 ComfyUI 当前没有运行实例；真实 WorkBuddy 与安装包 upgrade replay 未验证，继续标 `unverified`。

下方 §0-§13 是实现过程的历史恢复记录，路径、HEAD 和“未提交”描述已经过期；继续后续工作时以本节、实时 Git 状态和验收记录为准。

---

## 0. 接手后的第一分钟

只在下面这个隔离 worktree 工作：

```bash
cd /Users/aoqimin/Desktop/Nomi-model-onboarding-20260828
git branch --show-current
git status --short
git rev-parse HEAD
git diff --check
ls -ld node_modules
```

预期：

```text
branch: codex/model-onboarding-20260828
HEAD:   2b90a60dc88aa55b9c0d1cd1ffa002fea3ee6aff 或其后续本地提交
base:   以当前 worktree 的 merge-base 为准；远端以后可能移动
status: 包含 Tasks 4–8 的大量未提交实现与测试；以实时 git status/diff 为准，不假定文件数量
```

### 绝对不要做

- 不要在 `/Users/aoqimin/Desktop/Nomi` 共享主工作树里切分支、reset、提交或覆盖文件；它当前属于别的并行任务。
- 不要对本 worktree 执行 `git reset --hard`、`git checkout -- .`、`git clean`、rebase 或先同步远端；这里有已完成但未提交的 Task 4 复审修复。
- 不要删除 `electron/runtime.manual-onboarding.test.ts` 的 deletion；旧 `manualCommit` 旁路就是要被移除。
- 不要把未认证模型重新做成 `enabled=true` 的兼容 fallback。
- 不要直接 push `main`。最终只 push `codex/model-onboarding-20260828` 并开 PR。
- 不要在聊天、日志、manifest、MCP 参数或文档中输出 API key、CredentialRef、Authorization、签名 URL、绝对用户素材路径或供应商原始错误页。

如果这个 worktree 的 `HEAD` 或状态与上面明显不同，先保存 `git status --short`、`git log -10 --oneline` 和 `git diff --stat`，判断是否有另一位 Agent 在继续，不要推倒重来。

`node_modules` 预期是复用主仓依赖的本地 symlink；它只用于本机测试，不得加入 Git。若链接失效，先重新指向现有依赖或在本 worktree 执行 `pnpm install --prefer-offline`，不要删除源码。

---

## 1. 一句话目标与完成定义

目标不是“让 Agent 帮用户填接入表”，而是：

> 用户只有安装版 Nomi、Codex / Claude Code / WorkBuddy 和供应商资料，不需要 Nomi Git 仓库，也能在对话里发现完整模型列表、一次选择多个模型、安全输入 API key、真实验证每个可用 mode，并让这些能力在重启或升级后仍能从正式生产入口使用。

同时必须支持：

- 普通 HTTP API / OpenAI-compatible / 供应商自定义 create-poll-result 协议。
- 多模型、多 capability 家族、部分成功、逐项失败原因。
- ComfyUI API workflow 和普通 UI Save workflow。
- ComfyUI 多图片/视频槽显式绑定，不能按 `widgets_values` 位置猜字段。
- MiniMax H3 / VHS 回归：图片文件名只能进入媒体 input，`VHS_VideoCombine.frame_rate` 必须保持 number。
- Kling 3.0 Omni 等多图 API：每张图角色明确，不得把 `images[0]` 偷换成首帧后又从参考图中滤掉。
- 媒体响应先做 Content-Type、magic bytes、大小和解码验证；HTML/XML 错误页不得进入 sharp/glib/ffprobe 形成误导性“图片损坏”。

以下任何一项都**不算接入完成**：

- 密钥保存成功。
- 模型列表拉取成功。
- Catalog 写入成功。
- 一个模型或一个 mode 成功。
- mock 流量成功但正式生产入口没跑。
- fresh-process 能读配置但安装包重启后没从正式入口执行。

唯一完成口径：**真实生产任务通过 → 受限媒体验证通过 → invisible staging → prepared journal/CAS → fresh-process readback → 原子 Catalog 发布 → 重启/升级后正式入口仍可执行。**

---

## 2. 已拍板架构，不要重新造第二套

```text
Codex / Claude / WorkBuddy（无仓库）       现有 Nomi 设置 UI
                │ MCP tools / Skill                │
                └──────────────┬─────────────────────┘
                               ▼
                    IntegrationSessionService       # Task 6
              owner / revision / needs_input / handoff
                               │ childRunRef
                               ▼
                 ConnectionCertificationService    # Tasks 1–5
                唯一 start/get/cancel/promote owner
                    ├── HttpProviderConnector
                    │     └── 复用 Provider Adapter 原语
                    └── ComfyUiConnector
                          └── 复用 smart conversion / bindings
                               │
                               ▼
                   正式 production execution
                               │
                  managed artifact + bounded decode
                               │
                staging → journal/CAS → Catalog publish
```

边界：

1. `IntegrationSessionService` 只负责编排对话会话，不复制认证结果；它只引用 `childRunRef`。
2. `ConnectionCertificationService` 是 HTTP 与 ComfyUI 唯一认证 run owner。
3. `ProviderAdapterService` 是 HTTP connector 的实现原语，不再是公开工作流 owner。
4. `Catalog` 只允许 verified mode 对普通生产消费者可见。
5. Skill 只教工具顺序和诚实表达，不包含 BananaRouter、AIMLAPI、Kling 等供应商特判。
6. API key 只在 Nomi trusted UI 输入；Agent 只能看到 `credentialStatus`。
7. ComfyUI 原生 Server 与平台专用 Cloud/Serverless API 是两类协议：原生 connector 对 `/object_info`、`/prompt`、`/history`、`/view`；平台 API 必须按普通 HTTP provider 接，不可只塞一个 key。

设计真源：

- `docs/superpowers/specs/2026-08-28-conversational-model-integration-design.md`
- `docs/superpowers/plans/2026-08-28-conversational-model-integration.md`

根因合同：

- `docs/fixes/2026-08-28-secure-credential-verified-visibility.root-cause.json`
- `docs/fixes/2026-08-28-bounded-media-certification.root-cause.json`
- `docs/fixes/2026-08-28-media-certification-lifecycle-hardening.root-cause.json`
- `docs/fixes/2026-08-28-idempotent-certification-ledger.root-cause.json`
- `docs/fixes/2026-08-28-canonical-http-onboarding.root-cause.json`

---

## 3. 当前 Git 状态

### 3.1 已提交的本分支提交

本分支从观察时的 `origin/main@527ae52f` 开始，当前已提交到 `2b90a60d`；Task 4--8 的复审修复仍在工作树，尚未提交：

```text
2ced04d5 docs(onboarding): design conversational model integration
019d80f1 fix(onboarding): require secure credentials and verified visibility
3c4b23ef fix(onboarding): preserve published custom-call visibility
07af7021 fix(onboarding): preserve published contracts atomically
984ff52e fix(onboarding): keep active text revisions visible
61c1d328 fix(onboarding): close legacy credential and mode gates
72cbaba6 fix(onboarding): reject invalid capability contracts
53fc3002 fix(onboarding): isolate staged connections and mode pickers
4a29e3b2 fix(onboarding): share strict capability contract parser
faa799f7 fix(onboarding): version candidate connection lifecycle
7a3a5aba fix(onboarding): finalize candidate lifecycle by lineage
3db24fe0 fix(onboarding): require secure credentials and verified visibility
78fbbe8d docs(onboarding): require blind multi-model certification
f07a9c68 fix(onboarding): enforce identity and mode publication
d42ed689 fix(onboarding): redact arbitrary gateway headers
9e8d3851 fix(onboarding): verify media before provider promotion
38fdecdf fix(onboarding): verify media before provider promotion
d852a34c fix(onboarding): verify media before provider promotion
8a6828c6 fix(onboarding): verify media before provider promotion
717e1847 fix(onboarding): verify media before provider promotion
a650eff7 feat(onboarding): add idempotent certification ledger
7dc9075d feat(onboarding): add idempotent certification ledger
7d9fcf20 feat(onboarding): add idempotent certification ledger
f7e0dcb3 fix(onboarding): handle canonical start materialization race
27134024 fix(onboarding): make canonical start wait nonblocking
2b90a60d refactor(onboarding): route http setup through certification
```

### 3.2 尚未提交的 Task 4 复审修复

当前 tracked diff：约 `600 insertions / 1123 deletions`，54 个文件；另有 8 个 Task 4 代码/测试新文件和本交接文档。**不要假定已提交。**

新增未跟踪文件：

```text
electron/catalog/rendererCatalogMutation.ts
electron/catalog/rendererCatalogMutation.test.ts
electron/trustedSyncIpc.ts
electron/trustedSyncIpc.test.ts
src/ui/onboarding/certificationFailureMessage.ts
src/ui/onboarding/certificationFailureMessage.test.ts
src/ui/onboarding/certificationIntentKey.ts
src/ui/onboarding/certificationIntentKey.test.ts
```

删除文件：

```text
electron/runtime.manual-onboarding.test.ts
```

其余修改可用下面命令得到准确实时列表：

```bash
git diff --name-status
git status --short
git diff --stat
```

不要把本交接文档的新增与 Task 4 代码混淆；最终可在 Task 4 验证后一起提交，也可以单独做 docs commit，但两者都必须遵守仓库 gates。

---

## 4. 分阶段进度与证据

| 阶段 | 状态 | 已提交 | 复审 | 当前可声称 |
|---|---|---:|---:|---|
| Task 1 安全凭据、verified-only publication、lineage、redaction | 完成 | 是，至 `d42ed689` | spec compliant + quality approved | 已实现且已验证 |
| Task 2 媒体验证、staged candidate、Comfy 生命周期基础 | 完成 | 是，至 `717e1847` | spec compliant + quality approved | 已实现且已验证 |
| Task 3 幂等 ledger、CAS、崩溃恢复、非阻塞重复等待 | 完成 | 是，至 `27134024` | spec compliant + quality approved | 已实现且已验证 |
| Task 4 HTTP canonical facade 与旧 UI 迁移 | 已实现，待交付提交 | 主体 `2b90a60d`；复审修复在工作树 | 10 项复审修复已覆盖；全量 gates/typecheck/build 通过 | 自动化已验证，尚未完成安装包发布门 |
| Task 5 ComfyUI 全面迁移 | 已实现，自动化已验证 | 复审修复在工作树 | API/UI 转换、显式 binding、媒体生命周期与恢复测试通过 | 尚缺真实 ComfyUI J2 |
| Task 6 持久化会话、handoff queue、MCP tools | 已实现，自动化已验证 | 复审修复在工作树 | MCP/session/handoff/CAS/幂等/失败收敛测试通过；最新 arm64 安装包 MCP smoke 和 no-repo J0 通过 | 尚缺真实 WorkBuddy 宿主证据 |
| Task 7 trusted UI handoff 与状态呈现 | 已实现，自动化已验证 | 复审修复在工作树 | UI intent key、reasonCode、renderer mutation 与 IPC 门禁通过 | 尚缺真实双语明暗截图走查 |
| Task 8 内置 Skill、客户端配置、README、无仓库 harness | Skill/文档已实现 | 复审修复在工作树 | Skill 资源真 stdio 测试通过；README/指南已更新；最新安装包空目录 MCP smoke 和 no-repo harness 通过 | 尚缺 WorkBuddy 真宿主证据 |
| Task 9 真实 provider/Comfy/重启升级/交付 | 进行中，尚未完成 | 否 | 自动化与安装包/J0 部分门岗通过；真实外部验收未执行 | 不可声称完成 |

### 4.1 Task 1 已完成内容

- 新建或编辑凭据 fail-closed；safeStorage 不可用时不能落明文并冒充完成。
- legacy plaintext 只能标记 `needs_credential_resave`。
- model/mode publication 不再由 `enabled + keyStatus` 推断，而由 verified execution 派生。
- candidate revision、active revision、lineage 和原子 promotion 边界建立。
- arbitrary gateway headers、签名 URL、原始错误页等从对外结果中清理。
- 存量已发布 custom-call/text 合同保持兼容，不把已有可用模型误杀。

### 4.2 Task 2 已完成内容

- 媒体在 promotion 前执行 MIME、magic、大小、流式限制和真实解码。
- HTML/XML 错误页在进入图像/视频解码器前被识别为供应商响应错误。
- 图片、视频、音频、GLB 等按声明类型验证。
- staged candidate lifecycle、失败清理和 promotion journal 收敛。
- Comfy workflow import 的发布也受 verified gate 约束，为 Task 5 提供基础，但 **Task 5 的完整 connector 尚未实现**。

### 4.3 Task 3 已完成内容

- 同一 `idempotencyKey + contractDigest` 只对应一个 canonical run。
- 提交前落 checkpoint；未知响应只能 reconcile，不能盲目重复 create。
- 跨进程锁、CAS、lease、compaction、崩溃恢复已覆盖。
- canonical start 的重复等待改成异步非阻塞，处理 materialization race。
- `operationLedger.ts` 已拆出 archive/compaction 逻辑以满足单文件门岗。

冻结 Task 3 时的记录证据：focused 413、full Vitest 8390、agent-runtime 151，完整 gates 通过。后续 Task 4 修改了少量 ledger 不变量，因此仍要以本次最终 gates 为准。

---

## 5. Task 4：初审发现什么、当前怎么修的

Task 4 主体 `2b90a60d` 曾跑出 8401 Vitest 通过、1 skipped、151 agent-runtime、完整 gates 通过。但那只能证明当时测试覆盖到的内容。双重复审随后找出下面 10 项，因此 Task 4 不能按旧全绿宣布完成。

### 5.1 复审问题与当前实现状态

| # | 级别 | 复审发现 | 当前修复落点 | 当前状态 |
|---|---|---|---|---|
| 1 | P1 | unverified 模型仍可能从生产选择/运行边界进入 | `electron/shared/modelPublication.ts`；catalog listing/executable；capability bootstrap；runtime/text brain/assistant identity | 已实现，待最终 gates |
| 2 | P1 | renderer 可通过 raw Catalog IPC 绕过 certification | `electron/catalog/rendererCatalogMutation.ts`；`electron/trustedSyncIpc.ts`；`electron/main.ts` | 已实现，待 E2E/gates |
| 3 | P1 | UI 每次调用都 mint UUID，丢响应重试会生成第二个 run | `src/ui/onboarding/certificationIntentKey.ts` 及 Wizard/Drawer | 已实现行为测试，待 E2E |
| 4 | P2 | failed/cancelled candidate 清理后 retry 仍引用已删 vendorKey | lineageRoot/source vendor 修复，涉及 certification/service 与 provider adapter lifecycle | 已实现，待最终全测 |
| 5 | P2 | reopen 未验证 `childRunRef.runId/revisionDigest` 双向一致 | `electron/integrationCertification/operationLedger.ts` 与 tests | 已实现，待最终全测 |
| 6 | P2 | UI 测试只查源码字符串，反而锁死错误 UUID 行为 | 新增 `certificationIntentKey.test.ts` 行为测试 | 已实现 |
| 7 | P3 | 初次 hydration 会把历史 terminal run 当新变化刷新 Catalog | `adapterTaskVisibility.ts` / `useProviderAdapterTasks.ts` | 已实现，待 UI tests |
| 8 | P1 | manual existing HTTP 与 programmatic HTTP 不是同一 canonical contract/run shape | `integrationCertification/service.ts`、`existingConnection.ts`、bridge types、service tests | 已实现，待 Electron E2E |
| 9 | P1 | 旧 `nomi:onboarding:manual-commit` 仍能直接写 Catalog | 删除 onboarding IPC/preload/runtime 旁路和旧测试；capability matrix 改为 canonical path | 已实现；生产代码仅保留“不应存在”的测试语义 |
| 10 | P2 | raw main-process English/error 直接出现在 UI，可能泄漏内容 | `certificationFailureMessage.ts` + `reasonCode → zh-CN/en` | 已实现，待 i18n/gates |

### 5.2 关键新边界

`rendererCatalogMutation.ts` 的目的不是又造一个认证系统，而是把仍需保留的 renderer Catalog 编辑入口限制为“展示/配置草稿”：

- renderer 不能伪造或覆盖 certification-owned `meta.adapter`。
- 新模型默认写成 `unverified`、`enabled=false`。
- 未发布模型/映射即使 payload 传 `enabled=true` 也会被降为 false。
- import package 只能进入 disabled/unverified 草稿。

`trustedSyncIpc.ts` 为遗留同步 IPC 加 `assertTrustedSender`，但后续应优先减少同步 mutation，不应扩张 `sendSync`。

`CertificationIntentKey` 表示一个 mounted confirmation surface 的逻辑操作：

- immutable contract 相同且响应不确定时复用 key。
- contract 改变或用户明确开始新操作时才 rotate。
- 不要在每次点击/重试时直接 `crypto.randomUUID()`。

`certificationFailureMessage.ts` 只接受稳定 error code，经 i18n 映射；未知 code 回退通用提示，不渲染 raw error。

### 5.3 旧旁路删除检查

接手后运行：

```bash
rg -n "manualCommit|commitManualOpenAiCompatibleModels|nomi:onboarding:manual-commit" electron src tests
```

预期：生产实现中没有 handler/bridge/service；测试可以出现“该 handler 不应存在”的断言。若重新引入旧 handler 以让测试变绿，就是违反 P1/P2。

---

## 6. 当前验证账本

### 6.1 已观察到的结果

- Task 4 复审修复初始 RED：`11 failed / 89 passed`。
- 重点修复后的分组测试：`141/141`、`82/82`、`79/79` 通过。
- `pnpm run typecheck`：通过。
- 两条 E2E 文件的 JavaScript 语法检查：通过。
- 第一次修复后全量：`8394 passed / 1 failed / 1 skipped`；唯一失败是 `tests/system/capabilities.json` 仍引用已删除的旧 manual onboarding 测试。
- capability matrix 迁移后针对性复测：`11/11` 通过。
- 第二次 `pnpm run test` 被本次额度/交接中断，**没有最终结果**。
- 当前没有残留测试进程。
- 当前 `git diff --check`：通过。

### 6.2 尚未获得的证据

- 当前完整 `pnpm run test` 结果。
- 当前完整 `pnpm run gates` 结果。
- `tests/ux/newapi-relay.e2e.mjs` 的真实 Electron 运行结果。
- `tests/ux/ipc-split-smoke.e2e.mjs` 的真实 Electron 运行结果。
- Task 4 修复后的 spec review 与 quality review。
- Task 4 修复 commit。

因此当前只能说：**10 项复审问题已在代码层处理，静态状态内部一致；不能说 Task 4 已交付。**

---

## 7. 精确恢复顺序

### Step A：先保护并验证当前 Task 4 修复

```bash
cd /Users/aoqimin/Desktop/Nomi-model-onboarding-20260828
git branch --show-current
git status --short
git diff --check
pgrep -fl "vitest|electron|vite" || true
```

如果没有别的 Agent 在编辑，按下面顺序执行。不要用 `| tail`，它会吞退出码；需要保存日志时用重定向并单独读取。

```bash
pnpm run test > /tmp/nomi-model-onboarding-test.log 2>&1
test_exit=$?
echo "test_exit=$test_exit"
tail -120 /tmp/nomi-model-onboarding-test.log
```

若全量失败：

1. 先看失败是否属于本 diff。
2. 单独串行重跑失败测试。
3. 不要因旧能力矩阵而恢复 `manualCommit`。
4. 修复后重跑完整 `pnpm run test`。

### Step B：跑两条实际 Electron E2E

先 build，再逐条执行：

```bash
pnpm run build
node tests/ux/ipc-split-smoke.e2e.mjs > /tmp/nomi-ipc-split-smoke.log 2>&1
ipc_e2e_exit=$?
echo "ipc_e2e_exit=$ipc_e2e_exit"
tail -120 /tmp/nomi-ipc-split-smoke.log

node tests/ux/newapi-relay.e2e.mjs > /tmp/nomi-newapi-relay.log 2>&1
newapi_e2e_exit=$?
echo "newapi_e2e_exit=$newapi_e2e_exit"
tail -160 /tmp/nomi-newapi-relay.log

pgrep -fl "newapi-mock|Nomi-model-onboarding-20260828.*electron" || true
```

两条脚本正常路径会在 `finally` 中关闭 Electron，`newapi-relay` 还会关闭本地 mock。若脚本被强制中断而留下进程，先用上面的 `pgrep` 确认精确 PID，再只终止对应 PID；不要无差别杀掉其他 worktree 的 Electron。Task 4 这两条 E2E 使用本地 mock 和隔离 user-data，不需要真实供应商凭据。

`newapi-relay.e2e.mjs` 必须证明：

1. 模型列表正常发现。
2. 保存连接只产生 configured/unverified/disabled 模型。
3. manual UI 从 `httpCertificationStartExisting` 进入 canonical facade。
4. 相同 logical confirmation 重传使用同一个 idempotency key 和同一个 run。
5. `childRunRef.runId === run.id` 且 digest 合法。

`ipc-split-smoke.e2e.mjs` 必须证明：

- IPC handler 真正注册并进入业务错误，而不是 `No handler registered`。
- HTTP configure 空入参返回稳定 `START_FAILED` code。
- Catalog 只读 IPC 仍工作。

这里的 `START_FAILED` 是 facade 对无效空 payload 的稳定包装错误码，用来证明 IPC 已进入 canonical 业务 handler；它不是在宣称“合法连接的配置动作等于启动认证”。

### Step C：跑完整 gates

```bash
pnpm run gates > /tmp/nomi-model-onboarding-gates.log 2>&1
gates_exit=$?
echo "gates_exit=$gates_exit"
tail -160 /tmp/nomi-model-onboarding-gates.log
```

必须关注：

- `check:filesize`：`operationLedger.ts` 不得重新超过 800 行。
- `check:i18n`：新增错误提示只能走 zh-CN/en key。
- `check:ipc-sender-binding`：raw/sync Catalog mutation 不能放松 sender guard。
- `check:walkthroughs` 只是静态门，不等于 Electron E2E 已执行。
- `check:docs-index` / `check:doc-status` 可能要求把本交接文档加入索引；按现有生成器修，不要删除文档。

### Step D：复审 Task 4

在 review prompt 中明确要求复查以下 10 项，而不是泛泛审代码：

```text
Review the uncommitted Task 4 follow-up against the approved design and the 10 findings in
docs/handoff/2026-08-28-conversational-model-integration-handoff.md §5.
Spec review must decide COMPLIANT / NON-COMPLIANT.
Quality review must report P0/P1/P2 findings with exact file:line.
Pay special attention to production selection boundaries, renderer Catalog IPC,
logical idempotency across lost responses, retry lineage, childRunRef reopen invariants,
manual/programmatic canonical contract parity, deletion of manualCommit, and raw-error redaction.
```

在 Codex/Coding Agent 环境优先按仓库 `requesting-code-review` 流程分别派一个 spec reviewer 和一个 quality reviewer；若当前宿主没有 subagent 工具，就由接手 Agent分别做两遍独立审查并保存结论，不能因为工具不同省略复审。spec review 输出 `COMPLIANT / NON-COMPLIANT`；quality review 按 P0/P1/P2 给精确 `file:line`。

所有 P0/P1 必须修完；P2 若影响安全、幂等、发布真实性或后续 Task 5/6 基础，也必须现在修。

### Step E：提交 Task 4 follow-up

只有完整 test、两条 Electron E2E、gates、复审通过后才提交：

```bash
git status --short
git diff --check
git diff --name-status
git add -u -- electron src tests
git add \
  electron/catalog/rendererCatalogMutation.ts \
  electron/catalog/rendererCatalogMutation.test.ts \
  electron/trustedSyncIpc.ts \
  electron/trustedSyncIpc.test.ts \
  src/ui/onboarding/certificationFailureMessage.ts \
  src/ui/onboarding/certificationFailureMessage.test.ts \
  src/ui/onboarding/certificationIntentKey.ts \
  src/ui/onboarding/certificationIntentKey.test.ts \
  docs/handoff/2026-08-28-conversational-model-integration-handoff.md
git diff --cached --stat
git diff --cached --name-status
git commit -m "fix(onboarding): close certification bypasses"
```

`git add -u` 只纳入这三个目录中已经 tracked 的修改/删除；8 个新代码/测试文件和本交接文档逐个点名加入。提交前检查 staged 清单与 §3/实时 `git status` 一致，并确认没有密钥。若此后出现新的未跟踪文件，先理解来源，不要顺手 `git add -A`。此阶段**不要 push**；继续 Task 5–9，到最终交付边界再 push/PR。

---

## 8. 后续 Tasks 5–9 执行图

详细逐文件步骤在实施计划；这里给出接续时不可遗漏的结果与验收门。

### Task 5：把 ComfyUI 迁入同一认证边界

核心文件：

```text
Create electron/integrationCertification/comfyuiConnector.ts
Create electron/integrationCertification/comfyuiConnector.test.ts
Modify electron/catalog/comfyuiWorkflowImportStore.ts
Modify electron/catalog/comfyuiWorkflowImport.ts
Modify electron/comfyuiIpc.ts
Modify src/ui/onboarding/ComfyuiWorkflowImportPanel.tsx
Modify src/ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx
Modify src/ui/onboarding/workflowPage/runTestGeneration.ts
```

必须先写 RED 测试覆盖：

- API workflow。
- 普通 UI Save workflow，经现有 smart conversion 转 API workflow。
- 两个或更多不同媒体槽，每个槽上传不同 fixture。
- VHS widget 顺序变化。
- `frame_rate` 保持 number。
- 图片文件名只进入显式声明的媒体 input。
- missing node、ambiguous output、`unresolvedFields[]` 一次性返回。
- binding round-trip：`{nodeId,inputKey,paramKey,mediaKind}` 不漂移。

禁止：

- 按 `widgets_values` 位置 zip inputs。
- import 后直接 `enabled=true`。
- 用 no-media “test started” 作为认证证据。
- 把 Comfy Cloud/RunPod/RunComfy 的平台 API 假装成本地原生 Comfy server。

建议 commit：

```text
refactor(comfyui): certify workflows before enabling
```

### Task 6：持久化 IntegrationSession、handoff queue、MCP tools

必须实现：

- `begin/open_credentials/discover/select/submit_workflow/resolve_input/start/get/cancel`。
- schema `additionalProperties:false`、size limits、owner/capability、CAS `expectedRevision`、rate limit。
- session 只引用 canonical `childRunRef`，不能复制 mode 结果。
- app 关闭时 persisted handoff queue；打开后 renderer subscribe + ack。
- signed client identity；未签名 external 只能读公开描述，不能启动接入或花额度。
- tools-only client 不读 Skill/resource 也能完成流程。
- MCP 结果只返回稳定 code、params、nextActions、计数和安全摘要。

建议 commit：

```text
feat(mcp): add conversational model integration sessions
```

### Task 7：trusted UI handoff 与 session 状态

复用 SettingsDialog、OnboardingDrawer、连接页和 ComfyUI workflow page；不新增 AppBar 常驻按钮或第二个设置中心。

必须可见：

- 发起客户端。
- 冻结的 normalized origin。
- auth 放在 header/query 的哪个位置，但不显示值。
- 新建/复用/覆盖 scope。
- “安全保存并继续验证”，而不是“已接入”。
- partial 的每个模型/mode：可用、不可用、原因、唯一下一步。
- `aria-live` 进度、zh-CN/en、light/dark。
- dirty form 不被 handoff 强行覆盖。

用户可见实现需要按已批准外壳做真机截图和人眼检查。

建议 commit：

```text
feat(onboarding): show secure integration handoff
```

### Task 8：内置 Skill、客户端配置、README、无仓库 harness

Skill 文件：

```text
skills/model-integration/SKILL.md
skills/model-integration/skill.json
```

Skill 只包含：

- 先读官方资料和 Nomi 返回证据，不凭记忆猜接口。
- 不在对话中索要/接收/回显 API key。
- 分页遍历完整候选，一次可选择多个模型。
- 一次问完全部 `unresolvedFields`。
- partial、密钥保存、候选发现都不能说成完成。
- Comfy 只按显式 binding，不按 widget 位置。
- auth/balance/quota/security 不盲重试；contract repair 有上限。

必须从空临时目录运行 harness，并禁止访问 Nomi source path；用户不能被要求 clone Git、编辑 Catalog JSON 或手改仓库文件。

README/guide 要给出一句话启动方式、支持边界、安全 key 输入、Comfy UI/API workflow、partial 与恢复。

建议 commit：

```text
docs(onboarding): ship no-repo model integration skill
```

### Task 9：真实用户闭环、安装包和交付

真实验收至少包含：

1. Codex 空目录、Claude Code 空目录、standards-compatible generic WorkBuddy harness。
2. BananaRouter：若本机已安全配置凭据，按官方文档与账号可用模型测试；若没有，只能明确记 external credential blocker，不能伪造 live pass。
3. 第二个 blind provider：优先使用设计时选定的 AIMLAPI 或另一个仓库/Skill/fixture 中从未出现的真实 API origin。必须先抓官方文档。
4. 完整分页模型列表，尽可能多选模型；每个账号可用 capability 家族至少一个，存在多个时每家族尽量多于一个。
5. 逐模型/逐 mode 记录通过或 auth/balance/quota/input/server/network/contract/security 失败，不静默漏项。
6. ComfyUI：一份普通 UI workflow + 一份 API workflow；两张不同图片进入两个不同槽；VHS `frame_rate` 回归。
7. fault matrix：plaintext/safeStorage、origin rebind、DNS/redirect、HTML/XML media、oversize、duplicate start、unknown submission、cancel race、corrupt journal、prepared-promotion crash。
8. fresh-process readback：零第二次 create；同一 idempotency key 只有一次提交。
9. packaged app stop → restart/upgrade：不用重新输 key；通过普通生产入口再次调用 verified HTTP modes 和 Comfy workflow；产物真实 materialize/decode。
10. redacted manifest：发现总数、分页完整性、选择数、各 capability 结果、失败码、请求数、测试花费。

最终必须跑：

```bash
pnpm run gates
# 以及 Task 9 新增的 no-repo、packaged、真实 provider、ComfyUI journey
```

然后最终代码复审、verification-before-completion、finishing-development-branch。

---

## 9. 真实用户验收矩阵

| Journey | 环境 | 成功判据 |
|---|---|---|
| J0 安装版入口 | 空目录；无 Nomi source；Codex/Claude/generic host | tools/list 有完整 integration tools；支持时 resources/list 有 Skill；未签名客户端不能写/花额度 |
| J1 HTTP 多模型 | 真实 blind provider + 可用凭据 | 完整分页；多模型选择；每个 mode 正式 create/poll/materialize/decode；partial 诚实；重启可用 |
| J2 ComfyUI | 原生 Comfy server | UI/API workflow；2+ distinct media；显式 binding；`frame_rate` 数字；正式 `/prompt/history/view` 与解码 |
| J3 安全/故障 | mock + controlled faults | 不泄密、不盲重提、SSRF/redirect/HTML/oversize 拦截、journal 可恢复、损坏 fail closed |
| J4 持久化 | fresh process + packaged restart/upgrade | session/credential/ref/catalog 恢复；零重复 create；生产模型选择器只见 verified mode |
| J5 现有接入回归 | 已有 APIMart/Banana/自定义模型/文本大脑/Comfy | 旧 active revision 保持可用；新建/编辑走 canonical；其他模型接入不被 Kling/Comfy 专补丁影响 |

真实 WorkBuddy host 如果拿不到，只能写“generic MCP harness 已验证，真实 WorkBuddy host 未验证”，不能混为一谈。

---

## 10. 官方资料与外部实现依据

后续接任何具体 provider/model 前必须重新获取该模型当时最新的官方文档；下面是架构依据，不替代未来逐模型核对：

- Agent Skills specification: https://agentskills.io/specification
- MCP Elicitation: https://modelcontextprotocol.io/specification/draft/client/elicitation
- OpenAPI specification: https://spec.openapis.org/oas/latest.html
- ComfyUI Server routes: https://docs.comfy.org/development/comfyui-server/comms_routes
- BananaRouter docs: https://bananarouter.com/docs
- 本地 Comfy endpoint 入口：`electron/comfyui/endpointResolver.ts`
- 现有 workflow 转换/分析代码：搜索 `analyzeComfyWorkflowTextSmart`、`reconcileComfyWorkflowText`、`comfyuiGraphConvert`
- HTTP 请求构建真源：搜索 `buildHttpRequest`；发现与生产都必须复用，不能各写一套 URL join。

外部实现思路已在设计文档中核对 Open WebUI、Dify、ComfyUI 官方代码。不要重新引入整套插件 runtime；这里采用的是协议分层与认证边界，不是复制其产品架构。

---

## 11. 最容易再次犯的错

1. **把配置成功当执行成功。** UI 文案和 callback 都必须说 configured/unverified，直到 canonical promotion。
2. **只在模型设置列表挡 unverified。** 还要挡 runtime、assistant model identity、capability/MCP bootstrap、module catalog 和所有生产选择入口。
3. **为 Kling、MiniMax、BananaRouter 写特判。** 修复必须落在媒体角色、binding、request contract、publication 和认证通用层。
4. **把数组位置当语义。** HTTP 多图要有明确 role；Comfy 要用 nodeId/inputKey；禁止 `images[0]`/widget index 猜测。
5. **只跑 unit test。** Electron IPC、preload、真实 bridge 和 packaged restore 必须真实执行。
6. **把 check:walkthroughs 当走查。** 它只是静态检查；实际脚本必须单独运行，截图必须亲眼看。
7. **丢响应就生成新 UUID。** 同一 logical confirmation 必须复用 key；只有新合同/新操作才 rotate。
8. **为了兼容恢复旧 manualCommit。** 旧旁路应删除，测试/能力矩阵迁到 canonical facade。
9. **错误原文直接上 UI。** 只出稳定 code，经本地 i18n 映射；原始错误留受控诊断区并先 redaction。
10. **full green 就说整个项目完成。** Task 4 全绿也不代表 Tasks 5–9 完成；最终完成必须有无仓库、真实多模型、Comfy、多媒体、restart/upgrade 证据。

---

## 12. 最终 Git 交付

所有 Tasks 5–9 完成、真实验收与 gates 通过后：

1. 刷新远端状态并评估与 `origin/main` 的差异；先保护已提交分支，不要在脏树 rebase。
2. 在独立 worktree 解决同步冲突；对 gates 链、规则、generated manifest 按并集/重新生成处理。
3. 重新跑完整 gates 与关键真实 journey。
4. push 任务分支：

```bash
git push -u origin codex/model-onboarding-20260828
```

5. 开 PR；不要自动 merge，除非用户明确要求。
6. 报告：branch、最终 commit、PR URL、mock/live 边界、实际花费、发现/选择/认证模型数、每 capability 结果、Comfy 结果、重启升级结果和明确未验证项。

任何时候都不要直接 push 默认分支。

---

## 13. 可直接复制给下一位 Agent 的续做提示词

```text
继续 Nomi 的“对话式模型接入与认证闭环”。

第一真源：
/Users/aoqimin/Desktop/Nomi-model-onboarding-20260828/docs/handoff/2026-08-28-conversational-model-integration-handoff.md

工作树：
/Users/aoqimin/Desktop/Nomi-model-onboarding-20260828
分支：codex/model-onboarding-20260828
观察时 HEAD：2b90a60dc88aa55b9c0d1cd1ffa002fea3ee6aff

先完整读取交接文档、设计、实施计划和 AGENTS.md。不要触碰共享主工作树，不要 reset/clean/rebase 当前未提交改动，不要恢复 manualCommit，不要 push main。

当前立即任务：
1. 核对 Task 4 未提交复审修复。
2. 重跑 pnpm run test。
3. build 后真实执行 ipc-split-smoke.e2e.mjs 和 newapi-relay.e2e.mjs。
4. 跑 pnpm run gates。
5. 针对交接文档 §5 的 10 项做 spec + quality 双审，修完全部 P0/P1 和相关 P2。
6. 提交 fix(onboarding): close certification bypasses，但暂不 push。
7. 严格按计划继续 Tasks 5–9，完成 Comfy、持久化 session/MCP/Skill、无仓库 harness、blind real-provider 多模型、packaged restart/upgrade。
8. 最终全验后 push 任务分支并开 PR，不直接 push main。

全程区分 implemented / verified / committed / pushed / merged；单模型成功、保存成功或 mock 成功都不能叫接入完成。
```

---

## 14. 当前最后结论

这项工作**仍未完成发布验收**，但 Tasks 1–8 的主要代码已在独立工作树实现。最新自动化证据为：全量 `880` 个 Vitest 文件、`8440` 项通过（1 skipped），agent-runtime `151` 项通过，typecheck、build、全量 `pnpm run gates` 均通过；新增 `model-integration-no-repo.mjs` 验证 43 tools/25 resources、签名 Codex draft、unsigned generic 写入拒绝和零 provider 请求；新增 `model-integration-packaged.e2e.mjs` 验证同 session/revision 的停止后重启读回和零重复 create；`mcp-skills-integration.e2e.mjs`、`ipc-split-smoke.e2e.mjs`、`newapi-relay.e2e.mjs` 仍分别通过既有断言；最新 arm64 `.app` 已通过 packaged MCP smoke（43 tools、25 resources、Claude/Codex/Cursor 三身份）。ComfyUI 多媒体走查在允许本机临时端口后真实启动，但旧 fixture 在新私网/认证边界下以 `provider_failed` + `submission_unknown` 结束，未发布未验证模型，不能计为 J2 通过，也不能通过放宽安全门来“修绿”。当前阻断项集中在 Task 9：BananaRouter/盲 provider J1、真实 ComfyUI J2、J3 完整发布级故障矩阵、升级后的正式生产调用，以及之后的提交/推送/PR 交付。此前记录的 `model-onboarding.walk.mjs` Playwright `Process failed to launch` 已不再复现；Electron 单实例诊断已补充，正式 userData 被已安装 Nomi 占用时应使用隔离 profile 或先关闭已有实例。真实 WorkBuddy 宿主与外部供应商凭据/ComfyUI 实例当前均未提供，不能伪造 live pass。没有这些证据，不能把当前自动化绿灯说成整体完成。

不要让后续实现重新变成“某供应商能保存就算接好”。这次工程的核心资产就是：**任何入口、任何供应商、任何模型，只有经过同一个可恢复、可审计、真实生产认证边界，才对用户宣称可用。**
