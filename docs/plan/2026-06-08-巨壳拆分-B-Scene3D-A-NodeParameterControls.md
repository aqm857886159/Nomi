# 巨壳拆分计划：B (Scene3DFullscreen) → A (NodeParameterControls)

> 触发：PR #7 引入 `docs/coding-standards.md`（单一职责 + 文件分割）。4-agent 审计后，按 ROI/风险排序逐个拆。
> 原则：纯结构搬运，**零行为变更**。每个文件一个 commit，改完跑五门 + 多 agent 对抗验证。
> 日期：2026-06-08。

## 总体策略

- **不是 UI 改动**（无可见行为变化）→ 不走 R8 样张/对账流程，但走 R4(本文档) + R11(五门) + R13 不适用(无交互态变化)。
- 拆分手法：把内部「常量 / 类型 / 纯函数」搬到形制相同的兄弟文件，原文件 `import` 回来。
- 验证：每个文件拆完，主 loop 跑五门；再开多 agent 对抗验证（4 视角：① 漏搬/漏引用 ② 行为等价 ③ token/lint/import 合规 ④ 关门复跑）。
- 验证全绿才 commit；commit 时**同步下调 `check-file-sizes.mjs` 白名单基线**（R12 棘轮战果）。

## B. Scene3DFullscreen.tsx（4588 行，白名单第一大巨壳）

### 范围（只搬「纯」的，组件/状态编排留在原文件）
1. **`scene3dConstants.ts`** ← 常量区 + pose 预设（原 137-415）+ 它们依赖的本地 pose 类型（`MannequinPoseControl`/`MannequinPoseSection`/`MannequinPosePreset`，原 87-118）+ `Scene3DMovementCode`/`CrowdAddOptions`（原 81-135 中相关项）。约 -280 行。
2. **`scene3dMath.ts`** ← 顶部纯函数块（原 417-879：pose/vector/camera/euler 数学、`makeObject`/`makeCamera`/clipboard clone、movement-key helpers）+ 纯 crowd 数学（原 1389-1433）。约 -470 行。

> 不动：所有 React 组件（`Scene3DControls`、`Mannequin*`、`InstancedMeshBatch`、面板 UI…）、主 `Scene3DFullscreen` 状态编排、`captureScene`（依赖 THREE renderer，归 math 还是单列待定，倾向单列 `scene3dCapture.ts` 若耦合低）。

### 预期
4588 → 约 3770 行（仍是巨壳，但白名单基线从 4588 下调到实测值）。后续轮次再抽组件/面板。

## A. NodeParameterControls.tsx（639 行）

### 范围
1. **`InlineParameterBar.tsx` 子组件** ← `section === 'parameters'` 整个分支 + `renderInlineParam`（原 508-602）。约 -95 行。
2. **`useNodeModelAutoSelect.ts` hook** ← 4 个模型自动选/vendor 同步/供应商断开自愈 useEffect（原 186-275）。约 -90 行。
3. **`useNodeAssetSlots.ts` hook** ← slot/array/upload handler + AssetSlot 适配（原 294-504）。约 -210 行。

### 预期
639 → 约 245 行。落到软目标内。

## 不动什么

- 任何运行时行为、props 契约、对外导出签名。
- 五个巨壳里的其余三个（runtime.ts / BaseGenerationNode / GenerationCanvas）本轮不碰。
- 中/低优先级文件本轮不碰。
- 设计 token / 样式 / CSS 文件。

## 回滚策略

- 每个文件独立 commit；出问题 `git revert <sha>` 单独回退，互不影响。
- 拆分纯搬运，行为等价由「五门 + 多 agent 对抗验证」双保险；任一不绿即不 commit。

## 验收门

| 门 | 标准 |
|---|---|
| check:filesize | 绿（且白名单基线已下调）|
| typecheck | 0 错误 |
| lint:ci | 不新增 warning（≤98）|
| test | 785 全过不回归 |
| build | vite7 构建绿 |
| 多 agent 对抗验证 | 4 视角全部判定「行为等价、无漏搬、合规」|
