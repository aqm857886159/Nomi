# director/scene/
> L2 | 父级: ../CLAUDE.md
> 导演台 V2 的 three / R3F 世界：store 是真相，这里只是投影；每个子系统一个文件，命令式接口经 ViewportApiContext 暴露给 DOM 面板。
> 成员清单
> DirectorCanvas.tsx: 装配根：FencedCanvas（frameloop always、阴影、上下文丢失恢复）+ 全部子系统 + drei 视图立方；录制中消费视图立方点击以阻止跳视角
> SceneRegistryContext.ts: 运行时对象表注入（id ↔ Object3D）
> sceneRefs.ts: 对象表（实体/双脚吸附/出片渲染器登记）、实体/editor-only/拾取层/路标/IK/骨骼标记与反查；isWorldVisible 沿 three 父链，isDirectorObjectVisible 沿工程父链与图层判可见，标签/拾取/portal 骨架共用
> sceneTheme.ts: 世界内颜色单一真相（主题网格/天空、相机四态色 + 机身色、骨骼层三链色 + 关节黄 + 把手琥珀、动作预览色、角色色板、陶土色）
> webglContextRecovery.ts: WebGL 上下文丢失恢复（lost 必须 preventDefault 才有 restore；restore 后手动重绘一帧；切换门从 V1 入籍）
> viewSettings.ts: 自由相机归位位姿 (0,1.7,10)、漫游 / 灵敏度默认值与滑条范围（漫游 5 m/s 0.5–30、转向 1 rad/s 0.2–5、灵敏度 1 0.1–3、阻尼 0.15 0.02–0.5）、本机偏好（视口设置 + 主题）localStorage 读写（读时越界夹回）
> cameraMath.ts: 机位朝向四元数（YXZ，yaw 从 +Z 起）与 three 相机 180° 翻转
> ViewCamera.tsx: OrbitControls 与 WASD/EQ/方向键共用输入归属，逐帧阻断粘键；WASD 保持世界高度、方向键绕 Orbit target 转；自由视角⇄POV 保存恢复，机位世界↔图层局部转换后按编辑层写回，拒绝写入立即恢复；连续手势一次历史，画幅 FOV 补偿共用 cameraLens
> PipRenderer.tsx: 画中画：机位图层局部位姿转世界，同一画布 scissor/viewport 内嵌渲染；finally 恢复辅助物可见性与渲染状态
> pipCamera.ts: 画中画选台规则（播放 / 录制 = 节目机位；停止 = 手动指定 → 播放头处节目机位 → POV 机位 → 选中机位 → 第一台）+ PipRect 类型，渲染与外壳共用
> E2EBridge.tsx: E2E 取证桥（localStorage __nomiE2E=1 才挂 window.__nomiDirectorE2E）：按对象名（可限定实体子树，骨名跨角色同名）/ 世界坐标投影成画布客户区像素、读世界朝向、按前缀列对象、列 editor-only 旗标对象（验证 gizmo / 把手不进成片），走查用来精确点 three 内物体（把手 / 路标）与验证视线
> ViewportApiContext.ts: DOM 面板 ↔ 视口的命令式接口类型与 hook（归位 / 聚焦 / 取视角 / 套视角 / 禁 Orbit / 地面拾取 / 角色双脚吸附调用 / captureFrame 出片一帧 / 视口尺寸；处理器登记在 sceneRefs 对象表）
> TransformGizmo.tsx: drei TransformControls 挂选中实体（controls 打 editor-only 旗标，把手不进截图 / 出片 / 画中画），经 write*SpatialTransform（编辑层三态）写回，拖拽期间禁 Orbit；灯只平移、机位 scale 降级 translate；选中 IK 把手 / 骨骼时让位给 SkeletonHandles 的 gizmo
> useViewportPicking.ts: 左键点选（≤5px，只认自己接到的 down+up 一对，创建模式占用的点击整体让出）射线拾取对象/机位/灯/路标小球；蒙皮网格不进候选（角色靠拾取图层上的胶囊代理），锁定/隐藏不可拾取，点空白清选；IK 把手（第一遍按类不按距离：路标 → 把手 → 骨骼球；把手贴着骨骼球时把手赢）命中 = 选把手 + 切 IK，骨骼球命中 = 选骨 + 切 FK
> TrajectoryVisuals.tsx: 路径曲线与可点路标通过完整父组矩阵挂图层变换组；与求值共用采样；画笔/逐点 ghost 保持世界空间
> SelectionOutline.tsx: EffectComposer + OutlinePass 半分辨率描边；接管 R3F 渲染出口
> LabelProjector.tsx: 复用 characterLabel 的真实头顶世界锚点和祖先可见性；投影差 >0.5px 才通知 DOM
> useTimelinePlayback.ts: 每帧吃 pendingSeek、推进播放头，对象按路径求值，机位按 特写（目标当前位姿）> 路径 > 静止 再叠 rig/看向，写到 Object3D / evaluatedPoses；录制中的机位跳过
> environment/: 天空、网格、地面、基础环境光（S5 加全景球与 Spark 泼溅），见 environment/CLAUDE.md
> entities/: 各类实体的 three 物化（几何体 / 角色 / 灯 / 机位 / 树装配），见 entities/CLAUDE.md
> creation/: 放置角色与画框两种创建模式的 hook + 幽灵体，见 creation/CLAUDE.md
> character/: 角色骨骼系统（每帧管线 / CCD IK / 视线 / IK 把手），见 character/CLAUDE.md
> capture/: 出片（机位相机构造、V1 captureScene、标签合成、渲染器登记），见 capture/CLAUDE.md
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
