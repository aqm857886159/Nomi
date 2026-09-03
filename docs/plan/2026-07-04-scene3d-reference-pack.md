# Scene3D 导演参考包（基于最新版导演台）

> 裁决：已被现行 Scene3D 参考导演路由取代；证据：`src/workbench/generationCanvas/nodes/scene3d/scene3dReferenceDirector.ts:111-128`、`src/workbench/generationCanvas/nodes/Scene3DEditor.tsx:289-296`。

日期：2026-07-04
基线：`origin/main@0f132880`，承接 `2026-07-03-scene3d-director-upgrade.md`、`2026-06-21-staging-reference-tool.md`、`2026-06-30-game-style-3d-character-control.md`、`2026-06-06-reference-v4-implementation-spec.md`。

## 0. 结论

最新版已经不是“没有导演台”，而是已有四条强地基：

- 白膜置景：场景模板、语义道具、假人/群众、姿势库、相机/焦段/画幅。
- 人当导演：选相机、点运镜预设、调焦段、手持抖动、录 take。
- 参考视频：`CameraMoveCaptureHost` 能把 3D take 采帧成 mp4，并把它写进目标视频节点的 `video_ref`。
- 参考图：站位工具已能离屏出 composition_ref，运镜首尾帧也已能导出为图片节点。

缺口不是再做一个独立“参考出口”，而是把“用户调用路径 + 目标路由 + 参考包状态”显性化：用户像导演一样置景/摆人/放道具/设相机/录镜头后，系统明确告诉他这次会产出什么参考、喂给哪个视频节点、走 `video_ref` 还是降级。

## 1. 外部调研对齐

- Higgsfield Cinema Studio 的强点是摄影师心智：镜头、焦段、灯光、风格、AI co-director、可复用 Elements；Higgsfield WAN Camera Control 公开强调相机运动预设、主体稳定、最高 10s 和 20+ 动态镜头。
- Seedance 2.0 官方强调图/音/视频多模态参考，以及对 performance、lighting、shadow、camera movement 的 director-level control。
- Kling Motion Control 更偏“角色动作/表情从参考视频提取”，适合人物运动迁移，不等同于全场 3D 置景。
- Runway Gen-4 References 的核心是角色/物体/地点的一致性，多参考图维持世界，而不是 3D 白膜导演台。
- PrevizWhiz 研究给出同方向验证：粗 3D 场景 + 生成式图/视频模型，可以降低 previz 门槛，补手绘 storyboard 缺空间精度、传统 3D previz 过重的问题。
- Uni3C / ReCamMaster 类研究说明 3D 几何先验和相机轨迹对视频可控性是硬价值；但 Nomi 当前产品路线应先用 training-free 灰模参考包，不做模型训练。

判断：Nomi 的差异化不是“也有 camera preset”，而是 **本地 3D 导演台 → 可复用参考包 → 画布节点路由 → 模型槽位投递** 的闭环。

## 2. 用户怎么调用

主流程：

1. 画布上新建/打开 `scene3d` 节点。
2. 在底部“添加”里套场景模板，放道具、人物、相机。
3. 选中相机，在右侧“运镜预设”里点推/拉/环绕/变焦等，必要时调焦段、画幅、手持抖动。
4. 把 `scene3d` 节点连到目标视频镜头节点。
5. 需要参考图：点“导出运镜首尾帧”，系统创建两张图片节点，并自动连到目标视频节点的 `first_frame` / `last_frame`（目标模型支持时）。
6. 需要参考视频：底部进入角色/相机操控并“录 take”，系统创建“录制走位参考”节点，离屏采帧成 mp4，并自动写入目标视频节点的 `video_ref`（目标模型支持时）。

降级：

- 目标模型支持 `video_ref`：录 take 自动走参考视频主路。
- 目标模型没有 `video_ref`：写结构化运镜 prompt，作为弱降级。
- 目标模型有首尾帧槽：首尾帧参考图自动接边。
- 没连接目标视频节点：仍会产出图片/mp4 留在画布，但不会喂入目标。

## 3. 本轮已改代码方案

### S1 参考目标摘要纯函数

新增 `scene3dReferenceDirector.ts`：

- `summarizeScene3DReferenceTarget(sourceNodeId, nodes, edges)`：从 Scene3D 出边找下游视频目标，读取模型 archetype，判断 `video_ref`、当前模式帧槽、任意模式帧槽。
- `referenceSlotForScene3DCaptureTitle(title)`：把“运镜首帧/尾帧”截图标题映射到 `first_frame` / `last_frame`。
- `shouldAttachScene3DFrameReference(target, slot)`：只有目标视频模型确实声明可吃该帧参考时才自动接边。

### S2 Scene3D 编辑器接线

`Scene3DEditor.tsx`：

- 从 canvas store 读取 nodes/edges，生成 `referenceTarget`。
- 把 `referenceTarget` 传入全屏导演台。
- `handleScreenshot` 在创建首/尾帧图片后，如果存在可消费的下游视频目标，自动 `connectNodes(imageNode.id, targetNodeId, first_frame/last_frame)`。

### S3 右侧面板 UX

`scene3dCameraMovePanel.tsx`：

- 在“运镜预设”里新增小型“参考输出”状态块。
- 显示目标状态：`未连接视频镜头` / `video_ref · 目标镜头` / `prompt · 目标镜头`。
- 显示视频路线：`录 take → video_ref` / `录 take → 运镜文字`。
- 显示帧图路线：`首帧 / 尾帧` / `首帧` / `不可接帧槽`。

## 4. 设计原则

- 不新开第二套参考系统，继续服从 V4 参考区的 typed slot/edge 设计。
- UI 只做状态显性化，不把导演台变成说明书。
- `video_ref` 是主路；首尾帧是模型不吃视频参考、或用户需要关键构图锚点时的补充。
- 灰模只负责空间、镜头、动作大势；身份一致性仍靠角色参考图/模型原生 identity/后续 Wan Animate 类驱动。

## 5. 测试系统

已新增/需执行：

- 单测：`scene3dReferenceDirector.test.ts`
  - 检测下游 video target。
  - 检测 Seedance apimart omni 的 `video_ref` 路由。
  - 检测首尾帧标题到槽位映射。
  - 检测非视频下游不会误判为目标。
- UX：`tests/ux/scene3d-reference-pack.walk.mjs`
  - Electron + Playwright 真机点击，覆盖打开 3D、选相机、查看参考输出状态、点击“推近”、导出首尾帧、验证画布边。
  - 继续点击“操控”→“录 take”→停止，等待本地 mp4 写入目标视频节点 `referenceVideoUrls`，验证 `video_ref` 闭环。
- 单测：`cameraMoveTargetAttach.test.ts`
  - 检测录 take mp4 注入 Seedance apimart `video_ref`、保留 variant 轴、幂等去重、无 `video_ref` 模型的 prompt 降级。

## 6. 下一步切片

- T1：把目标视频节点标题/模式变化做更细的 toast：接帧成功、目标无帧槽、目标无 video_ref。
- T2：生成质量评测：同一镜头对比无参考 / 首尾帧 / video_ref 三组输出，看运镜一致性、主体漂移、构图承接。
