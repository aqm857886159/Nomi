# Agent 工具预算：逐工具列账 + stage_shot 措辞瘦身（导演台工具按场景常驻已撤出）

> 状态：已实现未推送（分支 `chore/agent-tool-budget`）。设计卡（★5 格）+ 方向检查（RW）合一页。
> 2026-10-10 用户拍板方案 B：本 PR 只保留 ① 逐工具列账、② stage_shot 措辞瘦身；③「导演台工具按场景常驻」整块撤出，留到 3D-BOX 导演入口拍板时重做。

## 设计卡

```
改动名：Agent 工具预算（账 / 瘦身）   线：工具预算线   类别：[其他]（模型可见工具面；不花钱、不长跑、无新界面）
```

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 开发者 / 评审在加工具、改 schema 时，门岗直接说出每个工具占多少 token（开 3D-BOX 时 `stage_shot` 一个就占 3534，约 35%，总量 9997 / 10000 只剩 3），而不是只给一个总数。`stage_shot` 的字段说明去掉重复冗词，释放一点余量。**不做**：不改任何工具的执行 / 审批 / 参数语义，不改上限，不做按场景可见（见下「方向检查」）。真实任务：① 开 3D-BOX 跑门岗，看到逐工具账；② `check-agent-tool-face-usecases` 开关开 / 关都过。 | `scripts/check-model-schema.ts` 输出；`check-model-schema.node-test.mjs` |
| ★1b 连带界面 | 无。Agent 面板、回执、提示词全部不变（`stage_shot` 的工具描述、`promptGuidelines`、示例逐字不变）。 | 基线 diff 去掉 description 后结构逐字相同 |
| ★2 谁说了算 | 「模型可见 schema 的体量」→ 门岗 `check-model-schema`（`laneToolLedger` 是唯一的量法，组合与报表都从它求和）；字段说明 → `directorPlanSchema.ts` 的模型投影（唯一 owner）。 | `node scripts/door-map.mjs laneToolLedger` |
| ★3 一致与复用 | 沿用 pi 的 `estimateTokens`，不另写估算器；门岗规则与上限不动。 | `check:model-schema` |
| ★4 全状态 | 门岗：全部常驻组合 ≤ 10000 → 绿；超了 → 红并点名组合（原行为）。逐工具账按大小降序打印，末尾两个总量。能力不可用：不适用（无新界面）。 | node-test「per-tool ledger」 |
| ★9 验收与回滚 | 验收：另一条线跑开关开 / 关两遍 `check-model-schema`、`check-model-face-frozen`、`check-tool-face`、`check-agent-tool-face-usecases`。回滚：revert 本 PR 的提交。 | PR 正文 |

### 预算数字（pi estimateTokens，开关开：`NOMI_DESKTOP_DEV=1 NOMI_DIRECTOR_3DBOX=true pnpm exec tsx scripts/check-model-schema.ts`）

- 全部组常驻（判据）：改前 9997 → 改后 **9867**（上限 10000 不变，余量 133）。开关关的构建 7717 不变。
- `stage_shot`：3534 → 3404（−130，仅字段说明措辞；结构、枚举、必填、示例、工具描述、`promptGuidelines` 逐字不变）。
- 没有靠调高上限糊过去；常驻后没有超限。

## 方向检查（RW）：为什么 ③ 撤出

触发：`fix-churn` 命中（`laneHost.mts` 近 14 天 5 个 fix、`writeVerbs.ts` 5 个、`director/` 目录 3 个），而 ③ 本身在同一条线上被修了 3 轮。

### 0. 一句话根因

「当前场景（用户是不是站在 3D 导演台里）」**没有单一持有者**：每个会改变工具清单的入口各自去问渲染端 / 各自带一份，所以补一个入口就还有下一个入口。

### 1. 三轮修补各自修了什么

| 轮次 | 修了什么 | 为什么还不够 |
|---|---|---|
| 初版 | 渲染端每次发送带布尔 `directorOpen`；宿主在 idle prompt 准入时按它切换 `stage_shot` 是否进激活清单，提示里加「先打开 3D 导演台」 | 只有“发新消息”会更新场景 |
| 复审 1 | steer / follow-up 也经 `inputMessage` 同步场景；提示按场景签名同回合重拼；authority 段只列可见工具 | 提问回答、报价改写、按钮审批这些恢复同一回合的命令不经 `inputMessage`，不同步 |
| 复审 2 | 场景事实改为宿主 `execute` 入口对每条用户命令现问渲染端（`lane.scene-facts`），所有用户命令先同步再往下走 | 一轮内工具结果回灌后 pi 会自动发下一次模型请求，这一步不经过任何用户命令；期间导演台被关掉，下一次请求仍带场景工具，且 `stage_shot` 执行时不检查场景 |

每一轮都在补“某个入口”，而漏洞在“没有一个地方持有当前场景并在每次模型请求前、每次工具执行前读它”。

### 2. 为什么这一类会一直出现

