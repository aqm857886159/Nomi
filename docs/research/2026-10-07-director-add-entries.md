# 3D 导演台「往场景里加东西」入口普查（2026-10-07）

起因：用户反馈「批量生成群众队列为什么不在加人那里；角色里弄个群众，复用加人那个东西；新的 3D 导演台有没有类似问题」。
只读调查，没改产品行为。样张在设计实验室 `director-crowd` 屏，截图在 `docs/evidence/2026-10-07-director-crowd-as-role/`。

## 一、先答用户的三个事实问题

1. **「批量生成群众队列」面板**：`src/workbench/generationCanvas/nodes/director/panels/inspector/CrowdMatrixCard.tsx:20`，
   只被 `panels/inspector/CharacterInspector.tsx:64` 用，位置是「选中一个角色 → 属性卡的「基础」页 → 最底部」。
   没有选中角色就看不到它（它是 2026-09-09 从视口底栏搬进检查器的，当时的理由是「要先选角色才有意义」）。
2. **生成的是什么**：不是新的数据类型。`model/storeEntityActions.ts:282` 的 `batchCreateCrowd`：把选中的那个角色**整个深拷贝** 行×列 份，
   全部挂在一个新建的 `type: 'group'` 对象下（名字「<原角色名>（群众组）」），原角色**留在原处不动**（所以 2×3 实际场景里多出 6 个 + 原来的 1 个）。
   拷贝的名字是 `<原名>_行xN列`。和「加人」写进的是同一张 `scene.objects` 表、同一种 `character` 实体——**数据是一套，入口是两套**。
3. **新旧导演台**：只有一个导演台编辑器（`DirectorEditor.tsx`）。3D-BOX 开关（`electron/shared/featureFlags/director3dbox.ts`，当前发布默认关）
   只决定「默认面」：开 = 先看「导演视图」（`DirectorViewShell.tsx`），点「精修」进 `DirectorRefineShell.tsx`；关 = 直接是精修布局（2026-10-04 拍板「旧导演台一起变」）。
   群众卡、「＋」菜单、检查器是精修布局里的东西，**新旧共用同一份组件**，不存在「旧面板还在、新面板另一套」。
   用户今天在打包版里看到的就是精修布局（开关关）。3D-BOX 导演视图本身**没有任何「加东西」入口**（只读镜头条 + 顶栏出片）。

## 二、「加人」现状

- 入口：精修顶栏 `＋`（`panels/topbar/AddObjectMenu.tsx:30`，由 `RefineTopBar.tsx:70` 挂）→「角色」→ 女人 / 男人。
- 点了以后不是「确认」，是进**放置模式**：`startPlacement`（`AddObjectMenu.tsx:74`）→ `scene/creation/useCharacterPlacement.ts`，
  在地面点一下放下、按住拖动定朝向、右键 / Esc 取消；落地走 `store.addObject`（`useCharacterPlacement.ts:79`）。
- 支持的角色类型：只有 女人 / 男人，而且 `CHARACTER_MODEL_BY_GENDER`（`useCharacterPlacement.ts:26`）里两者是**同一个模型** `builtin:x-bot`，只差颜色。
  所以「加人」菜单里**没有确认按钮、没有数量**——用户说的「确认按钮就是加人原来那个」不存在，样张里群众的主按钮是新增的（见第四节）。

## 三、入口普查表

「数据写到哪」一栏都是 `director` store 的当前图层（`scene.objects / cameras / lights`）。

