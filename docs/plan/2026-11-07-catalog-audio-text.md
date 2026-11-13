# Current audio and text catalog declarations

类别：[花钱][其他]；声明更新，不新增运行时通道，不改界面布局。

## ★0 先查别人

- https://docs.apimart.ai/en/api-reference/audios/suno/generation.md · 官方用 model=suno 与 version 区分 V6/Wild/Mini，普通灵感模式只需 prompt/instrumental · 确认三个精确身份独立加入，不改旧节点 key。
- https://docs.apimart.ai/en/api-reference/audios/suno/sounds.md · 官方 wire 字段是 type/bpm/key，版本共享 music task 结果 · 改变旧声音模板的字段名，保留已有 canonical 参数名以兼容存量。
- https://docs.apimart.ai/en/api-reference/texts/general/chat-completions.md · 全部文本生成模型复用 Chat Completions、messages/tools/stream · 确认仅更新模型声明，不增加供应商运行时分支。
- https://docs.apimart.ai/en/api-reference/audios/tts.md · 同步二进制 speech 仍使用 gpt-4o-mini-tts · 确认保留现有声音节点与未知价格。
- `electron/catalog/seedModelIdentity.ts` 的 `curatedCatalogLifecycle`（读口 `src/workbench/common/useDedupedModelSelect.ts` 把 legacy 标成 `more`，`src/design/NomiSelect.tsx` 把它收进「更多」、已选中的仍显示；Agent 的模型清单不读它）· legacy 只是「收进更多 + 排最后」，不删执行记录 · 用它表达「比上一代更老」，不新造机制。

## ★1 用户怎么用

当创作者打开旧作品时，原节点保留已选型号与配置；新节点能选择各子线当前型号。上游已下线的型号要换为可用型号才能重新生成。
步骤：打开作品 → 保留原节点 → 新节点选最新或上一代型号 → 设置已有参数 → 查看报价状态 → 确认生成 → 原结果收口。
真实任务目标：新节点能选 Suno V6 三档（APIMart 的 V5.5 已被上游下线，见下）；新 V6 音效 one-shot/loop 与 BPM/调性正确发送；各家大脑执行同一 Chat 请求。
主指标：新增声明请求逐字段匹配率 100%，量具 `electron/catalog/apimartLatestContracts.test.ts`。
质量指标：旧目录已发布模式保留率 100%，量具 `electron/catalog/upgradeKeepsWorkingModels.test.ts` 与新增旧目录回放。
实施线只用免费回环和请求预览。协调此前的真供应商抽检记录见 §8 和「一问一个结果」；本轮复核新增付费调用为零。
已知缺口：生成价格只存在于 Model.pricing，当前 curated 音频投影不接受该字段；本任务禁止修改 seedBuiltins，不能把已知官方价冒充已接入产品报价。文本分档价现有单价结构无法精确表示，保守使用最高档并在来源与报告说明。

### ★1b 连带界面

复用模型选择器、参数面板、付费确认、任务失败与结果显示；只更新模型标签/声明，不新增状态文案。

### 旧代规则（用户 2026-11-07 原话：「最新代和旧一代的都可以接」，覆盖原先「旧代不再新增」）

每个模型家族的**最新一代和上一代**都对新节点可用（lifecycle 不是 `legacy`：最新 = 旗舰 / 性价比，上一代 = 陪跑或性价比）；**比上一代更老**的才是 `legacy`（收进「更多」、排最后）。旧项目里已选的任何一代照常显示、照常执行，不改旧项目的模型 key。

| 家族 | 最新 | 上一代 | 更老 |
|---|---|---|---|
| Suno 音乐 | v6 / v6-wild / v6-mini | v5.5 | 目录里没有 |
| Suno 音效 | sounds v6 三档 | sounds v5.5 | 目录里没有 |
| DeepSeek Flash | V4.1 Flash | V4 Flash | V3.1 Terminus |
| Gemini Flash | 3.8 Flash | 3.5 Flash | 目录里没有 |
| 其余大脑 | 目录只声明了最新一代 | 未声明（不是被藏） | — |

