# 方向检查：Agent 模型清单入口的参数键表

fix-churn 报的是目录命中：`electron/shared/agentCapabilities/` 近 14 天有 7 个 fix，涉及 6 个文件，算同一概念。文件 `availableModelsSchema.ts` 本身 14 天只有 1 个 fix（4ee3ca180）。改法是把手抄的键表换成受类型约束的键表，不加分支、不加特例。按 P1 例外，由协调会话代批（2026-11-27，I-SE-r2 第 1 项），事后报用户。我（I-SE-r2）没参与过这个目录之前的几轮修补。

**这一处的全图在哪**：交接处表外。全图见[根因合同](../../fixes/2026-11-27-agent-param-keys.root-cause.json)的 doors 和 same_class_entry_points。

### 0. 一句话根因

Agent 模型清单入口的 strict 参数键表，是对 `ModelParameterControl` 类型的手抄。类型多一个可选键时编译照过，运行时整轮回合被拒。缺的是「键表跟着类型走」这一层。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| PR #1703（4a8786e95）核心冒烟 spend-confirm 红：「Timed out waiting for generation draft request」 | 图层分离给控件加了 `presets` / `note`。两处投影原样带出，`laneDesktopInput` 用 strict 键表校验，报 `Unrecognized key(s) in object: 'note'`，整轮被拒 | 手抄键表与类型分家 |
| 2d8bdead0（2026-11-14）：可灵 4.0 Flash 的 `optionConstraints.when.slotEmpty` 让整张清单解析失败 | 约束的形状多了一种，键表没跟上 | 同上 |
| 潜伏：`mediaKind: "audio"`（ComfyUI LoadAudio，ac9c78b46） | 类型允许 audio，键表只认 image / video | 同上（值域层） |

### 2. 为什么这一类会一直出现

参数控件的声明（档案 `mode.params`）同时充当界面控件和 Agent 看的模型事实。两处投影都原样转出：`src/workbench/generationCanvas/agent/availableModels.ts:68`、`electron/catalog/agentModelEntriesFromCatalog.ts:71`。入口为了不让来路不明的字段进 IPC，故意用了 strict（合同 2026-09-09-agent-lane-models-block）。strict 本身是对的。错在键表是另抄的一份，而 `z.ZodType<AgentModelEntry>` 只检查「schema 产出的东西装得进类型」，不检查「类型里的键 schema 都认」。所以给类型加可选键永远能编译过，代价是运行时整轮拒收：目录里有一个模型用了新键，Agent 就一个请求都发不出去。

三条铁律：⑪ 能选到适用。档案参数清单本该自动覆盖 Agent 入口，这里是一份手抄清单。最小证据是新类测试：全部内置档案（132 个）走两处真实投影、过两道真实入口。⑩、⑫ 管的是意图对参数、点击对预期，与本案无关。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 下一个给控件加界面用小字段的档案（例如按档提示），会再让 Agent 整轮被拒 | 给 `ModelParameterControl` 加一个可选键：修前 typecheck 绿、冒烟红；修后 typecheck 直接红（TS1360，日志 `item1-counterexample-typekey.log`） |
| 带音频输入的 ComfyUI 工作流投进 Agent 清单时整轮被拒 | 类测试覆盖了内置档案；音频 mediaKind 已在同一张表里补上 |
| 有人图省事去掉 strict，未知键会悄悄进 IPC | 新类测试「两道门仍拒未知键」在去掉 strict 后红（日志 `item1-counterexample-nostrict.log`） |

### 4. 靶子独立性检查

- 判据是 CI 的核心冒烟（`tests/ux/core-smoke-spend-confirm.walk.mjs`，2026-09-22 登记，不是这条线写的），和新类测试（这条线写，修前在 4a8786e95 上红 4 条）。
- 没有「修对了反而掉分」的先例。`check:model-face-frozen` 在修后仍绿。

### 5. 这一整块归谁（P0）

这一整块：Agent 看的模型事实（AgentModelEntry）在 IPC 入口的形状校验
归谁：zod 的 strict 对象校验（zod 3，https://zod.dev/?id=strict ），由我们唯一的一份键表持有：electron/shared/agentCapabilities/availableModelsSchema.ts:11
我们哪里绕开了它：键表手抄、不跟类型绑（修前 electron/shared/agentCapabilities/availableModelsSchema.ts:14-27）；两处投影原样转出 params（src/workbench/generationCanvas/agent/availableModels.ts:68、electron/catalog/agentModelEntriesFromCatalog.ts:71）

### 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 选了以后同一类还会不会出现、从哪出现 | 风险 | 推荐 |
|---|---|---|---|---|---|
| 沿原方向修 | 键表收下 `presets` / `note`，同时改成 `satisfies Record<keyof ModelParameterControl, ZodTypeAny>` 再 `.strict()`；补全档案类测试 | 改 PR 外 1 个文件约 20 行；Agent 的 list_models 多看到这两个键（Seedream 5.5 图层分离的说明句，不是词条键） | 键这一层不会再出现，typecheck 拦。值域层（枚举）仍是手写，内置档案用到才被类测试拦 | 低 | ✓ |
| 换一种做法 | 两处投影只挑 Agent 要的键（剥掉界面用的） | 改 2 个文件；Agent 面不变 | 会再出现：下一个新键仍靠人记得在投影里加或剥，类型拦不住 | 投影和 schema 两份清单 | |
| 删掉 | 把 `presets` / `note` 从控件类型搬走（另开界面提示表） | 只改 PR 内文件，但 types.ts 文件本身命中热点第 3 个 fix；一个参数的声明拆成两处 | 会再出现：下一个加在控件上的键照样炸 | 一个东西两个家 | |

全仓同类镜像的查法：`grep -rn "wireEncoding" electron src scripts`、`grep -rn "placeholder" electron src | grep "z\."`，都只命中 `availableModelsSchema.ts` 这一份。探针把 132 个内置档案逐个投进入口 schema，修前只有 seedream-5-5 的 layers 方式被拒（日志 `item1-probe-before.log`）。

### 7. 用户要权衡的核心

没有要用户权衡的：这是让 Agent 能用起来的修复。唯一的可见变化是 Agent 读模型详情时多两条说明。

## 特征测试清单（动结构前先锁住）

- `electron/shared/agentCapabilities/agentModelEntryBoundary.class.test.ts`：修前红 4 条，修后 6 条全绿。
- `electron/shared/agentCapabilities/availableModelsSlotEmpty.test.ts`、`src/workbench/generationCanvas/agent/availableModels.test.ts`：修前修后都绿。
