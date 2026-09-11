# 接模型这条路，到底卡在哪

> 2026-09-11 · 诊断 + 方案，**不含代码改动**。
> 起因：用户 09-11 20:00 转来群反馈与三张真机截图 ——「手动添加的模型都没法通过验证，还消耗积分」「减少模型怎么操作」。
> 范围：手动添加 / 用 AI 帮我接入（#739）/ MCP 接入工具（#735）三条入口，直到「画布模型框里能选到它」。
> 本文只出结论、卡点表与方案对比；实施另派。

---

## 0. 一句话

**在 Nomi 里，一个模型能不能在画布上用，唯一的凭证是「一次成功的付费真实生成」。**
这条唯一通路上有三道我们自己挖的坑：① 图片模型的调用形状被写死成「同步」，异步中转必错；
② 这类**我们这边接法不够**的失败，被当成「上游报错」分类，归到 `unknown`，把英文工程串甩给用户，
并建议他「自己接」；③ 失败的那一次验证还会给模型盖一个 `adapter.state=failed` 的章，
**让它比从没验过时更不可用**。钱花了，模型没了，报错看不懂——三件事叠在一起就是群里那句话。

---

## 1. 现场（用户三张截图 + 报错原文）

| 截图 | 用户看到的 | 代码里对应的东西 |
|---|---|---|
| ① 验证结果卡 | 「没有能力通过验证 · 其中 1 个还不能在画布使用；连接、密钥和模型记录都已保留」 | `src/i18n/locales/onboardingProviders.ts:796` `stage.failed`、`:758` `addedSomeFailed` |
| ① 原始报错 | `Provider returned a pending task but the adapter has no query operation` | `electron/providerAdapter/verifier.ts:306` |
| ① 模型 | `gpt-image-2.5-flare`，能力标着「文生图 / 参考图改图」 | `adapterVerification.mode.text_to_image` / `.image_edit`（`:816-817`） |
| ③ 批量添加对话框 | 「保存后为『已配置、未验证』；本步骤只写入本地，不读文档、不调用 AI、不做真实测试」 | `src/i18n/locales/modelSetup.ts:105` `addedHint` |
| ③ 另一处（同一屏的另一个对话框） | 「确认后会立即进入认证……通过真实请求消耗上游额度」·按钮「验证 N 个」 | `src/i18n/locales/onboardingProviders.ts:741` `saveModelsDisclosure`、`:743` `addModels` |

**这里已经有一条卡点**：同一件事（把模型加进来）有两个对话框，一个承诺「不花钱、不测试」，
一个承诺「立刻花钱验证」。用户看到的是哪一个，取决于他从哪个入口进来——他自己无从判断。

真机形态证据（09-09 / 09-11 走查截图，本文不新拍）：
`docs/plan/2026-09-09-sweep-ledger-triage/settings-model-02-open-models-after.png`（模型设置首页 IA）、
`docs/research/2026-09-11-comfyui-matrix-evidence/D3-model-picker.png`（画布模型框）。

---

## 2. 根因 1 ——「验证」

### 2.1 直接原因：图片模型的调用形状被写死成「同步」

`newapiTransportFor(kind)` 是所有「OpenAI 兼容 / 中转站」模型的传输配方真相源
（`electron/catalog/newapiTransport.ts:319`）。它按 **kind** 发配方，不按**这家中转真实的行为**：

| kind | create | query（轮询） | statusMapping |
|---|---|---|---|
| video | `POST /v1/video/generations` | ✅ `GET /v1/video/generations/{task_id}` | ✅ |
| audio | `POST /v1/audio/speech` | ❌（2026-08-30 专门修成「同步字节」一条路） | — |
| **image** | `POST /v1/images/generations` | **❌ 从来没有** | — |

`electron/catalog/newapiTransport.ts:68` 的注释写得很清楚：「图片：同步 create（无 query；create 返回即结果）」。
这份配方被两个地方消费，两个地方都会得到一份**没有 query 的图片说明卡**：

- `electron/catalog/catalogCommit.ts:518-520` —— 手动 / 批量添加落库时生成 mapping。
- `electron/providerAdapter/builtinOpenAiCompatibleDraft.ts:108-133` —— 端点没有公开文档时（自建中转 / IP / 内网）AI 编译路的兜底草稿。
  注意 `:133` 那条 `image_edit` 连 `...async` 都没带（`:113`、`:136` 的 text_to_image / image_to_video 带了）——
  即使哪天 image 配方有了 query，改图那条仍然拿不到。

于是：**任何把图片做成「提交任务 → 轮询」的中转，走这两条路进来的图片模型必然验证失败。**
`verifier.ts:303-306`：create 回来的 `status !== "succeeded"`，没有 `mode.query`，直接抛。

AI 编译路**本可以**生成 query —— 系统提示词第 45 行明写「Async APIs declare create plus query and statusMapping」
（`electron/providerAdapter/compiler.ts:26` 起的 `SYSTEM_PROMPT`）。但它只在「抓到了这家的公开文档」时才有机会用上；
自建中转 / 中转站文档不可达时走的正是上面那份写死同步的兜底草稿。

### 2.2 这条报错还有一层歧义：它未必真的是「异步」

`resolveTaskStatus`（`electron/tasks/responseParsing.ts:101`）在**认不出状态且找不到产物 URL** 时，
兜底返回 `queued`（`:129-130`，注释写明这是刻意的乐观行为，避免误杀已付费的生成）。
所以 `verifier.ts:306` 那句话实际同时覆盖两种完全不同的情况：

- (a) 这家中转**真的**是异步任务制 → 我们缺 query；
- (b) 这家中转**同步返回了一张好图**，只是形状不在 `extractAssetUrl`（`electron/tasks/assetUrlExtract.ts:29`）
  认识的十几种路径里 → 没抓到 URL → 状态认不出 → 压成 `queued` → 报同一句话。

**我们分不清是哪种，因为响应体根本没留下来。** verifier 只保留 `requestSummary`（请求，`verifier.ts:208/287`），
从不保留响应；自动修复拿到的 `failure` 里也只有 `{stage, message, modelKey, taskKind}`（`service.ts:88`）。
结果是：用户不知道、我们不知道、连自动修复的那个模型也不知道——**修复循环在盲修**。

### 2.3 为什么失败还消耗积分

**会花钱，而且花在「返回之前」而不是「返回之后」。** 顺序是：

1. `verifier.ts:277` `execute(...)` —— 用真实 key 向真实端点发**一次真实生成请求**（图片模型 = 一次付费出图）。
2. 上游受理、扣费、返回一个任务受理回执。
3. `verifier.ts:303` 我们发现它是 pending。
4. `verifier.ts:306` 我们发现自己没有 query。
5. 抛错。**那个已经付了钱、正在跑的任务，我们既不轮询也不取消，直接丢掉。**

`verifier.ts:302` 有 `input.onRemoteTaskAccepted?.(remoteTaskId)` —— **我们手里明明有那个 task id**，
只是这条路径不用它。（`certificationCleanup.ts` 清的是本地临时文件，不是远端任务。）

**账要按次数算**，不是「一次」：

- 一个图片模型 = 2 个模式（text_to_image + image_edit）→ 一轮验证 **2 次付费出图**（`service.ts:492-495` 双层循环，逐个真实提交）。
- 自动修复默认 2 轮（`service.ts:131`、`:393`），每轮修完做**全量回归**（`service.ts:440-441`）→ 最坏 **3 轮 × 2 模式 = 6 次付费出图**。
- 批量添加 N 个模型就 ×N。
- 另加：文档抓取（免费）+ 调用用户自己的文本模型做编译/修复（花文本额度）。

