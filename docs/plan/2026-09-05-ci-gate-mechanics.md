# CI 门岗机制修法：文档门降 advisory + contracts 全跑汇总

> ✅ 已交付 · 2026-09-05 · 依据 `docs/audit/2026-09-05-ci-failure-audit.md`（Quality Gate 2026-08-23→09-05 全量 226 次失败的逐条归因）

## 为什么做（真实摩擦，不是洁癖）

审计把「经常 CI 不过」量成了两个数：

- **226 次红里只有 1 次重跑就绿**（0.4%）。所以每一次红都要求人去改点什么再推一次——不存在「重跑一下就好」。
- **最大的一块是记账**：77 次（34%）是文档/合同门，其中 `check:docs-index` 28 + `check:ledger` 21 + `check:doc-status` 14 = **63 次**。这三个门只查 Markdown 链接、开头有没有状态 emoji、生成物新不新鲜，**结构上不可能拦住任何生产 bug**。

摩擦被 `&&` 长链放大了一遍：`gates:contracts` 是 51 个 check 串在一条 `&&` 上，第一个红就停。于是「一次改动违反 3 个门岗」= 3 轮完整 CI + 3 个补丁 commit。化石在 main 上摆着：分支 `codex/project-agent-host-phase1-20260827` 在文档门上连红 **15 轮**；`3015cb32` 和 `28e9d269` 是同一篇文档的两个补登 commit、两轮 CI。

而这三个门并没在守住它们声称守的东西：实扫 **596 篇里 323 篇未收录、533 篇里 425 篇缺状态**，80% 的债早被冻进基线，棘轮只是不让它涨。

## 范围（本 PR 只做两件事）

### ① 三个文档/生成物门降为 advisory，补齐挪到 main 上自动做

- `gates:contracts` 里 `check:docs-index` / `check:doc-status` / `check:ledger` 失败**只出一条 GitHub warning 注解**（标题 `docs-autosync`），不阻断 job；本地 `pnpm run gates` 语义完全相同。
- **判据一点没放松**：直接跑 `pnpm run check:docs-index` 仍然 exit 1。advisory 只存在于 `gates:contracts` 的汇总层。
- 补齐主体是 `.github/workflows/docs-autosync.yml`：main 每前进一次就跑 `scripts/repair-doc-gates.mjs`（重生成账本 → 给新增文档盖 `📋 方案待拍板` → 把漏的那篇追加进对应 `INDEX.md` 的「🤖 自动收录（待人工归位）」区），再让**三个门岗本人**验绿，有 diff 就以 `github-actions[bot]` 身份提交回 main（`chore(docs-gates): auto-sync … [skip ci]`）。
- 状态**故意盖成「待拍板」而不是猜**：猜出来的状态会污染交付账本现役区，比没有标记更糟。
- CI 注解卫生：`ci-annotation-hygiene` 把 `docs-autosync` 标题的 warning 记为**委派**（owner = main 上的 autosync 工作流），不是需要写过期日的 allowlist 豁免——它有真实主体且主体真的会跑。

### ② `gates:contracts` 全跑完再汇总

- 51 个 `&&` 改成 `scripts/run-gates-contracts.mjs`：顺序跑完**全部**门岗，边跑边流式输出，最后统一打印失败清单（每条带退出码 + 输出尾巴 15 行）。任一阻断性门岗失败即 exit 1（fail-closed 不变，只是不早退）。
- 清单仍逐个写在 `package.json` 的 `gates:contracts` 里（顺序即执行顺序），所以 `check:gates-chain` 依旧从 package.json 一眼看全；它新增了一条**只对这个 runner 生效**的裸名解析（通用地认裸名会造假绿，本门岗的失败方向必须是假红）。
- 绿的时候总耗时与现在相同；红的时候多跑几分钟，换「一次看全部」。
- 顺手消掉一份并行判据：`scripts/agent-runtime-wiring.test.mjs` 里另抄了一份只认 `pnpm run x` 的可达性闭包，被这次改动照出假红（「typecheck 不可达」），改成 import `check-gates-chain.mjs` 导出的 `resolveReachable`——可达性判据只留一份。

## 不动项（明确不做）

- 不删这三个脚本，不改它们的判断逻辑、基线格式或退出码。
- 不动 `canvas-performance-budget`（平台感知预算）、不动 `check:root-cause-contracts` 的触发规则、不动 packaged-mcp-smoke 的硬编码工具数——审计里的建议 3/4/5 单独立项。
- 不改 main 红时分支继承那条（建议 5b）。
- advisory 名单**不许长大**：进名单的唯一条件是「失败可由机器确定性补齐，且补齐主体已存在并会真跑」。`run-gates-contracts.node-test.mjs` 钉死了当前三条，加第四条会翻红。

## 验收门

| 项 | 判据 |
|---|---|
| runner 全跑 | `run-gates-contracts.node-test.mjs`：两个门岗同时失败时**两个都出现在汇总里**；全过 exit 0；信号中断当失败 |
| advisory 语义 | 同一篇违规文档：advisory 模式 exit 0 + `::warning title=docs-autosync::`；不降级则 exit 1（实跑对照，非仅单测） |
| 补齐能生成 diff | `repair-doc-gates.node-test.mjs`：夹具仓里补齐前门岗判据为红、补齐后为绿，且**基线里的历史存量一根手指没动**；再跑一遍幂等 |
| 门岗链完整性 | `check:gates-chain` 仍能发现「从 runner 实参里删掉一个 check」——已做变异对照 |
| 注解卫生 | `docs-autosync` 标题的 warning 进 delegated，其它无路径 warning 仍是 unexpected |
| 五门 | `pnpm run gates` 全绿 |

## 回滚

三步，互相独立：

1. **只回滚 ①**：把 `package.json` 的 `--advisory=…` 段删掉（三个门立刻恢复阻断），并停用 `.github/workflows/docs-autosync.yml`。runner 本身不受影响。
2. **只回滚 ②**：把 `gates:contracts` 改回 `pnpm run a && pnpm run b && …`（门岗名与顺序逐字保留在实参里，可直接转写），并回滚 `check-gates-chain.mjs` 的裸名解析分支。
3. **全回滚**：`git revert` 本 PR 的 merge commit；新增的 `scripts/docs-index-lib.mjs` 是纯抽取（`check-docs-index.mjs` 的判断逻辑逐字未变），回滚不留残渣。

## 会失去什么防线（诚实标注）

- 失去「新文档必须**当场**被人索引/标状态」的即时性。数据说这条防线本来就没在守（80% 债已冻结），自动补齐反而让覆盖率真的往上走；代价是自动写的状态标记不准——所以只写「待拍板」，不猜。
- 失去 `&&` 早退省下的那几分钟墙钟（仅在红的时候）。换来的是一次看全部失败。
- 新增一条依赖：main 上的 autosync 工作流必须真的能 push。它三次 push 失败会 `::error::` 报红，不会静默漏账。
