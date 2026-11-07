# 设计卡 + 方向检查：外部（MCP）写画布不再盖掉中间落地的生成结果

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：外部整张写回画布只改它自己改了的东西      线/负责人：L-undo（续）      类别：[花钱]
```

来源：#1065（撤销保留落地结果）顺查到的同一类丢钱路径。协调会话 10-07 排进本线：外部 agent（MCP / 能力核）写画布的形状是「读整张图 → 主进程算出整张新图 → 整张写回」，读和写之间如果落了一次生成结果，整张写回把它盖掉。要求：外部写入只改它声明要改的东西，落地字段（结果、版本、运行态）以当前真实值为准；优先复用 #1065 的落地规则，不另造。

### 功能分类
- [ ] 新界面 / 改交互
- [x] 花钱
- [ ] 长跑 / 可打断
- [x] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式

「Agent 行为」：外部 agent 的画布写入落点变了（行为对 agent 不变：它要的改动照样落地，只是不再连带抹掉别人的）。

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我开着 Nomi、外部 agent（Claude Code / Codex 经 MCP）正在往我的画布上加节点 / 连线 / 改提示词 / 删节点，同时我自己的生成刚好出图（或文本定稿、或还在生成中），我想两边的东西都在，以便不白花钱。步骤：生成进行中 → 外部 agent 读画布 → 方案卡 / 主进程计算期间结果落地 → 外部写回 → 节点上结果还在、agent 的改动也在。项目没开在前台（后台项目、或 App 关着由 headless host 写盘）同理。**不做**：不改外部 agent 能做什么、不改方案卡、不改付费门；不处理两个外部写入彼此之间的冲突（照旧后写的赢它自己改的字段）。**已知坑**：外部写入改的字段若与用户读图之后的手改撞了，外部那一笔赢（只限它改了的字段）。**真实任务**：① 图片节点生成中，Claude Code 经 MCP 给另一个节点改提示词；② 外部 agent 批量加两个节点，方案卡开着时自己这边出图；③ 后台项目在出片，外部 agent 往这个项目连线。主指标：外部写回后落地结果丢失次数 = 0；护栏：外部写入要的改动照样落地（矩阵每格都断言）。 | `src/workbench/capability/externalCanvasWriteKeepsLanded.test.ts` |
| ★2 谁说了算 | 新登记概念 `canvas.external-write-merge`，owner = `electron/shared/canvas/externalCanvasWrite.ts#mergeExternalCanvasWrite`（渲染层 store 与盘上项目共用这一份）。「哪些字段不是用户编辑」唯一清单 = `electron/shared/canvas/landedNodeFields.ts`（`NODE_RUN_STATE_FIELDS` 从 #1065 的 `nodeRunOutcome.ts` 挪过来共用，`NODE_LANDED_FIELDS` 新增）。写口：`ProjectGateway.apply(snapshot, base)` 的两个实现（渲染层 → `canvas.apply` handler；盘 → `writeDiskSnapshot`），混合网关用盘那一份。 | `node scripts/door-map.mjs applyExternalGraph mergeExternalCanvasWrite writeDiskSnapshot` |
| ★3 一致与复用 | 运行态「以此刻为准」复用 #1065 的 `reapplyLandedOutcomes`（`applyExternalGraph` 里不带落地调用一次，只把运行态取活 store）；落地 / 运行态字段清单与撤销共用一份。三方合并本身是按 id 的小函数：现成的 JSON 合并标准（RFC 7386 Merge Patch）把数组当整体替换，节点 / 边数组一整个换掉正是要修的问题；CRDT 库（Automerge / Yjs）要换掉整个画布文档模型，不合适。 | `git grep NODE_RUN_STATE_FIELDS` |
| ★4 全状态 | 无界面变化。成功：外部改动落地，读图之后的落地结果 / 文本定稿 / 运行态原样保留；生成中：不会被外部写入改成空闲或「可重新拉取」（以前会：外部写入走装载时的「重启收敛」）；用户读图之后新建的节点不会被外部写回删掉；外部要删的节点照删；外部改的节点已被用户删掉：不复活。空 / 加载 / 失败 / 过期 / 能力不可用：不适用。 | 矩阵 2 网关 × 4 写操作 × 3 落地 + 新建节点 2 格 |
| 5 中途表 | 合并是同步的（渲染层一次 set；盘上读—合—写之间没有 await），没有中途态。生成与外部写入并发：结果先落、外部后写 → 合并保留结果；外部先写、结果后落 → 结果照常落地。关窗 / 重启：外部写入要么整笔落要么没落（与改前一样）；扣费不涉及（不碰发起与扣费）。断网：不适用（本地读写）。连点：多个外部写入各自按自己读到的 base 合并，互不抹掉对方没碰的东西。 | 矩阵 |
| 6 外部数据与失败 | 外部来源 = 主进程能力核算出的画布快照（`canvasGraph` 纯函数）。渲染层收到的 `canvas.apply` 缺 base 或形状不对 → 拒（`capability_input_invalid`），不退回整张覆盖。 | `capabilityApplyHandler.ts` |
| 7 性能预算 | 每次外部写入多一次按 id 的三方比较（每个改过的节点按字段 JSON 比较）；外部写入是人手节奏的低频操作。未测真规模。 | unverified：未跑 `test:canvas:performance` |
| 8 真实条件 | Windows 上跑真实 core 函数 + 真实网关（A 模式渲染层 handler、B 模式真实项目仓库写临时目录）的确定性测试；不起 App、不连真实资料、不花钱。真 App + 真 MCP 客户端：unverified。 | unverified |
| ★9 验收与回滚 | 验收（另一条线）：`npx vitest run src/workbench/capability/externalCanvasWriteKeepsLanded.test.ts electron/shared/canvas/externalCanvasWrite.test.ts`（35 条；矩阵 26 条在改前全红）；变异：渲染层 handler 不合并 → 9 红；盘上整张覆盖 → 13 红；节点系统字段不设防 → 8 红；`applyExternalGraph` 不取活运行态 → 4 红。硬门 ⑫ 对账见逃逸账本 `FB-20261007-external-write-drops-landed-result`。回滚：revert 本 PR 的实现提交。独立验收报告：待验收线出。 | `## 独立验收` |

