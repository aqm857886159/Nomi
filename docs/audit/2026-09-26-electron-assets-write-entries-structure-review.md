# electron/assets 结构评审：五个写入口，每条跨切规则都各判一次

> 状态：已完成（2026-09-26）· 触发：`check:symptom-cluster`——`electron/assets` 在 2026-09-21 到 2026-09-26 的 7 天里有 6 份根因合同
> 对应合同：
> `docs/fixes/2026-09-21-config-never-silently-lost.root-cause.json`、
> `docs/fixes/2026-09-24-asset-import-sharing-violation.root-cause.json`、
> `docs/fixes/2026-09-25-agent-run-node-state-single-owner.root-cause.json`、
> `docs/fixes/2026-09-25-build-artifact-url-in-project-data.root-cause.json`、
> `docs/fixes/2026-09-25-canvas-video-players-always-mounted.root-cause.json`、
> `docs/fixes/2026-09-26-asset-name-keeps-extension.root-cause.json`

## 六份合同，一个形状

`electron/assets` 往项目里写素材的入口有五扇：`writeAsset`、`writeDeterministicAsset`、`copyAssetFile`（经 `copyNativeFileToBucket`）、`moveAssetFile`、上传的 `persistUploadBytes`（`uploadContentStore.ts`），外加本地导入 `localFileImport` 和远端导入 `importRemoteAsset` 两条前置路。每条「素材落盘时该守的规矩」都是在其中一两扇门上各写一份：

| 合同 | 规矩 | 以前在哪判 | 漏掉的那一扇 |
|---|---|---|---|
| 09-26 扩展名 | 落盘名保住按字节嗅出的扩展名 | `uniqueAssetPath`、`writeDeterministicAsset` 各自 `parse` 后 `\|\| '.bin'` | 两扇都漏（截断发生在判扩展名之前） |
| 09-25 产物取回线路 | 供应商产物用同一组超时 / 字节上限 / 供应商线路 | 普通生成、另存、付费卡物化三处各写一份 | 付费卡那一处只给了 maxBytes |
| 09-24 共享冲突 | 素材已经发布之后，清理临时文件失败不许改写导入结局 | link / rename 各自一次性执行 | 所有写入口都没按 Windows 共享冲突退避 |
| 09-25 构建产物地址 | 项目数据只存稳定地址 | 引导这一个写入口 | 其他写入口，以及已经写进去的存量 |
| 09-25 视频海报 | 画布只画海报、交互时才建 `<video>` | 素材边界算了海报，节点卡没用 | 边界的承诺没有结构断言，随一次回滚静默丢失 |
| 09-21 配置不丢 | 读不出来 ≠ 文件不存在 | 13+ 个设置模块各自 `try { read } catch { DEFAULT }` | `downloadPrefs` 等把默认值写回盖掉了用户文件 |

所以这一层的问题不是某个函数写得差，而是**「素材落盘」这件事没有一条流水线**：命名、类型校验、取回、放置、sidecar、清理、广播，每扇写入口都自己排一遍顺序、自己决定哪步可以失败。加一条新规矩时，只会被加进作者当时手上的那一扇门。

## 这次收了什么（结构上的）

- 命名：`storedAssetFileParts` 是落盘名的唯一裁法，四扇经 `projectAssetStore` 的写入口都走它；上传路径按原名、不截断，已核过不受影响（09-26）。
- 取回：`providerMediaFetch.fetchProviderMedia` 是供应商产物取回的唯一线路（09-25）。
- 清理与重试：`scratchCleanup` / `retryOnSharingViolation` 让「已发布」之后的失败只记日志（09-24）。

这三条都已经各自有了 owner，但**「一扇新的写入口会不会绕开它们」仍然只靠作者自觉**。

## 下一步（进 TODO，不在这个 PR 里做）

把五扇写入口收成一条流水线：`名字 → 嗅类型 → 取字节 → 放置（唯一命名） → sidecar → 广播`，各写入口只提供「字节从哪来、落哪个桶」，其余步骤只有一份。配一条结构测试：`electron/assets/**` 里除流水线本身，不许直接 `fs.writeFileSync` / `renameSync` / `linkSync` 到 `assets/` 下。已登记为 TODO T-MD-13。

## 以后在 electron/assets 加规矩时先答一句

**这条规矩是不是每扇写入口都该守？** 是，就写进共享的那一步（今天是 `storedAssetFileParts` / `fetchProviderMedia` / `retryOnSharingViolation`，流水线落地后就是流水线），再用 `node scripts/door-map.mjs <那一步的符号>` 数一遍门，确认五扇都经过它。只改手上那一扇 = 没立。
