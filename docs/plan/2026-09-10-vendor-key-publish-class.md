# 2026-09-10 内置供应商「填 key 不解锁模型」——类根因修复方案

状态：🚧 进行中（实现已在 `fix/vendor-key-publish-class-20260910` 分支，未合入 main；R19 只称「已实现」）

> 用户反馈：「apimart 写入 key 没有和以前一样一次性打开所有模型」；追问确认**其它内置供应商也一样**。
> 用户拍板：「这部分模型我们以前是做过探测、测通了才加入的……如果已经确定通了，其实可以直接可以选、可以用。」
> 类别：`recurring`（R21 合同 docs/fixes/2026-09-10-vendor-key-publish-class.root-cause.json）。
> PR #720 的 `electron/catalog/directKeyCredential.ts` 只修了 18 家里的 apimart 一家；本方案把它做成类。

## 先查别人

完整报告：docs/research/2026-09-10-vendor-key-publish-class/prior-art.md（含第一步证据表与边界溯源表）。带出处条目：

1. **curated 模型确实逐家验证过**：机器化认证账本 docs/integration-certification/model-certification-ledger.json（66 条 / 7 家，四项证据 static/loopback/failureMatrix/mcpDryRun），门岗 scripts/check-model-certification-coverage.mjs:1-8；早期几家在契约文件里带日期实测注释（electron/catalog/volcengineVendor.ts:2-6 真实 probe 2026-06-19；electron/catalog/modelscopeVendor.ts:3-12 真实 E2E 出图；electron/catalog/replicate.ts:9-14 真生成实测 2026-06-28）。账本里 66 条中 43 条的 `live.blocker` 逐字是「not selected for live canary under the minimum-spend budget」——**blocked = 我们没花钱跑付费 canary，不是契约没通过**。
2. **`/v1/models` 不是 key 判据（两个方向的反例都在我们自己的证据里）**：假阴性 = apimart 对合法 key 恒 401（electron/vendor/vendorBaseFallback.ts:153 实测注释）；假阳性 = minimax `/v1/models` 回 HTTP 200 但同一 key 的最小生成 canary ECONNRESET（账本 blocker 原文）。生态共识是「列表 + 一次最小真实请求双通过」才算通：https://docs.aifast.hk/en/guides/openai-compatible-api 、https://wpnews.pro/news/openai-compatible-base-url-troubleshooting-7-checks-before-you-blame-the-sdk （均 2026-09-10 查）。对多数内置家「最小真实请求」= 一次付费生成，存 key 时不能替用户花钱 → 只能存 key 即发布 + 待首次使用验证。先例 docs/fixes/2026-09-07-relay-catalog-listing-is-not-liveness.root-cause.json 已判「列表 ≠ 可用」，但只落在雷达脚本，没落到凭据发布路径。
3. **边界溯源**：`529188045`(2026-08-28) 引入 `verificationPending` + 渲染层恒 `enabled:false`；`1aaf466b8`(2026-09-01, PR #304) 引入 key 写入即 de-publish；`ac2a23983`(2026-09-01, PR #391) 下沉到 `applyApiKeyUpsert`，正文自述「**当前无活 bug（显式写入点一律 enabled:true）**」——这条诚实不变量当时是兜底，后来渲染层唯一入口恒发 `enabled:false`（electron/catalog/rendererCatalogMutation.ts:158）把它变成了主路。
4. **不新造真相源**：curated 契约表已在 seedBuiltins.ts:523-577 手抄两份（reconcileModels 17 行 + reconcileMappings 17 行），本次收成一张登记表供 reconcile 与发布判据共用（P1）；发布守卫复用 generationProviderBootstrap.ts:62-67 与 seedBuiltins.ts:589；多段凭据声明复用 src/config/knownVendors.ts:29-45 的 `CredentialField`（火山语音两框，knownVendors.ts:222-244）。

## 一、机制：一次填 key 到底发生了什么

```
Settings 卡填 key
  → IPC → upsertRendererCatalogVendorApiKey            (rendererCatalogMutation.ts:136)
      → sanitizeRendererVendorApiKeyMutation 恒 enabled:false     (:158)
      → validateCandidateCredential                    (validateCandidateCredential.ts:14)
          · authType==='none'          → 当场 throw（火山语音的 key 存不进去，P0）
          · 其余全部                    → GET /v1/models 当判据（kie/runninghub/meshy/fal/runway/火山语音 上游没这路由）
          · 结果 pending 或 throw
      → upsertModelCatalogVendorApiKey → applyApiKeyUpsert        (catalogStore.ts:446)
          → !enabled || verificationPending
              → depublishVendorForDisabledCredential   (credentialPublication.ts:13) —— 整家 vendor.enabled = false
  → modelCatalogCache / usableVendorModel 按 vendor.enabled 过滤 → 该家模型从选择器与 agent 清单**全部消失**
  → 重启不自愈：seedVendor「存在即跳过」(seedBuiltins.ts:376-385)
  → 只有走完 certification（serviceCatalog）才翻回来
```

**类根因（缺失的不变量）**：内置供应商的**发布判据**被写成了 vendor 名的硬编码
（seedBuiltins.ts:590 `if (vendorKey !== APIMART) return false`），**验证判据**被写成了单一 HTTP 路由假设
（`/v1/models`）。两者都应当由**种子自己的声明**派生：契约在不在（curated 表）、能不能零成本探活（livenessProbe）。
只要还按名字/路由分派，下一家新接的供应商就会以同样方式再掉进来。

## 二、范围（改什么）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `electron/catalog/curatedVendorContracts.ts`（新） | 一张 `CURATED_VENDOR_CONTRACTS` 登记表：vendorKey → { models, mappings }。**唯一**真相源 |
| 2 | `electron/catalog/seedBuiltins.ts` | reconcile 两条循环改由登记表驱动（删 34 行手抄）；`hasBuiltinCuratedExecution` 删 apimart 硬编码，按登记表逐家判定 |
| 3 | `electron/catalog/builtinVendorSeeds.ts` | 新增 `keyValidation` 声明与 `credentialValidationStrategy()`；`builtinVendorScopeMatches` 去掉 direct-key 前置（三个既有调用点本就已被 `isBuiltinDirectKeyVendor` 早退保护，行为不变） |
| 4 | `electron/catalog/directKeyCredential.ts` | `promoteDirectKeyVendor` → `publishBuiltinCuratedVendor`，守卫从 vendor 白名单换成「有内置种子 + 无认证占用 + scope 匹配 + curated 契约完整」 |
| 5 | `electron/catalog/validateCandidateCredential.ts` | 验证按策略分派：`liveness-probe` / `model-list` / `first-use`；`first-use` 存 key 即发布，`revalidatePendingCredential` 对它不阻断（存量 pending 记录同样放行）|
| 6 | `electron/catalog/catalogStore.ts` | de-publish 触发条件收回「凭据停用」本义（去掉 `|| verificationPending`）——现有测试全部写 `enabled:false`，行为不变；新路径的 pending 不再连坐下架 |
| 7 | `electron/catalog/volcengineVendor.ts` | 火山语音声明 `keyValidation:'first-use'`；`authType:'none'` 不再让凭据写入当场 throw |
| 8 | `electron/catalog/replicate.ts` | 声明 `bespokeExecution`（见下「replicate 为什么不补 mapping」），「元素拆解」填 key 后可用（decomposeLayers.ts:54 要 `v.enabled`）|
| 9 | `electron/catalog/builtinVendorSeeds.invariants.test.ts`（新） | 三条装配期不变量（见四）|

## 三、不动项

- **不动 UI**（渲染层继续恒发 `enabled:false`，manualCertificationBoundary.test.ts:17 原样成立；启用决策全在主进程）。
- **不动** `electron/productionRun/**`、`electron/harness/**`（并行任务在改）。
- **不动**自定义 / 中转供应商（含阶跃星辰预设）的发布策略：它们没有代码拥有的 curated 契约，
  继续走 `/v1/models` + certification 晋升。现状与入口见「六」。
- **不动**认证（certification）本身：它从「发布前置」降为**可选信任层**，代码路径与晋升行为不变。
- **不动**默认关的本地家（ComfyUI / 本地文本 / Codex 本地 / Antigravity）：它们 `authType:'none'` 且无凭据写入路径，不受本改动影响。

## 四、三条装配期不变量（先验它会红）

- **(a)** `credentialMode === 'direct-key'` ⇒ 必须声明 `livenessProbe`（否则 direct-key 无零成本判据，会掉回 `/v1/models`）。
- **(b)** 带**代码拥有的执行契约**的家（登记表里有 curated 模型 + mapping，或种子声明了 `bespokeExecution`）
  ⇒ `hasBuiltinCuratedExecution` 对一份真播种的 catalog 必须返回 `true`。
- **(c)** 出现在 `src/config/knownVendors.ts` 且要用户填凭据的内置家 ⇒ 逐家跑「填 key → 凭据落盘 + 该家已发布」，
  一家都不能失败。

### replicate 为什么不补 curated mapping

任务书原拟「补 curated 行（模型 + mapping）」。对照 `electron/image/decomposeLayers.ts` 的真实调用后改了做法：
拆解是**多输出**（一次返回 N 张图层 URL），`replicate.ts` 顶注与
docs/plan/2026-06-28-element-decomposition-feature.md §3.1 都写明它**刻意不套单结果 runtime**，走独立 IPC。
编一条没人消费的 mapping 只会让 `qwen-image-layered` 出现在图片模型选择器里、点了就坏——那是拿假发布换体感。
正解是让种子把这种形态**说出来**（`bespokeExecution: { capability, path }`），发布判据认它。
这条声明目前只有 replicate 一例，但它是一类形态而非一家特例。

## 五、验收门

1. 三条不变量先红后绿（红的证据写进报告与合同 `class_regression_tests`）。
2. 逐家参数化单测：真实 `catalogStore` + 真实种子，填 key → 该家模型出现在 catalog 投影 / `usableVendorModel` 可选。
3. kie 这类无 `/v1/models` 的家：不打任何预检就存 key 并发布、模型回到投影，且 `revalidatePendingCredential` 不阻断执行。
4. 火山语音：`APP_ID:ACCESS_KEY` 存得进（不再 throw），vendor 发布。
5. replicate：发布后 `decomposeLayers` 的前置（`vendors.find(enabled)`）满足。
6. `pnpm run test:system:focused` + `pnpm run gates` 全过；单文件 ≤800 行；lint 棘轮不涨。

## 六、本轮不改但已核实的现状（另有可发现性任务）

- 自定义 / 中转供应商（「添加供应商」向导、阶跃星辰等预设）：入口 `src/ui/onboarding/CustomVendorManage.tsx`，
  凭据同样经 `upsertRendererCatalogVendorApiKey`，验证仍走 `/v1/models`（对 OpenAI 兼容中转是成立的判据），
  发布仍由 certification 晋升。它们没有代码拥有的 curated 契约，**不能**套用「存 key 即发布」，否则就是拿假发布换体感。

## 六之二、与任务书的两处偏离（都在报告里说明）

1. **replicate 不补 curated mapping**，改为种子声明 `bespokeExecution`——理由见上节。
2. **first-use 不挂 `verificationPending`**。任务书原拟复用它表达「待首次使用验证」。
   实核后放弃：该标记在本仓的语义与 UI 文案逐字是「这次没验成，**之后还会再验**」
   （`src/i18n/locales/onboardingProviders.ts:380-381`「已保存 · 未验证 / 联网后会自动复验，下次调用前也会先检查一次」），
   而对这一类我们不会再验——没有可验的便宜端点。挂上它等于让 12 家常驻一句做不到的承诺，
   并把接入卡上的「N 个可使用」永久换成「未验证」（`ModelSettingsHome.tsx:228`）。
   那还是名实不一，只是换了个方向；而本轮硬约束是不动 UI，改不了那句文案。
   代价（保存态没有「未验证」提示）已写进合同 `residual_risks`。
   `revalidatePendingCredential` 里对 first-use 的放行**保留**：存量装机里还有本次改动之前写下的 pending 记录。

## 六之三、任务书里一条**没做**的项及理由

任务书要求「`vendorHealth.ts` 探测成功清标记时同步 re-publish（现在只清标记不发布）」。
实核后**没做**：那条清理只在 `res.ok` 时执行，而今天唯一会留下 pending 凭据的内置家是 apimart
（liveness-probe 遇网络抖动），它的 `/v1/models` 恒 401 → `res.ok` 永假，这条路不可达；
自定义 / 中转行的 pending 本就该由认证晋升发布，不该在这里发布。
预先写一段今天跑不到、也没法诚实测到的代码违反 P1。
提醒改放在 `VendorSeed.keyValidation` 的 `model-list` 档注释里——第一个声明该档的人会先读到它，
并已列入合同 `residual_risks`。

## 七、回滚

单 commit 可整体 revert：改动全部集中在 `electron/catalog/**` 与新增测试，无迁移、无落盘 schema 变更、无 UI 改动。
回滚后行为回到「只有 apimart 填 key 解锁」。用户已保存的凭据不受影响（本改动只影响 `vendor.enabled` 的翻转时机）。
