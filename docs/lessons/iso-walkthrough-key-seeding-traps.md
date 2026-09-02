# 隔离实例的 key / 设置组装三坑

> 📎 教训 · 首次记录 2026-08-25 · 状态：现行
> **触发场景**：隔离走查里报「No local text model is configured」、`hasApiKey=false`、或 key 看起来「解不开」；或你正准备手动拷设置文件去拼一个隔离环境；或你打算据此断定「只有装机版能解 key」。

**结论**：别手拷设置文件自拼隔离环境，用 `evals/lib/isoApp.mjs` 的 `prepareIsolation`。`hasApiKey=false` 不是解密失败的证据——**行为才是真相**。

## 三个坑

1. **`listVendors` 的 `hasApiKey=false` 只证「内存态里没有 key 记录」，不证解密失败**。`electron/catalog/catalogStore.ts:79` 是纯记录存在性判断。拿它当解密证据会误诊——2026-08-25 就是这么误判成「只有装机 Nomi 能解 key」并跑去找人要 key 的，随后被另一条走查用标准路径解密成功打脸。要判就直接试真动作（拆镜头 / 生成）。

2. **别手拷设置文件自拼隔离环境**：真实设置根下除 `model-catalog.json` 还有 `provider-adapters.json`、`generation-model-defaults.json`（文本大脑选择）、`system-prompts.json` 等，**漏一个就出「No local text model is configured」这类像 key 坏了的假象**。用 `evals/lib/isoApp.mjs` 的 `prepareIsolation`（付费验收已验证它 + dev electron 能解真 catalog 的 safeStorage key）。

3. **隔离必须四路全设**：`NOMI_ELECTRON_USER_DATA_DIR` / `NOMI_SETTINGS_DIR` / `NOMI_PROJECTS_DIR` / **`NOMI_CAPABILITY_DIR`**。最后这个 `_launchApp` / `ui-driver` 都不管，**漏了会和真实 Nomi 抢 `~/.nomi/capability-core` 的 advert/token，串库**。

## 另外两条

- `tests/ux/ui-driver.mjs` 已支持 `NOMI_UI_EXECUTABLE` 指打包版二进制（2026-08-25 在走查 worktree 打的本地补丁，若没进 `main` 需重打）。
- 厂商 key 可经 `modelCatalog.upsertVendorApiKey('apimart', { apiKey, enabled: true })` 种进隔离实例（与 text-brain e2e 的 `APIMART_API_KEY` env 同款路径）；key 只落隔离目录，销毁 iso 即消。

**出处**：`electron/catalog/catalogStore.ts:79`、`evals/lib/isoApp.mjs`（`prepareIsolation`）、`tests/ux/ui-driver.mjs`。

**相关**：[walkthrough-default-profile-is-isolated](walkthrough-default-profile-is-isolated.md)、[assert-you-are-in-the-situation-you-claim](assert-you-are-in-the-situation-you-claim.md)
