结论：通过 · 验收线：t6a-verify · 验收 HEAD：3f1781bc49b4f7bb41a598e06310ca0009649b39

- 验收线：`t6a-verify`
- 实现线：`t6a-settings-models-and-policy`
- 设计卡与方向复盘：`docs/plan/2026-11-24-t6a-settings-models-and-policy.md`、`docs/plan/2026-11-24-t6a-model-settings-direction-check.md`
- 关联根因合同：`docs/fixes/2026-11-24-t6a-upload-policy-presentation.root-cause.json`、`docs/fixes/2026-11-24-t6a-model-settings-contracts.root-cause.json`

## 1. ★9 真实故障变异验证（3/3 必红 → 还原 37/37 必绿）

在隔离工作树中针对设计卡 ★9 与方向复盘核心不变量注入 3 处真实故障变异，均立刻触发对应特征测试红灯拦截，随后 `git checkout --` 彻底还原：

| 编号 | 破坏目标与注入方式 | 变异实跑（必红） | 还原验证 |
|---|---|---|---|
| M1 | `src/workbench/settings/AiModelsSection.tsx:234-235`：将公共临时托管开关极性退回反向（`!== 'allow'` → `=== 'allow'`、`ask`/`allow` 互换） | `EXIT=1`：`uploadPolicySwitch.test.tsx` **2/2 失败**（`ask` 误读为 `false`、`allow` 误读为 `true`） | 还原后 2/2 PASS |
| M2 | `electron/ai/onboarding/vendorAccountBalance.ts:28`：移除 `looksLikeLogicalError(body) !== null` 拦门，放过 HTTP 200 业务错误包 | `EXIT=1`：`vendorAccountBalance.test.ts` **1/27 失败**（`rejects a logical HTTP-200 failure even when its payload carries a balance` 误返回 `{ remainCredits: 12 }`） | 还原后 27/27 PASS |
| M3 | `src/workbench/settings/defaultGenerationModelOptions.ts:72`：将跨供应商同名判定退回无差别追加后缀（`ambiguous = true`） | `EXIT=1`：`defaultGenerationModelOptions.test.ts` **1/1 失败**（`Solo` 被误加 `Solo · first`） | 还原后 1/1 PASS |

复原后实跑 5 套核心 Vitest 套件（`VITEST_MAX_WORKERS=2`），全部 **37/37 PASS（`EXIT=0`）**：
- `src/workbench/settings/uploadPolicySwitch.test.tsx`（2/2）
- `src/workbench/settings/defaultGenerationModelOptions.test.ts`（1/1）
- `electron/ai/onboarding/vendorAccountBalance.test.ts`（27/27）
- `src/ui/onboarding/t6aModelSettings.test.tsx`（4/4）
- `electron/ai/onboarding/t6aModelUsage.test.ts`（3/3）

## 2. 7 张真机对照图、走查成绩单与干净树性能实测核验