### 2.4 验证前用户知道要花多少吗？—— 知道「可能花钱」，不知道「花多少」

现有三处披露：

| 位置 | 原文 | 缺什么 |
|---|---|---|
| `onboardingProviders.ts:741` `saveModelsDisclosure` | 「确认后会立即进入认证：可能读取公开文档、调用文本 AI，并通过真实请求消耗上游额度。」 | 没有次数、没有单价、没有「失败也照扣」 |
| `onboardingProviders.ts:146` | 「Nomi 可能读取公开 API 文档、调用你已配置的文本模型，并向当前上游发送真实测试请求，因此可能消耗额度。」 | 同上 |
| `modelSetup.ts:88` `integrationConfirmHint` | 「这是一次真实生产请求，用来证明选中的模型确实可用。确认后才会消耗上游额度。」 | **说的是「一次」，实际最坏 6 次/模型** |

对照 2026-09-09 拍板的「钱的闸 = 每次提交看报价确认」（memory `money-gate-per-submit-no-budget-setting`）：
**这条闸在验证这一步是漏的。** 画布上点「生成」要看报价确认，接模型点「验证」只看到一句「可能消耗额度」，
而后者一次能烧掉前者六倍的钱。这不是文案问题——是同一条规则在两个地方没有同一个执行点。

> 诚实标注：Nomi 此刻**拿不到**中转站的单价（中转不给报价接口），所以「显示价格」这件事对自定义中转做不到。
> 能做到且必须做到的是**次数 + 性质**：「将向 <地址> 发起 2 次真实出图请求；失败也会计费；自动修复最多再重试 2 轮（最多 6 次）」。
> 下面方案按这个口径写，不假装能报价。

### 2.5 失败的验证会让模型**比没验过更不可用**（这条最狠）

画布模型框的准入是 `published === true && publishedModes.includes(该模式)`
（`src/config/modelCatalogCache.ts:151-152`），`published` 由 `derivePublishedExecution` 算
（`electron/shared/modelPublication.ts:117`）：

- `meta.adapter` **不存在**（纯手动落库的模型）→ 走 `:134` 分支，**enabled 的 mapping 本身就算发布证据** → 能在画布上用。
- `meta.adapter` **存在**（这行进了认证域）→ 走 `:146` 分支，**只有 `activeRevision` + `mode.state==="verified"` 才算数**，
  原来的 enabled mapping 不再作数。

而一次失败的验证**恰好会写上 `meta.adapter`**：`serviceCatalog.ts:436-448`（部分提交时）和 `:477-490`（整体失败时）
都会 `upsertModel` 写入 `adapter: { state: "failed", runId, modes, ... }`，
且在原本没有 `activeRevision` 时**不写** `activeRevision`。

**结论：`adapter` 有了、`activeRevision` 没有 → `:146`/`:159` 两个分支都不进 → `publishedModes = []` → `published = false`。**
也就是说，对一个「手动添加、mapping 齐全、本来能在画布上选到」的模型，
**按一次「验证」按钮，如果失败，它会从画布上消失。** 这是一道单向门：验证只能让它更差，不能让它维持原状。

这正好解释了截图那句「其中 1 个还不能在画布使用；连接、密钥和模型记录都已保留」——
记录确实还在，只是它再也不出现在模型框里了，而用户读这句话时会以为「东西还在，只是还没验」。

> 待实测确认（不改代码，写一条单测即可，属实施阶段第一步）：
> 对 `derivePublishedExecution` 喂「有 enabled mapping + `meta.adapter={state:'failed'}` 无 activeRevision」，
> 断言 `published === false`；再喂同一行去掉 `meta.adapter`，断言 `published === true`。
> 代码路径是确定的（三个分支互斥且都不满足），但这条断言值得钉死成回归钉子。

### 2.6 为什么用户看到的是一串英文

`verifier.ts` 有 5 条**我们自己抛的**错（不是上游抛的）：`:238` `:306` `:337` `:369` `:370`，全是英文、全无错误码。
它们不是 `VendorRequestError`，所以带不出 `errorCategory` / `httpStatus`（`verifier.ts:59-64` 注释说明这两个字段只从抛出点查表带出）。
到了 `src/ui/onboarding/adapterFailureAdvice.ts` 的 `switch`，全部落进 `default` →
`reasonKey: 'unknown'`、`action: 'selfConnect'` → 界面显示
「这个错误我们没认出来。原文在下面，可以照着自己接，或复制给 AI 帮你看。」（`onboardingProviders.ts:774`）+ 英文原文。

`adapterFailureAdvice.ts` 的注释明确禁止「用关键词猜 error 字符串」——这条纪律是对的，
问题不在那里，而在于**这张分类表只有「上游怎么拒绝我们」这一个维度，没有「我们这边接法不够」这个维度**。
于是 Nomi 自己的能力缺口被当成「未知的上游错误」，并给用户一个「你自己接吧」的出口。
`selfCheckMeaning`（`:759`）已经在替这件事打补丁——「未通过表示 Nomi 还没有可执行的请求方式，不等于你的模型或密钥一定有问题」——
但它是一句放在旁边的通用说明，压不住正文里那串英文和那个「我自己接」的按钮。

### 2.7 类根因（一句话，供 root-cause 合同用）

> **Nomi 把「一个媒体端点是同步还是异步」当成 `kind` 的常量硬写在传输配方里，而它其实是每家上游各自的事实；
> 当真实响应与硬写的假设冲突时，冲突被当成「上游的未知错误」上报，而不是当成「我们的配方需要补一条 query」处理。**

同类入口扫描（`same_class_scan` 的雏形）：

| 入口 | 状态 | 证据 |
|---|---|---|
| audio 同步字节 vs JSON 任务 | **已治**（2026-08-30） | `docs/fixes/2026-08-30-synchronous-audio-certification-boundary.root-cause.json` —— 症状原文就是这同一句 `pending task but the adapter has no query operation` |
| video 异步 | 天生带 query | `newapiTransport.ts:335` |
| **image 异步** | **未治，本次现场** | `newapiTransport.ts:340` |
| image_edit（任何 kind） | **未治，且比 image 更差**（连 async 都没拼进去） | `builtinOpenAiCompatibleDraft.ts:133` |
| 3D | 明确不编造，如实报「没有通用通道」 | `builtinOpenAiCompatibleDraft.ts:107` + `why.noGenericContract` |

**2026-08-30 那次把类根因划在了「音频字节」这一层，所以同一句报错今天从图片这边又回来了。**
这次要划的边界是「同步/异步是探测出来的事实，不是 kind 的常量」，否则下一次会从 3D 或某个新 kind 回来。

---

## 3. 根因 2 ——「减少模型怎么操作」

### 3.1 能力存在，且它就叫「隐藏」

字段：`Model.enabled`（`electron/catalog/types.ts:262`）。
闸门只有一处：`electron/catalog/modelCatalogListing.ts:88` `.filter((m) => m.enabled)` ——
**这就是「哪些模型出现在画布模型框里」的唯一开关**，语义正确、可逆、已有验收记录
（`docs/plan/2026-07-04-relay-model-enable-editing.md:39`：「停用某模型后它从生成模型下拉消失、再启用又回来」）。

所以这不是「坏了」，是**找不到**——与 `docs/lessons/` 里那条「群里说『坏了』多半是『找不到』」同型，这已是第四次。

### 3.2 为什么找不到（四条，按权重）

