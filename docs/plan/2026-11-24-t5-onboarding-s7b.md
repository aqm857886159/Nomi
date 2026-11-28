# 设计卡：T-5 接入引导第一批切片（E0 + S7b：收成一扇门、删开屏、首屏主卡与整窗出发大页）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：T-5 接入引导 E0 + S7b            线/负责人：t5-onboarding-s7b-impl            类别：[新界面]
```

> 2026-11-24。拍板来源：`docs/design/boards/2026-11-07-onboarding/Onboarding.board.json`（r8 减字版，用户 2026-11-15「可以，照这版做」；Q18 用户 2026-11-07「可以删掉现在的开屏展示 因为感觉也有点不匹配」；设计合同 `docs/plan/2026-11-15-onboarding-board.md`）。
> 本切片覆盖 `E0`（把「连接模型」收成一扇门）与 `S7b`（删开屏 `Q18`、项目库首屏主卡 `O0-library`、老用户零打扰 `O0-old-user`、示例旅程收尾提示 `O0-finale`、整窗出发大页 `Main / O2-*` 及底部 Key 粘贴保存 `depart.key-input` 视觉与 `upsertVendorApiKey` 接线）。`S7a`（画布/列表/Agent 面板内指路文案改写）与 `S6`（粘贴后四项自动检查表、等待、余额与六种错误卡）按计划留归后续切片，`onb.drop.preset-count` 保持 `missing`。

## ★0 先查别人

- NN/g Empty-State Interface Design（https://www.nngroup.com/articles/empty-state-interface-design/）· 空状态应直接说明当前系统状态、提供真实示例线索并给直达关键任务的唯一主动作，而非叠一次性遮罩教程 · **确认了**删掉 13 秒全屏 `SplashIntro`（Q18），让未连模型的新用户首启直接落到项目库，由首屏主卡承担第一眼引导；主卡出现时把下方「新建空白项目」从深色主卡降为普通卡，保证一屏只有一个主动作。
- Linear / Apple 产品页信息分层（https://linear.app/ · https://www.apple.com/macbook-air/）· 靠字号差、三栏等宽 `tabular-nums` 大数字和留白分层，只用 `400 / 600` 两种字重，细则收进单处说明浮层，不叠底色框和行框 · **改了**大页右栏排版（r8）：去掉旧稿底色块与步骤常驻外框，只保留标题、三个大数、成本行 +「数字怎么来的」浮层、三步轮播行、主按钮「打开官网」+「打不开？」备用地址展开块、一行顾虑说明与底部 Key 输入框。
- RFC 8252 OAuth 2.0 for Native Apps（https://www.rfc-editor.org/rfc/rfc8252）与 Apple NSPasteboard AccessBehavior（https://developer.apple.com/documentation/appkit/nspasteboard/accessbehavior-swift.enum/default.md）· 注册与登录走系统默认浏览器，不在应用切回前台时静默读剪贴板（macOS 15.4+ 会触发系统粘贴提醒），仅在用户显式点击粘贴按钮时读取剪贴板 · **确认了**「打开官网」及三个官方备用地址走外链桥由系统默认浏览器打开（1 秒防连点），Key 输入框旁 `WorkbenchIconButton`（`IconClipboard`）仅在用户点击时调 `navigator.clipboard.readText()`，不挂 `focus` / `visibilitychange` 剪贴板读取。
- 仓库先例：`src/ui/onboarding/onboardingDrawerConnections.ts:18` `projectOnboardingConnections`、`electron/catalog/rendererCatalogMutation.ts:141` `upsertRendererCatalogVendorApiKey`、`electron/protocol/localRuntimeAssets.ts:19` `RUNTIME_BUNDLES` · 现有连接可用性投影已排除了未填 Key 的内置供应商、未登录的即梦与离线转写辅助 `local-speech`；现有 `upsertVendorApiKey` 在主进程完成 401/403 拒收闸并自动启用发布预置模型；现有 `nomi-local://runtime/<bundle>/<file>` 支持开发态与 `app.asar` 同路径读取和 HTTP Range · **确认了**直接复用这三处单一主人，不另造第二套可用性判断、保存通道或 Vite 静态资源副本。
- 出口：不涉及：本切片删掉了挡住首屏 13 秒的 `SplashIntro` 遮罩，未新增、扩大或挪动任何拒绝、加锁或阻塞放行的保护；整窗「连接 APIMart」大页随时可点左上角「← 来处」或按 `Esc` 返回原处，不想用 APIMart 的创作者可点主卡「用别家服务？去设置」直达 `Settings › 模型` 首页。

