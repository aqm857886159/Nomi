# 剪辑面表现层逐元素对齐手册（2026-09-05）

## 0. 一句话结论

成熟产品把播放/时间码贴在 Viewer 与 Timeline 的交界或 Timeline 上沿，把剪辑动作留在 Timeline，把连续数值编辑放进常驻 Inspector，把导出固定在顶栏右上；Nomi 的 C′ 应采用 ChatCut 的时间轴控制位置 + CapCut 的右侧属性分组 + Resolve 的紧凑 Viewer/Timeline 分界，预览下只留播放簇、叠加与导出。

证据标签：**源码实读**=OpenCut classic 本地源码；**官方文档**=产品官方帮助/手册；**用户样张**=从提交 `cd206b13b` 提取并目视检查的 `preview-Main.png`；**推测**=由证据推导的 Nomi 建议。用户指定的 `scratchpad/chatcut-user-screenshots-notes.md` 在 `origin/main` 与本 worktree 均不存在，故不冒充用户截图证据。

## A. 播放控件住哪

| 产品 | 直接观察 | 证据 | C′ 启示 |
|---|---|---|---|
| OpenCut classic | `PreviewToolbar` 在预览容器下沿，左时间码、中播放/暂停、右缩放与全屏；Timeline 另有分割/吸附/缩放工具条。 | 源码：`apps/web/src/preview/components/toolbar.tsx:29-53,57-115`；`timeline/components/timeline-toolbar.tsx:53-77` | 两处都有，但语义分开：Viewer transport 与 Timeline edit tools。 |
| ChatCut | 官方明确写“Playback controls **above the Timeline**”，包含 split、snapping、play/pause、time、zoom、画幅、captions、fullscreen。 | 官方文档：`chatcut.io/docs/editor-overview` | 最接近用户已学会的 ChatCut 式；可消除预览下空地。 |
| CapCut 桌面 | 官方指南只公开时间线 Split、右侧 Video/Basic 和顶栏 Export；未公开完整 transport 所在行。 | 官方文档：`capcut.com/resource/how-to-use-capcut-on-pc` | 采用成熟桌面常见的 Viewer 下沿紧贴控制条，细节标未公开。 |
| Descript | View 菜单可显示/隐藏 Timeline；Timeline 有 zoom、fit、volume meter 等工具；未公开完整播放条位置。 | 官方文档：`help.descript.com/descript-tour/view-menu` | 播放与时间线是同一工作区，避免再造第三条长条。 |
| DaVinci Resolve Cut | Cut Viewer 与 Timeline 同屏；官方更新说明 Enhanced Viewer 占上半屏而 Timeline 保留，Viewer toolbar 有 Effects Overlay，trim 控件邻近 transport。 | 官方 PDF：DaVinci Resolve 19 New Features Guide, pp.15–26 | 交界处保留 transport，放大 Viewer 不改变 Timeline。 |

**Nomi 采纳：** 播放、当前/总时码、上一帧/下一帧统一放预览下沿的紧凑 transport；Timeline 上沿只放分割/复制/删除/AI 拼片/撤销重做/缩放/吸附，移除“预览下第二条编辑长条”，即可填掉 C′ 预览下空地。

## B. 时间轴工具栏

### OpenCut 源码逐文件

- `timeline/components/timeline-toolbar.tsx:116-216`：左簇依次为分割（`ScissorIcon`）、分割左（`AlignLeftIcon`）、分割右（`AlignRightIcon`）、源音频连接/分离（`Link02Icon`/`Unlink02Icon`）、复制（`Copy01Icon`）、冻结帧（`SnowIcon`，禁用）、删除（`Delete02Icon`）；竖线后书签（`Bookmark02Icon`）与曲线编辑（`Chart03Icon`）。
- `timeline/components/timeline-toolbar.tsx:264-316`：右簇为自动吸附（`MagnetIcon`）、波纹编辑（自绘 `OcRippleIcon`）；竖线后缩小（`SearchMinusIcon`）—滑杆—放大（`SearchAddIcon`）。
- 中间 `SceneSelector` 是场景下拉 + 图层按钮（`Layers01Icon`）。所有按钮是 tooltip + icon-only，组间用 1px 分隔线。
- OpenCut 这里**没有 lucide 图标**，使用 Hugeicons；导出弹层内部才混用 `lucide-react` 的 `Check/Copy/Download/RotateCcw`（`components/editor/export-button.tsx:22`）。因此不能把“lucide 名称”误写成 OpenCut 事实。

