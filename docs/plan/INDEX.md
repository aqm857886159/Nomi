# docs/plan 索引地图

> 方案/执行文档按**主题**分组的查找表。文件本身保持平铺（彼此有大量路径互链，移动会断链），本表负责「按主题/状态秒定位」。
> 本索引仍有历史存量缺口；查不到时必须继续全量搜索。`check:docs-index` 保证缺口只减不增。
> 跨阶段总纲另见 [`docs/superpowers/plans/`](../superpowers/plans/)；当前主文档是 [Nomi 统一 Agent 总体方案](../superpowers/plans/2026-08-24-unified-agent-master-plan.md)。
> 新增 plan 时**顺手在本表对应主题下加一行**。
> 状态图例：✅ 已交付 ｜ 🚧 进行中 ｜ ⏳ 已拍板·未开工 ｜ 🧊 暂缓/远期 ｜ 📋 方案待拍板 ｜ ⛔ 已废弃 ｜ 📎 交接/日志
> 📋/⏳/🚧 会进交付账本现役区并被每日提醒（`pnpm run ledger:brief`；账本是本地视图，不进 git）；🧊 列出但不催；无标记 = 未登记存量，不打扰。

## 总收敛与交付主轴

| 文件 | 一句话 | 状态 |
|---|---|---|
| [2026-09-04-nomi-convergence-execution-plan.md](2026-09-04-nomi-convergence-execution-plan.md) | **Nomi 收敛总执行方案**：以 M0–M5 为主轴，统一 Agent/MCP/分镜表/画布/视频/TikHub/真实 Provider/持久化/重启/视觉和 PR 收敛门槛；current baseline `origin/main@8ff53610`，#471 UI 合同与 #474 Skill 修复已合入但主轴未毕业 | 🚧 |
| [2026-09-05-m0-m5-vertical-spine-status.md](2026-09-05-m0-m5-vertical-spine-status.md) | **M0–M5 真实垂直脊梁状态台账**：同一自然用户任务的红测、真实 Electron、Codex Host/MCP、持久化/重启、视觉、packaged 与合入证据边界 | 🚧 |
| [2026-09-05-m0-live-certification-audit.md](2026-09-05-m0-live-certification-audit.md) | M0 MCP live certification 审计：中转站文档/API key 接入边界与真实调用证据 | 🚧 |
| [2026-09-05-real-video-export-restart.md](2026-09-05-real-video-export-restart.md) | 真实视频生成→剪辑→预览→导出→关闭重启恢复旅程与证据门 | 🚧 |
| [2026-09-05-storyboard-two-state-generation-design.md](2026-09-05-storyboard-two-state-generation-design.md) | **分镜 v6 双状态生成设计**：编辑态能力槽、生成态结果卡、模型参考矩阵、自动引用、迁移与真实验收 | 📋 |
| [2026-09-05-storyboard-table-v6-design-contract.md](../design/2026-09-05-storyboard-table-v6-design-contract.md) | **分镜表 v6 设计合同**（方向 A，用户已拍板）：信息架构、行/锚状态表、参考列规则+六档案槽矩阵、旧版 15 条功能对账、token/选择器契约草案、不做项与验收清单；样张 `docs/design/mockups/2026-09-05-storyboard-table-v6/` | 📋 |
| [2026-09-04-main-convergence-follow-ups.md](2026-09-04-main-convergence-follow-ups.md) | Main 收敛后续明细；历史执行拆解，状态以总方案和 current-main 审计为准 | 📎 |
| [2026-09-05-agent-host-gate-removal.md](2026-09-05-agent-host-gate-removal.md) | **常驻 Agent 拆发布闸**：删掉默认关的 `agentHostPreference` 与设置页开关，Agent 对所有用户无条件常驻，未完成处改用 header Beta 徽标明说；根因是「用户用的产品」与「测试跑的产品」分叉的并行版 | 🚧 |
| [2026-09-05-agent-ui-a-composer.md](2026-09-05-agent-ui-a-composer.md) | Agent UI A 段：composer 五按钮调序、模式弹层收敛、运行呼吸光与分镜入口 | 🚧 |
| [2026-09-05-editing-panel-t1.md](2026-09-05-editing-panel-t1.md) | T1 面板系统、属性面板、transport 与 layout capability | 🚧 |
| [2026-09-05-resident-composer-receipt-fix.md](2026-09-05-resident-composer-receipt-fix.md) | 常驻 Agent 收据旅程修复：删掉旅程对模式弹层审批入口的依赖，改用真实审批卡/拒绝/收据断言 | ✅ |
| [2026-09-05-proposal-transition-table.md](2026-09-05-proposal-transition-table.md) | **Agent Host proposal 转换表**：(来源域×目标域×状态×动作) 做成显式数据表，reducer 只查表，拒绝带格子坐标；`document→canvas` 是显式关闭格 | ✅ |
| [2026-09-04-workbench-skill-picker-fix.md](2026-09-04-workbench-skill-picker-fix.md) | Workbench Agent Skill 选择器共享可选性边界修复：恢复 storyboard planner 的真实菜单选择与 Host 请求链路 | ✅ |
| [2026-09-03-open-work-ledger.md](2026-09-03-open-work-ledger.md) | 全量开工账本历史快照；只用于追溯，不覆盖总方案的当前状态 | 📎 |
| [../architecture-review/2026-09-05-agent-mcp-architecture-review.md](../architecture-review/2026-09-05-agent-mcp-architecture-review.md) | **Agent 与 MCP 架构评审**：五个质疑（两张嘴 / 审批过度通用 / MCP 按内部机制命名 / 每轮失忆 / 接模型主路径顺序）逐条 file:line 证实或推翻，含 6 角色评审与 R3 决策对比表；docs-only 待拍板 | 📋 |