## ★1 用户怎么用

当我第一次安装打开 Nomi（还没有任何项目，也没有连任何模型）或在工作区点击「连接模型」时，我想一眼看到连上 APIMart 能做出什么样的图和视频、大概成本与官网三步流程，并在粘贴 Key 后立即接通回到刚才的位置，同时如果我是已经连好模型或已有项目的老用户，升级后不会被任何新引导卡片打扰。

1. 全新首启打开 Nomi：没有 13 秒开屏动画，直接进入项目库；连接状态判定未完成前首启区整块暂不渲染（零跳动），判定为「0 项目且 0 可用连接」后一次画出首屏主卡（左 3 张 `108×108` 随包作品，右实时目录模型数标题、估算行、「连接模型」深色主按钮、「用别家服务？去设置」），下方「新建空白项目」降为普通卡。
2. 点「用别家服务？去设置」：直接打开 `Settings › 模型` 首页（「用 AI 帮我接入」与自定义/本地接入都在原位）。
3. 从首屏主卡、项目库提示条、画布/创作连接入口或 `Settings › 模型 › APIMart`（自动先关设置弹窗）点击连接：统一打开整窗工作区页面「连接 APIMart」（顶栏 `40px` 面包屑 `← 来处 › 连接 APIMart`），已打开时重复触发只聚焦当前大页、不开第二个。
4. 在宽窗（`>= 1200px`）看到左 `680px` 一大两小真作品拼贴（视频格按方案 1 海报帧与静音播停，失焦/隐藏/减弱动效即停）+ 右 `624px` 留白分层说明；窄窗（`< 1200px`，如 `1024×700`）作品收成顶部横条、下方 `624px` 单栏居中，主按钮「打开官网」保持在首屏内。
5. 悬停或点击「数字怎么来的」查看 5 条口径出处浮层；悬停三步任意一行查看官网对应按钮路径；点「打开官网」用系统浏览器打开带邀请码注册页（1 秒内防连点）；若打不开可展开「打不开？」切换三个官方备用地址或跳往模型网络代理设置。
6. 复制 Key 后回到大页，点粘贴图标钮（或输入框内粘贴按回车）：通过 `upsertVendorApiKey('apimart', { apiKey, enabled: false })` 交主进程校验保存并发布模型，成功后自动关闭大页回到原处；项目库主卡消失，「新建空白项目」恢复深色主卡。
7. 若先点项目库第三张卡走完示例旅程，未连模型时收尾弹窗正文下方显示两句温和提示（不加额外跳转按钮）。

不做：
- 不做开屏动画或设置页「重看开屏动画」（Q18 已拍板删除）；不在项目库挂右下角形象胶囊（Q20）；
- 不在本切片改动 `S6` 的四行自动检查表（`O4a-check`）、等待横幅（`O3-waiting`）、零余额充值卡（`O5-topup`）及六种细分错误卡（`O6-errors`）；
- 不动 `onb.drop.preset-count`（尚无用户拍板原话，维持 `missing`）；
- 不在窗口 `focus` / `visibilitychange` 时自动读取系统剪贴板。