契约：`tests/fixtures/apimart/model-generations.json` 登记每个家族的最新 / 上一代 / 更老，`apimartLatestContracts.test.ts` 断言最新和上一代都不是 `legacy`、更老的才是；每个已声明的音频 / 文本模型都必须登记进这张表，新模型漏登记会红。已核结论（2026-11-07）：付费抽检里 `POST /v1/music/generations` 带 version=v5.5 回 HTTP 400 invalid_parameter「Suno 旧版本 "v5.5" 已下线，请将 version 改为 v6、v6-wild 或 v6-mini。」（没扣钱）；音效文档的 version 也只列 v6 / v6-wild / v6-mini。所以表里的「上一代 v5.5」在 APIMart 侧已不可用。本 PR 不改 V5.5 的声明（main 上本来就带着它，这里不新增问题），也不再拿它做付费样本；退役这两行要改 `seedBuiltins.ts` 的退役清单，而这个文件 14 天里已有两次同类修复（都是上游下线后手动加退役行），按 P1 先做类根因复盘，再另开 PR。`nomi-audio` 是配音 + 转写的伞形行（不是一代模型），2026-08-30 起就是 `legacy`，这里只登记现状。

### ★1c 老用户

保留 V5.5、旧 Flash 与旧 Gemini 的原 key、mapping id、enabled、用户标签和保存参数（APIMart 的 V5.5 已被上游下线，旧节点生成时会收到上游原话「已下线，请改为 v6…」；退役与提示另开 PR，见上）；V6 另建身份。旧音效仅把线缆字段改正，canonical sound_type/sound_tempo/sound_key 不变。
旧数据由修改前基线真实目录函数生成，登记到 `tests/fixtures/old-user-data/` 并记录生成 SHA。现有真实旧目录矩阵也重跑；无法取得旧项目资源的部分照实记未验证。

## ★2 谁说了算

唯一 owner：catalog 声明、model-archetypes 参数、seedModelIdentity 分档；复用 seedBuiltins 的通用对账。
门表：APIMART_AUDIO_MODELS 三个读文件（apimartAudios、apimartModelHealth、seedBuiltins）；APIMART_TEXT_MODELS/APIMART_TEXT_MAPPINGS 五个读文件/声明点（apimartTexts、seedBuiltins、catalogLiveness）。生成前请求共用 requestPipeline，响应共用 responseParsing。

## ★3 一致与复用

既有决策：版本身份独立、已保存节点不被改名、供应商接入走声明。三路比较：沿现有声明增加精确身份可保留存量，选此路；新造运行时分支违反通用合同；删除旧代破坏旧作品，拒绝。Suno 新档案只暴露本次基础模式，不能继承 KIE 的上传续写/翻唱。

## ★4 全状态

空：沿用模型未配置入口；加载：原提交状态；成功：原音频结果/Agent 正文；失败：原错误卡；部分成功：仅基础单音频结果；取消中：沿用现有收口；过期：沿用结果/链接错误；不可用：换已配置模型。未知价保持未知，不填零。

## 5 中途表

| 状态 | 停止 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 未提交 | 保留草稿/未发请求 | 保存草稿 | 保留草稿 | 打开原稿 | 原确认闸 |
| 提交或运行中 | 原中止语义/不承诺退款 | 原 Run 持久化 | 原结果不明/任务恢复 | 找回原 Run | 原并发拒绝 |
| 成功或失败 | 结果原样 | 结果持久化 | 已有结果原样 | 读原结果 | 新意图需原确认 |

本次不改变这些行为；供应商扣费/退款只由任务回执证明。

## 6 外部数据与失败

官方 generation/sounds/tts/Chat/Messages/Qwen 文档与公开总价目重新核对。字段白名单来自官方合同，模板发送前经现有渲染路径。新增反例：任何已登记模型的 wire key 偏离官方字段集合必须红；同样检查 TTS、Lyria，与 Suno 版本无关。模型列表不是连通/工具/读图的实测证明。
推理档位：laneModelProvider 接受 thinkingLevelMap，但 nomiModelConfigFor 尚不从目录读取它；不扩大声明任务去补运行时，报告此缺口。

## ★7 性能

不新增交互或网络阶段；只增加有限的目录数据。现有选择器排序和请求预览执行路径不变；未验证：未新增/运行性能场景，不以此宣称功能已完成。

