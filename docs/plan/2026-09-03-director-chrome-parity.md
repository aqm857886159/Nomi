# 导演台外壳对齐参考产品（顶栏 / 左栏 / 底栏 / 时间轴 / 机位 HUD / 骨骼页）

> 状态：🚧 持续对齐，全部留在工作区未提交；最新片段状态配色与验证见 §14。
> 2026-09-03 用户反馈：「顶部 toolbar、时间轴上方 toolbar、左侧 toolbar 都没有同步，看起来就很乱；时间轴的 UI 及逻辑也要同步；还有 IK 动力学手柄、FK 骨骼微调。」
> 样张 = 参考产品真实界面截图，逐区与我们的 devlab 截图并排对过。

## 1. 差异（并排对账）

| 区域 | 参考产品 | 我们（改前） | 处理 |
|---|---|---|---|
| 顶部 | 视口顶部居中的**纯图标浮条**：重置视角 ｜ 选择 / 移动 / 旋转 / 缩放 ｜ 手绘画线 / 逐点 ｜ 退出；tooltip 带快捷键；没有标题栏 | 一整行 header：标题 + 场景统计 + 带文字的分段 + 「作用域 / 编辑模式」胶囊 + 「退出导演台」文字按钮 | 删 header，改成浮条 `ViewportToolbar`；编辑模式提示挪进检查器「空间变换」卡头（参考产品同位置） |
| 左侧 | 视口左缘的**竖向图标条**：角色 / 机位 / 灯光 / 方块，向右弹出菜单，机位菜单头「相对主体：X」 | 视口底部居中的带文字胶囊 | `CreationBar` 改竖条 + 右弹菜单 |
| 底部 | 居中一条图标胶囊：撤销 重做 ｜ 全景 群众 骨骼 画幅 AI 截图 产出；右下：实体 / 半透 / 白模 ｜ 折叠 ｜ 设置 帮助 | 左下四簇带簇名（历史 / 场景 / 骨骼 / AI / 画幅）+ 文字按钮；截图无按钮；产出在时间轴头部 | 合成一条图标胶囊；截图 / 产出并入；右下加帮助入口 |
| 自由漫游提示条 | 无 | 左上常驻绿点胶囊 | 删（快捷键在帮助里） |
| 时间轴头部 | ▶ ■ ｜ F 0/ 4.0s ｜ ◆自动帧 ｜ 吸附 ｜ 1.0× ▾ ｜ + − ⤢ ｜ … ｜ 录制 MP4 ｜ + 插入关键帧 (I) ｜ ▾ | 三簇带簇名（传输 / 编辑辅助 / 产出）+ 产出按钮 | 去簇名、按参考产品顺序；产出移走 |
| 轨道列 | 列头「轨道列表 (N)  + 添加轨道 ▾」；主行：拖把手 图标 名字 ｜ + 追加片段菜单 ｜ 追加路径 ｜ 播放头切割 ｜ 钉住 ｜ 删除（常显）；加轨道时自动带一段「路径片段 0~120」；副轨只在有内容时出现 | 「+ 添加轨道」在列表末行；主行只有 ⋮ 菜单，副轨常显 4 行空行 | 列头 + 主行五键；空副轨不占行；加轨道自动补 4s 空路径片段，手绘画线优先填入播放头下的空片段 |
| 空态 | 「暂无激活的运动轨道 / 在 3D 画布中为角色/相机手绘轨迹 (P) 或在左栏点击「+ 添加轨道」」居中 | 左上一行长句 | 改成居中两行 |
| 机位 HUD | 左下卡片：机位视角 [POV] ×；名·mm；FOV；红色「录制运镜 (R)」；「连接手机虚拟相机」 | 顶部居中胶囊 | 改左下卡片 |
| 画中画 | 左上：机位名 · mm · 画幅 chip ｜ 折叠；画面带三分线；右下「进入视角」 | 右下「节目预览」+ 机位下拉 | 默认位置改左上、头部信息改成参考产品式 |
| 骨骼页 | 卡「姿态动力学与骨骼 [全部复位]」→ 分段「IK 动力学手柄 / FK 骨骼微调」→ 状态行「IK 动力学靶点：X [平移求解 (W)]」/「FK 骨骼关节：… [旋转欧拉角 (E)]」→ 人偶（右(R)/左(L) 角标、把手带名）→ 已选卡 → 双脚吸附 / 左右镜像 + 说明 | 「骨骼编辑 / IK 求解」两个开关 + 骨骼卡（左侧/右侧分段）+ 人偶 + 四个底部按钮 | 按参考产品结构重排；分段即 IK 开关；写入落点提示保留成一行小字 |

## 2. 不动项
- 存储模型 / 命令层 / 快捷键表 / 走查桥不变；只改外壳与「加轨道自动补路径片段」这一条逻辑。
- React Flow 画布、AI 来导、迁移器不碰。
- 视口内实体外观（机位机身、IK 把手 mesh）不在本轮。

## 3. 验收
- 与参考产品同状态并排截图（空场 / 放角色 + 机位 / 进机位 / 加轨道 / 骨骼页 IK 与 FK）人眼对账。
- 六条旅程 + Electron 真机走查按新选择器改后全绿；typecheck / lint / i18n / walkthroughs 门岗绿。

