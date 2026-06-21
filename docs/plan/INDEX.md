# docs/plan 索引地图

> 64 篇方案/执行文档按**主题**分组的查找表。文件本身保持平铺（彼此有 50+ 处路径互链，移动会断链），本表负责「按主题/状态秒定位」。
> 新增 plan 时**顺手在本表对应主题下加一行**。
> 状态图例：✅ 已落地 ｜ 🚧 进行中/待实施 ｜ 📋 方案待拍板 ｜ ⛔ 已撤销/废弃 ｜ 📎 交接/日志

## 模型接入 / Onboarding（最大簇）

| 文件 | 一句话 | 状态 |
|---|---|---|
| [2026-06-07-model-onboarding-final-plan.md](2026-06-07-model-onboarding-final-plan.md) | **模型接入最终方案**（R7 定稿，审计+设计+计划）— 本簇主文档 | ✅ |
| [2026-06-07-apimart-curated-onboarding.md](2026-06-07-apimart-curated-onboarding.md) | 策展两家(kie+apimart)一键接入；战略从「通用接入」转向 | ✅ |
| [2026-06-06-universal-model-onboarding.md](2026-06-06-universal-model-onboarding.md) | 「描述符+通用解释器接长尾」研究稿 | ⛔ |
| [2026-05-30-onboarding-schema-first-extraction.md](2026-05-30-onboarding-schema-first-extraction.md) | 参数抽取从 curl-only 升级为 schema-first | 🚧 |
| [2026-06-06-wire-protocol-onboarding-fix.md](2026-06-06-wire-protocol-onboarding-fix.md) | 接入格式全链路统一，根治「第3协议被 IPC 吞掉」 | 📋 |
| [2026-06-07-onboarding-panel-redesign.md](2026-06-07-onboarding-panel-redesign.md) | 接入面板重设计（折叠摘要卡） | 🚧 |
| [2026-06-07-p0-kie-video-execution.md](2026-06-07-p0-kie-video-execution.md) | P0：kie 主路做到极致（含视频） | 🚧 |
| [2026-06-07-p1-async-task-foundation.md](2026-06-07-p1-async-task-foundation.md) | P1：异步任务底座（存盘+后台轮询+重启续跑） | 🚧 |
| [2026-06-08-vendor-switch-archetype-migration.md](2026-06-08-vendor-switch-archetype-migration.md) | 断开供应商后老节点自动迁移到同款模型 | 📋 |
| [onboarding-baseurl-entry.md](onboarding-baseurl-entry.md) | 手填供应商为主、读文档为辅 | 🚧 |
| [onboarding-form-restructure.md](onboarding-form-restructure.md) | 加模型弹窗减负 + 适配式入口重组 | 🚧 |
| [onboarding-form-design-polish.md](onboarding-form-design-polish.md) | 加模型表单设计打磨（对照设计系统） | 🚧 |
| [onboarding-form-simplify.md](onboarding-form-simplify.md) | 表单优化（降噪+自动拉模型+预设） | 🚧 |
| [v0.8-model-onboarding-redesign.md](v0.8-model-onboarding-redesign.md) | v0.8 接入重做（Lab-First + Agent + 强约束） | 📎 |
| [v0.8-onboarding-design-principles.md](v0.8-onboarding-design-principles.md) | v0.8 Onboarding Agent 设计原则 | 📎 |

## 模型档案 / Archetype

| 文件 | 一句话 | 状态 |
|---|---|---|
| [2026-06-05-model-archetype-seedance-happyhorse.md](2026-06-05-model-archetype-seedance-happyhorse.md) | 模型档案层+模式原语，接入 Seedance/HappyHorse | 🚧 |
| [2026-06-06-image-archetypes.md](2026-06-06-image-archetypes.md) | 把图像模型接入「模型档案」体系 | 🚧 |

## 生成画布 / 节点系统