## 模型接入 / Onboarding（最大簇）

| 文件 | 一句话 | 状态 |
|---|---|---|
| [2026-06-07-model-onboarding-final-plan.md](2026-06-07-model-onboarding-final-plan.md) | **模型接入最终方案**（R7 定稿，审计+设计+计划）— 本簇主文档 | ✅ |
| [2026-08-30-runway-seedance25-onboarding.md](2026-08-30-runway-seedance25-onboarding.md) | Runway Seedance 2.5 接入与分镜设置（源分支只含文档、未合并；配套指南带「未发布」横幅）| 📋 |
| [2026-08-15-model-integration-no-dead-end-master-plan.md](2026-08-15-model-integration-no-dead-end-master-plan.md) | 模型接入「不留死路」总纲：事实源 manifest + 能力契约 + 旅程矩阵 | 🚧 |
| [2026-09-03-self-hosted-relay-conformance-harness.md](2026-09-03-self-hosted-relay-conformance-harness.md) | **自建中转一致性台架**：CI 里起一个**严格的**假中转，驱动真实接入→认证→生成全链路。严格度锚定 2026-09-03 真机实测（用错端点/无图/图太小/multipart 无字节 四条拒绝规则），把「用户接入」这条唯一没有反馈回路的路径接上回路 | 📋 |
| [2026-09-06-vendor-preference-auto-fallback.md](2026-09-06-vendor-preference-auto-fallback.md) | S-01/S-02 供应商偏好与自动切换：能力槽下的模型身份候选链、有限回退、费用与收据闸门 | 📋 |
| [2026-09-02-docaudit-kie-apimart.md](2026-09-02-docaudit-kie-apimart.md) | KIE + APIMart 官方文档全量对账、映射合同覆盖与未封印模型验收 | ✅ |
| [2026-09-02-runway-model-identity-workflow.md](2026-09-02-runway-model-identity-workflow.md) | **一个模型一个档案主人**（PR #310 挂起的「单独立项裁决」）：删平台档案 runway-video，10 个 Runway 模型改挂真模型档案；补齐供应商特化三轴（参数/transport/模式可见性）；selectTaskMapping 停止借用别的模式的线缆 | ✅ |
| [2026-09-03-veo31-panel-crash.md](2026-09-03-veo31-panel-crash.md) | Runway Veo 3.1 节点生成面板 React #185 无限渲染循环：自动元数据写回边界与零额度 Electron 回归走查 | ✅ |
| [2026-09-03-mcp-integration-q8-seams.md](2026-09-03-mcp-integration-q8-seams.md) | Q8：MCP 接入面按「确定性归我们，情境性归模型」收敛为 5 个 T14 action，并补接入管理后端动词 | 🚧 |
| [2026-09-03-mcp-elicitation-e2e-reachability.md](2026-09-03-mcp-elicitation-e2e-reachability.md) | MCP elicitation-first e2e 接入 package script、Quality Gate 与 desktop RC，防止关键 started 断言成为无人执行的文档 | ✅ |
| [2026-09-03-mcp-remaining-holes.md](2026-09-03-mcp-remaining-holes.md) | #202 余账与群反馈非 UI 修洞班 | 🚧 |
| [2026-08-15-model-access-exhaustive-user-journeys.md](2026-08-15-model-access-exhaustive-user-journeys.md) | 模型接入全集用户旅途测试：能力面逐维度真实 UI 往返旅程矩阵 | 🚧 |
| [2026-08-28-conversational-model-integration-verification.md](2026-08-28-conversational-model-integration-verification.md) | 对话式模型接入与认证闭环：J0–J5 真实验收和发布记录 | 🚧 |
| [2026-08-30-unified-model-integration-certification.md](2026-08-30-unified-model-integration-certification.md) | 旗舰供应商、模型扩充与统一认证流程（官方合同→零费用仿真→认证账本） | 🚧 |
| [2026-08-31-provider-model-expansion-certification.md](../superpowers/plans/2026-08-31-provider-model-expansion-certification.md) | Superpowers 执行计划：旗舰模型合同、Runway/KIE/fal、生产 canary 与 PR 交付 | 🚧 |
| [2026-08-30-provider-model-expansion-and-runtime.md](2026-08-30-provider-model-expansion-and-runtime.md) | 旗舰供应商与统一运行时扩充的早期范围（已被统一认证计划取代） | ⛔ |
| [2026-08-30-issue-237-onboarding.md](2026-08-30-issue-237-onboarding.md) | Issue #237：OpenAI-compatible 图片请求根因修复、匿名上传分诊与英文接入入口 | 🚧 |
| [2026-08-31-asset-upload-routing.md](2026-08-31-asset-upload-routing.md) | 本地图片/视频/音频统一上传路由、供应商上传 API 与可选 R2 relay | 🚧 |
| [2026-09-01-provider-proxy-and-onboarding-hardening.md](2026-09-01-provider-proxy-and-onboarding-hardening.md) | #258 拆项①③：per-connection provider proxy（全局默认+单点覆盖，私网 bypass+凭据脱敏）+ onboarding 加固（抽 useOnboardingConnectionTest、CodexLocalImageCard 静默失败修复） | 🚧 |
| [2026-09-02-docaudit-b.md](2026-09-02-docaudit-b.md) | DOCAUDIT-B：fal/Runway/MiniMax/ElevenLabs 等非 KIE/APIMart 官方合同、零成本模式干跑与付费封印 | 🚧 |
| [2026-09-01-credential-config-at-rest-encryption.md](2026-09-01-credential-config-at-rest-encryption.md) | 可携带凭据的连接配置（proxyUrl 的 user:pass、extraHeaders 的 Authorization）升到与 API key 同级的 safeStorage 加密落盘层 + 字段分级守卫（P2 类级修） | 🚧 |
| [2026-08-31-agent-material-channels-and-local-endpoints.md](2026-08-31-agent-material-channels-and-local-endpoints.md) | A+B 计划：素材获取三通道分工 + 本地文本模型通用端点（P0 本地模型卡已随 #281 落地；#223 前提已被 M 线取代，见文首现状标注） | 📋 |
| [2026-09-01-pr258-derived-directions-eval.md](2026-09-01-pr258-derived-directions-eval.md) | #258 拆项评估定稿：①provider proxy 🟢（已随 #282 落地）②即梦 CLI 模型面 🟡（后被 v1.4.17 对齐 #291 取代其结论）③onboarding 加固 🟢（已随 #282 落地） | 📎 |
| [2026-09-01-pr271-feedback-share-center-eval.md](2026-09-01-pr271-feedback-share-center-eval.md) | #271 反馈分享中心拆项评估：三方向全 🟢、外发面克制可辩护；按四步收口后已合入（provider 泄露路径证实并修复） | 📎 |
| [2026-09-01-video-deconstruction-v1.md](2026-09-01-video-deconstruction-v1.md) | 拆解视频 v1 面板方案：一条参考视频→结构化分镜表→勾选镜头逐个落画布+自动编组→用这套结构起稿；含与 Agent 面板的右槽共存契约（③合流终局+过渡期互斥 R-C-1~7） | 🚧 |
| [2026-09-02-canvas-media-derived-persistence-performance.md](2026-09-02-canvas-media-derived-persistence-performance.md) | 画布媒体派生尺寸回填性能回归修复：隔离运行时测量，避免视口揭示触发项目持久化 | ✅ |
| [2026-09-01-tikhub-connector-v1.md](2026-09-01-tikhub-connector-v1.md) | TikHub 数据 connector v1：分享链接→无水印直链→喂现有拆解引擎（native-api / BYO-key / effect=spend / AssetSourceEvidence） | 🚧 |
| [2026-06-07-apimart-curated-onboarding.md](2026-06-07-apimart-curated-onboarding.md) | 策展两家(kie+apimart)一键接入；战略从「通用接入」转向 | ✅ |
| [2026-06-06-universal-model-onboarding.md](2026-06-06-universal-model-onboarding.md) | 「描述符+通用解释器接长尾」研究稿 | ⛔ |
| [2026-05-30-onboarding-schema-first-extraction.md](2026-05-30-onboarding-schema-first-extraction.md) | 参数抽取从 curl-only 升级为 schema-first | ⛔ |
| [2026-06-06-wire-protocol-onboarding-fix.md](2026-06-06-wire-protocol-onboarding-fix.md) | 接入格式全链路统一，根治「第3协议被 IPC 吞掉」 | 📋 |
| [2026-06-07-onboarding-panel-redesign.md](2026-06-07-onboarding-panel-redesign.md) | 接入面板重设计（折叠摘要卡） | 🚧 |
| [2026-06-07-p0-kie-video-execution.md](2026-06-07-p0-kie-video-execution.md) | P0：kie 主路做到极致（含视频） | ⛔ |
| [2026-06-07-p1-async-task-foundation.md](2026-06-07-p1-async-task-foundation.md) | P1：异步任务底座（存盘+后台轮询+重启续跑） | ⛔ |
| [2026-06-08-vendor-switch-archetype-migration.md](2026-06-08-vendor-switch-archetype-migration.md) | 断开供应商后老节点自动迁移到同款模型 | 📋 |
| [onboarding-baseurl-entry.md](onboarding-baseurl-entry.md) | 手填供应商为主、读文档为辅 | 🚧 |
| [onboarding-form-restructure.md](onboarding-form-restructure.md) | 加模型弹窗减负 + 适配式入口重组 | ⛔ |
| [onboarding-form-design-polish.md](onboarding-form-design-polish.md) | 加模型表单设计打磨（对照设计系统） | ⛔ |
| [onboarding-form-simplify.md](onboarding-form-simplify.md) | 表单优化（降噪+自动拉模型+预设） | ⛔ |
| [v0.8-model-onboarding-redesign.md](v0.8-model-onboarding-redesign.md) | v0.8 接入重做（Lab-First + Agent + 强约束） | 📎 |
| [v0.8-onboarding-design-principles.md](v0.8-onboarding-design-principles.md) | v0.8 Onboarding Agent 设计原则 | 📎 |

