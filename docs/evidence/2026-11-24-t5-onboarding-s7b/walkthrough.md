# T-5 接入引导第一批切片（E0 + S7b）实测与升级验证记录

- **日期**：2026-11-24
- **实现线**：`t5-onboarding-s7b-impl`
- **设计卡**：`docs/plan/2026-11-24-t5-onboarding-s7b.md`
- **拍板清单**：`docs/design/boards/2026-11-07-onboarding/Onboarding.board.json`（认领 `implemented` 19 项 + `dropped` 4 项）
- **真窗口走查剧本**：`tests/ux/t5-onboarding-s7b.walk.mjs`（零公网、隔离合成凭据存储 + 本机回环夹具）

## 1. 拍板样张逐项并排对照（双轨 zh-CN / en、暗色、窄窗）

| 对照图 | 视口 / 模式 / 语种 | 结果与细节核对 |
|---|---|---|
| `docs/evidence/2026-11-24-t5-onboarding-s7b/board-vs-impl-library.png` | `1440×900` · 浅色 · `zh-CN` | 全新空装机无开屏直达项目库；首屏主卡显示实时 APIMart 活跃模型数 `88`、3 张 `108×108` 随包作品（第 2 张 `resources/onboarding-demo/nano-banana-2.jpg` 原图自身为 `#fcfcfc` 浅白棚拍底双视图 JPEG，容器底色 `bg-nomi-ink-05` 兜底）、黑底胶囊按钮「连接模型」与「用别家服务？去设置」；下方三张起始卡全部降为 `default`（全页仅 1 个黑底主动作）。 |
| `docs/evidence/2026-11-24-t5-onboarding-s7b/board-vs-impl-zh.png` | `1440×900` · 浅色 · `zh-CN` | 共用 `ShellFrame` + `ShellTopBar` `40px` 顶栏（`← 项目库 › 连接 APIMart`），零模态遮罩；左 `680px` 一大两小拼贴，右 `624px` 严格仅用 `400 / 600` 两种字重；三栏 `tabular-nums` 大数（`88` / `最新一代` / `4%–47%`）、估算行 +「数字怎么来的」5 条口径 `AnchoredPopover`、三步轮播与悬停官网路径、1 秒防连点外链主按钮、「打不开？」3 个官方备用域与代理深链、非受控密码框（`outerHTML` 零明文泄露）及点击触发粘贴钮全部到位。 |
| `docs/evidence/2026-11-24-t5-onboarding-s7b/board-vs-impl-en.png` | `1440×900` · 浅色 · `en` | 英文双轨排版无截断、无溢出，句中引号词组保持单行不拆裂。 |
| `docs/evidence/2026-11-24-t5-onboarding-s7b/board-vs-impl-dark.png` | `1440×900` · 暗色 · `zh-CN` | 暗色 token 对账一致；第 1 步悬停显示 `已有账号直接登录 · 注册 → 创建账户` 路径提示。 |
| `docs/evidence/2026-11-24-t5-onboarding-s7b/board-vs-impl-narrow.png` | `1024×700` · 浅色 · `zh-CN` | `< 1200px` 自动切换顶部 `80px` 横排作品条 + 下方 `624px` 单栏居中；主按钮「打开官网」与底部 Key 输入框均留在 `700px` 首屏视口内，零横向滚动条。另实测项目库 `1100×690` 窄窗同样无溢出。 |

## 2. 老用户升级零打扰验证（`upgrade-path`）

1. **0 项目 + 已接通 APIMart（`O0-old-user-empty`）**：在整窗大页点粘贴钮经本机回环校验保存合法 Key 后自动关闭大页回到项目库，首屏主卡出现次数 = `0`，「新建空白项目」恢复 `primary` 深色主卡。
2. **0 项目 + 已接入非 APIMart 可用连接（反例 C2）**：登记自定义 `openai-compatible` 可用模型后重载项目库，首屏主卡出现次数 = `0`，「新建空白项目」保持 `primary` 深色主卡。
3. **已有本地项目的老用户（`O0-old-user`）**：存在 ≥1 个项目时回到项目库，首屏主卡出现次数 = `0`，项目卡片与未连文本模型顶部单行提示条原样保留；既有项目存档、`model-catalog.json` 与钥匙串凭据零迁移、零改写。
4. **示例旅程收尾软提示（`entry.finale-line`）**：未连模型走完示例项目引导后，收尾弹窗显示温和提示且 `「连接模型」`（`getClientRects().length === 1`）不跨行拆开；从示例项目工作台内触发连接入口时顶栏显示 `← <项目名> › 连接 APIMart`，按 `Esc` 直接返回同一项目工作台。

## 3. ★7 性能基准实测（`onboarding-connect-open`）

- **场景配置**：`tests/perf/scenarios/onboarding-connect-open.json`（`E10` 10 节点项目画布，从 `Settings › 模型 › APIMart` 真实点击触发整窗平级页打开，到主按钮与 Key 输入框可见再过两帧 `apimartConnectReady`）
- **机器与轮次**：`darwin arm64 Apple M5 x10 / 16GB`，1 轮预热（`48.5ms`）+ 5 轮正式采样（`47.4ms / 45.5ms / 46.3ms / 43.9ms / 46.3ms`）
- **实测结果**：
  - `response`：**中位数 `46.3ms` · p95 `47.2ms`**（预算：中位数 `≤ 150ms`、p95 `≤ 225ms`，结论 `ok`）
  - `longTasks`：**`0` 次（`0ms`）**
  - `mediaRequests`（公网/外发）：**`0` 次**（3 张随包作品全部走本机 `nomi-local://runtime/onboarding-demo/`）
  - 冷启动首启主卡可见耗时：实测 `4,363ms`（消除了旧版 `SplashIntro` 13,000ms 全屏遮挡）