场景可见性被实现成“在用户命令入口处顺手同步”——它依赖入口数得清；pi 的自动续跑、重试、恢复都是不经用户命令的请求，入口集合本来就数不全。可见性判据（清单）和执行判据（`before_tool`）也是两处，互不兜底。

### 3. 用户拍板：方案 B（2026-10-10）

- 本 PR 只保留 ① 逐工具列账、② stage_shot 措辞瘦身；
- ③ 整块撤出：`residentScene` 声明、场景工具目录、`lane.scene-facts` 问答、宿主 `execute` 入口同步、提示重拼、authority 过滤、渲染端应答、相关测试与结构断言，全部恢复成 main 的样子（同提交删干净，无开关、无死代码）；导演台工具按 main 现状常驻；
- 预算判据照旧（全部组常驻 ≤ 10000），按“导演台工具常驻”重新算：9867，未超限。

### 4. ③ 重做时采用的方向

**主进程统一持有当前场景状态**：渲染端在导演台开 / 关时**推送**给主进程（一个写口）；**每次模型请求读它**（含 pi 自动续跑的请求，不依赖用户命令）；`before_tool` **兜底**（场景外调用场景工具直接拒，保证可见性之外还有执行侧的第二道）。这样“当前场景”只有一个持有者，入口再多也不会漏。

### 5. 挂靠决定

这件事挂到「3D-BOX 导演入口」的拍板上：3D-BOX 目前在开关后面、正式包里关着，没有用户丢功能；入口形态定了（导演台外能否直接建导演台节点、是否需要轻量建节点入口）再一起做 ③。

### 6. 对比

| 选项 | 做什么 | 推荐 |
|---|---|---|
| 接入现成方案 | pi 0.85.1 没有 tool-search 扩展 / MCP 暴露模式（见下），无现成可接 | 无 |
| 补 | 再补“自动续跑”这个入口（第 4 个入口补丁） | 否（第 3 轮修补，第三个特例分支） |
| 换 | 单一持有者 + 每次请求读 + `before_tool` 兜底 | 是，但等入口拍板时一起做 |
| 删 | 撤出 ③，保留 ① ② | **是（用户拍板 B）** |

## 系统改进

- 为什么会发生：工具面只有“全常驻”一档，判据也只有“全部同时在”一种口径，只服务某个场景的大工具没有合法位置；而“场景可见性”的第一版实现按入口补丁，没有单一持有者。门岗又只打印组合总量，新工具不显形。
- 系统哪里没拦住：没有逐工具账；没有“会改变工具清单的状态必须单一持有”的约束。
- 补了什么（强弱）：门岗自动拦——逐工具账让新工具直接显形（本 PR ①）；类根因与重做方向写进本方向检查，挂到 3D-BOX 导演入口决定上，③ 重做时按“单一持有 + 每次请求读 + `before_tool` 兜底”做，不再逐入口补。

## pi 0.85.1 核实（只核实，没改；供 ③ 重做参考）

结论：**升级 pi 不是接上 A 方案（找工具元工具）的前提；0.85.1 里没有上游新版的 tool-search 扩展和 MCP 暴露模式。**

- 无 tool-search 扩展：`pi-coding-agent/dist/extensions/` 只有 `index.*` 与 `llama/`；全包无 `createToolSearchExtension`。无 MCP 暴露模式（direct / deferred / codemode / hidden）：`pi-coding-agent/dist`、`pi-agent-core/dist` 检索无命中；`pi-coding-agent/docs/usage.md:309` 写明有意不含内置 MCP。
- `setActiveToolsByName` 在 `pi-coding-agent/dist/core/agent-session.d.ts:318`（实现 `agent-session.js:659`），但那是 coding-agent 的 `AgentSession`；Nomi 用的是 `pi-agent-core` 的 `AgentLane.setActiveTools(names, context)`（`pi-agent-core/dist/harness/runtime/lane.d.ts:87`，整体替换）。工具在 `before_request` 钩子之前已按配置取好（`pi-agent-core/dist/harness/runtime/drive/generation.js:43`），所以请求前钩子改不了**本次**请求的工具，生效点是下一次请求。
- 0.85.1 自带“动态工具加载”：`pi-coding-agent/docs/extensions.md:2365`；工具结果上的 `addedToolNames`（`pi-agent-core/dist/types.d.ts:325`）在下一次请求前并入激活清单（`pi-agent-core/dist/harness/runtime/drive/tool-placement.js:137-156`）。纯增量时，原生支持的模型（Anthropic Sonnet / Opus / Fable 4.5+，非 Haiku；OpenAI gpt-5.4+，`extensions.md:2381`）把新定义放在工具结果位置、保住前缀；其余模型与非纯增量（含移除）整表重发（`extensions.md:2392`）。代理 / 自定义模型要显式开 `compat.supportsToolReferences` / `compat.supportsToolSearch`（`pi-ai/dist/types.d.ts:546-548`、`:616`）。
- 未核：调研报告提到的上游新版 tool-search 扩展与 MCP exposure 的具体接口——本线没联网查证，**unverified**。
