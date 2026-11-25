结论：通过 · 验收线：n1121s9-verify · 验收 HEAD：d2d2c21ffd4942d9fe6acee4eb329e1037352b5a

# #1121 夜跑走查现役契约同步第九批独立验收报告

- 验收线：`n1121s9-verify`
- 实现线：`fix/nightly-walk-selector-sync-s9`
- verified_sha: `d2d2c21ffd4942d9fe6acee4eb329e1037352b5a`
- 验收 HEAD：`d2d2c21ffd4942d9fe6acee4eb329e1037352b5a`
- 对应设计卡：`docs/plan/2026-11-25-nightly-walk-selector-sync-s9.md`
- 验收分支：`verify/1121-ninth`

## 一、范围、边界与零生产代码变更核查

1. **生产代码零改动**：`git diff --name-only origin/main...HEAD -- src/ electron/` 输出为空，本次交付未改动任何生产源码，仅同步 6 条夜跑走查脚本、配套设计卡及两份棘轮基线收紧文件。
2. **6 条走查与基线改动逐文件核对**：
   - `tests/ux/agent-form-switch-state.walk.mjs`：迁移 `makeTempDir` 与 `walkthrough-network-guard.cjs`，在核对过程回执前通过 `openProcess` 显式展开默认折叠的过程行，完整保留三形态下回执、草稿、勾选与确认/拒绝断言。
   - `tests/ux/agent-timeline-ops.walk.mjs`：迁移 `makeTempDir` 与 `walkthrough-network-guard.cjs`，将时间轴计划介入槽断言收紧为 `data-kind="plan"` 并以 `expectAbsent(INTERVENTION_ESCALATE)` 确认无永久授权按钮，完整保留人话摘要、时间轴预览高亮、批准落盘、回执撤销与三类编辑断言。
   - `tests/ux/agent-thinking-overlap.walk.mjs`：迁移 `makeTempDir`，修正 `flowOverlaps` 在 `[data-process-folded]` 且 `overflowY === 'hidden'` 下按实际裁切视口计算文本矩形，使用 `uiText` 替代硬编码中文标签，新增临时取消裁切（`overflow='visible'`）的反向自检与展开完整过程（`data-process-folded="false"` + 增高 + 零重叠）及冷重启 JSONL 恢复断言。
   - `tests/ux/agent-thinking-rows.walk.mjs`：迁移 `makeTempDir`，为 `draft_shots` 补齐 `model: FIXTURE_IMAGE_HANDLE`，移除不再适用于本地草稿的旧介入卡等待，使用 `openProcess` + `proveProbe` + `expectAbsent(THINKING_LINE)` 校验运行中不铺开推理明细，完整保留 4 条真实工具结果、1 次重试、1 处推理折叠与精确块序断言。
   - `tests/ux/agent-runtime-editing.walk.mjs`：迁移 `makeTempDir`，将模型面夹具工具名由传输层 `append_to_end` 同步为现役 `write_script(where: 'end')`，在实时校验及冷重启校验画布撤销回执前均调用 `openProcess` 展开过程行，完整保留落盘、停止防晚到写入与冷恢复断言。
   - `tests/ux/storyboard-strategy-resolve.walk.mjs`：迁移 `makeTempDir` 与 `walkthrough-network-guard.cjs`，适配虚拟表格滚动挂载（`[data-storyboard-scroll="true"]`），拆条前逐行验证第 1 镜 `overflow` 与滚底第 4 镜 `underflow`，采纳拆条后验证 `data-storyboard-row-count="6"`、第 1 段 `overflow` 消失及滚底第 6 行（原第 4 镜）仍保持 `underflow`。
   - `scripts/station-waits-baseline.json` 与 `eslint-suppressions.json`：已同步收紧本批清理出的过期等待 hash 与 2 个已归零的 `@typescript-eslint/no-unused-vars` 冻结项。
3. **临时目录与隐私扫描**：
   - 6 条修改走查均统一使用 `scripts/_test-temp.mjs` 的 `makeTempDir` 管理输出目录。
   - 全部提交日志与新增 diff 经正则扫描，无任何本机绝对路径、临时目录路径或私有工作树前缀泄漏（0 命中）。

