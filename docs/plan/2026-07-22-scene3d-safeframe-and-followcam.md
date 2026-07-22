# 计划：3D 安全画幅求解器 + 跟拍朝向一等数据 + 首尾帧持久结果卡

> 日期：2026-07-22 · 分支：`fix/scene3d-safeframe-followcam-browser-oneshot`（sibling `/Users/aoqimin/Desktop/Nomi-r2-framing-followcam-20260722`，钉 `origin/main@24f80122`）
> 来源：`/Users/aoqimin/Desktop/Nomi/.independent-retest/{REPORT.md,HANDOFF.md}`（独立复测基线 7f2eda2f，已并入 24f80122）
> 独立复测已确认 **A/C/D/黑帧/动图 PASS，不得回归**；本轮修 3D 剩余根因 E/F1/F2。

## 背景事实（复测已定，不重新发现）
- E 失败：`buildRecordedTakeScene` 继承预选运镜时只保住位置轨迹，**不设 followTargetId、不生成 aim** → `scene3dPlayback` 朝向回退静态 `camera.target` → 「右横移跟拍」只剩右横移、主体漂出画面。
- F1 失败：默认假人 scale 2.5、中心 y=1.25、头 y=2.5，默认相机却固定看 `[0,0.75,0]`（低于中心）→ 单人默认就截头，双人/推近更甚。非特定站位偶发。
- F2 失败：首尾帧导出只逐一建节点 + 瞬时 toast，无持久结果卡/「回画布查看」。

## 范围（本轮做）

### F1 — 安全画幅求解器（P0，新纯模块）
- 新增 `scene3dSafeFrame.ts`（纯几何，零渲染）+ `scene3dSafeFrame.test.ts`：
  - `subjectAabb(objects)`：拍摄主体（可见 mannequin，双人取 union）的 world-space AABB（中心 + 半轴，用 `objectVisualHalfHeight` 求 y 半高、按比例估 x/z 半宽）。
  - `projectPointToScreen` / `projectAabbScreenRect`：透视投影 8 角点到屏幕 NDC [0,1]（x 右、y 下）。
  - `solveSafeFrameCamera({ subject, direction, fovVertical, aspect, margin })`：target=主体中心，沿 direction 反向解最小距离，使 AABB 8 角投影落进安全矩形 `[margin,1-margin]`；**保留作者方位角**，不改 FOV。
- 单测锁死 6 画幅（16:9/9:16/4:3/3:4/1:1/2.39:1）× {单人站立/单人下蹲高举手/双人分站}：解出相机的投影 rect ⊂ `[0.10,0.90]`（float epsilon）。
- 接入 `scene3dSerializer` 默认相机 + `scene3dSceneTemplates`/工厂 + 切输出视图/画幅：都走同一求解器，不再维护固定机位常量。auto-managed 默认走求解；用户手动构图后不静默覆盖（本轮先保证默认/模板/双人不截头，manual 所有权见下）。

### E — 跟拍朝向建成一等数据（P0）
- `inheritCameraMove` 返回 `hasAim`；`buildRecordedTakeScene` 继承分支：
  - 有 aim → aim 单源，清 followTargetId。
  - **position-only 运镜 → `camera.followTargetId = character.id`**（播放优先级②持续看住移动主体，绝不回退静态 target）。
  - 无预选运镜 → 老行为（采样机位 + follow，已通过不动）。
- 回归测试不只断言轨迹名：用 `scene3dSafeFrame` 在 t=0/50%/100% 求值 camera position+target、投影角色 bounds，断言角色完整可见 + 中心横向漂移 ≤ 画宽 10%。

### F2 — 首尾帧持久结果卡（P1）
- 复用现有 `Scene3DExportCard`/导出卡机制（不造平行 toast UI）：首尾帧导出走同一事务 → 完成态卡「首尾帧已生成（2 张）」+「回画布查看」，≥6s 或用户主动关闭前持续可见；两张都成功才显示完成，只成一张显示 `仅生成 1/2` partial。
- 新 UI 文案走 i18n（24f80122 起 `check:i18n` 零容忍门）。

## 不动项
- 不回归 A/C/D/黑帧/动图（复测已 PASS）。
- 不改离屏出片公式 / 首尾一致 SSIM 链。
- 不为求解偷改 margin 到 8%（8% 只是真渲染量测容差，不是实现 margin）。
- 浏览器 B1/B2（一次性选取 + 目标确认 + 真实 ACK + 结构化错误）本轮**不做**，作为下一 chunk 交接（HANDOFF.md 已是其规格）——诚实标，不半成品混入。

## 回滚
- 单分支单 PR；各修带独立单测；worktree 独立钉 origin/main，push 前 fetch 对账。

## 验收门
1. `pnpm run gates` 全过（含新 `check:i18n`）。
2. 新增测试先红后绿：safeFrame 6 画幅投影不越界；E 跟拍首中尾主体完整 + 漂移≤10%；F2 结果卡事务。
3. 官方走查全过：`scene3d-export-journey` / `scene3d-keyframe-consistency` / `scene3d-recording`（不回归 A/C/D/E）。
4. 真机眼见链：默认单人/双人不截头（截图）；跟拍真 MP4 抽首中尾人物完整（VLM/人眼）；F2 卡 6s 仍在。
