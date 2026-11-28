# 体验成绩单：落地开合移交舞台（一个角色一个真身）、消除常驻面板双 Nomi 头与空画布双 7 钮创建条并补齐整屏体感门岗

- 改动：落地开合移交舞台（一个角色一个真身）、消除常驻面板双 Nomi 头与空画布双 7 钮创建条并补齐整屏体感门岗
- 验收 head：`80f39f88e8ee66174856536974b8c539410a00c2`（分支起点基线，提交后由 PR HEAD 与独立盲验线锚定）
- 场景 id：`canvas-image`
- 谁验：impl-canvas-dup-guard（实现线实窗自验（待独立盲验线复核与用户过目拍板））
- 日期：2026-11-28

**用户这次能完成：**在 1440×900 工作台收放面板时全屏始终只看到左上角 `[N]` 软件标与右侧唯一 1 颗活小人（打开坐镇面板头显示实时状态、收起回顶栏值班），并在 0 节点空画布只看到唯一一套中央 7 项创建入口

**能力变化：**新增：整屏体感扫描规则 duplicate-persona-stage、duplicate-nearby-header 与 duplicate-action-bar（棘轮零容忍）、顶栏与面板头开合舞台移交与五档实时状态短句、画布创建入口互斥纯函数 resolveCanvasCreationSurface；改变：面板打开时顶栏入口退成安静线性侧栏开关而活小人搬进面板头、0 节点空画布仅展示中央 7 张起步卡且 ≥1 节点才展示底部 CanvasToolbar；去掉：AgentPanelV4Panel 头部的软件标 NomiBrand、零引用的 NomiIdentityRow.tsx 及恢复卡内重复身份头、0 节点空画布正下方重复挂载的底部 7 钮创建条

## 结果

- 机器：完成 **3 / 3**（失败 0 条，原样列在下表，不丢）
- 首次尝试成功：null（未采集：需要真人首次操作，AI 不代填）

| 尝试 | 结果 | 说明 | 证据 |
| --- | --- | --- | --- |
| 1440×900 面板打开·五档状态（idle / running / needs-confirm / done / failed）与面板收起·顶栏值班切换（zh-CN / en × light / dark） | 通过 | open: entryShape=toggle, liveStagesVisible=1, liveStagesTotalDom=1; collapsed: entryShape=face/capsule, liveStagesVisible=1, liveStagesTotalDom=1 |  |
| 1440×900 空画布点击中央「图片」卡新建首节点并切换到底部工具条 | 通过 | 0 节点仅显中央 7 卡（bottomToolbar=0），1 节点中央空态退场、底部工具条显现（bottomToolbar=1），zoomBar=1 |  |
| smoke.e2e.mjs 实窗 18 项断言与 16 个体感观察器棘轮检查点全链路验证 | 通过 | duplicate-persona-stage=0, duplicate-nearby-header=0, duplicate-action-bar=0 |  |

## 机器测的

来源：report
设备 / 窗口 / 语言：darwin-arm64 / 1440×900 / zh-CN / en / light / dark。边界：隔离临时资料目录 + 本机新鲜构建静默实窗

| 主指标 / 指标 | 现状 → 当前 | 单位 | 样本数 | 口径 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 全屏同时可见活小人（NomiAgentFace）个数 | 2 → 1 | 个 | 10 | 脚本计数（真事件，非采集器） | 面板打开与面板收起 10 张实窗状态屏 DOM 与可见矩形实测恒为 1 |
| 右侧面板 Nomi 品牌头个数 | 2 → 1 | 个 | 6 | 脚本计数（真事件，非采集器） | 面板头唯一活小人 + Nomi 字标，正文恢复卡 0 重复头 |
| 0 节点空画布同屏 7 钮创建条套数 | 2 → 1 | 套 | 6 | 脚本计数（真事件，非采集器） | 0 节点仅留中央起步排，≥1 节点切换到底部工具条 |
| 整屏重复角色/头部/动作条体感违规数 | 2 → 0 | 项 | 16 | 实测（采集器） | smoke.e2e.mjs 16 个棘轮检查点实测 |

## 真人给的（和上面分开记）

- SEQ（1–7）：null（未采集）
- 误点：null · 回退：null · 求助：null · 首次尝试成功：null
- 说明：本次为 AI 实现线实窗自验，真人 SEQ 与人工观察项留 null 不代填，交用户过目 1440×900 前后对比真截图拍板

## 护栏

| 护栏 | 结果 | 证据 / 说明 |
| --- | --- | --- |
| 面板收起时顶栏活小人五态形变与「等你确认 N」浅橙胶囊照常值班，点一下展开 | 通过 | nomiEntryLook.test.ts (10/10) + ShellNomiEntry.wiring.test.tsx (9/9) + 04/04b 实窗截图 |
| 左下缩放簇（100% / 适应视图 / 视图选项）在 0 节点与有节点态均常驻可达 | 通过 | zoomBar=1（1440×900 实窗探针与截图核实） |
| 未连模型指路卡与已配 Key 停用模型一键启用按钮零退化 | 通过 | src/ui/onboarding/onboardingS7aEntries.test.tsx (6/6) |
| 多节点画布、右键菜单、隐藏收起容器与消息列表操作钮零误伤 | 通过 | tests/ux/_feel.browser.mjs + tests/ux/_feel-observer.browser.mjs (35/35) + tests/ux/smoke.e2e.mjs (18/18) |

## 最大摩擦点与决定

- 摩擦：此前全屏同时出现左上 `[N]`、右上小人、下方 30px 面板头 `[N] Nomi` 及未连模型卡 `Nomi` 头，且 0 节点空画布中央 7 卡与底部 7 钮上下并存
- 决定：按用户拍板方案 A 做顶栏与面板头舞台移交（一个角色一个真身）、删掉冗余 NomiIdentityRow、用 resolveCanvasCreationSurface 互斥空态与底栏，并在 _feel-observer 零预算棘轮锁死三项规则
- 协调决定：待协调（通过 / 退回 / 明示延期）

## 没验证的

| 缺口 | owner | 复查条件 |
| --- | --- | --- |
| Windows 原生标题栏下 1440×900 实窗渲染 | CI windows-latest / 发版前桌面巡检 | 下次 Windows 桌面冒烟走查时核对 |

## 证据路径

- docs/plan/2026-11-28-canvas-duplicate-surface-guard.md
- docs/fixes/2026-11-28-canvas-duplicate-surface-guard.root-cause.json
- tests/ux/_feel.browser.mjs
- tests/ux/_feel-observer.browser.mjs

> 这一页不出总分：机器数、真人数、护栏、未验证各看各的。