## 4. 实施状态（2026-09-04，工作区未提交）

| 区域 | 状态 | 落点 |
|---|---|---|
| 顶部浮条 | 完成 | `panels/viewport/ViewportToolbar.tsx`（TopBar.tsx 删）；编辑模式一行进 `inspector/TransformSection.tsx` |
| 左缘竖栏 | 完成 | `panels/CreationBar.tsx`（Popover 新增 `side="right"`） |
| 底部图标条 | 完成 | `panels/BottomBar.tsx`（截图 + 产出并入；`OutputsPopover` 触发器改文件夹图标 + 角标）；右下 `ModelDisplayModeSwitch` 加帮助入口 |
| 自由漫游胶囊 | 删 | `ViewportOverlays.ModeChip` 一并删 |
| 时间轴头部 | 完成 | `timeline/TimelineHeader.tsx` 参考产品同序、去簇名；帧读数 `F 0/ 4.0s` |
| 轨道列 / 泳道 / 行模型 | 完成 | `TrackList.tsx`（`TrackListHeader` + 主行五键）、`timelineRows.ts`（主行 = 路径副轨、空副轨不占行）、`TrackLanes.tsx`、`DirectorTimeline.tsx`（主行「+」追加片段菜单、空态居中两行、轨道列 290px） |
| 加轨道自动补路径片段 | 完成 | `model/storeTimelineActions.addEntityToTimeline`；`scene/creation/usePathDraw` 手绘优先填播放头下的空片段 |
| 机位 HUD | 完成 | `panels/viewport/CameraPovHud.tsx` 左下卡片 |
| 画中画 | 完成 | `PipViewport.tsx` 默认左上、头部机位 · mm · 画幅 chip（localStorage 键升 v2） |
| 骨骼页 IK / FK | 完成 | `inspector/SkeletonTab.tsx` + `PuppetFigure.tsx`（分段即 IK 开关、状态行、带名把手 / 关节、右(R)/左(L) 角标、镜像按所选侧） |
| J7 骨骼旅程 | `tests/ux/director-j7-skeleton.walk.mjs`：把手 11 只 / 拖手 / 拖肘向 / 骨盆钉脚 / 3D 骨骼球 / ±180 滑条 / 五档快选 / W·E |
| 走查 | 六条旅程按新选择器改（`_directorLab.addTrack` 走列头、新增 `rowAddClipMenu`；J1 统计改读工程；J4 走行内加号；J6 产出走底栏） |

样张对账：我们与参考产品的同状态截图（本机 scratchpad，不入库）并排人眼核过（空场 / 放角色 + 机位 / 加轨道 / 骨骼页 IK 与 FK / 进机位）。

## 5. 骨骼交互（2026-09-04 用户第二轮反馈「骨骼的交互还是没有同步」）

参考产品的机制与我们的落点：

| 参考产品 | 我们（改后） |
|---|---|
| `sceneConfig.showSkeleton`（底栏开关，随图层持久）；骨骼页打开 = 该角色「骨骼聚焦」，进页 IK 模式默认选骨盆，离页清选择 | `BottomBar` 开关改写 `sceneConfig.showSkeleton`；`CharacterInspector` 骨骼页 effect 置 / 清 `isSkeletonEditing` 与默认 `ikTarget='pelvis'` |
| 骨线（SkeletonHelper）+ 17 颗骨骼球（青 r=0.04，选中红）：聚焦角色显示，或无人聚焦且 showSkeleton；IK 模式下骨骼球只在聚焦时出现 | 新 `scene/character/SkeletonVisual.tsx`（传送到场景根，SkeletonHelper 自带世界矩阵） |
| IK 把手：手 / 脚 / 头球、骨盆 / 胸腔水平圆环、肘 / 膝极向量八面体，琥珀 0xF59E0B、选中红 0xEF4444 放大 1.3，各带引导线；只给选中角色、IK 模式、聚焦或 showSkeleton | `SkeletonHandles.tsx` 重写（环里加一片近透明内盘承接点击，参考产品没有） |
| 点骨骼球 = 选骨 + FK；点把手 = 选把手 + IK；选中把手挂平移 gizmo、选中骨挂旋转 gizmo，实体 gizmo 让位 | `useViewportPicking`（把手 / 骨骼球 / 路标先于实体命中，机位视角里跳过当前机位机身）、`TransformGizmo` 让位、`BoneRotateGizmo` 实时写 `setBoneRotation` |
| 拖骨盆 = hipsOffset 且两脚钉住（两腿同时解）；拖极向量 = 肢体绕 根→末端 轴转；松手烘进 boneRotations | `useCharacterRig` 多靶点 `ikDragRef[]` + `characterRig.rotateLimbPlaneToward / poleRestPosition`（单测 `characterRig.pole.test.ts`） |
| 「平移求解 (W)」/「旋转欧拉角 (E)」 | `hotkeys.ikMode / fkMode`（骨骼页聚焦时生效，`ViewCamera` 飞行让出 W / E） |

验收（当时）：`director-j7-skeleton-ik-fk.walk.mjs`（把手 11 只 / 拖右手写右臂 / 拖肘向改上臂 / 拖骨盆左脚位移 0.5px / FK 骨骼球点选 / W·E）全绿。**2026-09-05 已删**：它按「直接拖把手」写，§7 改成参考产品 gizmo-only 交互后必红；同样的检查点全部住进 `director-j7-skeleton.walk.mjs`（§7 验收）。

