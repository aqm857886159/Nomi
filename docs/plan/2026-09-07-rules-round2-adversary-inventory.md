# 规则第二轮：把「每次都要用户提醒才去查别人做了没」做成机器强制

> 📎 方案 · 2026-09-07 · 状态：实施中（本分支 `docs/rules-round2-adversary-inventory-20260907`）
> 上游：R29/R30（PR #554）把「框架已有的能力不许再长一份」做成了门岗。本轮补它的**上游与旁路**。

## 为什么（类根因，用大白话）

用户已经不止一次得亲自说「你先去查查别人做了没」。每次被提醒之后我们都查得挺好——**问题不在能力，在结构**：

1. **系统只奖励「做出来」，不惩罚「没查」。** 交付的评价函数里，「写出来了、门岗全绿」是有分的，「查过了、发现已经有、于是没写」是零分甚至负分（看起来什么都没干）。在这样的分数下，跳过检索是最优策略。
2. **派工单的视角天生是「把这件事做出来」。** 一份任务书写的是目标和验收，没有一格写「先证明这件事没人做过」。每个执行体只看得见自己那一块。
3. **文字提醒在高负载下必漏。** `CLAUDE.md` 里 R5/R6/R20/R29 都写着要查，但它们是提醒；提醒的命中率随上下文压力单调下降，而实施任务恰恰是上下文最满的时候。

结论：这三条都不是靠「再写一条规则」能修的——规则本身就是第三条的症状。**要么让机器在缺检索时报红，要么这件事永远靠用户提醒。**

## 先查别人

| 问题 | 答案 | 出处 |
|---|---|---|
| 依赖里已有？ | 没有。仓库依赖里没有任何 PR 策略 / 文档结构检查工具；`ai@4.3.19`、`@xyflow/react@12.11.5` 等都与此无关。能力面已机器抽成清单：docs/engineering/dependency-capabilities.generated.json | 本仓 package.json:17（dependencies 全表），docs/engineering/dependency-capabilities.generated.json |
| 仓库里已有？ | 半个。`check:framework-boundary`（scripts/check-framework-boundary.mjs:1，2026-09-07 合入）拦的是「框架已有的能力又写了一份」，**它拦不到「决定要不要写之前那次检索本身」**；`check:docs-index`（scripts/check-docs-index.mjs:1）只管文档有没有被索引，不看内容 | scripts/check-framework-boundary.mjs:1、scripts/check-docs-index.mjs:1、docs/engineering-rules.md:628（R29 正文） |
| 生态里已有？ | 有近邻，都不合用。① Danger JS 能在 CI 里对 PR 正文/diff 写策略（https://danger.systems/js/），但它要装一个 JS 依赖 + 一套自有 DSL，而我们要的判据只有 40 行，本仓的门岗链已经是纯 node 脚本（R20：不在护城河上的通用问题用标准实现，但这条不通用——判据是我们自己的派工纪律）。② ADR（https://adr.github.io/）解决的是「决策记下来」，不解决「决策前查没查」。③ api-extractor（https://api-extractor.com/）能出完整 API 报告，但产物按版本天天变、没人读，我们只需要词级别的「这是不是它已经管的事」 | https://danger.systems/js/ 、https://adr.github.io/ 、https://api-extractor.com/ |
| 钩子怎么随仓库走？ | Claude Code 官方就有这个机制：Shared project settings = `.claude/settings.json`，「In a git repository, commit it so teammates get it」；个人覆盖走 `.claude/settings.local.json`。我们此前没用它，才自己写了个安装器 | https://code.claude.com/docs/en/settings（2026-09-07 实读） |
| TikHub 自媒体里怎么说？ | 本轮未查——判据是本仓自己的派工纪律，不是面向用户的产品能力，自媒体侧没有可比的一手经验。**明着标出来，不冒充覆盖**（D4） | 无 |

**结论**：自研，但只自研判据（每样 40–150 行 node 脚本 + node-test），机制照抄 Claude Code 官方的共享设置约定与本仓既有的棘轮门岗形状（scripts/framework-boundary-lib.mjs:1）。

## 四样落地

| # | 拦的真实摩擦 | 机器强制 |
|---|---|---|
| 1 | 派工时没人被逼着先查 | `check:prior-art`：新方案缺「## 先查别人」节或出处 <3 条 → 红；PR 改 src/electron >300 行且正文不引方案 → 红。手册加 R27 §15 反方 agent 步骤 |
| 2 | 「依赖到底提供什么」只活在人手写的登记表里 | `gen:dependency-capabilities` 从 node_modules 机器抽能力词表；`check:dependency-capabilities` 在版本/词表变化时逼重生成；`check:framework-boundary` 加一条 advisory 启发式 |
| 3 | 钩子装了才有 = 闸门靠运气 | `.claude/settings.json` 进 git、直指 `scripts/claude-hooks/*.sh`；`install-claude-hooks.cjs` 从安装器改成注册校验器 + 迁移器 |
| 4 | 根因流程逐件执行，看不见「这周第三次」 | `check:symptom-cluster`（同模块 7 天 ≥3 份合同 → 要求结构评审）、合同必填 `invariant_owner_layer`、R14 审计清单固定三条 |

## 不动的东西

- 不改任何产品代码（`src/` / `electron/` 零改动）。
- 不动既有门岗的判据，只给 `check:framework-boundary` 加一条**不阻断**的 advisory。
- 不追溯历史：方案 / 合同 / 聚簇一律按 2026-09-07 日期阈值豁免。

## 回滚

四样各自独立，按 commit 逐个 revert 即可；`.claude/settings.json` 那条回滚后需要重跑 `pnpm install` 才能恢复旧的 `.claude/hooks/` 安装副本。

## 验收门

- 每样都有 R17 红证明（先造违规确认报红，再撤销确认转绿）与 node-test。
- `pnpm run gates` 全绿；新门岗以豁免 / advisory 形式绿。
- `check:agents-sync` 绿（CLAUDE.md 改动经 `gen:agents` 同步）。