已知坑：
- 全新安装时 `seedBuiltins` 默认把 `volcengine-speech`、`dreamina`、`local-speech` 标为 `enabled: true, authType: 'none'`，裸查 `models.some(m => m.availability.usable)` 会把全新空装机误判成「已有可用连接的老用户」导致首屏主卡永远不出；必须复用 `projectOnboardingConnections` 的已连接投影判定真实可用连接。
- `src/bundleAssetUrlBoundary.test.ts` 禁止在 `src/` 新增 `new URL(..., import.meta.url)` 打包媒体；随包作品统一放 `resources/onboarding-demo/` 经 `nomi-local://runtime/onboarding-demo/<file>` 读取。
- `Seedance 2.0` 橘猫 1.0–3.8s 裁片 `.mp4` 原文件未入仓（清单 `unverified` 已记）：大页视频格完整实现方案 1 控制器与 `nomi-local://runtime/onboarding-demo/seedance-2.0.mp4` 挂点，文件缺失或 1 秒未解出首帧时按 `big.motion` 自身规则稳停在随包 1.4s 橘猫海报帧，不伪造合成视频。

真实任务：
- T1（全新首启 → 主卡 → 整窗大页 → 粘贴接通回库）：隔离全新目录冷启动 Electron，核对无开屏直达项目库首屏主卡、实时模型数与三张随包作品加载正常；点「连接模型」进整窗大页，核对宽窗（`1440×900`）与窄窗（`1024×700`）、中英文、暗色、步骤悬停、「数字怎么来的」浮层与「打不开？」展开块；通过本机回环夹具填入 Key 保存后自动回项目库，主卡消失、「新建空白项目」恢复深色。
- T2（老用户零打扰验证）：分别用「已有本地项目」与「0 项目但已接入别家/本机可用模型」两类真实目录结构启动 Electron，核对首屏主卡出现次数均为 `0`，已有连接空项目首屏保持原三张起始卡且「新建空白项目」为深色。
- T3（示例旅程收尾提示与多入口同门）：未连模型走示例旅程到收尾弹窗核对 `entry.finale-line` 出现且句中引号不拆行；从 `Settings › 模型 › APIMart` 点击连接核对先关闭设置弹窗再打开同一个整窗大页，重复触发不叠第二个实例。

指标（目标 → 信号 → 指标）：

| 指标 | 目标 | 量具 | 基线 |
|---|---|---|---|
| 主：首启直达项目库可交互耗时 | 删掉 13s 开屏后，冷启动到首启区判定完成并画出主卡无需等待开屏遮罩；打开「连接 APIMart」整窗大页 `response` 中位数 ≤150ms（p95 ≤225ms），`longTasks` = 0 | perf 场景 `onboarding-connect-open`（`tests/perf/canvas-scale-bench.mjs`）+ 真 Electron 首启计时（`tests/ux/t5-onboarding-s7b.walk.mjs`） | 旧版首启被 `SplashIntro` 遮挡 13.0s；本切片实测首启直达主卡 4,363ms，`onboarding-connect-open` `response` 中位数 **46.3ms** / p95 **47.2ms**（预热首开 48.5ms，`longTasks` = 0） |
| 质量：拍板清单与双轨视觉一致性 | 本切片认领的 `E0 + S7b` 全部元素通过 `check:board-parity`；中/英/暗色/`1024×700` 窄窗并排对照无溢出、无多余字重（仅 `400/600`）、句中引号跨行拆裂 = `0` 处 | `pnpm run check:board-parity` + `tests/ux/t5-onboarding-s7b.walk.mjs` + `docs/evidence/2026-11-24-t5-onboarding-s7b/board-vs-impl-*.png` | `Onboarding.board.json` 全部 `missing` |
| 护栏：老用户误出主卡率 | 已有项目或已有任一可用模型连接（含非 APIMart / 本机）时首屏主卡出现比例 = `0%`；未配置凭据的全新装机首屏主卡出现比例 = `100%` | `src/ui/onboarding/onboardingModelAvailability.test.ts` + `tests/ux/t5-onboarding-s7b.walk.mjs` | 新功能基线 |
| 护栏：前台切回静默读剪贴板次数 | 窗口 `focus` / `visibilitychange` 触发剪贴板读取次数 = `0`；仅点击粘贴图标钮触发 `1` 次 | `src/ui/onboarding/ApimartConnectPage.test.tsx` | 0 次 |

