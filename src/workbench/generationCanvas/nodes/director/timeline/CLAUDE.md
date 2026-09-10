# director/timeline/
> L2 | 父级: ../CLAUDE.md
> 片段时间轴（30fps、≤60s）。行序、命令、几何三份真相各一处：行序来自 model/timelineTracks，命令全部在 timelineCommands（头部按钮 / 右键菜单 / 快捷键三入口共用），像素↔秒换算在 useTimelineViewport；拖拽只做本地预览、松手才写 store。
> 成员清单
> DirectorTimeline.tsx: 导出 TIMELINE_COLLAPSED_PX / TIMELINE_EMPTY_PX 两个高度契约给壳钉分栏（头部 h-9；空态 = 头部 + 轨道列头 h-[26px]）。空态（一个实体都没入轴）只留那一条：左边提示、右边保留完整的「轨道列表 ｜ + 添加轨道 ▾」——收掉它就把「怎么把东西放上时间轴」这条主路径做成了死胡同。装配根：头部 + 左轨道列（列头 + 行）+ 右标尺/泳道/播放头（同一行序、同步纵向滚动）+ 三层上下文右键菜单 + 主行「+」追加片段菜单（内置动作 = 4s、名「动作·X」 / 骨骼姿态 / 视线注视 / 特写 / 追加路径）；折叠只留头部；无轨道时泳道区居中两行空态；片段条文案：「路径片段 起~止」「特写片段 起~止」「动作·X」，特写参数只住检查器
> TimelineHeader.tsx: 头部：▶ ■ ｜ 帧读数「F 帧 / 秒s」（两数各 4ch 右对齐）｜ 自动帧 ｜ 吸附 ｜ 倍速 0.25×–2.0× ｜ 缩放三件 ｜ … ｜ 录制 MP4 ｜ 插入关键帧 (I) ｜ 折叠（截图 / 产出住视口底栏）
> TimelineRuler.tsx: 标尺：刻度永远铺满 60s；主刻度 = 步长表首个 ≥72px 的档、次刻度首个 ≥10px（默认 36px/s → 2s 一格 / 0.5s 小格）；标签 10px 等宽贴主刻度右侧顶对齐，线贴底；按下即 seek / 拖动刷帧
> TimelinePlayhead.tsx: 播放头：11×15 墨色头块 + 1px 竖线贯穿标尺与泳道，单独订阅 currentTime
> TrackList.tsx: 轨道列（28px 行）：列头「轨道列表 (N) ｜ + 添加轨道 ▾」+ 主行（拖序把手 / 类型图标 / 名字 / 角色行「追加片段 +」/ 角色·机位行「创建特写片段」/ 切割 / 钉住 / 删除；机位行双击进视角；选中实体整行变色）+ 树形副行（竖线 x=20 横枝 20→30，骨骼帧二级缩进；动作 / 视线：旁路眼睛 + 清空；骨骼帧 / 空间轨迹：‹ ◇ › 导航，◇ 在播放头落在关键帧上时点亮）
> TrackLanes.tsx: 泳道：主行画路径 + 特写片段条 + 末尾「+」追加路径（最后一段 +0.1s 处，余量 <0.5s 不给），空间轨迹 / 骨骼帧副行画 10px 菱形（未选轨灰缩、选轨 key-path / key-bone、点选墨色放大、骨骼激活 key-active）+ 按片段分组的 2px 连线；片段争位置按 model/timeGrid laneClips 的单泳道规则（机位路径 ∪ 特写）；片段拖移 / 拖边 / 菱形拖时（吸附候选）都在这里，右键交上下文菜单；pointercancel 丢弃预览，空行点选 seek，框选支持 Shift 累加
> ClipBar.tsx: 片段条：20px 高、顶 3px、圆角、等宽居中标签继承片段前景色；完整状态交 clipToneClass；两端 10px 命中区中画 4px 白色拖柄，只在该把手悬停时变 5px；左右把手命中区判定
> clipTone.ts: 片段完整状态配色单一真相 clipToneClass（tailwind.config 主题无关 token `--nomi-clip-*`）：五类普通/hover 的底色与浅色文字成对；选中=本家族实色+白字白边，优先于 active；active 只作用于路径（95% 底色+cyan-50 字+青边），不继承普通 hover；同时导出拖拽区类型
> TimelineContextMenu.tsx: body 传送门 + fixed 定位的右键菜单原语（贴窗口边缘回折；外点 / Esc 关闭，data-nomi-escape-layer）
> timelineRows.ts: 行模型：主行泳道放路径片段 + 机位的特写片段；副行只在有内容时长出，顺序 动作 → 骨骼帧 → 视线 → 空间轨迹（路标菱形住这一行，不画在片段上）；折叠只出主行；行高固定
> timelineCommands.ts: 零 React 命令层：播放 / 步进 / 跳端点 / 选片段路标 / 插帧 / 复制粘贴紧贴复制 / 左右剪切 / 分割 / 删除，拒绝原因用 i18n key 回传；复合命令一次历史，剪切按选中片段家族，插帧遵从共享机位泳道与关键帧采样
> useTimelineViewport.ts: 视口几何：默认 36px/s、时间 0 在 12px、泳道总宽恒 12 + 60s×scale、最小 scale = 60s 铺满视口、最大 600；按钮 ×1.2 / Ctrl+滚轮 ×1.12 围绕光标；「适应」= 最小 scale 滚到 0
> useTimelineHotkeys.ts: 时间轴 + 全局键位 → 命令层；没选片段时返回 false 让 Backspace / Cmd+D 落回编辑器默认
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
