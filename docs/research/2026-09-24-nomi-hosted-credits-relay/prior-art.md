# 先查别人：Nomi 官方额度（内置中转 + 计费 + 兜底）要不要自己造

日期：2026-09-24 · 场景：给 Nomi 内置「登录即用、按次扣费、多家兜底」的官方额度。
方案：[`docs/plan/2026-09-24-nomi-hosted-credits-relay-plan.md`](../../plan/2026-09-24-nomi-hosted-credits-relay-plan.md)

问题一句话：计费账本、多供应商路由兜底、额度与支付，这些是不是已经有人做好了、我们直接用？

## ① 依赖里已有？

- **没有可用的**。Nomi 客户端是 Electron + TS，官方额度的计费与路由必须在服务端做（客户端开源、上报用量不可信），客户端依赖里不可能有这块。
- 客户端侧能复用的只有「供应商请求配方」：`electron/catalog/apimartVideos.ts`、`electron/catalog/kieSeedance.ts` 等声明式 `HttpOperation`，以及 `electron/catalog/paramTranslate.ts` 的字段翻译。它们回答「怎么调 apimart / kie」，不回答「怎么计费、怎么兜底」。

## ② 仓库里已有？

- **协作者的 Nomi-service 已经是这件事的八成**（`github.com/1251912798/Nomi-service@ce050cd`，Go 单体）：
  - 账本冻结 / 结算 / 退款三事务 + 幂等键：`internal/credit/service.go:30`（Freeze）、`:70`（Settle）、`:89`（Refund）
  - 兑换码：`internal/redeem/service.go`
  - 提交阶段按序降级 + 熔断 + 并发闸：`internal/provider/router.go:193`（`SubmitForUsage`）
  - 异步任务 worker 推进、6 小时兜底：`internal/worker/worker.go:229`
  - 花费熔断、管理后台、RBAC、审计：见其 `nomi-service-doc.md` 附录 C
- 本仓已有的相关事实：自建中转覆盖矩阵 `docs/research/2026-09-03-self-hosted-relay-coverage-matrix.md`；apimart 策展接入 `docs/plan/2026-06-07-apimart-curated-onboarding.md`；客户端付费确认守卫 `electron/spendGrant.ts`。

结论：**不从零造**，在 Nomi-service 上补缺口（成本表、路由细化、两个额度桶、客户端接入）。

## ③ 生态里已有？

| 近邻 | 链接 | 拿什么 | 为什么不直接用 |
|---|---|---|---|
| new-api（约 4.9 万星） | <https://github.com/QuantumNous/new-api> | 资金来源接口 `service/funding_source.go`、异步任务失败退款 `service/task_billing.go:261`、违规费 `service/violation_fee.go`；issue 当坑清单（#7231 / #6095 / #5420 / #6722） | **AGPL-3.0**，闭源网关不能直接用其代码；它是「API 中转站」形态（卖 key），不是「桌面应用内置额度」形态 |
| OpenRouter 路由 | <https://openrouter.ai/docs/guides/routing/provider-selection> | 先排除最近 30 秒出故障的家，再比价 | 只做文本模型；按价格反平方随机加权，量小时不好对账 |
| LiteLLM Router | <https://docs.litellm.ai/docs/routing>（Context7 `/websites/litellm_ai` 核对） | 按异常类型分别设重试与熔断阈值，审核错误不计入熔断 | Python，文本为主，不覆盖异步视频任务 |
| ComfyUI Partner Nodes | <https://docs.comfy.org/tutorials/partner-nodes/pricing> · <https://support.comfy.org/articles/5846341390-how-credits-work-in-comfy> | 产品形态最像：开源本地软件 + 账户积分调付费模型（$1 = 211 积分，大致按官方价） | 闭源服务，无法复用 |
| DeepSeek 开放平台 | — | 赠送余额与充值余额分开、先扣赠送 | 模式借鉴 |
| Stripe 支付宝 / 微信支付 | <https://docs.stripe.com/payments/alipay> · <https://docs.stripe.com/payments/wechat-pay> | 接支付时用；马来西亚账户支持支付宝、不支持微信支付 | 本期不接（用户拍板只用兑换码） |
| Lago / OpenMeter 等开源计量计费 | — | 未深入：本期额度只是预付积分，Nomi-service 账本已覆盖；订阅 / 按量出账才需要它们 | 没有需求 |

上游契约与价格（R5）：apimart `GET /api/pricing/model`（<https://docs.apimart.ai/cn/api-reference/texts/qwen3.8-max/pricing.md>）、apimart 定价页；kie `POST api.kie.ai/client/v1/model-pricing/page`、[入门指南](https://docs.kie.ai/cn.md)（限流 10 秒 20 次、文件留 14 天）；z.ai [定价](https://docs.z.ai/guides/overview/pricing.md) 与[错误码](https://docs.z.ai/api-reference/api-code.md)。

## ④ TikHub 自媒体里怎么说？

**今天没查成**：本会话没有 TikHub 工具。只用网页搜索补了一条用户侧信号：kie 有「失败生成仍扣积分」的用户投诉（Trustpilot 与多篇 2026 评测），这直接进了方案 §4 第 4 条（失败计费要实测 + 每日对账）。

## 结论

**用已有**：在 Nomi-service 上补缺口，不引入 new-api（许可证与形态都不合）；路由策略借 OpenRouter 的「健康优先再比价」和 LiteLLM 的「按错误类型定策略」；额度借 DeepSeek / new-api 的「多资金来源」。自研的只有两块：成本表 + 按成本排序的路由（没有现成件覆盖「异步视频任务 + 两家中转」），以及 D1 拍板带来的跨仓对账测试。
