# 导演视图（3D-BOX）外壳 · 第六轮证据（2026-10-04）

**截图所用代码 = 本轮合入 `origin/main` 后的任务分支（按钮文案与实验室就绪修复）**（feat(director): 导演视图按样张改生产组件并立设计实验室屏）。
之后还有两笔非生产代码提交：`a928f2767`（取证脚本超时改用站点预算，数值不变）、`63985de4f`（实验室格子改为动态加载）；后者之后重截的实验室六张与本目录逐字节相同（`cmp` 校验）。每张 1280×933 PNG、均 < 400 KB，逐张人眼 Read 过。
前五轮的旧图（`zh-*.png` / `en-*.png` / `flag-off-legacy-director.png`）已删：它们不是同一份代码截的，留着会被当成本轮收据。

工程 = S1 oracle 计划 `courtyard-standoff`（`evals/director/s1OraclePlans.ts`）经现役编译器编出来的 4 镜 12 秒庭院对峙——样张画的就是这一题。
实验室与真机注入的是同一份编译结果；「点第 2 镜」是点界面上那张真卡片（播放头跳到第 2 镜开头 4.25s → 量化后读数 04.3）。

## 设计实验室（`design-lab.html?screen=director-3dbox&frame=1&state=<id>`，生产组件 + 只读桥）

| 文件 | 状态 id | 一句话判断 |
|---|---|---|
| `lab-zh-empty-director.png` | `d3-empty-director-zh` | 空工程：顶栏「‹ 导演台」+ 居中「导演/精修」+ 撤销重做 + 出成片；小窗左下「还没有机位」、页脚「▷ 节目预览 · 16:9」；镜头条只剩空态提示。对上布局 A。 |
| `lab-zh-courtyard-director.png` | `d3-courtyard-director-zh` | 「古装庭院对峙 · 镜头 2」；俯视看全场（院墙、门、树、青衣女子 / 黑衣侍卫名牌），无机位线框/把手/视图立方；小窗「▷ 镜头 2 · 全景 · 推近 · 16:9」；播放行「04.3 / 12.0s · 4 个镜头 · 景别和运镜是实测值（不是计划值）」；4 张卡按时长等比、第 2 张高亮、播放指针穿过它。对上样张 v2；景别运镜是实测值（第 2 镜与样张计划值不同，见对账表）。 |
| `lab-zh-courtyard-refine.png` | `d3-courtyard-refine-zh` | 精修 = 旧整套工具 + 模式切换；小窗照旧（29mm · 16:9 · 机位下拉 · FOV · 进入视角）。**顶栏 ④⑤ 簇在 858px 宽下互相压住**——已知缺陷，见对账表第 29 行。 |
| `lab-en-empty-director.png` | `d3-empty-director-en` | 英文空态：Director/Refine、Produce from this preview、No cameras yet、▷ Program。对上。 |
| `lab-en-courtyard-director.png` | `d3-courtyard-director-en` | 「Courtyard standoff · Shot 2」「Shot 2 · Wide · Push in」；第 3、4 张 2 秒窄卡的英文被截断成「Medium close · St…」（卡宽按时长等比的代价）。 |
| `lab-en-courtyard-refine.png` | `d3-courtyard-refine-en` | 英文精修；顶栏重叠比中文更重（①场景簇被模式切换压住、④⑤互压）。 |

## 真机（Electron dev，渲染端为同一份源码的 vite dev，主进程 `NOMI_DIRECTOR_3DBOX=true|false pnpm run build:electron` 后）

取证脚本 `tests/ux/director-3dbox-shell.walk.mjs`（`pnpm exec tsx` 跑，用法见文件头）：项目库「新建空白项目」→ 生成页「新建画面」→ 左缘加导演台节点 → 经 E2E 画布桥把同一份编译工程写进节点 → 「进入导演台」→ 点第 2 张卡 →（开关开）点「精修」。

| 文件 | 一句话判断 |
|---|---|
| `real-zh-courtyard-director.png` | 与 `lab-zh-courtyard-director.png` 同一画面（脚本另断言标题与小窗都落到「镜头 2」）；右侧是真工作台的 Agent 面板（含首次运行的匿名分享卡）。 |
| `real-zh-courtyard-refine.png` | 与实验室精修同一画面，顶栏重叠同样存在。 |
| `real-flag-off-legacy-director.png` | 开关关：全屏旧导演台（五簇、无「导演/精修」、AiSceneBar「描述场景…」在、X Bot T 姿势在 0 秒），脚本断言没有 3D-BOX 外壳。修掉了本分支早先的回归（外壳丢 `inset-x-0`，旧导演台只铺到内容宽，右侧露出画布）。 |

## 没有的证据（不冒充）

- 中文浅色模式：导演台强制暗色（`useDirectorForcedDark`），实验室与真机都只有暗色，这一格不存在。
- Windows、最小窗口、英文真机：本轮未跑，仍挂 3d 验收线（`docs/engineering/director-3dbox-debt.md`，到期 2026-11-15）。
- 视觉基线：`director-3dbox` 屏登记在 `calibration.json` 的「基线待用户拍板」，用户看过上表截图拍板后再 `pnpm run design-lab:update -- --screen director-3dbox`。