## 5. 骨骼交互与内置动作：按参考产品行为逐函数对照（2026-09-04）

每行「参考产品做法 → 我们的落点」。

| 参考产品 | 行为 | 我们 |
|---|---|---|
| 骨键表 | 骨键表 17 根：spine = mixamorigSpine2，thigh / shin = UpLeg / Leg | `model/rigs.FK_JOINTS`（spine2；upLeg / leg） |
| 关节名 / 靶点名表 | 关节名「左大臂 (L-Arm)」、靶点名「骨盆/重心 (Pelvis)」 | i18n `director.character.joint.* / handle.*` 原文 |
| 三轴语义标签表 | 17 根 × 三轴语义标签（抬头/低头 …），无表退 X (俯仰) / Y (偏航) / Z (翻滚) | i18n `director.joint.*` + `fallback` |
| 骨骼页卡 | 卡头「姿态动力学与骨骼 ｜ 全部复位」；IK / FK 分段；IK：双脚吸附 / 左右镜像 两键 → 已选中手柄卡（复位此肢体）或提示；FK：已选关节卡（重置此关节 = 写 0；快选 −90 −45 0 45 90，0 = 三轴归零、其它只写 X；三轴滑条 ±180 步 1）或提示 | `SkeletonTab.tsx` 逐段同构 |
| 进出骨骼页 | 进骨骼页 isSkeletonEditing=true、IK 模式无靶点默认 pelvis；离页清 | `CharacterInspector` effect |
| 分段切换 | 切 IK：清骨键、无靶点默认 pelvis；切 FK：清靶点 | `SkeletonTab.setMode` |
| 镜像方向 | 镜像方向 = 所选靶点在右侧则 right 否则 left | `mirrorSideOf` |
| 2D 人偶 | viewBox 250×300；两半菱形骨、7 靶点、4 极向量（连线 70→26 / 180→224 / 96→56 / 154→194）、17 关节；FK 页骨可点、IK 页压暗 | `PuppetFigure.tsx` 原坐标 |
| 偏移右乘 | 偏移 = 骨局部一次旋转，`quaternion.multiply(euler)` | `characterRig.applyBoneRotationOffsets` |
| 写回偏移 | 偏移 = base⁻¹ · 当前 → 欧拉度一位小数，拖动中每次写 | `characterRig.offsetFromBase` + `useCharacterRig.writeOffsets`（逐帧） |
| 两骨解析 IK | 距离夹 [\|d−k\|·1.001, (d+k)·0.9995]，余弦定理，平面法线 = 根→靶 × 根→极向量（退默认方向 / 角色朝上），先转根再转中节 | `characterRig.solveTwoBoneIk` |
| 胸腔朝向 | 脊柱把角色朝上转到 骨盆→靶点，写在 base 之上（绝对） | `characterRig.solveChestToward` |
| 极向量 | 肢体绕 根→末端 轴转到极向量那一侧 | `characterRig.rotateLimbPlaneToward` |
| 钉脚 | 骨盆拖动时两脚两骨解到原位并恢复世界朝向 | `useCharacterRig`（pinnedFeet + 朝向恢复） |
| 双脚吸附 | 脚腕 y = 0.04 走两骨 IK（不动骨盆） | `useCharacterRig.snapFeetToGround` |
| 复位此肢体 | 骨盆 → 偏移归零；胸腔 → 删 spine；极向量 → 删根 + 中；靶点 → 删末端 + 链节 | `store.resetLimb` |
| 左右镜像 | 7 对 {x,−y,−z}，源侧空则删目标 | `rigs.mirrorBoneRotations` |
| 全部复位 | boneRotations = {}，hipsOffset = 0（预设保留） | `store.resetAllPose` |
| 播放头对齐关键帧 | 播放头落在骨骼关键帧上就把它设为写入落点 | `store.syncBoneKeyframeAtPlayhead` |
| gizmo 挂载 | 选靶点 → 平移 gizmo 挂把手；选骨键 → 旋转 gizmo 挂骨 | `SkeletonHandles`（TransformControls / BoneRotateGizmo） |
| 姿态页 | 「内置姿态」列表 + 勾选 + 「点击列表项即可替换当前姿态，微调会在切换后重置。」；快捷体形列表 + 提示；`applyPosePreset` 清 boneRotations | `PoseTab.tsx` + `store.applyPosePreset` |
| 动作库弹窗 | 左 搜索「搜索动作名称...」+ 列表（图标 / 名字 / 类型 / 勾选，双击添加）+「未找到相关动作」；右 「动作实时预览」+ 动画 / 静态 + 重置视角 + 独立渲染器（Y Bot、(0,1.2,2.6)→(0,0.9,0)、OrbitControls 1–5m）+ 当前动作；底部 提示 + 添加「X」片段；初选 walking | `ActionSelectModal.tsx` + `ActionPreview.tsx`（循环 / 静态按 FBX 时长判，参考产品用四个不在库里的别名判、全显示成单帧姿态，属其瑕疵） |
| 内置动作片段 | 内置动作片段：append = 上一段末尾或播放头起 4s（到末尾不足则截）；prepend = 播放头前 4s（播放头 < 0.5s 不插，< 4s 从 0 起）；名「动作·X」 | `store.addActionClip`（prepend 规则）+ `DirectorTimeline`（4s / 名字） |
| 骨骼姿态片段 | 骨骼姿态片段：4s，首个关键帧 = 当前 boneRotations / hipsOffset，成为写入落点 | `store.addActionClip(custom_pose)` |
| 插骨骼关键帧 | 插骨骼关键帧：播放头无片段则建 3s（到下一片段开头），有则合并采样 | `store.insertBoneKeyframe` |
| 动作片段检查器 | 副轨禁用横幅 + 一键启用；片段属性：骨骼姿态 N 帧 / 动作姿态下拉（改名「动作·X」）+ 开始 / 结束 滑条（步 0.1、F 帧）+ 持续时长；播放头时间裁剪 裁前 / 裁后；删除该动作片段 | `ActionClipInspector.tsx` |

