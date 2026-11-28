# 方向检查：APIMart 约价键名单（RW 复盘）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

命中情况：`electron/ai/onboarding/` 目录近 14 天 2 个 fix（bacbc2539、252d06033，都是 S6 账户余额），`vendorPriceRequest.ts` 本身近 14 天只有 1 个 feat（3d96e7254，建文件）。只因目录命中、文件本身没命中，改法是换（同一提交删掉单份 `PRICE_FIELDS`），不新增分支或特例；协调按例外代批（11-26），因钩子没有例外口子，仍附这份复盘。设计卡见 `docs/plan/2026-11-26-apimart-price-keys.md`。

**这一处的全图在哪**：表外。约价口径只有一条链：画布 `useNodePricePreview` → 桥 `vendorPricePreview` → `onboardingIpc.ts:45` → `priceQueryFromRequest`；门表 1 扇（`node scripts/door-map.mjs priceQueryFromRequest`）。

## 0. 一句话根因
约价的「哪些请求体键可以忽略」是一份手写名单，和目录各管各的，目录给模型加键时没有任何东西逼人判断它改不改价，约价就悄悄消失。

## 1. 归类表
| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| Seedance 2.5 发送键旁没价 | 体里的 output_format / return_last_frame / nsfw_check 不在 `PRICE_FIELDS` | 手写名单落后于目录 |
| 同目录前两个 fix（余额） | 账户余额读取与界面状态 | 不同概念，只因同目录计数 |

## 2. 为什么这一类会一直出现
名单和目录没有结构上的绑定：目录加键不报红，约价保守地回 null 又不出声。Seedream 5.x、flux klein、kling-v4-flash、MiniMax-H3-Max 此刻也处在同一状态。不涉及三条体验铁律中的意图 / 档案 / 点击预期，铁律 ⑩ ⑪ ⑫ 不适用。

## 3. 不改结构接下来会冒出什么
| 预测 | 怎么验证 |
|---|---|
| 下一个带新键的 APIMart 模型约价为空 | `pnpm exec vitest run electron/ai/onboarding/vendorPriceKeyCensus.test.ts` 在新键未归类时红 |
| 有人为让某模型亮价把键整批放进全局名单，误报价 | `vendorPriceRequest.test.ts` 的「不放宽」一条（Seedream 5.0 Pro 仍 null） |

## 4. 靶子独立性检查
- 目标测试从目录真实渲染的请求体出发，不手写夹具；反例用虚构键证明「不认识就 null」是独立兜底。
- 没有「修对了反而掉分」的先例。

## 5. 这一整块归谁
- 这一整块：APIMart 的计费口径（哪些参数改价）加我们目录里每个模型的请求体模板。
- 归谁：计费口径归 APIMart 官方计费文档（https://docs.apimart.ai/en/api-reference/videos/seedance-2-5/generation.md 的 Billing 段）；请求体模板归 `electron/catalog/apimartVideos.ts:188`，约价口径唯一 owner 收在 `electron/ai/onboarding/vendorPriceRequest.ts`。
- 我们哪里绕开了它：此前手写的 `PRICE_FIELDS` 绕开了「由计费文档决定哪个键改价」，把判断散在一份无出处的名单里。现改为按线上模型名登记、每条带出处；说不清的键归「已知但不报价」并写理由；普查在 CI 里逼人归类。

## 结论
结构性结论：不需要用户拍板的方向变化——只是把名单换成带出处的分类并加普查，行为只在 2.5 上多出一个价，其余模型不变。