## 模型档案 / Archetype

| 文件 | 一句话 | 状态 |
|---|---|---|
| [2026-06-05-model-archetype-seedance-happyhorse.md](2026-06-05-model-archetype-seedance-happyhorse.md) | 模型档案层+模式原语，接入 Seedance/HappyHorse | ⛔ |
| [2026-06-06-image-archetypes.md](2026-06-06-image-archetypes.md) | 把图像模型接入「模型档案」体系 | ⛔ |

## 生成画布 / 节点系统

| 文件 | 一句话 | 状态 |
|---|---|---|
| [2026-09-03-narrowed-mode-guidance-dismiss.md](2026-09-03-narrowed-mode-guidance-dismiss.md) | 收窄模式指路提示的节点级关闭与项目持久化 | 🚧 |
| [2026-08-13-video-deconstruction-storyboard-table.md](2026-08-13-video-deconstruction-storyboard-table.md) | **视频拆解→分镜表→复刻生成**（表格=节点组的视图，非新数据模型；含 gemini/whisper 实测契约） | 📋 |
| [2026-08-09-canvas-ux-feedback-round.md](2026-08-09-canvas-ux-feedback-round.md) | 画布体验反馈第 1 轮迭代（Windows 顶栏/视频工具栏并排等，样张阶段） | |
| [2026-08-26-hyperframes-canvas-motion-node.md](2026-08-26-hyperframes-canvas-motion-node.md) | HyperFrames 画布节点集成研究（动效/字幕节点抽象，研究稿） | |
| [2026-06-06-composable-node-execution-plan.md](2026-06-06-composable-node-execution-plan.md) | **生成节点→「档案声明+通用原语组装」执行计划**（C0–C4 已落地） | ✅ |
| [2026-06-06-composable-node-roadmap.md](2026-06-06-composable-node-roadmap.md) | 同上的路线图+现状盘点(带 file:line) | ✅ |
| [2026-06-06-HANDOFF.md](2026-06-06-HANDOFF.md) | 生成节点「通用化」项目交接 | 📎 |
| [2026-06-06-P0-P1-execution-log.md](2026-06-06-P0-P1-execution-log.md) | 通用素材系统 P0+P1 执行日志 | 📎 |
| [2026-06-06-reference-at-and-sources.md](2026-06-06-reference-at-and-sources.md) | 通用「素材引用」系统（非 Seedance 专用） | ⛔ |
| [2026-08-27-react-flow-canvas-complete-migration.md](2026-08-27-react-flow-canvas-complete-migration.md) | **生成画布迁至 React Flow 单内核**（R21）：删旧 renderer、无并行版/无 fallback；配套不变量测试 | ✅ |
| [2026-08-27-canvas-card-stack.md](2026-08-27-canvas-card-stack.md) | **画布结果卡组与编组交互**：多版本堆叠、复制变体、收起/展开编组与关系线 | ✅ |
| [2026-08-28-pr216-real-canvas-merge-gate.md](2026-08-28-pr216-real-canvas-merge-gate.md) | **PR 216 合入闸**：生产入口几何修复 + 真实 Electron 画布分层验收 + CI 证据 | 🚧 |
| [2026-08-08-canvas-drag-pan-and-quiet-render.md](2026-08-08-canvas-drag-pan-and-quiet-render.md) | **画布手势现行契约**：拖=平移 / Shift=框选 / 滚轮锚光标；平移零重绘、边标签按选中显示、拖节点收浮层（推翻 08-07 selection-first）| ✅ |
| [2026-08-09-prompt-paste-node-duplication.md](2026-08-09-prompt-paste-node-duplication.md) | 外部提示词粘贴进编辑器时不再误触画布节点粘贴兜底 | ✅ |
| [2026-08-31-canvas-paste-routing-root-cause.md](2026-08-31-canvas-paste-routing-root-cause.md) | 画布复制节点后粘贴优先恢复内部节点；仅系统剪贴板明确带外部媒体时才走网页媒体下载（根因修复） | ✅ |
| [2026-09-01-canvas-drag-perf-eval-v2.md](2026-09-01-canvas-drag-perf-eval-v2.md) | **画布拖动性能 eval v2 + 修复路线**（B 案已拍板）：三腿基线 prod/dev/throttle、画布外重渲染探针、拖/平移比值指纹；S3 订阅细粒度化 → S4 拖动几何下放 RF 内核 | 🚧 |
| [2026-09-03-model-change-undo.md](2026-09-03-model-change-undo.md) | 模型切换后 Cmd/Ctrl+Z 的编辑器焦点归属与画布撤销根因修复 | ✅ |
| [2026-09-02-canvas-projection-sync-regression.md](2026-09-02-canvas-projection-sync-regression.md) | S4 回归修复：保留非受控 React Flow 内核并补齐 mount 后业务节点投影的单向同步 | 🚧 |
| [2026-08-09-windows-drag-floating-surfaces.md](2026-08-09-windows-drag-floating-surfaces.md) | Windows 顶部浮层避开自绘窗口栏与功能顶栏拖拽区 | ✅ |
| [2026-08-09-batch-dock-terminal-dismiss.md](2026-08-09-batch-dock-terminal-dismiss.md) | 批量生成全部完成后隐藏“生成全部 0 个”底栏 | ✅ |
| [2026-08-13-batch-dock-timeline-occlusion.md](2026-08-13-batch-dock-timeline-occlusion.md) | 批量生成底栏避让时间轴把手并支持按当前批次隐藏 | ✅ |
| [2026-08-09-canvas-performance-benchmark.md](2026-08-09-canvas-performance-benchmark.md) | **画布性能基准**：大量图片/视频 + 高频微操作，统一采样交互、渲染、媒体和内存指标 | ✅ |
| [2026-08-07-generation-canvas-gesture-semantics.md](2026-08-07-generation-canvas-gesture-semantics.md) | selection-first 手势 + 操作帮助面板（手势那半已被 08-08 推翻，帮助面板/纯模型仲裁保留）| ⛔ |
| [2026-06-06-drop-and-wire-execution.md](2026-06-06-drop-and-wire-execution.md) | 拖入/连线→参考（drop-and-wire） | 🧊 |
| [2026-07-04-scene3d-reference-pack.md](2026-07-04-scene3d-reference-pack.md) | Scene3D 导演参考包：白膜置景/运镜首尾帧/录 take → 目标视频参考槽 | ⛔ |
| [2026-05-31-asset-node-and-canvas-perf.md](2026-05-31-asset-node-and-canvas-perf.md) | 素材节点(≠生成节点) + A1.5 组件抽取 | ✅ |
| [2026-05-31-canvas-image-resize-crop.md](2026-05-31-canvas-image-resize-crop.md) | 画布图片等比缩放+裁剪（Figma 式） | 📋 |
| [2026-05-31-three-canvas-bugs.md](2026-05-31-three-canvas-bugs.md) | 修三个生成画布 bug | ⛔ |
| [c5-text-node.md](c5-text-node.md) | C5 文本节点→文档编辑器 | ⛔ |
| [v0.8-card-cleanup-execution.md](v0.8-card-cleanup-execution.md) | v0.8 节点卡片瘦身 | 📎 |
| [file-preview.md](file-preview.md) | 本地文件预览（画布旁点开就看） | 🚧 |

