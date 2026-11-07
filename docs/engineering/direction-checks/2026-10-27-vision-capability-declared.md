协调代批（10-27）：只因目录口径命中、改法是换

# 方向检查：读图能力只认声明（2026-10-27）

触发（`node scripts/fix-churn.mjs` 当日实数）：
- 目录级：`electron/ai/` 近 14 天已有 4 个 fix，这一刀是第 5 个（`agentUserContent.ts`、`textBrainResolver.ts` 本身各 0 个）；`electron/video/` 近 14 天已有 6 个 fix，这一刀是第 7 个（`deconstructVisionLeg.ts` 本身 0 个）。`electron/agentLane/laneDesktopInput.ts` 没命中。
- 概念级：「Agent 输入里被选中的媒体引用必须解析到项目素材原身份」（含 `agentUserContent.ts::buildAgentUserContent`）近 14 天已有 6 个 fix，这一刀是第 7 个。
- 文件本身都没命中。`electron/video/deconstructVideo.ts` 文件本身是热点（14 天 3 个 fix），本线**不碰它**；`electron/desktopStrings.ts#deconstruct` 词典键已 2 个 fix，本线**不加新键**，拒绝文案复用现有 `deconstruct.visionModelUnavailable`。

改法是**换 + 删**：「按名字猜能不能读图」换成「只认声明的三态」，同一提交删掉 `VISION_MODEL_RE`；不加供应商 / 模型名分支，不留开关、不留回退。

## 0. 一句话根因

「这个文本模型能不能读图」没有一个只认声明的判据：没声明的行一律交给一条写死的名字正则，于是任何名字不在正则里的模型（新型号、用户自起名的中转模型）都被判成不能读图，图在发出前被静默丢掉。

## 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 本单：用户配了能读图的模型，Agent 说读不到图片 | `my-gpt` 一类名字撞不上 `VISION_MODEL_RE` → 判不能 → `agentUserContent.ts:97-101` 丢图 | 能力判据靠名字猜，未声明 = 不能 |
| 同类：GPT-5 以后、Claude 5、Grok 4、GLM-4.5V、豆包 Seed | 同上：正则永远追不上新型号 | 同上 |
| 同类潜伏：拆解点名纯文本模型照样发帧 | `resolveVisionLeg` 的 `requested` 不核能力 | 同一判据没有覆盖全部门 |

## 2. 为什么这一类会一直出现

判据把「不知道」折叠成了「不能」：自配 / 中转行没有地方声明能力（接入页只能改 kind），名字就成了唯一判据，而名字是用户和中转站随意起的。只要判据里还有「名字 → 能力」这一步，每出一个新型号就要补一次正则（方案 A），正则补不全的那部分用户就静默丢图。类级修复：判据只看声明，三态表达「不知道」，由每扇门按自己的语义处理「不知道」（Agent 照发、选型排中间、拆解只拒「不能」）。

| 铁律 | 结论 | 最小证据 |
|---|---|---|
| ⑩ 说的=摆的 | 不适用：不碰意图 → 草稿参数 | — |
| ⑪ 能选到 | 部分适用：拆解读图下拉只隐去显式 false，与主进程判据只在「显式 false」段对齐；内置未声明行仍在下拉里、点名后开拆前拒。让下拉读三态要改 IPC 形状，下一版 | `deconstructVisionLeg.test.ts` 点名拒绝格 |
| ⑫ 点了=以为的 | 适用：用户附图发出 = 以为模型收到了图；修后「不知道」的行图真的进请求体，「不能」的行附注说明 | `laneImageInputLoopback.test.ts` 回环请求体 |

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 下一个新型号（任何不含正则片段的名字）接进来，附图照样被丢 | 名字矩阵：自配 vendor 下没声明的任何名字都应发图（`agentUserContent.test.ts`） |
| 有人为某个模型名加特例 / 扩正则，修好一个、漏掉下一个 | `VISION_MODEL_RE` / `modelSupportsImageInput` 列为禁止的旧形状（`check:concept-owners`） |
| 拆解点名纯文本模型后付费、每镜失败 | `deconstructVisionLeg.test.ts` 点名「不能」零报价零调用 |

## 4. 靶子独立性检查

尺子是行为测试：回环请求体（真 pi-ai、真 HTTP）+ 种子矩阵（真 `applyBuiltinSeeds` 目录），不读被测函数的实现。反例变异（正则放回、按 vendor 判种子）必须让对应格变红，实现线在报告里给红绿。

## 5. P0：这些是我们独有的吗

「模型能不能收图」是通用能力描述：pi-ai 有 `Model.input`，OpenRouter 有 `architecture.input_modalities`。本线不自写能力发现，只删掉自写的名字猜测，保留「目录行声明」这一种来源；接 pi `input` 与 OpenRouter 模态是下一版（任务书拍板）。「是不是种子行」复用现成读口 `builtinCatalogModelKeys`，不新写判据。

## 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 接 pi `Model.input` / OpenRouter `input_modalities` 作为声明来源 | 要改 `NomiModelConfig`、接入页、IPC | 普通中转 `/v1/models` 只给 id，仍是「不知道」；本版不做 | 下一版 |
| 补 | 扩名字正则 | 小 | 永远追不上新型号、别名误命中 | 否 |
| 重写（限一个模块） | 判据换成只认声明的三态，门 2/3/4 改读同一个三态 | 4 个生产文件 | 「不知道」照发后，真纯文本模型的后端报错 / 静默忽略 | **是**（本线） |
| 删 | 删掉名字正则 | 同上一行同提交 | 同上 | **是**（与重写同提交） |

## 7. 用户要权衡的核心

没声明能力的自配模型，是「先照发，让真后端说话」，还是「先当不能，静默丢图」；本线选前者（协调拍板）。

## 特征测试清单（动结构前先锁住）

- `electron/agentLane/laneImageInputLoopback.test.ts`：Agent 车道真门（`createDesktopLaneInput().providerContent`）→ 真 pi `callModelOnce` → 本机回环录请求体；改前 `my-gpt`、内置 vendor 下自加行两格红，内置种子 / 显式声明格绿。
- `electron/ai/textBrainResolver.test.ts`：带图选型 能 > 不知道 > 不能；改前红。
- `electron/video/deconstructVisionLeg.test.ts`：`requested` 显式 false / 内置纯文本 → 拒；`preferred` 不知道 → 采用；自动挑只剩「不能」→ 没有读图模型；改前红。
- 结账挂的类检查：`electron/ai/agentUserContent.test.ts` 的名字矩阵 + 种子矩阵（从 `applyBuiltinSeeds` 真目录取数）。
