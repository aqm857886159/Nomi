# 方向检查：electron/catalog/taskParams.ts 的类根因复盘（RW）

作者：一条只读复盘线（没参与过本文件的任何一轮修补）。读的是 origin/main @ 767fdccf3，待合的一刀读 feat/archetype-docs-batch1 @ 7c1492a11。

**第一行：14 天碰本文件的提交 6 个、其中 fix 4 个（另 refactor 1、feat 1）；分成 3 类：参考放置 2 个 fix（+1 refactor）、参数跟着方式走 1 个 fix、能力声明闸 1 个 fix（+1 个 feat 属「其它」）；待合这一刀属「参数跟着方式走」，不是新类，是这一类的第 2 个；走到本文件的路：发请求的主入口 2 条（引擎 A runtime.ts:291、Run provider apimartGenerationProvider.ts:273），另有 5 处只调 taskTemplateParams，door-map 共数出 20 扇；推荐三条路里的「换一种做法」。**

## 0. 一句话根因

「这次实际发哪个方式」和「节点上存着哪些参数」是两份各自演化的东西，没有一个函数负责回答「这个方式认哪些参数」，所以每发现一个模型的 400，就在发送口多补一处「这个键不该发」。

## 1. 归类表：bug → 直接原因 → 类

命令：`node scripts/fix-churn.mjs electron/catalog/taskParams.ts` 输出「文件近 14 天已有 4 个 fix，这一刀是第 5 个」；`git log origin/main --since=14.days --no-merges -- electron/catalog/taskParams.ts` 列出 6 个提交（含 10-30 的 097643761）。

| 提交 | 日期 | 直接原因（diff 事实） | 类 |
|---|---|---|---|
| 097643761 fix | 10-30 | 入口加一句 `assertDeclaredCapabilityForTask`（+2 行） | 其它：能力声明闸 |
| bf61ecadc feat | 11-07 | `steps: request.steps ?? numericWireParam(extras.steps)`（+1/-1） | 其它：新型号参数透传，不算 fix |
| 94e59b73b fix | 11-08 | 两份「按族收参考 URL」合成一份 `referenceUrlsByFamily`（+17/-33） | 参考放置 |
| 6337dc012 fix | 11-08 | 按选中方式取档案：别的方式的 fixedParams 不许进默认值；选中方式的 fixedParams 覆盖节点残留的旧传输判别键（+21/-2） | 参数跟着方式走 |
| 35dc1b84e refactor | 11-09 | 三份旧拼法收成一个降级函数（+27/-139） | 参考放置 |
| e63324597 fix | 11-09 | 降级产物改成 #private 封存对象，并入只有一个口（+16/-5） | 参考放置 |
| 待合 7c1492a11 | — | 见下 | 参数跟着方式走 |

待合这一刀（`git diff origin/main...7c1492a11 -- electron/catalog/taskParams.ts`，48 增 4 删）一刀里三件事：
1. `pruneParamsOfOtherModes`：别的方式声明过、选中方式没声明的键，发送前丢掉（新增分支）。
2. 默认值：任务类型整组的默认值里，选中方式没声明或没默认值的键删掉（新增分支）。
3. `modeLeavesDurationUnset`：该方式没有时长控件或明写无默认值时，`duration` 不发空串（新增分支）。
三件事共同点：把「方式认哪些键」在发送口再算一遍。与 6337dc012 是同一类，6337 删的是 fixedParams 里别的方式的键，这一刀把同一思路扩到全部参数键。

## 2. 为什么这一类会一直出现

