# Agent 把可选参数写成 null：生成被拒、界面不说（设计卡 + 方向检查）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 线：F-nullparam（0.23.2 热修）。类别：[花钱]。本页同时是设计卡（PR `## 设计卡`）和方向检查（`Direction-Check:` trailer 指向这里，`fix-churn` 命中「画布付费生成」概念第 6 个 fix）。

## 一、发生了什么

2026-10-18 真付费走查（零视频花费）：默认大脑 deepseek-v4-pro 起草 `draft_shots`，参数写成
`{"resolution":"480p","size":"16:9","generate_audio":false,"seed":null}`（null = 「不设」，大模型的惯常写法）。
草稿和付费卡都正常出来；用户点「生成这段」，`compileParameters` 对 `seed: null` 判「要 number，收到 object」
（`typeof null === "object"`），确认整次被拒（主进程 `spend-confirm-failed code=generation_not_started`），卡还摆着，
节点停在「等你确认」，只弹一句笼统的「这一步没成」。v0.23.1 同一段代码，已发布版本里默认大脑 + Seedance 2.0 就用不了。

## 二、方向检查（类根因复盘，七节）

### 0. 一句话根因
参数值只有一个准入函数，却在两个时刻被调用——起草只判「模型 + 模式」、确认才判值——而模型的坏习惯（null）从没进过走查夹具。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 本次：seed:null 确认时被拒 | `compileParameters` 把 null 当类型错 | 空值语义没定义 |
| 本次：付费卡先出、点了才拒 | 起草入口不调 `compileParameters` | 起草与确认判的不是同一时刻的同一份参数 |
| 本次：卡上不说原因 | `failed()` 只带账本事实，不带「哪个参数」 | 拒绝信息在最后一跳被丢 |
| 近 14 天同概念的 5 个 fix（读盘清残留、比例语义、时长准入等） | 每次补在「某个入口某个值」 | 同一类的前几次都是在补入口，这次补在边界上 |

### 2. 为什么会一直出现
起草入口的准入一直是「先放进来、读盘时再清」（`stripParametersNotAccepted`），确认时才第一次编译合同。
读盘清残留对「未知键」是宽的，对「已知键写了坏值」没有任何一层兜底。铁律对号：⑩ 说的 = 摆的（起草放行的参数应该等于确认时能过的参数）。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 别的可选参数（`duration:null`、`resolution:null`）、别的模型（图片 / 音频）同样在确认时才被拒 | `optionalNullParameters.class.test.ts` 全目录普查 |
| 字符串 `"4"` 写在数字参数上，起草放行、确认才拒 | `draftTimeParameterAdmission.test.ts` |
| 确认被拒的任何别的原因，卡上还是只有笼统一句 | `agentPanelSpendRejected.e2e.test.ts` |

### 4. 靶子独立性
免费演练夹具大脑的草稿是写死的规整格式，从没带过 null：尺子（夹具）与被量对象（起草）是同一条线写的。
修法：夹具大脑也带 `seed: null`（两条付费演练都补），修前红修后绿。

### 5. P0：这些是我们独有的吗
参数准入、起草时序、花钱卡上的失败展示都是领域边界（花钱路径），没有现成库可接；null 的语义（可选 = 没设）本身是通用 JSON 惯例，
我们按它做，不另造「null 的特殊含义」。

### 6. 接入 / 补 / 重写 / 删

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 无（领域边界） | — | — | 不适用 |
| 补 | 在 compileParameters 定义空值语义；起草入口调同一个 admitPlanCandidate；确认失败带 field | 小 | 起草更严（坏值当场拒）→ 模型多一轮自纠，但这是想要的 | **推荐**。不换的理由：边界本身是对的，缺的是调用时机 |
| 重写 | 把起草也改成编译整份合同 | 大 | 起草拿不到 `referenceSourceUrls`，会误拒带 @ 的草稿（plan 那条路已经为此拆出 admitPlanCandidate） | 不做 |
| 删 | 删起草准入 | — | 退回现状 | 不做 |

### 7. 用户要权衡的核心
起草更严（坏值起草就退回给模型）换来「付费卡一出来就一定点得动」；代价是模型偶尔多一轮自纠。我们选前者。

