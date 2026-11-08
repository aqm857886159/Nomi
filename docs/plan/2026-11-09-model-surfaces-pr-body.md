## 做了什么 / 为什么

创作者在设置中区分 APIMart 账户余额、Key 额度和近七天消费，在画布搜索当前连接支持的型号，并查看与最终出站参数匹配的发送前公开估价。本次只交付 M1/M2/M4 有限增量，仍需最终头独立验收与有效性能基线。

## 设计卡

类别：花钱 + 新界面 + 数据格式 + Agent 行为 + 长跑 / 可打断。原设计卡：[模型账户、选择器与发送前估价](docs/plan/2026-11-08-model-surface-implementation.md)。拍板清单：[ModelSurfaces](docs/design/boards/2026-11-07-model-surfaces/ModelSurfaces.board.json)。

★0 先查别人：
- [Key 额度](https://docs.apimart.ai/en/api-reference/account/token-balance.md) · unlimited_quota 区分不设 Key 上限 · 确认不把无限 Key 数值槽当余额零。
- [账户余额](https://docs.apimart.ai/en/api-reference/account/user-balance.md) · remain_credits 独立于 Key 额度 · 确认三栏分别呈现，未知不补零。
- [用量](https://docs.apimart.ai/en/api-reference/account/usage.md) · 账户汇总消费与成功请求单独统计 · 确认近七天消费不充当单次生成实扣。
- 出口：[Key 额度](https://docs.apimart.ai/en/api-reference/account/token-balance.md) · 区分账户与 Key 的额度来源 · 确认有效零余额可刷新/充值；非零公开估价短差只提示，原发送和批准入口保留。

| 格 | 决定与证据 |
| --- | --- |
| ★1 用户结果 | 设置→模型页→核账户/Key/用量→回画布→搜索型号→选变体→看估价；量具为 apimart-model-surfaces.rehearsal.mjs 的中英窗口、旧目录和 GET/媒体计数。真实账户、真实生成与实扣均 unverified；主指标为演练完成率，护栏为媒体创建 0。连带界面限账户卡和画布；Agent/批量批准维持原入口。旧项目型号、连接及偏好保留，英文用真实 v0.24.1 目录快照演练。 |
| ★2 唯一事实 | 主进程 vendorAccountFacts / vendorPricePreview 持有账户与报价；报价使用既有最终任务请求投影，renderer 只消费当前连接与参数对应结果。凭据可用性唯一 owner 仍是 credentialRecordCounts；本次只将凭据登记的读入口名跟随 resolveVendorReadTarget，无新增主人。 |
| ★3 复用与取舍 | 复用已有供应商凭据、appFetch、目录选择器和任务模板；沿已批 M1/M2/M4 方向收口；共享 priceBalanceStatus 已实现，不另起资金体系，不删充值态。方向记录见下。 |
| ★4 全状态 | 无凭据引导连接；加载不猜金额；成功显示有来源事实；失败/部分成功保留各自未知及管理/刷新；取消中由原生成体系负责；过期充值点击只刷新；能力不可用可经空搜索进入已展开的 AI 接入。文案覆盖中英。 |
| 5 中途与动作 | 账户/报价读取中关窗不创建媒体，重开重读；断网只使事实未知；换 Key/端点忽略旧返回；连点合并读取；已渲染充值跨过期后只刷新，绝不落入生成。原生成取消/回执仍由既有任务授权体系负责。 |
| 6 外部失败 | 账户和用量仅 GET，经主进程凭据与重定向策略；公开价 GET 无凭据且限制 origin；缺字段、无价、不可达均保持未知。真实供应商字段/单位本轮未核验。 |
| ★7 性能 | 新增设置读取、选择器搜索、变体/参数报价；量具覆盖完整 APIMart 内置目录的视频节点；本轮配置为 1 轮预热后 5 次采样，但因 noisy 拒收，未得到有效性能数字。场景 apimart-model-picker；两次 UI 动作合计预算中位 150ms / p95 200ms；待协调写基线。大规模画布和账户读取性能无独立数字，unverified。 |
| 8 真实条件 | 量具配置为 Mac 开发版、合成 Key + 本机回环、中文新目录/英文 v0.24.1 旧目录和账户窄窗；当前合流头演练未验证：前轮触发磁盘停点后未执行，本轮只修正文与登记。Windows、打包版、真实账户、真付费、全键盘和完整深暗主题也未验证。 |
| ★9 验收与回滚 | 验收清单为账户未知/零/无限、换连接失序、固定/输出估价、过期充值点击、旧目录、空搜索、GPT2.6 真实模板投影及媒体 0；当前合流头上述检查未验证：未执行演练。最终头由另一条线独立验收；本稿不代签。回滚通过 revert 本分支功能提交，保留用户项目与连接资料。 |

### 数据格式、Agent 与打断边界

- 数据格式：本分支在内置供应商种子声明账户只读路径；没有增加持久化项目迁移。既有型号、档位和连接资料保留；量具是 `tests/ux/apimart-model-surfaces.rehearsal.mjs` 的真实 v0.24.1 目录快照。未验证：当前合流头旧目录、保存重开和退回旧版均未走查。
- Agent 行为：路径命中 `src/workbench/ai/v4/formatMoney.ts`，变更为现有 Intl 货币格式器增加可选精度，调用方没给精度时仍用原默认值；没有新增 Agent 工具或更改工具授权。未验证：未运行意图评测，不能报告首次做对率。
- 长跑 / 可打断：账户 GET 使用 12 秒超时、公开价 GET 使用 8 秒超时；React 卸载移除监听、取消待发的报价计时器并忽略旧响应。主进程已发出的只读请求到超时或完成结束；没有新增媒体任务写入口。未验证：断网、关窗、重启的完整任务回执链没有本轮实测。

| 状态 | 停止 | 关窗 | 断网 | 重启 | 连点 |
| --- | --- | --- | --- | --- | --- |
| 账户/报价读取中 | 无独立取消钮；只读请求以超时/完成结束 | 卸载清监听并忽略响应，主进程请求继续至超时/完成 | 读取失败呈未知 | 重新读取，不持久化旧读数 | 主进程合并在途账户读取；报价输入只采当前身份 |
| 已知账户/报价 | 不创建媒体任务 | 不写生成回执 | 刷新失败后不能推断新余额 | 重新读取 | 相同输入消费缓存；原生成按钮仍经原批准 |
| 未知/部分不可读 | 保留未知，可管理连接/刷新 | 不把未知改成零 | 保留未知 | 重新读取 | 只刷新，不由未知结果建立资金硬闸 |
| 已渲染充值但快照过期 | 原按钮动作固定 | 关闭后重新读取 | 本次只刷新，失败保持未知 | 不恢复旧充值快照 | 不进入生成，需界面重新显示生成后另点 |
| 既有生成中/取消中 | 原 Run/授权体系处理，未验证：本轮未走链 | 未验证：未走查原任务回执 | 未验证：未走查恢复和防重发 | 未验证：未走查保存重开 | 未验证：未重测原生成防重入 |

本次新读面不创建媒体；实际生成的花费和回执归原 Run/授权体系，上表未验证项不能外推成“不重复扣费”结论。

### 功能分类
- [x] 新界面 / 改交互
- [x] 花钱
- [x] 新增功能 / 性能
- [x] 大数据量 / 画布 / 长列表
- [x] 数据格式
- [x] Agent 行为
- [x] 长跑 / 可打断

## 拍板图

- ModelSurfaces: picker.search
- ModelSurfaces: cost.send-pill
- ModelSurfaces: cost.hover
- ModelSurfaces: cost.low-balance

清单为 `docs/design/boards/2026-11-07-model-surfaces/ModelSurfaces.board.json`。上述四项在清单中为 implemented，当前合流头独验仍未完成。账户卡、账户菜单、AI 接入行及选择器能力行在清单中为 in-progress，本 PR 只覆盖其设计卡列出的有限增量，不认领整项完成；其余完整板件见后续片。

## 碰到的规则与门岗

- `scripts/check-i18n-no-cost-claims.mjs`：本意改动，限定放行已批准账户/公开估价的六个精确双语键值；未扩大任意金额文案通配。
- `scripts/check-i18n-no-cost-claims.node-test.mjs`：本意改动，覆盖批准键值可通过、同键“免费”及任意键复用报价文字仍被拒绝。
- `docs/engineering/concept-owners/catalog.credential-availability.json`：登记的 write_api 从旧名 resolveTarget 跟随真实定义 resolveVendorReadTarget，credentialRecordCounts 唯一 owner 不变。
- `scripts/boundary-owners-ledger.json`：历史根因合同保留原快照，通过已有 reanchored 机制将 resolveTarget 指向同文件的 resolveVendorReadTarget；不修改合同、门岗或产品代码。
- `docs/engineering/self-written.json`：用 model-surface-account-quote 精确认领六个领域适配模块，不扩大 domainRoots；领域约束与复用查证见“先查别人”。

## 先查别人

- `electron/ai/onboarding/vendorHealth.ts:78` · 现有 resolveVendorReadTarget 持有连接凭据和指纹；账户读面直接复用它 · 确认登记跟随真实符号，不新增凭据主人。
- `electron/ai/onboarding/vendorPriceRequest.ts:1` · 现有 selectTaskMapping、applyHeadlessParamDefaults 和 buildProfileHttpRequest 渲染最终出站报文 · 确认估价只投影 Nomi 实际任务请求，不平行维护型号/参数目录。
- `electron/appFetch.ts:20` · 项目已有统一 fetch 传输 · 确认账户与价格读取复用它，不新造 HTTP 或代理层。
- `src/workbench/ai/v4/formatMoney.ts:16` · 货币格式器使用 Intl.NumberFormat；订阅用 `src/ui/onboarding/useVendorAccountFacts.ts:12` 的 React.useEffect · 确认只写 Nomi 的连接身份、最终规格、金额来源和画布批准语义适配，不另造格式器或状态框架。

自写登记 model-surface-account-quote 的领域约束：只有 Nomi 的节点、参考关系、变体映射和最终出站请求能决定镜头公开价是否可估；账户与有限 Key 的有效额度、固定/输出估价的确定程度决定画布充值或原生成批准动作。通用能力均复用上述已有边界。六个模块没有第二份目录、凭据或付费授权 owner；只更新登记，不改产品代码。

## 系统改进

[方向记录](docs/plan/2026-11-08-price-balance-direction-check.md)采用共享 priceBalanceStatus，独立区分已核实零余额与公开估价短差。已渲染充值按钮的动作固定，30 秒后点击只刷新；输出估价不计算确定短差。账户与报价复用当前连接身份，旧响应不得覆盖新输入。确定性测试覆盖账户/有限 Key 零值、无限、未知、过期、固定价/输出估价；Electron 回环检查媒体创建为零。本轮合流不新增生产修补。

## 性能

- 场景：`apimart-model-picker`。
- 预算：中位 150ms / p95 200ms；budgetStatus 为 proposed。
- 基线：待协调写基线。
- 本轮使用 --id apimart-model-picker --runs 5 --measure-only 运行；因 noisy 被拒收，结果 no-data，有效样本 0，无可填的中位数或 p95。未写基线、未改预算。失败记录：docs/evidence/2026-11-08-apimart-model-surfaces/perf-apimart-model-picker.json。

## 验收证据

- ui-mockup：docs/design/boards/2026-11-07-model-surfaces/ModelSurfaces.board.json
- ui-click-census：未验证：当前合流头未执行有限增量免费演练和完整板件按钮普查。
- ui-capability-unavailable：未验证：tests/ux/apimart-model-surfaces.rehearsal.mjs 已有空搜索→AI 接入和账户不可读→刷新量具，但当前合流头未执行。
- ui-ai-walk：未验证：无真实账户和真实生成任务。
- ui-screens：未验证：当前合流头演练尚未执行，无本轮中英截图。
- ui-task-scorecard：未验证：本轮任务未包含完整体验成绩单。
- spend-walks：未验证：完整中英演练未执行；本轮仅执行性能模式的英文 fresh 目录回环，不能代替完整走查。
- spend-paid-sample：未验证：本轮禁止真实账户接口及花费，后续协调验真实估价/回执/余额。
- spend-fault-injection：未验证：当前合流头未跑 electron/ai/onboarding/vendorAccountFacts.test.ts、electron/ai/onboarding/vendorPricePreview.test.ts 和演练中的未知账户状态。
- perf-scenario：未验证：apimart-model-picker 已按 5 次运行，但量具因 noisy 拒收；有效样本 0，中位数与 p95 均为 null，预算保持中位 150ms / p95 200ms。
- upgrade-path：不适用：本分支未改项目文件、设置、钥匙串条目名、目录缓存或迁移的持久化形状；上述存储 schema/写入路径的 origin/main...HEAD diff 无改动。accountFacts 只加入编译期 VendorSeed，seedVendor 显式写入原字段且不拷贝它（electron/catalog/seedBuiltins.ts:467）；新账户/报价缓存仅为进程 Map（electron/ai/onboarding/vendorAccountFacts.ts:11、electron/ai/onboarding/vendorPricePreview.ts:10）；新增设置导航值仅在 React.useState（src/ui/onboarding/OnboardingDrawer.tsx:74、src/workbench/settings/useSettingsDialogController.ts:34）。
- agent-intent-eval：未验证：本轮未跑真实模型意图评测，未测首次做对率。
- run-e2e-chain：未验证：本轮未执行关窗、重启、断网后的完整任务恢复与防重复扣费链。

## 后续片

- 完整接入引导：统一入口来源、粘 Key 四项检查、错误分支、返回原稿、首屏大页与邀请码。
- M1 完整管理、旧连接提示、按型号用量与单价页。
- M2 参数合并芯片、独立草稿/上线行、旧型号置顶提示。
- M4 多镜确认卡、生成后预计/实扣、来源详情和上游充值失败动作。
- 真实账户字段/单位、真实零余额、真实输出估价→回执实扣→余额变化与误差。
- 有效性能基线和最终头独立验收；完整模型接入流程尚未完成。

## 独立验收

- 验收线：V-model-surfaces-final
- 状态：推送后派出，报告和结论验收完再补。
