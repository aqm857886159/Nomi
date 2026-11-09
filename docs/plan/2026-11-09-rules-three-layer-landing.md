# 三层规则与全局清单落地

实现线：I-rules-three-layer-landing；范围：纯规则文字与生成视图，最多 12 个文件。

## 短版设计卡

- ★1：把用户认可的三层问题处理、全局清单和主动删减文字逐字落地；量具为定稿逐字对照、`wc -m`、`wc -c`、生成一致性与规则引用检查；不改产品、门岗或用户数据，老用户存量不适用。
- ★2：CLAUDE.md 为常驻规则源，rules.json 为登记正本，AGENTS.md / rules.md 只生成；全部家还包括 design-card.md、engineering-rules.md 与 self-check.sh；工具清单来自 door-map 的 renderView / buildIndex 调用图及 git grep 的规则引用。
- ★3：沿用已批准的定稿，合并重复文字、删 R14；不另造规则框架或门岗；P2 的 manual 保持到 G1 合入。UTF-8 下原文件 4,673 字符、10,167 字节，两个口径都只减不增，文中基线按用户定稿保留。
- ★4：空 / 加载 / 成功 / 失败 / 取消中 / 过期 / 能力不可用均不涉及产品状态；检查失败按任务书停点报告，所有变异按字节还原。
- ★9：逐字核 P1 增句、P2 整段、P5 开头与 ★7 / 短档替换；核 R14 删除、旧子号归 P1、RW / R17 / 卡格 / 五步 / 钩子同步；运行生成与引用检查、推送前快检及正文六项预检；反例为 AGENTS.md 改一字→同步红→还原绿、删 R14 后残留裸 R14 引用→引用红→还原绿、CLAUDE.md 超过 10,167 字符→探查现有字数门岗（不存在则记缺量具，禁止新造）；不触发独立验收四类。回滚用逐项 revert，抵扣删除单独提交。

## 抵扣删除合同

仅删已有门岗能拦、正文重复的 4 句 / 子句，共 395 字节，单独提交并逐句列入提交说明：

1. 禁止手改 AGENTS.md 的维护句：`check:agents-sync` 的 `scripts/gen-agents-md.mjs --check` 按字节核生成源，生成文件头也保留指引。
2. 最新 origin/main、独立分支和 PR 交付句：`delivery:preflight` 的 `assertPreflightState` 拦保护分支、脏树与未含远端基线；`check:main-guard` / PR 门岗守交付，后文并行纪律仍保留 PR 约束。
3. PR 正文设计卡链接或全文子句：`check:pr-judgement` 的 `checkDesignCard` 查中文设计卡正文或所引 docs/plan 文档。
4. 四类独立验收句：同一门岗的 `checkIndependentAcceptance` 查报告、验收线与实现线不同，合并档阻断缺失。

以上门岗出处以开工的 git grep 日志为准；没有声明它们能证明人的执行时序或内容质量。
