待协调定：目录 / 概念口径命中之外，`catalogStore.ts`、`types.ts` 文件本身命中（各已 2 个 fix），不在代批例外里。

# 方向检查：模型能力一处声明（2026-11-22）

触发（`scripts/fix-churn.mjs` 的 `findHotspots` 对这一刀改到的文件，当日实数）：
- 目录级：`electron/agentLane/` 近 14 天已有 5 个 fix（3 个文件算同一概念），这一刀是第 6 个；`electron/ai/` 已有 6 个 fix（2 个文件），这一刀是第 7 个。
- 文件级：`electron/catalog/catalogStore.ts`、`electron/catalog/types.ts` 各已有 2 个 fix，这一刀是第 3 个。
- 概念级：「Agent 输入里被选中的媒体引用必须解析到项目素材原身份」（因 `agentUserContent.ts` 命中）、「凭据「存了」与「可用」的分层」（因 `catalogStore.ts` 命中）。

这一刀是 `refactor`，不是再补一刀：同提交删掉 `electron/ai/modelProfiles.ts`（连同测试）与运行时对 `PDF_INPUT_MODEL_RE` 的直接读取，不加供应商 / 模型名分支，不留开关、不留回退。设计卡：`docs/plan/2026-11-22-model-meta-declaration.md`。

**这一处的全图在哪**：设计卡 ★2「谁说了算」的写入方普查与读取方表；交接处表外。

### 0. 一句话根因

「这个文本模型要怎么发请求」（协议、温度、`enable_thinking`、能不能原样收 PDF）没有一个按行声明的地方，运行时在两处按模型名猜，于是每接一个怪模型都要改运行时，名字一换（中转起别名）怪癖就丢。

### 1. 归类表：命中计数里的 fix → 直接原因 → 类

| 提交 | 碰到本刀的哪个文件 | 类 |
|---|---|---|
| e7acb6480 收口模型可用状态 | `catalogStore.ts` | 模型「可用」状态的家，和请求怎么发无关 |
| 7edc48c68 外部 Agent 交卡后走到确认 | `catalogStore.ts`、`types.ts` | 声明卡写目录与凭据回来，和请求怎么发无关 |
| c83694a96 第三方公共临时托管只由设置决定 | `types.ts` | 设置字段，无关 |
| d17abc78f、2b428cee1、67be4fc91（`agentLane/`） | 无（`laneHost.mts`、`laneInputIntent.mts`、`laneModelContext.ts`） | 芯片 / 草稿 / 默认模型，无关 |
| 5e7ac998f、47471b1fe（`ai/`） | 无（`modelImageInput.ts`、`textBrainResolver.ts`） | 出站测试、读图后备，无关 |

命中是目录 / 文件里别的类凑的数；「按名字猜请求怎么发」这一类 14 天内没有 fix。

### 2. 为什么这一类会一直出现

能力住在运行时的名字表里，不住在模型行上：写入方（种子、用户加模型、声明卡、导入）没有地方写，读取方只能按名字猜。铁律 ⑩ ⑪ ⑫ 不适用（不涉及意图参数、可选项、点击预期）。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 中转把 `o1-mini` 起别名为 `my-o`，温度 1 的怪癖丢、请求被上游拒 | 设计卡 ★9 反例 ⑤c；`electron/catalog/modelDeclarationFunnel.test.ts` |
| 新的 Claude / Gemini 型号名字不在 PDF 正则里，PDF 被转成文字 | 反例 ③；`electron/agentLane/laneModelDeclaration.test.ts` |

### 4. 靶子独立性检查

对拍的基准是今天主线的请求原始字节（`tests/fixtures/model-request-parity/requests.json`，在改动前录下），不是这条线写的期望值；老用户数据用旧版本自己的函数生成（`tests/fixtures/old-user-data/text-quirks/`）。

### 5. P0：这些是我们独有的吗

声明的形状不自写：`reasoning` / `thinkingLevelMap` / `compat` 原样用 pi-ai 的模型字段；数据修正照现有 `migrateCatalogForward` 尾部收据做法。自己写的只有「哪一行、发给哪家」这一层（目录是领域）。

### 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 同一类还会不会出现 | 风险 | 推荐 |
|---|---|---|---|---|---|
| 沿原方向修 | 名字表 / 正则再加条目 | 每接一个模型改一次运行时 | 会，从下一个怪模型名、下一个别名出现 | 低 | 否 |
| 换一种做法 | 行上声明（pi-ai 形状），运行时只读声明；名字表降为写入时的初值 | 一次性数据修正 + 写入口普查 | 不会从运行时出现；只剩「写入时初值对不对」，由初值测试与漏斗测试守 | 写入口漏一处 | 选 |
| 删掉 | 直接删名字表与 PDF 正则 | 老用户 o1 / o3 / kimi-k2 的温度与 `enable_thinking` 丢，PDF 被转文字 | 不适用 | 老用户请求被上游拒 | 否 |

### 7. 用户要权衡的核心

没有要用户权衡的：内置行请求体一字不差，老用户的怪癖按旧名单写成初值留在行上，这一刀创作者看不出变化。

## 特征测试清单（动结构前先锁住）

- `electron/agentLane/modelRequestParity.test.ts`：82 行（34 内置 + 48 老用户）× 调用方，对拍主线录下的原始请求。
- `electron/catalog/modelDeclarationOldUser.test.ts`：v0.24.0 / v0.24.1 真实旧数据跑一次性修正后的声明。
