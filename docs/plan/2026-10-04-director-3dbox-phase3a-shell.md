# 3D-BOX 段 3a：开关与导演视图外壳设计卡

改动名：Director 3D-BOX shell · 线/负责人：feat/director-3dbox-shell · 类别：[新界面]

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当创作者在画布导演台里要一段预演时，开关开构建显示占画布区的导演视图；Agent 仍在右侧面板，用户浏览只读镜头条并切精修手调。空工程只显示空态，不做计划 schema、付费出片或历史并入。 | `/Users/aoqimin/Desktop/Nomi-3dbox-plans/mockups/director-3dbox-mockup.html`；真实任务走查待 3d |
| ★2 谁说了算 | 3D-BOX 开关 owner=`electron/shared/featureFlags/director3dbox.ts`；编辑工程 owner=DirectorEditor 的 store；外部写入唯一入口=`directorSessionRegistry.ts`；实测景别/运镜 owner=`directorEvalMeasurement.ts`。主进程值经 preload 同步 IPC，渲染层只消费证明。 | `node scripts/door-map.mjs director3dBoxProof`；`git grep director3dbox` |
| ★3 一致与复用 | 复用现有 DirectorViewport、DirectorEditor、EditorSplit、DirectorTopBar、directorEvalMeasurement；精修路径不新增实现。配置烘焙复用 build-electron/intake 的产物门岗形状，但开关读取规则独立为“打包只认 baked、dev 才认 env”。 | `pnpm exec vitest run ...directorSessionRegistry.test.ts ...directorEvalMeasurement.test.ts` |
| ★4 全状态 | 空：镜头条提示先让 Agent 搭预演；加载：沿用现有导演台 lazy boundary；成功：导演视图 + 实测镜头条 + 预览小窗；失败：保留现有精修错误与测量问题；部分成功：逐镜条保留可测值，未知显示未测量；取消/关闭：现有退出确认与自动保存；过期：开关证明带 `expiresOn=2026-11-15`，门岗可读。zh/en 文案都走 director locale。 | `src/i18n/locales/director.ts`；`pnpm run check:i18n` |
| 5 中途表 | 外壳只读渲染，不发起付费任务；关闭窗口沿用退出确认，编辑中的 store 由当前写者保存；Agent 外部写入在会话开启时进入 store，退出时一次写回。断网/重启不新增状态，保留旧工程。 | `DirectorEditor.tsx`；外部写入测试 |
| 6 外部数据与失败 | 烘焙文件缺失/坏值时打包默认关；preload 取不到主进程证明时强制关并记录 stderr/console；跨进程 fingerprint 不一致时强制关。实测模块遇到无相机或无主体显示未测量。 | `director3dbox.ts`；`check-packaged-flags.mjs` |
| 7 性能预算 | 镜头条测量采样 4fps，按工程时长计算；不增加视频导出帧数，也不生成大文件。真规模性能与离屏预演属于 3b/3d。 | `DirectorViewShell.tsx` |
| 8 真实条件 | macOS 真机已完成 zh/en 轨与开关关对照；真实 `t2-courtyard` 三镜工程写入、等待自动保存后重载仍保留 3 镜；Windows 与最小窗口未覆盖。第四轮代码已修复 PIP token、CTA 分割按钮与 static 词汇；同一最终构建的六张重拍仍未完成，保持 `unverified`。 | `docs/evidence/2026-10-04-director-3dbox-shell/README.md`；R13 表；CI Canvas job |
| ★9 验收与回滚 | 验收：开关门岗读包内 `feature-flags.json`、主/preload 指纹日志、导演视图 UI 单测/真机走查、开关关 core-smoke；回滚：revert 本 PR 或构建 `NOMI_DIRECTOR_3DBOX=false`，旧 DirectorEditor 外壳路径不变。 | `pnpm run build:electron`；`pnpm run test:core-smoke -- --fixture empty`；独立验收线待编排者安排 |

临时债：R13 真机截图与 Windows/英文走查，owner=3d 验收线，到期 2026-11-15；到期前未清即保持 `unverified`，不把本地绿灯写成完成。

## 样张对账 · 前三轮（已被第六轮取代）