新手 / 老手人设与记录方式：
- 新手人设：首次下载 Nomi 的独立创作者，手里还没有任何 API Key，关心能做出什么效果、怎么注册和 Key 存哪；老手人设：已接好自定义中转或已有 3 个在制项目的老用户，升级后只想直接继续干活。
- 记录方式：`tests/ux/t5-onboarding-s7b.walk.mjs` 逐步记录「预期 → 实际」并输出中英/暗色/窄窗真窗口截图与拼图到 `docs/evidence/2026-11-24-t5-onboarding-s7b/`。

### ★1b 连带界面

- `Settings › 关于`（`src/workbench/settings/AboutSection.tsx`）：删除「重看开屏动画」行与 `onReplaySplash` 属性；其余版本检查、反馈与分享、开源信息原样保留。
- 设计实验室最小窗对话框普查（`src/devlab/designLab/primitivesSurfaces/states/04-dialogs.tsx` 与 `tests/ux/design-lab-primitives-surfaces.walk.mjs`）：同步移除已删除 `SplashIntro` 对应的 `ps-45-splash-dialog` 镜像项；同步清理历史走查脚本里指向 `[data-splash-skip]` / `.nomi-splash` 的死选择器，保持 `check:walkthroughs` 零新增死锚点。
- 示例旅程收尾弹窗（`src/workbench/onboarding/JourneyTourController.tsx`）：未连任何可用模型时在正文下增加 soft 提示行（`entry.finale-line`），已连模型时不显示，「走一遍 / 先逛逛」按钮行为不变。
- 付费走查可见接入辅助（`tests/ux/_paidEnvKey.mjs`）：当从 `Settings › 模型` 点击未接入的 `APIMart` 跳到整窗「连接 APIMart」大页时，兼容在大页密码框填入 Key 提交并等待可用性落定。
- Agent 工具与回执：本切片不新增或修改任何 Agent 工具，无回执文案变更。

### ★1c 老用户

- 已有项目的老用户（无论是否连过模型）：`ProjectLibraryPage` `firstRun === false`，首屏主卡出现 `0` 次；未连文本模型时继续显示原有的单行顶部提示条，已连模型时什么都不多出。
- 0 项目但已连好任一可用模型的老用户（含 APIMart、火山/OpenRouter 等已知供应商、自定义中转站、本地模型、ComfyUI、Codex 本地、已登录即梦）：`hasUsableModelConnection === true`，首屏主卡出现 `0` 次，看到原有的三张起始卡且「新建空白项目」保持深色主卡（`O0-old-user-empty`）。
- 已有的项目文件、系统钥匙串里的 API Key、`model-catalog.json` 连接与启用状态：**零迁移、零改写、零重新探测**；老用户 `localStorage` 里遗留的 `nomi:splash:v1` 不再读取、留在原地无害，退回上一版仍正常识别为已看过开屏。
- 证据：`src/ui/onboarding/onboardingModelAvailability.test.ts`、`src/workbench/onboarding/onboardingState.test.ts` 与 `tests/ux/t5-onboarding-s7b.walk.mjs` 老用户双态实测截图，PR 交 `upgrade-path` 证据。

## ★2 谁说了算

