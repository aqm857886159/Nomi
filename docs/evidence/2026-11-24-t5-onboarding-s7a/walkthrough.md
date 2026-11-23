# T-5 接入引导第二批切片（S7a 全部剩余入口指路收口 + F-D 契约核对）实测与升级验证记录

- **日期**：2026-11-24
- **实现线**：`t5-onboarding-s7a-impl`
- **设计卡**：`docs/plan/2026-11-24-t5-onboarding-s7a.md`
- **拍板清单**：`docs/design/boards/2026-11-07-onboarding/Onboarding.board.json`（认领 `S7a` 全部 7 项 `implemented`：`entry.composer-connect`、`entry.persona-setup`、`entry.library-banner`、`entry.agent-pointer`、`entry.picker-empty`、`entry.copy-unify`、`entry.kept-recovery`；保持 `S6` 13 项与 `onb.drop.preset-count` `missing` 不动）
- **真窗口走查剧本**：`tests/ux/t5-onboarding-s7a.walk.mjs`（零公网、隔离合成凭据存储 + 本机回环夹具）

## 1. 拍板样张逐项并排对照（双轨 zh-CN / en、暗色、窄窗）

| 对照图 / 截图 | 视口 / 模式 / 语种 | 结果与细节核对 |
|---|---|---|
| `docs/evidence/2026-11-24-t5-onboarding-s7a/board-vs-impl-o1a-canvas.png` | `1440×900` · 浅色 · `zh-CN` | 新装未接入状态下图片节点生成框输入「一只橘猫坐在窗台上」：左端模型芯片显示「未连模型 ▾」（点开下拉仅出「还没连模型 · 连接模型」），右端原发送位显示胶囊主按钮「连接模型」（常态深色 `bg-nomi-ink` 见 `impl-o1a-canvas-rest-zh.png`，悬停触发 `hover:enabled:bg-nomi-accent` 并右对齐浮出「出图要先连一个 APIMart 账户（通常几分钟），这段草稿会留着」）；顶栏最右为 `NomiEntryTopbar` 28px 入口（遵守 2026-11-22 D1/D3/D5 删除右下浮动胶囊）。同步核验 `impl-o1a-canvas-dark.png` 与 `impl-o1a-canvas-en.png`。 |
| `docs/evidence/2026-11-24-t5-onboarding-s7a/board-vs-impl-o1c-agent.png` | 面板裁片 + `1440×900` · 浅色 · `zh-CN` | 点顶栏 Nomi 入口展开常驻 Agent 面板：无已配 Key 可恢复文本模型时，对话流只展示 Nomi 身份行、两句说明与可点击指路卡「连接 APIMart / 点一下打开接入页，三步说明和价钱都在那里」（聊天流内 `input, textarea` 计数 = `0`，严守 §P5「Agent 只指路」）；底栏模型钮显示「未连模型 ▾」，点开弹层底部左「连接模型」直达大页、右「去设置」（悬停提示「用 AI 帮我接入」）直达 `Settings › 模型` 首页。同步核验 `impl-o1c-agent-dark.png` 与 `impl-o1c-agent-en.png`。 |
| `docs/evidence/2026-11-24-t5-onboarding-s7a/board-vs-impl-o1b-library.png` | `1440×900` · 浅色 · `zh-CN` | 已有本地项目且无可用连接时，项目库不出首屏主卡（主卡计数 = `0`），顶部单段流动提示条显示 `IconPlugConnected` +「还没连模型 出图、出视频、Agent 都靠一个 APIMart 账户，通常几分钟连好。」+「连接模型」胶囊按钮（删掉旧「助手与画布生成模型分别配置」误导文案）。同步核验 `impl-o1b-library-dark.png`、`impl-o1b-library-en.png` 与 `1100×690` 窄窗 `impl-o1b-library-narrow.png`（英文标题单行不挤成竖条、零横向溢出）。 |
| `docs/evidence/2026-11-24-t5-onboarding-s7a/impl-kept-recovery-zh.png` | 面板裁片 · 浅色 · `zh-CN` | 存在已配 Key 但被停用的助手主控文本模型（经 `fitsAssistantTextRole` 排除 `promptRefineOnly` 内部润色模型与退役模型）时，Agent 面板展示「启用 {{model}}」一键恢复主按钮与「连接模型」次按钮，点击当场恢复。 |

