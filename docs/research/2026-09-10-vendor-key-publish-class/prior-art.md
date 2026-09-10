# 2026-09-10 内置供应商「填 key 不解锁模型」类根因 · 先查别人报告

> 方案：docs/plan/2026-09-10-vendor-key-publish-class.md
> 用户反馈：「apimart 写入 key 没有和以前一样一次性打开所有模型」，追问后确认**其它内置供应商也一样**。
> 用户拍板（2026-09-10）：「这部分模型我们以前是做过探测、测通了才加入的……如果已经确定通了，其实可以直接可以选、可以用。」
> 本报告先回答「以前到底测过没有、证据在哪」，再回答「别人怎么做」。

## ⓪ 第一步证据表：curated 模型是凭什么进种子的

**机器化的认证账本**：`docs/integration-certification/model-certification-ledger.json`（66 条 / 7 家），
门岗 `scripts/check-model-certification-coverage.mjs:1-8`（零额度静态门，只核对证据引用与身份，不打供应商），
方案 docs/plan/2026-08-30-unified-model-integration-certification.md、交接 docs/handoff/2026-08-30-provider-model-expansion-unified-certification-handoff.md。

| vendorKey | 证据 | 出处 |
|---|---|---|
| apimart | 真 key 端到端核验（tests/transport-spike/apimart.mjs），12 模型精确契约附录 A | electron/catalog/apimartVendor.ts:1-14；docs/plan/2026-06-07-apimart-curated-onboarding.md |
| kie | 直连实测确认的契约（GPT Image 2 文生图）+ 账本 8 条（2 条 live-certified） | electron/catalog/kieSeedance.ts:1-15；electron/catalog/kieGptImage2.ts:1-6 |
| volcengine | 真实 probe 验证 2026-06-19（用户 key，逐端点形状） | electron/catalog/volcengineVendor.ts:2-6；docs/plan/2026-06-19-modelscope-volcengine-onboarding.md |
| volcengine-speech | 实查 openspeech 官方文档 + 接入手册 2026-06-24（三头鉴权逐项） | electron/catalog/volcengineVendor.ts:22-28；docs/plan/2026-06-24-volcengine-seedance-video.md |
| modelscope | 真实 E2E 2026-06-19（用户 key，Z-Image-Turbo / Qwen-Image-2512 出图） | electron/catalog/modelscopeVendor.ts:3-12 |
| runninghub | 实查官方文档 + 开源插件源码 HM-RunningHub/ComfyUI_RH_OpenAPI core/task.py | electron/catalog/runninghub3d.ts:5-9；docs/plan/2026-06-27-runninghub-aggregator-onboarding.md |
| replicate | 实查 + **真生成实测固化 2026-06-28**（Prefer:wait 同步 9-13s 出图） | electron/catalog/replicate.ts:9-14；docs/plan/2026-06-28-element-decomposition-feature.md |
| agnes | 官方文档逐条对账（2026-08-26 checkedAt），两个 quirk 照搬 | electron/catalog/agnesImages.ts:1-8；docs/plan/2026-06-30-agnes-ai-onboarding.md |
| minimax / elevenlabs / meshy / fal / runway | 账本四项证据 `static`/`loopback`/`failureMatrix`/`mcpDryRun` 全 `passed`，每条带官方 URL + checkedAt | docs/integration-certification/model-certification-ledger.json |
| dreamina | 本地 CLI 登录态，非 HTTP key（不在本轮发布判据内） | electron/catalog/dreaminaVendor.ts:1-6 |

**账本里 `live.status: blocked` 的真实含义**（逐条统计，非印象）：66 条里 43 条的 blocker 逐字是
`"… key was available for this run; this mapping was not selected for live canary under the minimum-spend budget."`，
另有 `"… API key is not configured; no paid canary was attempted."`。
**blocked = 我们没花钱跑付费 canary，不是契约没通过。** 这正是用户自己的 key 能解除的那个条件。

**结论：证据成立**——curated 模型确实是「先实查官方契约 / 实测形状、再进种子」的，且有机器门岗守着证据引用。
故按用户拍板推进第二步（若这张表当时是空的，任务书要求停下——它不是空的）。

## ① 「填 key 先停用、认证后才发布」这条边界是谁引入的、当时为什么

| commit | 日期 | PR | 引入了什么 | 当时理由（commit 正文原话摘要） |
|---|---|---|---|---|
| `529188045` | 2026-08-28 | 会话式接入边界 | `verificationPending` 语义 + `sanitizeRendererVendorApiKeyMutation` 恒 `enabled:false` | 会话式认证接管晋升 |
| `1aaf466b8` | 2026-09-01 | #304 | 渲染层 key 写入时 de-publish 已启用 vendor | 「REALTEST 复现的『粘 key 显示已接入实际不可用』……不变量靠各调用点自觉配对 = 契约不安全」 |
| `ac2a23983` | 2026-09-01 | #391 | 不变量下沉到 `applyApiKeyUpsert`（store 最内层），渲染层那份同 commit 删除 | 「主进程六个凭据写入点全部绕过……**当前无活 bug（显式写入点一律 enabled:true）**」 |
| `af99139b8` | 2026-09-10 | #720 | direct-key（仅 apimart）验证改 livenessProbe + verified 后 promote | 本类根因的第一刀，只覆盖 18 家里的 1 家 |

