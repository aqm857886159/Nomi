# 导演台精修：选中才出（方向 A）设计卡

改动名：Director refine · select-to-show · 线/负责人：`feat/director-refine-select-to-show`（Opus 设计实现线）· 类别：[新界面]

> 状态：**用户已拍板（2026-10-04），已切真实入口**。3D-BOX 开关开时的「精修」与开关关时的旧导演台都渲染 `DirectorRefineShell`；旧右栏双卡 `SidePanels`、旧顶栏 `DirectorTopBar`、样张期接缝 `refineLayoutPreview.ts` 已同 PR 删除（P1）。实验室：`pnpm run dev:renderer` 后开 `/design-lab.html?screen=director-refine`（接触表加 `&contact=1`，单格 `&state=<id>&frame=1`）。
>
> 用户已拍板（2026-10-04）：精修走方向 A——3D 视口满宽，**点谁，谁的属性卡才出来**；场景树 / 资产 / 场景设置各一次点击可达；**旧导演台一起变，不分两套**；顶栏 ④⑤ 两簇互压在同一 PR 解决。导演视图布局 A 已定。
>
> 样张后用户再拍板六点（2026-10-04）：①大纲并进「▤ 图层名 ▾」浮层；②画线 / 逐点放在角色、机位卡头；③机位视角下取景框被卡盖住 → 做「画面中心偏向未被遮挡区域」，**单独排期，本 PR 不做**（见文末「后续」）；④「录制 MP4」并进右上「产出」菜单，录制中产出图标换成 k/N 帧并可点取消；⑤窄壳下图层名只留图标、全名在悬停；⑥精修里的预览小窗也挪到左下，与导演视图同位、同一组件。

