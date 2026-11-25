# T-6a · 模型设置与 AI 策略

## ★0 先查别人

| 出处 | 已有行为 | 本次决定 |
| --- | --- | --- |
| ModelSurfaces.board.json，Main / M1-ladder 第一列、M1-usage | 首页三格，明细另页 | 保留首页的两个去向，明细切换周期 |
| docs/design/proposals/2026-11-03-apimart-experience/contracts.md:20 | 账户资金和 Key 上限独立 | 分开读、分开显示未知 |
| electron/events/vendorCallTrace.ts:13 | 请求保存运行身份和模型 | 按项目配对终态，复用日志 |
| electron/vendor/cost.ts:10 | 实付回执含单位 | 只汇总积分，缺失保留未知 |
| src/ui/onboarding/adapterTaskVisibility.ts:82 | 只显示活动任务 | 保留同一筛选器 |
| src/ui/onboarding/ModelSettingsWorkspacePages.tsx:29 | 子页共用返回按钮 | 其他方式、用量走工作区导航栈 |

出口：src/ui/onboarding/ModelAccountCard.tsx:40 · 读数失败后保留重试入口 · 分开保留账户和 Key 的上次有效读数。

查询使用只读 IPC。断开仍走现有确认。

## ★1 用户任务、连带界面与升级

新用户打开设置 → 模型 → 连接 APIMart → 回模型页看资金 → 看用量 → 返回。旧用户打开「以前接的」→ 找到原模型 → 打开连接，或从其他方式接本机服务。走查核对每步落点、旧连接保留率 100%、未配置预置的首页曝光率 0%。策略页修改默认值、整理显示、选择上传权限，用同一偏好回读。发送栏、Agent 面板和任务中心继续消费原有数据。

v0.24.1-wizard 由提交 45bf882e4 录下，磁盘目录保留 local-39017 与同名凭据。只投影目录，不迁移、重加密或重写密钥；升级测试比对该记录。未接入的 CLI 和会员预置收起，已配置实例保留详情入口。一次性说明只存本机已读位。

## ★2 主人与门表

door-map 扫 ModelSettingsHome、getGenerationModelDefaults、setModelHidden 共 3187 文件，5 个读门（OnboardingDrawer、useAgentPanelV4Data、useNodeModelAutoSelect、deriveFromNode、AiModelsSection），1 个写门（ModelBoxOrderSection）。连接状态归 connectionHomeStatus，活动任务归 visibleAdapterRuns，账号数据归主进程，UI 只接收可显示字段。使用量按连接和项目日志聚合，无新增账本。

本次 door-map 的调用与输出如下。

`node scripts/door-map.mjs --read=ModelSettingsHome,getGenerationModelDefaults --write=setModelHidden`

| 读写 | 符号 | 调用文件 |
| --- | --- | --- |
| read | ModelSettingsHome | src/ui/onboarding/OnboardingDrawer.tsx |
| read | getGenerationModelDefaults | src/workbench/ai/v4/useAgentPanelV4Data.ts |
| read | getGenerationModelDefaults | src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts |
| read | getGenerationModelDefaults | src/workbench/generationCanvas/quickActions/deriveFromNode.ts |
| read | getGenerationModelDefaults | src/workbench/settings/AiModelsSection.tsx |
| write | setModelHidden | src/workbench/settings/ModelBoxOrderSection.tsx |

## ★3 方案

保留全部折叠卡会淹没单账户入口，删除连接会损坏旧项目。采用定稿的单卡加二级页，保留既有管理件。D-1117 的状态词覆盖旧图的登录或失败措辞；D-account-default 延后换 Key；币种冻结后只呈现积分。模型页折叠既有 AiAssistedOnboardingCard，ConnectAssistantCard 的宿主权限仍在自动化。设置中不探测旧供应商。

## ★4 状态

初装显示连接入口；加载沿用目录提示；成功显示按连接查询的数值；单端失败只影响该格，可重试；旧目录只读和加载错误继续显示。离开后丢弃晚到响应，长模型名截断并保留完整名称。零余额是有效读数。无回执的成功调用计次数、积分未知。空周期显示空态。

## 5 打断

刷新只发只读 GET。连点合并在途读取，关闭或切换连接后结果不得串户；断网可重试，返回时按有效期刷新；重启后重新读目录。取消断开继续保留 Key。离开用量页无需保存。

## 6 费用与隐私

仅由主进程向已绑定的 APIMart 官方端点读取账户和 Key 额度。充值在系统浏览器中处理。事件中的提示词与原始响应留在主进程。走查使用隔离凭据与回环服务，期望付费请求 0。

## ★7 性能

模型工作区保持懒加载。model-settings-usage-open 从点击用量入口量到本机回执与公开单价都可见，再过两帧；42 份回执、5 次采样，中位数 64.9ms，p95 65.1ms，预算分别为 100ms、150ms。连接列表本地投影，按需聚合近 30 天，再由同一次读取计算两档。切换周期不重新访问供应商。走查计数读取请求，检查窄窗无横向滚动，页内纵向滚动可达末行。

## 8 回退

可整体 revert 本提交。展示与只读 IPC 不改变项目格式。升级说明已读位可由旧版忽略。

## ★9 独立验收