**数几条路（door-map 实测）**：`node scripts/door-map.mjs electron/catalog/taskParams.ts` 输出「写入口 17 扇 · 读入口 3 扇 · 共 20 扇」。其中真正决定「方式参数」的只有 2 条：
- 引擎 A：`electron/runtime.ts:291` 调 `applyHeadlessParamDefaults`。方式取自 `request.extras.archetype.modeId`（runtime.ts:281）。`runTask` 的调用者：IPC（taskIpcHandlers.ts:44、main.ts:180，画布 / 分镜批量走这里）、`canvasTransportProvider.ts:181`（Run 里的画布传输）、`tryModel.ts:214`、`comfyCandidateTest.ts:130`、`browserPromptExtractionRun.ts:103`，全部汇到 runtime.ts:291。
- Run / headless：`capabilityCore/apimartGenerationProvider.ts:273`，方式取自 `input.modeId`（Agent / MCP 请求里带的）。
- 其余 5 处（audioTaskRunner.ts:80/151、antigravityCreatePreflight.ts:18/27、customCallDispatch.ts:113、profileHttpRequest.ts:43）调的是 `taskTemplateParams`，吃的是上面两条已处理过的 extras，自己不判方式；待合这一刀的时长改动落在这里，靠 `extras.archetype` 认方式。

**「用户切了方式、旧方式参数留在节点里」现在几处在清**（读代码，非运行）：
1. 切方式写入时：`archetypeMeta.ts:375 applyArchetypeModeSwitch`，只把越界的**下拉值**夹回新方式（`resolveModelParams` 的「只修下拉不管数值」档，注释明写「参考值/照片全局保留，不搬不清，切回还在」）；不认识的键原样留（resolveModelParams.ts:54 `params = previousParams`）。入口 `grep` 得 19 处调用 / 14 个文件。
2. 分镜换方式：研究线记录「清全部参数保留时长」（direction-checks/2026-11-09-model-params-write-time.md 第 1 表第 10 行，本线未重读代码）。
3. Agent patch_shots 换模型：只清 modeId，参数留着（同表第 14 行，同样未重读代码）。
4. 发送时：6337dc012 的 fixedParams 覆盖 + 待合这一刀的三件事。
→ 同一个状态，写入时 1 处半清（只清下拉）、发送口 2 处各自清（fixedParams 一份、「未声明键」一份、默认值一份），分镜自己一套。**没有人清的路**：没有 `archetype`/`modeId` 的请求（老节点、自建中转、ComfyUI 导入、无档案模型）整段 `archetype && mode` 为假，这一刀对它们不起作用（`taskParams.ts` diff 里 `archetype && mode ? prune : guarded`）。

**为什么残留是写进去的、能不能切时就不留**：写入点就是上面 `applyArchetypeModeSwitch`。故意不清（切回来用户之前选的比例还在）。能在这里清吗：技术上能（它是唯一收口函数），但
 a. 会丢用户切回时想要的值，这是既有产品取舍，不是疏漏，我无权翻；
 b. `feat/mode-bar` 把方式改成「由输入现算」（`electron/shared/modelArchetypes/modeForInputs.ts`，该分支设计卡 docs/plan/2026-11-12-mode-from-inputs.md），节点上存的 modeId 降为「偏好」，加一张图方式就变了，**没有「切方式」这一下**可以挂清理。所以「切时清」在新方向下不成立；干净的挂点只有「按现算的方式取有效参数」这一个读口。未核：mode-bar 分支把现算的方式怎么交给主进程（设计卡说不动主进程，所以主进程仍读存着的 modeId）——这可能让主进程和渲染层的「这次发哪个方式」不一致，我没有读出结论。

**与 #1482（参数规整第 1 步）的关系**：#1482 PR 正文 + docs/plan/2026-11-09-model-params-write-time.md：方向是「写入时合法」，`resolveModelParams` 为唯一规整者，管**取值**合不合法（时长 / 比例 / 枚举），第 1 步合并时删了 4 份各写的规整；★1 明写「不做：发送时悄悄修正」；第 3 步合同：「发送同函数复查，触发记 bug 并拦、不钳后照发」。第 2 步原打算：时长与范围入口写完即合法；批量、手改、Agent patch、起草都走它。待合这一刀管的是**键**该不该存在（不是值合不合法），是同一件事的另一半：`resolveModelParams` 已有一个「该控件集里没有这个键」的分支（resolveModelParams.ts:92 `param.unknown`），待合这一刀在 taskParams 里另写了第二份「这个方式认不认这个键」。→ **不冲突，但是第 5 处各写各的**：它做的是 #1482 刚删掉的那种事；并且它是发送时静默修正，与 ★1「不做」和第 3 步「拦、记 bug」的口径不同（我没找到把这条例外写进设计卡的地方）。

