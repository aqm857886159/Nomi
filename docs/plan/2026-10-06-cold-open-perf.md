# 设计卡：进项目卡顿根因（打开分阶段打点 + 打开零写盘 + 拖动不重渲）

```
改动名：进项目 / 全选拖动卡顿根因      线/负责人：L-perf      类别：[其他：性能]
```

来源：用户 10-05 反馈 #1「右侧 Agent 运行时明显卡顿：进项目、建新项目都卡」；外包卡 17（PR #1036，只当证据）。

### 功能分类
- [x] 新界面 / 改交互（只有一处：多选时不挂缩放把手）
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式

外观没有像素变化；**交互有一处变化**：多选时不再给每张卡挂缩放把手（只给唯一选中的卡挂，判断与磁吸把手相同），多选状态下不能再拖某一张卡的角单独缩放它，单选照常（V-1041 实测：单选 8 个把手、能缩；多选 0 个）。不碰花钱路径、不碰项目文件格式。

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我点开一个 300 张图的老项目，我想画布和图尽快出来、右边 Agent 面板就位，以便马上接着干活；全选一大片卡拖到别处时画面要跟手。步骤：启动 App → 项目库 → 点项目卡 → 画布出现 → 第一张图出现 → 全选 → 拖动 → 松手。**不做**：不改 Agent 面板的打开时机（花钱安全设计：画布在 Agent 回执恢复后才可写，见 NomiStudioApp.hydrateProject）；不改事件日志的 genesis 设计。**已知坑**：夹具项目第一次打开会走一次性迁移，量「稳定态」要先迁一次；首次启动的开场动画约 11 秒会盖住项目库（卡 17 的 13.8 秒冷开主要是它）。**真实任务**：① I300（300 图 150 边）冷启动后打开；② 回项目库再打开同一项目；③ XL（160 图 + 160 视频 / 640 边）全选拖动。主指标：点卡 → 第一张图解码（ms，中位数 / p95）；质量指标：分阶段耗时；护栏：打开期间主进程 fsync 次数（目标 0）、渲染层长任务总时长。基线 / 目标见 PR「## 测试」前后表（同机 Windows、≥5 次）。 | `tests/ux/project-open-stages.e2e.mjs`、`tests/ux/canvas-performance-benchmark.e2e.mjs --scale XL --scenario drag-nodes-all` |
| ★2 谁说了算 | 项目身份（immutableProjectUuid / projectGeneration）唯一 owner = `electron/workspace/workspaceProjectIdentity.ts` 的 `ensureWorkspaceProjectIdentity`（8 扇门全经它）；Agent 旧对话迁移 owner = `laneLegacyMigration.migrateLaneLegacy`（自写登记 lane-legacy-migration，待删）；轨迹派生视图 owner = `laneTrace.writeTraceFile`；节点渲染 owner = `GenerationCanvasReactFlowNodes.nodeTypes`。打点只读，不新增状态。碰 4 个概念，都只收紧「读时不写」。 | `node scripts/door-map.mjs ensureWorkspaceProjectIdentity` / `migrateLaneLegacy` / `writeTraceFile`（门表见 docs/fixes/2026-10-06-open-project-read-path-writes.root-cause.json） |
| ★3 一致与复用 | 计时用 W3C User Timing（`performance.mark/measure`，主进程 `node:perf_hooks`），不自造计时器；跑器复用 `_launchApp.mjs` + 现有夹具 `canvas-performance-fixture.mjs` + 屏幕外模块 `_offscreenWindows.cjs`；无锁快读复用「读到的不确定就交给加锁路径」这一现有约定（`readWorkspaceManifestSnapshot` 同款）；节点 memo 照 React Flow 官方性能指南。没有第二份定义。 | `git grep performance.mark`（此前全仓 0 处） |
| ★4 全状态 | 外观无变化（多选不挂缩放把手见上）。打点开关关着（默认）= 每处一次布尔判断、不建条目；开着 = 只记本次打开的条目。无锁快读：身份已落定 → 直接答；任何不确定 → 原加锁路径（行为与以前一字不差，包括报错）。迁移：已迁完 / 从没旧对话 → 直接答；其余 → 原加锁流程。 | 单测见 ★9 |
| ★9 验收与回滚 | 验收（另一条线）：同一台 Windows 机器跑 `node tests/ux/project-open-stages.e2e.mjs <label> --runs 5 --warmup 1 --assert-read-only`（开发构建与 `--exe release/win-unpacked/Nomi.exe` 打包构建各一次），对照 PR 前后表；`node tests/ux/canvas-performance-benchmark.e2e.mjs <label> --scale XL --scenario drag-nodes-all --runs 5`（`NOMI_PERF_OFFSCREEN=1`）。单测：`workspaceProjectIdentity.test.ts`、`generationFlowNodeMemo.test.ts`、`tests/agent-runtime/lane-legacy-migration.test.mts`、`lane-trace.test.mts`。回滚：按提交逐个 revert（打点 / 写盘 / 拖动三个提交互不依赖）。 | PR `## 测试` |
| 5 中途表 | 打开项目途中关窗 / 重启：快读不写任何东西，没有半写状态可留；拿不准时走原加锁路径，中途打断行为与改前一字不差。断网不涉及（全本地）。多选拖动中途松手 / Esc：与改前相同（把手只影响缩放，不影响拖动）。不涉及花费。 | 单测：结构坏 / 半缺身份 / 锁被占时快读不答话（`workspaceProjectIdentity.test.ts`） |
| 6 外部数据与失败 | 外部来源只有磁盘上的项目清单、备份和 Agent 会话文件。清单结构不合法、身份缺失、截断、两份不一致 → 快读一律不答话，交加锁路径按原规则修复或报错（用户看到的与改前相同）。 | 同上；V-1041 验收报告 |
| 7 性能预算 | 见 PR「## 测试」：I300 打开零 fsync、XL 全选拖动 18 → 45 帧、合成层 1137 → 57；拖动仍未到预算（每下约 98 ms 长任务），已记残余。 | `project-open-stages.e2e.mjs`、`canvas-performance-benchmark.e2e.mjs` |
| 8 真实条件 | Windows：跑过（开发构建 + 打包构建）。打包构建得到方式：`pnpm run build` 后 `pnpm exec electron-builder --win dir` → `release/win-unpacked/Nomi.exe`（V-1041 没打包，打包数字只有实现线一组）。英文界面：`unverified`（无文案变化）。最小窗口：`unverified`。真规模：I300 / XL 跑过。干净安装：`unverified`。真付费：不涉及。键盘全程：`unverified`。macOS：`unverified`。 | 截图：V-1041 单选把手截图 |
