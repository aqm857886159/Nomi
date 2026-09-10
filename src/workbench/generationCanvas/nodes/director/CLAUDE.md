# nodes/director/
> L2 | 父级: ../../ENTRY.md（生成画布代码入口图）
> 导演台：Nomi 唯一的 3D 导演台，独立节点类型 `director`（方案 docs/plan/2026-09-02-director-console-v2.md；切换门 docs/plan/2026-09-03-director-cutover-gate.md 之后 V1 `scene3d` 已删，老节点在画布快照加载时经 migration/ 迁成 director）。
> 自给自足：假人骨架数学 / 姿态预设 / 资产 URL / 落盘桥 / 上下文恢复都在本目录（切换门时从 V1 入籍），不依赖任何 V1 路径。
> 第三方：@sparkjsdev/spark 2.1（泼溅渲染，three ≥0.180，WASM 内联）。
> 依赖方向：panels/timeline/scene → model；model 不 import React/THREE；panels/inspector 可调 timeline/timelineCommands（命令层零 React）。产物只存资产句柄。
> 成员清单
> useMobilePreview.ts: 复用 captureFrame 与认证手机桥发送最长480px监视帧；单帧在途/大小上限/迟到帧丢弃，录制状态只回桌面真相
> DirectorNode.tsx: 画布节点卡片（顶层节点组件，注册于 nodes/registry.ts）：统计/入连摘要 + 连线引用列表（全景节点 → 全景；资产节点按后缀分泼溅/模型）+ 打开按钮 + 「发送到画布」落成 Image / Video 节点并连 reference 边；节点 meta.directorProject 的唯一读写点；关闭即落盘
> DirectorEditor.tsx: 全屏壳（portal + role=dialog + FULLSCREEN_Z_INDEX + Windows 让开自绘窗口栏，顶偏移取 ui/app-shell/windowChrome 的 currentFullscreenOverlayTopOffset —— 那条 32px 是系统拖拽带，盖住它顶部控件整条点不动、窗口控件也埋在下面，见 docs/fixes/2026-09-04-fullscreen-overlay-windows-windowbar.root-cause.json）：创建/注入 store、注入连线引用（LinkedAssetsContext）/ 画布图片（CanvasImagesContext）与产物动作（OutputsContext）、持有角色放置与画框两个创建模式并经 CreationModeContext 下发（视口要指针路由与 ghost、顶栏「＋添加」要发起，只调一次 hook）、悬浮顶栏五簇（panels/topbar）压在视口 / 时间轴 / 右栏嵌套分栏之上、退出确认、2s 空闲自动保存、Esc 归属（捕获期监听，壳根节点会 stopPropagation：模式 → 清工具 + 清全部选中→ 退 POV → 退出确认）；本机偏好（scene/viewSettings 读写）喂给视口，设置 / 帮助对话框挂在壳上
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
> useAiSceneBuilder.ts: AI 搭场景编排：描述 + ≤3参考图经文本大脑生成 JSON；请求身份贯穿模型/存库 await，发起时固定目标图层，取消/reset/卸载拒绝迟到响应；先存场景资源，再由 store 将几何和资产句柄一次物化/撤销；无桥时用 E2E fixture 或明示缺模型
> model/: 纯层（schema、时间格、片段几何、编辑层、路径求值、特写运镜、节目机位、镜头、预设、灯光、快捷键、rig、IK 链、store），见 model/CLAUDE.md
> scene/: three / R3F 世界（画布、相机、实体、gizmo、描边、拾取、创建模式、标签、播放求值），见 scene/CLAUDE.md
> panels/: DOM 面板（顶栏五簇 topbar/ 是唯一常驻控件条，2026-09-09 收掉了视口左缘创建栏 / 底中底栏 / 右下显示模式三条，见 docs/plan/2026-09-09-director-chrome-five-clusters.md；右栏大纲/资产库/检查器、字段原语、分栏、浮层），见 panels/CLAUDE.md
> timeline/: 片段时间轴，见 timeline/CLAUDE.md
> 开发入口: 仓库根 director-lab.html → src/devlab/directorLab.tsx（仅 dev，脱离画布挂全屏壳）
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
