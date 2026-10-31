# 加强「自写」和「方向检查」两道闸（P0 / RW）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：已实现未推送（2026-10-05）。用户 10-05 拍板 5 条全做。公开仓，不写金额和私有待办。

## 为什么改

MCP 协议层和连接方式是自己写的、没有用官方 SDK，一个月修了约 14 次，散在 6 个文件里，两道闸都没拦住：

- 自写登记里 `mcp-protocol` 写的是 under-review「尚未评估」，期限 11-15。到期后只是被 `audit:self-written` 列进清单，什么都不拦（`validateRegistry` 里的 `void today` 说明根本不看到期）。
- `check:self-written` 只拦「新增的未认领模块」，已存在的旧机制修多少次都不管。
- 方向检查 `fix-churn` 按「文件」和「概念大小的目录」数，窗口 14 天、第 3 个才命中；MCP 的修补散开了，没凑够。
- 复盘模板的选项是「补 / 重写 / 删」，没有「接入现成方案」。

## 设计卡（★5 格）

改动名：自写登记到期真拦 + 方向检查按概念计数    线 / 负责人：L-rules5    类别：[其他]

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 用户 = 协调会话和实现线。当实现线要修一条已登记的自写通用能力第 2 次时，提交会被拦，要求先写复盘评估「接入现成方案」；排版本计划时协调会话跑 `node scripts/self-written-review.mjs`，把到期清单给用户看。不做：不改任何产品代码、不动 `mcp-protocol` 这一条（#1011 在改）。已知坑：`gate-family`（`scripts/check-*.mjs`）和 `validation-policy` 是 scripts 下的自写机制，修它们也会命中，一份点名该 id 的复盘可被多个提交共用。真实任务：回放最近 30 天的 main（见下表）。 | `node scripts/fix-churn.mjs electron/capabilityCore/mcpStdioLine.ts` |
| ★2 谁说了算 | 「哪些东西算同一个单位、窗口和阈值」唯一 owner = `scripts/fix-churn-units.mjs`（登记条目 / 概念）+ `scripts/fix-churn.mjs`（数法）；「评估是否到期」唯一 owner = `scripts/self-written-lib.mjs` 的 `evaluateReviewDeadlines`。commit-msg、编辑提醒、派工前、CI 警告都走同一份，不新增第二份数法。 | `node scripts/door-map.mjs findHotspots` |
| ★3 一致与复用 | 路径匹配复用 `pathMatches`（登记表本来就用）；概念清单复用 `concept-owners.json`、登记清单复用 `self-written.json`，不另立清单。自写：计数单位这一层是我们独有的（登记表与概念清单是 Nomi 的领域数据），数 git 提交本身仍用既有的 `loadHistory`，没有引入新库。 | 本文「先查别人」 |
| ★4 全状态 | 不适用：没有用户界面。命令行状态：命中（退出 1，提示写清哪条登记、第几个 fix、要做什么）/ 未命中（退出 0）/ git 或登记表读不到（fail-open，不拦）/ 无 base（不判到期与新登记，登记表形状照查）。 | `scripts/fix-churn.node-test.mjs`、`scripts/check-self-written.node-test.mjs` |
| ★9 验收与回滚 | 验收：另一条线对着本卡跑 `pnpm run check:self-written`、`check:claude-hooks`、`check:hook-behavior`，并复跑下面两张回放表的命令。回滚：revert 本分支的 5 个提交；规则正本的措辞同在 `rules.json`，revert 后重跑 `gen:agents`。 | 提交列表 |

## 先查别人

