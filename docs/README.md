# docs 总地图 — 要找 X 去哪

> 查文档前先看这张表，按「我要找什么」跳到对应目录；索引仍有历史存量缺口，查不到时必须继续全量 grep。
> 各目录若有自己的索引（如 plan/），表里直接给出。

## 按「我要找什么」定位

| 我要找… | 去这里 |
|---|---|
| **某个功能的方案/执行计划** | [`plan/`](plan/) → 先读 [`plan/INDEX.md`](plan/INDEX.md)（按主题分组的查找表）|
| **跨阶段总纲 / master plan** | [`superpowers/plans/`](superpowers/plans/) → 先读 [Nomi 统一 Agent 总体方案](superpowers/plans/2026-08-24-unified-agent-master-plan.md) |
| **每个子系统现在真正跑的是什么**（防止把三个月前的方案当现状） | [`ARCHITECTURE-NOW.md`](ARCHITECTURE-NOW.md) |
| **术语表：同一个东西的多个叫法（搜不到时先查这里）** | [`GLOSSARY.md`](GLOSSARY.md) |
| **已拍板但还没交付的，都欠着什么** | [`DELIVERY-LEDGER.md`](DELIVERY-LEDGER.md)（生成物；`pnpm run ledger:brief` 看一行摘要）|
| **设计系统 / token / 组件规范** | [`design/`](design/) → 核心是 `design/nomi-design-system.md`（任何 UI 改动前必读）|
| **「设计一个页面」的完整流程（可搬到别的产品复用）** | [`design/page-design-process.md`](design/page-design-process.md) → 七道闸 + 每道闸防的真实事故 + 可复制的模板/门岗/断言 |
| **UI 样张（HTML mockup）** | [`mockups/`](mockups/) ｜ 旧版 [`ui-designs/`](ui-designs/) |
| **代码健康 / 周期审计 / 问题分级** | [`audit/`](audit/) |
| **某版本改了什么** | [`release-notes/`](release-notes/) |
| **会话之间的交接（冷启动接手）** | [`handoff/`](handoff/) ｜ plan 里 `*-handoff.md` / `*-HANDOFF.md` 也是交接 |
| **工作流方法论（如何走查/E2E/自主测试）** | [`workflow/`](workflow/) |
| **多智能体编排（如何派工/收货/接力多个 Codex/Opus 执行体）** | [`engineering/agent-orchestration-playbook.md`](engineering/agent-orchestration-playbook.md)（CLAUDE.md R27 的 L2 详解）|
| **当前哪些战线在途 / 哪些文件面被占道（动共享面前必查必登）** | [`engineering/active-lanes.md`](engineering/active-lanes.md) |
| **本仓踩过的坑（走查假绿 / CI 红绿判读 / 分支合并 / 平台故障 / 产品判断）** | [`lessons/INDEX.md`](lessons/INDEX.md) — 按触发场景查，别通读 |
| **模型接入实测产物（mapping/试验记录）** | [`onboarding-trials/`](onboarding-trials/) → 见其 `README.md` |
| **QA / 测试记录** | [`qa/`](qa/) |
| **架构定义** | [`architecture/`](architecture/) ｜ Agent Harness 架构在 `plan/2026-06-09-agent-harness-architecture.md` |
| **产品定位 / 营销 / 媒体素材** | [`product/`](product/) ｜ [`marketing/`](marketing/) ｜ [`media/`](media/) |
| **历史归档（已过时，仅留痕）** | [`archive/`](archive/) |

## 目录一览

| 目录 | 用途 |
|---|---|
| `plan/` | 方案/执行文档（**有 INDEX.md，但仍有历史存量缺口**）|
| `superpowers/plans/` | 跨阶段总纲 / master plan |
| `onboarding-trials/` | 模型接入实测产物 |
| `design/` | 设计系统 + 设计提案 |
| `release-notes/` | 版本变更记录 |
| `archive/` | 历史归档 |
| `audit/` | 周期审计 + 诊断 |
| `mockups/` | HTML 样张 |
| `qa/` | 测试记录 |
| `workflow/` | 工作流方法论 |
| `engineering/` | 工程手册（多智能体编排等，CLAUDE.md 规则索引的 L2 详解）|
| `lessons/` | 教训库：踩过且还会再踩的坑，一条一个文件（**有 INDEX.md，新增必挂号**）|
| `handoff/` | 会话交接 |
| `architecture/` `marketing/` `media/` `product/` `ui-designs/` | 其它专题目录 |

## 相关索引（非 docs/）

- **会话记忆索引**：`~/.claude/.../memory/MEMORY.md`（跨会话事实，每行一条）。**踩坑教训的真相源已迁入 [`lessons/`](lessons/INDEX.md)**（2026-09-02），本机记忆里对应文件只剩一行指针；那边现在只留本机环境与在途战况。
- **生成画布代码入口图**：[`../src/workbench/generationCanvas/ENTRY.md`](../src/workbench/generationCanvas/ENTRY.md)
- **工程纪律**：`../CLAUDE.md`（速览 + R1–R14）