三条体验铁律：⑫点了=以为的最直接——参数面板按选中方式只显示它声明的控件，用户看不见的比例仍在节点上并被照发。⑩⑪不涉及。最小证据：节点留一个文生里的 aspect_ratio，切到可灵 4.0 Flash 图生，发出的请求体里没有 aspect_ratio（待合分支的请求体测试，报告称 21 条绿，本线**未亲跑**）。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 报告第 4 条已点名：兄弟档案 kling-v4（kling4.ts）有同样一组未声明的方式；下一批新档案（如 Seedance 其它变体）会再来「某方式不收某参数、上游 400」 | 对每个多方式档案，枚举「任务类型默认值里有、该方式 params 里没有」的键，列表非空即复发（只读脚本，我没写） |
| 没有 modeId / archetype 的老节点和自建中转，发送口仍不清，这一类 400 在它们身上永远修不到 | 造一个只带 aspect_ratio、无 archetype 的 extras 过 `applyHeadlessParamDefaults`，看键是否保留（只读单测可做，我没跑） |
| mode-bar 合入后「加图即换方式」：节点上存的参数与新方式不符的概率变高，而发送口的判断读存着的 modeId | 合入后用对比尺子加一例「加首帧图后发送」的请求体，未验证 |

## 4. 靶子独立性检查

- 尺子 `electron/parity/`（官方请求体矩阵 249 格 × 两路 = 498 份）：由 #1482 同一条线保证零差异，不是这一刀的作者写的，独立。局限（#1482 验收原话）：**矩阵里节点不带用户参数、不走换模型动作**，所以它证明不了「残留键被清」，也量不出「清错」。待合这一刀正好落在它的盲区里，它自己的 21 条请求体测试由同一实现线写，**不独立**。
- 「修对了反而掉分」：本文件 14 天里无回滚类提交（`git log` 无 revert）。
- 靶子有缺：缺一份「带残留键 + 换方式」的对比；#1482 验收也列它为第 2 步开工前必补。

## 5. P0：这些是我们独有的吗

- 「每个方式认哪些参数」是我们独有的（档案、方式、按镜头的花钱语义属领域）。
- 「按声明清理多余键」不是：JSON Schema / zod 一类的「按 schema 解析、剥掉未知键」是现成做法。仓库已依赖 `zod ^3.25.76`、`ajv 8.20.0`（package.json:309、358）。`resolveModelParams`（electron/shared/videoCapabilities/resolveModelParams.ts）是现有登记的共享规整者，缺的就是「未声明键」这一档。自写登记：未在 `self-written.json` 里查到 taskParams 的专条（grep 无输出），登记 id 未核。

## 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 沿原方向修 | 这一刀原样单独成 PR | 最小，现在就能解 Flash / Seedance 编辑的 400 | 在发送口再加 3 个分支；第 5 处各写各的；老节点和自建中转仍没人清；与第 3 步口径（拦、记 bug）不同；mode-bar 合入后判断依据（存着的 modeId）可能和显示不一致 | 否 |
| 换一种做法 | 「方式认哪些键」收进 `resolveModelParams` 作为一档（未声明键 → 丢并留记录），再让「取有效参数」成为读方式的**同一个** owner：显示、发送、Agent 读都问它，与 mode-bar 的 `modeForInputs` 对接；这一刀里的 3 件事并进参数规整第 2/3 步一起做，由参数规整那条线做，批 1 先不等 | 比单刀晚；批 1 的 3 个新模型要么等、要么先带这一刀作为限时例外 | 第 2/3 步还没开工；`modeForInputs` 与主进程怎么对接未核 | 是 |
| 删掉 | 最小可删的单位：`ARCHETYPE_WIRE_DEFAULTS` 里「按任务类型整组桥接给所有方式」这个机制（待合第 2 件事修的就是它）——默认值只读选中方式自己控件上的 defaultValue；`duration:""` 的缺省 `""` 同理删（保旧报文需单独答老用户） | 只能删这两件；残留的「用户存过的比例」删不掉（那是用户的值，不是默认值） | 改变现有模型默认值来源，需 498 份请求体零差异 + 带残留键的新对比验证；我没跑 | 部分（作为「换」的第一步） |

