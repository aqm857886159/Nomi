# 先查别人标题与模板一致（L-gate-judgement-gaps）

## 变更意图
- 意图：纯修复
- 候选档位：短
- 单一意图：是
- 声明：纯修复：不改用户可见元素、布局、文案
- 界面核实：无界面差异

## ★0 先查别人
- `docs/engineering/design-card.md:20` · 模板把研究格命名为「★0 先查别人」 · 确认标题由模板声明，库直接读取它，不再抄一份名称。
- `scripts/check-prior-art.mjs:92`、`scripts/prior-art-lib.mjs:161` · 计划侧先按本次变更路径筛选，再核内容；取不到变更集才全量核 · 确认不改变历史卡的追溯边界，7 份存量问题仅披露。
- `scripts/prior-art-lib.mjs:179`、`scripts/pr-judgement-lib.mjs:600` · PR 自带研究节、引用方案以及 PR 判断工具共享抽节/路径入口 · 确认在共享库修标题，调用方不各写一份。

## 短版设计卡
- ★1：当实现线按模板写卡、协调线读 PR 时，合格的 ★0 节应被认出并核内容，缺来源不能静默跳过；主指标为标题/来源/入口矩阵正确率 100%，量具 `scripts/check-prior-art.node-test.mjs`，真实任务为删项目卡与选文迭代旧卡的 PR 引用。只改开发工具，无用户数据迁移，不改 52 卡内容。
- ★2：标题唯一 owner 是 `docs/engineering/design-card.md` ★0 格名；`extractPriorArtSection` 读它，计划/PR 两入口消费同一结果；`referencedPlans` 返回不变。门表来自 `door-map --roots=scripts --include-tests`；未知与未验证不当通过，无后台生命周期。
- ★3：任务书协调 11-21 17:3x 改判优先，D-1121-retro-rules-adopt 仍适用，历史 af86e1c0c 删除的研究分类格式检查不恢复。三路：只补硬编码标题会保留双份定义；从模板读取可收成一份；删抽节会失去来源核对。本次选第二路。recurring：52 份卡同族，计划/PR 两入口共用抽节；开发工具不是生产路径，不扩出任务书范围另建生产根因合同。
- ★4：空/缺节在计划侧仍可不要求、PR 需要时明确报缺节；读取同步；合格返回通过；来源不足返回错误；补核部分成功逐项披露；取消由进程终止；过期历史证据带 baseline SHA；模板缺失或格名读不出报错，无静默回退。
- ★9：协调验收用 `node --test scripts/check-prior-art.node-test.mjs`、两道 check、改动文件 eslint、推送前快检；回滚为 revert 本次提交。清单与反例如下，先锁定再验证；⑩⑪⑫无产品行为变化，界面/花钱/窗口走查不适用。只登记 reviewed，不结账 fixed。

## ★9 验收清单与反例
1. 模板 ★0 格名与旧标题、二/三级标题、有补充文字均识别；来源充分通过，缺来源拒绝；PR 自带与引卡走同一抽节。
2. 真样本 `docs/plan/2026-10-23-project-delete-to-trash.md`：★0 来源节与 PR 引卡通过；真旧案 `docs/plan/2026-10-21-select-to-iterate.md`：只有 1 条来源，改动它或引用它时拒绝。
3. 计划侧 `scopePlansToChanged`：没动旧卡不追溯；动了就核；取不到变更集全量核，不拿未知当通过。7 份存量卡在本 PR 不改，只在已知限制逐份披露。
4. 两种没做成版本：主分支原抽节跑新增目标测试必须红；全部拒绝跑同一组必须红；逐反例注入旧标题匹配/跳过来源/全拦/忽略变更集/PR 引卡跳过，再按字节还原证明回绿。
5. 52 卡补核不改内容；撤回的账本库与其单测同 origin/main 按字节一致；`check:escape-ledger` 仍过。

## 系统改进
最早能拦的是 `scripts/check-prior-art.node-test.mjs`：以前只测旧标题，没有模板格号的目标测试。结构改法是标题从模板读取、计划和 PR 共用抽节，同次删旧硬编码名称；真实正反卡与变异证明判据可失败。预测标题样本全对，量具是上述测试及 52 卡补核，复查日 2026-11-30；不达标重开。

## 没做的
按协调改判撤掉 `scripts/escape-ledger-lib.mjs` 和其单测的 AST 候选稿，保持 main 原状：候选稿把循环后集中断言判成不过，node:assert 与自写辅助也存在误判。32 条翻红的原始证据在 `/Users/aoqimin/Nomi-coord/tmp/L-gate-judgement-gaps/evidence/matrix-regressions.md`，完整结果在同目录 `matrix-audit.json`。按 D-1121-retro-rules-adopt 第 3 条，类级检查换工具收据归其它线，本 PR 不宣称已改好。
前轮经 Context7 查 TypeScript/Vitest、并读 eslint-plugin-jest 官方文档；这些研究只用于被撤方案，不作本次标题修复依据。