## Agent / Harness / 助手

| 文件 | 一句话 | 状态 |
|---|---|---|
| [2026-09-04-mcp-semantic-operation-matrix.md](2026-09-04-mcp-semantic-operation-matrix.md) | MCP 语义操作矩阵：document/canvas 真实生产链路 H/B/E/T/N、scoped V8 收据与 timeline/media/export blocked evidence | ✅ |
| [agent-compaction-runtime-projection.md](agent-compaction-runtime-projection.md) | Agent compaction runtime 元数据的 Host 状态、持久化、恢复与 renderer 投影契约 | 🚧 |
| [2026-09-04-agent-usage-ledger-rebaseline-followup.md](2026-09-04-agent-usage-ledger-rebaseline-followup.md) | #452 rebaseline follow-up：Host usage persistence/projection 与生成 approval receipt 的 projectRevision C9 防漂移 | ✅ |
| [2026-09-02-mcp-testnet-l1-handshake.md](2026-09-02-mcp-testnet-l1-handshake.md) | MCP 测试网第 1 片：真实 stdio L1 握手六条回归、tools/list payload 棘轮与 listChanged A1 | 🚧 |
| [2026-09-05-mcp-tool-refs-blindspot.md](2026-09-05-mcp-tool-refs-blindspot.md) | `check:mcp-tool-refs` 扩展调用形态与 docs 可执行示例扫描，清理无 runner 的退役生成走查 | ✅ |
| [2026-09-02-mcp-l2-journeys.md](2026-09-02-mcp-l2-journeys.md) | MCP 测试网第 2 片：C7-C12 真实语义生成、断连回收、产物审片与导出对账 | ✅ |
| [2026-08-25-p4-anchor-checkpoint-approval-card.md](2026-08-25-p4-anchor-checkpoint-approval-card.md) | P4 锚定妆照检查点的渲染层审批卡（#155 §8.5 两条腿之二；样张已拍板、方案未入库）| 📋 |
| [2026-09-01-agent-m0-baseline-freeze.md](2026-09-01-agent-m0-baseline-freeze.md) | M0 基线冻结：owner map、50 项工具映射、旧路径、schema-v3 草案、红灯与 PR 切片 | ⏳ |
| [2026-09-03-m1-contract-coverage-gap-remediation.md](2026-09-03-m1-contract-coverage-gap-remediation.md) | M1 转发壳删除后暴露的 rc-01/02/05/06 覆盖缺口：逐条核实的真实覆盖表、4 条缺失不变量（含 rc-05 脱敏安全项、rc-06 `execution_settled` 代码中不存在）与返还顺序 | ⏳ |
| [2026-09-02-m2-generation-semantic-slice-1.md](2026-09-02-m2-generation-semantic-slice-1.md) | M2 第一片：generation plan/status 语义模型面与 Host-only 闸门排除 | 🚧 |
| [2026-09-03-agent-ui-p0-exception-states-impl.md](2026-09-03-agent-ui-p0-exception-states-impl.md) | Agent 界面 P0 异常态：折叠、错误、加载和空状态在 v3.1 常驻壳内的实现与验收 | ✅ |
| [2026-09-04-agent-ui-computable-conformance.md](2026-09-04-agent-ui-computable-conformance.md) | #315/#438 Agent UI 设计到运行时的可计算合同：source metadata、真实 Electron DOM/computed-style 测量、mismatch report 与三项偏差修复 | 🚧 |
| [2026-09-02-m2-editing-semantic-slices.md](2026-09-02-m2-editing-semantic-slices.md) | M2 第二片：timeline/media/export 语义面、MCP 可达性与 Host 审批 | 🚧 |
| [2026-09-02-m2-canvas-vertical-slice-3.md](2026-09-02-m2-canvas-vertical-slice-3.md) | M2 第三片：canvas + document 语义 MCP 面、租约边界与 ProductionRun 退役收口 | 🚧 |
| [2026-09-01-m1-round2-host-runtime.md](2026-09-01-m1-round2-host-runtime.md) | M1 round-2：Host/runtime 切片移植计划（Project Agent 执行协调器 + 常驻壳 transport） | ⏳ |
| [2026-09-01-m1-final-assembly-closure.md](2026-09-01-m1-final-assembly-closure.md) | M1 终装收口：ProductionRun legacy 保留、RL2 投影修复、Pi 岛边界、lint 与全量 gates | ✅ |
| [2026-08-29-agpl-only-no-cla.md](2026-08-29-agpl-only-no-cla.md) | **只发布 AGPL-3.0-only，不要求 CLA**：统一贡献、分发和 AGPL 合规服务边界 | ✅ |
| [2026-08-29-cla-signature-ledger.md](2026-08-29-cla-signature-ledger.md) | CLA 签名账本与受保护主分支解耦（历史方案，已废弃） | ⛔ |
| [2026-08-29-creation-selection-persistence.md](2026-08-29-creation-selection-persistence.md) | 创作区失焦后保留待替换文本的视觉选区 | ✅ |
| [2026-08-29-creative-capability-catalog-and-prompt-system.md](2026-08-29-creative-capability-catalog-and-prompt-system.md) | 浏览器、素材、Prompt、Skill 与 Pi 生态的统一创作能力目录方案 | 📎 |
| [2026-08-29-capability-system-mockup-and-baseline.md](2026-08-29-capability-system-mockup-and-baseline.md) | 能力目录、Agent 预检、素材权利交互样张与 J1-J10 基线 | 📎 |
| [2026-08-28-reference-media-mentions.md](2026-08-28-reference-media-mentions.md) | 图片/视频/音频 @ 引用统一：候选、真实参考槽、编辑器与发送投影 | ✅ |
| [2026-08-27-root-cause-remediation-and-media-boundary-fixes.md](2026-08-27-root-cause-remediation-and-media-boundary-fixes.md) | Comfy/custom-call 媒体契约根因修复 + 可执行根因合同门禁 | ✅ |
| [2026-08-27-single-source-semantics-gate.md](2026-08-27-single-source-semantics-gate.md) | ProjectAgent 统一前置：AST 语义词表门岗 + R14.1 单一 owner 审计 | ✅ |
| [2026-06-09-agent-harness-architecture.md](2026-06-09-agent-harness-architecture.md) | **Agent Harness 架构定义与演进** — 本簇主文档 | 📋 |
| [2026-06-21-self-improving-harness-loop.md](2026-06-21-self-improving-harness-loop.md) | **自我改进 harness 闭环**：AI 扮用户跑测试→量化诊断→修→重跑；架构铁律=查agent≠修agent(治自偏)；指标分三层(客观脊梁/半客观校准/主观人锚)；扩现有评测体系；不训模型/不碰GPU | 📋 |
| [2026-06-10-nomi-harness-requirements.md](2026-06-10-nomi-harness-requirements.md) | Harness 需求真相源 | 📋 |
| [2026-06-10-nomi-harness-framework-research.md](2026-06-10-nomi-harness-framework-research.md) | Harness 框架选型调研（三路并行 agent） | 📋 |
| [2026-06-10-nomi-harness-teardown-reference-pool.md](2026-06-10-nomi-harness-teardown-reference-pool.md) | Harness 拆解+参考池定稿 | 📋 |
| [2026-06-07-agent-harness-hardening-plan.md](2026-06-07-agent-harness-hardening-plan.md) | Agent Harness 硬化（Tier 1+2） | 🚧 |
| [agent-foundation.md](agent-foundation.md) | Agent 底座能力规格（Foundation Spec） | 📋 |
| [2026-06-01-agent-system-review.md](2026-06-01-agent-system-review.md) | Agent 系统梳理 + 4 个问题处理 | 📎 |
| [2026-06-06-unified-agent-merge.md](2026-06-06-unified-agent-merge.md) | 合并创作 agent 与画布 agent（草案） | 📋 |
| [agent-merge-architecture.md](agent-merge-architecture.md) | 两个 Agent 合并：修幻影工具+架构对齐（历史架构，已由 pi SDK 运行时取代） | ⛔ |
| [2026-06-07-assistant-consolidation-plan.md](2026-06-07-assistant-consolidation-plan.md) | 助手面板收敛（双面板→单上下文助手） | ⛔ |
| [2026-06-07-assistant-mockup-implementation.md](2026-06-07-assistant-mockup-implementation.md) | 助手面板对齐样张（R8 实现规范） | ⛔ |
| [2026-06-09-创作AI附件与对话体验.md](2026-06-09-创作AI附件与对话体验.md) | 创作 AI 助手：多格式附件+对话升级 | 📋 |
| [2026-08-27-skills-knowledge-distribution.md](2026-08-27-skills-knowledge-distribution.md) | **Skills 知识分发**：导入对齐 Agent Skills 标准（Phase 0 已交付）+ 渐进披露从「只给外部」接给内嵌 agent；实测每轮固定开销 ≈9,000 tokens 且不参与预算 | 🚧 |
| [2026-08-27-unified-tool-surface.md](2026-08-27-unified-tool-surface.md) | **内外工具面统一**：对外 22 个 `nomi_*` vs 内嵌 17 个，6 处同事两名、确认面两套——违反 master plan「不造第二套」北极星；三方案待拍板 | 📋 |
| [2026-08-30-agent-canvas-interaction-expansion.md](2026-08-30-agent-canvas-interaction-expansion.md) | #194 补全画布引用、多媒体、双轴模式与结果回画布（方案与样张完成，待生产实现） | ✅ |
| [2026-09-06-opt-in-frequency-telemetry.md](2026-09-06-opt-in-frequency-telemetry.md) | T-01/T-02 opt-in 频率遥测：默认关闭、事件白名单、本地可见可删，与 autoUpdater 解耦 | 📋 |
| [2026-09-06-mcp-key-window-front-and-host-config-toast.md](2026-09-06-mcp-key-window-front-and-host-config-toast.md) | MCP 凭据请求自动前台打开模型接入页，宿主配置修复后提示重启 | ✅ |

