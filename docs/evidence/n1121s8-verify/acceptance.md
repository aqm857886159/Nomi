结论：通过 · 验收线：n1121s8-verify · 验收 HEAD：88b1962551608b5999d6cd15fa32d7a070985e8c

## 验收元数据

- verified_sha: `88b1962551608b5999d6cd15fa32d7a070985e8c`
- 待验分支：`fix/nightly-walk-selector-sync-s8`（`I-1 #1121` 夜跑走查现役契约同步第八批）
- 验收线：`n1121s8-verify`（独立工作树检出 `verify/1121-eighth`，仅增量提交本验收报告）
- 变更范围核查（`git diff --stat origin/main...88b1962551608b5999d6cd15fa32d7a070985e8c`）：
  - 共 10 个文件（`284 insertions(+), 233 deletions(-)`）：
    - 8 个走查脚本：`tests/ux/model-pick-confirm.walk.mjs`、`tests/ux/telemetry-scope-reconfirm.walk.mjs`、`tests/ux/composer-long-prompt.walk.mjs`、`tests/ux/shot-cuts.walk.mjs`、`tests/ux/asset-library-native-import.walk.mjs`、`tests/ux/agent-lane-deletion.walk.mjs`、`tests/ux/agent-single-shot-skill-boundary.walk.mjs`、`tests/ux/project-switch-background-run.walk.mjs`
    - 1 份设计卡：`docs/plan/2026-11-25-nightly-walk-selector-sync-s8.md`
    - 1 份规则收紧：`eslint-suppressions.json`（移除已消除告警条目，净减少豁免）
  - 生产代码改动：`src/` 与 `electron/` 均 **0 文件改动**
  - 本机路径与隐私扫描（`origin/main...HEAD` diff 扫绝对路径与工作树名）：**0 命中**
  - 真实付费模型调用：**0 次**（所有真 Electron 走查均为本地拦截/假素材/离线协议，未触发任何付费模型或外网计费接口）

## 1. 静态门岗全量复跑结果（7/7 通过）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 临时目录静态检查 | `pnpm run check:test-temp-static` | `EXIT=0`（27/27 PASS） |
| 走查等待原语检查 | `pnpm run check:test-waits` | `EXIT=0`（14/14 PASS） |
| Launcher 临时目录单测 | `VITEST_MAX_WORKERS=1 npx vitest run tests/ux/launcherDirs.test.mjs` | `EXIT=0`（4/4 PASS） |
| MJS 语法校验 | `pnpm run check:mjs-parse` | `EXIT=0`（6/6 自检 + 1740 个文件全过） |
| 测试文案字面量检查 | `node ./scripts/check-test-copy-literals.mjs` | `EXIT=0`（总计 1168，5 个文件较基线改善） |
| 改动文件增量 Lint | `NOMI_BASE_REF=origin/main node ./scripts/lint-changed.mjs` | `EXIT=0`（8 个文件，0 errors） |
| 走查契约与选择器回归门 | `pnpm run check:walkthroughs` | `EXIT=0`（108/108 单测 + 398 条走查零回归：`dead-selector=0`、`dead-data-attr=38`、`absence-without-baseline=56`） |

## 2. 真 Electron 串行双突变验证（2/2 通过）

> 先于当前验收 HEAD `88b1962551608b5999d6cd15fa32d7a070985e8c` 执行一次 `pnpm run build`（`EXIT=0`）使构建时间戳与 `eslint-suppressions.json` 改动完全对齐，随后严格按「单次仅 1 只 Electron 串行运行：突变 → 必红 → `git checkout --` 还原 → 必绿 → 工作树干净」完成两条代表性走查实跑。

### M1（必跑）：`tests/ux/shot-cuts.walk.mjs`（切镜面板勾选 3 张卡片入画布）

- **突变设计**：注释掉步骤 4 中「把第 1 张反选卡片重新勾回」的操作（`tests/ux/shot-cuts.walk.mjs` 第 179 行），令实际提交入画布的切镜卡片只剩 2 张而非 3 张。
- **突变结果（RED）**：`M1_RED_EXIT=1`
  - 关键断言命中：`✗ 落了 3 个带图片结果的新节点 — 2`、`❌ 1 条不达标`，确认新契约断言真实检出实际落盘节点数不足。
- **还原复跑（GREEN）**：`git checkout -- tests/ux/shot-cuts.walk.mjs` 后重跑，`M1_GREEN_EXIT=0`
  - 关键输出：`✅ 全部达标`（新节点数 3、`usableImages: 3`、`groups: 1`、`panelOpen: false`），静默守护确认 `没抢前台`。

### M2（抽选）：`tests/ux/telemetry-scope-reconfirm.walk.mjs`（中/英双语遥测范围升级再确认）

- **突变设计**：注释掉 `scopeAccept` 按钮点击动作（`tests/ux/telemetry-scope-reconfirm.walk.mjs` 第 73 行），模拟用户未完成范围升级确认，使 `scopeVersion` 停留在 `1` 而非升到 `2`。
- **突变结果（RED）**：`M2_RED_EXIT=1`
  - 关键断言命中：`❌ expect(received).toBe(expected) // Expected: 2, Received: 1`（轮询 15000ms 超时失败），确认双语再确认状态机与入队前门禁真实生效。
- **还原复跑（GREEN）**：`git checkout -- tests/ux/telemetry-scope-reconfirm.walk.mjs` 后重跑，`M2_GREEN_EXIT=0`
  - 关键输出：`✅ zh-CN: 再确认卡出现 → 确认前不入队 → 确认后升到范围 2 并入队 → 重载不再弹` 与 `✅ en: 再确认卡出现 → 确认前不入队 → 确认后升到范围 2 并入队 → 重载不再弹`，静默守护确认 `没抢前台`。
- **还原后工作树核查**：`git status -s` 为空（无残留突变或未跟踪产物）。

## 3. 未验证边界（如实标注）

- 本批其余 6 条走查（`model-pick-confirm.walk.mjs`、`composer-long-prompt.walk.mjs`、`asset-library-native-import.walk.mjs`、`agent-lane-deletion.walk.mjs`、`agent-single-shot-skill-boundary.walk.mjs`、`project-switch-background-run.walk.mjs`）本次已全部经过 7 项静态门岗与契约/选择器零回归检查；独立验收线按指令未对这 6 条重复逐条拉起真 Electron，其本机实跑证据依赖实现线记录，标为 `unverified（独立线仅抽跑 M1+M2 两条真 Electron 双突变）`。
- Linux / Ubuntu Nightly Runner 环境与真实在线付费模型调用链路不在本次验收范围，标为 `unverified`。