| 文件 | 一句话 | 状态 |
|---|---|---|
| [2026-06-06-composable-node-execution-plan.md](2026-06-06-composable-node-execution-plan.md) | **生成节点→「档案声明+通用原语组装」执行计划**（C0–C4 已落地） | ✅ |
| [2026-06-06-composable-node-roadmap.md](2026-06-06-composable-node-roadmap.md) | 同上的路线图+现状盘点(带 file:line) | ✅ |
| [2026-06-06-HANDOFF.md](2026-06-06-HANDOFF.md) | 生成节点「通用化」项目交接 | 📎 |
| [2026-06-06-P0-P1-execution-log.md](2026-06-06-P0-P1-execution-log.md) | 通用素材系统 P0+P1 执行日志 | 📎 |
| [2026-06-06-reference-at-and-sources.md](2026-06-06-reference-at-and-sources.md) | 通用「素材引用」系统（非 Seedance 专用） | 🚧 |
| [2026-06-06-drop-and-wire-execution.md](2026-06-06-drop-and-wire-execution.md) | 拖入/连线→参考（drop-and-wire） | 🚧 |
| [2026-05-31-asset-node-and-canvas-perf.md](2026-05-31-asset-node-and-canvas-perf.md) | 素材节点(≠生成节点) + A1.5 组件抽取 | ✅ |
| [2026-05-31-canvas-image-resize-crop.md](2026-05-31-canvas-image-resize-crop.md) | 画布图片等比缩放+裁剪（Figma 式） | 📋 |
| [2026-05-31-three-canvas-bugs.md](2026-05-31-three-canvas-bugs.md) | 修三个生成画布 bug | 🚧 |
| [c5-text-node.md](c5-text-node.md) | C5 文本节点→文档编辑器 | 🚧 |
| [v0.8-card-cleanup-execution.md](v0.8-card-cleanup-execution.md) | v0.8 节点卡片瘦身 | 📎 |
| [file-preview.md](file-preview.md) | 本地文件预览（画布旁点开就看） | 🚧 |

## Agent / Harness / 助手

| 文件 | 一句话 | 状态 |
|---|---|---|
| [2026-06-09-agent-harness-architecture.md](2026-06-09-agent-harness-architecture.md) | **Agent Harness 架构定义与演进** — 本簇主文档 | 📋 |
| [2026-06-21-self-improving-harness-loop.md](2026-06-21-self-improving-harness-loop.md) | **自我改进 harness 闭环**：AI 扮用户跑测试→量化诊断→修→重跑；架构铁律=查agent≠修agent(治自偏)；指标分三层(客观脊梁/半客观校准/主观人锚)；扩现有评测体系；不训模型/不碰GPU | 📋 |
| [2026-06-10-nomi-harness-requirements.md](2026-06-10-nomi-harness-requirements.md) | Harness 需求真相源 | 📋 |
| [2026-06-10-nomi-harness-framework-research.md](2026-06-10-nomi-harness-framework-research.md) | Harness 框架选型调研（三路并行 agent） | 📋 |
| [2026-06-10-nomi-harness-teardown-reference-pool.md](2026-06-10-nomi-harness-teardown-reference-pool.md) | Harness 拆解+参考池定稿 | 📋 |
| [2026-06-07-agent-harness-hardening-plan.md](2026-06-07-agent-harness-hardening-plan.md) | Agent Harness 硬化（Tier 1+2） | 🚧 |
| [agent-foundation.md](agent-foundation.md) | Agent 底座能力规格（Foundation Spec） | 📋 |
| [2026-06-01-agent-system-review.md](2026-06-01-agent-system-review.md) | Agent 系统梳理 + 4 个问题处理 | 📎 |
| [2026-06-06-unified-agent-merge.md](2026-06-06-unified-agent-merge.md) | 合并创作 agent 与画布 agent（草案） | 📋 |
| [agent-merge-architecture.md](agent-merge-architecture.md) | 两个 Agent 合并：修幻影工具+架构对齐 | 🚧 |
| [2026-06-07-assistant-consolidation-plan.md](2026-06-07-assistant-consolidation-plan.md) | 助手面板收敛（双面板→单上下文助手） | 🚧 |
| [2026-06-07-assistant-mockup-implementation.md](2026-06-07-assistant-mockup-implementation.md) | 助手面板对齐样张（R8 实现规范） | 🚧 |
| [2026-06-09-创作AI附件与对话体验.md](2026-06-09-创作AI附件与对话体验.md) | 创作 AI 助手：多格式附件+对话升级 | 📋 |

## 时间轴 / 预览 / 导出

