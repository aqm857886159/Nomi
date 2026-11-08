# Current basic image and video declarations

## 本次实际范围与旧代规则（用户 2026-11-07：「Seedance 2.0 肯定要接，最新代和旧一代的都可以接」）

- 规则：每个家族的最新代与上一代都对新节点可用（不是 legacy），只有更老的代才 legacy。表：`tests/fixtures/apimart/model-generations-media.json`，测试 `electron/catalog/apimartLatestMediaContracts.test.ts`。
- 本次改的档位：Seedance 2.0 全部渠道 key、Seedream 4.5、HappyHorse 1.0、Qwen Image 2.0、Wan 2.7 从 legacy 回到 companion；Nano Banana 第一代、Seedream 4.0 仍 legacy。
- 本次新增身份：GPT Image 2.6 Flare / Sunburst（apimart，t2i + 改图，4 条 mapping）；2.5 保留为上一代。
- 未做（见报告）：Nano Banana 2.1、FLUX 3、Hunyuan 3.5、Muse 图/视频、Kling v4、Vidu Q4、H3 Max、PixVerse v6、flux-3-video、SkyReels、GPT Image 2.6 Ext 等。下文 ★ 各节是整条线的合同，未做项不在本 PR 范围。

类别：[花钱][其他]；仅现有基础操作的声明数据，不增加运行时分支。

## ★0 先查别人

- https://docs.apimart.ai/en/api-reference/images/gpt-image-2.6/generation.md · Flare/Sunburst 共用普通图片提交与 task 查询，GIF/SVG/选区另有合同 · 确认只接位图基础模式，保留旧代身份。
- https://docs.apimart.ai/en/api-reference/images/gpt-image-2.6-ext/generation.md · Ext 只有 1k/n=1，版本是参数 · 改变 Ext 的参数边界，不能复用标准通道的 2K/4K。
- https://docs.apimart.ai/en/api-reference/videos/kling-v4/generation.md · 已有基础文生/首帧/首尾帧字段，编辑续拍另有任务语义 · 确认只接现有基础操作，不制造编辑入口。
- https://docs.apimart.ai/en/api-reference/videos/veo3/generation-official.md · 官方通道单独 ID、4/6/8 秒和当前 4K 枚举 · 改变普查中只有 720p/1080p 的结论。
- https://docs.apimart.ai/en/api-reference/images/qwen-image-3.0/generation.md · 当前参考图写 1–3，不是普查的 6 · 确认保留已有上限 3，报告差异。
- https://docs.apimart.ai/en/api-reference/videos/muse-video-ext/generation.md · 当前只列参考图、固定约 10 秒 720p 有声 · 不声明参考视频，不把参考图当精确首帧。
- 出口：不涉及：本卡只加目录声明与守卫测试，不新增长跑任务流程，任务可打断 / 续跑行为不变。

## ★1 用户怎么用

当创作者新建图像或视频节点时，希望各子线当前模型可选，旧作品仍能按原身份继续执行。
步骤：开作品 → 保留原节点 → 新节点选当前型号 → 选择现有基础模式 → 设置参数/连接参考 → 查看原报价确认 → 结果落到原节点。
主指标：每个新增身份和模式的请求与独立官方字段合同匹配率 100%，量具 `electron/catalog/apimartLatestMediaContracts.test.ts`。
质量指标：每个声明槽都能进入其 mapping、无多余模式，量具现有 `apimartVideoSharedContracts.test.ts` 与新增模式矩阵。
护栏：真实付费次数为零；媒体多结果、编辑、选区、分轨、资产登记、市场页待核型号不接。

### ★1b 连带界面

复用原模型选择器、参数面板、错误与结果卡，不新增布局、状态文案或控件类型。已有参数名走既有翻译。

### ★1c 老用户

保留原 key、mapping id、enabled、用户标签、项目节点及已有参考参数；当前型号另建身份；旧代只复用 catalogLifecycle 降推荐，不删除执行行。
回放依据：基线（merge-base 的真实种子）+ 用户改动（隔一个停用、改标签、停用部分 mapping）再套本分支种子，逐行核身份与用户字段、旧 mapping 保留（独立验收 V-catalog-media 已按此回放）。`tests/fixtures/old-user-data/curated/v0.24.1-apimart/` 目前仓库里不存在（随音频 PR 一起带进来），合入 main 后那个目录存在就改用它。它只证明目录兼容，旧作品实际供应商执行仍需协调真跑。

## ★2 谁说了算

catalog 的 image/video 声明是线缆 owner，modelArchetypes / videoCapabilities 是参数和槽 owner，seedModelIdentity 是推荐档位 owner。复用 seedBuiltins 对账，禁止修改种子装配。
门表由 `door-map.mjs electron/catalog/apimartImages.ts` 与 `apimartVideos.ts` 生成：声明 → seedBuiltins / apimartModelHealth，视频还供共享合同与雷达读取；新数据不改变读面形状。

## ★3 一致与复用

