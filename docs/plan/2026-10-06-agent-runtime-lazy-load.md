# 设计卡 + 方向检查：打开项目不再装 pi-coding-agent 整个入口（选项 B）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：Agent 运行时按需加载（打开项目的模块图瘦身）      线/负责人：L-perf      类别：[其他：性能]
```

来源：用户 10-05 反馈 #1「右侧 Agent 运行时明显卡顿：进项目、建新项目都卡」；L-perf 根因报告（PR #1041）：打开项目必须先等右侧 Agent 打开（花钱安全设计），而本进程第一次打开时，主进程同步装进 pi-coding-agent 的整个入口（一个 CLI，连带 pi-tui、highlight.js、剪贴板原生模块……），装载期间主进程不接任何 IPC。协调会话 10-06 拍板选项 B：拆依赖图，不打包、不预热、不改花钱安全顺序。

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [x] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式

「Agent 行为」是路径规则推出来的下限（碰了 electron/agentLane/）：Agent 的行为不变，只是模块什么时候装。

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我启动 Nomi 后点开一个老项目，我想画布和右侧 Agent 面板尽快就位；我真让 Agent 跑命令、或者项目里有旧版 Agent 对话要迁移时，功能照旧。步骤：启动 → 项目库 → 点项目 → 画布出现 → 第一张图 →（可选）在 Agent 面板发消息、让它跑 bash。**不做**：不改 Agent 面板的打开时机，不打包、不预热、不搬进程。**已知坑**：打开 lane 工作区只读历史，不装本机能力；真开带模型的 lane（发消息）时才装，第一次发消息会多出这段装载时间（以前算在打开项目里）。**真实任务**：① I300 稳定态项目冷启动后打开；② 回库重开；③ 打开后发一条要跑 bash 的消息（由现有 agent-runtime 测试走真实 openLane 路径覆盖）。主指标：冷开「打开 Agent」阶段、点卡到第一张图；护栏：打开期间主进程新装模块数、是否装了 pi-coding-agent 入口。 | `tests/ux/project-open-stages.e2e.mjs --assert-no-cli-entry` |
| ★2 谁说了算 | 本机能力（bash / 沙箱 / pi 的编码工具）的装配 owner = `electron/agentLane/laneNativeDesktop.mts` 的 `openLaneNativeDesktop`，唯一调用点 `laneHost.openLane`（改成用到时 import）；旧 pi 快照格式 owner = `electron/shared/agentLane/legacyPiSnapshot.mts`（版本常量就地定义，对照上游测试钉住）。不新增状态。 | `node scripts/door-map.mjs openLaneNativeDesktop` / `CURRENT_SESSION_VERSION` |
| ★3 一致与复用 | 照仓库现成做法：`laneCodingTools.loadPiCodingToolFactories`、`laneSkillCatalog.loadPiSkillFormatter` 都是 `await import('@earendil-works/pi-coding-agent')` 按需加载；动态 `import()` 是语言标准。模块装载计数用 Node 官方 `module.registerHooks` 的 load 钩子。没有第二份定义：版本常量只在 legacyPiSnapshot 一处，测试对照上游。 | `git grep "import('@earendil-works/pi-coding-agent')"` |
| ★4 全状态 | 无界面变化。打开项目：不装本机能力；第一次发消息：装本机能力（失败时照旧走 openLane 的收尾：交还会话、关沙箱、报错）；旧快照迁移：版本校验与以前一致（同一个数字 3）。 | 单测见 ★9 |
| ★9 验收与回滚 | 验收（另一条线）：同一台 Windows 机器跑 `node tests/ux/project-open-stages.e2e.mjs <label> --runs 5 --warmup 1 --assert-no-cli-entry`（开发构建与 `--exe release/win-unpacked/Nomi.exe` 打包构建各一次），对照 PR 前后表；`pnpm run test:agent-runtime`（含新的 lane-open-graph.test.mts，改回静态引入必红）。回滚：revert 本 PR 的实现提交。 | PR `## 测试` |

格 5–8 不适用：不碰花钱 / 长跑 / 可打断 / 新界面。

## 方向检查（14 天三次规则）

触发：`electron/agentLane/laneHost.mts` 14 天 6 个 fix；`laneNativeDesktop.mts` 2 个。这次不是在它们的修补链上（之前是审批、工具组、提示词、上下文预算等），只把一个静态 import 改成用到时 import。

- **一句话根因**：Agent 岛把 pi-coding-agent 当成库，从它的入口 `index.js` 取两样小东西（一个版本常量、一个 bash 函数），而这个入口是整个 CLI；Electron 的 Node 同步装 ESM，于是「打开项目」这条只读路径替「发消息才用得到」的能力付了装载时间。
- **为什么会一直出现**：入口是唯一允许的导入路径（包的 exports 只开放了 `.`），任何一处顺手 `import { x } from '@earendil-works/pi-coding-agent'` 都会把整个 CLI 带进它所在的模块图；没有任何检查告诉人「这一行把打开项目拖慢了一秒」。
- **不改结构会冒出什么**：下一个在打开路径上的模块再顺手静态引入一次，冷开立刻回到原样 → 由 `tests/agent-runtime/lane-open-graph.test.mts`（子进程里数真装载的文件，带阳性对照）当场拦下；打开跑器 `--assert-no-cli-entry` 在真 App 里再兜一层。
- **靶子独立性**：装载计数用 Node 官方钩子直接数文件，不经产品代码自报；阳性对照证明同一探测在真正需要它的模块上看得见入口。
- **P0**：动态 import 是标准；按需加载是仓库已有做法。不新增自写能力。
- **对比**：接入（打成单文件，选项 A）留作第二步；补（本 PR）最小；重写 / 删不适用。
- **用户要权衡的核心**：打开项目快约一秒，代价是第一次发消息时多等这一下（同一段装载换了个地方，且不再挡住画布）。

## 特征测试清单

- `tests/agent-runtime/lane-open-graph.test.mts`（新）：打开路径不装入口；阳性对照；版本常量与上游一致。
- 走真实 `openLane` + 本机能力（动态 import 那一刀）的现有测试：`lane-close-resources.test.mts`、`lane-surface-authority.test.mts`（含 bash 工具调用）。
- 走旧 pi 快照校验的现有测试：`lane-legacy-integrity.test.mts`、`lane-legacy-sources.test.mts`、`lane-legacy-migration.test.mts`。