## 6. 第三轮（2026-09-04 用户：「内置动作完全对不上」「IK 的交互也完全不一样」）——参考产品真机对账

把参考产品在本机跑起来，用其运行时状态与截图逐状态对我们的 devlab，再定差异：

| 参考产品事实 | 我们原来 | 改成 |
|---|---|---|
| gizmo 挂载：`transformMode` 为空直接 detach；IK 靶点一律 translate、骨键一律 rotate | 把手可直接按住拖 + gizmo 常挂 | 删直接拖：点把手 = 选中，拖动只经 gizmo；「选择」工具下不挂 gizmo（`SkeletonHandles`） |
| 拾取：三趟按类——路标 → IK 把手 → 骨骼球 | 一趟按距离 | 三趟按类（`useViewportPicking`）；抬手后肘向贴着大臂球时点把手不再切成 FK |
| FK gizmo 变更：偏移 = `basePoseForOffsets⁻¹ · bone.quaternion` → 欧拉度 | 起点欧拉差 | `offsetFromBase(bone, api.baseQuaternionOf(bone))`，gizmo 默认尺寸 / world 空间 |
| 骨骼线：骨线统一 0x22C55E、0.95、不测深度 | SkeletonHelper 逐骨彩色 | 关顶点色统一绿（`SkeletonVisual` / `SKELETON_COLORS.boneLine`） |
| 动作求值：片段头 0.25s 淡入（上一片段间隙 <0.2s 从其末帧交叉）、**片段尾不淡出**、片段外相邻 ≤0.5s 交叉、否则尾后 0.25s 淡回静止；**动作在播时不叠 boneRotations / hipsOffset**（只有 o === -1 或姿态片段才叠）；混合 smoothstep | 片段内尾部也淡出；动作在播时仍叠静止微调与骨盆偏移 | `poseBlend.resolveActionBlend` 重写 + `useCharacterRig` 按 actionActive 跳过偏移；smoothstep |
| `ActionSelectModal` 标题「选择动作片段」 | 「添加动作片段」 | i18n 改名 |
| 深色主题人偶名牌黑块 / 角标叠在一起（用户截图） | — | 不是代码：`public/tailwind.generated.css` 是 gitignore 的生成物，用户的 dev 实例还在用旧 CSS（`fill-nomi-ink/85`、`right-2.5` 都在新 CSS 里）；重启 `pnpm dev` 即好，深色 devlab 实测正常 |

验收：`director-j7-skeleton.walk.mjs` 改为参考产品交互（点选 → 拖 gizmo 中心；「选择」工具下无 gizmo）；`characterAnimation.test.ts` 改为参考产品淡入淡出语义。

补充（同日晚些）：真机对账时挖出一个被「直接拖」遮住的根因——`SkeletonHandles` 在渲染里用 `groupRef.current.getObjectByName` 找选中把手的组，
把手组和它同一次提交才挂上，读到 null 后没有任何状态变化触发重渲染 → **进骨骼页默认选骨盆时 gizmo 根本不出现**，拖动落到 Orbit 上（视角平移、把手屏幕位置变了但工程没写）。
改成 HandleMesh 用 useLayoutEffect 登记把手组、父级按 ikTarget 在 layout effect 里设 state。gizmo 事件同时改走 three 的 `dragging-changed` / `objectChange`
（drei 的 onMouseDown 只在指针先悬停到轴时才发；处理器读 ref，选择切换后同一个 gizmo 实例不会拿到旧闭包里的把手）。把手组只带位置，环的旋转与选中放大落在内层 mesh（gizmo 轴世界对齐）。
`check:vocabularies`：`poseClipStatus` 词表已登记（E2E 桥类型改 ReturnType derive）；剩下的红是工作区里 `AssistantTimeline.StepTone` 的历史债（78 > 77，非导演台改动）。

## 7. 第四轮（2026-09-04 傍晚，用户：「骨骼的点太大根本不方便操作（参考图）」「内置动作动起来模型都歪的」）