**① 画布上一个入口都没有。** 用户「想减少模型」的那一刻，人在画布的模型下拉里。
那个下拉（`src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:611` 的 `NomiSelect`）
每一行只有模型名，没有任何 per-row 动作槽（`src/design/NomiSelect.tsx:31-51` 的 `NomiSelectOption` 里根本没有这个概念），
连 `searchable` 都没传。下拉里唯一的额外行是「一家都没接入 → 去接入」（`useDedupedModelSelect.ts:67-77`）。
**要整理，得离开画布、离开当前任务，去设置里翻 4–5 层：**
画布节点模型框 → 设置 → 「模型」tab → 模型设置首页 → 连接卡 → 模型行（→ 有时再进模型详情页）。

**② 控件长得像「多选」，不像「显示/隐藏」。**
`src/ui/onboarding/ModelEnableEditor.tsx:212-227`：那是一个 18×18 的**打勾方块**（`role="checkbox"`）。
同一个组件在 `selectMode` 下（`:171-199`）用**一模一样的打勾方块**表示「选中它，准备删除」，
两者只差一个颜色（`bg-nomi-accent` vs `bg-workbench-danger`）。
同一屏还并排放着「全选 / 全不选 / 选择删除 / 批量删除」（`onboardingProviders.ts:711-714`）。
**一个用户看到勾选框 + 全选 + 批量删除，只会读成「这是多选」，不会读成「这一格决定它在不在画布下拉里」。**

**③ 「隐藏」两个字在这一屏上根本没出现。**
唯一说人话的那句 ——「已启用 · 点击隐藏（不再出现在节点模型列表）」（`onboardingProviders.ts:724`）——
只作为 `title` tooltip 挂在**另一个组件** `src/ui/onboarding/ModelChipGroups.tsx:135` 上。
`ModelEnableEditor` 这个真正的模型列表里，那个方块**没有 tooltip**，只有一个读屏才听得见的
`aria-label`，而且用的是第三个词：「停用 / 启用」（`onboardingProviders.ts:718-719`）。

**④ 一件事三个词。** 同一个 `enabled` 字段，在产品里叫「启用/停用」（aria）、「隐藏/显示」（tooltip）、
「已启用 N / 共 M」（计数，`:715`）；旁边还有一个语义完全不同的「彻底删除（需重拉才回来）」（`:722`）。
用户想「把它从列表里拿掉」，猜不出该点哪个，猜错了代价是不可逆的删除。

### 3.3 已登记但没做完的那一半

`docs/audit/redundancy-backlog.md:43` B7，状态仍是 ⬜：
「【第2轮·用户点名】模型选择弹窗零信息架构：画布节点下拉全量平铺（数十条）、无搜索/分组/最近用/能力分类……
且节点/镜卡/助手三处选模型心智不一」。
`docs/audit/2026-06-23-app-wide-redundancy-audit.md:8` 称它是「本轮唯一的真 B 类痛点」。
已落地的只有它的一半（去重 + 自动选最优供应商，`docs/plan/2026-06-23-model-picker-identity-dedup.md`）；
供应商排序单独做在「设置 → AI 策略」（`src/workbench/settings/VendorPreferenceOrderSection.tsx:24`）。
**「在模型框当场整理（隐藏/常用/搜索）」这一半，从 06-23 记到今天，一直空着。**

---

## 4. 流程体检：想接一个模型 → 画布能用

### 4.1 三条入口各走几步

| | ① 手动添加 | ② 用 AI 帮我接入（#739） | ③ MCP 接入工具（#735） |
|---|---|---|---|
| 起点 | 设置 → 模型 → 「自定义 API / 中转站」 | 设置 → 模型 → 卡片「用 AI 帮我接入」→ 复制指引 | 外部 AI 助手里说一句「帮我把 X 接进 Nomi」 |
| 步数 | 填来源名 → 填 BaseURL →（填 Key）→ 保存连接 → 获取模型 / 手填 id → 勾选 → 确认验证 → 等 ≈ **7 步 + 一次等待** | 选宿主 → 复制 → 粘到助手 → 助手驱动 ③ → 回 Nomi 点确认 = **4 步 + 一次跨应用往返** | `begin → credentials → discover → select → request_confirmation → start` **6 个工具回合 + 人在 Nomi 窗口点确认** |
| 谁定调用形状 | `catalogCommit.ts:518` 硬写配方 | 抓文档 → AI 编译；抓不到 → `builtinOpenAiCompatibleDraft` 硬写配方 | 同 ② （共享 `electron/providerAdapter/service.ts` 这条路） |
| 谁出钱 | 用户上游额度 | 用户上游额度 + 用户文本模型 token | 同 ② |
| 实测数字 | — | — | **入参一次写对 36/58 = 62%；9 回合里 1 回合完全成功；人工引导 5 次；窗口点确认 4 次（3 次白点）**（`docs/research/2026-09-11-mcp-onboarding-defects/prior-art.md` §0，真实 Codex CLI 0.153.4 + 真实 DeepSeek key） |

### 4.2 卡点表（四问 × 三入口）

四问：①怎么知道有这功能 ②动手前知不知道要付出什么 ③空了/错了看到什么 ④凭什么信结果对·错了怎么回头。

| | ① 手动添加 | ② AI 帮我接入 | ③ MCP |
|---|---|---|---|
| **①怎么知道有** | 🟡 设置 → 模型 →「其他接入方式」第一行，说明「先保存地址与 Key，再获取列表或手动输入模型」。入口在，但它长得像「高级选项」 | 🟢 09-11 已把卡放到人在的那一屏，且空态时排第一（`docs/design/2026-09-11-ai-assisted-onboarding-entry.md`）| 🔴 **只有已经在用 Codex/Claude Code 的人才可能知道**；Nomi 这边除了 ② 那张卡，没有第二处说明 |
| **②动手前知不知道付出什么** | 🔴 **两个对话框互相矛盾**：一个说「只写入本地、不做真实测试」，一个说「确认后立即进入认证、消耗额度」；`integrationConfirmHint` 说「一次真实生产请求」，实际最坏 6 次/模型（§2.3） | 🔴 同左（共享同一条验证路），另加一笔看不见的文本模型 token | 🔴 **最差的一格**：助手替他点了 `start`，钱从他的上游账户扣，他只在窗口里看到一个「确认」——`request_confirmation` 的幂等语义还坏着（`prior-art.md` §3：每回合再确认一次就把人的点击洗掉，与 Stripe idempotency 相反），实测 4 次点确认里 3 次是白点 |
| **③空了/错了看到什么** | 🔴 **最差的三格之一**：一串英文 `Provider returned a pending task but the adapter has no query operation` + 「这个错误我们没认出来」+ 一个「我自己接」按钮。用户唯一能推断的是「我填错了」——而他没填错 | 🔴 同左 | 🟡 错误码 → 人话表已存在（`electron/capabilityCore/mcpToolErrorResults.ts:7`），#735 正在补六个新码；但模型侧收到的与人侧看到的仍是两份 |
| **④凭什么信结果对·错了怎么回头** | 🔴 **最差的一格**：唯一凭证是付费真实生成；失败后模型被盖 `adapter.state=failed` 章，**从画布上消失且没有回退路径**（§2.5）——「怎么回头」的答案目前是「删了重加」 | 🔴 同左，且自动修复在盲修（拿不到响应体，§2.2） | 🟡 有 opaque receipt + 签名 challenge，结果可审计；但一旦 ④ 的发布判据本身是坏的，审计得再干净也没用 |

**最差的三格**：
1. **①-④ / ②-④：验证失败会让模型从画布上消失，且没有回头路。**（单向门）
2. **③-②：助手替用户花钱，确认机制本身是坏的**（3/4 次白点）。
3. **①-③ / ②-③：把我们自己的能力缺口报成「未知错误 + 你自己接」。**

