# 导演编译器第一步：空间事实收成一份（设计卡）

> 来源：`docs/plan/2026-10-05-director-compiler-root-cause.md` 选项 ② 里的 ① 部分。不改计划契约（`DirectorPlan` schema、`stage_shot` / `director.write`）。
> 线：L-stage1。类别：其他（不碰花钱 / 长跑 / 可打断 / 新界面；有渲染截图对比）。

改动名：编译器 / 测量 / 相机避让 / AI 搭场景读同一份空间事实

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当用户让导演台把一句话编成预演、或用 AI 搭场景，我想看到人站在地上、墙立在地上、东西不互穿、机位看得见主体，以便不用逐个修位置。不做：命名站位、离散站位点、改计划 schema。已知坑：GLB 模型无包围盒真值（仍按 1 米方盒，标 unverified）。真实任务：庭院三镜、香水瓶转台、警匪街道（oracle 计划）+ AiSceneBar 提示词自带示例。 | `directorSpatialInvariants.characterization.test.ts`、`evals/director` 离线评测、设计实验室截图 |
| ★2 谁说了算 | 「图元几何 / 原点约定 / 包围盒」唯一 owner = `model/directorSpace.ts`（渲染组件 `PrimitiveEntity`、编译器、测量、AiSceneBar 都读它）；「中心↔原点」「底↔原点」各一个换算函数，都在该文件。「有片段就在轴上」owner = `timeGrid.ts#syncInTimeline`（编辑器与编译器共用）。 | `node scripts/door-map.mjs` 对 `OBJECT_GEOMETRY_SIZES` / `OBJECT_ORIGIN_OFFSETS`（删后 0 扇） |
| ★3 一致与复用 | 尺寸 / 包围盒用 three 的 `Box3`（已是依赖），不自写；删 `OBJECT_GEOMETRY_SIZES`、`OBJECT_ORIGIN_OFFSETS`、模板里的中心坐标、编译器里 0.65 / 1.75 / scale 反推字面量；`syncInTimeline` 从 `storeClipActions` 挪到 `timeGrid` 共用，不写第二份。自写部分只有「物理判据」（领域：按镜头看不看得见 / 携带物跟人走），登记在评测里。 | `git grep` |
| ★4 全状态 | 不适用：无新界面。编译产物可见变化用 zh/en 无关的 3D 画面（courtyard 三镜前后对比截图）。 | 截图路径见交货报告 |
| ★9 验收与回滚 | 验收：特征测试违例账只降不升；离线评测 oracle 分前后对比，掉分逐项说明；AiSceneBar 示例底贴地的测试。回滚：每步一个提交，逐个 `git revert`（空间事实 → 时间轴 → 判据 → 靶子 → AiSceneBar）。 | 提交 SHA |

## 约定

- **原点约定**：以渲染为准——`character` 脚底为原点；图元（cube / sphere / cylinder / cone / torus / tetrahedron / icosahedron）网格抬高 0.5，包围盒由 `Box3` 量；`plane` 是 0.02 薄片居中。不是所有图元「底=原点」（四面体 / 二十面体底在 0 以上，圆环陷进 0 以下 5cm），所以「落地」一律走 `originYForBottom`，不假定底 = 原点。
- **AI 搭场景**：提示词仍让模型写「中心坐标」（模型自然的写法），`normalizeAiScene` 是唯一把「中心」换成「原点」的地方，AiSceneBar 与规划器 dressing 共用。
- **地面**：模板地面顶面 = y 0（地面板向下长 5cm），人和物按 y 0 站，全场只有一个地面高度。

## 步骤

1. 空间事实：`directorSpace.ts`（几何表 + Box3 包围盒 + 两个换算）；`PrimitiveEntity` 读它；测量、编译器、模板读它；删手抄表。
2. 时间轴：`syncInTimeline` 上移；编译器出口调用。
3. 打分判据：特征测试里的判据升格为 `directorSpatialAudit.ts`，进评测打分（分数如实下降）。
4. 靶子纠错：题卡 category、oracle 计划由卡片派生、环境词不做灰盒、t1-07 题面对齐。
5. AiSceneBar：`normalizeAiScene` 换算，补不悬空测试。