| 现象 | 根因（实测） | 改法 |
|---|---|---|
| 关节球 / 把手比参考产品大一倍 | 假人只有 **0.97m**：`CharacterEntity` 用 `measureSkeletonExtent(normalized)` 量身高，量的是 normalized 局部（原始单位），少乘了 normalized.scale 这层；参考产品同尺寸的 r=0.045 把手在 1m 的人身上自然显得大 | 高度乘回 `normalized.scale.y`，假人 1.75m（骨骼范围实测 1.750） |
| 内置动作播起来整个人歪 | `poseSnapshot.applyPoseSnapshot` 对骨盆旋转增量做了父系共轭 R·d·R⁻¹；但 d = 源 bind⁻¹·帧 是骨盆自身局部系的增量，两边骨盆世界 bind 朝向一致（实测都是 [0.0065,0,0,1]），共轭把行走的骨盆偏航 / 侧倾转到错误的轴 | 骨盆旋转与其它骨一样直接右乘；只有位移保留父系换算。单测改成真实骨架惯例（Armature +90°X、骨盆 bind −90°X），断言世界朝向与源一致 |
| 骨骼层看不清、点不准 | 参考产品的线 + r=0.04 球在真人尺寸下仍盖住肢体 | 按用户参考图重做 `SkeletonVisual`：细菱形骨（脊柱紫 / 手臂蓝 / 腿青）+ r=0.012 小黄点，FK 关节另带 r=0.03 透明拾取球——这是用户拍板偏离参考产品的一处 |
| J7 拖骨盆抓中心沿 Z 走 | three TransformControls 从正面看 Z 轴正对镜头，其拾取柱盖住中心（参考产品同性） | 走查改抓 Y 轴身 |

## 8. 第五轮（2026-09-04 晚，用户：「内置动作库的动作就是手看起来很奇怪」「不要参考 V1，完全按参考产品」）

| 现象 | 根因（实测） | 改法 |
|---|---|---|
| 动作预览 / 播放里手掌拧着、坐姿变深蹲、跑步手臂外张 | ① V1 遗留的「自然站姿基线」`MANNEQUIN_DEFAULT_POSE`（手臂下压 67.5°、前臂 8°、手 6°、头颈抬 18°）在每帧复位时叠在 bind 上，而 x-bot.glb 的 rest 与 Mixamo FBX 的 bind **逐骨完全一致（含手指 0.0°）**，这层基线让复位态离 bind 整条手臂差 83°；② 动作预览克隆模型后没 `rememberMannequinRestPose`，复位不幂等，基线每帧累加，人越转越歪 | 基线连根删掉（`posePresets.MANNEQUIN_DEFAULT_POSE` + `mannequinPoseOffsetForBone`），`applyMannequinSkeletonPose(root)` = 纯 rest（= 参考产品「T-Pose (绑定姿态)」）；预览克隆后先记 rest |
| 套骨公式 | 局部增量右乘在 bind 一致时正确，但上传的模型 bind 可能不同 | `poseSnapshot` 改按层级自上而下用世界增量：Δ = 帧.world·源 bind.world⁻¹，目标 = Δ·角色 bind.world，换回父局部；快照带相对根累积朝向；bind 一致时与参考产品照抄等价 |

参考产品真机预览与我们并排：坐姿 = 端坐手放腿上、跑 = 手臂贴身，一致。

## 9. 相机逻辑同步参考产品（2026-09-04 夜，用户：「继续完善相机逻辑需要跟参考产品同步」）

方法：两份函数级盘点（参考产品侧与我们侧同结构，本机 scratchpad 不入库）+ 参考产品真机状态对账（预设「正面中景」= 主体前 3.5m / 高 1.1 / yaw 180 / pitch 1.64 / fov 45 / 29mm；POV 里 orbit 直接写回；Shift+A → 「机位 N」）。

| 参考产品 | 我们原来 | 改成 |
|---|---|---|
| 机位渲染：机身（2026-09-08 起为程序化几何，不再用模型文件；原对账时 rotation.y=π，材质 metalness 0.8 / roughness 0.2，emissive 选中 0x00FFCC×1 否则 0x00A2FF×0.25），视锥固定 16:9 深 0.9 + 顶上「朝上」三角，5m 虚线射线；线色四态 选中 0x00FFCC / 激活 0xFFA500 / 预览 0x38BDF8 / 默认 0x00A2FF，透明度 0.9/0.9/0.7/0.45 | 手搓 box + 圆柱机身、选中色 0xFFCC00、视锥按视口画幅 | `CameraEntity` 用同一份 GLB（`src/assets/director/virtual-camera.glb`），几何 / 颜色 / 缩放逐项同 |
| 预设机位叫预设名，「当前视角」叫「机位 N」；预设只给位姿不挂看向；建完 `previewCameraId = id`、主体取消选中；无主体只显示「当前视角」 | 一律「机位 N」；预设挂 `lookAtType: coordinates`（rig 每帧拽朝向）；无主体也给 14 个 | 全部按参考产品（`CreationBar` / `cameraPresets`） |
| 机位检查器：摄影机 → 镜头参数（4×2「NNmm + 用途」+ 焦距微调 + 垂直 FOV）→ 空间变换 → 射线指示与视锥；**没有** rig / 看向 UI（只读字段，无入口） | 多一个「进入视角」按钮 + 「跟随与看向」卡 | 删掉；rig 字段与求值保留（迁移数据用），i18n 死词条清掉 |
| 空间变换（对象 / 机位共用）：每量「小标题 + ↺」+ 滑条，位置 ±100 步 0.1、水平 0–360 / 俯仰 ±90 / 横滚 ±180 步 1、缩放 0.1–10 步 0.05；机位位置 ↺ → (0,1.7,10) | 三格数字输入 | `TransformSection` 改滑条行 |
| 取景框：四周 80px 内边距装画幅、ring 压暗、四角圆角括号、三分线、右上画幅徽标、右下像素徽标；FOV 补偿 `fov' = 2·atan(tan(fov/2)·H/guideH)` | 框贴满视口、只在视口更高时补偿 | `AspectGuide` 同形（SVG mask 给画中画挖洞——我们的 PiP 是同一张 canvas 透视，DOM 压暗会一起压黑）+ `povVerticalFov` 改参考产品公式 |
| 漫游 设置：5 m/s、1 rad/s、阻尼 0.15；量程 0.5–30 / 0.2–5 / 0.02–0.5；Orbit 无距离上下限 | 4 / 1.2 / 0.08；0.2–300 | `viewSettings` / `ViewCamera` 对齐 |
| `0` 归位在 POV：机位搬回 (0,1.7,10)；`F` 聚焦：沿相机方向退到 4m，POV 里同样生效 | POV 里 0 = 回静止位姿；F 在 POV 里不响应、距离按包围盒 | 按参考产品 |
| 特写检查器：俯仰 ±89、距离 0.3–20 步 0.1、高度 −2–5 步 0.1、自定义锚点 X/Z ±3 Y −1–3，custom 方位无输入；转路径固定 12 样本 | ±80 / 0.3–10 / −2–3；有 customAzimuth 滑条；按 0.25s 采样 | 按参考产品 |
| PiP 选台：播放 = 节目机位；停止 = 手动指定 → 节目 → POV 机位 → 选中 → 第一台；宽默认 280、160–520 | 停止 = previewCameraId 否则第一台；300、280–520 | `pipCamera` / `PipViewport` 按参考产品 |
| gizmo 挂载：机位 scale 模式降级 translate | 允许 scale | 降级 |

