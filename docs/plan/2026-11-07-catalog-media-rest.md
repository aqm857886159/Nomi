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

不删旧 key、不改旧 mapping id、enabled、用户标签和节点参数；新型号另建身份；旧代只经 `curatedCatalogLifecycle` 降推荐，不删除执行行。Nano Banana 2 / Wan 2.7 / Kling v3 / Vidu Q3 等上一代继续可选。升级路径回放依据：基线（merge-base 的真实种子）+ 用户改动再套本分支种子；`tests/fixtures/old-user-data/curated/v0.24.1-apimart/` 目前仓库里不存在，合入 main 后存在就改用它，对账测试 `electron/catalog/seedBuiltins.test.ts`。

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
9. 与分支 2 合成一个 PR 后补的三条自动防线（详见 `catalog-media.md` ★9 第 10 条）：请求体字段集合（`apimartMediaRestWire.test.ts` 盖到本批全部型号 + 2.6 + 改过档位的上一代）、默认值与选项在官方取值内（`apimartMediaOfficialValues.test.ts`，覆盖本批全部型号）、用户点名保留的 GPT Image 2 不得标 legacy。变异（质量默认值改成 `ultra`、`image_urls` 改成 `image_url`、`gpt-image-2` 标 legacy）都先确认红再还原。

## 按官方文档对齐（2026-11-07 第二轮）

审计报告 §1 第 2–5 条逐条重对 APIMart 官方页（以线上页为准；和审计报告不一致的地方写在实现报告里：Vidu Q4 官方页**写了**单图参考生，要显式 role）。

