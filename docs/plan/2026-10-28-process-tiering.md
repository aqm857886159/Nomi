# 2026-10-28 流程文书三档判定设计卡

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：流程文书按“声明意图 + 门岗核实”分三档（严 = 现行四类，这一单只加短档）  线/负责人：chore/process-tiering-intent  类别：[其他]

## ★1 用户怎么用

当实现线提交一个 PR 时，我想让门岗按改动本身给出短、标准或严档，以便四类之外的小修小补不再背全套文书。严档就是今天的四类（花钱 / 长跑 / 可打断 / 新界面），一个不多一个不少；标准档的要求就是今天四类之外的要求；这一单只加短档。流程只服务审查，不改变产品用户界面。真实任务：纯文档 / 测试 / 配置改动不写声明也进短档（#1359 一类）；正文声明「纯修复：不改用户可见元素、布局、文案」、base/head 拍板图清单核实无差异的修复进短档；声明短档却碰花钱 / 可打断路径（#1356 一类）照样是严；让逃逸账本条目转 fixed 的改动至少标准档、永不进短档。指标：新规的严档与现行四类逐个相同，量具为回放护栏（200 个历史 PR，测试当场用 `inferRoutes` 现算，没有手填的计数或期望档位）；声明短档但核实不了时放行比例 0，量具为 fail-closed 单测。性能目标不适用：本改动不新增产品交互或运行时路径。

## ★2 谁说了算

判档事实唯一 owner 是 `scripts/pr-judgement-lib.mjs` 的 `evaluateProcessTier`：严档只读 `inferRoutes` 的 `fourClass`（登记表 `docs/engineering/test-routing.json`，本单一行不改），其余只分短和标准。PR 正文 `## 变更意图` 是输入，`scripts/check-board-parity.mjs` 的 base/head 拍板图清单对账是核实输入，`scripts/pr-body-criteria.mjs` 的 `evaluatePrBody` 是共享编排边界，`scripts/merge-preflight.mjs` 和 `check:pr-judgement` 只调用同一判据。状态只在判据返回值里算一次，不靠“没有看到差异”猜用户意图。

## ★3 一致与复用

复用现有 `inferRoutes`（严档就是它的 `fourClass`，不另写第二套判据，也没有别的升严来源）、`pr-judgement-lib.mjs` 的正文解析、`pr-body-criteria.mjs` 的统一入口、`check-board-parity.mjs` 的清单加载、`scripts/lib/prChanges.mjs` 的文件表取数；不新增产品层实现。回放夹具只存输入，由 `scripts/generate-process-tiering-replay.mjs` 重新生成，期望在测试里现算。验证命令：`git grep -n "evaluateProcessTier\|inferRoutes" scripts`、`pnpm run check:pr-judgement`。

## ★4 全状态

- 空：没写 `## 变更意图`：文件清单自证全是纯文档 / 测试 / 配置 → 短；否则 → 标准。
- 加载：声明了短档但取不到 base/head 或拍板图清单（含取数抛错）→ 核实不了 → 标准，不升严。
- 成功：四类未命中，声明短档且单一意图、纯修复（或纯文档 / 测试 / 配置）、清单核实无界面差异，且没让账本转 fixed → 短。
- 失败：四类命中 → 严，声明降不了档；声明短档但清单有差异 → 标准，输出具体差异。
- 部分成功：账本转 fixed 的改动 → 至少标准，判定行点名账本条目；规则生效前开的 PR 不适用短档，按标准档要求判。
- 取消中：不适用；本改动没有长跑或可取消操作。
- 过期：不适用；判定不依赖缓存结果，每次现算。
- 能力不可用：不适用；读取核实输入的能力不可用按“核实不了”算，落标准档，不只灰掉说原因。

## ★9 验收与回滚

### 验收清单（动手前固定）

1. 规则文字相对 `origin/main` 只多“短档”这一处：`CLAUDE.md` P5、`docs/engineering/rules.json` / `rules.md`、`docs/engineering/design-card.md`；`AGENTS.md` 由 `pnpm run gen:agents` 生成。
2. 严档 ⇔ 现行四类：`evaluateProcessTier` 里没有别的升严来源；`docs/engineering/test-routing.json` 与 `origin/main` 逐字节相同，`inferRoutes` 不改。
3. 短档判据照旧不放宽；声明短档但清单有差异或核实不了 → 标准档，不是严档；让逃逸账本转 fixed 的 PR 至少标准档，永不进短档。
4. 回放护栏现算：夹具只存输入（200 个 PR 的完整文件清单含 A/M/D、命中 diff 规则的新增行、账本转 fixed 的条目 id）；对每个 PR（空正文、无声明）新规判严 ⇔ 测试当场调 `inferRoutes(...).fourClass`；PR 数等于生成时记下的数；四类里每一类至少有一个 PR 只因这一类才严。
5. 反例真红、按字节还原后回绿：①把旧关键词硬线整套加回去 → 护栏本身红；②去掉四类里任意一类的判严 → 护栏红；③恢复“声明冲突升严” → 对应单测红；④让账本转 fixed 的纯文档单进短档 → 对应单测红；⑤从夹具删掉一个 PR → 数量断言红。
6. 文书门岗：`.tmp-pr-body.md` 含设计卡、系统改进、验收证据，`check:pr-judgement` 通过。
7. 风险边界：不改 `src/` / `electron/`；不引入新包；不访问真实资料或付费；不推送、不开 PR。
8. 交付验证：`pnpm run gates` 退出码 0；推送前快检 `NOMI_PR_BODY_FILE=.tmp-pr-body.md node scripts/pre-push-contracts.mjs` 记录最后几行。

### 反例 → 预期 → 证据

| 反例 | 预期 | 证据 |
|---|---|---|
| 声明短档，改动命中花钱 / 长跑 / 可打断 / 新界面路径 | 严，声明降不了档 | `scripts/process-tier.node-test.mjs` |
| 声明短档，base/head 拍板图清单有差异 | 标准 | 同上 |
| 声明短档，取不到 base/head 清单或取数抛错 | 标准 | 同上 |
| 让逃逸账本条目转 fixed 的纯文档改动 | 标准，不是短 | 同上，另有隔离副本变异 |
| 名字带 auth / secret / schema / persist 的未登记文件，只改方向检查文档 | 不因此严 | 同上 |
| 把旧关键词硬线整套加回去 | 回放护栏红 | `scripts/process-tier-mutation.node-test.mjs` |
| 去掉四类里任意一类的判严 | 回放护栏红 | 同上 |
| 从夹具删一个 PR 没重跑生成脚本 | 数量断言红 | 同上 |

验收线：协调指定的独立验收线；实现线不自签。回滚：revert 本提交；规则与脚本变更可整体回滚，不触碰产品数据。未涉及花钱、长跑、可打断或新界面，故不需要真实窗口 / 付费走查。