## 三、设计卡（★ 5 格 + 第 9 格；花钱类）

改动名：agent-null-params　线/负责人：F-nullparam　类别：[花钱]

| 格 | 内容 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当 Agent 起草一镜付费生成，我点「生成这段」，期望它真的开始生成；失败时我要知道是哪个参数、能怎么办。不做：不改价格、不改授权、不放宽类型（"4" 冒充数字、"false" 冒充布尔照旧拒）。已知坑：null 对必填参数 = 缺必填。真实任务：默认大脑 deepseek-v4-pro 起草 Seedance 2.0 Fast 一镜（走查日志里那份参数）。 | `agent-video-landing-paid.rehearsal.walk.mjs`（夹具带 seed:null）|
| ★1b 连带界面 | Agent 工具结果（起草被拒：现有结构化 ParameterRejection，zh/en 码表）；付费卡上点生成被拒：通知点名参数（`agentPanelV4.spendActionParameterRejected`，zh/en）；返工 / 续拍同一类失败：`actionFailure.parameterRejected`（zh/en） | 设计实验室 `v4-spend-parameter-rejected(-en)`；`spendCardFailure.test.ts` |
| ★2 谁说了算 | 概念：生成参数准入 → owner `executionContract.ts compileParameters`（`door-map compileParameters`：写入口 1 扇）；起草入口 `admitPlanCandidate` 3 扇（合同编译 / 改草稿 / 起草），都调同一个函数；同一份事实只存一份（候选里的 null 键不进合同）；没有靠「东西不见了」猜意图 | `node scripts/door-map.mjs compileParameters` / `admitPlanCandidate` |
| ★3 一致与复用 | 起草复用 `admitPlanCandidate`（plan 改草稿本来就用它），不另写校验；失败展示复用现有通知（`toast(…,'error')`）与 `spendActionFailureCopy`，不新造元素；失败分类复用 `ProductionShotActionFailure` 闭集，加 `parameter_rejected` 一项 | `git grep admitPlanCandidate` |
| ★4 全状态 | 起草被拒：Agent 读到结构化拒绝，改对再交，不出卡；确认被拒（参数）：卡还在，通知点名参数，没开始生成；确认被拒（别的原因）：沿用已有分类文案；取消中 / 过期：不变；能力不可用：不适用（不需要新的外部资源） | 设计实验室截图（zh / en）；`agentPanelSpendRejected.e2e.test.ts` |
| 5 中途表 | 不适用：不新增长跑 / 可打断动作；确认被拒发生在批下之前，没有提交意图落盘，不扣费、不留任务 | e2e：供应商 0 次请求、卡仍在 |
| ★9 验收与回滚 | 见下「验收清单」；回滚：revert 本 PR（单概念，无数据迁移，草稿 / 合同格式不变）；独立验收：待 V-nullparam（Codex） | 清单逐条结果见 PR 正文 |

### 验收清单（实现线自验按这份，独立验收只核这份）

1. 单测：每个目录模型参数表的全部可选参数写 null → `compileParameters` 过、合同里没有这些键（遍历全部档案）。`optionalNullParameters.class.test.ts`
2. 单测：必填参数 null → 拒绝并点名键；字符串 "4" 冒充数字、"false" 冒充布尔 → 仍拒。同上
3. 起草拒绝：draft_shots 带 `seed:"abc"` → 参数拒绝、不产生草稿；MCP 的 create（单镜 / 多镜）与 plan 各一条。`draftTimeParameterAdmission.test.ts`
4. 确认被拒：桩让确认抛参数错 → 卡上通知点名参数（zh / en 各一张真组件图）；供应商 0 请求；卡还在。`agentPanelSpendRejected.e2e.test.ts` + 设计实验室
5. 免费演练：夹具大脑草稿带 `seed:null`，修前红修后绿。`agent-video-landing-paid.rehearsal.walk.mjs`、`agent-permission-two-tiers-paid.rehearsal.walk.mjs`
6. 变异：去掉 null 处理 → 1 红；去掉起草校验 → 3 红；去掉确认显示 → 4 红；改前备份、跑完拷回、sha256 核对
7. `NOMI_PR_BODY_FILE=.tmp-pr-body.md node scripts/pre-push-contracts.mjs` exit 0

