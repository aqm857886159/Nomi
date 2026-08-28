# Nomi 项目级常驻 Agent 完整交接（2026-08-29 修订）

> 状态：🚧 持续实施（本地切片已提交/待提交，Draft PR #223 因 GitHub HTTPS 超时暂时落后）
> 用途：在当前任务额度耗尽或上下文丢失时，让下一位 Agent 从真实冻结点继续，不重做已完成切片，也不把尚未审完的工作误报为完成。
> 工作树：`/Users/aoqimin/Desktop/Nomi-project-agent-host-phase1-20260827`
> 分支：`codex/project-agent-host-phase1-20260827`
> 当前 HEAD：动态读取 `git rev-parse HEAD`；不要使用本文件里的旧冻结 hash 复位工作树
> 远端分支：`origin/codex/project-agent-host-phase1-20260827`
> Draft PR：[#223](https://github.com/aqm857886159/Nomi/pull/223)
> 远端冻结点：`ad5e6f31`；本地至少领先 `2d8cc85e`、`e46993c6`、`02f6080e`，后续切片以当前 Git 状态为准。
> 最后统一状态：Phase 1 / 2A foundation 已在分支；Phase 2B 已完成单 Host/IPC、崩溃可恢复迁移、请求作用域绑定、旧 conversations writer 与 renderer chatV2 执行链删除。剩余 blocker 是两面板仍通过本地 `creationAiMessages` / `generationAiMessages` 和各自 pending owner 间接显示 Host 状态，尚未改成 direct projection selector。

## 0.1 2026-08-29 真实快照与加速规则

这份交接曾把“设计阶段边界”误当成“代码快照边界”：文档写着 Phase 2B 生产代码为 0，但当前快照已经包含：

- `electron/main.ts` 中的 `installProductionProjectAgentHost()`、迁移 prepare hook 和生产 IPC 注册；
- `electron/projectAgentHost/projectAgentProductionRuntime.ts`、`projectAgentIpc.ts`、`projectAgentExecutionCoordinator.ts`；
- preload/desktop bridge、`NomiStudioApp` 的 open/release/patch 接线和 projection store；
- 旧 conversations renderer writer、chatV2 preload/bridge/stream/client 已删除；主进程旧 conversations 文件只作为迁移输入。
- `workbenchAgentRunner` 与 single-shot callers 已切到 Host queue / projection / tool decision / stop，真实 usage 与 finish metadata 由 Host 终态后的非 owning `execution-result` 事件返回。
- 当前仍是 2B 半成品，因为 `projectAgentUiProjection` 还把 Host snapshot 复制进两个本地 message store，两个面板也仍分别拥有 pending call view state。

从现在起采用以下加速规则：

1. **不再用全量测试驱动日常开发。** 日常只跑当前切片的 focused tests；切片结束再跑一次该切片的静态门岗、类型检查和相关集成测试；完整 `gates`、`build/package`、真实用户旅程只在最终候选提交跑一次。
2. **不回滚当前 checkpoint，也不重做 2A。** 先把现有代码按真实边界重新归类，再沿最短关键路径完成 2B 原子 cutover。
3. **一个切片只解决一个 owner 问题。** 任何测试红必须先判断是实现缺陷、门岗误报、环境抖动还是阶段边界错误；同一红连续出现两次就暂停加测试，先修根因或拆切片。
4. **性能阈值不再作为 reducer 单测的硬墙钟。** 保留结构/复杂度不变量；耗时只做独立 benchmark，避免机器负载把正确实现反复打红。
5. **当前 Draft PR 只负责保存现场，不是合并目标。** 后续提交可以继续推到同一任务分支，但每个提交必须对应一个可解释的切片；未完成前保持 Draft。

### 加速后的唯一关键路径

```text
快照对账与边界纠正
  -> 2B 单 Host/IPC 基础收口
  -> 原始历史迁移 + projection 接管
  -> 两面板原子切换并删除旧 writer
  -> Phase 3 只读/可撤写能力
  -> Phase 4 ProductionRun/付费
  -> Phase 5 Skill/MCP 派生
  -> Phase 6 UI 与最终真实旅程
```

Phase 2A 的独立审查仍要补，但它不再作为重新扫描整棵仓库的前置条件；只针对 Host reducer/repository 的合同做一次 focused review，确认后立即进入 2B。生产接线已有的部分不再继续扩张，直到 owner/cutover 切片把旧 writer 关掉。

## 0.2 历史 PR 证据门（Phase 5 / Phase 6 前强制执行）

**持续注意点：后续做 MCP、Skill、Registry 以及 UI 时，必须先回看现有相关 PR 的核心问题、review 争议和方案判断。** 这些 PR 可能落后于最新 `main`，但其中记录了此前实际暴露的严重问题和当时形成的解决思路；它们不是可直接合并的代码基线，却是不能丢失的问题证据与方案输入。尤其 UI 先以已经设计并拍板的界面和真实运行截图为基准，只有发现行为或信息层级缺口时，才按设计系统补充调整。

进入 Phase 5 或 Phase 6 前必须：

1. 枚举当前 open PR 与近期相关的 closed / merged PR，阅读标题、描述、changed files、关键 diff、review 讨论和其中新增的设计/审计文档；不能只搜索当前工作树。
2. 产出 `docs/audit/<date>-project-agent-pr-evidence.md`，逐项记录“原问题 / 根因判断 / PR 中的方案 / 相对最新 main 的漂移 / 本轮采纳、调整或淘汰结论 / 对应实现与测试”。没有结论的相关 PR 不能静默略过。
3. 实现一律以届时最新 `origin/main` 和本任务已冻结合同为代码基线。历史 PR 只做证据和设计输入，禁止整分支盲目合并、机械 cherry-pick，或让旧实现恢复第二套 owner / fallback。
4. UI 先以现有已设计、已拍板的界面和真实运行截图为第一基准；只有证据表明行为或信息层级不足时，才按 `docs/design/nomi-design-system.md` 补齐，并重新出真实布局样张验收。不得因为 PR 落后 `main` 就忽略其中已经验证过的 UI 摩擦和设计取舍。

本轮一次性审计已固化为 [`docs/audit/2026-08-29-project-agent-pr-evidence.md`](../../audit/2026-08-29-project-agent-pr-evidence.md)，覆盖清单见 [`docs/audit/2026-08-29-project-agent-pr-coverage-index.md`](../../audit/2026-08-29-project-agent-pr-coverage-index.md)。Phase 5 / Phase 6 的 round contract 必须列出这两份文档，并在届时只补新增/更新 PR 的增量；缺失即 hard fail，不得开始实现。

## 0.3 当前最短续跑点

1. 删除 `projectAgentUiProjection` 对两个 message store 的写入，让 Creation / Canvas 两面板直接用共享 projection selector 渲染同一 Thread / Item / Queue。
2. 把两个面板各自的 pending tool-call view owner 收成 Host event + proposal/item projection；保留领域执行器，但不能再由面板决定 pending 生命周期。
3. 删除 `creationAiMessages` / `generationAiMessages` 及其 setters、hydrate/reset 分支和结构债；扩展 cutover structure test，注入任一旧 message/pending owner 都必须变红。
4. 只跑上述切片的 panel/projection/approval tests、双 typecheck、owner/vocabulary gate；通过后做 Phase 2B focused spec/quality review。全量 gates/build/package 继续留到最终候选。

## 0.4 2026-08-29 执行流程 v2（防止 reviewer 逐轮补洞）

此前 direct projection checkpoint 连续出现 `Round 01 -> 02 -> 03 -> 04`，不是因为同一测试反复不稳定，而是合同先按文件切、reviewer 后置，导致 failure terminalization、卡片真实渲染、anchor 生命周期和 receipt 重启恢复这些相邻依赖一次只暴露一个。后续禁止沿用这种微切片串行。

从现在起：

1. **阶段合同按完整用户不变量写，不按文件写。** 每个阶段实现前同时覆盖 semantic owner、持久化/重启、transport authority、生命周期/竞态、项目切换、用户可见 projection、旧 owner 删除和验证表面。
2. **reviewer 前置。** worker 写生产代码前，先让 skeptical reviewer 审完整 closure contract；缺失依赖先补合同，不能留到实现后逐轮发现。
3. **一个阶段一个 build batch。** 同阶段新发现的 P0/P1 汇总进同一 remediation batch；不再为每个相邻问题单开 Round。RED/GREEN 只跑直接失败文件，batch 稳定后才跑一次 affected focused matrix。
4. **终审默认只读。** reviewer 优先消费 worker 的命令与结果证据，只补跑缺失/有争议的检查，不机械复跑整套 focused tests。
5. **远端 checkpoint 只落在闭环边界。** 仓库规则要求 push 前跑完整 gates，因此不为中间修复消耗 full gate。计划只在 Phase 2B、Phase 4（含 Phase 3）和最终 Phase 6 候选形成远端 checkpoint。
6. **实现时不追 `main`，checkpoint 时只整合一次。** 日常 `fetch` 只判断是否有直接重叠的高风险改变，不在 implementation lane 中 merge/rebase。Phase 2B / Phase 4 / Phase 6 各自完成 focused closure 后，再整合当时最新 `main` 一次、保留重叠行为、跑一次 push gate 并推远端。这样既遵守仓库 push 规则，也不会在开发循环里永远追 main。
7. **历史 PR 证据只审一次。** Phase 5 前统一审 MCP / Skill / Registry / UI PR，产出 §0.2 要求的 evidence 文档，Phase 6 复用并补增量，不重复做两轮同源审计。

8. **每个 lane 先做调用面清单，再开始 RED。** 清单同时覆盖生产调用点、测试 fixture、结构/词汇门岗和删除债，并逐项标记迁移、删除或保留。这样契约字段或 owner 变化不会靠全量测试逐个暴露下游缺口。
9. **证据按 lane 复用，阶段出口一次冻结。** 每个 lane 维护一次命令/文件/结果账本；worker 的 GREEN 证据由只读 reviewer 消费，只补跑缺失或有争议的检查。阶段出口固定为 affected focused matrix + typecheck + scoped lint + owner/vocabulary + diff check + 一次 consolidated remediation，然后才整合当时最新 main 并跑 full gate。

当前 Phase 2B 不再按旧 §0.3 的单文件续跑点零散推进，统一以：

- `.agents/runtime/harness/project-agent-host-20260829/execution-protocol-v2.json`
- `.agents/runtime/harness/project-agent-host-20260829/phase-2b-closure-contract.json`

为实施与验收合同。当前 Round 01-04 工件保留为失败证据，不再继续扩出 Round 05；先完成 closure contract 预审，再用一个 Phase 2B implementation batch 收口 receipt、Creation pending owner、Canvas lifecycle、项目切换/重启和结构门岗。

---

## 0. 一句话真相

Nomi 要从“创作面板一套 Agent 状态、生成画布又一套 Agent 状态”迁成一个项目级常驻 Agent：用户切创作、生成、预览或重启应用时，看到的仍是同一个线程、同一条排队消息、同一项审批和同一个任务；Pi、MCP、renderer 也不能各自拥有第二套能力合同或执行器。

当前不是“做完了”，也不是“丢了”。代码已保存在本地任务分支；Draft PR #223 仍在，但远端因网络超时落后。后续改动继续在该任务分支进行：

- Phase 1 已证明一项真实能力 `canvas.read` 可以由 Pi / MCP / renderer 共享同一可信调用和 main-only executor，并删除旧执行链。
- Phase 2A 已搭好离线 ProjectAgentHost 的状态机、FIFO、流式 Assistant、幂等命令账本和崩溃安全持久化。
- Phase 2B 已把 Host 接入产品并删除旧持久化/执行 writer；还差两面板直接 selector 与 pending view owner 收口，不能把兼容 message 镜像当最终 cutover。

因此下一步不是重做方案，也不是直接画新 UI；下一步是完成 §0.3 的两面板 direct projection cutover，再做一次 Phase 2B focused 双审。

---

## 1. Phase 2A / 2B 到底分别干什么

### Phase 2A：先造“可靠的大脑和账本”，但不接产品

Phase 2A 解决的是底层可信性：

- 一个项目只有一份 Thread / Turn / Item / queue / proposal-ref 状态；
- 忙时第二条消息能排队、编辑、取消，不会重复执行；
- Assistant 流式文本用稳定 Item 和 `textRevision` 追加，结束时与 Turn / Queue 同一原子提交；
- 每条 mutation 带 revision / commandId，重复请求只回放，不能重复做事；
- 主 snapshot、备份、append-only command ledger 在崩溃、fsync、rename 失败后仍能判断“到底提交没提交”；
- 文件权限为私密模式，symlink / hardlink / 损坏账本 fail closed；
- Host 只保存 document / canvas / ProductionRun 的 ref，不复制业务真相。

这阶段故意只在 fixture / offline store 中运行，不注册生产 IPC、不改真实用户项目。用户暂时看不到新界面，这是为了先证明状态不会乱、不会重复、不会丢。

### Phase 2B：把“大脑”接进产品，并一次性关掉旧双写

Phase 2B 才解决用户真实摩擦：

- Electron 主进程安装唯一 process-wide ProjectAgentHost；第二个 owner 在注册 IPC / repository / Surface 前同步失败；
- 创作页和生成画布都改读同一个 Host projection，不能再各自 `setMessages`；
- 旧 `30 条创作 + 30 条生成` 历史按原始 bytes 迁移，不再走会裁剪记录的 normalize；
- 迁移 manifest 发布前旧 owner 是真相，发布后 Host 是唯一真相；不能双写、不能 feature-flag fallback；
- `committedProposal` 先迁到 proposal / Undo 独立 owner，不能随着旧 conversations writer 删除而丢失；
- 旧面板必须先能渲染共享消息、queue 编辑/取消、审批、停止、TaskRef、冲突、附件和历史，之后才允许删旧 writer；
- Phase 2B 是原子产品 cutover，不是“先接新 Host，再以后慢慢关旧链”。

核心取舍很简单：**2A 防止新大脑自己出错；2B 防止新旧两个大脑同时说了算。**

---

## 2. 总路线与当前进度

唯一总设计：

- `docs/superpowers/specs/2026-08-27-project-agent-host-design.md`
- Phase 1 文件级计划：`docs/superpowers/plans/2026-08-27-canvas-read-capability-spine.md`
- 当前架构：`docs/ARCHITECTURE-NOW.md`

| 阶段 | 目标 | 当前真实状态 | 下一放行条件 |
|---|---|---|---|
| Phase 0 | 语义 owner 门岗 | 已完成 | 保持 vocabulary / owner gate 不退化 |
| Phase 1 | `canvas.read` 单一能力脊梁 | 实现已在 checkpoint 中；最终 build/package 发布验收未做 | 只在 Phase 2B cutover 后统一跑 B6 真实 dev/package journey |
| Phase 2A | 离线 ProjectAgentHost foundation | reducer/repository/queue/assistant 代码已在 checkpoint；独立 spec/quality review 未完成 | 只做 Host focused review + focused gates，一次放行 |
| Phase 2B | 单 Host 生产接线、迁移、旧 writer 原子删除 | Host/IPC、迁移、请求 scope、旧 persistence/chatV2 writer 删除已完成；两面板仍有 message/pending 兼容 owner | 两面板改 direct projection selector，删除本地 message/pending owner，再做 focused 双审 |
| Phase 3 | 其余只读与可撤写能力 | 未开始 | 2B 完整 cutover 后逐能力迁移并删旧 owner |
| Phase 4 | 破坏性/付费能力统一到 ProductionRun | 未开始 | receipt、precondition、typed cancel、TaskRef、artifact truth |
| Phase 5 | Skill / MCP 从 Registry 派生 | 未开始 | 先过历史 PR 证据门，再完成 list/read guard、shrink-only、删除 legacy route |
| Phase 6 | 新常驻 UI | 未开始 | 先过历史 PR 证据门；基于既有设计和 2B 已验证行为出真实样张并由用户拍板，再替换旧面板 |
| 最终交付 | 一条 PR + 真实任务/恢复/隐私/打包验收 | 未开始 | 历史 PR 结论全部闭环；全门、真机、package、跨项目、重启、MCP 隐私、付费审批全部通过 |

---

## 3. Phase 1 已完成了什么

### 3.1 单一 `canvas.read` 合同与可信执行链

本工作树已经完成：

- canonical capability contract / aliases / effect / safe projector；
- `ProjectSessionRuntime`、signed lease、connection attestation、UUID/generation/root freshness；
- `VerifiedCapabilityInvocation` exact-object runtime brand；
- main-issued `SurfacePortBinding`；
- `CapabilityExecutorRegistry` main-only executor；
- Pi / MCP direct / MCP loopback / local bearer 都走同一 executor；
- captured storyboard snapshot 由 main seal 为一次性 opaque handle，避免 prompt 读 A、tool 却读 B；
- renderer read-only request/reply channel，迟到 reply / reload / navigation / wrong frame 全部拒绝；
- immutable per-token lease store，去掉共享 JSON ledger 和 ProductionRunLock 依赖；
- capability owner gate 从 2 项 debt 收到 0，并用 mutation 证明第二 executor / alias / route 会变红；
- 删除旧 renderer live/captured adapter、旧 gateway adapter、dispatcher legacy/verified route 和 renderer tool switch。

### 3.2 Phase 1 的诚实边界

可以说“Phase 1 实现切片完成并冻结”，不能说整个项目已经完成或已经发布：

- 没有 commit / push / PR；
- 没有在这一 checkpoint 上跑 build/package；
- B6 已补 journey 文件与 CI/RC 接线，但最终真实 packaged GUI journey 应在所有阶段结束时再跑；
- `docs/superpowers/plans/2026-08-27-canvas-read-capability-spine.md` 仍显示 B6 验收中，最终交付前需更新文档状态并重建 ledger。

历史审查证据（来自完成各切片时的 fresh runs，交接后仍应按最终快照重跑）：

- B4 最终 focused：38 files / 322 tests；3 套 tsc；owner、lint、filesize、diff 全绿；
- B5 最终 changed matrix：69 files / 720 tests；owner 125/125，7 canonical owners / 0 debt；
- B6 capability-core focused：11 files / 111 tests；`check:test-types`、Electron tsc、lint、filesize、wait gate 全绿；
- B6 GUI / packaged journey 代码已写入 `tests/ux/project-agent-canvas-isolation.e2e.mjs` 与 `tests/ux/packaged-mcp-smoke.e2e.mjs`，但不要把“源测试存在”冒充“最终 package 已实跑”。

---

## 4. Phase 2A 当前实现

### 4.1 主要文件

共享合同：

- `electron/shared/projectAgentContracts.ts`
- `electron/shared/projectBinding.ts`
- `electron/shared/capabilityTargeting.ts`

Host / reducer / state：

- `electron/projectAgentHost/projectAgentHost.ts`
- `electron/projectAgentHost/projectAgentState.ts`
- `electron/projectAgentHost/projectAgentReducer.ts`
- `electron/projectAgentHost/projectAgentQueueEditReduction.ts`
- `electron/projectAgentHost/projectAgentTurnStartReduction.ts`
- `electron/projectAgentHost/projectAgentAssistantAppendReduction.ts`
- `electron/projectAgentHost/projectAgentAssistantFinalReduction.ts`
- `electron/projectAgentHost/projectAgentTrustedDeltaCoverage.ts`
- 其余同目录 invariant / validation / snapshot / test 文件。

持久化：

- `electron/projectAgentHost/projectAgentRepository.ts`
- `electron/projectAgentHost/projectAgentCommandLedger.ts`
- `electron/projectAgentHost/projectAgentContextBinding.ts`
- `electron/jsonFile.ts`

### 4.2 已实现的不变量

- ProjectBinding exact 三字段、canonical lowercase UUID、generation、trim 规则；area-free。
- mutation 闭集包含 `thread.activate`、`queue.edit`、`turn.start`、`assistant.append`。
- `AssistantItem.textRevision` 与 `async.result.assistantFinal`。
- `active-thread-changed` 是显式 patch，不由 renderer 猜。
- queue.edit 只允许 renderer 编辑仍在 FIFO 中的 UserItem，保持冻结执行输入不变。
- turn.start 原子创建 running Assistant，并校验 FIFO / execution token。
- assistant.append 对 executionToken + expectedTextRevision 做 CAS。
- assistant final 与 turn / queue terminal 状态同一提交。
- proposal expiry / decline 会同步终结 running assistant；generic transition 不能绕过 proposal/assistant 状态机。
- full + trusted assistant lifecycle：queued 无 assistant；running/proposed 恰一条 running assistant；done 恰一条 done assistant；失败/停止/拒绝只允许合同允许的终态。
- executionToken 全 snapshot 唯一。
- trusted delta 必须精确覆盖真实 state 变化，隐藏 add / replacement 会拒绝。
- receipt window 只保留最近 64 条 full patch；旧 command 由 compact ledger replay，返回 `snapshotRequired:true`，不伪造空 patch。
- append-only command ledger、checksum chain、high-water、prepared tail recovery。
- main 是唯一 publish point；post-publish durability error 标记 committed，重试只 replay。
- snapshot / backup / ledger 0600；目录 0700；symlink / multi-hardlink / checksum / malformed envelope fail closed。
- atomic writer 任意 write/fsync/fchmod/rename 失败都会清 temp。
- 1000 次同实体更新 snapshot 有界，不再把全 command history 塞进 snapshot。

### 4.3 最后主代理 fresh 验证（历史记录，不代表当前快照全绿）

在 state 最终 freeze 后运行：

```bash
pnpm exec vitest run electron/projectAgentHost electron/jsonFile.test.ts
pnpm exec tsc -p electron/tsconfig.json --noEmit
pnpm run check:test-types
pnpm run check:vocabularies
pnpm run check:filesize
```

结果（当时的阶段性证据，当前 checkpoint 已扩展到 2B 预接线，不能直接复用）：

- Vitest：13 files / 114 tests PASS；
- Electron tsc：PASS；
- test types：src 0、agent runtime 0、既有 baseline 88，PASS；
- vocabulary：54/54 tests、169 owners，PASS；
- filesize：PASS；
- Phase 2A scoped ESLint `--max-warnings=0`：PASS；
- Phase 2A scoped Prettier：PASS；
- scoped `git diff --check`：PASS。

实现代理自己的最终性能证据：

- 1000 次 repeated update：53ms；
- 1000 次 enqueue：388ms（门限 <1s）；
- reducer 732 行、state 690 行、contracts 407 行。

### 4.4 不能漏写的审查状态

Phase 2A **目前不能写成双审 PASS**。

最新独立规格 reviewer 因用户要求立即交接而中断，明确结论是：

> NOT SPEC PASS — review interrupted before implementation-body validation.

它没有确认新的 P0–P2 缺陷，但也尚未逐项验证 reducer atomicity、patch exact coverage、proposal race、async CAS、frozen snapshot、ledger recovery、权限/link 防御、malformed closure 与性能。因此下一轮必须从规格审查继续，不能直接进入 2B。

持久化子切片曾由独立 reviewer 在当时快照跑 12 files / 103 tests + Electron tsc 并给出 APPROVED；但 state 后续又新增了 queue/edit/assistant/active-thread 合同，所以仍需一次最终统一 quality review。

---

## 5. 工作树与 Git 现场

### 5.1 当前现场

```text
worktree: /Users/aoqimin/Desktop/Nomi-project-agent-host-phase1-20260827
branch:   codex/project-agent-host-phase1-20260827
HEAD:     a7a07cc4446f865fcbba528299ad9a73133ef6ea
origin:   527ae52f67dd8e5053049a3f0003bd13f0d7873b
ahead/behind (origin/main...HEAD): 2 / 0
tracked modified entries: 123
untracked entries: 86
tracked diff only: 123 files, +7410 / -2810
```

`git diff --stat` 不包含 86 个 untracked entry，所以不能用它估算全部改动量。

### 5.2 绝对禁止

- 不要在 `/Users/aoqimin/Desktop/Nomi` 的共享 main 工作树 reset / checkout / commit 这批文件。
- 不要 `git reset --hard`、`git clean`、丢弃 untracked 文件或覆盖并行改动。
- 不要直接 rebase 这个任务分支；先完成当前切片，再从最新 `origin/main` 建独立集成 worktree。
- 不要把 origin/main 的 2 个新提交机械 merge 到脏树后继续改；先看冲突范围和用户现有改动。
- 不要在 Phase 2A 双审前注册生产 IPC。
- 不要为了临时通过 Phase 2B 同时保留 Host writer 和旧 conversations/chatV2 writer。
- 不要创建第二套 project/session/approval/run owner，也不要给兼容链加 feature flag fallback。
- 当前已有 Draft PR #223，仅用于保存现场；不要把 Draft 改成 ready，也不要合并，直到完整垂直切片与最终门岗通过。

### 5.3 Goal 的 UI 状态

Codex goal 元数据当前显示 `paused`，这是用户此前担心额度时留下的任务状态，不代表文件丢失，也不是代码阻塞。续跑时即使 UI 仍显示暂停，也应以本交接和工作树为真相继续；只有真正需要用户产品决策、不可逆取舍或独有资源时才停。

为避免额度耗尽后每 5 分钟继续自动运行，交接时已把 heartbeat automation `nomi-agent` 从 `ACTIVE` 改为 `PAUSED`。下一轮应在读完本交接、确认要继续后再手动恢复；不要另建一个重复 automation。

---

## 6. Phase 2B 精确 handoff

### 6.1 开始前先补两个小合同

当前 2A 合同还缺：

1. Thread 显式 `legacy/read-only provenance`，不能靠标题或 ID 前缀猜；
2. thread / turn / item / queue removal changes 与 archived-thread delete mutation。

它们属于 2B 首片，不应回滚已冻结的 queue/assistant/active-thread 语义。

### 6.2 第一条 meaningful RED

先新增：

`electron/projectAgentHost/projectAgentProductionRuntime.test.ts`

必须先红于“production runtime 尚不存在”，随后最小实现：

1. 第一次 `installProductionProjectAgentHost()` 成功；
2. 第二次同步抛 `project_agent_owner_conflict`；
3. 第二次调用前后 IPC handler 数、repository factory 调用数、Surface subscription 数都不变；
4. BrowserWindow 销毁/重建不重新安装 Host；
5. 多项目 attach 只增加 partition，不增加 owner。

这是 Phase 2B 的第一原则：**第二 owner 必须在产生任何副作用前失败，不能依赖后续 CAS 碰撞。**

### 6.3 生产安装点

新增建议模块：

- `electron/projectAgentHost/projectAgentProductionRuntime.ts`
- `electron/projectAgentHost/projectAgentRepositoryRouter.ts`
- `electron/projectAgentHost/projectAgentExecutionCoordinator.ts`
- `electron/projectAgentHost/projectAgentIpc.ts`

安装顺序：

1. 在 `electron/main.ts` 的 `registerIpc()` 开头；
2. 先 `registerDesktopCanvasReadRuntime()`，拿到现有 Surface capture / registry / executor；
3. 紧接着仅一次 `installProductionProjectAgentHost(...)`；
4. 必须发生在首个 `createWindow()` 之前；
5. Host 生命周期绑定 app process，不绑定 BrowserWindow。

`canvasReadMainRuntime.ts` 保留 Surface IPC/main-only executor，但应把 `surfaceCapture` 注入 Host，并删除 `registerAgentChatV2Ipc()` 的生产注册。`agentChatV2.ts` 可保留为内部模型 runtime；`agentChatV2Ipc.ts` 不能继续当生产 owner。

### 6.4 IPC 边界

建议唯一 IPC：

```text
nomi:projectAgent:open
nomi:projectAgent:snapshot
nomi:projectAgent:command
nomi:projectAgent:release
nomi:projectAgent:patch
```

renderer command 只传：

```ts
{
  subscriptionId,
  clientCommandId,
  knownRevision,
  type,
  payload,
}
```

renderer 不得自报 raw mutation、sender、ProjectBinding 或 occurredAt。main 必须用现有 Surface owner 校验 sender/process/frame/origin，再注入 binding/time/policy。

### 6.5 renderer 原子 cutover

新增：

- `src/workbench/ai/projectAgentClient.ts`
- `src/workbench/ai/projectAgentProjectionStore.ts`
- `src/workbench/ai/projectAgentUiProjection.ts`

`NomiStudioApp.hydrateProject` 的顺序：

1. 同步 suspend 当前 Surface；
2. 删除旧 conversation flush/swap/load；
3. 捕获 `commitCanvasRead()` 返回的 exact binding；
4. `await projectAgentClient.open(binding)`；
5. main 完成 migration/open 后一次性安装 snapshot；
6. Host open 成功后才启 background repair；
7. release 项目时 release Host subscription，不再 flush conversations。

CreationAiPanel 与 CanvasAssistantPanel 都改为同一 projection selectors + semantic commands；stream 只由稳定 Assistant Item patch 驱动，不能再 `setMessages(map...)`。`active-thread-changed` 必须原子应用，patch 的 binding/previousRevision 不匹配时取 snapshot，renderer 不自行 merge。

### 6.6 旧 30+30 历史迁移

新增：

- `projectAgentLegacyConversationReader.ts`
- `projectAgentLegacyContextReader.ts`
- `projectAgentMigration.ts`
- `projectAgentCutoverManifest.ts`
- proposal/Undo 独立 receipt store
- `projectAgentContextAdapter.ts`

顺序不能变：

1. `open(binding)` 重验 canonical root/identity；
2. 获取项目独占 `project-agent-cutover.lock`；
3. 直接读 `.nomi/conversations.json` 和 `.nomi/agent-session.json` 原始 bytes，先 hash，再 UTF-8 fatal decode/parse；
4. **不能调用 `normalizeToV2()`**，它会裁 200 messages / 30 threads；
5. creation/generation 各 30 条都导入，新 ID 包含 project identity + legacyArea + oldThreadId；
6. legacy thread 永久只读，“继续”只能 fork 新统一线程；
7. 只有精确唯一且 codec 验证通过的旧 context 才映射，否则建干净 canonical context；
8. 分别 staging Host/context/proposal receipt，校验 + fsync；
9. 最后只 atomic replace 一份 cutover manifest；
10. manifest 前旧 owner 为真，manifest 后 Host 为真；旧文件保留只读；
11. 重启依据 source hashes/manifest 幂等恢复，不重放 tool/approval。

### 6.7 必须同一 cutover 删除/禁用的旧 owner

| 旧链 | 新 owner | 必删/禁用 |
|---|---|---|
| `registerAgentChatV2Ipc` sessions/pending | execution coordinator | chatV2 start/confirm/cancel/clear/seed/alive/event 生产注册 |
| `registerConversationsIpc` | Host + raw migration reader | conversations read/write IPC |
| preload / desktop old bridge types | ProjectAgent bridge/DTO | 旧 conversation/chatV2 methods |
| `desktopAgentsChatStream` | ProjectAgent command/patch | renderer 直连 stream writer |
| `conversationPersistence.ts` | Host repository | 全文件生产可达性 |
| `conversationThreads.ts` | Host Thread | 全文件生产可达性 |
| creation message bucket | shared projection | workbenchStore message/thread writer |
| generation message bucket | shared projection | canvas store / generation conversation writer |
| `creationTurnController.ts` | coordinator/Host | creation turn/pending owner |
| `canvasTurnController.ts` + panel pending maps | coordinator/Host | canvas turn/pending owner |
| area history APIs | unified thread commands | area-specific history actions |
| `agentSessionKey.ts` area identity | area-free context binding | workbench 生产调用 |
| conversations 内 `committedProposal` | proposal/Undo receipt owner | 混合持久化字段/写入 |
| `_agentProbe` / eval 旧直连 | 同一生产 IPC | chatV2 direct test path |

保留：

- `agentChatV2.ts` 内部模型 runtime；
- Surface registry 与 main-only capability executor；
- proposal compensation / Undo 执行体；
- ProductionRun、document、canvas、timeline 领域 owner；
- drafts、composer 未发送附件等纯 UI 暂态；
- 原始 `conversations.json` 只读文件。

---

## 7. Phase 2B 的 RED 矩阵

除 production-owner 第一条外，按顺序补：

### `projectAgentIpc.test.ts`

- forged projectId/binding、子 frame、旧窗口、导航后旧 port 全拒；
- renderer raw mutation 拒绝；
- A patch 不发送给 B；
- revision gap 返回 snapshot；
- cancel/late reply/exact subscription cleanup。

### `projectAgentLegacyMigration.test.ts`

- 30 creation + 30 generation 全保留；
- 两区同 oldThreadId 不碰撞；
- >200 messages 不二次裁剪；
- 每个 staging / manifest crash 点可重试；
- 第二次启动零重复；
- committedProposal 仍可 Undo；
- legacy thread 只读，fork 新 thread 不修改 archive。

### `projectAgentProjectionStore.test.ts`

- 同一 Assistant Item 连续 append 保持 itemId，textRevision 单调；
- assistantFinal 与 terminal turn/queue 同 patch 生效；
- 单独 active-thread patch 可切 thread；
- previousRevision/binding mismatch 不落本地状态，改取 snapshot；
- queue edit/cancel、approval、stop、TaskRef、attachments/history 都从共享 projection 驱动。

### owner/cutover 结构门岗

- 注入第二 Host factory、旧 conversation writer、旧 chatV2 channel、面板 `setMessages`/pending owner 时真实变红；
- Host 注册成功后旧 writer production reference 必须为 0；
- 不允许 flag/fallback/dual write；
- production 只安装一个 Host，但可 attach 多项目 partition。

---

## 8. 下一轮最短正确续跑顺序（不跑全量）

### Step 1：恢复现场，不改代码

```bash
cd /Users/aoqimin/Desktop/Nomi-project-agent-host-phase1-20260827
git branch --show-current
git status --short
git rev-list --left-right --count origin/main...HEAD
```

期望 branch 为 `codex/project-agent-host-phase1-20260827`。若不是，停止；不要切换共享脏树。

### Step 2：Phase 2A 独立规格审查（一次 focused review）

新 reviewer 只读逐项核对 Host 目录与共享合同，不扫描整个仓库：

- state/reducer atomicity；
- exact patch coverage；
- queue/start/append/final/proposal race；
- commandId replay/conflict；
- snapshot/ledger crash recovery；
- file permissions、symlink/hardlink；
- malformed input closed set；
- 1000 update/enqueue performance；
- 2A 没有 production IPC/UI/真实项目写入；
- vocabulary baseline 范围正确。

结论只能是 `SPEC PASS` 或具体 P0–P2。审查中断/超时不算 PASS。

### Step 3：Phase 2A 独立质量审查（只看变更文件）

只有 spec PASS 后再做质量 reviewer。若发现问题：同一实现代理或新代理先写 meaningful RED，再最小 GREEN，然后 spec → quality 都重跑。

### Step 4：主代理 focused gate（只跑一次）

```bash
pnpm exec vitest run electron/projectAgentHost electron/jsonFile.test.ts
pnpm exec tsc -p electron/tsconfig.json --noEmit
pnpm run check:test-types
pnpm run check:vocabularies
pnpm run check:capability-owners
pnpm exec eslint electron/projectAgentHost electron/shared/projectAgentContracts.ts electron/shared/projectBinding.ts electron/shared/capabilityTargeting.ts electron/jsonFile.ts electron/jsonFile.test.ts --max-warnings=0
```

再对 Phase 2A scoped files 跑 Prettier check 和 `git diff --check`。`check:filesize` 只在拆壳切片完成后跑一次；不把当前仓库历史巨壳债务混成 2A 的日常阻塞。

### Step 5：进入 Phase 2B

只推进一个明确切片，每片完成后只跑该片测试：

1. **Owner install**：先写 `projectAgentProductionRuntime.test.ts` 的第二 owner RED，修到无副作用失败；focused test + typecheck。
2. **Transport boundary**：只收口 `projectAgentIpc` 的 sender/subscription/revision/patch 规则；focused IPC tests + owner gate。
3. **Migration**：只做 raw legacy reader、cutover manifest、proposal receipt；focused migration tests，不碰 UI。
4. **Projection**：只让 projection store 正确消费 snapshot/patch；focused store tests，不删旧 writer。
5. **Atomic cutover**：同一提交完成两面板切 shared projection，并删除旧 conversations/chatV2 writer；随后才做 2B spec review、quality review 和一次 focused gate。

不要一开始同时改 migration、两个面板和新 UI；但最终 cutover 提交必须是原子的，不能把新旧 writer 并存的中间态当成完成态。

### Step 6：最终候选才跑全量

只有 Phase 2B cutover、Phase 3/4 的目标切片完成，且不再有结构性 owner 变化时，才运行：

```bash
pnpm run gates
pnpm run build
pnpm run test:journeys
pnpm run test:mcp
```

这四项是发布候选验收，不是日常修复循环。任何失败都记录为候选提交的问题，不回头让全量测试主导每个小切片。

---

## 9. 后续 Phase 3–6 不要提前混进 Phase 2B

### Phase 3

迁其余 read capability，再迁文稿/画布可撤写入；复用现有 proposal transaction / Undo / reconcile，删除已迁 capability 的旧 descriptor / switch / metadata owner。

### Phase 4

破坏性动作先冻结 target/revision/actionHash；付费动作统一进入既有 ProductionRun + human receipt。需要关闭 MCP typed cancel、reference role、价格/模型/冻结参数、可靠 ETA、TaskRef、artifact/export truth。

### Phase 5

先执行 §0.2 历史 PR 证据门并冻结采纳矩阵。然后让 Skill progressive disclosure、audience、list/read guard、shrink-only 从 Registry 派生；MCP transport 仍保留 lease/elicitation/receipt 额外安全层，但不能污染 Host history。删除按名字前缀猜可见性与 legacy route。

### Phase 6

先执行 §0.2 历史 PR 证据门，把既有 UI 设计、相关 PR 判断和最新真实界面逐项对账。新常驻 UI 只能投影 Phase 2B 已验证状态，不新增状态语义。先看真实现有 UI、读设计系统、出可体验样张让用户拍板，然后替换两个旧面板；最后跑跨页面、重启、跨项目、冲突、MCP 私有性、付费审批和正式打包真实用户旅程。

---

## 10. 最终提交策略

用户要求的是完整纵向目标完成后的一条最终 PR，不是每个 checkpoint 一个 PR。因此：

- 当前 checkpoint 已提交并推送；后续每个切片用 focused tests / reviewer / handoff 作为冻结证据；
- 最终交付前先保护该工作树，再从最新 `origin/main` 新建独立 sibling worktree；
- 把本任务改动有范围地迁入干净分支，处理主线 2 个及后续新提交；
- 在干净集成树跑项目 push 前全门、真实 dev/package journey 和用户任务；
- 只提交本目标 scoped files，push `codex/...` 分支并开 PR；
- 未经用户明确要求，不 merge / squash / close PR，更不能直接 push protected main。

---

## 11. 可直接粘贴给下一任务的续跑提示

```text
继续 Nomi 项目级常驻 Agent 既定目标。先读：
1) /Users/aoqimin/Desktop/Nomi-project-agent-host-phase1-20260827/docs/superpowers/plans/2026-08-28-project-agent-host-handoff.md
2) docs/superpowers/specs/2026-08-27-project-agent-host-design.md
3) docs/superpowers/plans/2026-08-27-canvas-read-capability-spine.md
4) docs/ARCHITECTURE-NOW.md

工作树固定为 /Users/aoqimin/Desktop/Nomi-project-agent-host-phase1-20260827，分支应为 codex/project-agent-host-phase1-20260827。先检查 git branch/status/rev-list；保护 123 个 tracked changes 与 86 个 untracked entries，禁止 reset/clean/覆盖。

真实进度：Phase1 实现已冻结但未最终 build/package；Phase2A 实现代码已在 checkpoint，独立 spec/quality review 尚未完成；Phase2B 已有 main/IPC/renderer projection/迁移预接线半成品，但旧 writer 与双写尚未切除。

先做一次 Phase2A focused spec/quality review；若有具体 P0-P2，严格 RED→GREEN 修完并重审。随后直接沿现有 Phase2B 半成品完成 owner install → IPC boundary → migration → projection → atomic cutover；不要创建第二个 Host、不要双写、不要保留旧 conversations/chatV2 fallback。日常只跑切片 focused tests，最终候选才跑全量 gates/build/package/真实旅程。
```

---

## 12. 交接时的最后结论

- 代码没有丢，现场可恢复。
- 任务没有完成，当前处于 Phase 2A 审查未完成 + Phase 2B 生产接线半成品状态。
- 没有已确认的 Phase 2A 新 P0–P2；但规格 reviewer 被中断，所以缺少放行证据。
- Phase 2B 已有足够精确的施工 handoff，不需要重新讨论方向。
- 用户额度不足时，最安全的停点就是现在：不再让工作树漂移，不提交半成品；下一轮从 Phase 2A spec review 继续。