前三轮的对账表与截图表按「手写 HTML 样张 → 照图复刻」做，五轮返工仍多处漂移；对应截图已从证据目录删除（不是同一份代码截的）。
现行整张对账表见文末「第六轮」。第三轮的外部写入持久化根因修复（`directorSessionRegistry` 同步写回节点）仍然有效。

## R13 第四轮（2026-10-04）

- 根因修复：preload 首帧同步 feature-proof 曾复用要求稳定 frame URL 的普通 IPC 守卫，阻塞首次 `loadURL`；新增仅校验登记主窗口身份/角色的 bootstrap 守卫，其他 IPC 仍走原严格守卫。
- 启动证据：修复前分支 flag-off 走查 61.49s/61.52s/61.68s 均在 Electron 启动超时；干净 `origin/main` 同命令 16.10s/13.37s/13.12s 通过；修复后分支三次 14.59s/13.44s/13.39s 通过。
- 代码门岗：`pnpm run typecheck`、`check:tokens`、`check:i18n`、`check:mockup-contracts`、`check:root-cause-contracts` 通过。
- 截图重拍：尚未完成，见证据目录 README 的明确限制；不得把旧图当作第四轮完成收据。

## R5 第五轮（2026-10-04）

- 启动链条已改为单向参数：主进程在 `BrowserWindow.webPreferences.additionalArguments` 编码 feature proof，preload 从 `process.argv` 解码并做 fingerprint 核对；删除 bootstrap IPC 与第二套 sender guard。Context7 的 Electron 官方文档确认 `additionalArguments` 会追加到 renderer `process.argv`，适合向 sandboxed preload 传递少量数据；本应用 `contextIsolation: true`、`sandbox: false` 实测可用。
- 开关取值：`NOMI_DIRECTOR_3DBOX=false` → `enabled:false, source:env, director3dbox:off:2026-11-15`；`true` → `enabled:true, source:env, director3dbox:on:2026-11-15`。打包配置 `dist-electron/feature-flags.json` 在 false 构建为 false，true 构建为 true。
- `read-only-reload`：flag-off 三次均通过（约 15.68s、其余两次均 exit 0）；flag-on 三次 15.51s、15.41s、15.43s，均通过。
- 截图：空态与精修已用最终构建重拍；三镜和 flag-off 旧图仍未全部满足最终 HEAD / 浅色模式要求，证据 README 明确标为未完成。

## 第六轮：设计实验室 + 真组件（2026-10-04 用户拍板）

**做法换了**：样张不再手写 HTML。设计实验室新屏 `director-3dbox`（`src/devlab/designLab/director3dbox/`，登记在 `labScreens.ts` 与 `tests/ux/design-lab/labStates.mjs`）每格渲染**现役 `DirectorEditor`**（开关开时默认面就是 `DirectorViewShell`，精修是同一编辑器的另一分支）+ 现役 Agent 面板（v4 实验室 `ShellStage`）。devlab 里一行界面 JSX 都不写，夹具只给三样：courtyard-standoff 计划经现役编译器编出的工程、只读开关证明桥（形状同 preload 给的那份）、点真按钮（第 2 张镜头卡 / 「精修」）。3D 场景异步落定 → 格子登记就绪持有（`labReadyHold.ts`），角色挂上、动作片段就绪才举旗，不用墙钟。拍板后生产代码就是格子里那份，不存在复刻。

**为什么用 courtyard-standoff 而不是 t2-courtyard**：任务书写「courtyard 三镜」。`S1_ORACLE_PLANS` 里 `t2-courtyard` 虽然叫 courtyard，实际是 `required: 'ground'` → room 模板 + 名叫 `subject` 的占位角色（「角色名是英文 id」的根源就是它的计划数据本身）；唯一用庭院模板、带「青衣女子 / 黑衣侍卫」的是 `courtyard-standoff`，也正是样张画的那一题（4 镜 0–4 / 4–8 / 8–10 / 10–12 秒）。所以三态里的「三镜」实为这 4 镜工程；如需严格 3 镜，换 fixture 一行即可。

格子（`capture: 'viewport'`、暗色、1280×933 = 真机走查窗口内容区）：
`d3-empty-director-zh / -en`（空工程导演视图）｜`d3-courtyard-director-zh / -en`（点第 2 镜）｜`d3-courtyard-refine-zh / -en`（精修）。
视觉基线：按实验室规矩登记为「基线待用户拍板」（`calibration.json`），拍板后 `pnpm run design-lab:update -- --screen director-3dbox`。