## 8 真实条件

Mac 开发构建用隔离夹具验证合同与回环；Windows、安装包和中英两轨界面本轮未验。此前供应商抽检的范围见下。
2026-11-07 的开发构建在隔离副本抽检。Suno V6 Mini、Suno Sounds V6 Mini、Lyria 3.5 均生成成功；配音当时请求已发出，存盘被落盘关口拒绝（`generated_output_expected_kind_required`）。11-08 已用 Agent 主进程路径验文字和读图，逐模型结果见「一问一个结果」。
拍板图清单不适用：不新增布局或交互。

## ★9 验收清单与反例（实现前）

1. 每个 V6 音乐/音效身份独立；请求 model/version/path 与官方一致。反例：V6 误复用 V5.5 key、错误版本与 sounds 字段。
2. 六个新音频声明与 TTS/Lyria 的参数默认、输入槽、create/query/status/audio_url 预览；官方已给结果能由 firstMappedString 接住。反例：错误 task_id 层级与空结果。
3. 字段集合合同按端点统一验证所有登记的型号；反例：往非 Suno 声明加入错误字段同样红。
4. 22 个当前大脑精确 ID；不加入 MiMo，不改既有默认；保留旧大脑原 key。反例：旧 ID 替换冒充升级。
5. 旧目录回放保留模型 enabled/label/key 与可执行路由；V5.5 只纠正声音线缆字段，不变原参数。
6. lifecycle 走现有分类机制落盘：最新一代与上一代都不是 legacy（Suno V5.5、DeepSeek V4 Flash、Gemini 3.5 Flash 是上一代）；更老的 V3.1 Terminus 是 legacy。旧作品保留原型号、参数和请求路由；Suno 音乐 V5.5 重跑被上游以 HTTP 400 拒绝（该代已下线），V3.1 Terminus 返回 HTTP 503。
7. 文本价格取 APIMart 价目接口有效值（分档取最高、峰谷取峰，见「按官方文档对齐」）；TTS 不造价、不声明免费。无法用现有声明接入的价格列缺口。
8. 免费请求预览与付费步骤共用；每家族选公开价最低的当前候选各一次，收费脚本不得自动重试。
9. 单测、根因合同检查、推送前快检与交付自检；红项保留原文，门岗 bug 停下交协调。独立验收由协调另派，本线不自签。

根因分层：症状为音效设置没有按官方字段发送；直接原因为把 canonical sound_* 当 wire key；类根因为模板未与官方允许字段集合对账。结构防线为声明处收紧 wire 字段类型，类检查覆盖其它端点，并删除旧错误 wire 键。
回滚：撤销本任务实现提交，保留旧数据；上一代继续出现在新节点的选择里，不迁移用户 key。

### 功能分类
- [x] 花钱
- [ ] 新界面 / 改交互
- [ ] 长跑 / 可打断
- [x] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式
- [ ] 新增功能 / 性能

## 按官方文档对齐（2026-11-07，I-catalog-a-docs-align，协调定方案 A）

**口径（一句话，D-check 复盘引用这句）：通用协议模型：协议页给依据、列表 + 真调用给封印。** 文字大脑都走 APIMart 的通用 OpenAI 协议（Chat Completions），官方文档只给协议页和模型列表接口，不逐个模型出页；所以「文档出处」认协议页（id 在某页逐字出现就以那页的拼法为准），「能不能调」只认一次真调用，「能不能读图」只认 `/v1/models` 的 Vision 标签或一次带图真调用。列表里有 ≠ 调得通。

价目口径：每条文字模型的价都取公开价目接口 `GET https://api.apimart.ai/api/pricing/model?model=<id>` 的有效值（列表价 `rates` × `price_factor`；分档取最高档、峰谷取峰、缓存读取取隐式 / 显式里高的、缓存写入取 5 分钟 / 1 小时里高的；接口里没有的字段不填）。原始快照 `tests/fixtures/apimart/text-pricing-api.json`，契约测试从快照重算，不抄算好的数。以前「中转价查不到就记一手厂商价」作废。