| # | 加什么 | 入口位置 | 组件 | 数据写到哪 | 重复 / 各自一套？ |
|---|---|---|---|---|---|
| 1 | 角色（女/男） | 顶栏＋ →「角色」 | `AddObjectMenu` `:137/141` → 放置模式 | `addObject` type=character | 唯一入口（资产库里的重复份 2026-10-04 已删） |
| 2 | **群众** | 先选中角色 → 属性卡「基础」页最底 | `CrowdMatrixCard` | `batchCreateCrowd`：group + N 个 character 拷贝 | **独立一套**：入口藏得深、要先有角色、与「加人」菜单无关；这是用户反馈的那条 |
| 3 | 机位 | 顶栏＋ →「机位」→ 14 个预设（相对选中主体） | `AddObjectMenu` `:46` | `addCamera` | 另有时间轴「特写」（`DirectorTimeline.tsx:181`）从角色派生一个机位，是「镜头语义」不是「加机位」，可接受 |
| 4 | 灯 | 顶栏＋ →「灯光」→ 3 种 | `AddObjectMenu` `:67` | `addLight` | 唯一入口。`store.duplicateLight`（`storeEntityActions.ts:434`）有实现但**没有任何界面调用**（死动作，建议删） |
| 5 | 方块 | 顶栏＋ →「方块」→ 画框模式 | `AddObjectMenu` `:80` → `scene/creation/useBoxDraw.ts:74` | `addObject` type=cube | 与资产库「内置几何体 · 立方体」（#6）**同类物体两个家**：一个手画尺寸、一个原点放默认尺寸 |
| 6 | 内置几何体（立方体/球/…共 8 种）+ 辅助球 | 顶栏＋ →「资产库」→ 抽屉 → 内置 → 点一下 | `AssetsTab.tsx:147 addBuiltin` | `addObject` 原点放置 | 见 #5；另它藏在「＋ → 资产库」两层之后，别的物体都在＋第一层 |
| 7 | 外部模型 / 泼溅 | 资产库抽屉：导入或点已有素材 | `AssetsTab.tsx:165 addFileAsset` | `addObject` type=model/splat | 唯一入口 |
| 8 | 全景天空 | 顶栏＋ →「导入 720 全景」；资产库里的全景素材 | `AddObjectMenu` `:123` + `usePanoramaImport` / `AssetsTab` | `patchPanoramaConfig`（设置天空，不是加物体） | **两个入口写同一处**，前者导入新文件、后者复用资产库已有的，合理但文案都叫「全景」 |
| 9 | 场景 JSON 图层 | 资产库抽屉 | `AssetsTab.tsx:165` | `importScene` | 与大纲「新建层」（#10）都是加图层，一个导入一个空建 |
| 10 | 图层 | 顶栏「图层名 ▾」浮层 → 大纲底「＋ 新建层」 | `SceneObjectsTab.tsx:273` | `createSceneLayer` | 唯一 |
| 11 | 复制 | `Ctrl+D`；大纲行菜单「复制到图层」 | `useDirectorHotkeys.ts:116` / `SceneObjectsTab` | `cloneObject` / `copyEntitiesToScene` | 灯与机位不能 Ctrl+D 复制，只有物体可以 |
| 12 | 成组 | `Ctrl+G`；大纲多选条「打组」 | `useDirectorHotkeys.ts:79` / `SceneObjectsTab.tsx:279` | `groupObjects` | 两个入口同一动作，OK |
| 13 | 轨道 | 时间轴头「＋ 添加轨道」 | `timeline/TrackList.tsx:156` | `addEntityToTimeline` | 唯一 |
| 14 | 片段（动作 / 姿态 / 看向 / 特写 / 追加轨迹） | 轨道行「＋」菜单；右键菜单 | `DirectorTimeline.tsx:218 addClipMenu` | `addActionClip` 等 | 轨道「＋」与右键菜单两个入口同源 |
| 15 | 路标 / 画线路径 | 选中角色或机位后属性卡头的「画线 / 逐点」 | `ContextCard.tsx:44` | 路径点写进该实体 | 唯一；快捷键 4 / 5 同一动作 |
| 16 | AI 搭场景 | 视口底部中央胶囊（仅精修，导演视图关） | `panels/ai/AiSceneBar.tsx` | `storeAiSceneActions` 批量物化 | 与手动加物体是「一键多物」，数据落同一张表 |
| 17 | 镜头（shot） | **没有手动入口**：导演视图的镜头条只读，镜头由 Agent 编计划产生 | `DirectorShotStrip.tsx` | 计划 → 编译器 | 不是重复，是缺口（用户自己加镜头得靠 Agent） |