### 4.3 能砍掉的步

- **手动路的「获取模型」和「验证」之间那一跳**是多余的往返：我们已经在「获取模型」时打过一次
  免费的 `GET /models`（`electron/ai/onboarding/modelListProbe.ts:116`，同时支持 `/models` 与 `/v1/models` 两种落点）。
  **那一次请求已经证明了「地址对 + key 对 + 这个模型 id 存在」，但它的结论没有被任何发布判据采信。**
- **`image_edit` 的独立付费验证**在多数中转上与 `text_to_image` 是同一条 pipeline，
  可以合并成「一次出图 + 一次带参考图出图」里的一次，或降级成「先只验主模式，改图模式按需再验」。
- **自动修复的全量回归**（`service.ts:440-441`）在「只有一个模式失败」时没必要重跑已通过的模式。
  这是它成本翻 3 倍的主因，收益（防止修坏已通过的模式）可以用「只重跑受改动影响的模式」达到。

---

## 先查别人（§5 · 实查，带 URL）

> 调研口径：六家同类桌面/本地 AI 工具的「添加自定义模型 → 验证 → 隐藏/删除」全流程 + OpenAI 兼容 `/v1/models` 惯例。
> 下表每格都是读到官方文档页或源码原文得出的；推测的单列在末尾。

| 产品 | 加一个自定义模型几步 | 有「验证」吗 | 验证发什么·花不花钱 | 失败提示 | 怎么隐藏/删除 |
|---|---|---|---|---|---|
| **Cursor** | Settings → Models → Add Model，开 Override Base URL，填 URL + Key + Model ID | 有，`Verify` 按钮 | **官方没文档化**；社区一致说法是打一次 `POST /v1/chat/completions` → 花极少钱 | 论坛报 bug：点了什么都不发生 | 内置模型**只能取消勾选、不能删**；自定义的可删 |
| **Cline** | 选 OpenAI Compatible → URL → Key → 下拉选或自由输入 model id | 无独立按钮，靠自动拉表 | `GET {baseUrl}/models`，**免费**；URL/Key 一改就 debounce 重拉 | **拉不到就静默返回空数组**，不弹错，用户退回自由输入 | 文档未写（未查实） |
| **Continue.dev** | 写 `config.yaml`：`provider/apiBase/model` | **无验证动作** | 源码 `OpenAI.ts` 有 `listModels()` → `GET {apiBase}/models`，免费；文档只演示 Ollama 的 AUTODETECT | 无 | 改/删 YAML |
| **Open WebUI** | Admin → Connections → `+` → URL + Key；拉不到就手填 Model IDs 白名单 | **有，且官方文档明写「验证会失败但不代表不能用」** | 后端 `POST /api/v1/openai/verify` → 对上游 `GET {url}/models`，**免费**；图像侧另有引擎专用 verify（A1111 `/sdapi/v1/options`、ComfyUI `/object_info`，其余直接 return True） | 上游 ≥400 原样透传；URL 非法/重复 ID 各有专门文案 | 连接有启停开关；Models 页每模型 **Hide Model**，可按 Visible/Hidden 过滤 + 批量 show/hide |
| **LobeChat** | 服务商页 → 获取模型列表 / 添加自定义模型 | **有，「连通性检查」** | **发真实 chat**（`messages:[{role:'user',content:'hello'}]`），**花钱**；下拉**只列 `type==='chat'` 的模型 → 图像/视频模型根本不参与检查** | 本地化标题 + 可展开的原始 JSON body | 每模型 enabled 开关（启用/禁用两段） |
| **Cherry Studio** | 服务商页 → 获取模型列表 → 模型管理弹窗 `+`；也可手工添加（带 context/pricing/endpointType） | **有，`检测` 按钮**，可选模型、可选用哪个 key | **按模态分流探针**：chat → `generateText('hi')`；embedding → `embedMany(['test'])`；**image → `generateImage('a red circle')`，且异步 submit/poll 型只发一次 submit，不建 job、不下载结果**（注释原话：accepted = credential + endpoint + model OK）。都花钱，但 **15s 超时 + AbortController 主动掐**（注释：否则 tokens 继续烧）。UI 批量检查**主动跳过** image/video/audio，跳过理由枚举就叫 `generation_cost` | 绿色「连接成功」/错误信息，**带 latency 毫秒**，汇总「通过 N / 部分 N / 失败 N / 跳过 N」 | 服务商启停开关；模型管理弹窗内增删 |
| **`/v1/models` 惯例** | — | 事实标准的「免费验证 + 自动发现」二合一 | `GET /v1/models` → `{object:"list", data:[{id,...}]}`。不产 token，但**官方文档没有任何「免费」的文字表述**——方案里不许写「官方说免费」 | — | — |

### 5.1 六条可直接借鉴的模式

1. **「验证失败 ≠ 不可用」要写进 UI，不是写进 FAQ。** Open WebUI 官方文档明写：验证会 400/401/403 失败，但 chat completions 照样能用，并给兜底路径（手填白名单）。<https://docs.openwebui.com/getting-started/quick-start/connect-a-provider/starting-with-openai-compatible/>
2. **探针按模态分流；异步任务型只验「提交被受理」。** Cherry Studio 对 submit/poll 图像模型只发一次 submit，不建 job、不下载产物。<https://github.com/CherryHQ/cherry-studio/blob/main/src/main/ai/AiService.ts>（`checkModel`）
3. **贵模态默认跳过，且「为什么跳过」是一等公民。** `ModelHealthCheckSkipReason = {kind:'generation_cost', output:'image'|'video'|'audio'} | {kind:'unsupported_probe'}`，汇总文案单列「跳过 N 个」。<https://github.com/CherryHQ/cherry-studio/blob/main/src/renderer/pages/settings/ProviderSettings/types/healthCheck.ts>
4. **验证必须带超时 + AbortController，否则钱继续烧**（Cherry 默认 15s），并把 latency 当成检查的产出展示。同上。
5. **自动拉表与自由输入必须并存，拉表失败要静默降级而不是报错。** Cline `refreshOpenAiModels` 失败直接 `return []`。<https://github.com/cline/cline/blob/main/apps/vscode/src/core/controller/models/refreshOpenAiModels.ts>
6. **「隐藏」和「删除」在六家里都是两件事，且没有一家把「用不上的模型」做成删除。** Cursor 内置模型只给勾选不给删；Open WebUI 给 Hide Model + Visible/Hidden 过滤 + 批量；LobeChat/Cherry 用 enabled 开关。<https://docs.openwebui.com/features/workspace/models/>

### 5.2 最关键的一条对照：**没有任何一家像 Nomi 这样验**

- LobeChat 的连通性检查**把非 chat 模型整个过滤掉**——图像/视频模型不参与检查。
- Cherry Studio 会验图像，但**只验「提交被受理」**，且批量检查时以 `generation_cost` 为由默认跳过图像/视频/音频。
- **视频模型，六家一个都不验。**
- Nomi 现在的标准是：**真发一次付费生成 → 轮询到成功 → 下载产物 → `certifyMediaArtifact` 验真这是一张真图/真视频**（`verifier.ts:369-378`）。

**这就是本文真正的取舍点，不是技术细节。**
Nomi 比业界严一整档。严这一档买到的是**「模型框里出现的东西，点了一定能出片」**这个承诺——
这是 Nomi 与「一堆模型名列在那里、点了才知道行不行」的产品之间真实的差别，也是 2026-08-12
「名实一致」那一轮刻意选的立场。代价就是今天群里看到的：**接模型贵、慢、失败率高，而且失败时用户被扣了钱还被暗示是自己填错了。**