## 九格

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当创作者在精修里要「改一个地方」（挪人、换焦段、推迟一个动作、加灯）时，我想打开就看到整个场景、点谁谁的属性才出来，以便主体不被面板切半、改完就走。步骤：①进精修，视口满宽、右边空着 ②在 3D 里或「场景 ▾」里点一个东西 ③右侧冒出一张按内容算高的属性卡（就是原来的检查器，字段一个不改）④拖箭头或改数 ⑤点空白 / × / Esc 卡收走。**不做**：不改检查器内部字段、不改时间轴比例与折叠、不加「钉住」开关（先少后加）、不修编译器（AI 工程「轨道列表 (0)」归 S1 线）。**已知坑**：机位视角里卡片会盖住取景框右侧（K5，见下「没做完」）；AI 编出来的工程时间轴没有轨道，选片段要先「＋添加轨道」。**三条真实任务**（夹具 = `evals/director/s1OraclePlans.ts` 的庭院对峙经现役编译器编出的工程）：T1 把黑衣侍卫往门口挪 1 米并转向面对女子；T2 把镜头 2 的机位改成 50mm 并让两人都在框里；T3 把女子走路动作推迟 1 秒，再加一盏灯。 | 实验室屏 `director-3dbox` 的 `d3a-*` 格；点击路径见文末 |
| ★2 谁说了算 | 选中态 → `model/directorStore` 的 `selection`（唯一 owner），卡片显隐 = 由它 derive（找得到选中的物体 / 机位 / 灯），不另存「卡开没开」，× = `clearSelection()`。新增两个瞬态概念，owner 都是 `DirectorRefineShell` 的本地状态：「场景设置卡开着」（选中实体时自动让位）与「资产库抽屉开着」。导演 / 精修模式 → `DirectorEditor` 的 `viewMode`（不变）；模式切换钮、撤销 / 重做、退出钮 → 新共享组件 `panels/topbar/shellChrome.tsx`，导演视图与精修同用，删掉 `DirectorViewShell` 里那份抄本。toast 避让变量 `--nomi-director-side-width` 的写者从右栏改为属性卡（只在卡出现时让）。碰 6 个概念，新增 2 个瞬态、合并 1 组重复 UI。 | `node scripts/door-map.mjs clearSelection`（director 内写入口 5 扇：壳 Esc、大纲多选条、两个创建模式、新卡 ×） |
| ★3 一致与复用 | 检查器（`ContextInspector` 及其下 20 多个卡）、大纲（`SceneObjectsTab`）、资产库（`AssetsTab`）、添加菜单、视图菜单、浮层原语（`panels/Popover`）、顶栏胶囊（`Cluster`）全部原样复用，只换宿主。外部先例：three.js editor 没选中时隐藏属性面板、Theatre.js 的 Details 只跟选中走、Blender 的叠加侧栏是单列且可开关——方向 A 与它们同向。没有引入新依赖，也没有第二份检查器定义。 | `git grep -n "ContextInspector\|SceneObjectsTab\|AssetsTab" src/` |
| ★4 全状态 | 空工程：视口满宽，右边空，「＋」与「场景 ▾」可用，大纲显示「暂无实体」；空闲（有内容未选中）：无卡；选中角色 / 物体 / 机位 / 灯：右侧一张卡，标题 = 对象名 + ×；选中片段 / 路标 / 骨骼关键帧：同一张卡换成对应卡（时间轴选中优先）；场景设置：「场景 ▾ → 场景设置」打开同一张卡；资产库：「＋ → 资产库」打开左侧抽屉；加载：沿用导演台懒加载边界；失败：沿用检查器与资产导入的现有错误；取消：Esc 先关浮层、再清选中（卡随之消失）、再退机位视角、再退出确认（壳的既有 Esc 归属不变）；过期：不适用——没有新增持久状态。所有新文案走 `src/i18n/locales/director.ts`，zh / en 两轨。 | 实验室格清单；`pnpm run check:i18n` |
| 5 中途表 | 本改动不发起任何付费 / 长跑任务，只换宿主。停：卡与抽屉是瞬态，关窗口后不留；关窗口：沿用退出确认 + 自动保存（工程写回不变）；断网：无网络调用；重启：选中态与抽屉不持久，回到空闲；连点：卡显隐只跟 `selection` 走，连点同一对象不会叠出第二张卡，「场景设置」重复点仍是同一张。花费：全部「不扣」。 | `DirectorRefineShell.tsx` 头部；人工 |
| 6 外部数据与失败 | 外部来源只有工程本身（AI 编译器写的工程、旧工程、用户导入的场景 JSON）。选中 id 指向不存在的对象时（删除 / 撤销后），卡按 `findObject/findCamera/findLight` 找不到就不出现，不会出现空卡。资产导入失败沿用 `AssetsTab` 的 toast。 | `ContextCard.tsx` 的显隐判据 |
| 7 性能预算 | 卡片显隐是一次 React 挂载 / 卸载，检查器本身不变；视口宽度不随卡变（卡是浮层），3D 画布不因选中而 resize。真规模（13 个对象 + 5 个辅助物的庭院工程）下，选中到卡出现 1 帧内。没跑性能门岗。 | 人工（实验室格）；`unverified`：大工程 |
| 8 真实条件 | Windows：实验室格与浏览器 devlab 走查都在 Windows 上跑（Chromium + SwiftShader）；英文界面：有；最小窗口：用 Agent 面板加宽把壳压到 728 的窄格；真规模：庭院对峙 4 镜 12 秒；干净安装 / 真付费：不适用；键盘全程：Esc 链（浮层 → 选中 → 机位视角 → 退出）走查 j8 断言。**真 Electron 构建 + 真 Agent 面板那一遍没跑**：用户在用电脑，`pending-real-app`。 | `docs/evidence/2026-10-04-director-refine-select-to-show/`；`tests/ux/director-refine-tasks.walk.mjs` |
| ★9 验收与回滚 | 验收：另一条线按本卡逐格核 `?screen=director-refine` 的 `d3a-*` 格 + 浏览器走查 j1–j8 / assets / ai / model-import / refine-tasks 串行全绿 + 真 App 三条任务（pending-real-app）。回滚：revert 本 PR 的切换提交（旧右栏双卡与旧顶栏随之回来）。独立验收报告：由协调会话指派。 | `## 独立验收` 待补 |

