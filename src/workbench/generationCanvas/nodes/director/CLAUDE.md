# nodes/director/
> L2 | 父级: ../../ENTRY.md（生成画布代码入口图）
> 导演台：Nomi 唯一的 3D 导演台，独立节点类型 `director`（方案 docs/plan/2026-09-02-director-console-v2.md；切换门 docs/plan/2026-09-03-director-cutover-gate.md 之后 V1 `scene3d` 已删，老节点在画布快照加载时经 migration/ 迁成 director）。
> 自给自足：假人骨架数学 / 姿态预设 / 资产 URL / 落盘桥 / 上下文恢复都在本目录（切换门时从 V1 入籍），不依赖任何 V1 路径。
> 第三方：@sparkjsdev/spark 2.1（泼溅渲染，three ≥0.180，WASM 内联）。
> 依赖方向：panels/timeline/scene → model；model 不 import React/THREE；panels/inspector 可调 timeline/timelineCommands（命令层零 React）。产物只存资产句柄。
> 成员清单
> useMobilePreview.ts: 复用 captureFrame 与认证手机桥发送最长480px监视帧；单帧在途/大小上限/迟到帧丢弃，录制状态只回桌面真相
> DirectorNode.tsx: 画布节点卡片（顶层节点组件，注册于 nodes/registry.ts）：统计/入连摘要 + 连线引用列表（全景节点 → 全景；资产节点按后缀分泼溅/模型）+ 打开按钮（`open` 本地 state，编辑器经 GenerationPageLayer 挂进生成页那一格）+ 「发送到画布」落成 Image / Video 节点并连 reference 边；节点 meta.directorProject 的唯一读写点；关闭即落盘
> DirectorEditor.tsx: 导演台页面根（2026-10-29 起是生成页里的一块：根 size-full 铺满所在容器，由 DirectorNode 经 generation/pageLayer 的 GenerationPageLayer 挂进画布那一格；版面归 GenerationWorkspace 的网格，这里不读 Agent 形态也不算偏移，不再有 portal / FULLSCREEN_Z_INDEX / 顶偏移——页格本来就在顶栏之下，Windows 那条 32px 拖拽带的场景由构造保证，见 docs/fixes/2026-09-04-fullscreen-overlay-windows-windowbar.root-cause.json；藏着（切页 / 列表视图，useGenerationPageLayerActive 为假）时 Esc 监听摘掉、暗色锁释放、录制中的运镜放弃，快捷键 / 视口漫游 / 3D 渲染循环在各自的家里跟着停）：创建/注入 store、注入连线引用（LinkedAssetsContext）与产物动作（OutputsContext）、持有角色放置与画框两个创建模式并经 CreationModeContext 下发（视口要指针路由与 ghost、顶栏「＋添加」要发起，只调一次 hook）、悬浮顶栏五簇（panels/topbar）压在视口 / 时间轴 / 右栏嵌套分栏之上、退出确认、2s 空闲自动保存、Esc 归属（捕获期监听，壳根节点会 stopPropagation：模式 → 清工具 + 清全部选中→ 退 POV → 退出确认）；本机偏好（scene/viewSettings 读写）喂给视口，设置 / 帮助对话框挂在壳上
> DirectorViewShell.tsx: 导演台的默认面「导演视图」（2026-10-16 起 3D-BOX 是唯一的导演台）：顶栏 [← 工程名 · 镜头 N] [导演 | 精修] [撤销 重做][出成片 ▾]（顶栏件取 panels/topbar/shellChrome）+ 视口（小窗左下说正在播哪一镜）+ 只读镜头条
> DirectorRefineShell.tsx: 精修「选中才出」布局（导演台的「精修」面）：视口满宽 + RefineTopBar + 选中才出的 ContextCard + 左侧资产库抽屉 + 原时间轴
> DirectorEditorContext.ts: DirectorStoreContext + useDirectorStore(selector) / useDirectorStoreApi()
> useDirectorHotkeys.ts: 区域感知快捷键分发；isDirectorKeyboardBlocked 与持续漫游共用文本/浮层/IME/已消费输入守卫；工具、历史、分组/解组/删除/克隆和骨骼 W/E，处理器 false 让位；多选命令一次事务，克隆只处理 selectedRoots
> useCameraMotionRecorder.ts: 录制运镜（DOM 侧 rAF 采样世界位姿，转图层局部样本；ghost 保持世界坐标；推进播放头并自动延长时间轴，停止交 store 简化成关键帧）
> CameraRecorderContext.ts: 录制器注入（POV HUD / 快捷键 / 时间轴 Space 共用同一个录制器实例）
> useMobileCamera.ts: 手机虚拟相机编排：IPC 起停局域网桥，32 字节包基于视口世界位姿积分，经 transformCameraPose 逆转图层局部后按编辑层写激活机位；录制中只 applyViewPose；手动输入可撤销地解除看向/rig，远程录制回桌面真相，速度本机持久
> MobileCameraContext.ts: 手机桥注入（POV HUD「连接手机」/ 二维码对话框共用同一个实例）；编辑器卸载即停服务
> useDirectorOutputs.ts: 出片编排：MP4 独占任务锁跨采帧/编码/登记，取消、卸载或换层丢弃迟到结果，finally 释放锁且仅同场景恢复播放头；截图检查 mounted 后登记桌面持久句柄，无桥时明确为本会话 blob；编码 IPC 没有硬取消
> bridge/: 桌面运行时接缝（截图落盘 / 帧转视频），见 bridge/CLAUDE.md
> agent/: AI 来导（create_staging_reference / create_camera_move 的建节点入口 + 离屏出片器 + 两个常驻 Host），见 agent/CLAUDE.md
> migration/: V1 scene3d → director 单向迁移与 V1 数据化石（AI 来导的 builder 也经这里落成工程），见 migration/CLAUDE.md
> OutputsContext.ts: 产物动作注入（时间轴头部按钮 / 产出弹层 / 快捷键共用同一个实例）
> directorEditorPersistence.ts: 编辑器 store ↔ 节点 meta 写回的唯一 owner（createDirectorEditorPersistence）：编辑器开着时 store 是唯一写者，记住自己写出去的每一份；节点 meta 被换成别的（撤销补偿放回）就当场重载；空闲 2 秒落盘，没改动不写
> directorSessionRegistry.ts: 开着的导演台会话登记处：按节点 id 登记 store，外部写入（writeExternalDirectorProject）交给开着的编辑器，镜头焦点的读 / 订阅 / 清除也经这里
> directorShotFocusSession.ts: 一个开着的导演台的「正在改：镜头 N」读口（createEditorShotFocusSession）：把编辑器 selection 投影成计划镜头，按（工程引用、选中、修订号）缓存
> useDirectorShotFocus.ts: 镜头焦点的 React 订阅口（useSyncExternalStore 读会话登记处），给 Agent 输入框上的「正在改：镜头 N」标签
> model/: 纯层（schema、时间格、片段几何、编辑层、路径求值、特写运镜、节目机位、镜头、预设、灯光、快捷键、rig、IK 链、store），见 model/CLAUDE.md
> scene/: three / R3F 世界（画布、相机、实体、gizmo、描边、拾取、创建模式、标签、播放求值），见 scene/CLAUDE.md
> panels/: DOM 面板（顶栏五簇 topbar/ 是唯一常驻控件条，2026-09-09 收掉了视口左缘创建栏 / 底中底栏 / 右下显示模式三条，见 docs/plan/2026-09-09-director-chrome-five-clusters.md；右栏大纲/资产库/检查器、字段原语、分栏、浮层），见 panels/CLAUDE.md
> timeline/: 片段时间轴，见 timeline/CLAUDE.md
> 开发入口: 仓库根 director-lab.html → src/devlab/directorLab.tsx（仅 dev，脱离画布、自己摆一格铺满窗口的容器挂编辑器）
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