未动（已一致或参考产品侧是死路径）：焦段换算（24mm 片高、12–300）、POV 写回三层（对应我们的 editLayer）、进特写踢回自由视角、录制阈值（0.02m/0.5°采样，6°/4°/0.6m 且 ≥0.25s 简化）、节目机位按轨道顺序、rig follow/track_aim（参考产品无 UI）。

补充（Esc）：参考产品 Esc = 取消模式 → 否则 `transformMode = null` + 清全部选中（不退 POV、不退出）。我们的 Esc 监听挂在 window 冒泡期，而壳根节点 `onKeyDown` 会 stopPropagation，壳内按键永远到不了它；
且 `['INPUT','TEXTAREA','SELECT']` 一刀切让点过分段控件（radio）后 Esc 全部失灵——J7「选择工具下不挂 gizmo」此前是空洞通过（Esc 根本没生效，工具还是移动）。
改成捕获期监听 + `isTextTarget` 只认文本类输入，Esc 顺序：模式 → 清工具 + 选中 → 退 POV → 退出确认（后两步是壳自己的归属，参考产品没有）。J7 改点工具条「选择」验证把手世界位移 0.0cm。

## 10. 特写片段属性同步参考产品（2026-09-04 深夜，用户：「特写片段属性还是没有同步」）

参考产品真机 + 特写检查器逐行：

| 参考产品 | 我们原来 | 改成 |
|---|---|---|
| 选中片段 / 关键帧时检查器**只**显示那一张卡，标题换成「特写片段属性 / 路径片段属性 / 动作片段属性 / 视线片段属性 / 轨迹关键帧 (帧 N) / 批量轨迹关键帧 (N 个) / 骨骼姿态关键帧」 | 片段卡叠在实体检查器上方，标题仍是实体 | `useTimelineSelectionCard` 给标题 + 唯一一张卡，`ContextInspector` 整块替换 |
| 四张卡：特写片段属性（所属机位 / 跟踪目标 = 除组外全部物体 / 锚点 / 开始·结束滑条 0–时长 步 0.1 右下 F 帧 / 持续时长 "x.xxs (N 帧)"）→ 取景（朝向 / 方位 / 水平角 / 俯仰角）→ 机位运动（距离 / 高度 / [锚点 X Y Z] / 运镜预设）→ 播放头时间裁剪 → 转为路径片段 · 删除该特写片段（确认弹窗） | 一张卡、分段控件、多一个「分割」和 custom 方位角滑条 | 四卡同形；开始 / 结束经 `updateClipTime`（重叠即拒绝） |
| 词表：眼部 / 面部 / 胸部 / 身体中心 / 骨盆 / 脚步；始终看向目标 / 跟随人物朝向 / 保持世界方向 / 手动朝向；左侧 / 右侧；固定 / 环绕 / 半弧 / 推进 / 拉远 / 升降 / 横移 / 螺旋 | 眼 / 脸 / 胸 / 身…、看向目标、静止、环绕 360° | 全部按参考产品 |
| 建特写后选中新机位 + 那段特写（检查器直接落到特写属性） | 只切画中画 | `createCloseupForCharacter / appendCloseupForCamera` 选中 |
| 片段条文案「特写片段 0~120」「路径片段 0~120」 | 「特写·静止 · 脸 · 1.2m」「路径 0~120」 | 同参考产品 |

## 11. 时间轴行结构同步参考产品（2026-09-04 深夜，用户贴参考产品时间轴截图「根本对不上」）

