# 找参考：跨平台素材检索 connector

> 状态：✅ 已实现（数据层+UI 接线完成，门岗与单测绿）· ⚠️ UI 未走真机走查/视觉基线，见文末「本 PR 不声称什么」

日期：2026-09-07 · 基线：`origin/main@4f55e2a36`
设计（已拍板）：[`../design/2026-09-07-find-reference-design.md`](../design/2026-09-07-find-reference-design.md) · 画布 <https://claude.ai/code/artifact/309a8fc2-4599-4f63-8e5b-379e97768ccf>
调研：[`../research/2026-09-07-tiktok-creative-intelligence.md`](../research/2026-09-07-tiktok-creative-intelligence.md)

## 先查别人

**① 依赖里已有？** ❌ 无第三方 TikHub 客户端在 `node_modules`；官方有 5 个语言 SDK（Python/TS/Go/Java/C++），**但我们不引入**——见 §四列表，我们只用到 1063 个端点中的 4 个，且已有自建的选路/加固/错误归一层。

**② 仓库里已有？** ✅ 大量可复用，这一问决定了本方案是「扩」不是「建」：
- 出站加固 + 选路 + 错误归一：`electron/connectors/tikhubConnector.ts:176`（`fetchTikhubJson`，hardenedFetch/Bearer/禁重定向/8MB 上限/30s）
- 域名候选与 sticky 选路：`electron/connectors/tikhubRoute.ts`
- 错误 kind 中立契约：`electron/shared/contracts/tikhubErrorKinds.ts:19`（9 个 kind）
- 落盘链路：`tikhubConnectorService.ts:4` 注明「解析出的直链原样进 `importRemoteAsset`（现有下载/校验/落盘链路，走 hardenedFetch）」→ **下载不新写**
- 三段式失败文案 + kind→i18n 映射：`src/workbench/assets/pasteShareLinkImport.ts:13`
- ⚠️ 现有 `fetchTikhubJson` **只支持 GET**；本次要的 `search_ads` 与抖音 `fetch_video_search_v1` 是 **POST** → 需扩，不是另写

**③ 生态里已有？（TikHub 自己怎么设计的 —— 一手）**
- <https://docs.tikhub.io> —— 文档**按平台分组而不是按能力分组**（"organized primarily by platform/social media service rather than by capability"），命名 `[Platform] [Type] API` 带 V1/V2/V3 版本与 deprecated 标注 → **印证「平台是一等公民」**，我们的 tools 也按平台分族
- 同上 —— **未规定统一分页约定，也未规定统一 error envelope**；只列了 HTTP 400/401/402/403/404/429/500 → **归一化必须在我们这层做，每平台一个 normalizer**
- <https://tikhub.io/> —— 产品定位 "Discover"，14+ 平台各自成族，用例第一条是 "AI Agents"
- <https://github.com/TikHub/TikHub-API-Python-SDK> —— 官方 SDK 的做法：sync+async 双客户端、指数退避重试、结构化错误层级；**分页建议每次 ≤30 条**（"keep the requested count at 30 or fewer per call"），且**返回少于请求数是正常的游标行为**

**④ TikHub 自媒体？** 本次是接口契约与内部分层问题，自媒体上不会有信号；用户侧摩擦的调研已在 `2026-09-07-tiktok-creative-intelligence.md` §2.4 做过（跨境圈「不靠感觉」+ Kalodata 被点名）。

**结论**：**扩已有，不引 SDK**。理由是领域约束不是偏好——官方 SDK 全是**服务端语言**（Python/Java/Go/C++）或**通用 TS**，而我们的出站必须走 Electron 主进程既有的 `hardenedFetch`（域白名单、敏感头跨域剥离、禁重定向、字节上限、E2E loopback seam）。引入任何自带 HTTP 栈的 SDK 都会**绕过这层加固**（R28：防线建在最早能拦住的那层）。我们只用 4 个端点，自建适配成本远低于给 SDK 补加固。

## R29 四列表（TikHub 作为外部数据面）

