# director/panels/inspector/
> L2 | 父级: ../CLAUDE.md
> 属性检查器：按选中类型分发；空间变换统一经 write*SpatialTransform（编辑层三态），只读层禁用并解释（C1/C4）。
> 成员清单
> ContextInspector.tsx: 分发器：时间轴上选中片段 / 关键帧 → 只显示那一张卡且标题换成它的（useTimelineSelectionCard）；否则 角色 / 几何体·组 / 机位 / 灯 / 无选中 → 场景图层配置
> TransformSection.tsx: ObjectTransformSection（位置 / 朝向 / 缩放）与 CameraTransformSection（位置 + 水平 / 俯仰 / 横滚），空间变换卡逐行：每个量「小标题 + ↺」+ 三条滑条（位置 ±100 步 0.1 · 水平 0–360 / 俯仰 ±90 / 横滚 ±180 步 1 · 缩放 0.1–10 步 0.05），卡头一行「编辑模式：静止 / 关键帧 / 只读」，只读层禁用；机位位置 ↺ 回自由相机的家 (0,1.7,10)
> CharacterInspector.tsx: 角色三页签：基础（名称、颜色预设、变换）/ 姿态 / 骨骼；骨骼页 = 骨骼聚焦（isSkeletonEditing，进页 IK 模式默认选骨盆，离页清把手 / 骨骼选择）
> PoseTab.tsx: 角色姿态页：「内置姿态」列表（名字 + 勾选；点 = 换 posePreset 并清全部微调）+ 提示；「快捷体形」列表（按缩放容差 0.02 判当前）+ 提示
> SkeletonTab.tsx: 骨骼页：「姿态动力学与骨骼 ｜ 全部复位」→ 分段 IK / FK（切 IK 无靶点默认骨盆、切 FK 清靶点）→ 人偶（状态行 + W / E 芯片 + 右(R)/左(L) 角标）→ IK：双脚吸附 / 左右镜像（按所选靶点的侧）两键 + 已选中手柄卡（复位肢体）或提示；FK：已选关节卡（重置关节 = 写 0 / 快选 −90 −45 0 45 90 / 三轴 ±180 语义标签滑条）或提示
> PuppetFigure.tsx: 2D 骨骼人偶（SVG 250×300）：17 段骨两半明暗菱形（FK 页可点、悬停高亮），IK 页 7 靶点圆 + 4 极向量菱形（名字牌 + 琥珀连线），FK 页 17 关节圆（头 / 脊柱 / 手 / 脚带名字牌）
> ActionClipInspector.tsx: 动作片段：副轨禁用横幅 + 一键启用；「片段属性」：骨骼姿态 N 帧 / 动作姿态下拉（改名「动作·X」）+ 开始 / 结束 滑条（F 帧读数）+ 持续时长；「播放头时间裁剪」裁前 / 裁后；删除片段
> LookAtClipInspector.tsx: 视线片段（目标类型 / 目标 / 部位 / 上下注视 / 高度偏移 / 缓入缓出 / 限幅角 / 强度 / 裁剪 / 删除；副轨旁路「一键启用」）
> BoneKeyframeInspector.tsx: 骨骼关键帧（帧读数、写入提示、删除）
> CameraInspector.tsx: 机位：摄影机（机位名称）→ 镜头参数（常用焦段 4×2「NNmm + 用途」+ 焦距微调 12–300mm 滑条 + 垂直 FOV 读数）→ 空间变换 → 射线指示与视锥；进 / 出视角只住画中画，rig / 看向没有 UI
> CloseupClipInspector.tsx: 特写片段：「特写片段属性」所属机位 / 跟踪目标（除组外全部物体）/ 锚点 / 开始·结束滑条（F 帧号）/ 持续时长 → 「取景」朝向 / 方位 / 水平角 ±180 / 俯仰角 ±89 → 「机位运动」距离 0.3–20 / 高度 −2–5 / [自定义锚点 X/Z ±3 Y −1–3] / 运镜预设 → 「播放头时间裁剪」→ 转为路径 · 删除片段（确认弹窗）；不提供分割，custom 方位没有角度输入
> LightInspector.tsx: 灯光（启用/可见/锁定、颜色 + 色温预设、强度、聚光锥角/柔化、距离/衰减、阴影、位置、朝向 + 4 快捷朝向）
> PrimitiveInspector.tsx: 几何体（名称、材质六项、辅助物体、变换）/ 组 · 泼溅 · 用户模型（名称、变换）
> SceneLayerInspector.tsx: 图层配置（天空色、标签、网格/地面/吸附、全局变换、全景半径/旋转/清除）
> TimelineSelectionCards.tsx: useTimelineSelectionCard：按选择态（优先级：批量路标 → 单路标 → 路径 / 特写 / 骨骼关键帧 / 动作 / 视线片段）给出「标题 + 唯一一张卡」，ContextInspector 整块替换实体检查器
> TrajectoryClipInspector.tsx: 路径片段（所属实体、开始/结束/时长、裁掉前段/裁掉后段、分割、删除）
> WaypointAimField.tsx: 单/批路标共享目标选择，排除自身与组，空值代表自由朝向
> WaypointCard.tsx: 单路标（帧、位置、水平/俯仰/横滚、看向目标一次烘角、删除）
> BatchWaypointsCard.tsx: 多选路标（范围、逐帧对准目标、独立俯仰/横滚微调与归零、批量删除）
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
