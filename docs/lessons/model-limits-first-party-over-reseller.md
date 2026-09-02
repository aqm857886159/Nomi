# 中转平台的上限 ≠ 模型的上限

> 📎 教训 · 首次记录 2026-08-20 · 状态：现行
> **触发场景**：要把某个模型的数量上限 / 参数范围钉进共享档案（archetype）时；只在中转或聚合平台（fal / kie / apimart / piapi…）的文档页上看到某个限制数字时；看到「合计上限」这类总量约束时。

**结论**：中转 / 聚合平台页面上的限制，**不一定是模型的限制**，可能是那家自己加的封装约束，比模型真实能力更紧。共享档案上只钉**模型级**的数字，一手出处优先于转述。

**为什么会踩**：

2026-08-20 实例：fal 的 Seedance 2.0 页写 `"Total files across all modalities must not exceed 12."`，看着像官方约束。实查下来——**火山方舟（字节自家平台）写的是 15（9 图 + 3 视频 + 3 音频）**，APIMart 全文无此条，另一家无公开文档。而且 `electron/catalog/` 里**根本没有 fal 这个渠道**——照一个我们不用的中转的收紧值去钉档案，等于凭空掐窄模型能力。

更关键的一个识别信号：方舟的 15 恰好 = 9 + 3 + 3，**合计上限等于各槽之和 = 永不咬合**（2.5 同理，50 = 30 + 10 + 10）。这种约束加进代码就是死代码。照 12 钉进档案则会重演 2026-08-12 那次 9/3/3 vs 30/10/10 的错配。

中转文档不可靠的机制：它是**转述**，会漏、会错、会加私货，也会陈旧——fal 的 2.5 页仍写「音频需配图 / 视频」，而字节和 APIMart 都已写明 2.5 支持纯音频，fal 那句是旧拷贝。

**怎么用**：
- **字节系模型（Seedance / Seedream / 豆包）的一手出处 = 火山方舟** `docs.volcengine.com/docs/82379/...`。其能力概述表（如 2607688）会并列各代各变体的参数，一页顶三页，**优先抓它**。
- 判据用仓库既定那条：**三家一致才算模型级、才该钉在共享档案上**（见 `seedance25Contract.test.ts` 头部）。不一致时**以模型厂商自家平台为准**，中转的收紧值别往共享档案上钉。
- 遇到「合计上限」这类数字，先算它是否等于各分项之和——**相等 = 不咬合 = 别加**。
- **否定结论也要钉成测试**（负向钉子 + 出处），否则下一个人看到同一个中转页又来补一遍。
- `sources.url` 会烂：apimart 的 `/cn/api-reference/videos/doubao-seedance-2-5` 已 404，现行是 `/en/api-reference/videos/seedance-2-5/generation`。`check:archetype-sources` **只查字段在不在，查不出 URL 死没死**，复核时顺手抓一次。

**出处**：2026-08-20 实查 fal / 火山方舟 / APIMart 三方文档；`seedance25Contract.test.ts`。相关 [`assert-you-are-in-the-situation-you-claim.md`](assert-you-are-in-the-situation-you-claim.md)、[`kie-file-upload-real-contract.md`](kie-file-upload-real-contract.md)。
