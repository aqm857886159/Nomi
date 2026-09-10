# director/panels/viewport/
> L2 | 父级: ../CLAUDE.md
> 视口的 DOM 侧：容器负责指针路由（创建模式优先于拾取）与悬浮作用域，叠加层全部 pointer-events:none。
> 成员清单
> DirectorViewport.tsx: 视口容器：DirectorCanvas + 标签层 + 放置/画框 HUD + 画中画 + POV 卡片 + 底部中央 AI 搭场景（折叠即入口）；视口上不再有控件带（2026-09-09 三条浮层并入 topbar/）；角色放置 / 画框经 props 由壳传入，本地只持有画线；hoveredRef/scopeRef；拥有创建模式互斥、首次激活 HUD、Esc 优先取消和 Orbit 占用，并向壳登记取消处理器
> ViewportToolbar.tsx: 顶栏第三簇「工具」（选择/移动/旋转/缩放 ｜ 画线/逐点）；由 topbar/DirectorTopBar 装配，重置视角归视图簇、退出归交付簇；切工具经 onCancelCreation 取消已有创建，再设置 transform/draw 模式；模式状态与 Orbit 所有权在 DirectorViewport
> ViewportOverlays.tsx: ViewportLabels（角色名标签）、PlacementHud（放置/画框提示条）、PathDrawHud（画线/逐点提示条）、ModeChip（模式胶囊原语）
> AspectGuide.tsx: 机位视角 + 画幅非 free 时的导出取景框（四周 80px 内边距装框、SVG mask 压暗框外并给画中画挖洞、四角圆角括号、三分线、右上画幅徽标、右下导出像素徽标），自己量视口尺寸；与 ViewCamera 的 FOV 补偿共用 frameGuideSize
> CameraPovHud.tsx: 视口左下 POV 卡片：「机位视角 [POV] ×」/ 机位名·焦距 / FOV·写入层 / 红色「录制运镜 (R)」·完成录制 / 连接手机虚拟相机（已连接显示延迟），录制中红点计时
> PipViewport.tsx: 画中画外壳（默认左上：机位下拉 · mm · 画幅 chip / LIVE / 折叠、透明画面区量矩形给 PipRenderer、进入·退出机位 + FOV、拖标题移动、拖角缩放 160–520，默认 280），布局持久 localStorage（nomi:director:pip:v2）；整次 DOM 提交后测量，显示/折叠/机位生命周期统一清理矩形和观察器
> PipViewport.test.ts: 执行真实外壳组件，验证冷挂载父 ref、初始隐藏后显示、隐藏重显、首个机位、尺寸变化、折叠与卸载的矩形/观察器归属
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
