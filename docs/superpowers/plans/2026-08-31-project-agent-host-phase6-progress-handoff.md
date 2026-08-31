# Project Agent Host Phase 6 进度 Handoff（暂停 checkpoint）

> 日期：2026-08-31
> 状态：📎 交接/日志（按用户要求暂停并保存现场）；**不是 Phase 6 完成声明，也不是 PR ready/可合并声明**。
> 接手对象：下一位继续 Nomi Project Agent Host 的 AI 工程代理。
> 本文是当前实现、证据和未决风险的导航，不替代既有总路线图，也不授权合并、rebase、force-push 或直接推送 `main`。

## 1. 用户要求与暂停边界

用户最新指令是“停一下吧，把现在的提交上去，然后写一份详细的 hand-off 文档”。因此本 checkpoint 的目标是：

1. 保存当前工作树已有的 Phase 6 增量；
2. 记录真实核验过的事实、通过的 focused 证据和明确失败/未验证项；
3. 提交并推送当前任务分支；
4. 停止继续开发、UI 迭代、长时间走查、全量测试和任何付费 provider 请求。

本次不把“能创建计划”“loopback 返回了 task id”或“单元测试通过”写成真实 5 分钟成片已交付。真实 provider/media 证据仍未认证。

## 2. 恢复现场（先核验，不要清理）

唯一工作树：

~~~text
/Users/aoqimin/Desktop/Nomi-project-agent-host-phase1-20260827
~~~

禁止修改的主工作树：

~~~text
/Users/aoqimin/Desktop/Nomi
~~~

当前 Git/PR 事实（提交本 handoff 前的基线）：

