# 2026-09-10 UX 反馈修复（B1+B2）· 先查别人报告

> 方案：docs/plan/2026-09-10-ux-feedback-triage.md（B1 单点小修 8 条 + B2 apimart direct-key 模型接入修复）。
> 本报告按模板四问复核每类修法「别人做过没有」，结论抄进方案「## 先查别人」节。

## ① 依赖里已有？

- **popover 点外关闭**：仓库设计系统未提供通用 popover 原语（`src/design/` 只有 AnchoredPopover/NomiSelect），V4 composer 的弹层是手写 absolute 定位（src/workbench/ai/v4/AgentPanelV4Composer.tsx:160-164），不在 Radix/Mantine 的 dismissable 管理内。NomiSelect（Mantine Combobox，`src/design/NomiSelect.tsx:134-142` withinPortal）自带点外关闭，但它是下拉不是任意内容弹层。**结论：手写 outside-close 是当前依赖面内最短正路**（引入 Radix Popover 违反 framework-boundary 门岗「框架已提供的不许再长一份」的反向约束——此处框架没提供，但为一个 8 行监听引入新依赖不成比例）。
- **textarea 软换行自适应高度**：无现成组件（AI Elements PromptInput 未接高度自适应）；社区标准做法即 scrollHeight 实测 + max 封顶（与本次实现一致）。

## ② 仓库里已有？

- **软换行行数**：`agentPanelV4Logic.ts` 原本只数硬换行（`value.split('\n').length`，composer `:126`）；本次新增 `rowsFromContentHeight` 复用同一套 `useComposerHeight` 规则与常量（`COMPOSER_LINE_HEIGHT`/`TEXT_PADDING`），没有第二套高度真相源。
- **livenessProbe 判据**：种子里已有代码拥有的存活探测声明（`electron/catalog/builtinVendorSeeds.ts:48-53` 类型、`electron/catalog/apimartVendor.ts:29-33` apimart 实例，带官方文档出处 `successPath: "choices.0"`），消费方只有每周雷达 `scripts/model-liveness.ts:27-50`。本次验证复用**同一声明**，没有第二份探测定义（P1）。
- **direct-key 发布守卫**：`generationProviderBootstrap.ts:62-67` 的 `hasSafeDirectKeyScope`（scope 匹配 + 无认证占用）与 `seedBuiltins.ts:587` 的 `hasBuiltinCuratedExecution` 是现成判据，promoteDirectKeyVendor 直接复用，零新真相源。
- **渲染层 enabled 边界**：`manualCertificationBoundary.test.ts:17` 已锁「渲染层不得传 enabled:true」——本次不动渲染层，启用决策全部收在主进程验证结果里，边界测试原样通过。

## ③ 生态里已有？

- **key 验证判据：/v1/models 可达性 ≠ key 有效性，最小 chat 请求才是公认验收**。OpenAI 兼容生态的排查共识是「先打 /v1/models，再发一个最小非流式请求，两者都过才算通」：
  - AIFast OpenAI-Compatible API 教程（四步验收，`/v1/models` + short non-streaming request 缺一不可）：https://docs.aifast.hk/en/guides/openai-compatible-api（2026-09-10 查）
  - Web Pulse「7 Checks Before You Blame the SDK」：401 排查顺序 + `max_tokens=20` 的一发小请求作端到端判据：https://wpnews.pro/news/openai-compatible-base-url-troubleshooting-7-checks-before-you-blame-the-sdk（2026-09-10 查）
  - 但部分聚合商的 `/v1/models` 对合法 key 也回 401（需要鉴权的模型列表端点），apimart 即如此——仓库一手证据 `electron/vendor/vendorBaseFallback.ts:153` 注释（2026-09-08 前后实测），官方 chat 端点契约 https://docs.apimart.ai/en/api-reference/texts/general/chat-completions-nostream.md（apimartVendor.ts:32 带 checkedAt）。**结论：验证策略必须 per-vendor 分派，direct-key 用种子声明的一次 max_tokens:1 真实探测，certification 维持 /v1/models——与生态「最小真实请求是最终判据」一致，且比无差别打 /v1/models 更诚实。**
- **direct-key「填 key 即解锁」模式**：本仓设计文档 `docs/plan/2026-06-07-apimart-curated-onboarding.md` 早已确立该契约（apimartVendor.ts:25-27 注释引用）；本次是把后来加的认证独占诚实门补上它应有的 direct-key 分支，不是新模式。

## ④ TikHub 自媒体里怎么说？

### 2.3 自媒体来源（TikHub · 必填）

已跑 TikHub 检索（`node scripts/research/tikhub-search.mjs --q "openai compatible api key 验证 401 models"`，2026-09-10，产物在 `tikhub/tikhub-search.md`）：抖音/小红书/B站/X 共 80 条。**有效信号：0 条**——返回多为 OpenAI 模型发布/行业新闻，无一条讨论「key 验证该用什么判据」；自媒体对这类基础设施议题的讨论是 ③ 中官方排查教程的二手转载，不改变结论。direct-key 分支的真实 key 端到端验收仍列入合同 residual_risks 与方案验收门（填 key → 列表出现 → agent 可选 → 真实生成一张）。

## 结论

- B1 各单点：用仓库既有规则层/常量/组件改造（无并行版、无新依赖），自研部分均为 <30 行的局部标准做法。
- B2：**复用已有 livenessProbe 声明 + 复用 bootstrap 同名守卫**，在唯一汇合点按 credentialMode 分派；生态证据支持「最小真实请求」判据。无需引入新依赖，无需自造新协议。