- **到期强制复审的现成做法**：`eslint-plugin-unicorn` 的 `expiring-todo-comments`：TODO 写了日期，日期一过 lint 就报——https://github.com/sindresorhus/eslint-plugin-unicorn/blob/main/docs/rules/expiring-todo-comments.md 。我们的 `reviewBy` 过期后「碰到再拦」是同一个思路；差别：它到期全仓都报，我们只在改动碰到该条目的文件时才拦（否则一个到期的登记会拖住所有无关 PR）。
- **弃用必须有期限和强制手段**：Google《Software Engineering at Google》第 15 章 Deprecation——https://abseil.io/resources/swe-book/html/ch15.html ：强制弃用要有明确的移除日期、有人能在宽限期后真的关掉不合规的东西，光有清单没人拦就是空话。对应本卡的「到期真拦」。
- **决策记录要复审**：Michael Nygard 的 ADR（Architecture Decision Record，状态可以是 superseded / deprecated）——https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions ；ADR 社区——https://adr.github.io/ 。对应 `under-review` 的 `reviewBy` 与「最多续一次」：评估也是一个有期限的决定，不能无限挂着。
- **按热点 / 概念数改动次数**：CodeScene 的 hotspot 分析（按改动频率 × 复杂度找热点，并用「逻辑耦合」把总是一起改的文件合起来看）——https://codescene.io/docs/guides/technical/hotspots.html 。对应本卡「按登记条目 / 按概念把文件合起来数」：散在多个文件的同一类修补，按单文件数不到。
- **依赖到期强制复审**：Renovate 的依赖仪表盘（Dependency Dashboard）把过期未处理的依赖更新集中列出——https://docs.renovatebot.com/key-concepts/dashboard/ 。对应 `audit:self-written` 的清单：清单只负责「给人看」，真拦由门岗承担。
- **结论**：「到期强制复审」「按概念合并计数」都有成熟做法，思路照搬；没有现成工具能直接读我们的登记表和概念清单，所以这一层胶水自写（登记在 `self-written-gate`，理由：数据是 Nomi 的领域数据）。

## 五条做了什么

1. **自写通用能力修第 2 次就评估替换**：`fix-churn` 新增计数单位「自写登记条目」（`scripts/fix-churn-units.mjs`）。status 为 under-review / to-replace，或 justified 但属 genericZones 的条目；窗口 30 天，第 2 个 fix 命中，提示写清「哪条登记、第几个 fix、先评估接入现成方案（P0），要继续补必须在复盘里写清为什么现在换不了、哪天换」。commit-msg 同步：命中自写登记的 `Direction-Check` 复盘文档必须点名该条的 id（不然拿一份无关复盘就能放行）。
2. **评估到期真拦**：`under-review` 过了 `reviewBy`（今天 > reviewBy），且这次改动（base..HEAD 的全部文件）碰到该条目的 paths，`check:self-written` 报错。「改动本身就是评估或替换」的判法：同一次改动把它改离 under-review（或删掉条目）——那时它已不是 under-review，自然不报；不需要靠提交信息引用 id 这种可以随口写的口子。新登记（或刚改成 under-review）的 `reviewBy` 距今 ≤30 天；往后推必须同时加一条 `renewed: [{ on, from, reason }]` 且仍 ≤30 天，第二次续报错。存量条目日期不动、不追溯。
3. **按概念计数**：再加单位「concept-owners 的一个概念」（owner + write_api 的文件合起来，≥2 个文件才单列），14 天 / 第 3 个，沿用目录那把「概念大小」上限（窗口内 fix 碰过的不同源码文件 ≤6）。
4. **复盘模板**：§6 第一个选项改成「接入现成方案」（写清哪个库或标准、给出处）；成熟方案存在时推荐项默认是接入，除非有领域约束；§5 与自写登记同一个说法。
5. **登记完整、清死账**：删 `spend-card-polling`（#999 已删轮询，登记的能力不存在了；文件还在，但已是普通的付费确认 hook）。其余 3 条 to-replace 逐条核对：`lane-legacy-migration`（laneLegacy* 7 个文件都在）、`ai-sdk-text-stack`（electron/ai 4 个文件都在）、`generate-outcome-receipt`（文件在、lane 还在用），代码都还在，不删。`check:self-written` 新加：to-replace 的 paths 全不存在 → 报「已替换，请删登记」。`commands.md` 写明排版本计划时跑 `self-written-review`。`mcp-protocol` 这一条没动（#1011 在改）。

## 回放（最近 30 天的 main，登记表按 #1011 之前算）