| 概念 / 事实 | 唯一 owner | 允许消费者 | 这个「1」靠什么保持 |
|---|---|---|---|
| 是否存在任一可用模型连接 + APIMart 实时可目录模型数 | `src/ui/onboarding/onboardingModelAvailability.ts`（复用 `projectOnboardingConnections` 与 `listWorkbenchModelCatalogModels`） | `ProjectLibraryPage`、`JourneyTourController`、`ApimartConnectPage`、`NomiStudioApp` | 使用结果处只读该 hook 返回的 `{ loading, hasUsableModelConnection, apimartConnected, apimartCounts }`；模型数按 `vendorKey === 'apimart' && catalogLifecycle !== 'legacy' && !promptRefineOnly` 单处统计，组件内零硬编码数字 |
| 整窗「连接 APIMart」大页开关与返回来处 | `src/ui/onboarding/apimartConnectRoute.ts` + `src/workbench/NomiStudioApp.tsx` | 全仓连接入口、`SettingsDialog` / `OnboardingDrawer`、`ApimartConnectPage` | 显式事件 `nomi-open-apimart-connect`（及未连模型且无 `pendingCustomCallIntent` 时的 `nomi-open-model-catalog`）统一收口到 `NomiStudioApp` 单一状态；已打开时重复触发只聚焦大页、不叠第二个，关闭回原视图（项目库或当前项目工作区） |
| APIMart Key 保存与预置模型发布 | 主进程 `electron/catalog/rendererCatalogMutation.ts:141` `upsertRendererCatalogVendorApiKey` | `ApimartConnectPage`（经 `getDesktopBridge().modelCatalog.upsertVendorApiKey('apimart', { apiKey, enabled: false })`） | 渲染层遵守 `manualCertificationBoundary` 永不传 `enabled: true`，只由主进程校验后写钥匙串并发布 |
| 随包引导示例媒体读取 | `electron/protocol/localRuntimeAssets.ts`（`RUNTIME_BUNDLES['onboarding-demo']` → `resources/onboarding-demo/`） | 项目库首屏主卡、`ApimartConnectPage` | 统一走 `nomi-local://runtime/onboarding-demo/<file>`，不触碰 `new URL(..., import.meta.url)` 边界 |

- 不靠「东西不见了」猜用户意图：打开大页、返回来处、展开备用地址、读取剪贴板、提交 Key 全部由显式用户动作触发；仅在本次大页内亲手保存 Key 成功后自动返回来处。
- 「不知道」与加载中处理：`loading === true` 时项目库 `firstRun` 区整块留白等待（不当成「未连接」先画主卡再闪退，也不当成「已连接」先画三张起始卡再被主卡顶下去）。

## ★3 一致与复用

- 历史拍板核对：
  - `2026-11-07` Q18 删开屏与重看入口、`2026-11-07` Q19 首屏提示条换主卡、`2026-11-07` Q20 项目库不挂形象胶囊、`2026-11-15` r8 减字版拍板：全部有效，本次照做。
  - `2026-11-17` `D-1117-delete-verification`（保存 Key 即接入、401/403 拒收）：按协调指令，本切片底部 Key 框直接接现有 `upsertVendorApiKey`，不在本切片自造 `S6` 四行检查状态机。
- 三条路选择：**删掉 + 收成一扇门**——彻底删掉 `SplashIntro` 并把分散在各处的连接入口收口到单一整窗页面，复用设计系统现成 `WorkbenchButton`、`WorkbenchIconButton`、`Tooltip`、`ActionCard`、`NomiLogoMark` 与外壳顶栏几何常量（`SHELL_TOPBAR_HEIGHT`、`SHELL_MAC_TRAFFIC_WIDTH`），零新增全局 CSS、零新增第三方依赖（`check:self-written` 零新增自写通用件）。

## ★4 全状态