## 先查别人

这次改的是导演台的**布局**（选中才出属性卡、按需面板、顶栏收拢），交互范式和控件都不自造：

1. **依赖里已有？** `@mantine/core`（package.json:293）的 Popover / Drawer，以及 `@radix-ui/react-dropdown-menu`（package.json:299）。导演台已有自己的浮层原语，并且挂接了「浮层 → 按需面板 → 选中 → 机位视角 → 退出」这条 Esc 让路协议（`data-nomi-escape-layer`）。改用 Mantine / Radix 等于再接一套 Esc 与焦点规则，两套会漂移，所以不引入。
2. **仓库里已有？** 导演台浮层原语 `src/workbench/generationCanvas/nodes/director/panels/Popover.tsx:54`（`Popover` / `PopoverItem`），本 PR 的「▤ 图层名 ▾」大纲浮层、「产出」菜单都复用它（`panels/outputs/OutputsPopover.tsx`）。属性卡里的字段原样复用现有检查器：`panels/fields/FieldPrimitives.tsx:19` 的 `InspectorCard`，以及 `panels/inspector/*Inspector.tsx`。只新增布局壳 `DirectorRefineShell.tsx` 和两颗小 hook（已登记在 `docs/engineering/self-written.json` 的 `director-refine-panel-hooks`）。
3. **生态里已有？** 「选中对象 → 出上下文属性面板、视口尽量满」是 3D 编辑器的通行做法：three.js editor（https://threejs.org/editor/ ，右侧 Sidebar 随选中对象切换属性页）、Blender 属性编辑器（https://docs.blender.org/manual/en/latest/editors/properties_editor.html ，按选中对象显示上下文页签）、Unity Inspector（https://docs.unity3d.com/Manual/UsingTheInspector.html ，只显示所选对象的组件）。本 PR 采用同一范式，取景空间优先：没选中时不占任何侧栏。
4. **自媒体怎么说？** 不适用：这是自有工具的布局调整，没有供应商或模型相关的讨论可查。

## 顶栏怎么排（④⑤ 互压的解法）

今天精修顶栏 6 簇实测自然宽 865（中文）/ 897（英文），可用只有 834，④「添加与历史」和 ⑤「交付」互相压住（实验室实测 1–2 处重叠）。新顶栏四簇：

- 左：`[← 退出 | ▤ 图层名 ▾]` ＋ `[选择 移动 旋转 缩放 | ＋]`。退出与导演视图同一颗 ←；「▤ 图层名 ▾」点开是大纲（图层、对象树、搜索），底部「场景设置」；「＋」底部「资产库」。
- 中：`[导演 | 精修]`（开关开时才有；与导演视图同一个共享组件、同居中）。
- 右：`[视图 ▾ | 撤销 重做 | 截图 产出]`，「视图 ▾」首项「重置视角 0」；「产出」菜单首行「录制 MP4」，录制中产出图标换成「■ k/N」点它取消。
- 顶栏比 760 窄（壳 ≈ 728）时图层名收起、只留 ▤ 图标，全名在悬停里（量顶栏外框宽，外框宽由壳给、不被内容撑，没有测量回环）。

画线 / 逐点不在顶栏，住选中角色 / 机位的属性卡头：放顶栏按选中显隐会让左列变宽、居中的「导演 | 精修」跟着跳约 80px（第一版样张实测）。三列网格两侧列用 `minmax(max-content, 1fr)`（inline style）：放得下时模式切换正好居中，放不下时让位，簇与簇永不重叠。实测自然宽 652（中文）/ 689（英文），728 窄壳里也不重叠。

## 切换时一起改的（同 PR）