### 生产组件改了什么（全部只在开关开的导演视图里生效）

| 区域 | 改动 | owner |
|---|---|---|
| 顶栏 | 三列网格：左「‹ 工程名 · 镜头 N」（N = 播放头所在镜）、中「导演 / 精修」居中、右撤销重做 + 出成片；删掉多出的重置视角——它的家是精修顶栏「② 视图」簇 + 快捷键（§1.5.2 一功能一个家）；功能簇复用精修顶栏导出的 `Cluster` | `DirectorViewShell.tsx` |
| 镜头条 | 拆成 `panels/shotStrip/DirectorShotStrip.tsx`：播放行（播放/暂停 · `04.3 / 12.0s` · N 个镜头实测说明）、卡宽按时长等比、播放指针穿过当前卡、每卡「景别 · 运镜」+ 这一镜的角色动作、当前镜高亮、点卡跳到该镜开头 | 同左；文案 `shotLabels.ts`（卡、小窗、标题三处同一份措辞） |
| 实测摘要 | `model/directorShotSummaries.ts`：主体改取画面里最大的非场景件物体。旧实现取第一个对象 = 地面方块，t2-courtyard 被量成「远景/远景/全景」，现在量回「全景跟随 / 中景固定 / 特写推近」（单测钉住）。「这一镜在做什么」只取工程里真实的动作片段，没有就写「这一镜没有动作片段」，不编 | 同左 |
| 预览小窗 | **同一个 `PipViewport`**：导演视图时钉在视口左下，只一行「▷ 镜头 N · 景别 · 运镜 · 画幅」，不给机位下拉 / 焦距 / FOV / 进入视角，不可拖不可折叠；画面跟播放头的节目机位（`pipCameraIdOf(state, { followProgram })`，`PipRenderer` 同一条规则）。▷ 是状态指示不是按钮——播放的唯一入口在播放行。精修里原样 | `PipViewport.tsx` / `pipCamera.ts` |
| 视口 | 导演视图收掉机位模型 / 视锥线框、路标、把手、gizmo、视图立方（复用出片已认的 editor-only 旗；网格与地面另打「参照」旗留着），不可点选；进场时自由相机落到 `directorOverviewPose` 的俯视看全场位姿一次。角色头顶名牌 = 计划里的 `desc` | `HideEditingHelpers.tsx`、`sceneRefs.ts`、`SkyGround.tsx`、`model/directorOverviewPose.ts` |
| 开关关回归 | 外壳 className 早先丢了 `inset-x-0`，旧导演台只铺到内容宽、右侧露出画布（真机截图实测）；恢复与 main 一致 | `DirectorEditor.tsx` |
| 巨壳 | `electron/main.ts` 回到 683 行（基线同步下调）：主窗口 webPreferences（安全开关原值 + 3D-BOX 证明参数与日志）拆到 `electron/mainWindowWebPreferences.ts` | 同左 |

### 整张对账表（样张 = `director-3dbox-mockup-render.png` 上半部；实验室图 = `docs/evidence/2026-10-04-director-3dbox-shell/lab-*.png`）

