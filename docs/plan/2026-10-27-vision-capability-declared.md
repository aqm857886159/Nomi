# 设计卡：能不能读图只认声明，不再按名字猜

```
改动名：读图能力三态（能 / 不能 / 不知道）   线/负责人：I-vision-capability（Mac，Claude）   类别：[其他]
```

方向检查（只因目录 / 概念口径命中、改法是换）：`docs/engineering/direction-checks/2026-10-27-vision-capability-declared.md`。

起因：用户截图——配了能读图的模型，Agent 回「我这边读不到图片画面内容（只能读到文件本身）」。现状（基线 `6c05eebae`）：`electron/ai/agentUserContent.ts:37-41` 的 `modelSupportsImageInput` 没有 `meta.supportsImageInput` 时拿模型名去撞 `VISION_MODEL_RE`（`:22-23`）；GPT-5 以后、Claude 5、Grok 4、GLM-4.5V、豆包 Seed 和用户自起的名字（`my-gpt`）都撞不上 → 判「不能」→ 图在 `:97-101` 被丢掉，只在发给模型的话里附一句注（`:115-117`）。自配 / 中转行没有地方声明能力，名字正则就是它们唯一的判据。

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [x] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | **当**我（接了自配 / 中转文本模型的创作者）在 Agent 面板附一张图问「图里有什么 / 照这个构图写分镜」**我想**模型真的收到这张图，**以便**它按图回答，而不是说读不到。步骤：① 接入页手填模型 id（如 `my-gpt`，OpenAI 兼容中转）；② Agent 面板选它；③ 附图（素材库 / @ 引用）；④ 发送；⑤ Nomi 把图作为 image part 发出；⑥ 模型按图答，或后端明确拒图 → 走现有 Agent 错误面。**不做**：不加「能读图」开关、不加附件状态、不改接入页；不改 pi 模型描述 `input`（`laneModelProvider.mts`）、不接 OpenRouter `input_modalities`；不扩名字正则、不加模型名特例；`PDF_INPUT_MODEL_RE` 不动。**已知坑**：① 「不知道」照发后，若中转静默丢图，模型仍会说读不到，界面无提示（下一版附件状态）；② 拆解读图下拉仍只隐去显式 false，内置未声明的纯文本行（deepseek 等）还在下拉里，点名后主进程开拆前拒（零报价）——要让下拉也读三态得改 IPC 形状，下一版；③ 已退役、不在 curated 表里的旧种子行（如 `deepseek-v3.2-think`）算「不知道」；④ 真纯文本的自配模型收到图：后端报错走现有错误面，或模型自己说看不到。**真实任务**：T1 用户截图那一单——自配 OpenAI 兼容中转 + 自起名模型，Agent 面板附一张照片问「图里有什么」；T2 默认大脑 APIMart `deepseek-v4-pro`（种子、纯文本）+ 附图：丢图并附注，模型如实说看不到、建议换模型；T3 分镜表底栏把读图模型点名成显式不能读图 / 内置纯文本行 → 开拆前拒，零报价零调用。**指标**（目标 → 信号 → 指标 · 量具）：主指标「附的图到达能力未声明的模型」→ 请求体里有 image part → 未声明自配行（含撞不上旧正则的名字）附图后请求体含 image part 的比例，基线 0% → 目标 100%，量具 `electron/agentLane/laneImageInputLoopback.test.ts`（本机回环录请求体，三种协议）+ `electron/ai/agentUserContent.test.ts` 名字矩阵；质量指标「声明不能的行（显式 false / 内置种子未声明）丢图并附注」比例，基线 100% → 目标 100%，量具同上 + 种子矩阵（`applyBuiltinSeeds` 真目录逐行）；护栏①「拆解点名不能的读图模型：零报价零调用拒」比例，基线 0% → 目标 100%，量具 `electron/video/deconstructVisionLeg.test.ts`；护栏②「判定与模型名无关」（同一声明换任何名字结论不变），量具名字矩阵；真实核对（2026-10-28 付费 1 次，APIMart 手填 `gpt-5-mini`，读图能力判为「不知道」档）：两轮的图都送到了模型。第 1 轮暗号 `NOMI 4862` 答成 `NOMI 4362`：前缀和 4 位里 3 位对，点阵字的 8 读成了 3，瞎猜做到的概率约 0.71%；当时的量具要求全对，所以判红，之后已改成「前缀对且至少 3 位对」。第 2 轮 3840×2160 的 16 位 PNG（29,703,774 字节）整份送达并被接受，回答准确描述了画面。证据：`docs/evidence/2026-10-27-vision-capability-declared/paid/report.json`（原样保留量具判红的那一版）。 | 特征测试（先红）/ 回环录请求体 / 协调真实核对 |
| ★1b 连带界面 | 不新增文案。① Agent 回话：丢图注原文不变（「N 张图片未发送——当前模型不支持图片输入或读取失败…」），只是「不知道」的行不再触发它；② 拆解错误：点名「不能」走现有 `deconstruct.visionModelUnavailable`（中英都有），`detail` 用稳定英文签名 `Model does not accept image input: <modelKey>`（与同句其它 detail 同为英文技术签名）；③ 自动挑只剩「不能」走现有「还没有能读图的文本模型…」句（现状只有中文，在 `deconstructVideo.ts`——该文件本身是热点，本线不碰，记残余） | `deconstructVisionLeg.test.ts` |
| ★2 谁说了算 | 新登记概念 `catalog.model-image-input`（「这一行能不能读图」三态判据），唯一 owner `electron/ai/agentUserContent.ts::modelImageInputSupport`（由 `modelSupportsImageInput` 换来）。事实两份、各有主：`meta.supportsImageInput`（目录行声明：种子由 `seedBuiltins` 对账写入，Antigravity 由能力验证写入）；「是不是种子行」= `builtinCatalogModelKeys(vendorKey).has(modelKey)`（概念 `catalog.builtin-seeding` 的现成读口，按**这一行**的身份，不按 vendor 是不是内置；`certificationOwnership.ts` 已用同一读口，且写明 meta 渲染层写得动、不能拿来判身份）。判定：布尔声明 = 它；没声明的种子行 = 不能（内置能读图的行都已声明 true：APIMart `gemini-3.5-flash`、Agnes 五个、MiniMax-M3，`applyBuiltinSeeds` 实测）；其余没声明（自配、中转、本地、兄弟连接、内置 vendor 下自加的行）= 不知道。门表见下，6 扇，与调研报告一致；全部改读同一个三态，不留第二份。不靠「东西不见了」猜意图。 | `node scripts/door-map.mjs modelSupportsImageInput`（3 扇写入口）+ `git grep supportsImageInput / imageInputRank / droppedImages` |
| ★3 一致与复用 | 复用 `builtinCatalogModelKeys`（不新写种子判据）、`metaFlag`；三态命名沿用 `RemoteIdempotencyCapability = "supported" \| "unsupported" \| "unknown"`（`electron/integrationCertification/types.ts:19`）；拆解拒绝复用现有 `requested-unavailable` + `deconstruct.visionModelUnavailable`，不新增文案键；`buildAgentUserContent` 收三态而不是布尔，调用方拿不到「自己算的布尔」可传。 | `git grep -n builtinCatalogModelKeys` / `git grep -n RemoteIdempotencyCapability` |
| ★4 全状态 | Agent 附图：能 → 发图；不知道 → 发图（后端决定）；不能 → 丢图 + 现有注；字节读不到 → 丢图 + 现有注（不变）；后端拒图 → 现有 Agent 错误面；后端静默忽略 → 模型可能说看不到（已知坑①）。拆解读图腿：点名能 / 不知道 → 照拆；点名不能 → 开拆前拒（零报价零调用，下一步「在分镜表底栏换一个读图模型」）；软偏好不能 → 回到自动；自动挑到的第一名都是「不能」→ 「还没有能读图的文本模型…去接入模型」（零报价）。空 / 加载 / 取消中 / 过期：不变（不加异步、不加界面）。能力不可用：即上面两条拒绝，都带下一步。文案不写钱。 | 特征测试 |
| ★9 验收与回滚 | 见下「验收清单与反例」（动手前写全）。**回滚**：revert 实现提交即回到按名字猜（无落盘形状变化、无迁移）。**真实核对**：2026-10-28 已付费 1 次核对（APIMart 手填 `gpt-5-mini`，读图能力「不知道」档）：两轮图片都送达；第 1 轮 `NOMI 4862` → `NOMI 4362`（前缀和 4 位里 3 位对，概率约 0.71%，旧量具因要求全对判红，现已改为前缀对且至少 3 位对）；第 2 轮 3840×2160、16 位 PNG、29,703,774 字节整份送达并被接受，回答准确描述画面。证据：`docs/evidence/2026-10-27-vision-capability-declared/paid/report.json`（原样保留旧量具判红版本）。独立验收：非四类，不强制，协调派则按本清单核。硬门对账：⑩ 不适用（不碰意图 → 草稿参数）；⑪ 能选到：拆解读图下拉与主进程判据只对齐「显式 false」那段（已知坑②，要改 IPC，下一版）；⑫ 不适用（无新可点目标）。 | 本卡 / PR 正文 |