方案不能糊掉这件事。下面的 §6 把它拆成两个可以分别决定的问题：
**(1) 标准要不要降**（§6.B），**(2) 不降标准的前提下，怎么把成本、披露和失败姿态修好**（§6.A/C/E）。

### 5.3 未查实（不许当依据用）

① Cursor 的 Verify 到底发什么请求（官方无文档，仅第三方博客/论坛）；
② `/v1/models` 是否计费（官方无文字表述，只能说「不产 token」）；
③ Cline 与 Cherry Studio 的模型删除操作（官方文档未描述）；
④ Continue 的 `AUTODETECT` 用于 openai provider（源码支持，文档只演示 Ollama = 能用但未承诺）。

### 5.4 仓库内部的相关既有事实（同样是「别人」，只是是过去的我们）

`electron/catalog/validateCandidateCredential.ts` 的注释里记着两个**我们自己实测的反例**：
**apimart 对合法 key 恒回 401、minimax 回 200 却连最小生成都跑不通。**
所以 **「`/models` 通过 = 模型可用」是错的，「`/models` 通过 = 地址与 key 可用」是对的**——
任何分档方案必须尊重这条已被实测钉住的边界，不能把免费档说成「可用」。

---

## 6. 方案对比表

五件事分开决策，不捆成一个大改。**B 是唯一涉及产品立场的那一条**，其余四条无论 B 怎么选都要做。

### A. 图片/媒体端点的同步-异步事实（治根因 1 的第一层）

| | 用户看到 | 代价 | 回滚 |
|---|---|---|---|
| **A1 只给 image 补一份 query 配方** | 支持 `/v1/images/generations` + 轮询的中转能过了 | 小。但**这正是 08-30 那次的做法**（当时只给 audio 补），同一句报错会从下一个 kind 再回来 | 删掉那份配方 |
| **A2（推荐）把「同步/异步」从 kind 常量改成一次探测出的事实** | 第一次验证时 create 回来是 pending → Nomi 自己去试通用轮询端点，成功就**把 query 写进这家的说明卡**并继续；失败才报错，且报的是「这家是任务制，我们没找到查询接口」而不是英文串 | 中。`Mapping` 要多一个「异步形状待定」状态，轮询端点候选要排序（复用 `compilerCandidatePriority.ts` 的姿势）；要一条棘轮防止有人再按 kind 硬写 | 探测关掉即退回 A1 行为 |
| **A3 让用户在失败页手填查询端点** | 多一个表单 | 违反 D1（让用户学我们的格式）。**只作为 A2 的兜底逃生口，不作主路** | — |

不是选项、是 A 的一部分：`builtinOpenAiCompatibleDraft.ts:133` 的 `image_edit` 没带 `...async`
（`:113`/`:136` 带了），必须与 `text_to_image` 同源，否则 A2 做完改图那条仍然拿不到 query。

### B. 「可用」的判据要不要降一档（**唯一的产品立场问题**）

对照 §5.2：业界最严的 Cherry Studio 也只验到「提交被受理」，LobeChat 干脆不验图像，视频六家都不验；
Nomi 现在验到「产物下载下来并验真」。

| | 用户看到 | 代价 | 回滚 |
|---|---|---|---|
| **B1 维持最严档（真出片 + 验真产物）** | 模型框里的东西点了一定能出片，这个承诺继续成立 | 接自定义中转贵、慢、失败率高；异步中转在 A 做完之前必失败 | — |
| **B2（推荐）两档 + 按模态分流**：免费自检（`/models` + 模型 id 存在 + 说明卡形状完整）→ 付费烟测（保持真出片 + 验真，**但只验主模式**，改图/图生视频等衍生模式标「未测试 · 首次使用时验证」） | 第一档立刻、免费、无需确认，给出「地址和 Key 没问题、形状看起来对」；第二档单独确认，写明「将发起 N 次真实出图；失败也会计费」 | 中。第一档三件事代码里全有（`modelListProbe.ts`、`validateCandidateCredential.ts`、说明卡结构），是**接线不是新造**。衍生模式首次使用可能失败，但那时用户本来就在花钱生成，失败有上下文 | 把衍生模式放回验证清单即可 |
| **B3 降到业界档（submit-only）**：提交被受理即算通过，不轮询、不下载、不验真 | 接模型快且便宜，和 Cherry Studio 一样 | **放弃「点了一定能出片」这个承诺**。且我们自己实测过 minimax 回 200 却跑不通（§5.4）——受理 ≠ 能出片 | 改回轮询 |
| **B4 免费档过了就发布，付费烟测改成可选** | 最省钱最快 | 与 §5.4 两个实测反例直接冲突，把「可用」变成谎话 | — |

**B2 与 B3 的区别用一句话讲给用户听**：
B2 = 「我们仍然真跑一次给你看，只是不再为每一种用法各跑一次，而且事先告诉你要跑几次」；
B3 = 「我们只确认对方收下了这个请求，能不能出片你自己第一次用的时候才知道」。

### C. 失败不得让模型倒退（治 §2.5 那道单向门）

| | 用户看到 | 代价 | 回滚 |
|---|---|---|---|
| **C1 维持现状** | 验证失败 → 模型从画布上消失 | 0，但这是本次反馈里最伤的一条 | — |
| **C2（推荐）失败的 run 不改变发布状态** | 验证失败后模型**保持验证前的可用性**；卡上如实写「这次没验成 · 它之前能用的模式仍然能用」或「它此前就没有可用模式」 | 中小。改 `derivePublishedExecution` 的 `:146` 分支：`adapter` 存在但**从未成功过**时回落到「按 enabled mapping 判断」，而不是判死。要一条回归钉子钉住「失败不降级」 | 分支改回去 |
| **C3 失败即整行回滚（连 mapping 一起撤）** | 干净 | 把「手动配好、只是没验」的模型也抹掉，更差 | — |

### D. 模型框当场整理（治根因 2）

对照 §5.1 第 6 条：六家全都把「隐藏」和「删除」分开，且没有一家把「用不上的模型」做成删除。

| | 用户看到 | 代价 | 回滚 |
|---|---|---|---|
| **D1 只改文案与 tooltip** | 那个方块终于有了「隐藏」二字 | 极小 | — |
| **D2（推荐）画布模型下拉里加「整理」** | 下拉底部一行「整理模型」；进入后每行一个眼睛图标（显示/隐藏）+ 搜索；退出即生效。**不删东西**——删除仍只住设置里那个家 | 中。`NomiSelectOption`（`src/design/NomiSelect.tsx:31-51`）要开 per-row 动作槽；节点/镜卡/助手三处必须共用同一实现，否则就是 B7 说的「三处心智不一」再来一遍 | 撤掉那一行 |
| **D3 连搜索/分组/最近用一起做（B7 全量）** | 最完整 | 大，且与「左侧栏 / 画布节点 / 过程渐显」那批设计排队冲突 | — |

不是选项、D1/D2 都要做的：**词表统一成「显示 / 隐藏」（画布可见性）与「删除」（不可逆）两个词，
废掉「启用 / 停用」这第三种说法**，并把 `check:vocabularies` 钉上去。
同时把 `ModelEnableEditor.tsx:212-227` 那个打勾方块换成眼睛图标——
**只要它还长得和旁边「选中待删」的方块一模一样，改多少文案都救不回来。**

### E. 报错分类补一个维度（治 §2.6）