### 五家按钮/分簇对照

| 产品 | 从左到右可核实按钮/动作 | 图标/形态 | 分簇 |
|---|---|---|---|
| OpenCut | Split → Split left/right → link audio → Duplicate → Freeze（禁用）→ Delete → Bookmark → Curve → Snap → Ripple → Zoom−/slider/Zoom+ | Hugeicons 名见上；icon-only、tooltip | 左动作簇 / 书签曲线 / 吸附波纹 / 缩放，竖线分隔 |
| ChatCut | Split、Snapping、Play/Pause、Time、Zoom、Canvas aspect ratio、Captions、Fullscreen | 官方只给语义，不给 DOM 图标名；icon+tooltip 推测 | 播放/时间与剪辑动作在 Timeline 上沿同一行，具体间距未公开 |
| CapCut | Split；Transitions、Filters、Effects、Audio > Music、Captions；Export | 官方只称 Split icon、各 tab；未公开图标名 | 顶部工具/右侧属性/顶栏 Export，桌面完整顺序未公开 |
| Descript | Timeline toolbar 可选 Advanced tools、volume meter、markers/comments/audio pins、Zoom in/out、100%、Fit in view、Fit current scene | 官方未给图标名 | View 菜单控制显隐；高级工具按需出现 |
| Resolve Cut | Smart Insert、Append at End、Place On Top、Close Up、Ripple Overwrite、Source Overwrite；Viewer toolbar 含 Effects Overlay | 官方页面给动作名；未给图标名 | Cut 页按“直接点击得到结果”组织，Viewer/Timeline 同屏 |

### Nomi 最终表（只保留已确认功能）

| 位置（从左到右） | 动作 | Tabler 图标（`@tabler/icons-react`） | 形态 |
|---|---|---|---|
| 「这一段」簇 | 分割 | `IconScissors` | icon-only + tooltip/快捷键 |
| 「这一段」簇 | 复制 | `IconCopy` | 同上 |
| 「这一段」簇 | 删除 | `IconTrash` | destructive hover |
| 「整片」簇 | AI 拼片/按计划编排 | `IconWand`（若包无该导出则 `IconSparkles`） | 带文字 legend，避免黑箱 |
| 「整片」簇 | 撤销 | `IconArrowBackUp` | 无历史时仍渲染并置灰 |
| 「整片」簇 | 重做 | `IconArrowForwardUp` | 同上 |
| 视图簇 | 吸附 | `IconMagnet` | active 有底色 |
| 视图簇 | 缩放− / 适配 / 缩放+ | `IconZoomOut` / `IconViewportWide` / `IconZoomIn` | −、Fit、+，中间可拖滑杆 |

**Nomi 采纳：** 使用一套 Tabler，按“这一段 / 整片 / 视图”三组、竖线分隔；不复刻 OpenCut 的 Split-left/right、冻结帧、书签、曲线和波纹编辑，因为它们不在本轮真实功能清单。

## C. 属性面板解剖

### OpenCut 源码事实