## 门表（判「能不能看图」的全部入口）

| # | 门 | 位置（基线） | 本线怎么改 |
|---|---|---|---|
| 1 | 判据 owner | `electron/ai/agentUserContent.ts:21-41` `modelSupportsImageInput` + `VISION_MODEL_RE` | 换成三态 `modelImageInputSupport(model)`，只认声明；同提交删 `VISION_MODEL_RE`，不留回退 |
| 2 | Agent 车道 | `electron/agentLane/laneDesktopInput.ts:92` → `buildAgentUserContent`（丢图在 `agentUserContent.ts:97-101`） | 传三态；只「不能」丢图并附注；读不到字节照旧附注 |
| 3 | 文本大脑选型 | `electron/ai/textBrainResolver.ts:16-18,160-161` `imageInputRank` | 排序改成 能 > 不知道 > 不能 |
| 4 | 视频拆解解析 | `electron/video/deconstructVisionLeg.ts:31-51` `resolveVisionLeg` | `requested` 和 `preferred` 用同一个判据核能力：`requested`「不能」→ `requested-unavailable`；`preferred`「不能」才跳过；自动挑到的第一名是「不能」= 没有读图模型（`no-vision-model`） |
| 5 | 拆解下拉 | `src/workbench/generationCanvas/nodes/shotTable/deconstructLegChoice.ts:28`（`!== false`） | 不改。核对：它只隐去显式 false，即只隐去主进程也判「不能」的那一段，不会藏掉主进程会接受的行；内置未声明行仍显示（已知坑②） |
| 6 | 拆解发送 | `electron/textTaskRunner.ts:71-76,103-104`（`image_to_prompt` 无条件发图） | 不改：它不判能力，靠上游；拆解经门 4。画布文本节点带参考图（`catalogTaskResolve.ts:303`）、浏览器「画面复刻」（`browserPromptExtractionRunner.ts:94`）也走这扇门、都不判能力，不是新门 |

