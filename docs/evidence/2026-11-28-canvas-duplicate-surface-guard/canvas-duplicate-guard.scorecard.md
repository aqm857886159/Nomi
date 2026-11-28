# 体验成绩单：消除常驻面板双 Nomi 身份头与空画布双 7 钮创建条并补齐整屏体感门岗

- 改动：消除常驻面板双 Nomi 身份头与空画布双 7 钮创建条并补齐整屏体感门岗
- 验收 head：`80f39f88e8ee66174856536974b8c539410a00c2`（分支起点基线，提交后由 PR HEAD 与独立盲验线锚定）
- 场景 id：`canvas-image`
- 谁验：impl-canvas-dup-guard（实现线实窗自验（待独立盲验线复核））
- 日期：2026-11-28

**用户这次能完成：**在 1440×900 生成画布空态只看到唯一一套中央 7 项创建入口、右侧常驻面板只看到顶部唯一 Nomi 身份头，新建首个节点后底部工具条立即接管

**能力变化：**新增：整屏体感扫描规则 duplicate-nearby-header 与 duplicate-action-bar（棘轮零容忍）、画布创建入口互斥纯函数 resolveCanvasCreationSurface；改变：0 节点空画布仅展示中央 7 张起步卡，≥1 节点才展示底部 CanvasToolbar、NoTextModelRecoveryCard 移除卡片内冗余 NomiIdentityRow；去掉：常驻面板未连模型卡内重复的第二个 Nomi 身份头、0 节点空画布正下方同屏重复挂载的底部 7 钮创建条

## 结果

- 机器：完成 **3 / 3**（失败 0 条，原样列在下表，不丢）
- 首次尝试成功：null（未采集：需要真人首次操作，AI 不代填）

| 尝试 | 结果 | 说明 | 证据 |
| --- | --- | --- | --- |
| 1440×900 空画布 + 右侧未连模型常驻面板整屏巡检（zh-CN light/dark + en light/dark） | 通过 | panelWordmarks=1, assistantIdentityRows=0, emptyTasks=1, bottomToolbar=0, zoomBar=1 |  |
| 空画布点击中央「图片」卡新建首节点并切换到底部工具条 | 通过 | emptyTasks=0, bottomToolbar=1, imageNodes=1, zoomBar=1 |  |
| smoke.e2e.mjs 实窗 18 项断言与体感观察器棘轮全链路验证 | 通过 | 0→1 图片节点、超长提示词滚动、导演台展开全通，duplicate-nearby-header=0, duplicate-action-bar=0 |  |

## 机器测的

来源：report
设备 / 窗口 / 语言：darwin-arm64 / 1440×900 / zh-CN / en / light / dark。边界：隔离临时资料目录 + 本机新鲜构建静默实窗

| 主指标 / 指标 | 现状 → 当前 | 单位 | 样本数 | 口径 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 右侧面板 Nomi 品牌头个数 | 2 → 1 | 个 | 4 | 脚本计数（真事件，非采集器） | zh-CN/en × light/dark 四态实窗 DOM 实测 |
| 0 节点空画布同屏 7 钮创建条套数 | 2 → 1 | 套 | 4 | 脚本计数（真事件，非采集器） | 0 节点仅留中央起步排，≥1 节点切换到底部工具条 |
| 整屏重复头部/动作条体感违规数 | 2 → 0 | 项 | 16 | 实测（采集器） | smoke.e2e.mjs 16 个棘轮检查点实测 |

## 真人给的（和上面分开记）

- SEQ（1–7）：null（未采集）
- 误点：null · 回退：null · 求助：null · 首次尝试成功：null
- 说明：本次为 AI 实现线实窗自验，真人 SEQ 与人工观察项留 null 不代填，交用户过目前后对比真截图确认

## 护栏

| 护栏 | 结果 | 证据 / 说明 |
| --- | --- | --- |
| 左下缩放簇（100% / 适应视图 / 视图选项）在 0 节点与有节点态均常驻可达 | 通过 | zoomBar=1（1440×900 实窗探针与截图核实） |
| 未连模型指路卡与已配 Key 停用模型一键启用按钮零退化 | 通过 | src/ui/onboarding/onboardingS7aEntries.test.tsx (6/6) |
| 多节点画布、右键菜单与消息列表操作钮零误伤 | 通过 | tests/ux/_feel.browser.mjs (29/29) + tests/ux/smoke.e2e.mjs (18/18) |

## 最大摩擦点与决定

- 摩擦：此前 0 节点空画布中央 7 卡与正下方底部 7 钮同时出现，右侧面板顶栏 Nomi 下方约 22px 又出现第二个 Nomi，首屏焦点分裂
- 决定：删掉恢复卡内冗余身份头，并用 resolveCanvasCreationSurface 让空态起步格与底部工具条按节点数严格互斥，同时在 _feel-observer 棘轮零容忍守卫
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