- 面板常驻在主内容右侧：`app/editor/[project_id]/page.tsx:130-206` 的 ResizablePanelGroup 顺序为 Assets → Preview → `PropertiesPanel`，可拖宽度。
- 无选中显示空态；多选显示数量；单选显示按元素类型派生的 tab rail（`panels/properties/index.tsx:18-107`），不是标题色块头。
- 类型 tab 与图标：Transform=`ArrowExpandIcon`、Blending=`RainDropIcon`、Audio=`MusicNote03Icon`、Speed=`DashboardSpeed02Icon`、Masks=`OcShapesIcon`、Effects=`MagicWand05Icon`、Text=`TextFontIcon`（`registry.tsx:34-226`）。
- 值控件：number→可拖拽数值框，boolean→Switch，select→Select，color→ColorPicker，text→Textarea，font→input（`property-param-field.tsx:82-152`）。数值框带 short label、reset、步进/范围；字段为 label 在上、控件在下（`property-param-field.tsx:42-80`）。
- 分组可折叠，标题 44px 行高、下箭头，字段间距 3.5（`components/section.tsx:91-180`）；这是“组标题 + 表单字段”，没有大色块头。

### 对照表

| 项目 | OpenCut（源码实读） | ChatCut / CapCut / Descript / Resolve（官方） | Nomi C′ 结论 |
|---|---|---|---|
| 头部 | 类型 tab 图标竖 rail；空态无选中 | ChatCut 文档只说明可配置面板；CapCut 右侧 Video/Basic；Descript Properties sidebar；Resolve Inspector 与 Viewer 并列 | 常驻标题“属性”，左侧 4px 类型色条 + 小图标 + 对象名；色条是识别锚点，不做大面积色块 |
| 分组 | Transform/Audio/Speed/Blending 等 tab 内 Section | CapCut Basic/Adjustment/HSL；Descript Scene/Layer/Transitions；Resolve Inspector 参数分组 | 固定组序：显示 → 时间 → 声音 → 转场/文字；组标题 32–40px、可折叠 |
| 音量 | OpenCut Audio tab 是 number + Switch；Timeline 还有音量线 | 各家把音频放右侧属性或轨道头；ChatCut 文档写 Volume/ducking/voice isolation | 滑杆 + 右侧数值框（dB）+ 静音开关；淡入/淡出用帧数 stepper |
| 时长/起点 | OpenCut 通用 number field（步进、可拖拽） | Resolve trim 邻近 transport，Descript timeline 直接拖边 | 数值框 + ± 微调；源窗口只读，避免滑杆承担精确时间 |
| 画面/画幅 | Transform number fields；Preview zoom 是 Select（Fit/百分比） | CapCut Video/Basic；Resolve Inspector/Viewer | “适应/填充”分段控件 + 缩放 slider/数值 + 重置；整片画幅在无选中属性组 |
| 折叠/对齐 | Section 下箭头、label 上控件下 | 各家均为分组面板，细节未公开 | 统一 12px label、控件右对齐、行高 32–36px；只折组，不折单行 |

**具体质疑：头部该不该有色块/图标？**

- **图标：该有。** OpenCut 用 tab 图标区分 Transform/Audio/Text；CapCut 用 Video/Basic 等类型导航；小图标能让用户沿行业语义定位。
- **色块：只要窄色条，不要整块彩色标题。** 样张 `preview-Main.png` 的属性头已有橙色小方块，且左侧镜头卡使用对象色；这可作为对象类型锚点。成熟 Inspector 通常保持中性底色，把颜色留给类型标记/状态，不让色块抢预览注意力。此句是跨产品形态的**推测**，不是官方像素规范。

**Nomi 采纳：** 保留“属性”标题 + 4px 类型色条 + 16px 类型图标 + 对象名/时长；组内用 label—控件两列对齐，音量用滑杆+数值框，时长/起点用数值框，画面用分段控件；禁止选中才突然出现的浮层。

## D. 导出按钮位置