| 项目 | 值 |
| --- | --- |
| 分支 | `codex/project-agent-host-phase1-20260827` |
| origin | `https://github.com/aqm857886159/Nomi.git` |
| 远端任务分支 | `origin/codex/project-agent-host-phase1-20260827` |
| PR | [#223](https://github.com/aqm857886159/Nomi/pull/223) |
| PR base | `main` |
| PR 状态 | `OPEN`、`Draft`（是否显示 `CONFLICTING` 由 GitHub 当前 main 漂移决定） |
| 提交前 HEAD | `0f8657826660e3bcd1ac015bd753c2ed37e619fd` |
| Phase 5 checkpoint | `63c825ce7aecbe1a6ca07446733c84d789090290` |
| 远端 head（提交前） | `0f8657826660e3bcd1ac015bd753c2ed37e619fd` |

提交完成后，以 `git rev-parse HEAD`、`git ls-remote` 和 `gh pr view 223` 的现场结果为准；不要把上表的提交前 SHA 当作最终 checkpoint SHA。

建议接手第一步：

~~~bash
cd /Users/aoqimin/Desktop/Nomi-project-agent-host-phase1-20260827
pwd -P
git branch --show-current
git rev-parse --show-toplevel
git remote get-url origin
git status --short --branch
git log -3 --oneline --decorate
gh pr view 223 --repo aqm857886159/Nomi \
  --json url,isDraft,state,headRefName,headRefOid,baseRefName,mergeable,statusCheckRollup
~~~

不要使用 `git reset`、`git checkout`、`git clean` 覆盖当前现场；不要从 `/Users/aoqimin/Desktop/Nomi` 复制文件来“修复”本 worktree。

## 3. 本 checkpoint 保存的实现范围

当前工作树是在既有 Phase 1–5 checkpoint 和已提交的 Phase 6 早期提交之上累积的增量。提交前工作树约为 157 个已修改/新增文件、约 9,875 行新增和 2,485 行删除；这不是一个已经拆分、审查并可直接合并的最终 diff。下面按能力边界记录其内容。

### 3.1 Capability / Host / transport

- 扩展 `electron/shared/agentCapabilities/` 的 generation、canvas、Skill read/write 合同和 canonical registry；模型可见 alias 不应再独立散落在 UI 或 descriptor 中。
- `electron/harness/tools/agentToolCatalog.ts`、generation/Skill descriptors 和 profile 投影统一从能力合同派生，保留稳定排序，支持目标驱动的 generation/storyboard/timeline/production profile。
- `electron/capabilityCore/` 增加/收拢 generation provider、live runtime、semantic generation preview/batch/storyboard、Skill read/write transport 和 adapter 工厂；写入仍必须经过 ProjectAgentHost，再由领域 owner 持久化。
- `electron/projectAgentHost/` 增加执行 policy、queue mutation reduction、trusted state/coverage 和 project 级 execution coordinator 的回归覆盖。
- RPC 旧的裸 `generate` 路径测试改为拒绝（404）；不能把旧 transport 当成生产 fallback。

### 3.2 ProductionRun、生成安全和重工 lineage

- `productionRunService.createGenerationDraft` 现在先合并 live policy resolver，再应用调用方的受限 policy；此前 semantic draft 会悄悄落到 repository 的默认预算/重试值，这是一个真实根因修复。
- `shotPricing.ts` 增加未知价格 fail-closed 错误；初次授权、重新授权、继续执行和 MCP `gate_request` 在 durable seal/authorization 前都必须确认每个 shot 可定价。
- APIMart generation 请求仍复用现有 provider/settings/key，不在 Agent 侧新增第二套供应商配置；未知模型/价格不能猜测或静默按零处理。
- 显式 rework job 保留 `attempt`、`retryCount`、`retryReason`、`parentJobId` 和 metadata，便于 ProductionRun、恢复和证据 evaluator 区分“第一次返工”与重复提交。
- single-shot observer/lifecycle、generation submission/query/output/projection 代码和测试已加入当前工作树，目标是让 task、receipt、artifact 和状态变化可追溯；这仍需要最终 GUI/真实 provider 验收。

### 3.3 Skill 统一目录与跨 transport 可见性

- `electron/skills/skillStore.ts` 增加 origin-aware discovery：repository/user roots、直接子目录 `SKILL.md`、确定性排序、无效高优先级回退、重复规范化和 `disableModelInvocation` 解析。
- `electron/harness/runtime/pi/nomiSkillResources.mts` 将同一 canonical discovery 投影给 Pi；MCP/Agent/Workbench 应使用相同的可见性、版本和内容 hash，不再各自递归扫描或从当前 cwd 注入 Skill。
- `skillReadTransportAdapters.ts` / `skillWriteTransportAdapters.ts` 和相关 IPC/descriptor 测试覆盖列出、读取、选择和写回边界。Skill 只能缩小权限，不能注册新能力或绕过 Host。
- 当前仍要警惕外部 MCP client 缓存旧 URI；切换后应 relist，不能自动重放旧内容。

### 3.4 运行时 fixture、证据和 APIMart canary contract

- `tests/ux/agent-runtime-fixture.mjs` 的请求记录现在包含脱敏后的 `method`、`statusCode`、结构化 `responseBody`/SSE 摘要和 GET task query，能把“请求发出”和“结果已被查询”区分开。
- `tests/ux/resident-production-evidence.mjs` 提供 fail-closed evaluator 和稳定递归 fingerprint，检查 synthetic/paid 声明、ProductionRun stages/jobs、provider request/hash/task query、receipt、脚本/分镜、媒体时长/差异、timeline 和 export sidecar 等证据。它目前是独立 evaluator，尚未完整接入 5 分钟 walk。
- `tests/transport-spike/apimart-real-canary-contract.cjs` 固化 test-only 的最便宜模型选择、参数到 APIMart wire projection、价格/审批/receipt/redaction 约束；contract test 不会发网络请求。
- 以上工具只建立证据门，不意味着已经运行真实付费 provider。任何真实 canary 仍必须另行记录 provider、model、input、预计支出和已有 receipt，并遵守最多一个新付费 job 的纪律。

### 3.5 UI 当前状态

工作树包含 resident shell、generation proposal editor、batch stack、reference chip、tool projection、progressive disclosure、onboarding/key-only 连接和部分 token/icon/animation 变更。但用户已经明确“UI 优化先不着急，先别做了”，且尚未对当前最终样张拍板。

因此接手后：

- 不要把本 checkpoint 的 UI 变更说成已与 PR #194/HTML 样张逐像素一致；
- 不要继续扩写文案、icon、间距或卡片布局；
- 不要删除或恢复旧外壳，除非下一轮重新拿到用户确认并按样张逐项走查；
- 任何 UI 交付仍必须满足：真实 Workbench 同构入口截图、人眼对账、窄窗口/light-dark/无障碍，以及真实用户任务闭环。

## 4. 真实任务证据：已做什么，不能声称什么

`tests/ux/resident-production-5min.walk.mjs` 是零额度 synthetic loopback 走查，设计目标是把自然语言目标拆成：

~~~text
目标 → semantic plan/preview/gate → 20 个 15 秒镜头 → QA fail-once
→ 明确的单镜 rework → assemble → timeline → export
~~~

此前运行曾推进到：

- isolated APIMart settings/key 读取成功（key 保存在本机 Electron safeStorage，未写入仓库/日志）；
- live policy 的 `maxAttempts=2` 被读到；
- 20 个镜头 job、一次 QA 失败和一次明确 rework lineage 被建立；
- loopback provider 记录了 21 个模拟提交/任务关联；
- ProductionRun stage、job、timeline artifact 具备可检查的中间状态。

但以下事实必须保留为未完成：

1. 这不是真实 APIMart 请求；没有真实 provider POST，也没有真实图片/视频交付。
2. 当前 fixture `electron/providerAdapter/__fixtures__/certification-media/valid.mp4` 的 ffprobe 时长约 0.2 秒且没有 AAC；不能拿它证明 20×15 秒或 5 分钟媒体成立。
3. walk 尚未完成最终 evaluator 接线（包括 `events(0)` 的完整因果 payload、ffprobe/framemd5、timeline/export sidecar）；之前的运行在后段等待/任务面板处被人为中止，不能写成 export 成功。
4. fixture 的同步 `/v1/videos` 响应使用 `video_id`，而异步路径使用 `task_id`；evidence 映射接手时必须同时覆盖两种字段，不能只看一种。
5. 没有 Playwright 截图的人眼审查，也没有证明 Creation → Generation → Preview 的真实 GUI 操作链已经可交付。

结论：当前可称为“ProductionRun/Host/adapter 的 loopback 编排证据和安全合同增量”，不可称为“5 分钟视频已生成”“真实用户任务已完成”或“PR 已 ready”。

## 5. 定向验证记录

以下命令在暂停前于本 worktree 运行过；结果只代表当前代码和当前环境，不替代最终全量门禁。

| 命令 | 结果 | 解释 |
| --- | --- | --- |
| `pnpm exec vitest run`（16 个 capability/Skill/ProductionRun/RPC 文件） | **16 files / 128 tests passed** | focused contract、adapter、RPC retirement、generation authorization/submission、Skill 路由通过；RPC 测试有预期的 planning warning 输出。 |
| `pnpm exec vitest run tests/ux/agent-runtime-fixture.test.mjs tests/ux/resident-production-evidence.test.mjs --reporter=dot` | **2 files / 20 tests passed** | fixture 脱敏/响应证据和独立 evaluator 通过。 |
| `node tests/transport-spike/apimart-real-canary-contract.test.cjs` | **7/7 passed** | 仅验证 selector、参数映射、审批/价格/脱敏合同；零网络、零费用。 |
| `node --check tests/ux/resident-production-5min.walk.mjs` | **passed** | 只证明语法，不证明 walk 完成。 |
| `node --check tests/ux/agent-runtime-fixture.mjs` | **passed** | 只证明语法。 |
| `git diff --check` | **passed** | 无 whitespace error。 |
| `pnpm run typecheck` | **passed** | app/electron/pi 三个 TypeScript 配置通过。 |
| `pnpm run check:docs-index` | **passed** | 462 篇方案，未收录基线未增加。 |
| `pnpm run check:doc-status` | **passed** | 缺状态数未超过基线。 |
| `pnpm run check:secrets -- --all` | **passed** | tracked 文件未发现明文凭证；用户提供的 key 未写入代码。 |
| `pnpm run check:ponytail-review` | **9/9 node tests passed** | hook/installer 合同通过；实际 hook 是否已安装以目标机器 `.git/hooks` 现场为准。 |
| `pnpm run check:root-cause-contracts` | **failed（已知历史门禁）** | 当前分支继承的 8 份 `2026-08-29/30` schema-v2 根因合同被新门禁视为 legacy；不是本次 handoff JSON 的 schema 校验失败，不应通过 reset/改写历史绕过。 |

明确未运行：

- `pnpm run test:system:full`
- `pnpm run dist:mac:dir`
- `pnpm run test:system:release`
- 全仓 `pnpm test` / 全量 GUI/Playwright 走查
- 任何真实 APIMart 图片/视频付费 job
- main merge、rebase、force-push、PR approve/merge/close

这些是用户要求的暂停边界，不是“已经通过”的证据。

## 6. 安全和费用纪律（接手必须继续遵守）

- 本机已有 APIMart 设置/密钥时只通过现有设置和 safeStorage 读取；不要把 key 写入源码、fixture、报告、commit message 或聊天输出。
- “最低价模型”仅用于零额度/低成本测试选择；真实产品行为仍使用用户设置的默认模型，或使用用户明确选择的模型，不能把 test selector 当成产品默认策略。
- 真实付费候选最多创建一个新的 provider job。运行前记录 provider、model、输入、预计支出和既有 receipt；一旦出现第二 job、重复/未知 receipt、`submission_unknown` 或 provider/model/价格越界，立即停下做 reconciliation，不要靠重跑判断。
- 已批准但状态未知的旧操作绝不自动重试；ProductionRun“恢复”只允许读取、核账和关联既有 run/job/receipt/artifact。
- synthetic 证据必须显式标记 synthetic；任何没有文件、时长、任务状态和 receipt 的“完成”文案都视为假成功。

## 7. 接手后的推荐顺序（不要现在执行）

1. 先重新核对本 handoff、总路线图、PR #194 设计合同和当前 Git/PR head；确认本 checkpoint 没有被 main 或其他 worktree 覆盖。
2. 修正/补齐 `resident-production-5min.walk.mjs` 的证据接线：`responseBody` task id、同步 `video_id`、完整 ProductionRun events payload、真实可验证的时长/画面差异、timeline/export sidecar；每一步失败就 fail-closed。
3. 换用有足够时长和画面差异的零额度 fixture，重新跑 5 分钟逻辑链；只能报告“逻辑时长/镜头数证据”，不能把 loopback 媒体冒充 provider 成片。
4. 让独立用户审计 Agent 和设计审计 Agent 读取同一 trace/截图/状态快照，分别从可理解性、任务完成、密度、层级、无障碍和 PR #194/设计系统对账；只修当前合同 P0/P1，并做 scoped re-review。
5. 在 GUI 入口真实执行小猫头像、只规划不生成、指定模型/参数、单镜重工、Skill/Prompt、队列编辑/取消/Stop、跨 Creation→Generation→Preview、时间线导出等用户任务；不能用内部 API 代替 UI 输入。
6. 只有用户重新确认 UI 样张和真实 provider 测试条件后，才考虑一次最小 paid canary；复用其 task/receipt/artifact 完成人工旅程，绝不第二次提交同类任务。
7. Phase 6 implementation review、最终 candidate review 各只做一次 broad review；P0/P1 只做同 reviewer 的 scoped re-review。最后才按既定规则 pin `origin/main` 并一次 `git merge --no-ff`，仍禁止 rebase/force-push。

## 8. 保护项与提交说明

以下既有 handoff/路线图文件必须保留，不能 reset、checkout 或覆盖：

- `docs/README.md`
- `docs/plan/2026-08-29-project-agent-host-execution-roadmap.md`
- `docs/superpowers/plans/2026-08-28-project-agent-host-handoff.md`
- `docs/superpowers/plans/2026-08-30-project-agent-host-phase6-handoff.md`
- `docs/plan/2026-08-30-project-agent-host-real-user-acceptance.md`

本文件随当前代码增量一起提交。提交后必须再次确认：

~~~bash
git status --short --branch
git rev-parse HEAD
git ls-remote origin refs/heads/codex/project-agent-host-phase1-20260827
gh pr view 223 --repo aqm857886159 \
  --json url,isDraft,state,headRefName,headRefOid,baseRefName
~~~

工作树若仍有变更，必须在最终回复中逐项说明，不能说“已 clean”。下一位代理从这里继续时，先读本文件，再读总路线图；不要重新规划 Phase 1–5，也不要把本 checkpoint 当作最终交付。
