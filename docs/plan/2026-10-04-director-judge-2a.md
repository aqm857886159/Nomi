# Director 3D-BOX 盲测终审第二轮 2a 设计卡

改动名：盲测揭盲与渲染可信度修复 2a　线/负责人：director-3dbox-judge　类别：[长跑][其他]

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当编排者运行盲测并查看联系图时，我想让位置揭盲、预注册、JSON 失败和出片路径可追溯，以便只把真实可见结果交给评审；不改尺子、oracle 或默认产品行为；真实任务是跑三张指定卡的小样、单片评审和正反两次两两对比。 | `evals/director/judge/run.ts`、`tests/ux/_directorLab.mjs`、本任务最终报告 |
| ★2 谁说了算 | 盲评状态由 `evals/director/judge/**` owner；离屏出片由 `DirectorHeadlessCapture` owner；devlab 只消费产品出片结果；测量与评分器只读。 | `node scripts/door-map.mjs evals/director/judge/review.ts`；`node scripts/door-map.mjs src/workbench/generationCanvas/nodes/director/agent/DirectorHeadlessCapture.tsx` |
| ★3 一致与复用 | devlab 渲染复用 `DirectorHeadlessCapture`、`CaptureBinder`、角色 GLB 等待和 `SceneRefRegistry`；盲测随机顺序与解析在 judge 共享边界处理，删除复制 CaptureDriver。 | `git grep -n "DirectorHeadlessCapture\|CaptureDriver\|pairwiseOnce\|preregister"`；`pnpm run check:self-written` |
| ★4 全状态 | 空：显示待渲染；加载：等待资源和帧稳定；成功：写入帧、回读和联系图；失败：保留错误与作废原因；部分成功：逐卡标记；取消中：停止并保留已完成收据；过期：预注册时间戳/哈希校验失败则 blocked。 | `evals/director/judge/report.ts`、`evals/director/judge/schema.ts`、三张联系图收据 |
| 5 中途表 | 评审/渲染停止、关窗、断网、重启、连点均不把未完成结果算成功；已完成文件保留，未完成标 `blocked`，不重复计费。 | 人工核对运行目录与 `results.json`；本轮不做付费调用 |
| 6 外部数据与失败 | Codex 评审输出必须是 schema JSON；解析失败最多重试一次，仍失败带 schema 错误记 blocked；GLB/three 资源未就绪不截帧；测量回读不一致作废并列测量侧缺口。 | `evals/director/judge/schema.ts`、`DirectorHeadlessCapture.tsx`、回读报告 |
| 7 性能预算 | 三张卡按既有 devlab/Playwright 路径顺序渲染，单卡受现有 10 分钟哨兵/25 轮上限约束；本轮记录耗时，不以性能绿灯替代视觉证据。 | `tests/ux/_directorLab.mjs`、运行日志 |
| 8 真实条件 | macOS 当前 clone、英文/中文 schema 文本、真实项目卡资源；Windows、真实付费、原生选择器、导出覆盖未运行，均记 `unverified`。 | `pnpm run test:core-smoke -- --fixture empty`、联系图人工 Read |
| ★9 验收与回滚 | 验收：独立验收线按三张联系图、F7 确定性测试、JSON/预注册测试和 core-smoke 复核；回滚按单元 commit 逐个 revert，不改测量器。 | `pnpm run gates`、`pnpm run review:branch`、PR `## 独立验收` |