## 二、静态门岗与结构测试实跑结果

全部 7 项门岗均在验收 HEAD `d2d2c21ffd4942d9fe6acee4eb329e1037352b5a` 上独立实跑并通过（`EXIT=0`）：

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 走查静态契约检查 | `pnpm run check:walkthroughs` | PASS（108/108 + 398 份走查零回归，`dead-selector=0`，`dead-data-attr=38`，`absence-without-baseline` 56→55，`sleep-as-done-signal` 65→62） |
| 临时目录静态约束 | `pnpm run check:test-temp-static` | PASS（27/27 通过） |
| 测试等待门岗 | `pnpm run check:test-waits` | PASS（14/14 通过，`Station wait baseline: 582 occurrences; new/stale: 0`） |
| 变更文件 Lint | `NOMI_BASE_REF=origin/main node ./scripts/lint-changed.mjs` | PASS（6 个改动文件 0 error，0 新增 warning，`eslint-suppressions.json` 干净） |
| 启动器冻结名单单测 | `VITEST_MAX_WORKERS=1 npx vitest run tests/ux/launcherDirs.test.mjs` | PASS（4/4 通过） |
| MJS/CJS 语法解析 | `pnpm run check:mjs-parse` | PASS（6/6 + 1740 个脚本全部可解析） |
| 测试文案字面量基线 | `node ./scripts/check-test-copy-literals.mjs` | PASS（存量 1168，只减不增，5 个文件净改善） |

## 三、真实 Electron 串行双变异必红 → 还原必绿实证

先在 `d2d2c21ffd4942d9fe6acee4eb329e1037352b5a` 执行 `pnpm run build` 对齐构建戳，随后在隔离工作树串行（每次仅 1 个 Electron 实例）完成 2 条走查的真实故障变异验证，还原后工作树完全干净：

1. **M1（`tests/ux/storyboard-strategy-resolve.walk.mjs` 跳过采纳拆条点击）**：
   - 变异：临时跳过 `await clickOrFail(adopt, '采纳拆条建议')`。
   - 必红结果：真实 Electron 执行退出 `1`，精准报红：`采纳后面板没有重查：拆条建议应当消失，只剩必需合并那一条（Expected: 1, Received: 2）`。
   - 复原复跑：`git checkout --` 复原后真实 Electron 执行退出 `0`，6 张 light 截图互不相同，采纳后行数升至 6、第 1 段超限警示消失且第 6 行低于下限警示保留。
2. **M2（`tests/ux/agent-thinking-overlap.walk.mjs` 跳过展开完整过程点击）**：
   - 变异：临时跳过点击 `agentPanelV4.expand` 按钮。
   - 必红结果：真实 Electron 执行退出 `1`，精准报红：`data-process-folded` 期望 `"false"`、实得 `"true"`。
   - 复原复跑：`git checkout --` 复原后真实 Electron 执行退出 `0`（`result: "passed"`，`paidCalls: 0`，`overlaps: { early: [], streaming: [], complete: [] }`，注入位移碰撞 `injectedOverlap: [[0, 1]]` 检出，取消裁切反向自检、展开增高无重叠与二次冷启动 `restoredOverlaps: []` 全过）。

## 四、未验证边界声明（Unverified）

- 本次独立验收在隔离 macOS 工作树完成全量 7 项静态门岗、diff 逐行核查与 2 条走查的真实 Electron 串行双变异实证；未在独立线逐条拉起其余 4 条走查真窗，亦未覆盖真实 Ubuntu Nightly Runner 与在线外部供应商付费调用（`unverified: remaining-4-walks-replay / nightly-ubuntu-e2e-replay / paid-vendor-generation`），需以合入后 Nightly CI 实跑收据最终确认。

## 五、结论

- `#1121` 夜跑走查现役契约同步第九批在 `d2d2c21ffd4942d9fe6acee4eb329e1037352b5a` 上满足设计卡及 CI 全部约束：零生产代码改动、两份棘轮基线已收紧、7 项静态门岗全绿、2 条走查真实 Electron 串行双变异均必红且复原全绿、0 本机路径泄漏。
- 独立验收结论：**通过**。