不设选项。`adapterFailureAdvice` 入参加一个 `nomiSideReason`（由 verifier 在抛出点带出结构化码，
与现有 `errorCategory` 同构、**同样不猜措辞**），新增对应 `why.*` 文案，把
「我们这边还没有这家的查询接口 / 我们没读懂它返回的形状」与「上游拒绝了你」彻底分开；
主按钮从「我自己接」换成「再试一次（这次我们会自己找查询接口）」或「把这份诊断交给 AI 助手」。
`verifier.ts` 那 5 条英文串全部登记（`:238` `:306` `:337` `:369` `:370`）。

顺带按 §5.1 第 1 条：**验证结果卡上要有一句「没通过不代表这个模型不能用」**——
`selfCheckMeaning`（`:759`）已经是这句话，但它现在埋在正文下方，应升到与结论同级。

### F.（附带）三处必须同时修的小账

1. **两份互相矛盾的披露**（`modelSetup.ts:105` 说「只写入本地不测试」vs `onboardingProviders.ts:741` 说「立即进入认证」）统一成一句话。
2. **`integrationConfirmHint` 说的「一次真实生产请求」是错的**（`modelSetup.ts:88`），实际最坏 6 次/模型。
3. **验证要带超时 + 主动 abort**（§5.1 第 4 条）：`verifyTimeoutMs` 已有 90s（`service.ts` 默认），
   但 pending 任务被丢弃时**没有取消远端任务**，而我们手里有 `remoteTaskId`（`verifier.ts:302`）。
   至少要在失败卡上把这个 id 显示出来，让用户能去中转后台自己查/取消。

---

## 7. 推荐（一句话 + 顺序）

**A2 + B2 + C2 + E + F 是一件事，一起做；D2 单独排、与 B7 合并。**

这些改动共同回答同一个问题——「**在 Nomi 里，凭什么说一个模型能用**」。今天的答案是：
「凭一次成功的付费生成；这次生成必须符合我们按 kind 硬写的形状；否则钱照花、模型倒退、报错甩英文。」
改完之后的答案是：

> **免费自检告诉你地址和形状对；付费烟测真跑一次给你看它能出片，而且事先告诉你要跑几次、失败也算钱；
> 这一次没验成不会让你比之前更差；没验成时我们说清是我们缺一条查询接口，不是你填错了。**

**顺序（按「止血 → 可诊断 → 治根 → 省钱 → 好用」）**：

1. **C2** —— 最小、最止血：先让「按验证按钮」不再有惩罚。
2. **E + F1/F2** —— 不花钱、只改可读性与诚实度，让后续所有失败可诊断。
3. **A2** —— 治根因；同 commit 删掉 `newapiTransportFor` 里按 kind 硬写同步/异步的那条假设（P1，无并行版）。
4. **B2** —— 分档 + 次数披露，把「钱的闸」在这条路上真正接上。
5. **D2** —— 模型框整理，与 B7 那一半合并，不再单独开卡。

每条按 R21 走 `root-cause-remediation`；**A2 与 C2 属 `recurring`**（同一句报错 08-30 已经从音频那边回来过一次），
必须提交 schema-v3 合同，`invariant_owner_layer` 写「传输配方派生层」与「发布判据层」，**不写 verifier**
（verifier 只是发现者，不是这条不变量的主人）。

验收按 R30 口径：零额度 loopback 夹具进 CI（异步中转 / 同步中转 / 形状不认识 三种响应各一条），
外加一次小额真实中转的接入闭环，数字写进 PR。

---

## 8. 要用户拍板的问题（每条带默认）

> 核心那一个先问：**Q0**。其余五条是它定了之后的细节。

| # | 问题 | 默认（不回复就按这个做） |
|---|---|---|
| **Q0** | **「模型框里出现 = 点了一定能出片」这个承诺，要不要在「自定义 API / 中转站」这一类上继续保住？** 保住（B1/B2）= 接模型仍然要真花一次钱跑通；降档（B3）= 和 Cherry Studio 一样只确认「对方收下了请求」，接模型秒过但第一次用可能失败。业界没有一家做到我们这一档。 | **保住，但只验主模式（B2）**。理由：这一档正是 Nomi 和「列一堆模型名点了才知道行不行」的产品之间真实的差别；砍成本要从「验几次」下手，不从「验多严」下手 |
| **Q1** | 「免费自检通过、还没付费烟测」的模型，要不要在画布模型框里**出现但标灰**（点了提示「还没真跑过」），还是干脆不出现？ | **不出现**，但接入卡上写「还差一次真实测试 · 去测试 →」。理由：D4 诚实交付，不让模型框出现点了会失败的东西 |
| **Q2** | 付费烟测的确认卡报不了金额（中转不给单价），只写次数与性质够不够？ | **只写次数与性质**，不让用户填任何东西（D1）。原文按「将向 <地址> 发起 N 次真实出图请求；失败也会计费」 |
| **Q3** | 自动修复默认 2 轮 × 全量回归（最坏 6 次付费出图），要不要降到 **1 轮 + 只重跑失败的模式**，把「再修一轮」做成失败页上的按钮？ | **降到 1 轮 + 只重跑失败模式**。理由：钱是他的，轮数应该是他的决定 |
| **Q4** | 「隐藏」要不要同时出现在画布模型框（D2）和设置里，还是只留一处？ | **两处都要，但只有一个语义和一个图标**：画布下拉的「整理」与设置里那个方块改成同一个眼睛图标 + 同一个词。删除仍只在设置 |
| **Q5** | 这批改动要不要跟 09-11 梳理板上的「模型框整理（记住供应商/隐藏/排序）」B7 合并成一张卡推进？ | **合并**。B7 从 06-23 记到今天没动，本次是它唯一一次有真实用户压力的时机 |

---

## 9. 证据索引（全部绝对路径可查）

- 报错抛出点：`electron/providerAdapter/verifier.ts:306`（另 4 条同族：`:238` `:337` `:369` `:370`）
- 图片配方无 query：`electron/catalog/newapiTransport.ts:68`、`:340`
- 两个消费者：`electron/catalog/catalogCommit.ts:518-520`、`electron/providerAdapter/builtinOpenAiCompatibleDraft.ts:108-133`
- 未知状态兜底成 queued：`electron/tasks/responseParsing.ts:101`、`:129-130`
- 响应体不留存：`electron/providerAdapter/verifier.ts:208`、`electron/providerAdapter/service.ts:88`
- 成本：`electron/providerAdapter/service.ts:131`（maxRepairs=2）、`:393`、`:440-441`（全量回归）、`:492-495`（模型×模式双循环）
- 发布判据：`electron/shared/modelPublication.ts:117`、`:134`、`:146`、`:176`；消费者 `src/config/modelCatalogCache.ts:151-152`
- 失败盖章：`electron/providerAdapter/serviceCatalog.ts:436-448`、`:477-490`
- 错误分类只有「上游」一个维度：`src/ui/onboarding/adapterFailureAdvice.ts`（`default` 分支）
- 隐藏能力：`electron/catalog/types.ts:262`、`electron/catalog/modelCatalogListing.ts:88`、`src/ui/onboarding/ModelEnableEditor.tsx:171-227`、`:292-294`
- 三个词：`src/i18n/locales/onboardingProviders.ts:715` `:718-719` `:722` `:724-725`
- 画布模型框无动作槽：`src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:611`、`src/design/NomiSelect.tsx:31-51`、`src/workbench/common/useDedupedModelSelect.ts:67-77`
- 免费探测已存在：`electron/ai/onboarding/modelListProbe.ts:116`、`electron/catalog/validateCandidateCredential.ts`
- 两份互相矛盾的披露：`src/i18n/locales/modelSetup.ts:88`、`:105`；`src/i18n/locales/onboardingProviders.ts:741`、`:743`
- 同族旧合同：`docs/fixes/2026-08-30-synchronous-audio-certification-boundary.root-cause.json`
- MCP 实测数字：`docs/research/2026-09-11-mcp-onboarding-defects/prior-art.md` §0
- 已登记未做：`docs/audit/redundancy-backlog.md:43`（B7）

