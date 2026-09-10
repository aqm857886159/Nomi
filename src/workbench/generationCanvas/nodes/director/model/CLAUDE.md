# director/model/
> L2 | 父级: ../CLAUDE.md
> 导演台 V2 的纯层：零 React / 零 THREE，全部可在 node 单测里跑。渲染层与面板只消费这里的求值与判定，不各自算。
> 成员清单
> assetFolders.ts: 资产目录祖先链与目标可移动性共用判定；拒绝父环，折叠搜索保留命中祖先
> rigs.ts: rig无关的语义骨映射、体形预设、关节轴文案键，骨架操作共用
> ikChains.ts: IK靶点/极向量/骨盆胸腔配置与真实骨名解析
> directorTypes.ts: V2 工程 schema+ 资产库（文件夹 / 条目只存句柄）+ 连线引用类型、字面量联合、isDirectorCamera
> directorIds.ts: id 工厂（时间戳 + 随机后缀，前缀 d*，与 V1 不撞）
> directorNodeMeta.ts: 画布节点 meta 键单一真相（DIRECTOR_NODE_KIND、directorProject、stagingAutoCapture、cameraMoveAutoCapture）：节点卡片 / 迁移器 / AI 来导 / 画布壳的 Host 门都从这里取，零依赖
> directorProject.ts: 默认工程/图层、normalizeDirectorProject / normalizeScene（unknown → 合法工程 / 图层，逐字段容错，含资产库）、remapSceneIds（图层复制与导入场景共用换 id）、clone、projectStats
> directorStore.ts: zustand vanilla store 工厂：编辑期真相、互斥选择及子选择归属、完整工程50步撤销、图层操作；withHistory 同步嵌套事务一次入栈且异常回滚，commitProject 是工程唯一写入口；组装各 action 集
> storeEntityActions.ts: 对象/机位/灯 CRUD、分组解组群众、跨图层复制移动、显隐锁定、经编辑层的 write*SpatialTransform
> storeClipActions.ts: 路径片段与路标、特写片段、动作片段与骨骼关键帧、视线片段、副轨开关、POV 进入判定（拒绝原因为 i18n key）
> timeGrid.ts: 30fps 帧格与「内容终点 = 片段末尾」单一真相：quantizeToFrame / sceneContentEndSeconds / ensureDurationSeconds；laneClips = 单泳道集合（机位路径 ∪ 特写争同一段时间、角色各家族只跟自己争），放置 / 拖移 / 拖边 / 粘贴争位置都用它
> vec3.ts: 零依赖向量数学；lookAtAngles（yaw 从 +Z 起、pitch 正=俯视）、wrapDeg 0–360 / signedDeg ±180（相对转角必须用后者）、eulerXYZToMatrix / applyTransform（等价 three compose）
> sceneObjectGraph.ts: 纯仿射矩阵/逆变换与子树边界；分组、解组、跨层、创建落点共用，重新挂载同时变换 rest 与所有路标
> evaluatedSceneObject.ts: 对象及每级祖先按时间求值，输出完整场景局部 frame/位置/前向水平角；实时机位、特写烘焙、角色视线共用，sceneConfig 全局变换由消费层添加
> cameraCoordinateSpace.ts: 零 React/THREE 的相机逻辑 YXZ 位姿矩阵转换，保留逻辑 FOV，不含 three 相机 -Z 翻转；POV/手机/录制/预览/截图/跨层共用
> clipKeyframes.ts: 片段编辑的共享关键帧采样与重映射；拉伸按比例，裁剪/分割采样边界并保持两段独立
> cameraLens.ts: 竖直 FOV ↔ 焦段 mm（24mm 片高，12–300mm），fov 是真相；exportAspectRatio；取景框 frameGuideSize（四周 80px 内边距装画幅）+ POV 的 FOV 补偿 povVerticalFov（fov' = 2·atan(tan(fov/2)·H/框高)）；8 档常用焦段
> cameraPresets.ts: 14 个机位预设（主体局部空间坐标，吃主体旋转 / 缩放）+ buildCameraFromPreset（只给位姿不挂看向；「当前视角」= 自由相机位姿 + round(fov)）
> lights.ts: 三种灯默认位姿/强度、7 色温预设、4 快捷朝向、createLight
> hotkeys.ts: 默认键位单一真相（视口/时间轴/全局作用域）+ matchesHotkey / formatHotkey（meta = ⌘/Ctrl）；ikMode / fkMode（W / E，仅骨骼页聚焦时生效）
> clips.ts: 片段几何：找空位（fitClipAt 点哪儿落哪儿：塞不下缩到空档、点在片段里才退到下一空位）、重叠、左右边界、裁剪/分割/紧贴复制、路标归属、upsertWaypointAt、路标拖动夹紧
> editLayer.ts: 编辑层三态 rest / keyframe / evaluated-readonly（词表 owner）+ findTrajectoryClipAt / findWaypointAt
> waypointAim.ts: 单/批路标按各自时间采样目标，转源父空间并按对象XYZ/相机YXZ烘焙朝向；目标metadata只记选择，非动态跟踪
> trajectoryEval.ts: 路径求值：片段内 Catmull-Rom/线性采样 + 最短弧角度插值，片段后 hold，否则 rest
> closeupRig.ts: 目标相对自动运镜：锚点/方位/8 种运镜预设 → 机位位姿；findCloseupClipAt
> programCamera.ts: 节目机位：按轨道顺序取有片段覆盖 t 的第一台，否则黑场
> pathTools.ts: 手绘路径按弧长重采样（≤200 点）+ 按弧长分配时间
> recordingSimplify.ts: 录制运镜采样闸 + 样本→关键帧简化阈值
> storeTimelineActions.ts: 时间轴级动作：画路径模式 / 剪贴板（瞬态）、入轴/移出、整段平移（路标骨骼帧同移）、粘贴 / 紧贴复制、播放头插帧、批量写路标
> timelineTracks.ts: 轨道视图求导：入轴实体顺序（钉住优先 + timelineTrackOrder）、每轨副轨/片段/关键帧视图、上一下一关键帧、片段端点跳转
> timelineSnap.ts: 吸附候选（片段边缘 / 路标 / 播放头）+ 像素容差换算 + 最近吸附
> timelineClipboard.ts: 片段剪贴板：复制载荷（路径带路标、姿态带骨骼帧）、粘贴兼容规则、平移换 id
> storeCameraActions.ts: 机位级动作：进出 POV（受 canEnterCameraPOV 门）、Shift+A 固化当前视角为「机位 N」、角色轨 / 机位轨创建特写（建完选中机位 + 那段特写）、录制运镜起 / 停 / 放弃（简化成关键帧）、特写烘焙成路径（固定 12 个等距样本）
> exportSize.ts: 出片尺寸与帧数单一真相：分辨率档给短边、画幅比给宽高比（free = 视口比）、宽高取偶；30fps、总帧 = 内容末 × 30、上限 1800
> storeOutputActions.ts: 产物动作：截图 / 视频增删（只存资产句柄）、录制进度瞬态
> aiScene.ts: AI 搭场景纯层：zod 契约（sceneName / sceneConfig / groups[elements]）、容错解析（剥围栏抓 JSON）、类型名 → 八种几何体、旋转弧度启发式（全部 |r| ≤ 2π）、提示词模板、固定夹具「街角咖啡馆」
> storeAiSceneActions.ts: AI 场景物化：当前图层固定为请求发起层并校验仍存在，或创建/激活新图层；几何分组与可选资产句柄在同一工程事务落下，一次撤销
> assetKinds.ts: 资产类型判定单一真相（后缀 / MIME → model / splat / panorama / scene）+ 上传 accept 串，资产库与连线引用共用
> storeAssetActions.ts: 资产句柄/目录增删改移共用历史；目录移动防环，删目录子项回上级、上传目标失效归根；场景导入先辨 AI groups 或工程 objects/cameras/lights，拒绝无关 JSON，物化/换 id 后新增图层
> splatReveal.ts: 泼溅显现纯参数：效果 id / 默认随机池 Magic|Spread / ×2 倍速 / 尾停 1s / 按半径与最低点推着色器时长 / 三次缓出
> mobileCamera.ts: 手机虚拟相机纯数学：32 字节 Float32 包编解码、摇杆/升降按 2m/s·1.5m/s 积分、陀螺仪增量累加、焦距换算；electron 桥与渲染层共用
> storeCharacterActions.ts: 角色骨骼级动作：单骨写入 / 合并 / 拖动逐帧写、全部复位（清微调 + 骨盆归零，保留预设）、复位此肢体（按把手清对应骨）、左右镜像（{x,−y,−z}，源侧空则清目标侧）、播放头对齐骨骼关键帧、姿态预设（切换清全部微调）、快捷体形、骨盆偏移、片段改名 / 换动作
> posePresets.ts: V1 手写静态姿态化石（切换门入籍，只给迁移 / AI 来导词表用）：PoseVec3、MANNEQUIN_POSE_PRESETS（预设 id → 逐骨欧拉偏移）、findPosePreset / presetPoseRotations；V1 的「自然站姿基线」已删（x-bot rest 就是 Mixamo bind，复位 = 纯 bind）
> actionLibrary.ts: 动作库单一真相（= 动作清单 + 别名表）：T-Pose + 9 个 Mixamo FBX 动画（站立 / 站立到单膝跪 / 单膝跪 / 跪起身 / 行走 / 跑 / 普通坐姿 / 坐地上 / 双膝跪），同一份清单既是动作片段可选项也是角色静止姿态预设（posePreset）；循环 / 静态由 FBX 时长在运行时判定；LEGACY_POSE_TO_ACTION 给 V1 手写预设找对应动画
> poseBlend.ts: 动作混合纯数学：片段头 0.25s 淡入（上一片段间隙 <0.2s 从其末帧交叉，否则从静止）/ 片段尾不淡出 / 片段外：相邻间隙 ≤0.5s 交叉、否则尾后 0.25s 淡回静止；姿态片段不参与交叉；custom_pose 关键帧对与插值系数
> lookAtSolve.ts: 视线纯数学：片段权重缓入缓出、头部相对身体 yaw/pitch 限幅 + 超限 smoothstep 衰减、颈 0.15 / 脊 0.3 / 头 0.55 分配
> *.test.ts: 与同名模块对照参考数值案例的单测
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
