# Nomi CI「Quality Gate」失败机制审计（2026-08-22 → 2026-09-05）

> 📎 交接/日志 · 只读审计，未改动任何文件 / 分支 / PR。
> 这份审计是 `docs/plan/2026-09-05-ci-gate-mechanics.md`（建议 1、2 的落地）的依据；建议 3/4/5 尚未立项。
> 样本：`gh run list --workflow "Quality Gate" --status failure` 取到 2026-08-23T11:03 → 2026-09-05T03:00 的 **226 次失败**（93 个分支，main 占 8 次）。
> 对全部 226 次抓了 `--json jobs`（失败 job / 失败 step）与 `--log-failed`（42MB 原始日志），按日志里最后一个启动的 `> nomi@0.21.0 <script>` 定位到**具体门岗**，再按报错正文归类。不是抽样，是全量。

分母：同窗口 Quality Gate 共 1000 次运行 —— 626 成功 / 210 失败 / 164 取消。main 自己 228 次跑、8 次红（3.5%）。

---

## 0. 一句话结论

**用户感觉「经常 CI 不过」，但它基本不是 flaky，也基本不是真 bug。**

- 226 次失败里，**只有 1 次**同一个 headSha 后来重跑就绿了（0.4%）。所以「重跑一下就好」这条路根本不存在——每一次红都要求人/agent 去改点什么再推一次。
- 最大的一块（**77 次 = 34%**）是**文档/合同门**：新增一篇 `docs/plan/*.md` 没登记进索引、没写状态标记、没重跑 `gen:ledger`、或者碰了高风险目录没配 `root-cause.json`。这些红**不可能**拦住任何生产 bug——它们拦的是记账。
- 第二大块（**38 次 = 17%**）是**分支继承了 main 上已有的红**：main 红了 8 次，其中 canvas 性能预算、packaged MCP smoke、MCP journey 过期、typecheck 各红过一轮，每红一次就有 6–9 个分支跟着红。
- 真实回归（B）只有 **52 次 = 23%**，这是 CI 该干的活。

换算成摩擦：E 类的 77 次红 ≈ 77 个「改一行 Markdown → commit → push → 再等一轮」的循环。main 上 2026-08-22 以来 1681 个 commit 里，**30 个是纯粹为了过文档门而存在的 commit**（`chore(docs): 补登 …至 plan INDEX`、`chore(ledger): regenerate …`），**100 个 commit 的标题里带 gate/门岗/ratchet/棘轮**——约 6% 的提交在维护门岗本身，而不是在做产品。

---

## 1. 分类计数表