- 删：`panels/refineLayoutPreview.ts`、`panels/side/SidePanels.tsx`、`panels/topbar/DirectorTopBar.tsx`；`ViewMenu` 的 ◐ 图标触发器、`ViewportToolbar` 里的画线 / 逐点、`AddObjectMenu` 的文字触发器、时间轴头的「录制 MP4」；退役键 `director.side` / `nomi:director:sideWidth` / `nomi:director:sideCollapsed` 与 9 个没人用的文案键。
- 小窗：布局改按「左 + 底」记（新键 `nomi:director:pip:v3`，旧 v2 存的是「左 + 顶」，不读，老用户回到左下默认）；机位视角卡（POV HUD）从左下挪到左上顶栏之下，左下让给小窗。
- 浮层原语 `panels/Popover`：浮层里的浮层（大纲行 ⋮ / 右键菜单 / 图层菜单，现在都住在「▤ ▾」浮层里）向父浮层登记——不登记的话点子菜单会被父浮层当外点、连自己一起关掉；Esc 一次只收最里层；浮层里的输入框（大纲搜索）自己处理 Esc。走查 j8 抓到的。
- 设计实验室：`director-3dbox` 屏删掉两格旧精修（连同基线），精修只在 `director-refine` 屏；格子 coverage 改 `shell`；基线按 darwin 录，Windows 线不录，登记在 calibration 待录。
- 走查：`_directorLab.mjs` 加 `openOutliner / closeOutliner / pickInOutliner / openAssets`；j1–j8、assets、ai、model-import 改走「▤ ▾」浮层和「＋ → 资产库」抽屉，j6 的录制 MP4 改走「产出」菜单；Electron 走查（electron / mobile / windowbar / freeze-sweep）同步选择器但这一轮没跑（用户在用电脑）；新增 `director-refine-tasks.walk.mjs`（三条任务，无头）。

## 样张对账（方案控件归位表逐行；截图都在 `docs/evidence/2026-10-04-director-refine-select-to-show/`，旧样子 = `before-legacy-refine-*.png`）

| 控件 | 方案里的去处 | 样张里 | 截图 | 结果 |
|---|---|---|---|---|
| 选中后的属性（角色三页签 / 机位 / 灯 / 物体 / 片段 / 路标） | 选中才出的上下文卡 | 右侧属性卡，检查器原样，标题 + × | `d3a-guard-*`、`d3a-guard-pose-zh`、`d3a-guard-skeleton-zh`、`d3a-camera-pov-*`、`d3a-clip-zh` | 通过（卡宽 320，不是方案的 300：字段标签列 64 + 三轴数字框要这个宽） |
| 场景环境 / 网格 / 全局变换 | 图层 ▾ →「场景设置」 | 「▤ 图层名 ▾」浮层底部「场景设置」→ 同一张卡 | `d3a-scene-settings-*` | 通过；中文标签不再截断（字段标签列 52→64），英文长标签仍截断、悬停看全名 |
| 场景对象大纲 | 「对象 ▾」弹层 | 并进「▤ 图层名 ▾」一个浮层（图层与对象本来就在同一棵树里） | `d3a-scene-menu-*` | 通过（用户拍板①） |
| 资产库 | ＋ 菜单底部「资产库」→ 抽屉；删两个重复文件夹 | 同；抽屉在左，压在小窗上 | `d3a-add-menu-zh`、`d3a-assets-*` | 通过 |
| 工具 选 / 移 / 转 / 缩 | 顶栏第二簇 | 同（格子收窄） | 所有格 | 通过 |
| 画线 / 逐点 | 选中角色或机位时出现在工具簇尾 | 选中角色或机位时出现在属性卡头 | `d3a-guard-*`、`d3a-camera-pov-*` | 通过（用户拍板②） |
| 视图 ▾（含重置视角） | 文字「视图 ▾」，首项重置视角 | 同 | `d3a-view-menu-zh` | 通过 |
| 截图 / 产出 / 录制 MP4 | 全进交付一个家 | 截图 + 产出在右簇，「产出」菜单首行「录制 MP4」，录制中产出图标换成「■ k/N」点它取消；时间轴头的录制钮已删 | `d3a-outputs-menu-*`；录制中的样子由走查 j6 断言（实验室无编码桥，不出静态格） | 通过（用户拍板④） |
| 小窗 | 左下 220–280 | 左下、宽 280，与导演视图同一个角、同一组件；可拖、按「左 + 底」记 | 所有格；走查 `director-refine-tasks` 断言贴左下 | 通过（用户拍板⑥） |
| 时间轴 | 不变 | 不变 | 所有格 | 通过；AI 工程「轨道列表 (0)」归 S1 线 |
| 退出 / 导演·精修 / 撤销重做 | 一份共享组件、两模式同位置 | `shellChrome.tsx`，导演视图改用它（与改前逐像素一致，0 像素差） | `d3a-idle-*` | 通过 |
| 角色头部标签 / 切图层去重 | 各只留一个家 | 标签只在视图 ▾；切图层只在大纲图层行 | `d3a-scene-settings-*`、`d3a-scene-menu-*` | 通过 |
| 旧导演台（开关关） | 一起变 | 同一个壳，没有模式切换，底部 AI 搭场景入口照旧 | `d3a-legacy-guard-zh` | 通过 |
| 空工程 | 空闲提示、＋ 可达 | 视口正中一句「点顶栏 ＋ 加角色、机位或灯光」 | `d3a-empty-zh` | 通过 |
| 窄壳图层名 | — | 顶栏窄于 760 时只留 ▤ 图标，全名在悬停 | `d3a-narrow-*` | 通过（用户拍板⑤） |
| 机位视角卡 | — | 从左下挪到左上（左下归小窗） | `d3a-camera-pov-*` | 通过 |