在 `docs/evidence/2026-11-24-t6a-model-settings/` 中逐张亲眼用 `read_file` 核对全部 7 张 `board-vs-impl-*.png` 及原始证据文件：
- **`board-vs-impl-Main.png` / `board-vs-impl-M1-dark.png` / `board-vs-impl-M1-narrow.png`（zh-CN 亮/暗/700px 窄窗）**：顶栏展示 `APIMart 已连接 · 图片 26 · 视频 30 · 声音 10 · 文字 25`；账户卡三列以细竖线清晰分隔（`账户余额 52.3 积分 / 去充值 ↗`、`这把 Key 的额度 不设上限 / 只受账户余额限制`、`近 7 天花了 19.6 积分 / 41 次 · 用量 ›`），无硬编码美元金额、单行不折行；`•••` 暗色菜单三项（`接入地址（高级）`、`管理模型`、`断开 APIMart`）清晰；下方 `用 AI 帮我接入` 与 `其他接入` 卡片排版紧凑，700px 窄窗无横向溢出。
- **`board-vs-impl-M1-en.png`（en 亮色）**：三列分隔清晰，`41 runs · Usage ›` 单行完整展示；下方 `Let AI connect it for me` 与 `Other ways` 贴合样张且满足英文控件词数契约。
- **`board-vs-impl-M1-old-user.png`（老用户 4 连接）**：顶部 `APIMart` 卡片主动作按钮 `连接` 与可关闭蓝底一次性提示条对齐样张；`以前接的 4 个连接` 精准隐藏搜索框（5 个连接才出搜索框）；`Kie.ai` 徽标 `只「提清晰度」继续维护` 中引号名同行不断行，原 Key 零改写。
- **`board-vs-impl-M1-usage.png`（用量与单价二级页）**：`近 7 天` / `近 30 天` 分段切换、`GPT Image 2` 与合计行 `19.6 积分 / 41 次` 对齐；下方 `常用模型公开单价` 全部带约号 `≈` 与明确单位（`≈0.35 积分/张`、`≈2.16 积分/秒`）。
- **`board-vs-impl-M6-ai-policy.png`（AI 策略页）**：四项新建节点默认模型仅在显式指定项显示 `你定的` 徽标，单供应商模型不冗余拼平台后缀；脚注 `「跟上一次一样」` 同行不断行；模型整理入口统计完整；`素材怎么传给模型` 按通道分层显示私有链接（72 小时）与公开临时托管（警告图标 + 24 小时），`用公共临时托管前先问我` 开关极性与持久值 `ask` 一致，高级自定义上传中转默认折叠。
- **`walkthrough.md`**：8/8 桌面实窗走查通过，`付费提交 = 0`，`引号内名称断行或容器错误 = 0`，顶边固定 `120px` 且页面高度稳定在 `360–560px` 内。
- **`usage-open.perf.json`**：干净工作树实测（`commit: 87e42046a`，`dirty: false`，`runs: 5`），`model-settings-usage-open` response **median `64.9ms` / p95 `66.5ms`**（预算 `100ms`，`verdict: ok`）。
- **隐私与路径泄露核查**：全分支 `origin/main...HEAD` 非二进制 diff 及本验收报告均为 `0` 处本机路径或工作树路径泄露；全程未触发任何真实付费请求。

## 3. 拦截闭环与独立门岗实跑（全部 `EXIT=0`）

本验收线在前两轮先后拦下 3 项 CI 阻断门岗（B1 `check:controls` 11 处控件文案超长、B2 `check:walkthroughs` 10 处裸 `.toHaveCount(0)` 与 7 处悬空旧锚点、B3 新建根因合同缺 `detected_by` / `recurrence_check_on`），实现线逐项修齐并合入 `87e42046a` → `92dced9ba` → `1dd26d84b`，并在 `3f1781bc4` 顺手完成推送前守卫收口（`onboardingIpc.ts` 边界注入 `readVendorPricePreview`、`modelSettingsUsage.ts` 接受回调入参、`launcherDirs.json` 移除已迁移项；已复核 3 文件 diff 与 `tsc -p electron/tsconfig.json --noEmit` `EXIT=0`），全部目标门岗全绿：

| 门岗 / 检查项 | 结果 | 关键摘要 |
|---|---|---|
| `pnpm run check:controls` | PASS | 交互与文案契约 `0` 新增违规（存量基线 `0`） |
| `pnpm run check:walkthroughs` | PASS | `108/108` 规则单测全过，`absence-without-baseline=56`、`dead-data-attr=38` 均零回归 |
| `pnpm run check:root-cause-contracts` | PASS | `55/55` 单测通过，`schema` 合法（含 2 份新增 T-6a 合同） |
| `pnpm run check:board-parity` | PASS | `111/111` 规则单测 + 12 张板 + 43 目录对账全绿 |
| `pnpm run check:i18n` | PASS | `23/23` 单测 + `no-cost-claims` OK + `6796` 键 `zh-CN ↔ en` 对齐 |
| `pnpm run check:tokens` | PASS | 4 类棘轮 `0/0/0/0`，语义 token 作用域与 `color-mix` 零违规 |
| `pnpm run check:boundary-owners` | PASS | `27/27` 自测通过，声明 2158 条全部在位/已登记 |
| `tsc`（`tsconfig.app.json` + `electron/tsconfig.json`） | PASS | `0` 类型错误 |
| 变动 TS/TSX ESLint + `check:self-written` / `check:concept-owners` / `check:filesize` / `check:perf-scenarios` / `check:icons` / `check:icon-semantics` / `check:dangling-tokens` / `check:dangling-tailwind` | PASS | 全量 `EXIT=0` |

## 4. 诚实未验证边界

- 本次实窗走查与余额/用量联调均基于 macOS 隔离 Electron 窗口、回环供应商夹具与本地测试目录，真实线上 APIMart 账户当日实时余额、充值支付链路及真人首次体验评分记为 `unverified`。
