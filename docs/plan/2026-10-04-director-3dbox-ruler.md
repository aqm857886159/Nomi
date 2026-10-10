# 3D-BOX 尺子盲测 2b 设计卡

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：director-3dbox-ruler / 预演测量与盲测诚实化　线/负责人：尺子专班　类别：[其他]

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当评测员比较导演方案时，我想用同一套机位求值、主体对应和画面运动判定，按真实画面判断推拉/变焦/环绕，以便分数反映创作者看到的结果；步骤是加载题卡、生成方案、采样时间轴、渲染联系图、盲评并复核。不会把缺失主体、场景或测量缺口当成通过；已知坑是旧 oracle 会用 fov 伪造推镜且方案命名不一致。真实任务为全题库三轮评分、诱饵批次、人工校准页。 | `evals/director` 测试与重跑报告 |
| ★2 谁说了算 | 机位位姿 → `model/cameraPoseEval.ts`；预演测量 → `model/directorEvalMeasurement.ts`；评分对应 → `evals/director/binding.ts`；盲评回读 → `evals/director/judge/**`。测量与评分只读纯模型，产品播放调用同一机位求值。 | `node scripts/door-map.mjs evaluateCameraPose`；`node scripts/door-map.mjs sampleDirectorProject` |
| ★3 一致与复用 | 复用现有 `evaluateEntityTransform`、`evaluateSceneObjectPose`、`closeupRig`、`lookAtAngles` 和采样器；删除产品侧第二份机位求值，评分器统一调用对应器。 | `rg -n "evaluateCameraPose|resolveActors|cameraSample" src evals` |
| ★4 全状态 | 空：报告显示未运行；加载：显示当前 scheme/card；成功：显示分层分数、对应率和能力缺口；失败：保留原始错误与 schema 错误；部分成功：标记 `partial` 并保留已完成批次；取消中：哨兵文件和进程状态可见；过期：报告标记旧批次。文案走现有报告文本，不新增 UI。 | 报告与 `evals/director/judge/calibrate.html` |
| ★9 验收与回滚 | 验收：运行对应单测、全库门岗、全题库三轮与盲评批次，人工 Read 三张 oracle 联系图；回滚：revert 本分支提交。独立验收线在 PR 中填写。 | `pnpm run gates`、报告路径 |