外部（§5 实查，全部为官方文档页或源码原文）：

- Open WebUI「验证失败不代表不可用」+ 手填白名单兜底：<https://docs.openwebui.com/getting-started/quick-start/connect-a-provider/starting-with-openai-compatible/>
- Open WebUI verify 端点实现：<https://github.com/open-webui/open-webui/blob/main/backend/open_webui/routers/openai.py> · 图像侧 <https://github.com/open-webui/open-webui/blob/main/backend/open_webui/routers/images.py>
- Open WebUI Hide Model / Visible-Hidden 过滤：<https://docs.openwebui.com/features/workspace/models/>
- Cherry Studio 分模态探针 + submit-only + 15s AbortController：<https://github.com/CherryHQ/cherry-studio/blob/main/src/main/ai/AiService.ts>
- Cherry Studio `generation_cost` 跳过枚举：<https://github.com/CherryHQ/cherry-studio/blob/main/src/renderer/pages/settings/ProviderSettings/types/healthCheck.ts>
- LobeChat 连通性检查（真发 `hello`、只列 chat 模型）：<https://github.com/lobehub/lobe-chat/blob/main/src/features/Settings/provider/features/ProviderConfig/Checker.tsx>
- Cline 拉表失败静默降级：<https://github.com/cline/cline/blob/main/apps/vscode/src/core/controller/models/refreshOpenAiModels.ts> · 文档 <https://docs.cline.bot/provider-config/openai-compatible>
- Continue `OpenAI.ts listModels()`：<https://github.com/continuedev/continue/blob/main/core/llm/llms/OpenAI.ts> · 文档 <https://docs.continue.dev/customize/model-providers/top-level/openai>
- Cursor BYOK / Verify：<https://cursor.com/help/models-and-usage/api-keys>（Verify 发什么请求官方未文档化，见 §5.3）
- OpenAI List models：<https://developers.openai.com/api/docs/api-reference/models/list>
- 异步任务型媒体 API 参照：Replicate <https://replicate.com/docs/reference/http> · fal 队列 <https://fal.ai/docs/documentation/model-apis/inference/queue>

---

# 10. 实施（2026-09-11 用户拍板后）

> 上面 §8 那六条待拍板问题，用户 09-11 21:00 一次性拍完，**结论比 §6/§7 的推荐更狠**：
> 接模型只留两条路——**已适配供应商填 key 直接发布** + **AI / MCP 接入**；
> **删掉所有会花用户钱的自动逻辑**。本节记录据此真正落地了什么、什么没动、怎么回滚。

## 10.1 一句话

**在 Nomi 里，一个模型能不能在画布上用，凭的不再是「一次成功的付费真实生成」，而是一次免费自检。**
自检说清两件它真能证明的事——**地址与密钥可用**（`GET /models`）、**调用方式自洽**（形状对不对）；
它**不**声称这个模型点了一定能出片，所以模型框里如实标「未试跑」。**第一次真实生成就是试跑**，
而那一步的钱闸（提交处看报价确认）本来就在。

## 10.2 删（P1，同 commit 删干净、不留开关）

| # | 删了什么 | 落点 |
|---|---|---|
| ① | **后台自动适配的修复轮**：失败 → 叫 AI 重写说明卡 → 再发一次真实生成 → 全量回归（最坏 3 轮 × 2 模式 = 6 次付费出图） | `service.ts` 的 repair 循环、`maxRepairs` / `repairTimeoutMs` 依赖、`compiler.ts` 的 `repairProviderAdapter` 及其测试 |
| ② | **流程内的付费验证**：verifier 用真实 key 发一次真实生成 → 轮询 → 下载产物 → `certifyMediaArtifact` 验真 | `verifier.ts` 整条重写；`verifier.test.ts` / `verifierPrivateAsset.test.ts` / `textProbeBudget.test.ts` 删除 |
| ②b | 随付费提交而生的**「提交状态未知 → 需要对账」**那一族分支（`onRemoteTaskAccepted` / `reconcile` / `markUnknown` 的调用） | `service.ts`、`providerAdapterCoordinator.ts`。ledger 的 `markUnknown` / `markSubmitted` **原语保留**——只服务于本次改动之前落盘、仍停在 submitting/unknown 的历史 run 的恢复路径 |
| ③ | **「验证失败即下架」这道单向门** | `modelPublication.ts`：`meta.adapter` 存在就只认 `activeRevision` 的那条分支改成「没有 certified revision 时回落到 enabled mapping / 脚本」 |
| ④ | **手动「添加自定义模型」给未适配供应商的新建入口**：模型设置首页「其他接入方式」里的「自定义 API / 中转站」那一行，以及 AI 卡上的「或：手动接入 →」 | `ModelSettingsHome.tsx`、`AiAssistedOnboardingCard/Section.tsx`、`OnboardingDrawer.tsx`，i18n `drawer.home.customApi(+Hint)` / `assistedOnboarding.manual` |
| ②c | 文本模型的 `streamTextTask` 探针（它也是一次真实请求） | `verifier.ts`；文本与媒体现在走**同一条**免费自检（P4 通用第一，顺带删掉整段 kind 分支） |
| ⑧ | **花费确认这一整关**（2026-09-12 补删，见 §10.8）：`needs_spend_confirmation` / `awaiting_human_confirmation` / `human_confirmed` 三个 stage、签名挑战、opaque receipt、真人手势章、MCP 的 `confirm` 动作 | `integrationContract.ts` 词表、`integrationSession.ts` 的 `requestConfirmation` / `confirmFromTrustedUi` / `startConfirmedFromTrustedUi`、`integrationSpendGate.ts`（整文件）、`mcpIntegrationTools.ts` 的 `confirm`、`dispatcher.ts` 的 `integration.request_confirmation` |

**④ 的边界（保留了什么，故意的）**：
- 已适配的 13 家（`knownVendors.ts`）填 key 那条路**原样保留**——它本来就不经 `providerAdapter/service.ts`，
  走 `validateCandidateCredential` + `publishBuiltinCuratedVendor`，一直是免费的。
- `OnboardingWizard` **本身没删**：AI/MCP 会话把用户引到它这里填密钥（`integrationSessionId` 那条路），
  以及「给一条已有连接添加其他模型」仍然用它。删的是「从零手工新建一条未适配连接」这个**入口**。
- 「我已有调用脚本」（direct script draft）保留：它不填地址/模型 id 表单，也不花一分钱，
  是 §6.E 里那个「自己接」出口的真正落点。

## 10.3 改

