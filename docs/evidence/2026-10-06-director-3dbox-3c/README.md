# 3D-BOX 3c ·「正在改：镜头 N」与画布七态对账（2026-10-06，Windows 11）

画布：Claude Design「3D-BOX · 正在改：镜头 N」（https://claude.ai/artifact/XinCtPmPiQXFT1cHWBSbzq），用户 10-06 拍板。
截图来自设计实验室屏 `director-3dbox`：每一格都是现役 `DirectorEditor`（开关开）+ 现役 Agent 面板（`ProjectAgentResidentShell`），
工程是 S1 oracle 计划 `courtyard-standoff` 经现役编译器编出来的；镜头卡是真点击（Ctrl 加选也是带 `ctrlKey` 的真点击事件）。
无头 Chromium、1280×933，不起可见窗口。截图我逐张看过。

| 画布状态 | 截图 | 画布要什么 | 实现看到什么 | 对上没有 |
|---|---|---|---|---|
| ① 没选中 | `d3-focus-1-none-zh.png` | 输入框上不出现标签；镜头卡都不高亮；顶栏只写工程名 | 同 | 对上 |
| ② 选中一镜 | `d3-courtyard-director-zh.png` | 「正在改：镜头 2 · 中近景 · 固定」；第 2 张卡高亮；顶栏「· 镜头 2」 | 「正在改：镜头 2 · 近景 · 固定」（实测是近景——标签读的是实测值，和镜头卡同一份）；卡 2 高亮；顶栏同 | 对上（画布里的「中近景」是示意值） |
| ③ Ctrl / Shift 加选 | `d3-focus-3-two-zh.png` | 「正在改：镜头 1、3」，不带实测；卡 1、3 高亮；顶栏跟第一个选中的镜 | 同 | 对上 |
| ④ 超过 3 镜 | `d3-focus-4-many-zh.png` | 「正在改：4 个镜头」；四张卡都高亮 | 同 | 对上 |
| ⑤ Agent 改完 | `d3-focus-5-after-zh.png`、`d3-focus-5-after-en.png` | 标签还在、实测换成新景别；对话里 Agent 说清被覆盖的手改、可撤销 | 标签「正在改：镜头 2 · 大特写 · 固定」还在（选中与播放头在外部改写后保留）；对话按 skill 1.1 的复述规则写 | 对上；**差异**：画布把工具行画成「执行操作 改了镜头 2 ✓ 完成 撤销」，现役面板是既有的工具折叠行「用了 1 个工具 ›」（撤销在折叠行里），这一格不另造工具行 |
| ⑥ 英文 | `d3-courtyard-director-en.png` | 「Editing: Shot 2 · …」，× 的读屏名「Stop targeting this shot」 | 「Editing: Shot 2 · Close · Static」 | 对上 |
| ⑦ 亮色 | `d3-focus-7-light-zh.png` | 亮色下的标签 | 标签只用 token，亮色下成立 | **产品里不可达**：导演台开着时整个 App 锁暗（2026-09-09 用户拍板「这个面默认深色」，`acquireForcedDark`），这一格只挂 Agent 面板、导演台不挂界面，证明的是标签本身 |

交互（无头浏览器真点击核对，`tests/ux/.scratch-*` 不提交）：
- 点 × → 标签消失、卡不再高亮、顶栏回到工程名；
- 普通点卡 3 → 「正在改：镜头 3 · 固定」；Shift 点卡 1 → 「正在改：镜头 1、3」；
- 点 3D 画面空白处 → 清掉选中；拖动转视角 → 选中保留；
- 全程 0 个 pageerror。

与画布的取值差异（按设计系统 token 取，不是另立一套）：
- 圆角：画布 8px，实现 `rounded-nomi-sm`（6px，最近的 token）；
- 摄像机图标：画布手画线框，实现用图标库的 `IconVideo`（同一个形状）。

顺带修好、截图里能看到的两件（外包卡 20）：
- 名牌不再叠在一起：「黑衣侍卫」在上、「青衣女子」在下（共享排版函数，见根因合同 `docs/fixes/2026-10-06-director-character-label-overlap.root-cause.json`）；
- 第 3 张卡「未测量 · 固定」改成「固定」。

基线：本屏视觉基线按 darwin 录，Windows 上 `design-lab:update` 起不来（`spawn npx` ENOENT），已在 `tests/ux/design-lab/calibration.json` 的 `pendingApprovalScreens` 登记，等 mac 上录完删登记。