- **加载中（`loading`）**：项目库 `firstRun` 区在目录与连接判定返回前保持同尺寸留白容器，不先渲染三张卡造成布局跳动；大页视频格先显示随包海报帧。
- **空 / 未连接（`empty`）**：`0 项目 + 0 可用连接` 时项目库显示首屏主卡，「新建空白项目」降为普通卡；大页显示完整主张、实时模型数、三步引导、主按钮与空 Key 输入框。
- **保存中（`saving`）**：粘贴或回车提交 Key 期间输入框与粘贴钮进入 `disabled/busy`，防止并发重复提交。
- **成功（`success`）**：Key 保存并发布成功后清空内存中的 Key 字符串、广播目录刷新并自动关闭大页回到原处；项目库主卡消失，「新建空白项目」恢复深色。
- **失败（`error`）**：空输入聚焦输入框提示粘贴 Key；主进程返回 401/403 或保存异常时在输入框下方用 `text-workbench-danger` 显示具体原因，Key 输入框保留便于重粘，不静默吞错。
- **取消中**：不涉及长跑异步任务取消；用户在打开大页任意时刻点「← 来处」或按 `Esc` 立即同步退出回原处。
- **过期**：不涉及会话过期；老用户本地 `nomi:splash:v1` 残留键忽略不读。
- **能力不可用（`ui-capability-unavailable`）**：
  - 官网主站在当前网络打不开：主按钮旁紧跟「打不开？」，点开即给出 `apib.ai`、`aiuxu.com`、`aishuch.com` 三个带邀请码的官方备用地址按钮、手机/异机注册提示，以及直达 `Settings › 模型 › 高级 › 网络` 代理配置的可点入口；
  - 想接非 APIMart 服务：首屏主卡直接提供「用别家服务？去设置」一步打开 `Settings › 模型` 首页；
  - 剪贴板权限拒绝或为空：点击粘贴按钮捕获异常后聚焦输入框并提示直接按 `⌘V / Ctrl+V` 粘贴；
  - 视频文件不可解或系统开启「减弱动态效果」：自动停留在随包高清海报帧，不露破损播放器图标。
- **会被数据撑开的地方**：顶栏返回处的项目名设 `max-w-[240px] truncate`；模型总数用 `tabular-nums` 支持 2–4 位数；英文长句在 `1024×700` 窄窗与 `1100×690` 项目库窄窗实测不溢出；所有句中引号词组用 `whitespace-nowrap` inline `<span>` 包裹防止跨行拆裂。

## 5 中途表

| 状态 | 停住不动 | 关窗 | 断网 | 重启 App | 连续猛点 |
|---|---|---|---|---|---|
| 项目库首屏主卡 | 静态展示随包图，0 后台轮询 · 不花钱 · 无回执 | 什么都不写盘 · 不花钱 · 下次打开仍在 | 随包图走 `nomi-local://` 正常显示 · 不花钱 · 无回执 | 仍为 0 项目 0 连接时照常出主卡 · 不花钱 · 无回执 | 连点「连接模型」只打开 1 个大页 · 不花钱 · 无回执 |
| 大页浏览 / 视频格播放 | 播完一轮停海报帧 2s 再播；失焦/切后台即停解码 · 不花钱 · 无回执 | 返回或关窗即卸载 `<video>` · 不花钱 · 无回执 | 随包作品与说明正常显示；点「打不开？」可见备用域与代理入口 · 不花钱 · 无回执 | 回到项目库或原项目，点连接可重进大页 · 不花钱 · 无回执 | 连点「打开官网」或备用地址 1 秒防抖只调 1 次外链 · 不花钱 · 无回执 |
| 提交 Key 保存中 | 主进程单次校验写钥匙串后自动回原处 · 不花钱 · 目录刷新事件 | 主进程写完钥匙串或未写完保持原状，不留半截脏状态 · 不花钱 · 下次启动按钥匙串真实状态显示 | 无法连网校验时若主进程放行保存则落盘，若报网络/鉴权错则留在大页红字提示 · 不花钱 · 页内错误提示 | 已写入钥匙串的 Key 重启后直接生效，主卡不再出现 · 不花钱 · 目录已就绪 | 保存中 `busy` 锁住输入框与粘贴钮，不发第二次 IPC · 不花钱 · 无重复回执 |

## 6 外部数据与失败

- **APIMart 注册页与官方备用域**（`https://apimart.ai/register?aff=t55VtP` 及 `apib.ai` / `aiuxu.com` / `aishuch.com`）：出处 `src/config/knownVendors.ts:96` 与 `https://apimart.ai/zh/login`；仅通过系统默认浏览器打开 `https://` 外链，不把任何本机凭据拼入 URL；浏览器打不开时用户通过「打不开？」切换备用域或配置代理。
- **用户输入 / 剪贴板粘贴的字符串**：可能带首尾空格或为空；前端先 `.trim()`，空串本地拦截聚焦，非空串通过密码框交主进程 `upsertVendorApiKey`（明确 401/403 拒收并报具体错误，未知错误原样展示且不把网络故障硬说成 Key 填错，页面 DOM `outerHTML` 不回显明文 Key）。
- **随包演示媒体**（`resources/onboarding-demo/`）：经 `nomi-local://runtime/onboarding-demo/` 读取白名单扩展名（`.jpg` / `.mp4`），拒绝任何 `..` 路径穿越；若视频解码失败或超时 1 秒，自动回退固定显示海报帧。

