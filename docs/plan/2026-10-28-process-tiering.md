# 2026-10-28 流程文书三档判定设计卡

改动名：流程文书按“声明意图 + 门岗核实”三档判定  线/负责人：chore/process-tiering-intent  类别：[其他]

## ★1 用户怎么用

当实现线提交一个 PR 时，我想在 PR 正文声明单一意图和候选档位，以便门岗按 base/head 的真实改动面给出短、标准或严档；流程只服务审查，不改变产品用户界面。真实任务：纯逻辑修复（#1359/#1314/#1299 类型）声明短并核实无 UI 差异；花钱或可打断修复（#1356 类型）声明短也必须升严；账本条目从 candidate 转 fixed 的修复必须升严。短档指标：声明与核实一致的比例 ≥ 100%，量具为回放测试；硬线误降档 0，量具为历史回放与反例测试；取不到 base/head/清单时短档放行比例 0，量具为 fail-closed 单测。性能目标不适用：本改动不新增产品交互或运行时路径。

## ★2 谁说了算

判档事实唯一 owner 是 `scripts/pr-judgement-lib.mjs` 的 PR 判据；PR 正文声明是输入，`scripts/check-board-parity.mjs` / board manifest 的 base/head 对账是核实输入，`scripts/pr-body-criteria.mjs` 是共享编排边界，`scripts/merge-preflight.mjs` 和 `check:pr-judgement` 只调用同一判据。允许消费者是推送前门岗、CI、合并前扫描与人工报告；不复制第二套路由。状态只在判据返回值中计算一次，不靠“没有看到差异”猜用户意图。

## ★3 一致与复用

复用现有 `docs/engineering/test-routing.json` 的路径类别、`pr-judgement-lib.mjs` 的正文解析、`pr-body-criteria.mjs` 的统一入口、`check-board-parity.mjs` 的清单加载和现有 node:test 回放夹具；不新增产品层实现。删掉旧的“路径命中即四类严档”作为短档决定依据，保留路径命中作为硬线/标准档输入；不保留并行判据。验证命令：`git grep -n "inferRoutes\|evaluatePrJudgement\|checkBoard" scripts`、`pnpm run check:pr-judgement`。

## ★4 全状态

- 空：没有 PR 正文声明时，判据输出缺声明并升严。
- 加载：能读正文但取不到 base/head 或板清单时，判据输出核实未知并 fail-closed 升严。
- 成功：声明为短且核实无界面差异、无硬线、单一意图时返回短档；标准/严档分别列出触发项。
- 失败：声明、文件 diff 与核实结果矛盾时返回严档并指出矛盾。
- 部分成功：板核实成功但硬线命中时返回严档，保留硬线清单。
- 取消中：不适用；本改动没有长跑或可取消操作。
- 过期：不适用；判定不依赖缓存结果，失败即重新核实。
- 能力不可用：不适用；若读取核实输入的能力不可用，按未知处理并升严，不只灰掉说原因。

## ★9 验收与回滚

### 验收清单（动手前固定）

1. 规则合同：`CLAUDE.md` P5、`docs/engineering/rules.json` 的 P5/DC/IA、`docs/engineering/design-card.md` 写清短/标准/严档、纯修复声明、fail-closed 与反例；生成 `AGENTS.md` 与 `rules.md`，检查同步。
2. 判据合同：PR 正文可声明 `## 变更意图`（单一意图、候选档位、纯修复声明）；声明被解析，缺失/不清楚时不许短档；硬线包括 paid、long-running、interruptible、data/security/crash、direction-check、ledger fixed 和核实不一致。
3. UI 核实：短档必须核 base/head 的 board manifest；取不到任一侧、清单、文件列表或出现元素/布局/文案差异时不得短档；核实结果必须能被合并前扫描和 CI 共用。
4. 历史回放：#1359 → 短；#1356、#1347 → 严；任一 ledger fixed → 严；#1314、#1299 在核实无 UI 差异的构造夹具 → 短。回放只读固定文件清单，不联网。
5. 真红反例：纯修复声明改按钮文案 → 严；纯修复声明碰花钱路径 → 严；删除/跳过门岗核实 → 测试红；声明与核实不一致 → 严。每个反例还原夹具后回绿。
6. 文书门岗：`.tmp-pr-body.md` 含三档声明、设计卡、系统改进与验收证据，`check:pr-judgement` 通过。
7. 风险边界：不改 `src/` / `electron/`；不引入新包；不访问真实资料或付费；不推送/不开 PR。
8. 交付验证：`pnpm run gates` 退出码 0；推送前快检使用 `NOMI_PR_BODY_FILE=.tmp-pr-body.md node scripts/pre-push-contracts.mjs` 并记录最后几行；提交只包含本任务范围。

### 反例 → 预期 → 证据

| 反例 | 预期 | 证据 |
|---|---|---|
| 声明纯修复，diff 改一个按钮文案 | 升严，不得短 | 回放 node:test |
| 声明纯修复，命中花钱路径 | 严 | 回放 node:test |
| 删除/绕过 board base/head 核实 | 红，fail-closed | 缺输入单测 |
| 声明“无 UI 差异”，核实发现差异 | 升严 | mismatch 单测 |
| ledger candidate → fixed | 严且保留独立验收 | ledger 回放 |
| 取不到 base/head/manifest | 严，不猜短 | fail-closed 单测 |

验收线：协调指定的独立验收线；实现线不自签。回滚：revert 本提交；规则与脚本变更可整体回滚，不触碰产品数据。未涉及花钱、长跑、可打断或新界面，故不需要真实窗口/付费走查。
