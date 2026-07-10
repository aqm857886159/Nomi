# 参考捕捞窗（PR#33 重做规格的我方落地 · M0）

日期：2026-07-10 ｜ 前情：PR#33（@1251912798，+23.6k）主体退回附重做规格（见 PR 评论 2026-07-08 与
`docs/audit` 深审），作者三日未动；owner 拍板「浏览器捕捞重要，按我们的合并流程合进来」。
本文档 = 重做规格的 M0 落地范围（R4）。作者可救的纯模块整搬并保署名（Co-Authored-By）。

## 为什么（真实摩擦）

用户在网页上看到一张参考图（角色/风格/构图），想拿来当生成参考，现在要：右键另存 → 找到文件 →
回 Nomi → 素材库上传，四步。捕捞窗把它变成一步：右键「捕捞到素材库」。这是 PR#33 里唯一
真差异化的 ~20%（捕捞→素材库→画布桥）；其余 80%（30 标签浏览器/书签/素材盒浮窗）是与 Chrome
竞争的商品化面且实测已坏，不做。

## 范围（M0，全部 ≤800 行/文件）

| 件 | 内容 |
|---|---|
| `electron/browser/referenceCaptureWindow.ts` | 捕捞窗主进程模块：单 BrowserWindow（chrome=我们的 renderer `#/reference-capture`）+ 单 WebContentsView（独立 partition `persist:nomi-reference-capture`）。导航 IPC（navigate/back/forward/reload/openExternal）+ 状态回推（url/title/loading/canGoBack）。右键菜单捕捞（native `context-menu` 事件的 `params.srcURL/mediaType`，零注入 → Trusted Types 免疫）+ 整页截图捕捞（`capturePage`）。下载走 view 自己的 session（cookie 自动带上）落 tmp → 读字节走 `writeAsset`。 |
| 安全基线（deny-by-default） | 捕捞 session：`setPermissionRequestHandler` 全拒；`setWindowOpenHandler` http(s) 在本视图内跟进、其余拒；`will-navigate` 仅放行 http(s)。Nomi 首个不可信内容面，这是 PR#33 深审 P0 的根治。 |
| 入库契约（403 整类不复发） | `writeAsset(projectId, bytes, …, { kind: 'browser-capture', pageUrl, originalUrl: null })`——**绝不写 originalUrl** → 不产 sidecar `.meta` → 永不进 48h 信任窗 → 防盗链外站 URL 永不直发 vendor（PR#33 的 browserViews.ts:1886/1915 隐患根治）。`assetPaths.assetBucketFromMeta` 补 `browser-capture → imported` 桶。 |
| `src/ui/browser/ReferenceCaptureChrome.tsx` | 捕捞窗 chrome：固定高工具条（返回/前进/刷新/地址栏/系统浏览器打开/截图捕捞），下方留白给 WebContentsView（main 按固定工具条高定位 view bounds）。token-only。 |
| `src/ui/browser/browserUrl.ts` + test | **整搬作者代码**（地址输入归一化：host 补 https、危险 scheme 转搜索），保署名。 |
| 入口 + 回流 | 素材库面板 header 加「网页捕捞」按钮 → 开窗（带 projectId）。捕捞成功 → main 广播 `nomi:browser-capture:imported` → 素材库 `refresh()` + toast，素材即刻可拖上画布（走既有链路）。 |

## 不动项（明说不做）

- 多标签 / 书签 / 历史 / 推荐站 / 素材盒浮窗（商品化面，退回给作者的部分，不救）。
- 悬停注入捕捞（YouTube Trusted Types 实测已杀；右键菜单原生参数替代）。
- 截图→LLM 提示词提取（作者 `browserPromptExtraction.ts` 可整搬，留 M1 切片，不捎带进 M0）。
- 不加任何新依赖（PR#33 的 lucide-react/radix 一律不进；图标走 tabler vendor 登记）。

## 回滚

单 commit 落 main；回滚 = revert 该 commit。捕捞窗是独立窗口+独立 partition+独立 IPC 前缀
（`nomi:browser-capture:*`），对既有面零侵入（素材库 header 一个按钮 + assetPaths 一行桶映射）。

## 验收门

1. 五门全过（`pnpm run gates`）。
2. R13 真机走查：开窗 → 地址栏导航到本地测试页 → 触发图片捕捞 → 素材库出现该图（截图人眼判断）；
   权限请求被拒（geolocation 探针）；console 0 error。
3. 捕捞素材的磁盘位无 `.meta` sidecar（信任窗不进——结构性验证）。