## 时间轴 / 预览 / 导出

| 文件 | 一句话 | 状态 |
|---|---|---|
| [2026-05-24-production-video-export-execution-plan.md](2026-05-24-production-video-export-execution-plan.md) | 成片视频导出实施计划 | ⛔ |
| [2026-06-03-timeline-interaction-rework.md](2026-06-03-timeline-interaction-rework.md) | 时间轴交互层重做 | 📋 |
| [2026-06-04-timeline-wysiwyg-and-export.md](2026-06-04-timeline-wysiwyg-and-export.md) | P2 预览=成片(WYSIWYG) + P3 导出能力 | 📋 |
| [2026-06-21-blender-3d-render-lane.md](2026-06-21-blender-3d-render-lane.md) | **Blender 3D 渲染 lane**：AI 生资产→headless Blender 渲简单镜头→进时间轴，补「跨镜一致+真相机控制」；范围狠砍(不碰绑骨/动画/GUI/捆绑) | 📋 |
| [2026-08-28-editing-engine-review.md](2026-08-28-editing-engine-review.md) | Editing engine build-vs-buy review and open-source research | 🚧 |
| [2026-08-28-editing-engine-uplift.md](2026-08-28-editing-engine-uplift.md) | P0 timeline kernel and Agent editing control plane | 🚧 |
| [2026-08-28-timeline-visual-feedback.md](2026-08-28-timeline-visual-feedback.md) | Timeline source-window and transition support feedback | 🚧 |
| [2026-09-05-timeline-placement-strategy.md](2026-09-05-timeline-placement-strategy.md) | 时间轴 P0 落位、默认 fit、轨道滚动与字幕不重叠 | 🚧 |

