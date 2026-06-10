# docs 总地图 — 要找 X 去哪

> 查文档前先看这张表，按「我要找什么」跳到对应目录，别全量 grep。
> 各目录若有自己的索引（如 plan/），表里直接给出。

## 按「我要找什么」定位

| 我要找… | 去这里 |
|---|---|
| **某个功能的方案/执行计划** | [`plan/`](plan/) → 先读 [`plan/INDEX.md`](plan/INDEX.md)（64 篇按主题分组的查找表）|
| **设计系统 / token / 组件规范** | [`design/`](design/) → 核心是 `design/nomi-design-system.md`（任何 UI 改动前必读）|
| **UI 样张（HTML mockup）** | [`mockups/`](mockups/) ｜ 旧版 [`ui-designs/`](ui-designs/) |
| **代码健康 / 周期审计 / 问题分级** | [`audit/`](audit/) |
| **某版本改了什么** | [`release-notes/`](release-notes/) |
| **会话之间的交接（冷启动接手）** | [`handoff/`](handoff/) ｜ plan 里 `*-handoff.md` / `*-HANDOFF.md` 也是交接 |
| **工作流方法论（如何走查/E2E/自主测试）** | [`workflow/`](workflow/) |
| **模型接入实测产物（mapping/试验记录）** | [`onboarding-trials/`](onboarding-trials/) → 见其 `README.md` |
| **QA / 测试记录** | [`qa/`](qa/) |
| **架构定义** | [`architecture/`](architecture/) ｜ Agent Harness 架构在 `plan/2026-06-09-agent-harness-architecture.md` |
| **产品定位 / 营销 / 媒体素材** | [`product/`](product/) ｜ [`marketing/`](marketing/) ｜ [`media/`](media/) |
| **历史归档（已过时，仅留痕）** | [`archive/`](archive/) |

## 目录一览（文件数）

| 目录 | 数量 | 用途 |
|---|---|---|
| `plan/` | 64 | 方案/执行文档（**有 INDEX.md**）|
| `onboarding-trials/` | 21 | 模型接入实测产物 |
| `design/` | 20 | 设计系统 + 设计提案 |
| `release-notes/` | 16 | 版本变更记录 |
| `archive/` | 13 | 历史归档 |
| `audit/` | 11 | 周期审计 + 诊断 |
| `mockups/` | 5 | HTML 样张 |
| `qa/` | 4 | 测试记录 |
| `workflow/` | 2 | 工作流方法论 |
| `handoff/` | 2 | 会话交接 |
| `architecture/` `marketing/` `media/` `product/` `ui-designs/` | 各 1 | — |

## 相关索引（非 docs/）

- **会话记忆索引**：`~/.claude/.../memory/MEMORY.md`（跨会话事实，每行一条）
- **生成画布代码入口图**：[`../src/workbench/generationCanvas/ENTRY.md`](../src/workbench/generationCanvas/ENTRY.md)
- **工程纪律**：`../CLAUDE.md`（速览 + R1–R14）