## 量化（实验室里量 DOM，858 宽壳；「可见可点 3D」= 视口取样点里点得到画布的比例）

| 指标 | 今天 | 新：空闲 | 新：选中角色（基础页，最高的卡） | 新：场景设置 | 728 窄壳 空闲 / 选中 |
|---|---|---|---|---|---|
| 可见可点 3D | 42.6% | 88.1% | 53.9% | 69.2% | 86.0% / 45.5% |
| 首屏可点控件 | 49–50 | 29 | 72（多出来的都在卡里） | 48 | 29 / 72 |
| 顶栏自然宽 · 簇重叠 | 865–897 · 1–2 处 | 652–689 · 0 | 同左 | 同左 | 0 处 |

## 三条真实任务（`tests/ux/director-refine-tasks.walk.mjs`，浏览器 devlab 无头跑，真鼠标点真按钮，结果从工程存档读回核对）

- T1 侍卫朝女子挪近 1 米并转身面对她：「▤ ▾ → 黑衣侍卫」2 → 卡里「只读（先插关键帧）」→「加关键帧」1 → 卡换成「轨迹关键帧」，在位置 / 朝向框里填数 → × 收卡 1。**4 次点击 + 输入**，通过（检查器与 3D 包围盒都挪了 1 米、主体没被卡盖住）。原题「往门口挪」在这份工程上不成立：庭院对峙里侍卫开场就站在院门口。
- T2 medium 改 50mm 并进它的视角：「▤ ▾ → medium」2 →「50mm」1 →（小窗还在 wide）小窗机位下拉 2 → 进入视角 1 → 收卡看全取景框 1。**7 次点击**，通过；断言小窗贴左下。**发现**：选中机位不会把小窗切过去，「进入视角」进的是小窗那台——要么选中机位时小窗跟过去，要么卡里给一颗「进入视角」（少 2 下），待拍板。「两人都在框里」只看截图、没做断言。
- T3 女子走路推迟 1 秒再加一盏灯：「＋ 添加轨道 → 青衣女子」2（AI 工程没有轨道，S1 线修好后省掉）→ 按下走路片段 1 → 卡里「开始」+1 秒（1 + 输入）→「＋ → 灯光 → 点光」3。**7 次点击 + 输入**，通过。
- 真 App（Electron + 真 Agent 面板）那一遍：**pending-real-app**（用户在用电脑，等协调会话安排）。