## 项目库 / 素材库 / Workspace / 左面板

| 文件 | 一句话 | 状态 |
|---|---|---|
| [2026-09-03-creative-resource-chain-epic.md](2026-09-03-creative-resource-chain-epic.md) | **创作资源链 Epic 切片**：来源记录、Agent 浏览器工具、智能库视图、统一扩展合同四个 P0 切片（待拍板） | 📋 |
| [2026-08-31-library-discovery-slice.md](2026-08-31-library-discovery-slice.md) | **非 Agent 资源库发现优化**：四库各自有家，共用搜索/确定性分类与素材真实媒体路径 | 🚧 |
| [2026-09-02-cross-device-sync-execution.md](2026-09-02-cross-device-sync-execution.md) | **跨设备继续创作执行方案**：设置归位、外部同步客户端边界、项目打开前就绪检查与真实任务验收 | 🚧 |
| [2026-09-04-cross-device-min-energy-redesign.md](2026-09-04-cross-device-min-energy-redesign.md) | **跨设备继续编辑最低能量轨迹**：设置归位、三步同步说明与双机真实验收边界 | 🚧 |
| [2026-05-31-workspace-folder-projects-implementation-plan.md](2026-05-31-workspace-folder-projects-implementation-plan.md) | 任意文件夹 Workspace 项目实施 | ⛔ |
| [2026-05-31-merge-workspace-feature.md](2026-05-31-merge-workspace-feature.md) | 把 workspace 文件管理合并进 main | ⛔ |
| [2026-05-31-left-panel-material-redesign.md](2026-05-31-left-panel-material-redesign.md) | 左面板重做：分类/素材双 Tab | 📋 |
| [2026-05-31-library-search-cost-fixes.md](2026-05-31-library-search-cost-fixes.md) | 30秒体验/假搜索/花费徽章 三处修复 | ⛔ |
| [2026-08-30-library-discovery-optimization.md](2026-08-30-library-discovery-optimization.md) | 跨项目工作流与素材库发现体验：搜索、分类、居中详情与原样复制边界 | 📋 |
| [2026-06-08-custom-categories-and-chat-polish.md](2026-06-08-custom-categories-and-chat-polish.md) | 自定义分类+聊天气泡统一+右键菜单瘦身 | 🧊 |

