t8-verify：通过

- 验收线：t8-verify
- 验收 HEAD：c3d20b207bfbe7f44a95f6693009d6ce35ae5b98
- 验收对象：`feat/t8-structural-guards-and-discovery`（已合入最新 `origin/main` `6881dc673`：T-8 第一批结构防错 + 动手前自动发现 + 本地推送前快检净减 4 道 + 用户 2026-11-23 拍板短档口径入仓 + `scripts/t8-structural-guards-baseline.json` 独立棘轮 + `boundary-owners.mjs#readLedger` 懒加载零 `typescript` 冷启动 + `pr-judgement-lib.mjs` 零依赖词法去注释）

---

## 一、规则原文、零扩散边界与两项 CI/性能契约核查

1. **规则原文精确核对**（`CLAUDE.md`、`AGENTS.md`、`docs/engineering/rules.json`、`docs/engineering/rules.md`、`docs/engineering/design-card.md`）：
   - 均精确写入用户 2026-11-23 拍板句「**由门岗从改动本身算出没碰用户可见界面，不以 PR 自报为准**」（`CLAUDE.md` 与 `AGENTS.md` 已同步并通过 `check:agents-sync`）；
   - 经 `git diff` 新增行正则核查，上述 5 份规则文档中 **0 处出现具体界面文件扩展名或目录名**（具体判定文件类型只留在 `scripts/pr-judgement-lib.mjs`）。
2. **关键敏感文件零 diff 核对**：
   - `eslint-suppressions.json`、`package.json`、`docs/engineering/self-written.json` 相对 `origin/main`（`6881dc673`）均为 **0 diff**；
   - `#1622` 的 5 个文件均为 **0 diff**。
3. **CI 契约与冷启动性能核查（`4c9f456c8` + `13aed7479` + `c3d20b207`）**：
   - `scripts/build-capability-index.mjs` 经 `import { readLedger } from './boundary-owners.mjs'` 单读口读台账（`check-boundary-owners.node-test.mjs` `台账只有一个读口` 通过）；
   - `scripts/pr-judgement-lib.mjs` 移除 `typescript` 依赖，改为零依赖状态机词法去注释扫描，通过 `check-quality-gate-workflow.node-test.mjs` 的 `PR Body runs without node_modules` 守卫；
   - `scripts/boundary-owners.mjs` 与 `scripts/check-dispatch-brief.mjs` 改为 `createRequire(import.meta.url)` 懒加载：独立实测 `boundary-owners import + readLedger` 耗时 **`3.27 ms`**，`check-dispatch-brief` 冷启动 **`6.14 ms`**，彻底消除 `git push` 满载下 `timeout: 1000` 超时。

---

## 二、独立复跑清单（全部 0 报错通过）

| 检查项 | 命令 | 结果 |
|---|---|---|
| 7 套核心与 CI 契约 node-test | `node --test scripts/check-boundary-owners.node-test.mjs scripts/check-dispatch-brief.node-test.mjs scripts/edit-time-reminder.node-test.mjs scripts/build-capability-index.node-test.mjs scripts/t8-structural-guards.node-test.mjs scripts/process-tier.node-test.mjs scripts/check-quality-gate-workflow.node-test.mjs` | **223 passed / 0 failed**（`1.39s`；含 `PR Body runs without node_modules`、`台账只有一个读口`、URL 含 `//`/`/*...*/` 字符串必判有差异、`t8-structural-guards-baseline.json` 精确计数对账） |
| 无审批环境变量推送前 lint | `env -u NOMI_COORD_APPROVALS node scripts/lint-changed.mjs` | **通过**：`20 个改动文件，错误 0，警告不比 origin/main 多`（免 `NOMI_COORD_APPROVALS`） |
| 规则与门岗一致性链 + 全量 lint + 增量类型检查 | 前置同分支提交全量跑过 `check:agents-sync`、`check:rule-aliases`、`check:gates-chain`（21/21）、`check:claude-hooks`（369/369）、`check:filesize`、`pnpm run lint:ci`（`0 errors`，`86 warnings ≤ 95`）、`node scripts/typecheck.mjs --incremental`（5/5） | **全部通过** |
| PR 正文判据（合并档） | `NOMI_PR_BODY_FILE=... node scripts/check-pr-judgement.mjs --pr --stage=merge` | **通过**（0 错 0 警） |

---

## 三、独立破坏变异验证（破 → 红，复原 → 绿）

| 编号 | 注入/变异内容 | 实测必红结果 | 复原后 |
|---|---|---|---|
| **R1（基线计数 +1）** | 将 `scripts/t8-structural-guards-baseline.json` 中 `electron/capabilityCore/mcpProfiles.ts` 的 `generic-fs-watch/no-restricted-syntax` 计数从 `1` 改为 `2` | **必红**：`t8-structural-guards.node-test.mjs` `10 pass / 1 fail`（`冻结 2 处，实际已降到 1 处，请收紧`） | `11/11 pass` |
| **R2（冻结文件内新增第 2 处违规）** | 在已冻结的 `electron/capabilityCore/mcpProfiles.ts` 末尾新增第 2 处 `fs.watch(".", () => {})` | **必红**：`t8-structural-guards.node-test.mjs` `10 pass / 1 fail`（`冻结 1 处，实际涨到 2 处，同文件不许再增违规`） | `11/11 pass` + `lint-changed` 0 错 |
| **首轮变异 A / B / C** | 变异 A 短路 `detectUiSurfaceDiff`（`process-tier.node-test.mjs` 必红）；变异 B 在非抑制 `electron/jsonUtils.ts` 注入 `fs.watch` + `Map.keys().next()`（`eslint` 报 3 errors 并指路唯一主人）；变异 C 实跑 `edit-time-reminder.mjs`（2,082 B）与 `build-capability-index.mjs`（2,382 B） | 全部按预期必红 / 产出 ≤ 2.5 KB 能力速查 | 全部复原全绿 |

---

## 四、验收结论

**`t8-verify：通过`**（基于终版实现提交 `c3d20b207bfbe7f44a95f6693009d6ce35ae5b98`，0 处阻断项，不含任何本机绝对路径）。