在真实 Electron 窗口核对新装仅一个平台入口、未配置 CLI 缺席；多家旧连接可搜索、原 Key 不变、说明确认后重开消失。已连接时三格分别核数、菜单三项、7/30 天记录和公开单价单位可辨。未知余额不显示零；重复终态、失败任务、别家任务不计入。四项默认、同模型多家才出现的排序、唯一隐藏入口、上传开关与高级折叠都要能操作。中英、深浅、700px 窗口检查引号名字同行。账面标记只给走查通过的断言。


## 升级与样张核对

升级输入为 `tests/fixtures/old-user-data/catalogs/v0.24.1-wizard`。走查启动前读取全部凭据记录，启动后搜索 Relay One，关闭升级说明，关闭设置再重开，逐字段比对原凭据。加入 KIE 与两家中转补足四个连接，截图时验证搜索框缺席。另一份隔离目录再加第五个连接，输入 Relay One 只得到一项，清空恢复五项。实际步骤和截图见[实窗验收](../evidence/2026-11-24-t6a-model-settings/walkthrough.md)。

M1-old-user 的旧状态词由 11-17 的统一投影替代。已删除的 `settings.drop.test-connection` 没有 component，保持原判。M6 的公共临时托管以现行上传许可和实际通道为准。M2 的模型框脚注跳往这项设置属于另一个元素 `picker.hidden-footer`，由 T-6b 交付。

## 11-24 样张复核

以监督线在 97f03c5d7 留下的七张对照图为修前复现。连接状态、用量和上传设置继续由原组件投影。复制设置页会产生第二个读写入口，删除控件会中断原任务。验收检查四个旧连接无搜索、第五个可搜；单供应商不加后缀，同名多家可区别；显式选择才有「你定的」；公开单价带约号；两种存储值与开关方向逐一相符。实窗量英文及窄窗三栏的文字边界，同时检查菜单关掉后的静止态。12 月 8 日复核这些反例，任一复发重开。

## 11-26 单价与样张补齐（短版设计卡）

- ★1 创作者在「用量与单价」页看到每个模型自己的公开价：GPT Image 2.6 Flare ≈0.35、GPT Image 2 ≈0.09 积分/张；没有固定单价的模型显示「—」和短原因（按 token 计 / 分档计价 / 暂时读不到），不印 0、不借别家的价。用量页加「今天」一档并标「本机记录」；账户卡写「近 7 天花了 · 本机」和「存在系统钥匙串」。设置框改回拍板图：高随内容 360–560、顶边停在「560 的框居中」处，换页签只有底边动（953eb7973 曾钉成固定 560）。量具：`tests/ux/t6a-model-settings.walk.mjs`（夹具换成 11-26 录下的 APIMart 公开价目原始响应）、verify-nomi 隔离驱动实窗读回、vitest。老用户只读展示，不迁移数据。
- ★2 价目解析只归 `electron/ai/onboarding/vendorPricePreview.ts` 的 `publicPriceFor`，积分印法只归 `formatCreditValue`，设置框顶边只归 `SettingsDialog` 交给 `DesignModal` 的 `yOffset`（窗口高读 Mantine `useViewportSize`，源码不写视口单位）。door-map：`readModelUnitPrices` 1 个读门（`onboardingIpc.ts:44`）；`readVendorPricePreview` 2 个读门（`onboardingIpc.ts:44` 单价页、`:62` 发送键约价，后者行为不变）；`summarizeModelUsage`、`readModelSettingsUsage` 各 1 个；`formatCreditValue` 2 处（`sendCostFormat.ts:25`、`:34`），本次加设置两处。
- ★3 生产取价没有兜底常量，同价来自走查夹具：夹具给每个图片模型发同一个 0.035 美元，断言又照抄 ≈0.35，「各行同价」因此测不出。三条路：只改断言（换模型照样测不出）；夹具换成真实录下的价目、每行断言自己的价（选这条）；删掉单价区（违背已批 M1-usage）。解析器拒价时补一个原因（`publicPriceGap`），页面不再把「按 token 计」说成「读不到」。目录里没有的死键 `midjourney`、`doubao-seedance-2.0-fast` 同提交删，加单测守「单价键都在内置目录里」。verify-nomi 驱动的假 APIMart 也回放同一份价目，实窗读回不再全是「暂时读不到」。
- ★4 单价：读取中 / 全部读不到可重试 / 部分行「—」加原因 / 有价。用量：今天（本地零点起）、近 7 天、近 30 天三档，空档显示空态，缺回执显示待结算。
- ★9 验收：① 各行价互不相同且是自己的价（Flare ≈0.35、GPT Image 2 ≈0.09、Nano Banana 2.1「—」按 token 计、Seedance 2.5「—」分档计价）；② 「今天」只含今天那一笔；③ 账户卡有「存在系统钥匙串」和「本机」；④ zh 浅色、en 深色、700×720 三张实窗亲眼看过；⑤ 首页短于策略页、两页顶边相同，720 高窗口里策略页 560 放得下且外层不滚。反例：夹具各模型同价时走查必须红（先用旧代码配新夹具跑一次，确认会红）；单价键拼错或目录删行时单测红；未知价印成 0 或印别家价时走查红。已知差异：两处短入口文字保持短（协调走 A，待用户定）；余额格不印美元（金额格式冻结）；Key 不印「sk-」前缀（只读得到尾号，印前缀要改 `vendorAccountBalance.ts`，见方向复盘 §7）；首页图标框样式。