## ★7 性能

1. **新增用户操作**：① 全新首启无开屏直达项目库首屏；② 点击「连接模型」打开整窗「连接 APIMart」大页（含左栏三张随包媒体与右栏实时目录计数渲染）及按 `Esc` / 面包屑返回原处。
2. **最坏规模**：目录含全部内置种子模型（APIMart 88 个活跃模型 + 其余内置供应商种子），工作区项目含 10 个节点时从工作区/项目库切入整窗大页并在 `1440×900` 与 `1024×700` 间切换。
3. **操作预算**：
   - 点击连接入口 → 整窗「连接 APIMart」大页输入框可见再过两帧（`response`）：**中位数 ≤ 150ms**（尾部 p95 ≤ 225ms），交互期间 `>50ms` 长任务 `longTasks` = **0 个**；
   - 首启去掉 13,000ms 开屏遮罩后，渲染层挂载到首启连接判定落定（`firstRunReady`）不引发布局二次跳动（跳动次数 = 0）。
4. **性能场景与量具**：登记 `tests/perf/scenarios/onboarding-connect-open.json`（复用 `tests/perf/canvas-scale-bench.mjs` + `responseTimer.mjs` 的 `apimartConnectReady` 判据，不自写剖析器）。Apple M5 x10 / 16GB 真 Electron E10 画布 5 轮实测（1 轮预热 48.5ms）：`response` 5 轮为 `47.4ms / 45.5ms / 46.3ms / 43.9ms / 46.3ms`，**中位数 `46.3ms`、p95 `47.2ms`**（远低于 `150ms / 225ms` 预算），`longTasks = 0`（0ms），公网媒体请求 `0` 次；全新隔离目录冷启动直达项目库主卡就绪实测 `4,363ms`（消除了原 13,000ms 全屏开屏遮挡），首启判定区布局跳动次数 = `0`。

## 8 真实条件

- [x] 中文界面（`zh-CN`）：真 Electron 窗口实测项目库主卡、老用户双态、收尾卡、整窗大页及浮层/展开态截图并亲眼核对。
- [x] 英文界面（`en`）：真 Electron 窗口实测 `O0-library-en`、`O2-en`、`O2-copy-en` 浮层与窄窗引号不拆行。
- [x] 暗色模式（`dark`）：真 Electron 窗口实测 `O0-library-dark` 与 `O2-dark`（含第 1 步悬停路径提示）。
- [x] 最小 / 窄窗口（`1024×700` 大页、`1100×690` 项目库）：真 Electron 窗口实测顶部横条切换、主按钮在首屏、零横向滚动条。
- [x] 干净安装与老用户数据升级：隔离空目录首启 vs 含项目 / 含已接入别家模型目录实测。
- [x] 键盘全程：`Tab` 聚焦、「连接模型」回车打开大页、步骤键盘聚焦显示提示、粘贴钮聚焦提示、`Esc` 返回原处。
- [ ] Windows 真机窗口控件区：`unverified`（当前在 macOS 实测；顶栏右端已复用 `ShellTopBar` 同款 `shellChromePlatform() === 'win'` 原生三键 `env(titlebar-area-*)` 让位计算）。
- [ ] 真付费 Key 线上余额查询：`unverified`（本切片不改线上扣费与 `S6` 余额检查接口，免费回环演练与单测覆盖保存链路）。

## 拍板图清单