**结论：**
- 真正「独立一套、该并进去」的只有**群众**（#2）。道具 / 灯 / 机位都已各只有一个家，**没有第二个「批量生成」面板**。
- 次一级的不统一（不在本次样张里改，列给用户拍板）：#5 与 #6（同一类物体两个家、一个在＋第一层一个在资产库里）；#4 死动作 `duplicateLight`；#11 灯 / 机位不能复制。
- 3D-BOX 新导演视图本身没有「加东西」入口，所以新界面没有这类重复；问题全在精修布局（也就是现在的「旧」导演台）。

## 四、群众并进「加人」的样张方案（设计实验室 `director-crowd` 屏）

- 「＋」→「角色」多一项「群众 ›」；点开在**同一个浮层**里展开 行数 / 列数 / 间距（复用 `SliderNumberField`），底部一颗全宽主按钮。
- 主按钮文案样张写「放置群众」而不是「确定生成」：因为「加人」本来就是「点一下选好、再到地面点位置」，群众走同一个放置模式
  （点地面 = 行列中心落点），这样**不需要先有一个角色当模板**，也不再有「原角色留在原处」的多余一个。
  这一条和用户原话「确认按钮就是加人原来那个」有出入（原来没有确认按钮），请用户确认。
- 模板：现在群众是复制「选中的那个角色」。并进去以后没有「选中的角色」，用默认角色（和加人同一个 `builtin:x-bot`）。如果用户希望「复制我调好的某个角色成群众」，那是另一个入口（对选中角色「复制成阵列」），本样张不含。
- 加进场景以后两种形态各一格：
  - **A 一组**（现状数据形态）：大纲一行「群众组」可折叠，点它整体选中 / 移动 / 隐藏 / 锁定 / 删除，组内每个人仍能单独点出来改。
  - **B N 个独立角色**：大纲 N 行，要整体动得先多选（样张里选中条的「打组」随时可补）。

## 五、顺手查到的界面规范问题（按统一规范逐条）

| 规范 | 位置 | 现状 | 判定 |
|---|---|---|---|
| 决定栏主动作在最右、取消在左 | 大纲多选条 `SceneObjectsTab.tsx:279` | 一排纯文字链：打组 / 显示隐藏 / 锁定 / **删除（红）/ 取消**，窄栏下「取消」折到第二行靠左（见 `crowd-06-*` 截图左下） | 不合：删除不在最右隔开，取消夹在动作后面且会折行 |
| 同类控件全仓一个组件 | 同上、`新建层`、资产库「新建文件夹」、`AssetsTab.tsx:364` | 全是裸 `<button>` + `text-nomi-accent hover:underline`，没走 `WorkbenchButton` | 不合：同类文字按钮多套写法（panels 里裸 `<button` 共 14 处在 SceneObjectsTab） |
| 子菜单返回 | `AddObjectMenu` 各子菜单 | 「← 角色」是一行文本 `PopoverItem`，机位子菜单额外多一行 accent 色说明 | 轻微：返回行没有统一图标件 |
| 主按钮 | `CrowdMatrixCard` 的「确定生成」 | 全宽居中主按钮，唯一一处全宽主按钮 | 与其它卡不一致（其它卡的动作在卡头图标）；并进「加人」后这条自动消失 |
| ✓ 只表状态 | 导演台内 | 未发现把 ✓ 当动作的用法 | 合 |
| 动作条常用左、删除最右隔开 | 时间轴右键菜单 / 大纲行菜单 | 大纲行菜单里删除在末尾；多选条见上 | 行菜单合，多选条不合 |

以上规范问题本次**只登记、不改**。
