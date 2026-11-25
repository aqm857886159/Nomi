结论：通过 · 验收线：n1121s11-verify · 验收 HEAD：f863ea6ad02aef603662ec61478e86de92cbc18d

# #1121 夜跑走查现役契约同步第十一批独立验收报告

- 验收线：`n1121s11-verify`
- 实现线：`fix/nightly-walk-selector-sync-s11`
- verified_sha: `f863ea6ad02aef603662ec61478e86de92cbc18d`
- 验收 HEAD：`f863ea6ad02aef603662ec61478e86de92cbc18d`
- 对应设计卡：`docs/plan/2026-11-25-nightly-walk-selector-sync-s11.md`
- 验收分支：`verify/1121-eleventh`

## 一、范围、边界与零生产代码变更核查

1. **生产代码零改动**：`git diff --name-only origin/main...HEAD -- src/ electron/` 输出为空，本次交付未触碰任何生产源码，仅同步 3 条夜跑走查脚本及配套设计卡。
2. **3 条走查改动逐文件核对**：
   - `tests/ux/task-center.walk.mjs`：迁移 `makeTempDir` 隔离输出与启动器默认隔离 userData（改用 `close()` 干净收尾）；针对 React Flow 仅挂载视口内节点的特性，先通过真实 UI 逐个添加 8 个图片节点，再从画布状态读取 8 个真实节点 ID（并记录当前 DOM 挂载数）校验 `new Set(nodeIds).size === 8`，随后 `canvasFitView` 截图并继续完整校验两波队列、取消后排队归零、断路横幅与面板几何。
   - `tests/ux/composer-b3-real.walk.mjs`：迁移 `makeTempDir` 外置证据目录（包括最小窗列表详情截图），不再写入仓库树；适配 `NomiSelect` 独立锚点 `[data-nomi-select-option-label]` 与 `[data-nomi-select-option-description]`，校验模型名、Wan 2.7 能力说明、底部隐藏模型按钮与真实切换，删除已退役的分镜摘要点击，并在分镜行新增打开模型菜单验证「默认模型」继承说明与目录模型独立能力说明及品牌图标。
   - `tests/ux/model-menu-icons.walk.mjs`：迁移 `makeTempDir` 外置证据目录，以显式可见断言替代固定 250ms 等待；在分镜行将 `storyboardEditor.defaultModel` 操作行与目录模型行分开校验（未配置默认模型时无品牌图标、已配置时带 28px 品牌图标，且每个目录模型行均有单行能力说明与 28px 图标），完整保留三面（画布节点 / 列表详情 / 分镜行）与变体规则及中英明暗四轨 128 条断言。
3. **临时目录与隐私扫描**：
   - 3 条走查均统一使用 `scripts/_test-temp.mjs` 的 `makeTempDir` 外置输出。
   - 提交日志与新增 diff 经正则扫描，无任何本机绝对路径、临时目录路径或私有工作树前缀泄漏（0 命中）。

## 二、静态门岗与结构测试实跑结果

全部 8 项门岗均在验收 HEAD `f863ea6ad02aef603662ec61478e86de92cbc18d` 上独立实跑并通过（`EXIT=0`）：

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 临时目录静态约束 | `pnpm run check:test-temp-static` | PASS（27/27 通过） |
| 走查静态契约检查 | `pnpm run check:walkthroughs` | PASS（108/108 + 398 份走查零回归，`dead-selector=0`，`dead-data-attr=38`，`sleep-as-done-signal` 65→62） |
| 测试等待门岗 | `pnpm run check:test-waits` | PASS（14/14 通过，`Station wait baseline: 584 occurrences; new/stale: 0`） |
| 变更文件 Lint | `NOMI_BASE_REF=origin/main node ./scripts/lint-changed.mjs` | PASS（3 个改动文件 0 error，0 新增 warning） |
| 启动器冻结名单单测 | `VITEST_MAX_WORKERS=1 npx vitest run tests/ux/launcherDirs.test.mjs` | PASS（4/4 通过） |
| 概念 owner 门岗 | `pnpm run check:concept-owners` | PASS（58/58 + 408 个概念，第二写口 0 新增） |
| MJS/CJS 语法解析 | `pnpm run check:mjs-parse` | PASS（6/6 + 1740 个脚本全部可解析） |
| 测试文案字面量基线 | `node ./scripts/check-test-copy-literals.mjs` | PASS（存量 1168，只减不增，5 个文件净改善） |

## 三、真实串行双变异必红 → 还原必绿实证

在隔离工作树串行（每次仅 1 个窗口进程；运行 Electron 前已在 `f863ea6ad` 执行 `pnpm run build` 对齐构建戳）完成 2 条走查的真实故障变异验证，还原后工作树完全干净：

1. **M1（`tests/ux/model-menu-icons.walk.mjs` · Chromium Design Lab）**：
   - 变异：将 `defaultRow` 临时改为 `undefined`（复现修前将分镜「默认模型」操作行混入目录模型行的问题）。
   - 必红结果：真实 Chromium 执行退出 `1`，中英明暗四组在 `storyboard-row` 精准报红（`模型说明行有品牌方块图标` 与 `分镜「默认模型」说明反映设置中的继承结果` 均失败）。
   - 复原复跑：`git checkout --` 复原后真实 Chromium 执行退出 `0`，中英明暗四组共 `通过 128 条`。
2. **M2（`tests/ux/task-center.walk.mjs` · 真实 Electron 1100×720 窄窗）**：
   - 变异：将真实 UI 添加图片节点循环 `i < 8` 临时改为 `i < 5`（对应设计卡 ★9 反例四）。
   - 必红结果：真实 Electron 执行退出 `1`，精准报红：`nodes: 5 (DOM: 5)`、`节点没加够（读到 5 个）——后续状态摆不出来，停`（静默走查未抢前台）。
   - 复原复跑：`git checkout --` 复原后在 `1100×720` 真实 Electron 执行退出 `0`，实测 `nodes: 8 (DOM: 6)`（精确印证 React Flow 视口虚拟化下真实项目节点为 8 而 DOM 仅挂 6）、`取消后仍排队: 0`、面板几何 `withinViewport: true` 且 `overflowX: false`（未抢前台）。

## 四、未验证边界声明（Unverified）

- 本次独立验收在隔离 macOS 工作树完成全量 8 项静态门岗、diff 逐行核查与 2 条走查（1 条 Chromium Design Lab + 1 条真实 Electron）的串行双变异实证；未在独立线单独拉起 `composer-b3-real.walk.mjs` 全程真窗，亦未覆盖真实 Ubuntu Nightly Runner 与在线外部供应商付费调用（`unverified: composer-b3-real-replay / nightly-ubuntu-e2e-replay / paid-vendor-generation`），需以合入后 Nightly CI 实跑收据最终确认。

## 五、结论

- `#1121` 夜跑走查现役契约同步第十一批在 `f863ea6ad02aef603662ec61478e86de92cbc18d` 上满足设计卡及 CI 全部约束：零生产代码改动、8 项静态门岗全绿、2 条走查真实串行双变异均必红且复原全绿、0 本机路径泄漏。
- 独立验收结论：**通过**。