## 方向检查

与 #1065 同一个类根因（节点里混着用户编辑层与系统事实层，整对象写入没有一处声明哪一层归谁），复盘全文见 `docs/plan/2026-10-07-undo-keeps-landed-results.md` 的「方向检查」。本 PR 是那份复盘「不改结构会冒出什么」第 3 条预测的兑现。

- **一句话根因**：外部写入把「算出来的整张图」当成真相写回，没有区分「它改了什么」和「它读图时顺带看到的东西」。
- **这次做的结构改动**：把「哪些字段不是用户编辑」收成一份共用清单（撤销、外部写入两处读同一份）；外部写入的落点收成一个按 id 的三方合并，`ProjectGateway.apply` 必须带 base。
- **还会从哪冒出来**：①后台项目的盘上结局投递（`runProjectDelivery` 读盘—改一个节点—整份存回）与外部盘上写入并发时，丢的是外部的改动（不是付费结果），未修；②以后任何新的「读整张—整张写回」写者绕过这份合并。
- **P0**：现成合并标准见 ★3，不适合按 id 的画布文档；只写了合并规则本身。
- **用户要权衡的核心**：外部写入从「后写的整张覆盖」变成「只改它改了的」，代价是外部 agent 想整张重置画布这件事做不到了（今天也没有这样的工具）。

## 特征测试清单

- `src/workbench/capability/externalCanvasWriteKeepsLanded.test.ts`：2 网关 × 4 写操作（改提示词 / 加节点 / 删别的节点 / 连线）× 3 落地（生成结果 / 文本定稿 / 生成中）+ 读图之后新建并出图的节点（2 网关），共 26 条。
- `electron/shared/canvas/externalCanvasWrite.test.ts`：每个系统字段（运行态 4 + 落地 4）外部写入改不动 + 三方合并的增删改与读图之后出现的东西，共 9 条。