### 入口表（能产生待付费草稿的入口）

| 入口 | 路径 | 起草时过 compileParameters |
|---|---|---|
| Agent `draft_shots` 单镜 | verb → plan create（flat）→ `admitSingleCandidate` | 是（本 PR） |
| Agent `draft_shots` 多镜 | verb → plan create（shots）→ `admitDraftShots` | 是（本 PR） |
| Agent `draft_shots` + operationId 补镜头 | verb → plan extend → `admitDraftShots` | 是（本 PR） |
| Agent `draft_shots` + operationId 改一镜 | verb → plan patch → `resolvePlanPatch` | 是（原本就判） |
| MCP `nomi_operation_plan`（无 operationId，semantic / candidate） | create → `admitSingleCandidate` | 是（本 PR） |
| MCP `nomi_operation_plan` 带 shots / scriptText | create → `admitDraftShots` | 是（本 PR） |
| MCP `nomi_operation_plan` / `nomi_submit_generation_plan`（有 operationId） | patch → `resolvePlanPatch` | 是（原本就判） |
| 付费卡上改参数 | `revisePendingSpend` → `normalizePatch` = `resolvePlanPatch` | 是（原本就判） |
| 画布节点自己生成 | 画布执行器（引擎 A），不经草稿 | 不适用（`freezeCanvasExecutionContract` 冻的是画布已拼好的请求） |
| 文稿方案改一镜（`storyboard.patch-design`） | `patchStoryboardAuthoring` → 渲染端分镜表 | 不适用：这类草稿的 gate_request 被拒（「用原来的分镜确认」），生成走分镜 / 画布执行器，不经 `compileParameters` |

## 四、第二次验收不过（同一 PR）：起草拒对了，Agent 却改不回来

真付费第二次：大脑写 `parameters.variant: "fast"`，起草校验正确地拒了（「不接受参数 variant」），但工具结果的 `Next` 是 lane 对**所有**失败通用的那句
「Read the current project state … Do not repeat an unknown paid submission」，Agent 照着停下，面板出「这一步没做成」报错卡。

**类根因**：失败指引没有按码分。那句通用话是给「提交状态不明」那一类写的；起草阶段的拒绝什么都没发出去，却吃了同一句。对外 MCP 早就按码给恢复动作
（`mcpToolErrorResults`），lane 这边一直是通用句——两个出口各写各的，lane 那边没人对「Agent 收到拒绝后能不能改对」负责。
还有一个结构缺口：`list_models` 把变体投给了模型，`draft_shots` 每一镜却没有地方写（`variantId`），模型只好塞进 parameters。

**补法**（强弱依次：结构上做不出来 > 门岗自动拦 > 文字）：
1. 指引表只有一份：`electron/shared/agentCapabilities/admissionRejectionHints.ts`。MCP 的恢复动作与 lane 的 `Next:` 读同一张；参数类拒绝一律说「什么都没提交、没扣钱，按说明改参数再调同一个工具」。
   只有「提交状态不明」的码保留「不要重复提交」；认不出的码仍 fail-closed。传输层把具体拒绝码（`admission`）随失败带出去，lane 据它选下一步。
2. 放错位置的字段：`electron/shared/agentCapabilities/draftFieldAliases.ts` 一张通用对照表（variant→variantId、model→modelId、mode→modeId……），
   `compileParameters` 的 unknown_parameter 在「键是起草顶层字段名、且该模型参数表里没有它」时直说「放到 draft 的 X 字段」，variantId 还列出目录里真实的变体词。
   表里每个目标字段由单测核「在 draft schema 里真实存在」。
3. `draft_shots` 每一镜新增 `variantId`（模型面）并按宿主既有的 `variantId` 落位；schema 体积预算按看得见的方式记账（+22）。
4. 自纠闭环测试：脚本化模型只读工具结果文本改草稿再交，五类毛病（塞 variant / 写 null / 数字写字符串 / 多一个未知键 / variantId 写错）都要走到付费卡；
   免费演练夹具大脑第一回合写 `variant:'fast'` + `seed:null`，读到指路后改成 `variantId` 再交，读不到指路就停下。

验收清单追加：**8. Agent 能当场自纠**（上面第 4 条）。
