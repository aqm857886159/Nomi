# Director 3D-BOX 临时债

| id | 欠账 | owner | 到期 | 清账证据 |
|---|---|---|---|---|
| director-3dbox-r13 | 开关开 dev 构建的 zh/en 三状态真机截图、Windows 预览包、最小窗口与真实三镜工程走查 | 独立 3d 验收线 | 2026-11-15 | 截图逐张 Read 描述、包内 `feature-flags.json`、`check-packaged-flags`、走查报告 |

本债不改变正式版默认：release 构建仍必须烘焙 `director3dbox=false`；到期未清不改成通过或删除登记。

## 3b 新增（`docs/plan/2026-10-04-director-3dbox-3b-design-card.md`）

| id | 欠账 | owner | 到期 | 清账证据 |
|---|---|---|---|---|
| director-3dbox-face-fork | 开关开 / 关两张工具面并存：`stage_shot` 两份声明（`writeVerbs.ts`）、`director.write` 条件注册、`canvas.write` 附加别名分叉、preload 取证白名单追加、第二份基线（`model-face-baseline.director3dbox.json`、`tool-face-baseline.director3dbox.json`）、CI job `director3dbox-face`、usecase `requiresFlag`、技能 `requires-flag` | 切换 PR | 2026-11-15 | 切换 PR 同 commit 删旧 stage_shot 与上列全部分叉，`check:model-face-frozen` 只剩一份基线 |
| director-3dbox-gate1 | 门槛 ①：真实 Agent 模型经真实工具调用跑「一句话 → 预演 → 挂视频节点 → 确认卡」；替身模型的回合只证明链路能走通，不算切换门槛 | 3d 评测线 | 2026-11-15 | 真实 Agent 模型（非替身）回合收据 + 工具轨迹 |
| director-3dbox-preview-length | 预演上限 10 秒（240 帧 × 24fps），超长直接判失败；分段录制或提上限需真机测内存 | 3d / 编译器线 | 2026-11-15 | Windows 真机 15 秒预演内存曲线 + 决定 |
| director-3dbox-dispatch-recheck | 花钱闸在出卡前与渲染端提交咽喉各判一次；报价卡确认之后、主进程派发之前若计划又被改到「渲染中」，主进程派发不再回看画布 | 生成调度线 | 2026-11-15 | 派发前回查预演状态的测试，或证明派发只走渲染端提交咽喉 |
