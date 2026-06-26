# 2026-06-26 站位参考图「姿势/人物」回归测试 + 修复

## 背景（真实摩擦）
`create_staging_reference` 生成的 3D 导演台参考图**经常姿势有问题/人物有问题**（断肢、悬空、穿插、朝向错、肢体扭曲）。
根因候选（来自全链路勘查）按概率：
1. 12 个预设的骨骼角度手调值不准（`scene3dConstants.ts:275-426`），膝/踝最脆。
2. `MANNEQUIN_DEFAULT_POSE` 基线（所有预设叠加其上，错一处全错）。
3. 加法欧拉 + 固定 XYZ 轴序（`scene3dMath.ts applyMannequinSkeletonPose`）大角度旋转易扭。
4. 自动落地 `groundMannequinModel` 失准 → 悬空/陷地。
5. GLB 加载失败 → `ProceduralMannequin` 灰团（无骨骼无姿势）。
6. 朝向 `faceDeg` / `point` 自动瞄准 azimuth。
7. 静默 pose-not-found（canvasTools enum 与 constants 漂移 → 落 standing 无报错）。

## 范围
- **新增**多视角离屏测试 harness（dev-only，复用 `buildStagingScene` + `Mannequin`，零并行版）。
- **30 个测试用例**覆盖：12 个 solo 姿势 + 多人布局/朝向 + 机位 + 人群。
- 每例多视角（hero/front/q3/side/back/top）截图 → 子 agent(VLM) 人眼级审查。
- 子 agent 全部判 pass 才算通过；fail → 诊断根因 → 修 → 重跑，直到全过。
- 单测补漏：预设枚举漂移守卫 + 关节角度合理性 + 落地不变量。

## 不动项
- 不改 `Scene3DAutoCapture` 的生产单视角路径（hero 仍走它）。
- 不引入第二套姿势数学（多视角只是换相机，姿势引擎共用）。
- 删除孤儿 `scene3dMannequinPose.ts`（确认无 live 引用后，单独切片）。

## 产物
- `src/devlab/stagingTestCases.ts` —— 30 用例（harness + 单测共用，单一真相源）。
- `src/devlab/stagingShots.tsx` + `staging-shots.html` —— 多视角离屏渲染，`window.__shots`。
- `tests/ux/staging-pose-shots.walk.mjs` —— vite dev + chromium 驱动，逐例存 PNG。
- `src/workbench/.../scene3d/stagingPoses.test.ts` —— 不变量单测。
- `docs/audit/2026-06-26-staging-pose-review.md` —— 子 agent 审查结论 + 修复记录。

## 验收门
1. 五门全过。
2. 30 例多视角截图，子 agent 审查**全部 pass**（断肢/悬空/穿插/朝向/扭曲零项）。
3. 修复均在根因层（改预设值/落地/朝向），非掩盖。

## 回滚
harness 与单测纯新增，删文件即回滚；预设值改动 git revert 对应 commit。