## 应用壳 / 反馈与社区

| 文件 | 一句话 | 状态 |
|---|---|---|
| [2026-09-01-feedback-share-center.md](2026-09-01-feedback-share-center.md) | v0.21 低摩擦反馈与分享中心：私密 Tally 表单、公开 GitHub、自动带入安全运行时上下文 | 🚧 |
| [2026-09-01-storyboard-table-genre-profile.md](2026-09-01-storyboard-table-genre-profile.md) | **分镜表 v5**：场分组+图优先行+结构化提示词（@/骨架段）+行内执行；A 段已合（#330），B-D 分阶段交付；样张 docs/design/mockups/2026-09-01-storyboard-table-image-first.html | 🚧 |
| [storyboard-table-coverage.md](storyboard-table-coverage.md) | 分镜表状态/模型能力/参考素材/比例与批量生成覆盖矩阵及真实验收缺口 | 🚧 |
| [2026-09-02-walkthrough-catalog-seed-version.md](2026-09-02-walkthrough-catalog-seed-version.md) | 隔离走查 catalog 种子按被测 app 版本校验：future seed quarantine + 版本真源单一化，终结「切模型静默失效」假绿 | ✅ |
| [2026-09-03-walkthrough-findings.md](2026-09-03-walkthrough-findings.md) | R13 走查暴露的五项缺陷修复：i18n、历史 ETA、供应商切换 toast 与 ComfyUI/H3 验证 | 🚧 |
| [2026-09-03-m5-packaged-graduation.md](2026-09-03-m5-packaged-graduation.md) | M5 打包真机毕业：零额度 MCP 全链、M0-M4 证据清单与发版前人工 runbook | 🚧 |
| [2026-09-04-real-user-test-contract.md](../qa/2026-09-04-real-user-test-contract.md) | **真实用户测试契约与验收报告模板**：Electron/packaged → H/B/E/T/N → 边界 mock → 持久化/重启 → image2 视觉确认 → changed scope raw V8 | 📋 |
| [2026-09-04-main-convergence-follow-ups.md](2026-09-04-main-convergence-follow-ups.md) | current main 收敛后续：Agent/MCP/storyboard/canvas/同步/live provider/durable handoff/架构三期与 image2 gate | 📋 |

## 性能 / 技术地基 / 巨壳拆分 / 管线