| 模型 | main 上有 | 之前（#1436 头） | 之后 | 依据 |
|---|---|---|---|---|
| deepseek-v4-pro | 是 | 1.0285712 / 3.0857144 / 缓存读 0.0514284 | 缓存读 0.1028568（原来是接口值的一半） | 价目接口 |
| deepseek-v4.1-flash | 否 | 缓存读 0.0114284，读图 | 缓存读 0.0228568，去掉读图 | 价目接口；读图无一手依据 |
| deepseek-v4-flash | 是 | 0.44 / 1.32 / 0.014（DeepSeek 官方价） | 0.3428568 / 1.0285712 / 0.0342856 | 价目接口 |
| gemini-3.5-flash | 是 | 1.5 / 9 / 0.15（Google 官方价），读图 | 1.2 / 7.2 / 无缓存价，读图保留 | 价目接口；读图 = 2026-08-12 带图真调用 |
| qwen3.8-max-0902 | 否 | 价目表别名 | 改名 qwen3.8-max（价不变） | 官方 Qwen 页的拼法 |
| claude-opus-5-5 / claude-sonnet-5-5 / claude-haiku-5-5 / claude-fable-5.1 / gemini-4-argon / gemini-3.8-flash | 否 | 读图 | 去掉读图（价不变） | 读图只有协议页，没有一手依据 |
| 其余 13 条新加的 | 否 | 来源写总价目表 | 数不变，来源改成逐个价目接口 | 价目接口 |
| deepseek-v3.1-terminus | 是 | 无价 | 不动（价目接口查不到它；2026-08-21 探针调通过） | 本文件头记录 |
| MiniMax-H3-Context-IR | 是 | 无价 | 不动（提示词增强专用） | Context-IR 页 |

删 0。每条声明的 `evidence` 写明协议页、价目接口、是否已真跑（新加的 21 条都是「未」，Context-IR 也是）；读图声明必须带 `evidence.imageInput`，契约测试守。

老用户（升级后看到的）：deepseek-v4-pro、deepseek-v4-flash、gemini-3.5-flash 三行的价整份换成价目接口的有效值、来源改成价目接口（种子对账按价目漂移整份替换，`apimartLatestContracts.test.ts` 用 v0.24.1 真实旧目录回放断言）；v4-flash 输入 / 输出变便宜、缓存读取变贵；gemini-3.5-flash 输入 / 输出变便宜，缓存命中的 token 不再按缓存价算（接口没有缓存价，按输入价估，宁可高估）；读图照旧。terminus、Context-IR 不变。改名和去读图的都是 #1436 新加的，没有老用户。

两个脚本（协调跑；先在专用工作树 `pnpm build`，Nomi 关掉）：
- 列表对账（零花费）：`NOMI_SPEND_OK=1 node tests/ux/apimart-text-list-real.paid.mjs` → `text-list.md`：「声明了、列表没有」「列表最新一代、没声明」、读图事实。演练 `node tests/ux/apimart-text-list.rehearsal.walk.mjs`。
- 一问一个（付费，25 个大脑各一问 + 7 个读图候选各一问，共 32 次很短的调用）：`NOMI_SPEND_OK=1 node tests/ux/apimart-text-brains-real.paid.mjs`；续跑 `NOMI_TEXT_BRAINS_FROM=<id 或 id#image>`；读图候选 `NOMI_TEXT_IMAGE_CANDIDATES`（缺省 = 上面去掉读图的 7 个）。走 Agent 主进程大脑路（single-shot），不走任务通道；每个只问一次、不重试、失败接着问；回执一条一落（`brains.jsonl`）。演练 `tests/ux/apimart-text-brains.rehearsal.walk.mjs`。

合入前：协调跑一问一个，调不通的在本 PR 里删（新加的，无老用户）；terminus 调不通记进 retire 待办，本 PR 不动 `seedBuiltins.ts`；带图读出暗号的再加回读图声明（带 `evidence.imageInput`）。

未验证（2026-11-07 写的，结果见下一节）：21 条新加的文字大脑一条都没真调用过；7 条读图候选没带图真调用过。

## 一问一个结果（2026-11-08）

