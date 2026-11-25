结论：通过 · 验收线：n1121s6-verify · 验收 HEAD：a80efbb84442649687785ba108a7b6b3e5854a87

- verified_sha: `a80efbb84442649687785ba108a7b6b3e5854a87`
- 验收线：`n1121s6-verify`
- 对应设计卡：`docs/plan/2026-11-25-nightly-walk-selector-sync-s6.md`

## 1. 范围、原业务判据与隐私核查

- **改动范围（`origin/main...a80efbb84442649687785ba108a7b6b3e5854a87`，6 个文件）**：
  - `src/` 与 `electron/` 生产代码 **0 改动**，改动仅限设计卡与 5 份夜跑走查脚本：
    - `tests/ux/at-mention-edge.walk.mjs`
    - `tests/ux/creation-plan-delete-undo.walk.mjs`
    - `tests/ux/canvas-control-clarity.walk.mjs`
    - `tests/ux/agent-trace-log.walk.mjs`
    - `tests/ux/agent-panel-form.walk.mjs`
  - 全部 5 份走查未削弱原业务断言（视频参考边/首个视频槽/截取 chip、原稿删除确认模态阳性对照与方案删除撤销、15 档比例与 1–4 数量、3 回合 JSONL 与 2 处真实轨迹目录打开请求、4 工作面与 3 流程状态），全部使用 `makeTempDir` 写向仓外隔离临时目录，且保留设计卡标注的 3 条真红/已退役走查未强行漂绿。
- **隐私与路径泄露核查**：`git diff origin/main...HEAD` 全部改动及本验收单均含 `0` 处本机绝对路径、临时目录字面路径或工作树前缀泄露；实跑全程 `paidCalls = 0`。

## 2. 静态门岗与结构测试独立实跑（全部 `EXIT=0`）

| 门岗 / 检查项 | 结果 | 关键摘要 |
|---|---|---|
| `pnpm run check:walkthroughs` | PASS | `108/108` 规则单测 + `398` 份走查零回归（`dead-selector=0`、`dead-data-attr=38`、`absence-without-baseline=56`） |
| `pnpm run check:test-temp-static` | PASS | `27/27` 通过，无绕过 `makeTempDir` 的临时目录分配 |
| `VITEST_MAX_WORKERS=1 npx vitest run tests/ux/launcherDirs.test.mjs` | PASS | `4/4` 通过，白名单与隔离世界签发边界合规 |
| `pnpm run check:mjs-parse` | PASS | `6/6` 自测 + `1740` 个 `.mjs/.cjs` 全部可解析 |
| `pnpm run check:test-waits` | PASS | `14/14` 自测通过，0 处空等待/私有墙钟等待 |
| `node ./scripts/check-test-copy-literals.mjs` | PASS | 棘轮只减不增（存量 `1165` 处，6 文件改善） |
| `NOMI_BASE_REF=origin/main node ./scripts/lint-changed.mjs` | PASS | `5` 个改动文件 `0` 错误 |

注：仓库当前无 `scripts/check-design-card.mjs` 脚本；已人工逐项核对设计卡 ★0–★9 全部要素齐全且与实际改动一致。

## 3. 真实 Electron 串行双变异必红 → 还原必绿验证（2/2）

在本验收工作树执行 `pnpm run build`（`EXIT=0`）后，严格串行（每次仅 1 个 Electron 实例）对 2 条走查注入真实 ★9 业务变异并验证必红与复原必绿：

| 编号 | 走查文件与变异方式 | 变异实跑（必红） | 还原实跑（必绿） |
|---|---|---|---|
| M1 | `tests/ux/at-mention-edge.walk.mjs:203`：跳过点击视频候选 `videoOption`，模拟未建立参考边与视频槽 | `EXIT=1`：4 条业务断言当场失败（参考边仍为 `1 → 1`、缺少 `reference` 边、首个视频槽为空、chip 数组为空） | `git checkout --` 后 `EXIT=0`（6/6 全部达标：真实参考边 `1 → 2`、首个视频槽命中、`drone re…` chip 渲染） |
| M2 | `tests/ux/agent-trace-log.walk.mjs:22`：将 3 回合循环改为 2 回合，模拟少 1 个回合 | `EXIT=1`：`agent-trace-log.walk.mjs:40` 报 `Expected: 3, Received: 2` | `git checkout --` 后 `EXIT=0`（`result: "passed"`、`traceRows: 3`、`toolWriteRate: "3/3"`、`turnSuccessRate: "3/3"`、2/2 精确轨迹文件打开请求、`paidCalls: 0`） |

复原后工作树完全干净（`git status -s` 无残留改动）。

## 4. 诚实未验证边界

- 本次独立验收在 macOS 隔离 Electron 环境下完成了全部 5 份走查代码审阅、7 项门岗/结构测试全绿与 2 条走查的真实 Electron 双变异必红→复原必绿；其余 3 条走查（`creation-plan-delete-undo`、`canvas-control-clarity`、`agent-panel-form`）的真窗回放由实现线在 `8ac07cffb` 录得通过结果，真实 Ubuntu Nightly Runner 环境与付费模型调用记为 `unverified`。