不是门（核过）：`textBrainResolver.ts:11` 的 `AUTO_TEXT_MODEL_DEPRIORITIZE` 名字正则管的是「无偏好时像不像通用对话模型」（工具调用可靠性），不判读图；`tests/ux/shot-table-vision-leg.paid.mjs:66` 是付费走查给自己挑模型的名字正则（测试夹具，付费跑不了，不改，记残余）；Antigravity 的 `supportsImageInput: passed("vision")` 是声明来源，不是判据。

## 验收清单与反例（★9，动手前写全；实现线按它自验，验收线只核它）

实现线自验附「反例 → 结果 → 证据」表。所有用例零花费、不出网（回环 127.0.0.1）。

**验收项**

| # | 场景 | 期望 | 量具 |
|---|---|---|---|
| A1 | 自配 OpenAI 兼容 vendor 下 `my-gpt`，`meta` 无声明，附 1 张图 | 发给 pi 的内容含 image part；回环录下的请求体含图（openai-compatible `image_url` data URI / responses `input_image` / anthropic `image` base64，三种协议都在） | `laneImageInputLoopback.test.ts`（改前红） |
| A2 | 内置 APIMart `deepseek-v4-pro`（种子行，没声明），附图 | 不发图；文本含「张图片未发送」注；素材原身份清单仍在 | 同上 |
| A3 | 自配行显式 `supportsImageInput: true` / `false` | true 发图；false 丢图 + 注 | 同上 + `agentUserContent.test.ts` |
| A4 | 「不知道」的行但字节读不到 | 丢图 + 「读取失败」注（不变） | `agentUserContent.test.ts` |
| A5 | 内置 vendor `apimart` 下用户自加的行（如 `gpt-5.5`，不在 curated 表），没声明 | 「不知道」→ 发图（按行判，不按 vendor 判） | 同 A1（改前红） |
| A6 | 内置家的兄弟连接 `apimart--mini` 下的 `deepseek-v4-pro`，没声明 | 「不知道」（它是用户这条连接拉来的行，不是种子行） | `agentUserContent.test.ts` 矩阵 |
| A7 | 判定与名字无关：`gpt-4o`、`claude-3-5-sonnet`、`gemini-2.0-flash`、`llava-v1.6`、`qwen2.5-vl`、`grok-4-vision`、`my-gpt`、`deepseek-chat`，在自配 vendor 下没声明 | 一律「不知道」；同一名字显式 true / false 一律照声明；声明值不是布尔（如字符串 `"true"`）按没声明 | `agentUserContent.test.ts` 名字矩阵 |
| A8 | `applyBuiltinSeeds` 真目录的每一条 text 行 | 没有一条是「不知道」；「能」⇔ 显式 true；至少含 `gemini-3.5-flash`、Agnes 五个、`MiniMax-M3` | `agentUserContent.test.ts` 种子矩阵 |
| A9 | 带图选型（`preferImageInput`）：同一家里依次放 内置未声明（不能）、自配未声明（不知道）、显式 true（能） | 顺序 能 → 不知道 → 不能；无偏好时排序不变；用户偏好仍优先 | `textBrainResolver.test.ts`（改前红） |
| A10 | 拆解 `requested` 指向显式 false 的行 / 内置纯文本种子行 | `requested-unavailable`，detail `Model does not accept image input: …`；零报价、零 `runTask` | `deconstructVisionLeg.test.ts`（改前红） |
| A11 | 拆解 `requested` 指向「不知道」的自配行 | 接受，报价与每次调用都用它 | 同上 |
| A12 | 拆解 `preferred` 是「不知道」的自配行 / 显式 false 的行 | 「不知道」采用（改前红）；「不能」回到自动 | 同上 |
| A13 | 拆解自动挑，目录里只剩「不能」的 text 行 | `no-vision-model`：零报价、零调用 | 同上（改前红） |
| A14 | 名字正则删干净 | `electron/`、`src/` 里不再定义 `VISION_MODEL_RE`、`modelSupportsImageInput`；概念登记把两者列为禁止的旧形状 | `git grep` + `check:concept-owners` |
| A15 | PDF 判据不动 | `modelSupportsPdfInput` 原测试原样绿 | `agentUserContent.test.ts` |
| A16 | 拆解下拉不改 | `deconstructLegChoice.ts` 无 diff | `git diff --stat` |

