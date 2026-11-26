结论：通过 · 验收线：n1121s4-verify · 验收 HEAD：dad6505535e6a1b02dfeaba1af5906f5e7a271bb

- 验收线：`n1121s4-verify`
- 对应设计卡：`docs/plan/2026-11-25-nightly-walk-selector-sync-s4.md`

## 1. 范围、原业务判据与隐私核查

- **改动范围（`origin/main...dad6505535e6a1b02dfeaba1af5906f5e7a271bb`，9 个文件）**：
  - `src/` 与 `electron/` 生产代码 **0 改动**，全部改动严格限定在设计卡与 8 份夜跑走查脚本。
  - **8 份走查对齐现役契约且未削弱原业务判据**：
    - `tests/ux/archetype-batch1-samples.walk.mjs`：改由共享悬停层 `[data-send-cost-hover]:visible` 校验禁用原因，保留中英两轨发送门岗、实收请求与主进程拒收断言。
    - `tests/ux/audio-reference-connect.walk.mjs`：复用现役方式下拉与模型选择入口，保留零参考方式门岗、音频连边、合用依赖与请求体组装验证。
    - `tests/ux/canvas-chrome-occlusion-shadow.walk.mjs`：等待视觉静止后按 `[data-node-composer-prompt]` 与工具条 `clipPath` 校验 4 组语言/主题实测投影亮度。
    - `tests/ux/canvas-frame.walk.mjs`：随批量模型入口退役改为逐节点选夹具模型并按实际节点与边 ID 核对解散前后与两张成片状态，完整保留 45 条日志断言。
    - `tests/ux/canvas-handle-menus.walk.mjs`：区分空卡浏览态（`[data-empty-tier="icon"]`、无动作行）与单选态（显示 `[data-node-try]`），保留中英两轨 12/12 场景。
    - `tests/ux/shot-table-vision-leg.walk.mjs`：锚定 `[data-shot-table-composer="deconstruct"]` 按钮与下拉选项，保留失败原话、自动选择与手动切换校验。
    - `tests/ux/telemetry-consent.walk.mjs`：改以复选框交互 + 持久化 IPC 读回共同验收默认关闭、开启、摘要、清空与关闭 5 个检查点。
    - `tests/ux/toolbar-order.walk.mjs`：对齐 `[data-project-card]` 打开项目与节点选择器，保留图片/视频浮条全屏不居首且紧邻下载的 7 项断言。
  - **仓外产物隔离**：全部 8 份走查统一使用 `makeTempDir` 将截图与临时资料落至仓库外临时目录。
- **隐私与路径泄露核查**：`git diff origin/main...HEAD` 全部改动及本验收单均含 `0` 处本机绝对路径、临时目录字面路径或工作树前缀泄露。

## 2. 6 项静态门岗独立实跑（全部 `EXIT=0`）

| 门岗命令 | 结果 | 关键摘要 |
|---|---|---|
| `pnpm run check:test-temp-static` | PASS | `27/27` 通过，无绕过 `makeTempDir` 的临时目录分配 |
| `pnpm run check:walkthroughs` | PASS | `108/108` 规则单测 + `398` 份走查零回归（`dead-selector=0`、`dead-data-attr=38`、`absence-without-baseline=56`） |
| `pnpm run check:mjs-parse` | PASS | `6/6` 自测 + `1740` 个 `.mjs/.cjs` 全部可解析 |
| `pnpm run check:test-waits` | PASS | `14/14` 自测通过，0 处空等待/私有墙钟等待 |
| `node ./scripts/check-test-copy-literals.mjs` | PASS | 棘轮只减不增（存量 `1165` 处，6 文件改善） |
| `NOMI_BASE_REF=origin/main node ./scripts/lint-changed.mjs` | PASS | `8` 个改动文件 `0` 错误 |

## 3. ★9 真实故障变异验证（2/2 必红 → 还原必绿）

在隔离验收工作树中分别注入 2 处故障变异，均立即触发对应门岗红灯，随后 `git checkout --` 彻底复原：

| 编号 | 破坏目标与注入方式 | 变异红灯结果 | 还原验证 |
|---|---|---|---|
| M1 | `tests/ux/archetype-batch1-samples.walk.mjs:70`：将 `[data-send-cost-hover]` 改为源码零命中的死锚点 `[data-send-cost-hover-dead-probe]` | `EXIT=1`：`node ./scripts/check-walkthroughs.mjs` 精确检出 `archetype-batch1-samples.walk.mjs:70`（`dead-data-attr` 基线 `38 → 39`） | `git checkout --` 后复跑 `EXIT=0`（`dead-data-attr=38`） |
| M2 | `tests/ux/telemetry-consent.walk.mjs:11`：将 `makeTempDir` 替换为裸 `fs.mkdtempSync(path.join(os.tmpdir(), ...))` | `EXIT=1`：`pnpm run check:test-temp-static` 精确检出 `telemetry-consent.walk.mjs:11` 绕过共享助手 | `git checkout --` 后复跑 `EXIT=0`（27/27 PASS） |

## 4. 诚实未验证边界

- 本次独立验收覆盖全部 8 份走查的代码审阅、6 项静态门岗实跑与 2 项真实故障变异验证；8 条 Electron 真窗回放（实现线设计卡已录 `8ac07cffb` 构建逐条通过结果）与 Ubuntu Nightly Runner 真机环境记为 `unverified`，待合入后由 Nightly CI 实跑收据确认。
