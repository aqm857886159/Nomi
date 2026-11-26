# APIMart 约价：Seedance 2.5 的三个键 + 名单分类

改动名：apimart-price-keys　线/负责人：L11-price-keys　类别：[花钱]（只改发送键旁的约价口径，发给供应商的请求体不变）

## 功能分类

- [x] 花钱
- [ ] 新界面 / 改交互
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能

## ★0 先查别人（纯修复，只答出口）

- https://docs.apimart.ai/en/api-reference/videos/seedance-2-5/generation.md · 计费段「Billed by seconds × resolution tier」，nsfw_check 审核不计费，output_format / return_last_frame 不在计费因素里 · **确认了**：这三个键对 2.5 不改价，可按模型放行。
- https://docs.apimart.ai/en/api-reference/images/seedream-5-0-pro/generation.md · 按实际总像素计费，对 nsfw_check 的审核费说不清 · **改了**：不把三键放进全局名单，只登记在 seedance-2.5 名下。
- electron/catalog/referenceKeyProjectionCensus.test.ts:1 · 仓库里已有的「遍历目录、每个键必须归类」普查写法 · **确认了**：用普查而不是再写一份手写名单来防目录新键。

出口：不涉及：不新增、扩大或挪动任何挡人的保护；只是让已有的约价在一个模型上亮起来，算不出时仍不印数。

## ★1 用户怎么用

当我在画布里选 APIMart 的 Seedance 2.5 文生视频，我想在发送键旁看到约价（和 Seedance 2.0 一样），以便发出前知道大概花多少。

步骤：① 画布加视频节点 ② 模型菜单选 Seedance 2.5 ③ 看发送键旁的积分数 ④ 改清晰度 / 时长，数字跟着变 ⑤ 切回 2.0 对照。

不做什么：不改任何界面元素；不放行 `draft` / `draft_task_id`（样片线处理）；不给别的模型放行（Seedream 5、flux-3-image-klein、kling-v4-flash、MiniMax-H3-Max 也带 nsfw_check / output_format，文档没说清，仍不报价）；不碰目录文件。已知坑：2.5 官方计费说「按秒 × 清晰度档」，带参考视频时另算——本口只报无参考输入的文生，带参考照旧不报。

真实任务：① Seedance 2.5 文生 720p 5 秒：键上 13.5（假价目 0.27 × 5 × 10）；② 切回 2.0：1.95，不受影响；③ 目录里将来给某模型加一个新键：CI 红并点名模型与键。

指标与量具：
- 主：2.5 文生请求体能约出价（量具 `electron/ai/onboarding/vendorPriceRequest.test.ts`，基线：main 上回 null，目标：出价）。
- 质量：不认识的键仍回 null（同一份测试的两条反例）。
- 护栏：普查 `electron/ai/onboarding/vendorPriceKeyCensus.test.ts`，目录里未归类的键 = 0。
- 真窗口：`tests/ux/seedance25-price.walk.mjs`（假价目替身）。

### ★1b 连带界面
价格只出现在画布节点浮框发送键旁（`cost.send-pill`，口径「算不出不印数」），别处不新增露出。后果表见协调仓 `tmp/L11/callers.md`。

### ★1c 老用户
不适用：不碰存量数据、项目、设置；升级后 2.0 的价照旧，2.5 多出一个价。回退上一版：2.5 回到不显示价，其余不变。

## ★2 谁说了算
「请求体里哪些键进约价、哪些可忽略」唯一 owner：`electron/ai/onboarding/vendorPriceRequest.ts`（`classifyPriceKey`）。门表 `node scripts/door-map.mjs priceQueryFromRequest`：1 扇（`onboardingIpc.ts:45`）。「1」靠使用结果的那一步只认主人：不认识的键查询直接回 null；目录新键由普查在 CI 先红。旧的单份 `PRICE_FIELDS` 同提交删除。

## ★3 一致与复用
以前定过：`vendorPriceRequest.ts` 的保守写法（不认识的键可能改价，宁可不报）——仍算数，原样保留为兜底。三条路：① 沿原方向补三个键进全局名单（会让 Seedream 5 等同名键的模型一并亮价，其文档对 nsfw_check 计费说不清，否决）；② 按模型登记核过的忽略键 + 普查（选这条）；③ 拿掉不认识就 null（会报错价，否决）。复用既有普查写法（`referenceKeyProjectionCensus.test.ts`）。

## ★4 全状态
空 / 加载 / 成功 / 失败 / 取消中 / 过期 / 能力不可用：沿用现有发送键约价各状态，不改；算不出价时只剩箭头、不印数、不印 0。

## 5 中途表
不适用：只读公开价目的 GET，不创建任务、不产生花钱授权；打断后下次重读。

## 6 外部数据与失败
- Seedance 2.5：https://docs.apimart.ai/en/api-reference/videos/seedance-2-5/generation.md（Billing 段，2026-11-26 读）：「Billed by seconds × resolution tier」；nsfw_check「The moderation call itself is not billed to the user」；output_format（mp4 / mov）、return_last_frame（返回尾帧图）都不在计费因素里——依据是计费公式没列它，文档没有另写「不改价」。`cn` 地址 404（目录引用的来源地址已死链，`docs/research/model-radar/doc-fingerprints.json` 记着），本 PR 不改档案文件。
- Seedream 5.0 Pro：https://docs.apimart.ai/en/api-reference/images/seedream-5-0-pro/generation.md：按实际总像素计费，nsfw_check 开启时的审核费用说不清 → 不放行。

## 8 真实条件
中文浅色 / 英文暗色各一张，已读：`docs/evidence/2026-11-26-apimart-price-keys/`。最小窗口、Windows、真付费：unverified（不跑真付费）。

## ★9 验收与回滚

验收清单与反例（动手前写定）：
1. 目标测试：Seedance 2.5 文生真实渲染体（`applyBuiltinSeeds` → `priceQueryFromRequest`）约出价。「什么都不做」（换回 main 的文件）→ 红。
2. 反例 A：2.5 体里多 `image_urls`（真会改价）→ 仍 null。
3. 反例 B：2.5 体里多一个哪份名单都没有的虚构键 → 仍 null；把「不认识就 null」拿掉 → 反例 A、B 红。
4. 把三个键从 2.5 的登记里拿掉 → 目标测试红。
5. 不放宽：Seedream 5.0 Pro（同样带 output_format / nsfw_check）仍 null。
6. 普查：目录 APIMart 全部文生图 / 文生视频映射的模板键都落进某一类；拿掉任一已登记的键（例：`steps`）→ 红并点名模型与键。
7. 真窗口：假价目替身下 2.5 键上 13.5，2.0 键上 1.95，替身只收到 GET。
回滚：revert 本 PR 的合并提交；2.5 回到不显示价。