| 产品 | 位置 | 证据强度 |
|---|---|---|
| OpenCut classic | 顶部 `EditorHeader` nav：Feedback → `ExportButton` → Theme；按钮打开导出 popover，含 Format/Quality/Audio。 | 源码实读：`editor-header.tsx:25-39`、`export-button.tsx:36-90` |
| ChatCut | 顶栏动作含 Export，打开 video/audio/graphics/subtitles/XML 选项。 | 官方文档 `editor-overview` |
| CapCut | 官方明确“Export button at the top right”，再调分辨率、帧率、码率、codec。 | 官方文档 `capcut.com/resource/how-to-use-capcut-on-pc` |
| Descript | 本次公开 View/Transitions 文档未给导出位置，标未公开。 | 官方文档未覆盖 |
| Resolve | 本次 Cut 页公开资料未给 Export 按钮像素位置；交付通常在 Deliver 页，不能把未读 UI 当事实。 | 官方手册范围外，标未公开 |

**Nomi 采纳：** 导出固定顶栏右上，沿用“导出 MP4”文字按钮；预览下不再放第二个导出入口，属性面板只放导出参数（分辨率/质量）而不放执行按钮。

## E. 预览区下方空间

- OpenCut：`PreviewToolbar` 自己占预览底部一行（`toolbar.tsx:29-53`），有上内边距/下内边距；Timeline 在下方独立面板，非空白区。[源码实读]
- ChatCut：播放控件写在 Timeline 上方；因此 Viewer 下沿不需要一条长控制条。[官方文档]
- CapCut：公开指南没有说明 Viewer 下方留白或 transport 的精确像素，不能推测“有留白”。[官方文档/未公开]
- Descript：Timeline 可折叠、可调层高、Zoom/Fit；空间由 View 菜单管理，而不是固定空白。[官方文档]
- Resolve：Enhanced Viewer 扩大到上半屏但 Timeline 保留；Viewer/Timeline 边界是可用工作区。[官方 PDF]
- 用户样张：预览视频紧贴到白色 transport 条，条内有播放、逐帧、时间码、音量、全屏、叠加、导出；其下到 Timeline 之间没有再放功能的必要。[用户样张]

**Nomi 采纳：** C′ 中预览视频下沿只保留一条 40px 左右 transport（播放簇/叠加/导出），紧贴 Timeline 上方；去掉“整片/这一段”两组显示缩放，分别进入属性和 Timeline 缩放，空白变成可视预览面积。

## F. 图标语义总表

“行业共识”=至少三家公开材料或源码采用同一语义；图标具体造型在官方文档未公开时标“未公开”，不伪造名称。

| 语义 | OpenCut（源码） | ChatCut | CapCut | Descript | Resolve | Tabler 对应 | 共识 |
|---|---|---|---|---|---|---|---|
| 分割 | `ScissorIcon` | split（图标未公开） | Split icon（名未公开） | advanced tools 未公开 | Blade/Trim 语义 | `IconScissors` | ✅ 4+ |
| 删除 | `Delete02Icon` | 右键 Delete | Delete（路径未公开） | 删除文本/场景 | Ripple delete | `IconTrash` | ✅ 4+ |
| 复制 | `Copy01Icon` | 右键 Duplicate（文档） | 未公开 | 未公开 | 常规 Duplicate | `IconCopy` | ✅ 3（含 OpenCut） |
| 撤销 | Editor/Action 体系（工具条未放） | 顶栏 Undo | 顶栏/编辑常规 | 编辑常规 | 编辑常规 | `IconArrowBackUp` | ✅ 4+ |
| 重做 | 同上 | 顶栏 Redo | 常规 | 常规 | 常规 | `IconArrowForwardUp` | ✅ 4+ |
| 吸附 | `MagnetIcon` | snapping | snap/对齐语义未公开 | Snap-to guides | Smart Indicator/对齐 | `IconMagnet` | ✅ 3+ |
| 静音 | `VolumeHighIcon`/`VolumeOffIcon` | track Volume | Audio/音量 | volume meter/音频层 | Fairlight/轨道 | `IconVolume`/`IconVolumeOff` | ✅ 4+ |
| 适配 | Preview Select “Fit” | zoom/fit 语义 | aspect ratio/auto reframe | Fit in view | Viewer fit 未公开 | `IconViewportWide` | ✅ 3+ 语义 |
| 放大/缩小 | `SearchAddIcon`/`SearchMinusIcon` | zoom | 未公开 | Zoom in/out | viewer zoom | `IconZoomIn`/`IconZoomOut` | ✅ 4+ |
| 全屏 | `FullScreenIcon` | fullscreen | 未公开 | 未公开 | Cinema/Enhanced Viewer | `IconMaximize` | ✅ 3+ |
| 转场 | transition 数据/菜单不在 toolbar | Library/transition | Transitions tab | transition icon/handle | transition buttons | `IconTransitionRight` | ✅ 4+ 语义 |
| 字幕 | `TextIcon`/文字轨 | captions | Captions | transcript/captions | subtitles | `IconSubtitles` | ✅ 4+ 语义 |
| 配乐 | `MusicNote03Icon` | Audio/Music | Audio > Music | audio layer | Fairlight | `IconMusic` | ✅ 4+ 语义 |
| 导出 | `TransitionTopIcon`（按钮） | Export | Export 顶右 | 未公开 | Deliver/Export 语义 | `IconDownload` | ✅ 3+ |
| 属性 | 属性 tab rail（类型 icon） | Properties/Inspector 语义 | Video/Basic 右栏 | Properties sidebar | Inspector | `IconAdjustments` | ✅ 4+ 语义 |
| 收起面板 | resizable panel，无明确 icon | Workspace 显隐 | panel 未公开 | View 显隐 | workspace | `IconLayoutSidebarRightCollapse` | ✅ 4+ 语义 |

