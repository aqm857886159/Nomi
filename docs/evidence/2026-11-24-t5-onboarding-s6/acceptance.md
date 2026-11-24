t5-s6-verify：通过

- 验收线：t5-s6-verify
- 实现线：t5-onboarding-s6-impl
- 验收 HEAD：3db9c8c8866ca6c1a0fc4fedcabcb8b907eb1afd
- 设计卡与方向复盘：`docs/plan/2026-11-24-t5-onboarding-s6.md`、`docs/engineering/direction-checks/2026-11-24-apimart-balance-sources.md`

## 1. 跨板合同与 S6 13 项清单核对

- **`docs/design/boards/2026-11-07-onboarding/Onboarding.board.json`**：
  - S6 全部 13 个元素（`depart.key-input`、`wait.banner`、`wait.return-line`、`return.check-rows`、`return.back`、`topup.card`、`error.key-invalid`、`error.key-format`、`error.no-balance`、`error.offline`、`error.site-blocked`、`error.keychain`、`error.legacy-copy`）均为 `status: "implemented"`，并逐项绑定了 `board:Onboarding/<id>` 断言。
  - `onb.drop.preset-count` 严格保持 `missing` 未被误改。
- **`docs/design/boards/2026-11-17-model-connection-status/ModelConnectionStatus.board.json`**：
  - 已明确登记 `APIMart 接入页例外：只读余额，不拦路，见 D-1124-onboarding-s6-balance`，与接入页只读双端点余额检查及模型连接状态板合同保持一致。
- **隐私与路径泄露核查**：`git diff origin/main...HEAD`（排除二进制 PNG）及本验收单均含 `0` 处本机绝对路径或工作树路径泄露；全程未触发任何真实付费请求。

## 2. 8 张中英/亮暗/窄窗真机截图逐张 `read_file` 目视核验

在 `docs/evidence/2026-11-24-t5-onboarding-s6/` 中逐张亲眼核查以下 8 张真截图（对比拍板样张与实装窗口）：
- `board-vs-impl-o3-o4.png`：O3 等待横幅（含离站时间、`再打开 · 打不开？`）与三步提示一致；O4a 收起三步并掩码 Key，4 行左勾（`Key 有效`、`账户余额 52.3 积分`、`这把 Key 能用的额度 不设上限`、`Nomi 备好的模型 图片 25 · 视频 30 · 声音 9 · 文字 24`）对齐清晰，无写死美元符号违规；O4b 回到原图片节点草稿，Composer 顶部展示 `✓ 已连接 APIMart · 余额 52.3 积分`。
- `board-vs-impl-o5-light.png` & `board-vs-impl-o5-dark.png`：账户明确 0 积分 + Key 不设上限时精准停在 O5 充值卡（`账户余额 0 积分`、`Key 已存好，就差充值`、`去充值 / 重新检查`），回窗刷新到账 52.3 积分后充值卡自然退场；700px 英文深色窄窗排版紧凑、无截断溢出。
- `board-vs-impl-o6.png` & `board-vs-impl-en-dark.png`：格式错误、Key 被拒、断网已存、钥匙串加密失败（人话提示，无系统异常原文）、官网打不开备用镜像与 0 余额 6 种异常态均与拍板样张逐项一致。
- `o3-narrow.png`：700×720 英文深色窄窗 O3 顶栏作品缩略条、蓝色等待横幅、三步列表与输入框布局自然无横向溢出。
- `o4a-zero-token.png`：账户 52.3 积分 + Key 额度 0 积分时第三行显示警告 `0 积分`，不误弹账户充值卡。
- `o4a-unknown-account.png`：账户端点 403 + Key 额度 0 时第二行显示虚线圆 `Unavailable`（未知不等于零），不误弹充值卡。

## 3. 核心 Vitest 套件与 8 项串行治理门岗实跑（全部 `EXIT=0`）

- **4 套核心 Vitest 独立实跑（`--maxWorkers=1`，4/4 文件，63/63 通过）**：
  - `electron/ai/onboarding/vendorAccountBalance.test.ts`（26/26）
  - `electron/ai/onboarding/onboardingIpc.test.ts`（15/15）
  - `electron/catalog/credentialProbeFree.test.ts`（9/9）
  - `src/ui/onboarding/ApimartConnectPage.test.tsx`（13/13）

- **8 项串行单进程静态与治理门岗全绿（`EXIT=0`）**：

| 门岗命令 | 结果 | 关键摘要 |
|---|---|---|
| `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit` | PASS | `0` 错误 |
| `./node_modules/.bin/tsc -p electron/tsconfig.json --noEmit` | PASS | `0` 错误 |
| `pnpm run check:board-parity` | PASS | 全量规则单测与板对账通过（含 S6 13 项断言） |
| `pnpm run check:i18n` | PASS | 23/23 子单测 + `no-cost-claims` OK + `6740` 键 `zh-CN ↔ en` 对齐 |
| `pnpm run check:tokens` | PASS | 4 类棘轮 `0/0/0/0`，语义 token 作用域零违规 |
| `pnpm run check:controls` | PASS | 控件交互与文案契约 `0` 违规 |
| `NOMI_BASE_REF=origin/main node scripts/check-self-written.mjs` | PASS | 67 项登记，新增代码文件 10 个，0 未认领 |
| `CONCEPT_OWNERS_BASE_REF=origin/main node scripts/check-concept-owners.mjs` | PASS | 406 个概念，第二写口 `0` 新增 |

## 4. ★9 反例变异故障注入验证（3/3 必红 → 复原全绿）

在隔离工作树中对 3 处 ★9 核心不变量注入真实故障变异（`--maxWorkers=1`），均立即触发红灯拦截，随后 `git checkout -- .` 彻底还原：

| 编号 | 破坏目标与注入方式 | 触发失败（红灯） | 还原验证 |
|---|---|---|---|
| M1 | `electron/ai/onboarding/vendorAccountBalance.ts:94`：将账户余额请求路径混成 Key 端点 `config.path`（`/v1/balance`） | `EXIT=1`：`vendorAccountBalance.test.ts` **17/26 失败**（含 `/v1/user/balance` 路径断言、发送侧仅读账户快照、账户 0 与 Key 不限额隔离、账户不可读保持未知） | `git checkout -- .` 后恢复绿灯 |
| M2 | `src/ui/onboarding/useApimartVerification.ts:53`：将账户未知（`accountBalance === null`）误判为 `0` 余额进入 `topup` 分支 | `EXIT=1`：`ApimartConnectPage.test.tsx` **1/13 失败**（`online only reads the saved key, unknown passes after a visible pause` 误入 `topup` 分支） | `git checkout -- .` 后恢复绿灯 |
| M3 | `src/ui/onboarding/useApimartVerification.ts:25`：绕过 `isApimartKeyCandidate(key)` 格式拦截，放行 `https://...` 等坏格式 Key | `EXIT=1`：`ApimartConnectPage.test.tsx` **1/13 失败**（`rejects malformed candidates before IPC` 报 `expected 'unavailable' to be 'format'`） | `git checkout -- .` 后恢复绿灯 |

还原后工作树完全干净，复跑 `vendorAccountBalance.test.ts`（26/26）+ `ApimartConnectPage.test.tsx`（13/13）合计 **39/39 通过（`EXIT=0`）**。

## 5. 诚实未验证边界

- 本次实测均在 macOS 隔离 Electron + loopback 夹具 + 模拟安全存储环境下完成，真实 APIMart 线上账户扣费/充值流程与原生 Windows 钥匙串记为 `unverified`。
