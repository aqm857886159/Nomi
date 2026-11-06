# Current audio and text catalog declarations

类别：[花钱][其他]；声明更新，不新增运行时通道，不改界面布局。

## ★0 先查别人

- https://docs.apimart.ai/en/api-reference/audios/suno/generation.md · 官方用 model=suno 与 version 区分 V6/Wild/Mini，普通灵感模式只需 prompt/instrumental · 确认三个精确身份独立加入，不改旧节点 key。
- https://docs.apimart.ai/en/api-reference/audios/suno/sounds.md · 官方 wire 字段是 type/bpm/key，版本共享 music task 结果 · 改变旧声音模板的字段名，保留已有 canonical 参数名以兼容存量。
- https://docs.apimart.ai/en/api-reference/texts/general/chat-completions.md · 全部文本生成模型复用 Chat Completions、messages/tools/stream · 确认仅更新模型声明，不增加供应商运行时分支。
- https://docs.apimart.ai/en/api-reference/audios/tts.md · 同步二进制 speech 仍使用 gpt-4o-mini-tts · 确认保留现有声音节点与未知价格。
- `electron/catalog/seedModelIdentity.ts:294` · catalogLifecycle 集中分档，legacy 不删除执行记录 · 确认旧模型仅降推荐排序。

## ★1 用户怎么用

当创作者在作品里选音乐、音效或 Agent 大脑时，希望选到各子线当前模型，并能继续运行旧作品。
步骤：打开作品 → 保留原节点 → 新节点选当前型号 → 设置已有参数 → 查看报价状态 → 确认生成 → 原结果收口。
真实任务目标：已有 V5.5 音乐节点继续执行；新 V6 音效 one-shot/loop 与 BPM/调性正确发送；各家大脑执行同一 Chat 请求。
主指标：新增声明请求逐字段匹配率 100%，量具 `electron/catalog/apimartLatestContracts.test.ts`。
质量指标：旧目录已发布模式保留率 100%，量具 `electron/catalog/upgradeKeepsWorkingModels.test.ts` 与新增旧目录回放。
护栏：付费执行次数为零；真供应商结果、质量与连通性未验证，只交回环/请求预览证据。
已知缺口：生成价格只存在于 Model.pricing，当前 curated 音频投影不接受该字段；本任务禁止修改 seedBuiltins，不能把已知官方价冒充已接入产品报价。文本分档价现有单价结构无法精确表示，保守使用最高档并在来源与报告说明。

### ★1b 连带界面

复用模型选择器、参数面板、付费确认、任务失败与结果显示；只更新模型标签/声明，不新增状态文案。

### ★1c 老用户

保留 V5.5、旧 Flash 与旧 Gemini 的原 key、mapping id、enabled、用户标签和保存参数；V6 另建身份。旧音效仅把线缆字段改正，canonical sound_type/sound_tempo/sound_key 不变。
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

Mac 合同与回环可验；Windows/真付费/真实供应商/中英真窗口/安装包均 unverified；付费脚本先走 openPaidWalk 并复用零花费演练步骤，交协调执行，不自行运行。
拍板图清单不适用：不新增布局或交互。

## ★9 验收清单与反例（实现前）

1. 每个 V6 音乐/音效身份独立；请求 model/version/path 与官方一致。反例：V6 误复用 V5.5 key、错误版本与 sounds 字段。
2. 六个新音频声明与 TTS/Lyria 的参数默认、输入槽、create/query/status/audio_url 预览；官方已给结果能由 firstMappedString 接住。反例：错误 task_id 层级与空结果。
3. 字段集合合同按端点统一验证所有登记的型号；反例：往非 Suno 声明加入错误字段同样红。
4. 22 个当前大脑精确 ID；不加入 MiMo，不改既有默认；保留旧大脑原 key。反例：旧 ID 替换冒充升级。
5. 旧目录回放保留模型 enabled/label/key 与可执行路由；V5.5 只纠正声音线缆字段，不变原参数。
6. legacy 元数据通过现有分类机制落盘；新 V6 与当前大脑为当前档，旧代仍可执行。
7. 文本价格保守覆盖官方分档/缓存；TTS 不造价、不声明免费。无法用现有声明接入的价格列缺口。
8. 免费请求预览与付费步骤共用；每家族选公开价最低的当前候选各一次，收费脚本不得自动重试。
9. 单测、根因合同检查、推送前快检与交付自检；红项保留原文，门岗 bug 停下交协调。独立验收由协调另派，本线不自签。

根因分层：症状为音效设置没有按官方字段发送；直接原因为把 canonical sound_* 当 wire key；类根因为模板未与官方允许字段集合对账。结构防线为声明处收紧 wire 字段类型，类检查覆盖其它端点，并删除旧错误 wire 键。
回滚：撤销本任务实现提交，保留旧数据；新增模型的旧版可见性按已有目录读取规则，不迁移用户 key。

### 功能分类
- [x] 花钱
- [ ] 新界面 / 改交互
- [ ] 长跑 / 可打断
- [x] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式
- [ ] 新增功能 / 性能