**Nomi 采纳：** Tabler 只保留上述语义共识图标；`IconScissors/IconTrash/IconCopy/IconArrowBackUp/IconArrowForwardUp/IconMagnet/IconVolume/IconVolumeOff/IconZoomIn/IconZoomOut/IconMaximize/IconTransitionRight/IconSubtitles/IconMusic/IconDownload/IconAdjustments/IconLayoutSidebarRightCollapse` 作为唯一图标词典，避免 Hugeicons/Lucide/Tabler 混用。

## G. Nomi 现役控制条逐项裁决

| 现役元素 | 去处 | 一句理由 |
|---|---|---|
| 播放簇 | **留预览下** | Viewer transport 是用户看片时的即时控制，贴画面最短路径；与 ChatCut 的 Timeline 播放位置并存会重复，因此 Timeline 只保留编辑动作。 |
| 时间码 | **留预览下，与播放簇同组** | 当前/总时码是看片反馈；ChatCut 虽把它放 Timeline 上沿，但 Nomi 需要在预览下提供即时读数，不能再造第二份。 |
| 音量 | **进属性面板**（轨道头保留静音） | 连续 dB 调整需要滑杆+数值框与淡入淡出，属性是“一功能一个家”；轨道头只做一键静音。 |
| 全屏 | **留预览下右侧** | 它改变 Viewer 尺寸，属于 Viewer 控制；面板系统另提供“结果全屏”布局。 |
| 画幅 | **进属性面板的整片“画幅”组** | 画幅是项目参数，不是播放瞬时控制；与 720p/1080p 导出参数同组可理解。 |
| “这一段”显示缩放 | **进属性面板的片段“显示”组** | 适应/填充/缩放/重置作用于所选片段画面，不应和 Timeline 时间缩放同名。 |
| 叠加文字 | **留预览下**，仅保留 `Aa 叠加` | 它是 Viewer 可见层开关；具体字幕内容/样式进文字片段属性。 |
| 导出 MP4 | **顶栏右上**（预览下可保留一个次级快捷入口仅在用户明确需要时） | CapCut、ChatCut、OpenCut 都把导出当项目级动作；C′ 预览条不再承载长按钮。 |

**Nomi 采纳：** 最终 transport 只含播放簇、时间码、音量预览监听（可选只读电平）、全屏、叠加；编辑参数与项目导出全部迁移到属性/顶栏，消除“长条塞满一切”。