| 文件 | 一句话 | 状态 |
|---|---|---|
| [2026-06-08-performance-foundation.md](2026-06-08-performance-foundation.md) | 性能地基改造立项 | ⛔ |
| [2026-05-25-phase-e2-completion-and-tech-uplift.md](2026-05-25-phase-e2-completion-and-tech-uplift.md) | Phase E.2 完成 + 技术栈升级(v0.6) | ⛔ |
| [2026-05-31-unify-request-pipeline.md](2026-05-31-unify-request-pipeline.md) | 统一请求构建管线（根治测试过/生产挂） | 📋 |
| [2026-06-04-runtime-split-execution.md](2026-06-04-runtime-split-execution.md) | 增量拆分 electron/runtime.ts（strangler） | 🚧 |
| [2026-08-29-focused-validation-policy.md](2026-08-29-focused-validation-policy.md) | PR `fast/full` 两档验证历史基线（已被 08-30 独立风险面取代） | 📎 |
| [2026-08-30-risk-scoped-validation-evidence.md](2026-08-30-risk-scoped-validation-evidence.md) | **按真实风险拆分 unit/desktop/journey/canvas/performance/package，并用 exact-SHA CI 证据替代合并后第三遍全量测试** | ✅ |
| [2026-09-05-ci-gate-mechanics.md](2026-09-05-ci-gate-mechanics.md) | **CI 门岗机制修法**：三个文档/生成物门（docs-index / doc-status / ledger）降为 advisory 并由 main 上的 docs-autosync 自动补齐；`gates:contracts` 51 个 `&&` 改成「全跑完再汇总」 | ✅ |
| [2026-09-06-mcp-locale-and-tool-titles.md](2026-09-06-mcp-locale-and-tool-titles.md) | MCP 结果跟随 Nomi 语言，并为九个语义工具补齐中英文人话标题 | 🚧 |
| [2026-08-29-root-cause-contract-v2.md](2026-08-29-root-cause-contract-v2.md) | 根因合同 v2、跨 AI 强制执行与规则收敛 | 🚧 |
| [2026-08-29-git-delivery-integrity.md](2026-08-29-git-delivery-integrity.md) | Git 交付身份、有界远端刷新与 merged-main 单次验收 | ✅ |
| [2026-06-03-styles-css-teardown.md](2026-06-03-styles-css-teardown.md) | styles.css 拆除（死 CSS 清理） | 🚧 |
| [2026-06-06-main-process-proxy.md](2026-06-06-main-process-proxy.md) | 主进程 fetch 走代理（Phase 1 自动探测） | ✅ |
| [2026-06-08-巨壳拆分-B-Scene3D-A-NodeParameterControls.md](2026-06-08-巨壳拆分-B-Scene3D-A-NodeParameterControls.md) | 巨壳拆分：Scene3DFullscreen → NodeParameterControls | ⛔ |
| [2026-06-08-巨壳拆分-任务派发.md](2026-06-08-巨壳拆分-任务派发.md) | 巨壳拆分多窗口任务派发 | 📎 |
| [nomi-select-unify.md](nomi-select-unify.md) | 统一选择面板 NomiSelect 通用组件 | 🧊 |

## 落地页 / 营销

| 文件 | 一句话 | 状态 |
|---|---|---|
| [marketing-gsap-seo.md](marketing-gsap-seo.md) | 落地页 GSAP 轻量动画 + SEO 修补 | ⛔ |
| [2026-08-14-community-qr-refresh.md](2026-08-14-community-qr-refresh.md) | 用户群二维码刷新（版本化缓存文件名，同步 README 与中英文官网） | |

## 版本执行 / 交接（跨主题）

| 文件 | 一句话 | 状态 |
|---|---|---|
| [v0.7.1-execution.md](v0.7.1-execution.md) | v0.7.1 卡片可用性修复+媒体轨道抽象+性能 | 📎 |
| [v0.8-execution-token-opt-and-phase-b.md](v0.8-execution-token-opt-and-phase-b.md) | v0.8 Token 优化 + Phase B 接入 | 📎 |
| [v0.8-handoff-2026-05-30.md](v0.8-handoff-2026-05-30.md) | v0.8 用户旅程交接 | 📎 |
| [2026-06-07-backlog-handoff.md](2026-06-07-backlog-handoff.md) | 剩余 backlog 冷启动交接 | 📎 |
| [2026-09-02-english-system-prompts.md](2026-09-02-english-system-prompts.md) | 英文版 AI 系统提示词（含 assets 大条·产物也英文·A/B 已过：不回退） | ✅ |
| [2026-09-02-english-system-prompts.md](2026-09-02-english-system-prompts.md) | 英文版 AI 系统提示词（含 assets 大条·产物也英文·须真实生成 A/B） | 🚧 |
| [2026-09-01-tail-batch.md](2026-09-01-tail-batch.md) | 尾巴批三件：i18n electron 存量烧批（≥60 处走 desktopT）+ pre-push 缺 Ponytail 脚本安全退出 + 手动 `check:handoff` 分支收货工具（不进 gates 链） | ✅ |
| [2026-09-03-open-work-ledger.md](2026-09-03-open-work-ledger.md) | 全量开工账本（2026-09-03）：四档盘点（在飞/待排期/僵尸/已完成）+ 架构线三问详答 | ✅ |
- [2026-09-03 画布连线回归调查与修复](2026-09-03-canvas-connect-regression.md)

- [2026-09-05] [第三刀·投影清零方案](2026-09-05-storyboard-projection-cleanup.md) — 分镜唯一 owner、旧字段一次迁移后丢弃、取证 runner 读 Host snapshot。
