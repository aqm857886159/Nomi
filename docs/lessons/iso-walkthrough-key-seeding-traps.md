# 隔离实例的 key / 设置组装五坑

> 📎 教训 · 首次记录 2026-08-25 · 状态：现行
> **触发场景**：隔离走查里报「No local text model is configured」、`hasApiKey=false`、或 key 看起来「解不开」；或你正准备手动拷设置文件去拼一个隔离环境；或你打算据此断定「只有装机版能解 key」。

**结论**：别手拷设置文件自拼隔离环境，用 `evals/lib/isoApp.mjs` 的 `prepareIsolation`（凭据位置与拷法的唯一 owner 是 `tests/ux/_realProfile.mjs`）。`hasApiKey=false` 不是解密失败的证据——**行为才是真相**。

## 五个坑

1. **`listVendors` 的 `hasApiKey=false` 只证「内存态里没有 key 记录」，不证解密失败**。`electron/catalog/catalogStore.ts:79` 是纯记录存在性判断。拿它当解密证据会误诊——2026-08-25 就是这么误判成「只有装机 Nomi 能解 key」并跑去找人要 key 的，随后被另一条走查用标准路径解密成功打脸。要判就直接试真动作（拆镜头 / 生成）。

2. **别手拷设置文件自拼隔离环境**：真实设置根下除 `model-catalog.json` 还有 `provider-adapters.json`、`generation-model-defaults.json`（文本大脑选择）、`system-prompts.json` 等，**漏一个就出「No local text model is configured」这类像 key 坏了的假象**。用 `evals/lib/isoApp.mjs` 的 `prepareIsolation`（付费验收已验证它 + dev electron 能解真 catalog 的 safeStorage key）。

3. **隔离必须四路全设**：`NOMI_ELECTRON_USER_DATA_DIR` / `NOMI_SETTINGS_DIR` / `NOMI_PROJECTS_DIR` / **`NOMI_CAPABILITY_DIR`**。共享 `_launchApp` 已为隔离实例派生 capability 目录；若另起 MCP helper，仍须给双方同一个目录，不能各自派生。2026-09-09 起启动器按显式参数 > env > 派生解析（此前 env 会被派生值覆盖，见 [启动器默认值不能覆盖调用配置](launcher-defaults-must-not-override-env.md)）。绕开共享启动器且漏设会与真实 Nomi 抢 `~/.nomi/capability-core` 的 advert/token，串库。

4. **Windows 上「凭据」是两份文件，不是一份**（2026-09-26 Windows 真机补）。safeStorage 在 macOS 的钥匙住系统钥匙串（同机同 app 名即可解），Windows 的钥匙却是 userData 里的 **`Local State`**（`os_crypt.encrypted_key`，DPAPI 绑当前用户）。只拷 `model-catalog.json`，隔离实例首启会新生一把钥匙，拷过去的密文成死数据。真实资料目录在哪、钥匙是哪几份文件，只问 `tests/ux/_realProfile.mjs` 的 `realNomiProfile`；往副本里带凭据只走 `seedRealCredentials` / `seedRealModels`（钥匙必须放进 App **真正用的那个** userData，`launchNomiApp` 要显式传同一个 `userDataDir`）。花钱前让 App 自己答「能不能用」（`_paidRun.mjs` 的 `lockToAuthorizedModels` 读主进程可用性），别拿 `hasApiKey` 判。
5. **目录是一族文件**：App 升级目录版本时在旁边留 `model-catalog.bak.json` / `model-catalog.v<旧版>.bak.json`，里面是同样的 key 密文。收尾只删主文件等于没删——用 `removeRealCredentials`（删整族 + 钥匙）。

## 另外两条

- `tests/ux/ui-driver.mjs` 已支持 `NOMI_UI_EXECUTABLE` 指打包版二进制（2026-08-25 在走查 worktree 打的本地补丁，若没进 `main` 需重打）。
- 厂商 key 可经 `modelCatalog.upsertVendorApiKey('apimart', { apiKey, enabled: true })` 种进隔离实例（与 text-brain e2e 的 `APIMART_API_KEY` env 同款路径）；key 只落隔离目录，销毁 iso 即消。

**出处**：`electron/catalog/catalogStore.ts:79`、`evals/lib/isoApp.mjs`（`prepareIsolation`）、`tests/ux/ui-driver.mjs`、`tests/ux/_realProfile.mjs`（第 4、5 坑，Windows 真机付费走查实测）、`tests/ux/canvas-follow-hand/session.mjs` 的 `seedPlaceholderKey` 注释（Local State 来不及落盘即解不开）。

**相关**：[walkthrough-default-profile-is-isolated](walkthrough-default-profile-is-isolated.md)、[assert-you-are-in-the-situation-you-claim](assert-you-are-in-the-situation-you-claim.md)