协调跑 `tests/ux/apimart-text-brains-real.paid.mjs`（开发构建、隔离副本、Agent 主进程大脑路，每条只问一次、不重试）。文字题：「只回复一个字：好」；读图题：带一张印着四位暗号的图，问图上写的什么。

| 结果 | 模型 |
|---|---|
| 文字调通（HTTP 200，回了正文，回答的模型就是请求的那个） | gpt-6-astra、gpt-6.1-sol、gpt-6.1-terra、gpt-6-luna、claude-opus-5-5、claude-sonnet-5-5、claude-haiku-5-5、gemini-4-argon、gemini-3.8-flash、deepseek-v4-pro、deepseek-v4.1-flash、qwen3.8-max、qwen3.8-flash、qwen3.8-27b、qwen3.8-2.4t-a95b、glm-5.3、glm-5.3-flash、kimi-k3、grok-4.7、minimax-m3、step-3.7-flash、deepseek-v4-flash、gemini-3.5-flash |
| 读图通过（完整回出暗号） | claude-opus-5-5、claude-sonnet-5-5、claude-haiku-5-5、gemini-4-argon、gemini-3.8-flash、deepseek-v4.1-flash、gemini-3.5-flash |
| 没调成：预扣超过余额 | claude-fable-5.1：HTTP 402 `insufficient_user_quota`，文字、读图两题都是。11-08 问了两次（余额 $2.76、充值后 $12.19），都要预扣 $40.05：我们走 OpenAI 协议时没带输出上限，APIMart 按最长输出（100 万 token × $40/M）预扣。不是模型的问题，修法是请求链改造里「文本大脑总发输出上限」那一片 |
| 调不通 | deepseek-v3.1-terminus：HTTP 503 `model_not_found`；`/v1/models` 列表里也没有它 |

据此改的声明（`electron/catalog/apimartTexts.ts`）：
- 调通的 20 条新加的：`evidence.liveCall` 从「未」改成这次（`ASKED_20261108`）。
- 读图通过的 6 条新加的：加回 `meta.supportsImageInput: true`，带 `evidence.imageInput`（`SAW_IMAGE_20261108`）。
- claude-fable-5.1：照旧「未」、不写读图；等「总发输出上限」那一片合入后再问（预扣会降到按上限算）。
- deepseek-v3.1-terminus：11-08 用户拍板直接删，见删除 PR（待创建）。
- 自动读图不跟着变：多了 6 个读图声明后，没指定模型时「挑第一个能读图的」会按目录序从 gemini-3.5-flash 换成 claude-opus-5-5（价贵两倍多，视频拆解读帧也没比过）。给 gemini-3.5-flash 声明 `meta.autoImageReader: true`，`selectTextModelCandidates` 在同为「能读图」时把它排前；`apimartLatestContracts.test.ts` 断言新装和 v0.24.1 升级两种目录自动读图都还是它（去掉排序规则这条红：`expected 'claude-opus-5-5' to be 'gemini-3.5-flash'`）。换不换成更新、更便宜的读图模型，等读帧质量和花费比过再定（计划表登记）。

未验证：claude-fable-5.1 请求收到 HTTP 402，未取得成功回复；6 个新读图模型只验了「读得出图上的字」，没验视频拆解读帧的质量；列表对账没对真列表跑过（只有演练）；gemini-3.5-flash 无缓存价是接口现状，APIMart 实际怎么计缓存命中不知道。

## 无图自动大脑的验收补项（2026-11-08）

创作者接通 APIMart、未点名大脑时，普通文字首选 DeepSeek V4 Pro、停用后次选 V4 Flash；自动读图仍选 Gemini 3.5 Flash。默认和后备应由目录声明，用户显式指定的模型始终优先。只把旧声明挪回列表首部无法保护升级存量、用户调整的行序或以后增加型号。按单价自动挑选也会改变现有选择策略。

用同一 `selectTextModelCandidates` 复核新装、v0.24.1 旧目录、倒序目录、仅 APIMart 可用、Pro 被停用、显式偏好及独立供应商的顺序。新增候选应排在旧作品保留的 Terminus 之前。变更只涉及无图自动模式的排序，不新增界面或供应商请求；费用检验使用目录已登记的价格与本机夹具。