命令：`node scripts/fix-churn.mjs --range <30 天前>..origin/main`，窗口内共 1021 个 fix 提交。

### 表 1：自写登记条目（第 1 条）

「首次命中」按整段历史（2026-05 起）回放，取第一个「30 天内已有 1 个 fix」的提交；「近 30 天命中提交」= 窗口内有多少个 fix 提交会被这一条拦；「旧规则不响」= 其中文件 / 目录那票原本没响的。

| 登记条目 | 状态 | 首次命中 | 近 30 天命中提交 | 其中旧规则不响 |
|---|---|---|---|---|
| mcp-protocol | under-review | **2026-08-17，第 2 个 fix**（baba701d8 fix(mcp): derive ratio-semantic size…）；此后累计 46 个 | 33 | **0**（旧规则本来就响，但提示是「补 / 重写 / 删」，没有「接入现成方案」） |
| gate-family | under-review | 2026-06-04，第 2 个（c91af27d5） | 88 | 38 |
| validation-policy | under-review | 2026-08-29，第 2 个（35e7471fe） | 10 | 6 |
| network-stack | under-review | 2026-06-14，第 2 个（8bba89431） | 6 | 1 |
| logging-and-crash | under-review | 2026-08-12，第 2 个（9b2c8f441） | 5 | 1 |
| lane-legacy-migration | to-replace | 2026-09-08，第 2 个（ea1a27b1c） | 2 | 2 |
| durable-json | under-review | 2026-09-08，第 2 个（a7f1559c1） | 2 | 0 |
| ai-sdk-text-stack | to-replace | 2026-06-13，第 2 个（47a3fbb3b） | 2 | 0 |
| conversations-store | under-review | 2026-08-25，第 2 个（5b7b87bd4） | 0 | — |
| generate-outcome-receipt / director-refine-panel-hooks | to-replace / justified（通用区） | 窗口内未命中 | 0 | — |

（`spend-card-polling` 已删；MCP 若按 #1011 之后的登记算，启动器 `mcpNodeLauncher.ts` 也在 paths 里，命中更早更密。）

注意：窗口内 1021 个 fix 提交里，会被任一自写登记命中的有 152 个，其中 47 个是旧规则不响的。`gate-family`（88）和 `validation-policy`（10）占大头——它们是 scripts 下的机制，几乎每个 CI 修补都碰；这正是「该评估接入现成方案（dependency-cruiser、eslint 插件、现成 CI 工具）」的信号，不是误报，但会有摩擦，见下方拍板项。

### 表 2：concept-owners 概念（第 3 条）

窗口内 167 个 fix 提交带概念命中；**其中只有 4 个是旧规则（文件 / 目录）与自写登记都没响的**——概念单位几乎不引入新噪音，上限不用再收紧（单个概念最多 8 个文件，窗口内碰过的不同源码文件 ≤6 的上限保留）。命中最多的概念（多数与旧规则重合）：

| 概念 | 近 30 天命中提交 | 其中只有它响 |
|---|---|---|
| Agent 面板流条目的身份 | 23 | 0 |
| 制作镜头的节点还在不在画布上 | 22 | 0 |
| Agent 面板上用户看得见的失败文字与工具收据文字 | 20 | 0 |
| 制作镜头的生成归属 | 18 | 0 |
| 画布返工 / 续拍没做成怎么跟用户说 | 18 | 0 |
| 被动 MCP 请求会不会冷启动 Nomi | 15 | 0 |
| 生成错误怎么说成人话 | 15 | 0 |
| 一份补丁怎么并进这一镜的候选 | 14 | 0 |
| MCP 调用怎么找到活 Nomi 并把请求转过去 | 5 | 0 |
| 一条提示的身份、去重、撤回与位置 / 画布单节点付费生成 / 一次运行发给了哪家的哪个模型 / 导演台素材目录 | 各 1 | 各 1 |

## 验红

见提交说明与 PR 正文：每条都临时构造过会命中的情况，门岗变红，还原后变绿（真 git 仓库的 node-test 里留了永久用例）。