| # | 区域 | 样张 | 实验室截图 | 状态 |
|---|---|---|---|---|
| 1 | 整体布局 | 导演视图占画布区，右侧 Agent 面板 | 左 858px 导演视图 + 右现役 Agent 面板（真机同） | 一致 |
| 2 | 顶栏左 | ‹ +「古装庭院对峙 · 镜头 4」 | ‹ +「古装庭院对峙 · 镜头 2」；空工程「导演台」 | 一致（N 按任务书取播放头所在镜；样张选中第 2 镜却写镜头 4，是样张自身不一致） |
| 3 | 顶栏中 | 「导演 / 精修」居中 | 同；刷新图标已删 | 一致；重置视角去向 = 精修顶栏「② 视图」簇 + 快捷键 |
| 4 | 顶栏右 | 撤销 / 重做 + 「用这段预演出成片」 | 撤销 / 重做 +「用这段预演出成片 ▾」一行，禁用并提示 | 一致；▾ 是第四五轮拍板，出片接线推迟 3b。文案超 §1.8 主动作字数，`check:controls` 红，待拍板 |
| 5 | 顶栏外形 | 999px 胶囊 | 复用精修顶栏 `Cluster`（`rounded-nomi-lg`） | 有差异：同一面同一族胶囊，不为导演视图另造一种圆角 |
| 6 | 视口 · 场景 | 示意图：院墙、院门、两人、轨迹虚线、编号机位 1–4 | 真 3D：院墙、门、树、两人，俯视看全场 | 一致（场景）；编号机位与轨迹虚线没有——任务书要求导演视图隐藏编辑用机位线框，编号机位属「选中联动」，推迟 3c |
| 7 | 视口 · 编辑辅助物 | 无视锥、无把手 | 无视锥 / 路标 / 把手 / gizmo / 视图立方 | 一致 |
| 8 | 视口 · 角色名 | 青衣女子 / 黑衣侍卫 | 同（取计划 `desc`） | 一致 |
| 9 | 视口 · 网格 | 可见 | 可见 | 一致 |
| 10 | 视口 · 角色按身份配色 | 两人不同灰度 | 两人都是默认浅灰 | **推迟到 P1（S1 编译器）**：颜色必须是工程数据（编译器写 `color`），盲评渲染与预览才是同一个 owner（方案 §7.7）；编译器此刻由 S1 线持有，本线不碰 |
| 11 | 视口 · 明暗分开 | 地面 / 墙 / 人三档 | 地面石板蓝、墙浅、门深红、树绿、人浅灰——人与墙同一亮度段 | 部分；随第 10 行一起 |
| 12 | 视口 · T 姿势 | — | 4.27 秒在播动作片段，非 T 姿势 | 3R |
| 13 | 小窗位置 | 视口左下 | 视口左下 | 一致 |
| 14 | 小窗标题 | ▷「镜头 2 · 中景 · 静止」+ 16:9 | ▷「镜头 2 · 全景 · 推近」+ 16:9 | 格式一致；值是实测（样张是计划值）。▷ 为指示不是按钮（样张是按钮）：§1.5.2 播放只留播放行一个入口。宽 280（用户可拖，样张 232） |
| 15 | 小窗不显示机位下拉 / 焦距 / FOV / 进入视角 | 不显示 | 不显示 | 一致 |
| 16 | 精修里的小窗 | 照旧 | 29mm · 16:9 · 机位下拉 · FOV · 进入视角 | 一致 |
| 17 | 播放行 | ▷「04.9 / 12.0s」「· 4 个镜头 · 下面的景别和运镜是实测值（不是计划值）」 | ▷「04.3 / 12.0s」「· 4 个镜头 · 景别和运镜是实测值（不是计划值）」 | 一致（04.3 = 点第 2 卡跳到该镜实测开头 4.25s） |
| 18 | 播放指针 | 竖线穿过卡片 | 竖线穿过当前卡（在第 2 卡左缘） | 一致 |
| 19 | 卡宽 | 按时长（flex 4/4/2/2） | 按实测时长等比 | 一致 |
| 20 | 卡 · 第一行 | 「1 · 0–4s」 | 「1 · 0.0–4.3秒」 | 有差异：时间窗是实测（4fps 采样，切点落在 4.25s）；刻度归尺子专班 #974 |
| 21 | 卡 · 第二行 | 全景·侧后方跟拍 / 中景·静止 / 特写·手部 / 越肩·慢推 | 全景·跟随 / 全景·推近 / 中近景·固定 / 中近景·推近 | 格式一致；值是实测。第 2 镜实测与计划不符、第 3 镜量的是人物不是手部锚点——这正是「实测值」要暴露的，交 S1 编译器 / 尺子专班 |
| 22 | 卡 · 第三行 | 「青衣女子走向院门」「侍卫横步挡门 · 女子藏信」 | 「青衣女子行走」「青衣女子站立 · 黑衣侍卫行走」「这一镜没有动作片段」 | 有差异：只读工程里真实的动作片段；计划的目标（院门）与语义动作（藏信）没进工程——**推迟 3b**：stage_shot 把规范化计划存进节点后改读计划 blocking |
| 23 | 当前镜高亮 | 第 2 卡蓝边蓝底 | 第 2 卡蓝边蓝底 | 一致 |
| 24 | 点卡跳到该镜开头 | 示意 | 点第 2 卡 → 播放头 4.25s、标题与小窗都变镜头 2（真机脚本断言） | 一致 |
| 25 | 卡上问题徽标 | 「已修：出画 → 拉近」 | 无 | 推迟 3b（问题清单） |
| 26 | 右侧面板 · 头部 | 「Nomi Agent · 同一个会话」 | 现役 Agent 面板头部 | 一致（布局）；文案是样张示意，面板属工作台不改 |
| 27 | 右侧 · 对话里的 stage_shot 过程卡与检查结果 | 有 | 空会话 | 推迟 3b |
| 28 | 右侧 · composer「正在改：镜头 2 · 中景」 | 有 | 无 | 推迟 3c（选中联动） |
| 29 | 精修顶栏（样张 v3） | ‹ 标题 + 工具簇 … 导演/精修 … 撤销 + 出成片 | 旧五簇 + 模式切换；858px 下 ④⑤ 簇互压（英文还压住 ①） | **冲突，需拍板**：样张 v3 是精简顶栏，方案 §7.4 写「精修 = 今天整套工具原样」。试过「放不下就换行」，第二行又压住场景对象卡的页签，已撤回；按「样张与需求矛盾就停下上报」不自选。重叠是布局 A 让出右侧后才出现的 3a 缺陷 |
| 30 | 精修 · 对象 / 属性卡、关键帧时间轴 | 原样 | 原样 | 一致 |
| 31 | 空工程 | 样张没画 | 「导演台」、小窗「还没有机位」、镜头条空态提示 | 新增（样张未覆盖） |
| 32 | 英文轨 | — | 全部走 i18n；2 秒窄卡英文被截断「Medium close · St…」 | 有差异：卡宽按时长等比的代价，悬停 / 选中看全名留到 3c |
| 33 | 开关关 | 旧导演台原样 | 全屏旧导演台，AiSceneBar 在，无 3D-BOX 外壳（真机） | 一致（修掉 `inset-x-0` 回归后） |

