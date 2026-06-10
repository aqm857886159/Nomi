# 文件分类与查找成本 — 诊断报告

> 触发：用户反馈「查一个东西要花很多 token，是不是文件分类和管理有问题」。
> 范围：只诊断 + 给方案，不动文件。
> 日期：2026-06-11

## 一句话结论

**分类骨架没问题，问题是一个倾倒场 + 全局缺地图。**
不是分类维度错了，是 `docs/plan/` 长成了 64 个平铺文件的黑洞，且整个 docs/ 和 src/ 缺一层「要找 X 去哪」的索引，导致每次查找都从冷启动全扫开始。

## 实测盘点

### docs/（171 文件）

| 子目录 | 文件数 | 状态 |
|---|---|---|
| **plan** | **64** | ⚠️ 黑洞：全平铺，只按日期前缀命名，无主题分组、无索引 |
| onboarding-trials | 21 | 试验产物，量大但属归档性质，可接受 |
| design | 20 | 合理 |
| release-notes | 16 | 合理 |
| archive | 13 | 已归档，合理 |
| audit | 11 | 合理 |
| 其余 (mockups/qa/handoff/workflow...) | 各 1–5 | 合理 |

### src/（约 310 文件）

| 目录 | 文件数 | 状态 |
|---|---|---|
| workbench/generationCanvas | 112 | ✅ **内部分得好**：nodes/42 · runner/15 · model/13 · agent/12 · components/10 · store/8 · adapters/5 · fixation/4。总数大但有清晰子结构，不是黑洞 |
| workbench/（其余功能域） | 各 1–16 | ✅ 按功能域分目录（ai/assets/timeline/export/project...），合理 |
| config | 27 | 合理 |
| design | 16 | 合理 |

**修正**：初判时把 generationCanvas 当成和 plan 并列的黑洞，是只看总数没看内部。实测它内部子目录划分清晰，撤回该判断。

## 查找费 token 的真正机制

不是「分类错」，是这三条让查找无法走「查表」、只能走「全扫」：

1. **`docs/plan` 按日期命名，不按主题** —— 想找「画布节点方案」，相关文件叫 `2026-06-06-composable-node-execution-plan.md`、`2026-05-31-asset-node-and-canvas-perf.md`、`2026-06-10-...`，散在 64 个里。日期排序只对「找最近改的」有用，对「找某主题」零帮助 → 只能 grep 全量再逐个读。
   主题其实高度可聚类（文件名词频）：onboarding 12 · agent/harness 各 5–6 · node/canvas 各 3–4 · model 4 · timeline/export/workspace 各 2。

2. **全局没有索引层** —— `MEMORY.md` 是会话记忆的索引，但代码和文档本身没有「这块逻辑/这个主题在哪」的地图。唯一的 README 是 `src/design/README.md`。每次查找都是冷启动。

3. **已完成的 plan 没沉淀/归档** —— 64 个里很多是早已落地的历史方案，和「还在进行中的」混在一起，扫描时无法快速跳过噪声。

## 分级问题

| 级别 | 问题 | 证据 |
|---|---|---|
| **P0** | docs/plan 64 文件平铺无索引、无主题分组 | `ls docs/plan` = 64；词频可聚成 8 类 |
| **P1** | docs/ 与 src/ 缺顶层「找 X 去哪」地图 | 全仓仅 1 个内容性 README |
| **P2** | 已落地的历史 plan 未归档，与进行中混存 | docs/archive 仅 13，plan 里大量 2026-05 旧方案 |
| **P3** | 个别巨壳文件（与分类无关，属 R9/R12） | Scene3DFullscreen.tsx 3860 行（应在白名单内，单列追踪） |

## 建议方案（按性价比排序，待拍板）

| 方案 | 做什么 | 代价 | 见效 |
|---|---|---|---|
| **A（推荐）** | docs/plan 按主题分子目录（onboarding/canvas/model/agent-harness/timeline/export/infra...）+ 写 `docs/plan/INDEX.md` 地图；已落地的移入 archive | 低，纯移动+加索引，不碰代码 | 立竿见影，查 plan 从全扫变查表 |
| **B** | 全 docs 加一张 `docs/README.md` 总地图（「要找 X 去 Y」），文件不动 | 极低，纯加导航 | 中，覆盖面广但粒度粗 |
| **C** | 给 generationCanvas 加一张 `ENTRY.md` 入口图（各子目录职责 + 关键文件 file:line） | 低，不动代码 | 中，降低代码查找成本 |
| **D** | 巨壳拆分（Scene3DFullscreen 等） | 高，动代码需评审 | 与本次查找成本关系不大，单列 |

A + B + C 三个加起来仍是「纯加索引 + 移文件」，零代码风险，能覆盖绝大多数查找场景。D 属于另一条线（R9/R12），不在本次范围内。

## 不动什么

- src/ 的功能域分目录结构（已合理）
- generationCanvas 内部子结构（已合理）
- 设计系统 / config / release-notes 等已规整的目录

## 执行回填（2026-06-11）

用户拍板做 A/B/C。**A 据实情调整**：发现 docs/plan 内 50+ 处路径互链，物理移动会断链 + 对「查东西花 token」一份索引本就优于子目录（读一个文件拿全图），故 **A 改为索引化、不挪文件**。

- ✅ **A** — [`docs/plan/INDEX.md`](../plan/INDEX.md)：64 篇按 8 主题分组 + 状态标记（✅/🚧/📋/⛔/📎），零断链
- ✅ **B** — [`docs/README.md`](../README.md)：全 docs「要找 X 去哪」总地图
- ✅ **C** — [`src/workbench/generationCanvas/ENTRY.md`](../../src/workbench/generationCanvas/ENTRY.md)：112 文件画布按子目录 + 「我要改 X 去哪」入口图
- ⏳ **D** — 巨壳拆分，未做（独立线，R9/R12）

### ✅ 已完成：generationCanvasV2 → generationCanvas 改名（2026-06-11）

查实：树里**无 V1**。"V2" 是从旧 `apps/web/.../generationCanvas` monorepo 布局「publish clean workspace」(commit `27ab140`) 带过来的残留后缀。
用户拍板后改名：`git mv` 目录 + 字面替换全仓 64 个文件（30 代码 + 32 文档 + check-file-sizes 白名单 + 主进程 canvasTools.ts），残留 0。组件名本就是 `GenerationCanvas`（无 V2 标识符），故纯路径改名、不碰符号。已过五门。

## 下一步

A/B/C + V2 改名已落地。D（巨壳拆分）留作独立任务，待用户拍板。
