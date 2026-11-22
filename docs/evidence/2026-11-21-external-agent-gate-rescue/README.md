# 外部助手交卡后走到确认卡 · 修前修后真窗口两遍（2026-11-21）

走查：`tests/ux/mcp-declared-model-gate.e2e.mjs`（真 Electron 开发构建，测试网闸开着，假密钥，两张确认卡都点「忽略」，生成请求 0）。

| | 哪份代码 | 结果 | 原始输出 |
|---|---|---|---|
| 修前 | 主分支 b75325253 的构建（走查脚本从本分支拷过去） | 退出 1：应用内宿主交卡、起草都成功，**预览回 `Unknown model: muse-video-x`**，中间没有重启 | `walk-before-main.txt` |
| 修后 | 本分支 7b2af07b7 的构建 | 退出 0：两个宿主各走一遍，17 条断言全过，都不重启走到确认卡 | `walk-after-fix.txt` |

截图（修后，中文界面）：`01-inapp-confirm-card.png` 应用内宿主、`02-stdio-confirm-card.png` 独立进程宿主——确认卡上的模型分别是 `apimart/muse-video-x`、`apimart/muse-video-y`，费用「未知」，有「忽略」「确认生成」两个按钮。

没做：英文界面没走；没有真付费。旧资料冷启动见下一节。

## 四份 0.24.0 旧资料真窗口冷启动（658f0ef6f）

同一份走查加 `NOMI_WALK_OLD_USER_FIXTURE=<目录名>`：把 `tests/fixtures/old-user-data/builtin-connection/` 下的那份旧资料拷进隔离资料目录，再冷启动真窗口。应用内宿主走老用户那一段，独立进程宿主随后照常接一个新模型（`muse-video-y`）走到确认卡。测试网闸开着，假密钥，确认卡都点「忽略」，生成请求 0。

| 旧资料 | 结果 | 盘上的素材上传方式（冷启动后、存密钥前读盘） | 截图 |
|---|---|---|---|
| `v0.24.0-builtin-plain` | 退出 0，17 条断言 | 本来就没被改 | 00-old-builtin-image-confirm-card.png |
| `v0.24.0-builtin-card` | 退出 0，22 条断言 | 卡写的「none」→ 空（回到内置） | 00-old-builtin-image-confirm-card.png、00-old-card-model-confirm-card.png |
| `v0.24.0-builtin-card-later-builtin` | 退出 0，22 条断言 | 卡写的「none」→ 空（回到内置） | 00-old-builtin-image-confirm-card.png、00-old-card-model-confirm-card.png |
| `v0.24.0-builtin-whole-deleted` | 退出 0，19 条断言 | 本来就没被改 | 00-old-builtin-image-confirm-card.png |

每份都核了：冷启动后连接地址没动；内置图片模型 `doubao-seedream-4.5` 走到确认卡；有旧卡的两份，旧卡模型（`muse-video-x`、`flux-3-video`）也走到确认卡；整家删过的那份，起草先被拒，回话说是用户删的、存密钥就回来，存一次密钥后内置模型走到确认卡。原始输出 `old-user/<目录名>/walk.txt`，前后对照 `summary.json`。截图我逐张看过：确认卡上的模型名和上面一致，费用「未知」。

**这一段没验到的**：老用户升级后**不用重填密钥**就能接着生成。旧资料是生成器在 0.24.0 的导出里用假加密写的（`generators/zzBuiltinCardGen.ts.txt` 把系统钥匙串换成了直接转码），不是真 0.24.0 应用写出的盘；真窗口的系统钥匙串解不开它（第一遍走查日志里 8 条 `api-key-decrypt-failed`，过门回「没就绪」）。真密文绑机器，进不了仓库。所以走查在读完盘之后重存了一次同一把假密钥再往下走。这一条只在单测里（同一种假加密）证过。这次修复不改密钥的存和读：核过对主分支的生产改动，`electron/catalog/secrets.ts`、`electron/catalog/credentialBinding.ts` 不在改动里；`electron/catalog/catalogStore.ts` 只在存密钥成功之后多了一句「整家删过的就种回来」，没有一行读写密钥记录本身。

并主分支之后原来那遍两个宿主的走查也重跑了：`walk-after-fix-merged.txt`。
