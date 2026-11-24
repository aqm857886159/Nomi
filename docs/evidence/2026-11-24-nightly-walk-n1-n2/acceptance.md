结论：通过 · 验收线：n1n2-verify · 验收 HEAD：00cbd46edcdd8f530520425d2e0298b07ee67cec

- 验收线：n1n2-verify
- 实现线：fix/nightly-walkthroughs-n1-n2-and-paid-rehearsal
- 验收 HEAD：00cbd46edcdd8f530520425d2e0298b07ee67cec
- 对应设计卡：`docs/plan/2026-11-24-nightly-walkthroughs-n1-n2-and-paid-rehearsal.md`
- 方向复盘：`docs/plan/2026-11-24-nightly-walkthroughs-n1-n2-and-paid-rehearsal.direction-check.md`
- 根因合同：`docs/fixes/2026-11-24-nightly-walk-prerequisites.root-cause.json`
- 验收结论：通过（无阻塞缺陷；未设 `NOMI_SPEND_OK`，零真实付费）

## 1. 范围、边界与隐私核查

对照 `origin/main...00cbd46edcdd8f530520425d2e0298b07ee67cec` 全部 28 个改动文件：

- **生产代码零侵入**：`git diff --name-only origin/main...HEAD -- src/ electron/` 为空，严格未触碰 `src/` 或 `electron/` 生产代码。
- **共享证据分配口（N1 止血）**：新增 `tests/ux/_walkEvidence.mjs#walkEvidenceDir`，由 7 条受影响走查共用；缺省无参启动时经 `scripts/_test-temp.mjs#makeTempDir(..., { retain: true })` 在系统临时目录分配独立可留存目录，显式 `--out` 优先且受保护检出树路径被直接拒绝，根治无参退出与污染检出树判红。
- **私有媒体前提选择与跳过归因（N2 止血）**：`scripts/nightly-walk-selection.mjs#realMediaSkipReason` 在运行前判断 `NOMI_REAL_MEDIA_DIR` 未设或非目录时仅跳过 `browser-extract-real.rehearsal.walk.mjs` 与 `real-media-import.walk.mjs`，经 `--include-skips` 保留整批成员并由 `nightly-walk-summary.mjs` 记为状态 `125`（跳过）；目录存在时正常选中由走查自身校验注册素材。
- **Linux 沙箱前提与 2 条无密付费演练修复**：`.github/workflows/nightly-walkthroughs.yml` 在首条走查前补齐 Ubuntu 沙箱前提工具；`storyboard-agent-bulk-real` 在 `newProject` 后解析目录标签、`canvas-spend-policy.paid.mjs` 预置隔离默认模型并保持原有无密回环网络闸门；未设 `NOMI_SPEND_OK`，零真实付费请求。
- **隐私与干净度核查**：`origin/main..HEAD` 提交信息及全部非 PNG 新增 diff 行扫描本机绝对路径、临时目录路径与私有工作树前缀均 **0 命中**。

## 2. 独立复跑 Node 单测与 7 项定向治理门岗（全部 `EXIT=0`）

严格按资源纪律在隔离验收工作树独立串行复跑（未跑全量 `gates` / `check:test-types`，未设 `NOMI_SPEND_OK`）：

- 4 套夜跑与临时目录 Node 单测（`nightly-walk-selection.node-test.mjs`、`nightly-walk-summary.node-test.mjs`、`check-test-temp-static.node-test.mjs`、`nightly-walk-tree-guard.node-test.mjs`）：**54/54 passed**；
- `pnpm run check:walkthroughs`：**PASS**（108/108 规则单测 + 走查质量棘轮零回归）；
- `pnpm run check:mjs-parse`：**PASS**；
- `pnpm run check:workflow-script-refs`：**PASS**（10/10 自测，14 份 workflow / 52 处 `pnpm run` 全部解析）；
- `pnpm run check:workflow-protected-writes`：**PASS**（6/6 自测，14 份 workflow 无直推受保护分支）；
- `CONCEPT_OWNERS_BASE_REF=origin/main node ./scripts/check-concept-owners.mjs`：**PASS**（408 概念：converged 404 / pending 4 · 第二写口 0 新增）；
- `node ./scripts/check-root-cause-contracts.mjs`：**PASS**（1 个高风险文件合同与回归测试齐全）；
- `pnpm run check:self-written`：**PASS**（20/20 自测，177 领域目录 · 68 项登记 · 新增代码文件 0 个）。

## 3. ★9 真实运行时故障变异验证（2/2 必红 → 还原 14/14 必绿）

| 编号 | 故障注入方式 | 变异实测（必红） | 还原验证 |
|---|---|---|---|
| M1（私有媒体前提跳过失效） | 在 `scripts/nightly-walk-selection.mjs:11` 将 `realMediaSkipReason` 退回恒返回 `null` | `nightly-walk-selection.node-test.mjs` 退出码 `1`（`nightly skips only the two media walks when the registered directory is unavailable` 失败，2 条私有媒体走查泄漏进未跳过清单） | `git checkout --` 后复绿 |
| M2（检出树外写防线失效） | 在 `tests/ux/_walkEvidence.mjs:13` 绕过 `checkouts` 检出树约束循环 | `nightly-walk-selection.node-test.mjs` 退出码 `1`（`walk evidence defaults to a fresh external directory and preserves explicit overrides` 失败：未抛出 `/outside the checkout/`） | `git checkout --` 后复跑 **14/14 必绿（`EXIT=0`）** |

## 4. 诚实未验证边界

- 完整 Ubuntu GitHub Runner 实机环境下的 Electron 夜跑批次回放与首次合入后的夜跑汇总（`unverified`，按设计卡与根因合同在合入后的首个夜跑复查）。