| # | 改了什么 | 落点 |
|---|---|---|
| ⑤ | 验证 = **免费自检**：鉴权 + 拉模型列表 + 说明卡形状。过了就进模型框并标「未试跑」 | 新 `electron/providerAdapter/selfCheck.ts`；`verifier.ts` 只做编排；stage 收成 `credential` / `contract` |
| ⑤b | 失败原因拆成**正交两维**：`errorCategory`（上游怎么拒绝我们）与 `selfCheckReason`（**我们这边**缺什么）。`async_without_query` / `reference_slot_missing` / `no_channel` / `credential_rejected` / `endpoint_unreachable` 各有人话与真正走得通的下一步 | `selfCheck.ts` → `types.ts` → `onboardingBridgeTypes.ts` → `adapterFailureAdvice.ts` + `why.*` 文案 |
| ⑥ | **同步/异步是上游契约声明的事实，不是 `kind` 的常量**（类根因，见 10.4） | 新 `electron/catalog/transportDelivery.ts`；`newapiTransport.ts` 的 `NEWAPI_DELIVERY_CONTRACTS` 逐 taskKind 声明；`validator.ts` / `catalogPackageFormat.ts` / `compiler.ts` 提示词 / `desktop-local-v1.schema.json` 同步要求 |
| ⑦ | **隐藏模型**：画布模型框底部加入口，与设置里那一处**共用同一个图标（眼睛）同一个词（显示 / 隐藏）**；「启用/停用」这第三套说法废掉 | `NomiSelect.footerAction`、`useDedupedModelSelect.modelVisibilityFooterAction`、`ModelEnableEditor` 的打勾方块换成眼睛、`modelControls.*` 词表收敛 |
| F1 | 两份互相矛盾的披露（一个说「只写入本地不测试」，一个说「立即消耗额度」）统一成同一句实话 | `modelSetup.addedHint` / `integrationConfirmHint`、`onboardingProviders.saveModelsDisclosure` / `consentMessage` |
| F2 | `integrationConfirmHint` 说的「一次真实请求」是错的（实际最坏 6 次）——现在是 0 次 | 同上 |

## 10.4 类根因（schema-v3 合同）

`docs/fixes/2026-09-11-media-delivery-shape-is-a-contract.root-cause.json`，`recurring`，
把 2026-08-30 那份音频合同的边界从「音频字节 vs JSON 任务」扩到**全部媒体类型**：

> 交付形状（同步 / 异步）由**上游契约**声明，不由 `kind` 推断；
> 声明成异步就必须同时交出查询端点（query + statusMapping）与一份「任务不要了怎么办」的处置
> （取消端点 / 轮询到底）——**没有第三种叫「丢掉」**。

`invariant_owner_layer` = **传输配方派生层**（`electron/catalog/transportDelivery.ts` + `newapiTransport.ts`），
不是 verifier——verifier 只是发现者。防线钉在最早能拦住的那层（R28）：
`assertTransportDeliveryContract` 在**模块加载时**跑，新加一格异步却忘了 query，进程直接起不住。

**诚实标注**：new-api 的公开契约（doc.newapi.pro / newapi.ai）只给了 create 与 query，**没有取消端点**。
编一个出来违反 R5/R31，所以视频那格的处置声明是 `poll-to-completion`，不是伪造的 cancel op。

## 10.5 验收

- **单测**：`modelPublication.test.ts` 的「自检失败不下架」回归钉子（**已变异验证**：回退生产代码 → 2 条红）；
  `selfCheck.test.ts` 14 条（含「异步中转 + 我们缺 query」夹具，并断言**一次请求都没发**）；
  `transportDelivery.test.ts` 6 条（异步缺 query / 缺 statusMapping / 缺任务处置逐条会红）。
- **零额度台架**：`relayConformance*.integration.test.ts` 两份**没有删、改指向了生产路径**——
  R-A…R-D 四条真机拒绝规则原来挂在付费探针上，现在挂在 `executeProfileOperation` /
  `buildProfileTaskResult` / `certifyMediaArtifact` 这三块生产原语上，**一条断言没少**，
  因为那次真实请求现在发生在用户第一次生成，抓就要抓在它真正发生的地方。
- **不花真实额度**：全程零付费请求。

## 10.6 不动项

- ComfyUI 候选那条本地、免费的真实产物校验（`comfyuiCandidateLifecycle.ts`，stage 仍是 `verify_asset`）。
- 已适配供应商填 key 直接发布那条路（`validateCandidateCredential` / `directKeyCredential`）。
- `Model.enabled` 作为画布模型框唯一闸门的语义（`modelCatalogListing` / `modelCatalogCache`）。
- 梳理板 B7 的**排序 / 记住供应商**另起一张卡；本 PR 只做隐藏入口。
- 同期 `feat/agent-tool-face-single-owner-20260911` 在改 `electron/shared/agentCapabilities/`，本 PR 不碰模型工具面。

## 10.7 回滚

三块互相独立，可分别回滚：
1. 发布判据（③）：`modelPublication.ts` 的分支改回「adapter 存在即只认 activeRevision」，回归钉子会红——**那正是它存在的意义**。
2. 交付契约（⑥）：删掉 `transportDelivery.ts` 的断言调用，配方退回按 kind 发 query。
3. 自检（②⑤）：`verifier.ts` 恢复付费路径需要连带恢复 `reconcile` / `onRemoteTaskAccepted` 与 ledger 的
   unknown 分支——**刻意做成不可半途回滚**，因为「一半付费一半免费」正是两套并行版（P1）。

## 10.8 补删：花费确认那一关（2026-09-12）

**为什么它还在**：§10.2 ② 删掉了「付费真实生成」，但**授权那次付费的那道闸**没跟着删。
于是留下一道**守着已经不存在的钱**的关卡——而它偏偏又是整条路上唯一走不通的一段。

**它坏在哪（2026-09-12 真实验收 §P0-1，Codex CLI + DeepSeek 官方 key，真机）**：
`propose` 之后会话进 `needs_spend_confirmation`，而这一关唯一的出口
`startConfirmedFromTrustedUi()` 第一行就是 `if (session.ownerClientId !== "nomi") throw`。
外部宿主的会话 owner 是 `codex` —— **永远出不来**。实测里 agent 连问三回合「卡在哪」，
只能如实说「没有可执行的确认句柄」；Nomi 窗口里一张确认卡也没弹（`pendingChallengeId: null`）。

**用户拍板（2026-09-12）**：接模型**没有付费验证**，因此**任何路径都没有花费确认**。
钱的闸只有一处——画布每次提交时的报价卡（memory `money-gate-per-submit-no-budget-setting`）。

**删完之后的形状**：那三档合并成一个只有机器语义的 `ready_to_certify`（方案收下了、自检还没开跑）。
它**不是**换了名字的旧闸——旧闸要挑战+收据+真人手势才走得出去，新档谁拥有会话谁就能直接 `start`。

**Nomi 窗口里那个按钮留着，但换了真名**：模型页仍会弹一屏让用户亲手开跑，因为那是他从
「贴完 key」到「模型出现了」之间唯一看得见的反馈（§P1-4 抱怨的正是没有反馈）。
它现在叫「开始自检」而不是「确认」——**这是一个开始检查的动作，不是一个批准花钱的动作**。
词条名一并退役：`integrationConfirm*` / `integrationSpendWarning` → `integrationSelfCheck*`。
交接单只发给 `nomi` 自己拥有的会话：给外部会话也发，等于在 Nomi 里放一个按下去必然
`integration_owner_mismatch` 的按钮。

**旧盘上的会话**：读盘时一次性改写成 `ready_to_certify` 并丢掉收据/挑战字段
（`integrationSessionRecord.migrateRetiredSpendGate`）。被那条死路卡住的人升级后直接被放出来，
不必重来一遍。故意**不**写成「不在现役词表里就改写」——那会把 stage 打错字的损坏记录一起洗白。

**验收**：`mcpOnboardingDefects.test.ts` 的「缺陷 1」三条改成钉「它真的没了」
（外部宿主 propose → start 一路到底 / 词表里再没有带 confirm 的阶段 / 旧盘会话被放出来）；
`mcpOnboardingLoopback.test.ts` 的 R30 零额度台架少掉 confirm 那几步后仍走完全程。