推荐理由：待合这一刀的修法没错、位置也在两条路共用的最早边界，但它是 #1482 刚收掉的那类各写各的；同一文件 14 天第 5 个 fix，再补一刀的下一刀已经看得见（kling-v4）。若批 1 必须先出，我建议只让这一刀作为「限时例外」（要用户拍板，P1），并在同一 PR 的设计卡里写明哪一步把它换掉。

## 7. 系统哪里没拦住（强弱依次）

- 删掉：删「默认值按任务类型整组桥接」（见上表第三行），默认值只读该方式自己的控件。
- 结构上做不出来：发送口只接收「按方式规整过的有效参数」这种品牌类型（#1482 第 4 步本来就要做），在 taskParams 里手拼的 extras 编译不过。
- 门岗自动拦：把「任务类型默认值里有、该方式没声明」做成对全部多方式档案的普查测试，新档案入库即红；报告第 4 条已发现 kling-v4 有同类。
- 写规则文字：不推荐（只会加长 CLAUDE.md）。

## 8. 用户要权衡的核心

要不要为了现在能发新模型，让「发送口静默丢未声明键」先走一次限时例外，还是等参数规整第 2/3 步一次做对（并跟 mode-bar 的「方式由输入现算」对上）。

## 这一刀合入后现有模型的请求会不会变

- 由代码推：会可能变。条件 = 请求里有 `archetype.modeId`，且（a）节点上有只在别的方式声明的键，或（b）任务类型默认值里有该方式没声明的键，或（c）该方式没时长控件而 duration 为空串。这对**所有**有多方式的现有档案成立，不止新批。
- 没有量具证明现状模型不变：`electron/parity` 矩阵节点不带用户参数（见 4），只能证明默认路径没动。待合分支报告称 `upgradeKeepsWorkingModels` 全绿、official-wire 没加基线——我**没有**在待合分支上跑（只读约束下不切分支），**未验证**，缺：带残留键、换方式的请求体对比（#1482 验收也记为缺口）。

## 自验

- 抽查重跑的数字：（1）fix-churn 输出「已有 4 个 fix，这一刀是第 5 个」——已跑，原样；（2）`git log … -- electron/catalog/taskParams.ts` 6 个提交——已跑；（3）door-map「写入口 17 扇 · 读入口 3 扇 · 共 20 扇」——已跑；（4）`applyArchetypeModeSwitch(` 调用 19 处 / 14 文件——已跑（`git grep … | wc -l` 得 19、14）；（5）待合 diff「48 增 4 删」——以任务书给的数为准，`git diff … ` 输出中增删行与第 2 节引述一致，未单独跑 `--numstat`。
- 设计卡 ★9 的「改坏 → 红、还原 → 绿」：不适用（只读复盘）。
- 未核事项：mode-bar 现算方式如何交给主进程；`self-written.json` 登记 id；分镜换方式和 Agent patch_shots 两处引的是 2026-11-09 复盘的结论，没重读代码；待合分支的测试没亲跑。

## 后续

用户 11-12「按推荐做」：走「换一种做法」。实现设计卡见 `docs/plan/2026-11-12-mode-params-owner.md`（PR1：方式参数主人 + 两个发送口 + 空时长；PR2：读口改调、删桥接表）。