| 文件 | 一句话 | 状态 |
|---|---|---|
| [2026-05-24-production-video-export-execution-plan.md](2026-05-24-production-video-export-execution-plan.md) | 成片视频导出实施计划 | 🚧 |
| [2026-06-03-timeline-interaction-rework.md](2026-06-03-timeline-interaction-rework.md) | 时间轴交互层重做 | 📋 |
| [2026-06-04-timeline-wysiwyg-and-export.md](2026-06-04-timeline-wysiwyg-and-export.md) | P2 预览=成片(WYSIWYG) + P3 导出能力 | 📋 |
| [2026-06-21-blender-3d-render-lane.md](2026-06-21-blender-3d-render-lane.md) | **Blender 3D 渲染 lane**：AI 生资产→headless Blender 渲简单镜头→进时间轴，补「跨镜一致+真相机控制」；范围狠砍(不碰绑骨/动画/GUI/捆绑) | 📋 |

## 项目库 / 素材库 / Workspace / 左面板

| 文件 | 一句话 | 状态 |
|---|---|---|
| [2026-05-31-workspace-folder-projects-implementation-plan.md](2026-05-31-workspace-folder-projects-implementation-plan.md) | 任意文件夹 Workspace 项目实施 | 🚧 |
| [2026-05-31-merge-workspace-feature.md](2026-05-31-merge-workspace-feature.md) | 把 workspace 文件管理合并进 main | 🚧 |
| [2026-05-31-left-panel-material-redesign.md](2026-05-31-left-panel-material-redesign.md) | 左面板重做：分类/素材双 Tab | 📋 |
| [2026-05-31-library-search-cost-fixes.md](2026-05-31-library-search-cost-fixes.md) | 30秒体验/假搜索/花费徽章 三处修复 | 🚧 |
| [2026-06-08-custom-categories-and-chat-polish.md](2026-06-08-custom-categories-and-chat-polish.md) | 自定义分类+聊天气泡统一+右键菜单瘦身 | 🚧 |

## 性能 / 技术地基 / 巨壳拆分 / 管线

| 文件 | 一句话 | 状态 |
|---|---|---|
| [2026-06-08-performance-foundation.md](2026-06-08-performance-foundation.md) | 性能地基改造立项 | 📋 |
| [2026-05-25-phase-e2-completion-and-tech-uplift.md](2026-05-25-phase-e2-completion-and-tech-uplift.md) | Phase E.2 完成 + 技术栈升级(v0.6) | 🚧 |
| [2026-05-31-unify-request-pipeline.md](2026-05-31-unify-request-pipeline.md) | 统一请求构建管线（根治测试过/生产挂） | 📋 |
| [2026-06-04-runtime-split-execution.md](2026-06-04-runtime-split-execution.md) | 增量拆分 electron/runtime.ts（strangler） | 🚧 |
| [2026-06-03-styles-css-teardown.md](2026-06-03-styles-css-teardown.md) | styles.css 拆除（死 CSS 清理） | 🚧 |
| [2026-06-06-main-process-proxy.md](2026-06-06-main-process-proxy.md) | 主进程 fetch 走代理（Phase 1 自动探测） | ✅ |
| [2026-06-08-巨壳拆分-B-Scene3D-A-NodeParameterControls.md](2026-06-08-巨壳拆分-B-Scene3D-A-NodeParameterControls.md) | 巨壳拆分：Scene3DFullscreen → NodeParameterControls | 🚧 |
| [2026-06-08-巨壳拆分-任务派发.md](2026-06-08-巨壳拆分-任务派发.md) | 巨壳拆分多窗口任务派发 | 📎 |
| [nomi-select-unify.md](nomi-select-unify.md) | 统一选择面板 NomiSelect 通用组件 | 🚧 |

## 落地页 / 营销

| 文件 | 一句话 | 状态 |
|---|---|---|
| [marketing-gsap-seo.md](marketing-gsap-seo.md) | 落地页 GSAP 轻量动画 + SEO 修补 | 🚧 |

## 版本执行 / 交接（跨主题）

| 文件 | 一句话 | 状态 |
|---|---|---|
| [v0.7.1-execution.md](v0.7.1-execution.md) | v0.7.1 卡片可用性修复+媒体轨道抽象+性能 | 📎 |
| [v0.8-execution-token-opt-and-phase-b.md](v0.8-execution-token-opt-and-phase-b.md) | v0.8 Token 优化 + Phase B 接入 | 📎 |
| [v0.8-handoff-2026-05-30.md](v0.8-handoff-2026-05-30.md) | v0.8 用户旅程交接 | 📎 |
| [2026-06-07-backlog-handoff.md](2026-06-07-backlog-handoff.md) | 剩余 backlog 冷启动交接 | 📎 |
