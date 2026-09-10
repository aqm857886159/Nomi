# director/agent/
> L2 | 父级: ../CLAUDE.md
> 「AI 来导」：画布助手的 create_staging_reference / create_camera_move 两个工具（契约住 agent/canvasDescriptors，工具名与 schema 不变）在导演台侧的执行体。
> 词表 spec → V1 形状场景（builder，含运行时自检）→ migration/ 迁成导演台工程 → 建 director 节点 + 打自动出图标志 → 常驻 Host 扫到标志才离屏出图 / 出片 → 落 image 节点 / 喂目标镜头。
> 手动运镜控件（nodes/NodeCameraMoveControl）与 AI 工具共用 createCameraMoveReferenceNode，fps / frameCount / move 不变量只算一次。
> 依赖方向：本目录可 import migration/ 与 scene/（离屏出片要 three 世界），但 model/ 与 scene/ 不反向 import 这里；对外只暴露建节点入口与两个 Host。
> 成员清单
> stagingVocab.ts: 站位词表单一真相（布局 / 机位角度 / 高度 / 景别 / 环境 / 朝向的字面量联合 + 数值表），LLM 工具 schema 与 builder 同源
> cameraMoveVocab.ts: 运镜词表单一真相（13 种运镜、速度 → 秒、景别 → 距离、CAMERA_MOVE_LABEL 人话）；工具调用摘要与运镜控件同源
> cameraMoveFovMath.ts: 变焦 / 希区柯克 dolly-zoom 的 FOV 数学（等价视角保持主体尺寸）
> stagingBuilder.ts: 站位 spec → V1 形状场景（角色环形 / 直线 / 对峙布局、姿态别名 → 预设 id、机位由角度 / 高度 / 景别推）；auditStagingSpec 运行时自检（未知姿态 / 越界 → issues 人话）
> cameraMoveBuilder.ts: 运镜 spec → V1 形状场景（主体 + 机位路径绑定：推拉 / 环绕 / 升降 / 横移 / 弧线 / 变焦，速度决定绑定时长，fov 端点走 cameraMoveFovMath）
> cameraMoveSchedule.ts: frameTimes(start, end, count)：采样时刻序列单一真相（首尾含端点、等距）
> cameraMoveCaptureRetry.ts: 离屏出片重试纯逻辑：结局 ok / null / timeout × 轮次 → done / retry(延迟) / giveUp；默认 3 轮、30s 看门狗
> attachCameraMoveToTarget.ts: 运镜小片喂入目标镜头的纯核（computeAttachCameraMove）：只接视频节点、有 video_ref 槽则切全能参考模式 + 填参考视频并提示，否则降级为提示词地板；幂等（同 url 不重贴）
> createStagingReferenceNode.ts: 站位参考建节点入口：buildStagingSceneAudited → migrateScene3DState → create_nodes(kind director, meta directorProject + stagingAutoCapture)；readStagingAutoCapture
> createCameraMoveReferenceNode.ts: 运镜参考建节点入口（AI 路 + 手动路共用）：buildCameraMoveScene → 迁移 → create_nodes(kind director, meta directorProject + cameraMoveAutoCapture{targetNodeId, fps 24, frameCount, move})；readCameraMoveAutoCapture
> DirectorHeadlessCapture.tsx: 离屏出片器：隐藏 FencedCanvas + 独立 store，只装环境 / 实体 / 播放求值 / CaptureBinder；等角色 GLB 落地（对象表里出现 characterMount）→ 按时刻序列逐帧 seek + 等两帧 → 机位 1 出片 → 一次回调 frames[]；短边可封顶（参考视频 720p）
> StagingCaptureHost.tsx: 常驻 Host（画布壳按 components/directorCaptureHostActivation 懒挂）：扫 stagingAutoCapture → 出一张 → persistDirectorScreenshot → image 节点（stagingComposition 标记）+ director→image(reference) + image→镜头(composition_ref) → 截图写回工程 outputs.screenshots → 清标志
> CameraMoveCaptureHost.tsx: 常驻 Host：扫 cameraMoveAutoCapture → 沿机位 1 路径片段区间采 frameCount 帧（720p 封顶）→ persistDirectorFramesVideo 拼 mp4 → 写回 meta.cameraMoveVideo + 工程 outputs.videos → computeAttachCameraMove 喂目标镜头 → 清标志；看门狗 + 重试（attempt 当挂载 key 整棵重挂）；E2E 桥仅 localStorage 打标时暴露
> *.test.ts: 词表 / builder / 调度 / 重试 / 喂入纯逻辑单测
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
