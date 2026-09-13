# 生成过程反馈 C-1

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：实施完成，交付验证中（2026-09-08）。分支 feat/process-feedback-phases-20260908，preflight 已验证 be6d4d84816bd6340185ca134346d7f4516abfdd 与 origin/main 同 commit、工作树干净。

## 设计来源

用户已批准 C0/C1/C2。原板目录：`/private/tmp/claude-501/-Users-aoqimin-Desktop-Nomi--claude-worktrees-gpt-discussion-review-06eb91/4b9987a0-fb6f-4af6-ad56-0eaa84ca67ea/scratchpad/sidebar-canvas-extract/`。
- `FeedNow.dc.html`：诚实骨架 + 真帧优先，删除微型大写徽标。
- `Phases.dc.html`：十阶段映射五段；八种状态条填充；动效及 reduced-motion 参数。
- `Consist.dc.html`：三处同句、同色；六条变异验收门。

## 真实现状与根因

- `src/workbench/observability/narrate.ts:8`：十阶段联合类型；`:35` Record 人话表。生成前 5 秒省略时长，retrying/comfyui-node 未统一带时长。
- `src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:434`：text-micro uppercase 徽标，优先 progress.message，缺省走 STATUS_LABEL。
- `src/workbench/taskCenter/TaskCenterPanel.tsx:406`：排队独立选择 waitingWave/waitingSlot，运行态又拼 elapsed。`taskCenterEntries.ts:84` 仅运行态传播 message。
- `src/workbench/timeline/TimelineClip.tsx:36`：只有 clip.label/text/sourceNodeId；未找到生成进度文案。`buildGenerationNodeTimelineClip.ts` 由已有结果构建片段。板上“现役幽灵段”不能作为已实现事实。
- `scripts/vocabularies-baseline.json:1222`：十阶段 owner 登记在 narrate.ts 的 GenerationProgressPhase。
- 归类 recurring：用户可见旁白被消费者二次解释，未在共享边界约束五段、人话与真实数值。

## 范围与不动项

按四笔里程碑：语汇及穷举/真实数值合同；状态条原子并删旧徽标；等待骨架与真实预览及减弱动态效果；三处接线及实验室、端到端证据。
不新增依赖，不改 electron/agentLane、src/workbench/ai/lane、generationCanvas/reactFlow，不改交互内核。保持节点几何、媒体采纳与时间轴编辑语义。批量卡密度、实时计费不在本刀。
时间轴差异已向用户提出：建议仅已有片段在源节点重新生成时接统一旁白，首次生成幽灵占位段留 C-2。
真实模型历史不足近十条，不展示估计；无真百分比、位次、采样、预览就省略对应信息。提交通常 1–3 秒只是设计说明，不是人为延迟。

## 回滚

四个 scoped commit 可逆序 revert；无持久数据迁移、无新依赖、无远端默认分支改写。PR 不合并。

## 验收门

六条均保留变异先红后绿证据：穷举/文案来源；假 percent 与假位次；三处同句；排队到完成几何；reduced-motion；60% 可读。实验室截图先放 docs/plan/process-feedback-evidence，主会话查看后方可更新基线。zh-CN/en、词表、token、重活门岗不增，最终 pnpm run gates。提交/推送运行版本化 Ponytail hook。PF-LAST.md 不提交、最多 15 行。

## 实施与对账收据

- 语汇 `cb58032ea`；原子 `bf881c4b0`；骨架 `e7ec75745`。第四笔包括三处接线、走查中发现的遮罩层级与结果比例回填修复。
- 十阶段仍为日志/执行契约；`GenerationFeedbackPhase` 是唯一五段 owner。`generationFeedback` 对共享 progress 对象与全局秒钟缓存同一次旁白，任务中心删除独立计时拼句。
- 结果入库先冻结既有可视尺寸，真实媒体尺寸只更新元数据；测试特意返回不同画幅的真实图片夹具，不能用恰好相同的比例制造假绿。
- 三个舞台使用真实组件和真实 store action。实验室的任务、时间轴各占固定独立区域，避免把实验室接触表的自动排版当成生产时间轴位移。
- 动效完全使用浏览器既有动画/媒体查询能力；未引入 img-fx、thinking-orbs 或新依赖。沿用既有 `TimelineClip.tsx` 的原生 animate 模式，没有引入框架新层。
- 本机历史估计只接受已加载项目中同供应商/模型/片长的十次成功记录，耗时取 completedAt-startedAt；不拿成片时长当生成耗时。缺证据不显示。
- 已查看 `process-feedback-evidence/contact-sheet.png`、Electron 缩放与 reduced-motion 截图后才录入 19 张新基线；视觉测试同时执行三处同句和无假数断言。
- 六条判据的红绿证据：`process-feedback-evidence/red-green.md` 与 `acceptance.json`；原生 Electron：`electron-acceptance.json`。零模型额度。
- 可重复命令：先启动本 worktree 的实验室 Vite（端口由 `labPortFor('visual')` 派生），再执行 `node tests/ux/process-feedback.e2e.mjs`、`node tests/ux/process-feedback-electron.e2e.mjs`。标准 `check:design-lab` 自动覆盖新屏。
- 边界明确：现役时间轴没有首次生成幽灵段，本刀仅给已有源节点关联片段接进度；新增幽灵段和批量卡密度留 C-2。已有本地深度处理保持其单独获批顶部呈现。

## 先查别人

以下归档开工时已核对的仓库来源；没有补写未经执行的外部调研。

- 旁白已有唯一入口：`src/workbench/observability/narrate.ts:8`。扩展既有穷举映射，不新建三套消费者词表。
- 浏览器原生动画已有先例：`src/workbench/timeline/TimelineClip.tsx:54`。沿用 animate 与媒体查询，不引入 img-fx 或动画依赖。
- 时间轴已有结果片段的数据边界：`src/workbench/timeline/TimelineClip.tsx:46`。沿用 sourceNodeId 关联，不虚构首次生成幽灵段。
- 原徽标与消费者重复拼句的开工证据见本计划“真实现状与根因”；结论是复用既有旁白与真实预览通路，删去消费者自造状态。