**关键读法**：`ac2a23983` 的正文自述「当前无活 bug，因为显式写入点一律 enabled:true」。
它下沉的是一条**诚实不变量**（凭据停用 ⇒ vendor 退出发布投影），本身没错；
错的是后来渲染层唯一入口恒发 `enabled:false`（rendererCatalogMutation.ts:158），
于是这条不变量从「兜底」变成了「主路」——**每一次内置供应商填 key 都必然触发整家下架**。
诚实门要防的是「显示已接入但不可用」；现在的实际效果是反向的「明明可用却整家藏起来」，
同样是名实不一，且更难自愈（`seedVendor` 存在即跳过，重启不回来：seedBuiltins.ts:376-385）。

## ② 依赖里已有？

- 没有现成依赖能替我们回答「这家供应商的 key 有效吗」。生态里唯一通用做法是打某个自家端点，
  下面 ③ 说明这条判据本身就不可移植。**结论：不引入新依赖。**

## ③ 仓库里已有？（复用，不新造真相源）

1. **curated 契约表**：`seedBuiltins.ts:523-577` 已有 17 行 `reconcileModels` + 17 行 `reconcileMappings` 逐家调用，
   两份手抄清单描述的是同一件事「这家有没有代码拥有的 curated 契约」。本次把它们收成**一张 `CURATED_VENDOR_CONTRACTS` 登记表**，
   reconcile 两条循环与发布判据 `hasBuiltinCuratedExecution` 共用同一张表（P1：删掉两份手抄，不留并行版）。
2. **发布守卫三件套**：`generationProviderBootstrap.ts:62-67`（scope 匹配 + 无认证占用）与
   `seedBuiltins.ts:589`（curated 契约完整）已是现成判据，`promoteDirectKeyVendor`（directKeyCredential.ts:88-99）已在用；
   本次只是把它的 vendor 白名单换成「种子声明驱动」，**不新写守卫**。
3. **livenessProbe 声明**：`builtinVendorSeeds.ts:48-52` 类型 + `apimartVendor.ts:29-33` 实例（带官方 URL + checkedAt），
   消费方 `scripts/model-liveness.ts` 与 `directKeyCredential.ts:43` 同一声明。本次继续复用，不加第二份探测定义。
4. **渲染层 enabled 边界**：`src/ui/onboarding/manualCertificationBoundary.test.ts:17` 锁「渲染层不得传 enabled:true」。
   本次**不动渲染层**，启用决策全部留在主进程验证结果里——该边界测试原样成立，不改测试去迁就实现。
5. **多段凭据声明**：`src/config/knownVendors.ts:29-45` 的 `CredentialField` 已是「档案声明槽、通用系统填」的成品
   （火山语音 App ID / Access Token 两框，保存时拼 `APP_ID:ACCESS_KEY` 存单槽，knownVendors.ts:227-243）。
   缺的只是主进程一条能接住 `authType:'none'` 的验证分支（validateCandidateCredential.ts:15 当场 throw）。

## ④ 生态里已有？（`/v1/models` 到底能不能当 key 判据）

- OpenAI 兼容生态的排查共识是「先打 `/v1/models`，再发一个最小非流式请求，**两者都过**才算通」：
  - https://docs.aifast.hk/en/guides/openai-compatible-api （2026-09-10 查）
  - https://wpnews.pro/news/openai-compatible-base-url-troubleshooting-7-checks-before-you-blame-the-sdk （2026-09-10 查）
- **两个方向的假判断，证据都在我们自己的账本里**：
  - **假阴性**：apimart 的 `/v1/models` 对合法 key 恒 401（一手证据 `electron/vendor/vendorBaseFallback.ts:153` 实测注释），
    而同一 key 直连生成没问题 → 判成「key 无效」。
  - **假阳性**：minimax 的 `/v1/models` 对我们的 key 回 **HTTP 200**，但同一 key 的最小生成 canary
    `POST /v1/t2a_v2` 根本没跑到任务就断（账本 blocker 逐字：`"MiniMax credential probe authenticated against api.minimaxi.com /v1/models (HTTP 200). The minimum speech transport canary ended with ECONNRESET…"`）→ 判成「key 有效」也不成立。
  - **结论：`/v1/models` 既不充分也不必要，对内置 curated 家根本不是它们的鉴权面。**
    生态共识里真正的终判是「一次最小真实请求」，而对多数内置家（kie / runninghub / meshy / fal / runway / 火山语音）
    最小真实请求就是**一次付费生成**——不能在存 key 时替用户花钱。
    故正路只有两条：种子声明了零成本存活探测的（apimart）就探；没有的就**存 key 即发布 + 标「待首次使用验证」**，
    首次真实生成时的鉴权失败走现有诚实报错。这与 R31「对齐事实标准」一致：
    我们不自造「列表可达 = key 有效」这条业内并不成立的判据（先例已判：docs/fixes/2026-09-07-relay-catalog-listing-is-not-liveness.root-cause.json「列表 ≠ 可用」，
    但那条只落在雷达脚本，没落到凭据发布路径——本次补的正是这个缺口）。

## ⑤ TikHub 自媒体

沿用 2026-09-10 同日已跑的检索结论（docs/research/2026-09-10-ux-feedback-fixes/prior-art.md「④」节：
`openai compatible api key 验证 401 models`，80 条，**有效信号 0 条**）。同一议题同一天，不重复烧检索额度；
自媒体对这类基础设施议题只有官方排查教程的二手转载，不改变 ④ 的结论。

## 结论

- 不引入新依赖；不新写守卫；把 18 家的发布判据从**硬编码 vendor 名**改成**种子声明驱动**，并删掉两份手抄的 curated 清单。
- 验证判据按种子声明分派：有零成本探测就探，没有就存 key 即发布 + 待首次使用验证——不拿 `/v1/models` 当鉴权面。
