# DMG 安装窗口（设计卡）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：DMG 安装窗口——背景、图标布局、卷名、卷图标，加「第一次打开被拦」提示
线/负责人：DMG 线（协调会话派出的侧会话）
类别：[新界面]（用户看得见的安装窗口；应用代码只改更新弹窗一行文案）
```

> 状态：**已拍板，已实现未推送**。用户 2026-10-24 原话（协调转述）：「安装窗口用 B 镜头飞入（按你说的只用三种媒体色）。」Claude Design 画布 https://claude.ai/artifact/HMWbBktUXkfi7DvsTLwBk6（私有，只有仓库主人能开）第 7 版上选 B，第 8 版按拍板改完，协调对过真 DMG 截图和设计系统；拍板图清单 `docs/design/boards/2026-10-24-dmg-install-window/DmgInstallWindow.board.json`。
> 补还是换：**换**。DMG 从 electron-builder 的默认模板（540×380 浅灰底虚线箭头）换成 Nomi 自己的窗口，默认模板不留。
> 范围：`package.json` 的 `build.dmg`；`build/dmg/`（背景源和三张派生图）；`scripts/packaging/` 里的 DMG 资源脚本与门岗（挂进 `check:icons`）；走查 `tests/ux/dmg-install-window.walk.mjs`；README / README.zh-CN / 快速开始的首次打开说明（Q1）；更新弹窗 Mac 第 2 步文案（Q8）。
> 不做：签名公证（Q2，用户定先不做）、Windows 安装器（Q3）、首次启动提示移到「应用程序」（Q1 的 B，0.25 候选）、官网 Mac 安装说明（协调认领给本线，另开小 PR）。

### 功能分类
- [x] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能

### grill 结论（2026-10-24）

| 题 | 结论 | 谁定的 |
|---|---|---|
| Q1 范围 | A：窗口 + 窗口里中英提示 + 改 README / 快速开始。B（首次启动提示移到「应用程序」，用 Electron 自带的 `app.moveToApplicationsFolder`）记 0.25 候选 | 协调代定（默认） |
| Q2 签名公证 | 先不做，也不另立项；窗口里的中英提示照 Q1 = A 保留 | 用户：「先不做了」 |
| Q3 Windows 安装器 | 不做 | 协调代定（默认） |
| Q4 趣味元素 | B 镜头飞入：文本 / 图片 / 视频三张媒体卡沿弧线飞进「应用程序」，只用三条媒体轨的颜色 | 用户拍板 |
| Q5 深色外观 | 只做浅底，不做深色外观实测；记为已知限制 | 用户：「没必要」 |
| Q6 卷名 | 「Nomi <版本>」，版本取 package.json，去掉架构后缀 | 协调代定（默认） |
| Q7 卷图标 | 磁盘 + Nomi 角标（electron-builder 自带 `badgeIcon`） | 协调代定（默认） |
| Q8 开着替换失败 | 更新弹窗 Mac 第 2 步改成「退出 Nomi，把新版拖到「应用程序」，选择替换」（中英） | 协调代定（默认） |
| Q9 英文系统 | 不切系统语言；窗口里没有随系统语言变的字，中英文系统看到同一个窗口 | 协调代定（默认） |

### 九格

★0 先查别人：5 条先例，改了 4 个决定、确认了 3 个；画布先例便签和清单 priorArt 收同样的条目。证据：链接如下；`pnpm run check:board-parity`
- ① 用户给的另一款应用的 DMG 截图（协调转述，截图和产品名不入库）· 760×527 浅底，1x + 2x，图标 164、文件名 16，几个彩色小角色围着「应用程序」指过去，窗口里没有字 · 确认了：大图标、浅底、一个明确的「往这拖」方向就够一眼会拖；改了：趣味元素不照搬它的角色，从 Nomi 自己的制作语汇长出来——文本、图片、视频三种素材（时间轴三条媒体轨的颜色、画布节点的图标）飞进「应用程序」。
- ② Apple 开发者公告「Updates to runtime protection in macOS Sequoia」（2024-08-06，https://developer.apple.com/news/?id=saqachfa）· macOS 15 起按住 Control 点按不能再绕过 Gatekeeper，要去「系统设置 › 隐私与安全性」放行 · 改了：窗口里加中英两行提示写真实的放行路径；README、快速开始里的「右键 → 打开」同 PR 改掉，官网另开小 PR。
- ③ DropDMG 论坛，作者 Michael Tsai 2018-08-28 的答复（macOS 10.14，https://forum.c-command.com/t/light-and-dark-mode-background-images/11916）· 设了背景图的 DMG 窗口，Finder 一律按浅色外观显示，也没法给深色另配一张 · 确认了：只做一张浅底背景，图标和文件名下方保持干净的浅底（Q5）。
- ④ electron-builder 的 DMG 文档（https://www.electron.build/dmg）和 26.15.3 自带的 dmg-builder 源码 · 默认 540×380、图标 80、标题默认 `${productName} ${version}`；源码里给了背景图时窗口尺寸 = 背景图尺寸（`window` 被忽略），`contents` 坐标是图标中心（1x，不含文件名），同名 `@2x.png` 自动合成多分辨率 TIFF，`badgeIcon` 交给 dmgbuild 合到系统磁盘图标上 · 改了：窗口尺寸不另配，由背景图定；标题沿用默认宏；卷图标用角标；角标 PNG 必须带 DPI（dmgbuild 要读，不带就打包失败，2026-10-24 本机实测）。
- ⑤ 本机 macOS 26.5.1 实测 · Finder 把标题栏算进 .DS_Store 写的窗口高度，背景底部 32pt 看不见；浅色外观下文件名是黑字，深色底上看不清 · 改了：底部 32pt 当出血，安全区进门岗；底色用浅色。

★1 用户怎么用：当我从官网或 GitHub Releases 下载 Nomi 的 DMG 并双击打开时，我想一眼看懂「把 Nomi 拖进应用程序」，并提前知道第一次打开会被系统拦一下、去哪放行，以便一次装好，不从盘里直接运行，也不卡在「未打开“Nomi”」。证据：`tests/ux/dmg-install-window.walk.mjs`；PR 截图（真 DMG）
- ① 步骤：下载对应芯片的 DMG → 双击，访达弹出「Nomi 0.24.0」窗口 → 顺着三张媒体卡飞的方向，把左边的 Nomi 拖到右边的「应用程序」→ 推出磁盘（桌面上是带 Nomi 角标的磁盘图标，不会和应用本身混）→ 从「应用程序」打开 → 被拦时照窗口里那两行提示去「系统设置 › 隐私与安全性 › 仍要打开」。
- ② 不做什么：不做签名公证（根治最后一步要 Apple Developer ID，用户 10-24 定先不做，Q2）；不做 Windows 安装器（Q3）；不做首次启动移到「应用程序」的提示（Q1 的 B，0.25 候选）。
- ③ 已知坑：macOS 26 底部 32pt 看不见；深色外观下 Finder 图标标签可能变成白字、在浅底上偏淡，未实测（用户 10-24 判定不需要）；Nomi 开着时拖进去替换会失败（Finder 报「正在使用中」，Q8 改了更新弹窗的说法）。
- ④ 真实任务：T1 新用户第一次装（本机真 DMG 双击打开，走查第②段照做）；T2 老用户升级，Nomi 正开着时拖进去替换（更新弹窗第 2 步现在先说退出）；T3 英文系统用户（窗口里没有随系统语言变的字，未实测）。
- ⑤ 指标：主指标「下载 DMG 的人里成功打开 Nomi 的比例」——未验证：缺量具（没有安装遥测）；质量指标「窗口里图标、文件名、提示都不被截、卡片不压图标」——量具：`check:icons` 的安全区断言 + 走查第①段的几何断言 + 每次改布局的真机截图；护栏「DMG 照常打包」——量具：electron-builder 真管线（本机 + `desktop-preview` CI）。
- ⑥ brief：安装窗口只讲两件事：往哪拖、第一次被拦怎么办。人设：新手（第一次在 Mac 上装商店外的应用，会直接双击盘里的 Nomi）/ 老手（习惯右键打开，macOS 15 起不灵了）。每步「预期 → 实际」记在 PR 的截图对照里。

★1b 连带界面：README / 快速开始、应用内更新弹窗本 PR 一起改；官网另开小 PR；Agent 回执、通知、任务列表、错误卡不受影响。证据：`git grep -n "right-click\|右键" -- README.md README.zh-CN.md scripts/marketing/content.mjs`
- ① README.md / README.zh-CN.md 第 2 步「右键 → 打开」macOS 15 起无效；docs/quickstart.md 的 `xattr` 命令和 README 不一致 → 本 PR 改（Q1 A），`tests/ux/marketing-home.static.mjs` 钉的系统设置窗格名跟着改成系统原文「隐私与安全性」。
- ② 应用内「有新版本」弹窗的 Mac 第 2 步（`src/i18n/locales/updateReminder.ts` 的 `macSteps.replace`）没写「先退出 Nomi」→ 本 PR 改（Q8），设计实验室 `update-reminder` 屏中英截图在 PR。
- ③ 官网下载弹窗和下载提示（`scripts/marketing/content.mjs` 中英 4 处，生成进 `marketing/`）同样写「右键 → 打开」→ 协调认领给本线，DMG 的 PR 开出来后另开小 PR。

★2 谁说了算：概念「DMG 窗口布局」唯一 owner 是 `package.json` 的 `build.dmg`（electron-builder 照它写 .DS_Store），同一份事实存 1 份。证据：`git grep -n "dmgLayout\|dmgIcons\|build.dmg" -- build scripts/packaging tests/ux`
- ① 出图时把同一份布局注入页面（`window.dmgLayout`），背景上的弧线和媒体卡照它画，不另存；窗口尺寸 = 1x 背景图尺寸（electron-builder 的规则），由背景源里画框的 CSS 尺寸决定。
- ② 媒体卡的图标唯一来源是画布节点登记 `NODE_ICONS`（`src/workbench/generationCanvas/nodes/renderRegistry.tsx`），颜色唯一来源是 `src/theme/nomi-tokens.css` 的三条媒体轨 token。
- ③ 派生物（背景两档、角标）入库，PNG 里的戳记着源头指纹（布局、背景源、用到的 token、媒体卡图标名和图标库版本、应用图标），`check:icons` 判过期。
- ④ 不碰主进程 / 渲染进程的任何状态，不靠「东西不见了」猜意图。

★3 一致与复用：全用现成的，没有新依赖、没有第二份定义。证据：`pnpm run check:icons`
- ① 打包：electron-builder 自带的 DMG 目标（底层 dmgbuild），卷图标用它自带的 `badgeIcon`，不自写 DMG 生成。
- ② 渲染：已装的 Playwright（同 `scripts/render-marketing-social-previews.mjs`）；颜色用设计系统 token（链接 `src/theme/nomi-tokens.css`，同 `docs/design/mockups` 的接法）；媒体卡图标是已装的 `@tabler/icons-react`，用已装的 `react-dom/server` 渲染成 SVG 注入，和画布节点同一套；英文那行用已装的 Inter 变量字体，中文用系统苹方；logo mark 不改。
- ③ 出图脚本和走查共用一个打开背景页的入口（`scripts/packaging/dmg-background-page.mjs`），走查看到的就是出图用的那一页。
- ④ PNG 编解码复用 `scripts/check-app-icons.cjs` 的 `decodeRgbaPng` 和 `scripts/generate-app-icon.cjs` 的 `encodeRgbaPng` / `resizeRgba`，新写的只有往 PNG 里插 tEXt / pHYs 块（CRC 用 Node 自带的 `zlib.crc32`）。
- ⑤ 门岗挂进现有的 `check:icons`，不新开 `check:*` 名字；走查问 Finder（AppleScript）、读 `hdiutil` / `tiffutil` / `xattr`，都是系统自带；`check:self-written` 只管 src / electron，本 PR 不涉及。

★4 全状态：没有加载 / 失败 / 取消这类运行时状态；这里的「状态」是窗口在不同系统条件下的样子。证据：PR 截图；共享笔记里的探针截图
- ① 浅色外观、中文系统：已实测（PR 截图）。
- ② 深色外观：已知限制——深色外观下 Finder 图标标签可能变成白字、在浅底上偏淡；未实测（用户 10-24 判定不需要）。
- ③ 英文系统：窗口里没有随系统语言变的字（提示本身中英两行，「Applications」替身照原名显示）；未实测（Q9）。
- ④ macOS 26 / 更早：26 底部 32pt 被标题栏占掉 → 出血；老系统露出来的只是底色。
- ⑤ 能力不可用：不适用，没有要模型或外部资源的动作；最接近的是 Gatekeeper 拦首次打开，窗口里的提示就是下一步。
- ⑥ 文案：提示烧进背景图（Finder 不能按系统语言换背景，所以中英两行同时出现），不走 i18n；不谈钱。中文行是主行（苹方 12px / 500），英文行是副行（Inter 11px / 400），有意的：Nomi 的用户群以中文为主（三个反馈渠道里 B 站评论和微信群两个是中文社群），双语提示按「主语言在上略重、副语言在下略轻」排，两行一样重会像一张两项列表、和上面的「往哪拖」抢视线；英文用户读英文那行不受影响（同色，Retina 下两倍像素）。

5 中途表：不适用：窗口本身没有可打断的过程。唯一的过程是用户拖拽复制，由 Finder 负责（中途取消由 Finder 清理），本 PR 不改；Nomi 开着时替换失败由 Q8 改文案。证据：人工

6 外部数据与失败：外部是 electron-builder / dmgbuild（DMG 与 .DS_Store 格式）和 Finder 渲染，只用标准选项，没有偏差。证据：`scripts/packaging/dmg-assets.node-test.mjs`；`tests/ux/dmg-install-window.walk.mjs`
- ① 规范：electron-builder `DmgOptions`（scheme.json）、dmgbuild 的设置项。
- ② 失败时：角标没有 DPI → dmgbuild 抛 `KeyError: 'DPIWidth'`、打包失败（已修，门岗拦）；背景两档尺寸不成对 → 窗口尺寸或清晰度错（门岗拦）；electron-builder / dmgbuild 升级改了行为 → 门岗管不到，靠 `desktop-preview` CI 打包 + 发版前用走查第②段核真 DMG。

★7 性能：不适用：没有新增应用内操作，DMG 窗口由 Finder 渲染。量了两个与安装相关的数：DMG 体积 +315 KB（304.05 MB → 304.37 MB，多了背景 TIFF 和卷图标）；`check:icons` 从 0.03 秒到 1.3 秒（多了 15 条单测和 DMG 资源检查；本机负载 23 时实测）。证据：`ls -l` 前后两个 DMG；`time pnpm run check:icons`

8 真实条件：macOS 26.5.1、Apple 芯片、中文系统、浅色外观：真 DMG 截图，自己看过；走查第②段 6 项全过，旧 DMG 同一走查 6 项全红。证据：PR 截图路径
- ① 深色外观：已知限制，未实测（用户 10-24 判定不需要）。
- ② 英文系统：unverified（Q9）。
- ③ Intel 版（x64 DMG）：同一份配置，未单独打包截图 → unverified。
- ④ macOS 14 及更早（标题栏不占高度）：unverified，`desktop-preview` CI 在 macos-14 上只打包不截图。
- ⑤ 真拖装：本机没拖（会覆盖本机已装的 Nomi）→ unverified，拖拽复制本身由 Finder 完成、本 PR 不改。Windows：不适用。

拍板图清单：`docs/design/boards/2026-10-24-dmg-install-window/DmgInstallWindow.board.json`（8 个元素全部 implemented，断言在走查里；旧功能普查 6 项都有去处）。证据：`pnpm run check:board-parity`

★9 验收与回滚：验收线照下面的清单核，回滚 = revert 本 PR 的合并提交（DMG 退回 electron-builder 默认模板）；新界面类要另一条线独立验收，报告链接待协调派。证据：`pnpm run check:icons`；`tests/ux/dmg-install-window.walk.mjs`；PR `## 独立验收`
- ① 验收清单：`pnpm run check:icons` 绿（含 15 条单测）。
- ② 验收清单：本机 `pnpm run render:dmg-assets` 后 `git status` 干净（入库的图就是源头渲染的结果，同机重渲逐字节一致）。
- ③ 验收清单：真管线打 DMG 成功（`electron-builder --mac dmg --arm64`，或 `--prepackaged` 已构建的应用）。
- ④ 验收清单：`node tests/ux/dmg-install-window.walk.mjs --dmg <DMG> --shot` 10 项全 PASS——背景源（画框 = 1x 尺寸；弧线从 Nomi 一侧到「应用程序」一侧、不压图标；三张卡顺序文本 → 图片 → 视频、颜色是对应媒体轨 token、图标是画布节点同款、不压图标和文件名；提示原文对、在文件名下方、不进底部 32pt）+ 真 DMG（Finder 窗口 720×440、图标视图、无工具栏状态栏；卷名「Nomi <版本>」；卷图标不是应用图标且有自定义图标标记；Nomi (200,180)、图标 128、字号 13、文件名在下；Applications 指向 /Applications、在 (520,180)；背景 TIFF 两层 720×440 + 1440×880）。
- ⑤ 验收清单：截图里图标、文件名、提示都在可见区，三张卡沿弧线飞向「应用程序」；设计实验室 `update-reminder` 屏 Mac 步骤中英两张，第 2 步是新文案。
- ⑥ 反例 → 结果（门岗）：改坐标 / 图标尺寸 / 字号没重渲 → 红；改背景源没重渲 → 红；背景用到的 token（含间接引用）改值 → 红，没用到的或深色的 token 改值 → 绿；画布节点换了文本 / 图片 / 视频图标没重渲 → 红，换别的节点图标 → 绿；`NODE_ICONS` 里没了 video → 抛错；换应用图标没重出角标 → 红；角标缺 DPI → 红；`badgeIcon` 指向满版应用图标 → 红；缺 @2x 或 @2x 不是两倍 → 红；条目进底部 32pt 或出窗口 → 红；只改卷名 → 绿。
- ⑦ 反例 → 结果（走查）：背景源里两张卡换了颜色 → 红；提示挪进底部 32pt → 红；拿旧版（默认模板）DMG 跑 → 第②段 6 项全红。
- ⑧ 这一类还会从哪回来：x64 DMG（同一配置，验收第 ③、④ 条用 `--x64` 再跑一遍）；预览版（`electron-builder.preview.cjs` 继承 `build.dmg`，卷名「Nomi Preview <版本>」）；以后换应用图标、改 token、换画布节点图标（门岗拦）；electron-builder / dmgbuild 升级（门岗管不到，见格 6，发版前跑走查第②段）。