参考产品的副轨规则：动作（角色有动作片段）、骨骼帧（有姿态关键帧）、视线（有视线片段）、空间轨迹（`keyframes.length > 0`，角色 / 机位都有），顺序动作 → 骨骼帧 → 视线 → 空间轨迹；**特写片段不是副轨**，直接画在机位主行。

| 参考产品 | 我们原来 | 改成 |
|---|---|---|
| 特写片段在机位主行 | 单独一条「特写」副轨，机位主行空着 | 主行泳道 = 路径片段 + 特写片段 |
| 路标菱形住「空间轨迹」副行（‹ ◇ › 导航，◇ 在播放头落在关键帧上时点亮） | 菱形画在路径片段上 | 长出空间轨迹副行（有路标才出），主行只画片段 |
| 只有角色行有「追加片段 +」 | 机位行也有 | 机位行去掉 |
| 片段条文案居中 | 左对齐 | 居中 |

## 12. 时间轴 UI 像素级同步参考产品（2026-09-05，用户：「参考产品的时间轴跟我们现在的时间轴完全不一样」）

参考产品时间轴逐元素盘点（本机 scratchpad，不入库）。改动：

| 参考产品 | 我们原来 | 改成 |
|---|---|---|
| 默认 36 px/s，泳道总宽恒 12 + 60s×scale，最小 scale = 60s 铺满视口，缩放 ×1.2 / Ctrl 滚轮 ×1.12 | 60 px/s、按内容长度适应、总宽按 totalDuration | `useTimelineViewport` 同参 |
| 标尺铺满 60s；主刻度首个 ≥72px 的档（默认 2s 一格）、次刻度 ≥10px；标签贴刻度右侧顶对齐、线贴底 | 主刻度 ≥56px、标签在线上方 | `TimelineRuler` 同算法 |
| 播放头 11×15 白块 + 1px 白线 | 红色 | 墨色（深色主题 = 白） |
| 行高 28px、底边 1px 黑线、选中实体整行变色 | 26px | 同参考产品 |
| 片段条 20px 高顶 3px、圆角、10px 等宽居中标签、选中白边 + 两端 4px 拖柄、家族色透明度 90/80 | 18px、左对齐、无拖柄 | `ClipBar` 同形 |
| 菱形 10px：未选轨 scale-75 灰、选轨 sky（骨骼 amber）、点选白 scale-125；片段内连线 2px | 8px 白菱形无连线 | 同参考产品（accent / warning / ink） |
| 主泳道末尾「+」追加路径片段（最后一段 +0.1s） | 无 | 加 |
| 角色·机位行「创建特写片段」按钮（repeat 图标），无「追加路径」按钮 | 「追加路径」按钮 | 换成创建特写 |
| 副行树形连接线（竖线 x=20、横枝 10px、骨骼帧二级 L 形）、pl-9 / pl-12、10px 等宽文字；骨骼帧 / 空间轨迹 ‹ ◇ › | 色点 + 文字、无树线 | 同参考产品 |
| 帧读数「F  帧 /  秒s」各 4ch 右对齐；倍速「1.0×」 | 「F 90/ 7.0s」、倍速「1.×」（格式 bug） | 同参考产品 |

未动：面板底色仍走设计系统 token。家族色见 §13（已换成参考产品同 hex 的专用 token）。

## 13. 时间轴单泳道逻辑 + 片段 / 关键帧颜色同步参考产品（2026-09-05，用户：「时间轴单轨道逻辑及显示颜色也需要同步啊」）

**单泳道**：参考产品的重叠检测在放置 / 拖移 / 粘贴 / 拖边时把「同一泳道」当作一个集合：机位只有一条泳道，路径片段与特写片段争同一段时间；角色的路径 / 动作 / 视线各在自己副轨里只跟同家族争。我们原来按家族各自争位置，机位的路径片段能叠在特写上面。改法：`model/timeGrid.ts` 新增 `laneClips(entity, family)` 作为单一集合真相，`placeClip` / `updateClipTime`（storeClipActions）与 `moveClip` / 两处粘贴（storeTimelineActions）全部改用它。探针 `scratchpad/lane-probe.mjs`：特写 3~7s 在位时点泳道「+」追加路径 → 落到 7~11s；把它拖到特写上 → 松手被拒、位置不变。

**颜色**：参考产品家族色是硬编码 tailwind 调色板：路径 sky-600、特写 rose-600、动作 emerald-700、姿态 amber-700、视线 indigo-700；关键帧菱形 路径 sky-400 / 骨骼 amber-400 / 激活 red-500；激活路径片段（实体选中 + 未点选 + 是该实体的激活路径）描 cyan-400 边。token 门岗不许组件里写 hex，但 `tailwind.config.ts` 里已有「主题无关」先例（3D 轴向 `--nomi-axis-*`），所以同法加 `--nomi-clip-path / clip-closeup / clip-action / clip-pose / clip-lookat / key-path / key-bone / key-active / clip-path-active` 九个主题无关 token（hex 同参考产品），`clipTone.ts` / `TrackLanes.tsx` / `TrackList.tsx` / `ClipBar.tsx` 全部改走这组 token；视线片段不再靠 CSS 变量内联色。`ClipBar` 新增 `active` 属性接 `activeTrajectoryClipIds`，条件同参考产品。验证：与参考产品截图逐条同色。