## 2. 草稿保活、全仓术语统一与老用户升级验证（`upgrade-path`）

1. **草稿零丢失往返（`entry.composer-connect` + `entry.picker-empty`）**：在图片节点生成框输入草稿后，分别从左端模型下拉空态项与右端「连接模型」主按钮进入整窗「连接 APIMart」大页（顶栏唯一返回钮显示 `← <当前项目名> › 连接 APIMart`），按 `Esc` 返回工作台后画布工作区未卸载、原草稿 100% 保留。
2. **新装免 Key 种子收口与老用户零改动（11-06 ✅1）**：`DREAMINA_VENDOR_SEED` 与 `VOLCENGINE_SPEECH_VENDOR_SEED` 在全新空目录初始 `enabled: false`，使新装未连账户用户的图片/视频/配音节点如实进入「未连模型」指路态；`seedVendor` 对既有 `model-catalog.json` 中已存在的供应商记录（`existingIndex >= 0`）原样保留 `enabled` 不覆盖，老用户已用连接零变化。
3. **已有可用连接的老用户零横幅（反例 C2）**：经本机回环保存合法 Key 后项目库顶部提示条立即消失；即使老用户仅停用文本模型但仍保留可用生图/视频连接，项目库横幅依然出现 `0` 次。
4. **全仓六处「连接模型」统一（`entry.copy-unify`）**：`Settings › 通用` 上手清单第 1 步点击后先自动关设置再打开大页；`HandbookPanel` 上移至应用根层与设置弹窗同级，项目库与项目内均可通过 `nomi-open-handbook` 打开，且中英文手册四处旧平台名已全部更新为 `APIMart` 三步（`Agnes` 匹配数 = `0`）；分镜策略面板、创作改写提示与 `runtime.ts`「设置 › 模型」全部对齐。

## 3. F-D 4 条 `noGenericContract` 历史反馈逐条核对

| 反馈单号 | 发生场景 | 现役代码落点与实测结论 |
|---|---|---|
| `NF-1117-0001` | 无通用 HTTP 契约的模型走自动适配报 `no_generic_contract` | `src/ui/onboarding/adapterFailureAdvice.ts` 映射 `{ reasonKey: 'noGenericContract', action: 'selfConnect' }`，明确提示模型没有通用 HTTP 接口并指向「我已有调用脚本」或 ComfyUI 工作流；单测 `onboardingS7aEntries.test.tsx` 与 `noGenericContract.test.ts` 全绿。 |
| `NF-1115-0001` | 自检阶段 `selfCheckReason === 'no_channel'` | 同走 `adapterFailureAdvice` 单一分流至 `selfConnect`，不再误导用户重试 OpenAI 兼容模板。 |
| `NF-1107-0004` | MCP / Agent 接入返回 `no_generic_contract` 信封 | `electron/capabilityCore/modelOnboarding/envelope.ts` `noGenericContractFailure` 返回 `Settings -> Models -> Call script or ComfyUI workflow`，零诱导内置标准通道。 |
| `NF-1016-0001` | 供应商卡片显示「这一步没成功」但未给下一步去向 | 适配失败工作区统一消费 `adapterFailureAdvice`，`selfConnect` 动作按钮直达自定义调用脚本入口，链路闭合。 |

## 4. ★7 性能基准实测（`onboarding-connect-open`）

- **场景配置**：`tests/perf/scenarios/onboarding-connect-open.json`（`E10` 10 节点项目画布，未接入状态触发「连接模型」打开整窗平级页，到主按钮与 Key 输入框可见再过两帧）
- **机器与轮次**：`darwin arm64 Apple M5 x10 / 16GB`，1 轮预热 + 5 轮正式采样，原始结果落盘于 `docs/evidence/2026-11-24-t5-onboarding-s7a/perf-onboarding-connect-open.json`
- **实测结果**：
  - `response`：**中位数 `47.1ms` · p95 `47.6ms`**（预算：中位数 `≤ 150ms`、p95 `≤ 225ms`，结论 `ok`）
  - `longTasks`：**`0` 次（`0ms`）**