已核旧决定：版本独立、原作品不改 key、基础模式走声明；Imagen 4 有退役证据，不能借新目录恢复。三路比较：沿既有声明补型号，选此路；新造运行时适配违反本次范围；删除旧模型会断旧作品，拒绝。
复用 imageModel/videoModel、共享 query/status/result、档案解析和生成默认表；缺少可声明表达的结果形状就跳过。

## ★4 全状态

空：原接入入口；加载：原任务进度；成功：原单图/视频结果；失败：原供应商错误；部分成功：不扩成多结果操作；取消中：原中止语义；过期：原链接与恢复提示；不可用：选择另一个已配置模型。价格不明保持未知，不造零。

## 5 中途表

| 状态 | 停止 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 未提交 | 草稿原样/未发请求 | 原保存 | 原草稿 | 原作品 | 原确认 |
| 提交或执行 | 原运行收口/不承诺退款 | 原 Run 持久化 | 原结果不明 | 找回原 Run | 原并发拒绝 |
| 终态 | 原结果保留 | 结果持久化 | 不再提交 | 读取原结果 | 新意图原确认 |

本次不改这些路径。供应商退款与实扣不由声明推断。

## 6 外部数据与失败

每个新身份重新读取官方正文，保存独立字段集合、公开价目和来源 URL。共享 query 必须接住官方示例；错误结果不能成为成功。官方与普查冲突以官方为准，并逐项写报告。
生成报价缺口：当前 Model.pricing 由用户配置，curated image/video 投影不接受价格；本任务禁止改 seedBuiltins，因此不能把已知公开价偷塞成未经消费的字段。产品中的未知报价保留，交协调处理声明价格桥。
文件字节数/像素/参考媒体秒数等现有声明未表达的限制保留为供应商边界验证，不声称本地已拦住。

## ★7 性能

不新增用户操作、网络阶段或大数据结构；增加有限目录数据，沿现有查询/排序路径。未验证：未跑新增性能场景，不以单测宣称交互性能完成。

## 8 真实条件

Mac 请求预览/合同可验；真供应商、真付费、Windows、安装包、中英文真窗口均 unverified。付费脚本交协调，免费档仅证明请求与结果合同。
拍板图清单不适用：不新增布局或交互。

## ★9 验收与反例（实现前）

1. 每个当前候选精确 model/version 身份；市场待核和退役冲突不添加。反例：错代、错大小写、错通道、重写旧 key。
2. 每个模式只声明当前可执行任务桶；Vidu Q4 不出现文生/尾帧，Grok Ext 不出现改图，PixVerse Max 不出现多图，Suno/Agent 不在本分支。
3. 每个声明槽经 production 请求预览进入对应字段；反例：空图丢失、字符串代替数组、首尾帧错位、参考视频误充源视频。
4. 所有 body key 对独立官方允许集合校验；跨型号也红。每个默认值在当前官方取值范围；Ext 只能 1K，Wan Pro 改图只能 2K，PixVerse 首尾帧只 5/8 秒。
5. create 返回 task_id、query completed/failed 与结果 URL 均接住官方示例；空结果不判产物成功。
6. 新旧目录对账，旧行不删、不改 enabled/label/key；legacy 只改推荐档位；已有特殊模式不能随普通生成一起被隐藏。
7. 复用 apimartModelIds / CrossField / VideoShared 测试形状；补比例普查数量，并解释新档案数。
8. 付费抽检每家最低价当前基础档一次、失败停止；脚本先经 openPaidWalk，修复标记与样本清单明确；本线只跑合同演练。
9. 单测、类型、声明与门岗、排锁快检；完整记录失败与未验证。独立验收由协调另派，不自签；回滚本分支提交，不触碰用户旧项目。
10. 三条自动防线（验收线 V-catalog-media 的变异 M2 / M3 / M4 当时全存活，现补上；每条都先在旧代码上做对应变异确认红，再还原）：
    - 请求体（M3）：`apimartMediaRestWire.test.ts` 的期望表盖到 GPT Image 2.6 两档（文生、改图）和上一代改过档位且有请求体声明的型号；字段集合 = 官方允许集合，改图 / 参考图槽落在官方字段（2.6 是 `image_urls`，上限 16）。变异：`image_urls` 改成 `image_url` 必红。
    - 默认值在官方范围（M2）：`apimartMediaOfficialValues.test.ts`，每个有选项的控件，默认值必在声明选项里，选项必为手抄官方取值的子集（出处写在期望表里）。变异：2.6 质量默认值改成官方范围外的 `ultra` 必红。
    - 保持可选（M4）：`gpt-image-2` 及各渠道 key 登记在合同表的 `userKept`（用户原话「image2留着」），标 legacy 必红。
11. GPT Image 2.6 两档是这一家最新一代，进旗舰（`seedModelIdentity.ts`），与上一代 2.5 同档；`apimartLatestMediaContracts.test.ts` 钉住。

### 功能分类
- [x] 花钱
- [x] 数据格式
- [ ] 新界面 / 改交互
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 新增功能 / 性能