## 14. 片段完整状态配色对齐（2026-09-07，用户：「继续对齐」）

状态：🚧 本节配色对齐已实现并在本地验证，未提交；沿用已批准的参考产品参考。导演台整体对齐继续以各节证据为准，本节不代表全部功能已等价。

**本轮核实**：参考产品的片段状态是整套选择：选中优先于激活，激活只属于路径，选中和激活不继承普通悬停样式；标签继承父色。

| 状态 | 现状差异 | 本轮落点 |
|---|---|---|
| 五类普通片段 | 文字统一使用随主题翻转的 paper，深色模式文字变暗 | 每类明确主题无关浅色文字 |
| 悬停 | 增加原底色不透明度，未切参考产品的下一档色阶 | 使用源码指定色阶，保留 90% / 80% 透明度 |
| 选中 | 仍半透明、有普通 hover，边框随主题翻转 | 本家族实色、白字白边，覆盖激活/普通 hover |
| 激活路径 | 只有青边，缺 95% 底色与 cyan-50 文字 | 由配色单一边界完整决定激活态 |
| 拖边把手 | 随 paper 翻转，悬停整条即同时增粗两端 | 固定白色，仅所悬停把手增粗 |

**范围与分层**：`tailwind.config.ts` 声明所需语义 token；`timeline/clipTone.ts` 完整管理状态；`ClipBar.tsx` 消费并继承文字色，删除旧 `clipToneStyle` 空壳和无消费映射。同类入口核对 `TrackLanes` 的主轨路径/特写及副轨动作/姿态/视线，均消费同一个 ClipBar。更新三份导演台方案开头的过时状态并刷新生成账本，以免把已批准的切换读成待拍板。

**不动项**：已批准的统一标题栏、细菱形骨骼、整体主题、时间轴编排/持久化与用户现有工程。本轮不提交、不推送，不整合主干。

**回滚**：仅恢复本轮快照中的三个生产文件与文档，新增合同/走查单独移除；快照位于 `F:/Temp/nomi-director-alignment-20260907/`。不得对现有 547 个工作区改动执行整体还原。

**验收门**：先记录真实组件的双主题状态矩阵红例，再实现；五类片段普通/hover/selected，以及路径 active、selected+active 与把手 computed style 检查；既有相机编排真实旅程与 Electron 导演台入口走查、截图亲眼核对；类型、tokens、i18n、filesize、边界、合同与受影响导演台测试。既有门岗问题单独记录基线，不冒称全绿。

**验证结果（2026-09-07）**：

| 验证 | 结果与证据 |
|---|---|
| 修复前红例 → 修复后状态矩阵 | 修复前 140 项中 112 项失败；补齐把手断言后的最终矩阵 160 项全部通过。命令：`NOMI_BROWSER_CHANNEL=chrome node --import tsx tests/ux/director-clip-states.walk.mjs`（PowerShell 用 `$env:NOMI_BROWSER_CHANNEL='chrome'`）。证据：`tests/ux/shots/director/clip-states/{light,dark}.png`、`computed-styles.json`；修复前截图及日志在本节回滚目录。 |
| 导演台单测 | `pnpm exec vitest run src/workbench/generationCanvas/nodes/director`：33 文件、167 测试通过。 |
| 三机位真实任务 | `node tests/ux/director-j3-three-cameras.walk.mjs`：创建三机位 → 录运镜 → 创建特写 → LIVE 播放通过。 |
| 生产构建 | `pnpm run build`：renderer 和 Electron 构建通过。 |
| 真实桌面入口与输出闭环 | `node tests/ux/director-electron.walk.mjs`：新建项目 → 导演台 → 创建路径片段 → 光暗选中/悬停配色 → 截图回画布 → 运镜 MP4 喂视频 → 站位图回画布全部通过，无 console error。配色按最终 RGBA 通道比对，避免 Electron 将白色序列化为 OKLCH 导致字符串误报；主题使用共享生产语义 helper。 |
| 人眼对账 | 已亲眼检查修复前暗色红例、修复后双主题矩阵、三机位特写截图与真实桌面 `tests/ux/shots/director/electron/05-clip-colors-light.png`、`06-clip-colors-dark.png`：标签清晰，选中白边和白色拖柄在两种主题下均保留。 |
| 工程检查 | lint、typecheck、test-types、tokens、dangling-tokens、i18n、filesize、boundaries、heavy-path、root-cause-contracts、test-waits、agents-sync 等通过。导演台三份旧方案状态已修正，doc-status 与重新生成后的 ledger 检查通过。 |

**既有全仓门禁失败（未提高基线）**：`check:ponytail-review` 的 Windows POSIX 权限/脚本可执行假设不成立，相关 hook 与测试文件本轮未改；`check:vocabularies` 报 historical debt `78 > 77`，位置为 `AssistantTimeline.tsx::StepTone`；`check:walkthroughs` 报 absence-without-baseline `53 > 52`。以原扫描规则对比本轮两份走查文件及修改前快照，四类规则命中均为零，失败不是本轮新增。本轮全仓检查收据在 `F:/Temp/nomi-director-alignment-20260907/`；不把本地定向通过描述成全仓全绿或远端已解决。