## 后续（登记，不在本 PR）

- **机位视角取景框避让（用户拍板③，单独排期）**：进机位视角时取景框按整块视口居中，属性卡会盖住框右侧约三分之一。做法 = 画面中心偏向未被遮挡的区域：壳发布一份「没被浮层盖住的矩形」，相机投影用 `setViewOffset` 把中心挪过去，`AspectGuide` 的框按同一份矩形画、FOV 补偿用同一份尺寸（一个 owner）。验收格 = `d3a-camera-pov-*`（今天如实展示被盖的样子）。
- **选中机位时小窗跟不跟过去**：见 T2 的发现，待拍板。

## 没做完（明着标）

- **视图立方**：挪到了右下（右上是卡出现的地方），但实验室里新旧布局都看不到视图立方，疑似现役就没画出来，记 `unverified`，不归本线修。
- **窄壳 + 长图层名**：窄壳只留图标后这一条已不存在；858 宽、英文、图层名超过约 8 个字母时名字截断（悬停看全名）。
- **K4「吸附」改名**：没做（不影响布局）。
- **Electron 走查**（director-electron / mobile / windowbar / windows-freeze-sweep / 3dbox-shell）：选择器已同步，没跑——用户在用电脑，`pending-real-app`。
- **视觉基线**：`director-refine` 屏的逐像素基线要在 darwin 上录，登记在 `tests/ux/design-lab/calibration.json` 待录。

## 追加：选中机位，左下小窗自动切过去（2026-10-05，用户拍板，T2 的待拍板项）

| 格 | 结论 |
|---|---|
| ★1 用户怎么用 | 创作者在精修里点一个机位（3D 里点、大纲里点、时间轴机位轨点都算），左下小窗立刻播这个机位的画面，直接点小窗「进入视角」，不再先去小窗下拉里换一次。T2 点击 7 → 5（省掉小窗下拉 + 选项两下）。选中角色 / 灯 / 物体 / 片段，小窗不动；取消选中，小窗停在最后那台，不跳回。**不做**：不改导演视图（它永远跟播放头，见下）、不加「钉住小窗」开关。 |
| ★2 谁说了算 | 「小窗显示哪个机位」的唯一状态仍是 `directorStore.previewCameraId`，唯一读口仍是 `scene/pipCamera.ts` 的 `pipCameraIdOf`。唯一新写口：`store.select`（`directorStore.ts` select）在选中机位时顺带写它，所有选中机位的入口（3D 点击、大纲、时间轴、进入视角、新建机位）自动同一行为，没有第二份状态、没有各处补写。小窗下拉仍可手动覆盖（写同一个字段）。 |
| ★3 一致与复用 | 复用已有字段与选台函数，零新概念、零新组件、零依赖；导演视图本来就只跟播放头（`followProgram`），不读 `previewCameraId`，所以不会和这次互相打架（单测断言）。 |
| ★4 全状态 | 播放 / 录制中：`pipCameraIdOf` 先判播放，小窗跟播放头的节目机位，此时选中机位只写 `previewCameraId`、不抢画面；停下后小窗露出最后选中的那台。**理由**：播放时小窗是「正在播哪一镜」的监视器，被选中抢走会让创作者误以为那一镜在播那台机位；停下后「我正在改的那台」才是他要看的。导演视图：不动。选中的机位被删：沿用 `directorStore` 既有的 `previewCameraId` 回落（第一台）。重复点同一台：仍会把小窗拉回它（下拉改过之后）。 |
| ★9 验收与回滚 | 验收：`scene/pipCamera.test.ts` 4 条（选机位切 / 选角色不动 / 播放与停止优先级 / 导演视图不跟）；无头走查 `tests/ux/director-refine-tasks.walk.mjs` T2 断言小窗为 medium 且点击数 = 5；实验室格 `d3a-camera-follow-zh/en`，截图 `docs/evidence/2026-10-05-refine-preview-follows-camera/`。回滚：revert 本提交（`select` 里一行）。 |
