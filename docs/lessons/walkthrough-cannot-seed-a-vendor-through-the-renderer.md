# 走查里种供应商：渲染层 bridge 种不出「能用」的那一家

> 📎 教训 · 首次记录 2026-09-12 · 状态：现行
> **触发场景**：走查/夹具里出现 `modelCatalog.upsertVendor({ enabled: true })`、
> `upsertModel({ enabled: true })` 或 `upsertVendorApiKey(key, { enabled: true })`；
> 或某条走查里模型永远 `vendor_disabled` / `model_disabled`，而你开始怀疑 IPC、持久化或加密。

**结论**：渲染层的目录写入是**配置**，不是**发布**。想在走查里造出一家「真能用」的供应商，
只有两条真路：① 用**内置种子已有**的家（种子已经把 vendor + 预置模型播好，用户只差粘一次 key）；
② 在 app 关着的时候往隔离 profile 的 `model-catalog.json` 里补主进程才写得出的那种行
（MCP / 认证会话写的行），再冷启动让主进程自己读。

## 为什么

`electron/catalog/rendererCatalogMutation.ts` 三个 sanitize 各按下一次 `enabled`：

| 入口 | 规则 |
|---|---|
| `sanitizeRendererVendorMutation` | 这家没有已发布模型时，`enabled: true` → `false` |
| `sanitizeRendererModelMutation` | 新模型强制挂 `meta.adapter={state:'unverified'}`，未发布则 `enabled` → `false` |
| `sanitizeRendererVendorApiKeyMutation` | 渲染层传的 `enabled` 恒 `false`（`manualCertificationBoundary.test.ts` 锁着）；发布与否只由主进程验证结果决定 |

这是设计：认证（或内置 direct-key 契约）才拥有「发布」这一步。真实设置卡传的本来就是
`upsertVendorApiKey(vendorKey, { apiKey, enabled: false })`——**走查传 `enabled: true` 比产品还越权，
而且照样被改成 false**。

## 它怎么骗过一条走查（2026-09-12 实例）

`tests/ux/model-availability-agreement.walk.mjs` 初版用 bridge 捏了一家 loopback 供应商，
第一阶段断言「没钥匙 ⇒ 0 个可用」——**过了**。但那 0 的理由是 `vendor_disabled`（这家从没被启用过），
不是 `credential_missing`。于是「填上钥匙 ⇒ 变可用」那一步永远红，排查方向被带去 IPC 和持久化。
这就是 [断言前先证明你在你以为的现场](assert-you-are-in-the-situation-you-claim.md) 的第 N 个变种：
**答案对、理由错**。所以这类走查要逐字断言 `availability.reason`，不要只数「可用数 = 0」。

## 顺手记两条

- 挑内置家做夹具时看**种子怎么验 key**：带 `livenessProbe` 的（apimart）存 key 会真打上游，
  假 key 直接 401 抛错；`credentialValidationStrategy` 判 `first-use` 的（魔搭社区等）存 key
  不发任何请求，零额度零网络，最适合走查。
- 冷重启走查（`app.close()` 后同 profile 再 `launchNomiApp`）曾在**热启动**上必挂：
  启动期 `index.html → index.html#/studio` 那次路由改写正好落在启动器绑窗口几何的两行之间，
  报成 `jsHandle.evaluate: Execution context was destroyed`。启动器现在先等路由落地
  （`tests/ux/_launchApp.mjs` 的 `waitForURL(/#\//)`）；看到这条报错别去怀疑自己的 profile。

**出处**：`electron/catalog/rendererCatalogMutation.ts`、`electron/catalog/validateCandidateCredential.ts:30`、
PR #765 走查返工。

**相关**：[assert-you-are-in-the-situation-you-claim](assert-you-are-in-the-situation-you-claim.md)、
[iso-walkthrough-key-seeding-traps](iso-walkthrough-key-seeding-traps.md)、
[walkthrough-repair-probe-first](walkthrough-repair-probe-first.md)、
[walkthrough-no-win-reload](walkthrough-no-win-reload.md)