| 它提供 | 我们用了 | 我们另写了 | 我们拆散了 |
|---|---|---|---|
| 1063 个端点、16+ 平台（`api.tikhub.io/openapi.json` V5.3.2） | 4 个：`tiktok/ads/search_ads`、`douyin/search/fetch_video_search_v1`、`xiaohongshu/app_v2/search_notes`、既有 `*/fetch_one_video_by_share_url` | — | 其余 1059 个不接（用到再开） |
| Bearer 鉴权 | ✅ 原样 `Authorization: Bearer` | — | — |
| 双域名（io / dev 大陆加速） | ✅ `tikhubRoute` 实测赛跑 + sticky + 自动切备 | 选路策略是我们加的（spec 只说「请勿跨区使用」） | — |
| 5 个官方 SDK | ❌ 不引 | 自建 4 端点适配 | 见上：**领域约束＝出站必须过 hardenedFetch** |
| 各平台各自的响应形状（**无统一 envelope**） | — | **每平台一个 normalizer → 统一 `ReferenceItem`** | 上游的平台差异不外泄到 UI |
| HTTP 400/401/402/403/404/429/500 | ✅ 归一进既有 9 个 `TikhubErrorKind` | 本次**补 402→quota、429→新 kind `rate-limited`**（现在都掉进 `bad-response`） | — |
| 建议分页 ≤30/次、返回少于请求数属正常 | ✅ 采纳：`limit` 上限按平台钉死（TikTok 广告库实测**上限 20**，文档写 50 是错的） | — | — |

## 根因修正（本次顺带修，都是读真实契约读出来的）

| 现状 | 问题 | 修法 |
|---|---|---|
| `fetchTikhubJson` 只支持 GET | 本次两个端点是 POST | 扩 method + JSON body，**加固参数一字不改** |
| 402 → `bad-response` | 余额不足时用户看到「TikHub 响应结构异常」 | 402 → `quota` |
| 429 → `bad-response` | 限流（QPS 10/s）时同上；且**处置不同**（充值 vs 稍后重试） | 新增 kind `rate-limited` |
| 错误信息只读顶层 `message_zh/message` | 实测 401/422 走的是 **`detail` 信封**（`{"detail":{"code":401,"message":...}}` / `{"detail":[{...}]}`），读不到 | 补 `detail` 两形状的提取 |

## 分层

```
UI  src/workbench/assets/…            找参考面板（平台 chip / 结果卡 / 三段式失败）
    ↑ bridgeConnector（既有 DTO 通道）
IPC electron/connectors/tikhubConnectorIpc.ts
    ↑
归一 electron/connectors/referenceSearch/…   每平台 normalizer → ReferenceItem
    ↑
出站 electron/connectors/tikhubConnector.ts  fetchTikhubJson（扩 POST）
契约 electron/shared/contracts/referenceSearch.ts   平台词表 + ReferenceItem + 证据形状（渲染层也 import）
```

**证据格按平台 derive**（设计的核心，落到类型上）：`ReferenceItem.evidence` 是一个**有序数组**，每项 `{ label, value, kind }`；哪些项、什么顺序由 normalizer 按平台决定——UI 只负责渲染前两项，不认识平台。

## 不动什么

- 不动既有「贴链接」路径与它的落盘链路（`importRemoteAsset`）
- 不动 `tikhubRoute` 选路、不动 `hardenedFetch` 加固参数
- 不动既有 9 个 error kind 的语义（只**新增** `rate-limited`，并把 402 归到已有的 `quota`）

## 验收门

- 单测：每平台 normalizer 的形状固定（含真实响应夹具）；POST 出站的加固参数不被削弱；402/429/`detail` 信封的分类
- `pnpm run gates:contracts` 全绿
- ⚠️ **UI 层的完成定义**（[[ui-delivery-definition-design-lab]]）：设计实验室截图拍板 + 视觉基线绿 + R13 真机走查。本 PR **不声称** UI 已验收，见 PR 描述的诚实边界

## 落地记录（实际做了什么）