- 清单路径：`docs/design/boards/2026-11-07-onboarding/Onboarding.board.json`
- 本切片翻转为 `implemented`（19 项，均绑定 `tests/ux/t5-onboarding-s7b.walk.mjs` 断言）：`big.entry-routing`、`entry.library-main-card`、`entry.library-other-provider`、`entry.library-start-cards`、`entry.old-user-nothing`、`entry.finale-line`、`depart.steps`、`depart.cost-time`、`depart.open-site`、`depart.cant-open`、`big.page`、`big.back`、`big.works`、`big.motion`、`big.claim`、`big.reasons`、`big.worries`、`big.fineprint`、`big.narrow`。
- 本切片翻转为 `dropped`（4 项 `change: "removed"`，均附用户拍板原话与日期，并在走查中断言零残留）：`onb.drop.splash`、`onb.drop.splash-replay`、`onb.drop.library-pill`、`depart.frame-height`。

## ★9 验收与回滚

- **独立验收方式**：由非 `t5-onboarding-s7b-impl` 的独立验收线在干净工作树运行：
  1. `pnpm exec vitest run --maxWorkers=2 src/ui/onboarding/onboardingModelAvailability.test.ts src/ui/onboarding/ApimartConnectPage.test.tsx src/workbench/onboarding/onboardingState.test.ts electron/protocol/localProtocol.test.ts`
  2. `pnpm run check:board-parity && pnpm run check:tokens && pnpm run check:controls && pnpm run check:icon-semantics && pnpm run check:i18n && pnpm run check:walkthroughs && pnpm run check:perf-scenarios`
  3. 真 Electron 走查 `node tests/ux/t5-onboarding-s7b.walk.mjs` 复核双轨截图与并排对照图 `docs/evidence/2026-11-24-t5-onboarding-s7b/board-vs-impl-{zh,en,dark,narrow}.png`。
- **动手前写全的验收清单与反例**：
  1. **反例 C1（内置免鉴权种子误判老用户）**：全新空目录含有默认 `enabled: true, authType: 'none'` 的 `volcengine-speech` / `dreamina`（未登录）/ `local-speech` 时，`hasUsableModelConnection` 必须为 `false`，首屏主卡必须出现；若把判定换成裸 `models.some(m => m.availability.usable)`，单测与真窗口首启走查立即翻红。
  2. **反例 C2（老用户连接保护）**：接入任一非 APIMart 可用供应商（如自定义中转、本地模型、ComfyUI）或存在 ≥1 个项目时，首屏主卡出现次数必须为 `0`；若主卡只查「APIMart 有没有连」而忽略别家连接，单测与老用户走查立即翻红。
  3. **反例 C3（硬编码模型数 85）**：当目录中活跃 APIMart 模型数变化（当前主线为 `88`：图片 `25`、视频 `30`、声音 `9`、文字 `24`）时，主卡标题、大页第一栏数字与「数字怎么来的」浮层第 1 条必须同步显示实时计数；写死 `85` 单测立即翻红。
  4. **反例 C4（窗口回前台偷读剪贴板）**：派发 `window` `focus` 与 `document` `visibilitychange` 事件时，`navigator.clipboard.readText` 调用次数必须为 `0`；只有点击粘贴图标钮才调用 `1` 次。
  5. **反例 C5（句中引号跨行劈裂与窄窗主按钮出屏）**：在 `1024×700`（中/英）窗口下，句中 `「…」` / `“…”` 包裹元素 `getClientRects().length` 必须为 `1`，「打开官网 / Open site」底边必须在 `700px` 视口内。
  6. **反例 C6（多入口重入叠双层 / 设置弹窗未关）**：从 `Settings › 模型` 点击未接入的 `APIMart` 后，`[data-settings-overlay]` 必须关闭且 `[data-apimart-connect-page]` 数量严格为 `1`；大页已开时再次派发打开事件，页面实例数仍为 `1`。
- **回滚方案**：单提交/单分支独立切片，未改磁盘存档 schema 与钥匙串格式；如需回滚直接 `git revert` 本 PR 合并提交即可无损恢复旧版行为。

### 功能分类

- [x] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [x] 数据格式
- [x] 新增功能 / 性能
