# 2026-07-01 角色操控三修：退出丢录制 / 动作卡住 / 游戏式操控键

## 背景

用户真机反馈三件事：① 操控角色录了一段，退出操控后完全没看到参考视频；② 动作库点了「挥手」后摘不掉，永久卡在那个姿势；③ 想要游戏式操控键（跳跃/加速跑/下蹲）。

## 范围

- `useScene3DTakeRecorder.ts`：`stopRecording` 改成 ref 守卫的幂等函数（谁调、调几次都安全）。
- `useScene3DCharacterDrive.ts`：新增 `onBeforeExit` 钩子，`exitPossess`/`exitCameraPossess` 及两条「对象被删」自动退出 effect 统一在清空 possess 态前调用它——退出操控这个动作本身负责把还在录的 take flush 出片。`applyActionPreset` 增加"再点已激活预设 = 顶成站立"的 toggle，返回实际生效的 presetId。
- `scene3dCharacterActionBar.tsx`：动作库加「站立」按钮（复用 `standing` 预设）；更新底部按键提示文案。
- `scene3dCharacterDrive.ts`：新增纯函数 `groundSpeedMultiplier`（加速/下蹲倍率）、`jumpArcOffset`（跳跃抛物线），配套常量与单测。
- `scene3dCharacterDriveController.tsx`：接 Shift 加速 / Space 跳（一次性抛物线位移）/ C·Ctrl 下蹲（squat 姿势 + 减速，允许蹲着移动）。
- `scene3dViewControllers.tsx`（`Scene3DControls`，相机 fly）：接 Shift 加速，复用同一套倍率函数。
- `Scene3DFullscreen.tsx`：接线 `onBeforeExit` → `takeRecorder.stopRecording`（ref 转发，同 `recordPoseResumeRef` 范本）；`handleApplyActionPreset` 改用 `applyActionPreset` 的返回值喂 `recordPoseEvent`。

## 不动项

- 不改跳跃/加速/下蹲的骨骼动画素材（没有对应 clip，纯 `group.position.y` 抛物线 + 复用现成 squat 静态姿势）。
- 相机 fly 现有 Space=升/Shift=降 语义不变；Shift 加速是叠加倍率，不是新占用键位。
- 不改共享 `Scene3DMovementCode`/`MOVEMENT_CODES`（WASD/Space/Shift）体系；C/Ctrl 下蹲走角色控制器内部独立 ref，不进这套共享管线（Ctrl 修饰键会撞现有 `event.ctrlKey` 系统组合键防护，且相机 fly 没有下蹲语义）。

## 已知限制（诚实标注，不藏）

- 蹲着移动没有蹲走混合动画素材，视觉上是「蹲姿滑步」（静态 pose + 位移），不是真正的蹲走循环。
- physically 按住字面 Ctrl 键时，`event.ctrlKey` 为真，会被 WASD 分支的既有「忽略带修饰键的移动键」防护拦住，蹲+走同时按可能不生效；C 键无此问题，是完整支持的主键，底部提示以 C 为主。
- 下蹲/跳跃当前不进 take 录制的 pose 轨道（`recordPoseEvent` 只在点击式动作库触发），录制中做这些动作不会体现在回放里——若后续要补，落点在 `useScene3DTakeRecorder.recordPoseEvent`/`recordPoseResume` 附近。

## 回滚点

三块改动相互独立，任一块可单独 revert：
1. 退出收尾（`useScene3DTakeRecorder.ts` + `useScene3DCharacterDrive.ts` 的 `onBeforeExit` + `Scene3DFullscreen.tsx` 接线）。
2. 站立 toggle（`useScene3DCharacterDrive.ts` 的 `applyActionPreset` + `scene3dCharacterActionBar.tsx` 的 ACTION_DEFS）。
3. 游戏式操控键（`scene3dCharacterDrive.ts` 新增纯函数 + `scene3dCharacterDriveController.tsx` + `scene3dViewControllers.tsx`）。

## 验收门

- `scene3dCharacterDrive.test.ts` 新增 `groundSpeedMultiplier`/`jumpArcOffset` 单测全绿。
- R13 真机走查：退出操控（不点停止）出片、动作库点两次摘掉、Shift/Space/C 键真的生效——截图/取帧数值佐证。
- 五门 `pnpm run gates` 全过。