| # | 之前 | 之后 | 官方原话 |
|---|---|---|---|
| ① Gemini Omni 1.2 Flash Ext 首尾帧 | 注释写「Ext 不支持尾帧」，没有首尾帧方式 | 加首尾帧：first_frame_image + last_frame_image，时长 3–10 秒 | [Ext 页](https://docs.apimart.ai/en/api-reference/videos/gemini-omni-1.2-flash-ext/generation.md)「Scenario 3: First-and-Last-Frame Video」「In first-and-last-frame mode: `duration` supports `3`–`10`」 |
| ② Omni 1.2「自动」比例 | 首帧 / 首尾帧 / 多图参考的比例有「自动」且默认 auto（不发比例） | 两条通道每种方式只有 16:9 / 9:16，默认 16:9，照发 | [Flash 页](https://docs.apimart.ai/en/api-reference/videos/gemini-omni-1.2-flash/generation.md)「Only `16:9` (landscape, default) and `9:16` (portrait). Other values are treated as `16:9`.」；Ext 页「other values return a 400 error」 |
| ③ Vidu Q4 参考生只放 1 张 | image_urls 裸数组，1 张时官方当成图生视频 | image_with_roles，每张 role reference_image；1–15 张，1 张也按参考，不在背后换方式；方式说明写明「1 张也按参考」 | [Vidu Q4 页](https://docs.apimart.ai/en/api-reference/videos/vidu-q4-preview/generation.md)「With only one image and no reference audio, explicitly set `role: "reference_image"`; otherwise, image-to-video is used.」 |
| ④ Grok Imagine Image 2.0 提交形状 | 不带响应版本头、按 data[0].task_id 取（Grok 页只示例了带头的形状） | 不变（协调拍板选 C，不改执行器成功码）；档案补上平台默认形状的出处；守卫：APIMart 图片 / 视频的 create 都不带这个头 | [Muse Image Ext 页](https://docs.apimart.ai/en/api-reference/images/muse-image-ext/generation.md)「The default response is HTTP `200`, with `data` as an array … Save `data[0].task_id`」「Do not add this header while continuing to parse submission responses as `data[0].task_id`.」 |

④ 的退路：真跑若发现不带头被拒，再走「带头 + 执行器认 code 202 / data.id」，并补方向检查。

### Run 路角色词（main 上已有的问题，本 PR 修在共享边界）

- main 现状：Run 路（引擎 B；MCP stdio 与 ProductionRun——Agent 全自动 / 多镜头批量——走它）把合同角色词直接当线上角色发。Wan 2.7 角色参考经这两个入口发出 `role: "reference"`，官方只收 `reference_image` / `first_frame`（[Wan 2.7 R2V 页](https://docs.apimart.ai/en/api-reference/videos/wan2.7-r2v/generation.md) image_with_roles 字段表）。首尾帧两边刚好同名，所以 Seedance 首尾帧一直没露馅。画布路和 Agent 付费卡的「生成」走画布路，不受影响。
- 根因：角色表（槽种 → 线上角色词）只在渲染层 `archetypeMeta.ts` 有一份，Run 路没有可读的 owner。
- 修法：角色表搬到 `electron/shared/videoCapabilities/referenceChannels.ts`（`REFERENCE_ROLE_FOR_KIND` / `combineRoleForSlot` / `slotJoinsCombine` / `combineRoleForContractReference`），两条路同吃；渲染层那份同提交删掉。Run 路遇到这一档合并里没有对应槽的参考，直接拒发（不猜一个角色）。
- 同类分裂一起对齐：画布路从 2026-07-31（角色表补上 reference_video）起把 Wan 2.7 的参考视频也并进 image_with_roles（role reference_video），官方参考视频只走 `video_urls` 裸数组（Run 路一直是对的）。新增通用可选字段 `combineSlotsInto.kinds`：只把这几种槽并进角色数组，其余留在自己的扁平键。
- 类测试 `electron/parity/combineRolesParity.test.ts`：每个声明角色数组合并的 APIMart 内置模式，画布路与 Run 路发出的角色数组逐项相同，参考视频落在同一个扁平键，合同角色词不上线；新接的模型自动进来。
- 另一处缺口不在本 PR：Run 路图片张数上限按模型取、不按模式，Seedance 2.5 / Wan 3.0（Prime）首尾帧两张图被「最多收 1 张图片参考」拒（计划 A4h，另派线）。类测试把这三格钉成「现在被拒」，修好后会红、再从名单删掉。

### 老用户（升级后行为变化；都不迁移数据）

| 处 | main 上的老用户 | 升级后 |
|---|---|---|
| ①②③④ | 这四个型号都是本批新增、不在 main 上，没有老用户 | — |
| Run 路 Wan 2.7 角色参考 | MCP / ProductionRun 发 role "reference" | 发 reference_image（官方写的值）；节点、Run 记录、素材都不变，只改线上翻译 |
| 画布路 Wan 2.7 参考视频 | 参考视频进 image_with_roles（role reference_video） | 进 video_urls；节点 meta 里的参考列表不变（同一个槽），没有要迁的数据 |

### ★9 验收与反例（这一轮）

1. 四处与 Run 路角色、Wan 2.7 参考视频各有契约测试：`electron/catalog/apimartMediaDocsAlign.test.ts`（画布路真渲染）、`electron/parity/apimartDocsAlignRunPath.test.ts`（Run 路抓包）、`electron/parity/combineRolesParity.test.ts`（两路逐项相同）。
2. 反例（撤掉修复必须红、改回必须绿）：撤掉 Ext 首尾帧、放回 auto 默认、撤掉 Vidu 角色数组、给图片 create 加上响应版本头、Run 路撤掉角色翻译（合同角色直接上线）、撤掉 Wan 2.7 的 kinds。
3. 付费样本（协调真跑，各一次）：Ext 首尾帧 · 720p · 10 秒 ≈ $0.24；Vidu Q4 参考生 1 张 · 720p · 5 秒 ≈ $0.46；Grok 图片 1K medium ≈ $0.048。三条在 `tests/ux/_catalogMediaRestSamples.mjs`，带修复标记（产物里没有就拒跑）。登记、不能跑：Wan 2.7 角色参考 · Run 路 · 720P · 2 秒 · 预计 $0.13 · 「脚本待写，归 A4h 线」。
4. 未验证：三条画布路样本没真跑；**Run 路角色翻译只有类测试 + 抓包，没真跑**；Wan 2.7 参考视频进 image_with_roles 时官方到底怎么处理（报错还是忽略），官方页没写，也没真跑。

### 功能分类
- [x] 花钱
- [x] 数据格式
- [ ] 新界面 / 改交互
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 新增功能 / 性能
