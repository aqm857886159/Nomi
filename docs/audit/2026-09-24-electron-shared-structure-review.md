# `electron/shared` 结构评审（症状聚类门岗触发，2026-09-24）

## 为什么有这份评审

合同 `2026-09-24-hard-list-windows-path-spellings` 让 `electron/shared` 在 2026-09-18 到 2026-09-24 的 7 天里累计到 **35 份**根因合同，触发 `check:symptom-cluster`（同一模块 7 天内 ≥3 份）。

## 这 35 份是不是一个结构问题

先说门岗的粒度：它按前两级目录分桶，而 `electron/shared/` 装的是主进程与渲染层共用的**全部**契约——动词声明、能力契约、lane 投影、审批、生成契约、命令策略。35 份落在同一个桶里，首先说明的是「共享契约层这一周被改得非常频繁」，不等于它们同根。

按合同的 `class_root` 归并，前 34 份与同日 `electron/agentLane` 那一簇高度重合（见同日 `docs/audit/2026-09-24-electron-workspace-structure-review.md` 的 agentLane 一节，随 Windows 批次 PR 一起合入），集中在三类：

| 类根因 | 代表合同 |
|---|---|
| 同一个能力被重述多遍，靠手抄保持一致（动词声明 / 传输翻译 / 契约 schema / 投影） | `verb-transport-translation-derived`、`verb-host-input-conformance`、`shot-envelope-fields-die-in-hand-written-projections`、`skill-restates-registry-facts` |
| 同一个语义有第二个家 | `agent-storyboard-single-ledger`、`ownership-single-source`、`vendor-landing-one-owner` |
| 生命周期不同的东西共用一份身份 / 输入 | `pi-history-read-side`、`original-input-replay`、`composer-lifecycle` |

**本份不属于这三类**，属于同日 Windows 批次的「平台假设」类：命令策略的密钥清单只按 POSIX 的一种拼法写，`isSystemReadOnly` 用会补盘符的宿主 `path.resolve` 比 POSIX 前缀表。macOS 上有 OS 沙箱的 denyRead 兜底，Windows 没有沙箱，清单就是唯一直接拒的一层。修在唯一判定点 `classifyCommand`（一份归一视图 `hardListView`），`codingCommandPolicy.ts` 的分层不需要改。

## 结论

- 平台假设类（本份 + `lane-identity-host-path`）：修在最早边界即可；缺的是 Windows 验证链，见 `docs/lessons/mac-only-testing-ships-windows-blind.md` 与 `docs/release-process.md` §4。
- 前 34 份：真正的结构问题是「重述与第二个家」，建议以 `docs/engineering/concept-owners.json` 为底对 `electron/shared` + `electron/agentLane` 做一次专门的结构评审，逐个概念列出 owner 与剩余的手抄点。本评审**没有**逐份核对那 34 份的修复是否已经收口，不在本 PR 处理。
- 门岗按两级目录分桶对 `electron/shared` 过粗（任何共享契约改动都会累加到同一个桶），如实记录，不在这里改门岗。
