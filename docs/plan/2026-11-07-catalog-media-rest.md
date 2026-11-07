# Remaining image and video declarations (APIMart)

接 `2026-11-07-catalog-media.md` 之后的下一批：只做「纯目录声明就能表达」的 D 类图片和视频型号。需要新操作或新结果形状的 S 类（Midjourney 四宫格、选区 / 蒙版改图、续拍 / 延长、2K 专线、分轨）不在本批，报告里逐个写原因。

类别：[花钱][数据格式]；仅现有基础操作（文生图、改图、文生视频、图生视频）的声明数据，不增加运行时分支。

## 本次范围与旧代规则

- 规则沿用上一批：每个家族的最新代与上一代都对新节点可用（不是 legacy），只有更老的代才 legacy；GPT Image 2 保持可选。
- 本次新增图片：Nano Banana 2.1 与 2.1 Ext、Nano Banana Lite 与 Lite Ext（只出 1K，不发清晰度）、FLUX 3 与 FLUX 3 Klein、Grok Imagine Image 2.0 官方、混元图像 3.5 预览、Muse 图像 Ext、万相 2.7 图像与 Pro。
- 本次新增视频：Kling v4、Grok Imagine Video 1.5 官方、PixVerse v6 与 v6 Max、Muse 视频 Ext、FLUX 3 视频、Wan 3.0 Prime、Veo 3.1 官方 Fast / Quality、Vidu Q3 Pro / Turbo、Vidu Q4 预览版、Gemini Omni 1.2 Flash 与 Flash Ext（只接文生 / 首帧 / 首尾帧 / 多图参考，不接视频编辑与续写）。Omni 1.1（Omni-Flash-Ext）因此升为上一代，从旧代回到可选。
- 合同表：`tests/fixtures/apimart/model-generations-media.json` 新增家族；测试新增「每个已声明的 APIMart 图片 / 视频模型都必须登记在表里」。

## ★0 先查别人

- https://docs.apimart.ai/en/api-reference/images/gpt-image-2.6/generation.md · 上一批的声明形状 · 本批全部复用同一套 `imageModel` / `videoModel` 工厂和档案登记，不另造风格。
- https://docs.apimart.ai/en/api-reference/videos/veo3/generation-official.md · 官方通道单独 model id，按秒计费，时长只有 4 / 6 / 8 · 时长做成数字选项，不加引号，不沿用 Ext 通道的固定 8 秒。
- https://docs.apimart.ai/en/api-reference/videos/vidu-q4-preview/generation.md · 只有图生与参考生，没有文生 · 档案不声明文生，不造首尾帧。
- https://docs.apimart.ai/en/api-reference/images/muse-image-ext/generation.md · 官方明说比例不要发 auto · 比例不设默认值，留空即不发。
- https://docs.apimart.ai/en/api-reference/images/grok-imagine-image-2.0/generation.md · 带参考图时不允许 quality · 图生图模式不声明 quality。

## ★1 用户怎么用

创作者新建图像或视频节点，选到新增型号，选基础模式，设参数、连参考图，确认原报价，结果落回原节点。
主指标：每个新增身份与模式的请求和官方字段合同匹配，量具 `electron/catalog/apimartLatestMediaContracts.test.ts` 与档案一致性测试。
护栏：真实付费次数为零；Midjourney、选区、续拍、分轨、音频不接。

### ★1b 连带界面

复用原模型选择器、参数面板、错误与结果卡，不新增布局、文案或控件类型。已有参数名走既有翻译。

### ★1c 老用户

不删旧 key、不改旧 mapping id、enabled、用户标签和节点参数；新型号另建身份；旧代只经 `curatedCatalogLifecycle` 降推荐，不删除执行行。Nano Banana 2 / Wan 2.7 / Kling v3 / Vidu Q3 等上一代继续可选。升级路径复用 `tests/fixtures/old-user-data/curated/v0.24.1-apimart/` 的对账测试。

## ★2 谁说了算

catalog 的 image / video 声明是线缆 owner，modelArchetypes / videoCapabilities 是参数和槽 owner，seedModelIdentity 是推荐档位 owner。不改种子装配、不改运行时。

## ★3 一致与复用

三路比较：沿既有声明补型号（选）；新造运行时适配（违反范围）；删旧型号（会断旧作品）。复用工厂、共享 query / status / result、档案解析与生成默认表。官方与普查冲突以官方页为准。

## ★4 全状态

沿用原路径，不改：空 / 加载 / 成功 / 失败 / 取消 / 过期 / 不可用均走原有处理。价格不明保持未知，不造零。

## 6 外部数据与失败

每个新身份逐页读取官方正文，保存字段集合与来源 URL（写在档案 `sources`）。Model.pricing 由用户配置，curated 图片 / 视频投影不接价格，价格只写进清单与报告。市场页有、价目表和接口索引没有的型号（Seedream 5.5、MAI 2.7、Gemini Omni 1.2）：没有可调用合同就不加。

## ★7 性能

不新增用户操作、网络阶段或大数据结构；只增加有限目录数据。未验证：未跑性能场景。

## 8 真实条件

Mac 请求预览与合同可验；真供应商、真付费、Windows、安装包、中英文真窗口均 unverified。付费脚本只写不跑，交协调。拍板图清单不适用：不新增布局或交互。

## ★9 验收与反例（实现前）

1. 每个新增型号精确 model id 与官方页一致；反例：错代、大小写、通道（官方 / Ext）混用、重写旧 key。
2. 每个模式只声明官方支持的任务桶：Vidu Q4 无文生；Grok 图生图无 quality；PixVerse v6 Max 只有 1 张图；Muse 视频不声明时长 / 清晰度。
3. 每个槽都进入对应字段：数组还是单字符串、首尾帧各自字段、空图不丢。反例：字符串代替数组、首尾帧错位。
4. 默认值都在官方取值范围且不是 auto：Muse 比例无默认；Veo 时长是数字 4 / 6 / 8；Grok 图片质量默认 medium。
5. 提交 task_id 与查询结果形状沿用共享路径，不新增适配。
6. 新旧目录对账：旧行不删、不改 enabled / label / key。
7. 比例普查与映射数量更新，并在注释里写明新增来源。
8. 单测、类型、声明与门岗、排锁快检全部通过；失败和未验证如实记录。独立验收由协调另派，不自签；回滚即回退本分支提交。

### 功能分类
- [x] 花钱
- [x] 数据格式
- [ ] 新界面 / 改交互
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 新增功能 / 性能