| 类 | 定义 | 次数 | 占比 | 典型 run |
|---|---|---:|---:|---|
| **E 合同/文档门** | 「文档没配齐」导致的红，与代码正确性无关 | **77** | 34.1% | [33940639442](https://github.com/aqm857886159/Nomi/actions/runs/33940639442) `check:walkthroughs`<br>[33925581647](https://github.com/aqm857886159/Nomi/actions/runs/33925581647) `check:docs-index`<br>[33929386658](https://github.com/aqm857886159/Nomi/actions/runs/33929386658) `check:doc-status` |
| **B 真实回归** | 本分支引入的 unit/type/lint/巨壳/i18n 失败 | **52** | 23.0% | [33896872738](https://github.com/aqm857886159/Nomi/actions/runs/33896872738) unit 1 failed / 10807 passed<br>[33902232333](https://github.com/aqm857886159/Nomi/actions/runs/33902232333) `check:test-types`<br>[33847795060](https://github.com/aqm857886159/Nomi/actions/runs/33847795060) `check:filesize` 822>814 |
| **D 继承 main 的红** | 同一失败签名在 ±48h 内 main 自己也红 | **38** | 16.8% | [33838213037](https://github.com/aqm857886159/Nomi/actions/runs/33838213037) typecheck（main 上的 `useNodeModelAutoSelect.ts` TS2304）<br>[33908419511](https://github.com/aqm857886159/Nomi/actions/runs/33908419511) MCP journey 过期<br>[33794393948](https://github.com/aqm857886159/Nomi/actions/runs/33794393948) canvas perf |
| **A 基线漂移** | 分支没引入问题，是棘轮/生成物与 main 对不上 | **23** | 10.2% | [33589658261](https://github.com/aqm857886159/Nomi/actions/runs/33589658261) `check:ledger`（分支一篇 docs 都没加）<br>[33839800383](https://github.com/aqm857886159/Nomi/actions/runs/33839800383) `check:vocabularies`<br>[33594223567](https://github.com/aqm857886159/Nomi/actions/runs/33594223567) MCP-L1「42-tool snapshot」硬编码 |
| **C 基础设施** | runner/依赖安装/xvfb/Playwright 超时/取消 | **18** | 8.0% | [33836184182](https://github.com/aqm857886159/Nomi/actions/runs/33836184182) canvas perf（非 main 红窗口）<br>[33591202716](https://github.com/aqm857886159/Nomi/actions/runs/33591202716) electron smoke<br>[33668851555](https://github.com/aqm857886159/Nomi/actions/runs/33668851555) `Install dependencies`（main） |
| **D-main** | main 自己红（8 次全部列出，见 §1.1） | **8** | 3.5% | 见下 |
| **F 其他** | 只留下 job 级红、step 归属不明（多为并发取消/上游 job 挂掉带崩） | **10** | 4.4% | [33835457943](https://github.com/aqm857886159/Nomi/actions/runs/33835457943)、[33548227664](https://github.com/aqm857886159/Nomi/actions/runs/33548227664)、[33482260843](https://github.com/aqm857886159/Nomi/actions/runs/33482260843) |
| | **合计** | **226** | 100% | |

分类口径说明：每次失败只归一类，按「第一个真正失败的 lane」定主因（Contracts → Unit → Desktop/E2E → Canvas → Mac Package）。D 的判据是**同一失败签名在 ±48h 内 main 自己也红过**，优先于 A/C——因为分支作者对它无能为力。

### 1.1 main 自己红的 8 次（全部）

| run | 时间 | 失败面 | 类 |
|---|---|---|---|
| [33434106803](https://github.com/aqm857886159/Nomi/actions/runs/33434106803) | 08-31 20:05 | Canvas performance budget | C（平台校准） |
| [33450515110](https://github.com/aqm857886159/Nomi/actions/runs/33450515110) | 08-31 23:24 | Canvas performance budget | C |
| [33625231611](https://github.com/aqm857886159/Nomi/actions/runs/33625231611) | 09-02 11:33 | `PACKAGED MCP SMOKE FAIL: claude expected the legacy catalog baseline, got 19` | A（硬编码期望过期） |
| [33654752296](https://github.com/aqm857886159/Nomi/actions/runs/33654752296) | 09-02 16:24 | Canvas Acceptance shard 1 | C |
| [33668851555](https://github.com/aqm857886159/Nomi/actions/runs/33668851555) | 09-02 18:42 | **Install dependencies** | C（纯基础设施） |
| [33792434590](https://github.com/aqm857886159/Nomi/actions/runs/33792434590) | 09-03 18:45 | `nomi_session_open: ✗ The project connection expired` | C（TTL 撞慢 runner） |
| [33792495617](https://github.com/aqm857886159/Nomi/actions/runs/33792495617) | 09-03 18:46 | typecheck `TS2304: Cannot find name 'meta'` + 同上 | **B，且被 6 个分支继承** |
| [33875546605](https://github.com/aqm857886159/Nomi/actions/runs/33875546605) | 09-04 12:58 | `nomi_operation_gate: ✗ This confirmation is no longer valid` | C（同一族 TTL） |

main 那次 typecheck 红有独立佐证：main 上有一个 `7baf3bcfa fix(canvas): unblock main typecheck` 的解封 commit，还专门开了 `codex/main-typecheck-repair-20260904` 分支。**main 红一次，代价是 6 个在飞分支同时红。**

---

## 2. 按门岗脚本排名的失败次数 Top 10

以「主因门岗」计（不是出现次数，避免一次 run 重复计入）。

| # | 门岗 | 次数 | 主类 | 机制 |
|---:|---|---:|---|---|
| 1 | `check:docs-index` | **28** | E | 分支新增一篇 `docs/plan/*.md` 没在 `docs/README.md` 或某个 `INDEX.md` 里链接 |
| 2 | `check:ledger` | **21** | E(11) / **A(10)** | `docs/DELIVERY-LEDGER.md` 是生成物；**21 次里有 10 次分支一篇 docs 都没加**，纯粹是 main 前进导致生成物过期 |
| 3 | `canvas-performance-budget` | **16** | C/D | Linux xvfb 软渲染 vs macOS 校准的预算；main 自己就贴线（记忆里已有专门 lesson） |
| 4 | `check:test-types` | **14** | B | 测试文件类型错误的**逐文件棘轮**（`基线 1 → 现在 2`） |
| 5 | `unit-tests` | **14** | B | 真 vitest 断言失败（典型 `1 failed / 10807 passed`） |
| 6 | `check:root-cause-contracts` | **14** | E | 碰了高风险生产路径就必须提交 schema-v3 `docs/fixes/*.root-cause.json` |
| 7 | `check:doc-status` | **14** | E | 新文档开头 12 行内没有 `✅/🚧/⏳/…` 状态标记 |
| 8 | `packaged-mcp-smoke` | **13** | A/D | 打包 smoke 里硬编码 `tools.length >= 22`、`requiredTools` 名单，随 MCP 工具面演进必然过期 |
| 9 | `canvas-acceptance` | **9** | C/D | Linux 走查断言/截图 |
| 10 | `mcp-journey(expiry/timing)` | **9** | C/D | `confirmation is no longer valid` / `project connection expired` —— 基于时钟 TTL 的 E2E，在慢 runner 上过期 |

（第 11–16：`typecheck` 8、`check:filesize` 7、`check:walkthroughs` 7、`check:vocabularies` 6、`check:secrets` 5、`check:i18n` 5。）

### 2.1 一个被数据点破的机制：51 个门岗串在一条 `&&` 链上

`gates:contracts` = **51 个 `check:*` 用 `&&` 顺序串联**，第一个红就停。后果：**一次改动违反 3 个门岗 = 3 轮完整 CI，3 个 commit。**

硬证据：

- 分支 `codex/project-agent-host-phase1-20260827` 在文档门上连红 **15 轮**：`docs-index → ledger → ledger → docs-index → docs-index → doc-status ×4 → ledger ×6`。
- 分支 `fix/walkthrough-catalog-readonly-20260902`：一篇 `docs/plan/2026-09-02-walkthrough-catalog-seed-version.md`，红了 4 轮 —— `docs-index → doc-status → ledger → ledger`。
- main 上留下了成对的 commit 作为化石：
  `3015cb32 chore(docs): 补登 cross-device-sync-execution.md 至 plan INDEX`
  `28e9d269 chore(docs): 补加 cross-device-sync-execution.md 状态标记`
  —— **同一篇文档，两个 commit，两轮 CI。**
- 93 个分支里有 7 个撞上 ≥2 个不同的文档门。

---

## 3. 每个 Top 门岗：它拦住过真 bug 吗？

| 门岗 | 拦过真 bug 吗 | 证据 |
|---|---|---|
| `check:docs-index` (28) | **没有，结构上不可能**。它只查 Markdown 链接。而且它自己没在解决问题：日志显示 **596 篇方案里 323 篇未收录（基线 322）**——54% 的债已经冻在基线里，门岗只是不让它涨。它红一次的收益 = 一条链接；成本 = 一轮 CI + 一个 commit。**纯摩擦。** | main 上因它而生的 commit 全部形如 `8213b061 docs: 收录 walkthrough catalog 种子校验方案进 plan 索引（过 check:docs-index）`、`9b70b8f7 fix(docs-index): 将创作资源链 epic 收录进 docs/plan/INDEX.md` |
| `check:ledger` (21) | **没有**，而且 **21 次里 10 次是分支自己一篇文档都没加**（我 fetch 了每个 headSha，对 merge-base 算 `--diff-filter=A -- docs/`）。这是 A 类漂移的典型：生成物依赖全仓文档集合，两个分支各加一篇各自重生成，合起来必然过期。**纯摩擦，且是并行开发的直接税。** | main 上有 commit 直说：`aeafb516 chore(ledger): 重生成交付台账（main 上游漂移 496→497）`、`0e21804b docs(ledger): regenerate on merged tree`（这类 regenerate commit 反复出现） |
| `canvas-performance-budget` (16) | **拦过真回归，但现在信噪比已崩**。main 自己在 Linux 上就红了 2 次；仓库自己已经承认过一次并做了正确的动作：`a7b629d1f perf(canvas): maxFrameGapMs 降为 advisory（#264 不给抖动指标设硬门）`。日志里连超了哪一项都不打印，只有一行 `❌ 画布性能 benchmark 未通过预算或可靠性门槛`——诊断不出来只能重推。**半真半伪，需要平台感知预算。** | `docs/fixes/2026-08-30-canvas-performance-exit-contract.root-cause.json` 是它真实的一次价值（verdict 没投影到 exitCode，会把 pass:false 报成 PASS）；反面证据是 main 自红 + `maxFrameGapMs` 降级先例 |
| `check:test-types` (14) | **真拦。** 测试文件不进 `pnpm typecheck`，这道门是唯一能看见测试类型错的地方。 | `14fa5f2d test: restore usage ledger test type safety`；`docs/lessons` 里「测试文件根本不过类型检查」就是它的立项理由 |
| `unit-tests` (14) | **真拦**，本来就是 CI 的本职。 | — |
| `check:root-cause-contracts` (14) | **没有，结构上不可能**——它检查的是「有没有配一份 JSON 文档」，不看代码。更糟的是它**主动制造过假红**：main 上有 `21d25bf60 fix(rootcause-gate): let a behaviour-preserving change say so instead of inventing a root cause`，commit body 直说「schema 完全按纠错工作塑形；一次纯结构改动（模块抽取、重命名、逐字搬移、注释修复）没有 symptom 也没有 root cause，门岗只给两条路，两条都坏——要么编造，要么污染合同语料」。**主要在制造摩擦。** | 同上 commit |
| `check:doc-status` (14) | **没有**。日志：**533 篇里 425 篇缺状态（基线 423）**——80% 的债已冻结。同 `docs-index`。 | `84085a17 docs: 方案补状态标记（过 check:doc-status）`、`d90ce28f fix(doc-status): 为创作资源链 epic 文档添加 📋 状态标记` |
| `packaged-mcp-smoke` (13) | **拦住过真 bug，但它自己也是最大的假红源之一。** 真：`docs/fixes/2026-09-03-packaged-transport-callback-omitted.root-cause.json` —— 打包态 `confirmGenerationInNomi` 没传，用户点同意后确认卡永远不弹，开发态 43/43 绿、打包态 15/43。这是只有打包 lane 能看见的一类。假：13 次里绝大多数是 `expected 22 tools, got 33` / `expected the legacy catalog baseline, got 19` 这种**手抄的期望值过期**，仓库自己的 `2026-09-02-packaged-mcp-smoke-stale-catalog-anchor.root-cause.json` 把它判为 `recurring`。**lane 该留，断言方式该换。** | 见左 |
| `canvas-acceptance` (9) | 混合；main 自己红过一次，无法在日志里区分真假。 | — |
| `mcp-journey(expiry/timing)` (9) | **主要是仪器问题。** 失败正文永远是 `✗ This confirmation is no longer valid` / `✗ The project connection expired`——**基于墙钟 TTL 的断言撞上慢 runner**，和 R18「测试禁私有墙钟」是同一族毛病，只是这次在生产代码的 TTL 上。main 自己红 2 次。 | main 8 次红里占 2 次；18 次出现里跨 9 个分支，签名完全一致 |

另有两条独立佐证「门岗在制造假红」：`f3e2899d1 fix(vocab-gate): let the ratchet record a genuine convergence instead of reading it as a relabel`（词表棘轮把真实收敛读成了改名逃逸），以及 100 个标题带 gate/门岗/ratchet 的 main commit。

---

## 4. 机制层修法建议（5 条）

按「能砍掉的失败次数 / 会失去的防线」排序。前 2 条覆盖 226 次失败里的 **115 次（51%）**。

### 建议 1 —— 把 `docs-index` / `doc-status` / `ledger` 三门从「阻塞 PR」改成「main 上自动修」

**改什么。** 三件事一起做：
1. 三个门在 PR 上降为 **annotation（warning，不失败）**；
2. 在 merge 到 main 后的 workflow 里跑 `gen:ledger` + 索引/状态自动补齐，**由 CI 自己 commit 回 main**（状态标记默认 `📋 方案待拍板`，作者要改再改）；
3. 只有 main 上补齐失败（比如生成脚本本身崩了）才开 issue。

**少掉哪一类失败。** E 类 77 次里的 **63 次**（docs-index 28 + doc-status 14 + ledger 21），加上 A 类 ledger 漂移已含在内 —— 全窗口失败量 **-28%**，以及 30 个 `chore(docs)` commit、7 个分支的多轮串红。

**会失去什么防线。** 失去「新文档必须当场被人索引」的即时性。但数据说这个防线本来就没在守：**596 篇里 323 篇未收录、533 篇里 425 篇缺状态**，棘轮只是把 80% 的债冻住。自动补齐反而会让覆盖率真的往上走。真正的风险是自动写的状态标记不准——所以标记要写成显式的「待拍板」，而不是猜。

### 建议 2 —— 把 51 个 `&&` 门岗改成「全跑完再报」

**改什么。** `gates:contracts` 现在第一个红就停。改成跑完所有 51 个、汇总所有失败一次报出（保留 fail-closed，只是不早退）。中位数 Contracts 跑到红只要 **0.8 分钟**，跑完全部的边际成本可以忽略。

**少掉哪一类失败。** 不减少「有问题的 PR 数」，但把「一次 push 只暴露一个问题」变成「一次暴露全部」。按观测到的串红（`project-agent-host-phase1` 15 轮、`walkthrough-catalog-readonly` 4 轮、7 个分支撞 ≥2 门），保守估计能砍掉 **20–30 轮**重复 CI 和同等数量的补丁 commit。**这条和建议 1 独立，且是纯收益。**

**会失去什么防线。** 什么都不失去。唯一代价是 Contracts job 从 ~0.8 分钟延到跑满（几分钟），换来一次看全。

### 建议 3 —— 把「手抄的期望值」换成「从真相源 derive」，而不是继续维护数字

**改什么。** `packaged-mcp-smoke` 里的 `tools.length >= 22`、`requiredTools` 名单，以及 `mcp-l1-handshake` 里的「42-tool snapshot」，全部改成从工具目录的真相源（`electron/capabilityCore/` 的 catalog）读出来比对**形状/不变量**（例如「每个声明的工具都能 list 出来、每个 list 出来的都有声明」），而不是比对**数量**。数量变化不再是红；声明与实现不咬合才是红。

**少掉哪一类失败。** A/D 类里的 13 次 packaged-mcp-smoke + 3 次 MCP-L1 snapshot = **16 次（7%）**，其中包括 main 自己红的 1 次（它冻结过一次全仓合并）。

**会失去什么防线。** 失去「工具面积意外变化时报警」。这条其实值得保留——但应该由 `check:vocabularies` 那种「登记表 vs 实现」的 owner 门岗承担（那是它的本职），而不是让一个跑在 macOS package lane 上、只在 main 才触发的 smoke 拿硬编码数字兼职。仓库自己的根因合同已经把这个判为 `recurring`。

### 建议 4 —— canvas 性能预算做成平台感知 + 打印超标项，否则降 advisory

**改什么。** 两步。① benchmark 失败时**必须打印是哪个场景、实测多少、预算多少**——现在只有一行 `❌ 未通过预算或可靠性门槛`，作者拿到红灯连诊断的入口都没有，只能重推。② 预算按 `process.platform` 分档（Linux xvfb 软渲染实测慢 1.3–2x），或者对抖动类指标沿用已有先例 `a7b629d1f` 降为 advisory，只对「相对 main 的 delta」报红。

**少掉哪一类失败。** canvas-performance-budget **16 次（7%）**，含 main 自红 2 次。

**会失去什么防线。** 绝对阈值的防线。但绝对阈值在 CI 上本来就守不住——main 自己都红——继续留着只是在训练所有人无视性能红灯。改成「相对 main 的 delta」保留了真正想防的东西（这个 PR 让画布变慢了），丢掉的是「画布在 Linux 软渲染下够快」这个从来不是目标的断言。

### 建议 5 —— 让 `check:root-cause-contracts` 只在**纠错性**改动上触发，并把 main 红做成显式熔断

两件小事，合在一条里：

**5a.** `check:root-cause-contracts` 现在按「碰了高风险路径前缀」触发，于是重构、重命名、抽模块都被要求编造 symptom/root_cause——main 上的 `21d25bf60` 已经承认了这个洞。改成按**改动性质**触发：commit/PR 声明 `fix`/`revert` 类型或改动伴随测试新增时才要求合同；纯结构改动走一个轻量的「behaviour-preserving」声明。**少掉 E 类里的 14 次（6%）**。失去的防线：一个把 fix 伪装成 refactor 的人可以绕开——但这本来就靠 `@ponytail-review` 和评审兜，不靠前缀匹配。

**5b.** main 红时**冻结分支 CI 的继承**：`Require every validation surface` 那一步在判红之前先查 main 最近一次同 job 的结论，若 main 在同一 job 上已红，则该 job 在分支上降为 warning 并在 PR 上贴「继承自 main run #X」。同时 main 一红就自动开 issue + 通知。**少掉 D 类 38 次（17%）里的大部分。** 失去的防线：main 红期间分支上真正的新回归可能被这一个 job 掩盖——所以只降级**签名完全相同**的那个 job，其余 job 照常阻塞。

---

## 5. 附：数据可复现路径

中间产物（`runs.json` / `jobs/<id>.json` / `logs/<id>.txt` 42MB / `contracts_gate.json` / `classified.json`，226 行分类结果）
是会话级临时文件，**没有进仓**（42MB 原始日志不该进 git）。想重跑：按下面的判据对 `gh run list --workflow "Quality Gate" --status failure`
的窗口重新抓一遍即可，结论是确定性的。

关键判据：
- 门岗定位 = 日志里 Contracts job 最后一个 `> nomi@0.21.0 <script> /home/runner`（51 个门岗 `&&` 串联，最后启动的那个就是红的那个）
- D 类判据 = 同签名在 ±48h 内 main 也红
- A 类 ledger 判据 = `git fetch origin <headSha>` 后 `git diff --diff-filter=A <merge-base>..<sha> -- docs/` 为空