| 层 | 文件 | 要点 |
|---|---|---|
| 契约 | `electron/shared/contracts/referenceSearch.ts`（新） | 平台词表 / `ReferenceItem` / `ReferenceEvidence`（**指标是语义 token 不是文案**）/ 平台事实表 |
| 归一 | `electron/connectors/referenceSearch.ts`（新） | 三个 normalizer + 共享遍历 `entriesOf` + 媒体直链提取；数字格式化（万/亿 vs k/M）在这层 |
| 出站 | `electron/connectors/tikhubConnector.ts` | `fetchTikhubJson` 扩 POST（**加固参数一字未改**）；`searchReferences`；402/429/`detail` 信封修正 |
| 服务 | `electron/connectors/tikhubConnectorService.ts` | `searchTikhubReferences` / `importTikhubReference`；媒体直链只留主进程 |
| IPC | `tikhubConnectorIpc.ts` / `preload.ts` / `bridgeConnector.ts` | 两个新通道，全过 `assertTrustedSender` |
| UI | `src/workbench/assets/FindReferencePanel.tsx`（新，287 行） | 平台 chip / 结果卡 / 转译回显 / 三段式空结果；**不认识任何平台**，只按 evidence 顺序渲染 |
| UI | `AssetLibraryPanel.tsx` / `AssetLibraryToolbar.tsx` | 🔗 从「弹框贴链接」改为「开合内嵌面板」（砍掉一步）；空态主 CTA = 找参考（卡点①） |
| 共享组件 | `src/design/searchInput.tsx` | 加 `onKeyDown` 透传（回车即搜）——**扩共享组件而不是手搓一个副本**（P1） |

**媒体直链的处理**（三平台实调）：搜索响应里**本来就带**直链，所以落地不再花第二次钱；但它们是短时签名 URL，
**不进 `ReferenceItem`、不过 IPC**，只留在主进程 `lastReferenceMedia`。取不到就明确报错让用户重搜，不静默多花一次钱。
· 抖音 `video.play_addr.url_list[0]` · 小红书**必须挑 h264**（只有它 `format:"mp4"` 是完整文件，h265/av1 是 `.m4s` 分片）+ http→https
· 广告库 `video_info.video_url['720p']`（实测可直下：206 / video/mp4 / ftypisom）

**素材可用性**：找参考落进来的素材 `usageStatus = 'reference_only'`（比贴链接那条的 `rights_unknown` 更保守）——
这些是平台上别人正在跑的商业素材，只该当参考看。UI 上有一行诚实标注。

## 验证记录

- 单测 **182 通过**（`electron/connectors/` + `src/workbench/assets/`），其中归一层 21 条、出站契约 17 条
- **夹具是真实响应裁出来的**，不是照文档编的——文档在三处写错过（广告库 limit 上限 / cost 取值 / keyframe 形状）
- **变异测试**：撤掉 402/429/detail 三处修复 → 4 条当场红；还原 → 全绿。断言是活的
- `gates:contracts` 全绿

## ⚠️ 本 PR 不声称什么（诚实边界）

- **UI 未走 R13 真机走查，也未过设计实验室视觉基线**。按 [[ui-delivery-definition-design-lab]]，UI 交付定义 =
  设计实验室截图拍板 + 视觉基线绿——本 PR 只到「按拍板样张接线完成 + 类型/门岗/单测绿」。
- **未做真实 Electron 端到端**（搜索 → 点卡片 → 素材真的落进项目 → 冷启动 readback）。已有的 TikHub journey
  夹具只覆盖贴链接那条路。
- 平台目前是**会话态**，尚未接进项目设置持久化（UI 契约已按「项目设定」画好，接线是随后一步）。
- 中文关键词**尚未自动转译**：契约与回显通路已就位（`effectiveKeyword` + `translationReason`），
  但翻译源未接。现状是中文打 TikTok 广告库相关性只有 32%——这条必须在开放给用户前解决。

## 回滚

单一 feature 分支，改动集中在 `electron/connectors/` 与新增契约文件；回滚 = revert 该 PR，既有贴链接路径不受影响。