## H. 抄 / 避

### 抄

1. **抄 ChatCut**：Playback controls above Timeline 的空间关系；Workspace 可拖拽、显隐、Reset；选中对象与时间点成为 Agent 上下文的方向。[官方文档]
2. **抄 OpenCut**：`ResizablePanelGroup` 的左素材—中预览—右属性—底时间轴骨架；tooltip、icon-only、组间分隔线；轨道头独立静音/可见性按钮。[源码实读]
3. **抄 CapCut**：顶栏右上 Export；右侧 Video/Basic/Adjustment 式分组，让用户把连续调参与时间线动作区分开。[官方文档]
4. **抄 Descript**：Timeline 显隐、Zoom/Fit 与高级工具按需开启；转场既可从时间线切点也可从 Properties 进入。[官方文档]
5. **抄 Resolve**：Viewer 放大时 Timeline 仍在；transport 邻近逐帧/trim，减少跨区找按钮。[官方 PDF]

### 避

1. 避免把播放、时间码、音量、画幅、片段缩放、叠加、导出全部塞进一条无分组长 pill；用户无法形成稳定肌肉记忆。
2. 避免为每个供应商引入一套图标库；OpenCut 已证明 Hugeicons 与 Lucide 混用会扩大语义对账面，Nomi 统一 Tabler。
3. 避免用整块彩色属性头；只保留窄类型色条和小图标，颜色用于识别，不替代层级。
4. 避免“选中才出现”的属性列；ChatCut/CapCut/Descript/Resolve 都把可配置面板作为可恢复工作区，C′ 已拍板常驻。
5. 避免把 OpenCut 本地运行 500 错误后的页面当成 UI 证据；本次只能把源码标为事实，截图标为未能访问。

## I. 花费与未能访问

- 花费：本轮只使用公开网页、官方 PDF、公开 Git clone 与本地源码；未登录 ChatCut/CapCut/Descript/Resolve，未调用生成模型，未消耗额度。
- OpenCut：`bun install --frozen-lockfile` 成功，`bun run dev:web` 启动 Next.js 16.1.3；CDP 打开首页返回 `TypeError: Cannot read properties of null (reading 'useInsertionEffect')`（React/Next dev overlay），因此未能取得整页、工具栏、属性、预览四张可信截图。详见证据 `opencut-run.txt`。
- ChatCut 用户真机观察文件 `scratchpad/chatcut-user-screenshots-notes.md` 在基线不存在；使用官方 `editor-overview`/`timeline` 文档，并引用已有 ChatCut teardown 的公开 DOM 摘录（证据目录同名文件）。
- CapCut 官方帮助公开了 Export 顶右、Split、右侧 Video/Basic、Transitions/Audio/Captions 路径，但未公开完整桌面 transport/属性头图标顺序；相关项保留“未公开”。
- Descript 官方页面未公开完整播放条按钮顺序；只对 View/Timeline/Properties/Transitions 已文档化部分下结论。
- Resolve 使用 Blackmagic 官方 PDF；19 New Features Guide 说明 Cut Viewer、transport 邻近 trim、Effects Overlay，但未覆盖完整 Cut 页每个图标像素顺序；旧版 Reference Manual 仅作 Viewer jog bar/transport 的历史补充。

### 证据目录

- `opencut-timeline-toolbar.txt`、`opencut-preview-toolbar.txt`、`opencut-properties-index.txt`、`opencut-property-fields.txt`、`opencut-editor-header.txt`、`opencut-export-button.txt`、`opencut-layout-page.txt`：带行号源码摘录。
- `chatcut-editor-overview.dom.txt`、`chatcut-timeline.dom.txt`、`capcut-desktop.dom.txt`、`descript-tour.dom.txt`、`davinci-cut.dom.txt`：公开 DOM 文本摘录。
- `chatcut-official-extract.txt`、`official-extracts.txt`、`opencut-run.txt`：访问时间、关键文本与失败边界。
