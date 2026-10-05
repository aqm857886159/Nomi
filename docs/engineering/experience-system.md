# 体验验收闭环与结账规则（L2）

> 用户 2026-10-05：「核心的问题和反复发生的问题是要修根因的，是要从我们的结构上修复的，就是让以后读取到整个仓库的任意 AI 都可以不发生类似的问题。」
> 常驻一句话在 CLAUDE.md 的 P2；本文是细则。规则正本 `docs/engineering/rules.json`（P2）。

## 闭环

发现 → 原话入逃逸账本（`tests/ux/full-walk/escapeLedger.json`，candidate）→ 归类（`categories`）→ 人工复核（reviewed）→ 根因合同（`docs/fixes/*.root-cause.json`）→ 结构性预防 → `check:escape-ledger` 卡住才能结账（fixed）。

「结构性预防」= 类型约束、唯一 owner、铁律或门岗级的类检查。只修现场、只加一个单场景回归测试，不算修好——同一类问题还会从别的入口回来。

## 结账（fixed）必须同时有三样

| 字段 | 要求 |
|---|---|
| `rootCauseContract` | 指向一份 `docs/fixes/<日期>-<名字>.root-cause.json`；文件存在、合法、有 `detected_by` 与 `prevention`，并且点名了下面那条类检查 |
| `classCheck` | `kind: "iron-law"`：`ref` 是铁律 ⑩ ⑪ ⑫ 或 `inv:1`…`inv:9`，`file` 必须是该铁律的检查文件，且这条逃逸自己声明过属于这条铁律；`kind: "matrix"`：矩阵 / 普查测试，要有参数化或遍历清单的形状，只测单个场景的不算 |
| `fixedInPr` | 合入的 PR 号（正整数） |

另外：`since` 是入账日；`candidate` 停留超过 14 天，`check:escape-ledger` 警告，提醒派人复核 / 修。条目格式不合法直接红。

## 谁判断（只许一份实现）

- 判据在 `scripts/escape-ledger-lib.mjs`：`validateEscapeLedger`（门岗用）、`fixedTransitions`（账本两版之间 candidate / reviewed → fixed 的转换）。
- `scripts/merge-preflight.mjs` 不再看 PR 正文有没有「逃逸 / 用户反馈 / 发版后」这几个词（两头都出错：#1025 正文提到「逃逸账本」被误判，#1026 修用户反馈却因没写这几个词被漏掉），改为看账本状态转换：本 PR 让条目变成 fixed 才要求带根因合同；合同声明 `detected_by` 为 user / post-release、却没有账本转换，也红。

## 门岗体检：advisory 的提示文案要和真实补齐机制对得上

`scripts/run-gates-contracts.mjs` 的 `ADVISORY_FILL` 逐个声明 advisory 门岗的补齐机制：有机器补齐主体（如 docs-autosync 工作流）才可以说「自动补齐」；要人判断的（如 `check:concept-owners`）文案写清谁、怎么补。`run-gates-contracts.node-test.mjs` 核对「声明 ↔ 工作流是否真的提到它 ↔ 打出来的文案」。

## 概念 owner 存量债

`check:concept-owners` 在 main 上攒了 37 处「受管合同声明了共享边界、但还没登记成概念写接口」。登记 owner 要人判断（它是哪个概念、谁是唯一写入口），docs-autosync 补不了。

- 冻结：`scripts/concept-owners-baseline.json` 的 `unregistered_boundaries`，只减不增；新增的未登记边界直接红，基线比参照提交多一条也红，登记完成后对应条目必须删（陈旧也红）。
- 负责：协调会话。排期原则：每次有 PR 碰到某份合同声明的文件，就顺手把那份合同的边界登记成概念写接口并删基线条目；14 份合同，目标 0.24 发版前清到 ≤10 处，清零后再讨论是否把这道门从 advisory 升回阻断（2026-10-01 用户拍板降级，升回要改 `gate-slimming.node-test.mjs` 并说明理由）。