**反例（这一类会从哪回来）→ 应当变红的格**

| # | 反例（变异） | 必红的格 |
|---|---|---|
| X1 | 把名字正则放回去当主判据（没声明 → 撞 `VISION_MODEL_RE`） | A1 `my-gpt`、A5、A7 |
| X2 | 按 vendor 判种子（`builtinVendorSeed(vendorKey)` 存在就算种子） | A5 |
| X3 | 「不知道」当「不能」（只有显式 true 才发图） | A1、A5、A12 |
| X4 | 选型把「不知道」和「能」并列 / 和「不能」并列 | A9 |
| X5 | 拆解 `requested` 不核能力（现状） | A10 |
| X6 | 按 meta 字段判种子（如 `meta.catalogLifecycle` 在就算种子——渲染层写得动） | A7 里带 `catalogLifecycle` 的自配行一格 |
| X7 | `buildAgentUserContent` 退回收布尔、调用方自己算 | typecheck 红（参数类型是三态） |

这一类会从哪些入口 / 形状 / 边界 / 版本回来：入口——Agent 车道、选型、拆解三条腿（门 2/3/4）；形状——`meta.supportsImageInput` 为 true / false / 缺席 / 非布尔；边界——种子行 / 自配行 / 内置 vendor 下自加行 / 兄弟连接 / 已退役旧种子；版本——老装机的 Agnes 行由种子对账补上 true（`seedBuiltins.test.ts` 既有用例），Antigravity 行由验证写死 true / false。