### 门岗与测试

- 通过：`pnpm run typecheck`、`check:tokens`、`check:i18n`、`check:mockup-contracts`、`check:filesize`（`electron/main.ts` 683 行，基线下调锁定）、`check:test-waits`、`lint:ci`；`gates:contracts` 其余各项除下两条外全绿。
- 单测：vitest `nodes/director` + 开关 60 文件 357 条（含新 `directorShotSummaries.test.ts` 7 条）、实验室注册表 3 文件 30 条。
- **`check:controls` 红（自本 PR 第一笔提交起就红，非本轮引入）**：出成片按钮「用这段预演出成片」8 字 / 英文 4 词，超过设计系统 §1.8 主动作「≤4 字 / ≤2 词」。文案是 2026-10-03 获批样张原文、任务书要求核对的那一行——样张与家规冲突，按「样张与需求矛盾就停下上报」不自选，待用户拍板（改成「出成片」+ 悬停说明，或给这颗按钮登记一条带理由的例外）。
- **实验室视觉道**：`director-3dbox` 屏按规矩登记待拍板、不比像素。全屏视觉道在本机与分支基点 `9bd8bf426`（同一 node_modules、同一台机器）对照：基点红 40 格；本分支最初红 35 格，其中 process-feedback 的 `pf-preview` / `pf-preview-dark` / `pf-fx-preview-reveal` 三格基点是绿的、分支连跑三次都红——**根因是本屏把导演台静态 import 进实验室**，导演台模块图里 `CharacterEntity` 的模块级 `useGLTF.preload` 让每一屏都去拉人偶 GLB、页面时序变了。改为轻量外壳 + `React.lazy` 动态加载后，process-feedback 失败集合与基点逐格相同（14 格），导演视图六格截图与改前逐字节相同；全屏复跑分支红 32 格 / 绿 156 格，**32 格全部在基点的 40 格里**（分支不新增任何失败）。

### 没做完

- 第 10/11 行角色配色与明暗：要编译器写数据，等 S1 线。
- 第 22 行镜头描述读计划：等 3b 把计划存进节点。
- 第 29 行精修顶栏：样张与方案冲突，待用户拍板后修重叠。
- 出成片按钮文案与 `check:controls` 的冲突：待用户拍板（见上）。
- Windows / 最小窗口 / 英文真机走查仍挂 3d 验收线（到期 2026-11-15）。
