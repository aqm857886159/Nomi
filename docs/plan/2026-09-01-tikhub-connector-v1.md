# 2026-09-01 TikHub 数据 connector v1（分享链接 → 无水印直链 → 拆解）

状态：🚧 进行中

> 施工图（规格）：`docs/research/2026-09-01-shortvideo-data-apis-eval.md` §4 咬合 + §7 v1 五条。
> 合同原文：`docs/plan/2026-08-29-creative-capability-catalog-and-prompt-system.md` §5.5 `ConnectorDefinition`（#226 已入 main）。
> 用户已拍板：只接 TikHub；BYO-key；走势/轮询留 v2；轻抖不接；文稿继续走现有 whisper。

## 真实摩擦（D1）

用户手上是一条抖音/TikTok 分享链接，想直接拆成分镜表，但现在必须先把视频**下载到本地**再拖进来。中间这一步（找去水印工具、下载、导入）又累又容易断。v1 就消掉这一步：**贴链接 → Nomi 解析出无水印直链 → 落成项目视频素材 → 用现有节点拆解**。

## 目标 / 不动项

**做**
- 一个 `ConnectorDefinition`（TikHub，`transport:'native-api'`、`auth:{kind:'api-key', secretOwner:'nomi-settings'}` = BYO-key，key 走既有 `safeStorage` 凭据加密层）。
- 首批只暴露解析工具：抖音 `fetch_video_high_quality_play_url`（首选，一步到位拿 `data.original_video_url`）、抖音/TikTok `fetch_one_video_by_share_url`（兜底/TikTok），可选 `fetch_one_video` 拿元数据。
- 出站全过 `hardenedFetch` + `network.allowedOrigins=['api.tikhub.io']`；`dataEgress` 声明「链接/ID 发往 api.tikhub.io」。
- 按次计费端点 `effect:'spend'`，接既有费用确认流。
- 解析出的直链**原样**进 `deconstructVideo({videoUrl})`——引擎零改动；也能落成项目视频素材（`importRemoteAsset`），素材记 `AssetSourceEvidence`（source=connector、rightsStatus:'unknown'）。
- UI 最小面：①设置区「模型/接入」tab 加 TikHub key 配置卡（照既有 vendor 卡先例）；②素材库「贴链接」入口，解析成功=落成项目视频素材。
- i18n zh+en。fixture 合同测试 + 门控 e2e（`TIKHUB_E2E=1`）。

**不动**
- `deconstructVideo` 签名/内部零改。
- 不做拆解面板级完整链路 UX（面板设计讨论中）。
- 不动右槽/拆解面板。
- 不接轻抖、不内置 key、不做走势看板、不做定时轮询（v2）。
- 不真实调用付费接口（无 key；合同级 + 门控 e2e 即可）。

## R5 OpenAPI 对账（一手 `api.tikhub.io/openapi.json`，`openapi 3.1.0`，checkedAt 2026-09-01）

鉴权：`securitySchemes.HTTPBearer` = `Authorization: Bearer {token}`（无 `Bearer` 前缀走 cookie 是「不推荐」路径，我们只用 header）。无 `servers` 块 → base 隐含 `https://api.tikhub.io`（文档站口径）。响应统一 `ResponseModel` 信封：`code`（int，默认 200）、`message`/`message_zh`、`request_id`、`data`。

| 端点（GET） | 参数（实测 schema） | `data` 形状（据端点 description，**非** OpenAPI schema——见下「与评估文档不符」） | effect | 单价 |
|---|---|---|---|---|
| `/api/v1/douyin/web/fetch_video_high_quality_play_url` | `aweme_id?`（优先）、`share_url?`、`region?`（CN/US/HK） | `data.video_id`、**`data.original_video_url`**（最高画质无水印直链）、`data.video_data`（时长/大小等元数据） | spend | $0.005 |
| `/api/v1/douyin/web/fetch_one_video_by_share_url` | `share_url`（required） | 「作品数据」= 原始 aweme 结构（内层字段 OpenAPI 未列） | spend | 文档级未标单价 |
| `/api/v1/tiktok/app/v3/fetch_one_video_by_share_url` | `share_url`（required） | 「作品数据」= 原始 aweme 结构（内层字段 OpenAPI 未列） | spend | 文档级未标单价 |
| `/api/v1/douyin/web/fetch_one_video` | `aweme_id`（required）、`need_anchor_info?`（默认 false） | 「作品数据」= 原始 aweme 结构 | spend | — |

**与评估文档不符处（load-bearing，据实以 OpenAPI 为准）：**
1. 评估文档写死了 `data.result.videos.0.url.0` 这类字段路径——**那是 apimart 生成接口的形状，不是 TikHub**。TikHub 的 `ResponseModel.data` 是 `anyOf:[{}, null]`（**未定型的原始平台载荷透传**），OpenAPI 不描述内层字段。
2. 真正被 OpenAPI **端点 description 明确写出**的干净字段只有 `fetch_video_high_quality_play_url` 的 `data.original_video_url`。因此**抖音首选走它**（一步、文档化、无水印、最高画质）。
3. `fetch_one_video_by_share_url`（抖音/TikTok）返回的是原始 aweme，去水印直链要在 aweme 结构里按候选路径找（`aweme_detail.video.play_addr.url_list[]` / `download_addr.url_list[]` 等已知形状）——因内层未文档化，解析器走**防御式多候选路径遍历**，取不到就报诚实错误。
4. 小红书视频笔记（`xiaohongshu/app_v2/get_video_note_detail`）取直链内层结构同样未文档化且更碎——**v1 诚实不接小红书**，只做抖音/TikTok；小红书留 v2。
5. 因无 key、`data` 内层未文档化，fixture 用「真实 `ResponseModel` 信封 + 代表性 aweme 结构」构造并**显式标注为合成**；真形状以交付后用户本机 `TIKHUB_E2E=1` 冒烟坐实。

## 与 Nomi 咬合（最小改动面）

- **形态**：新建 `electron/connectors/tikhubConnector.ts`——不塞进生成 catalog（那是 vendor→model→create/poll 生成家族，TikHub 是数据面，塞进去=错配 P4）。connector 定义就是 §5.5 的 `ConnectorDefinition`。
- **凭据**：复用 `electron/catalog/secrets.ts` 的 `makeApiKeyRecordFromPlain` / `decryptApiKeyRecord`（safeStorage），vendorKey=`tikhub`。key 读写走既有 catalog 凭据边界，不开明文旁路。
- **出站**：`hardenedFetch(url, { headers:{Authorization:'Bearer …'}, sensitiveHeaders:['authorization'], maxBytes, timeoutMs, throwOnNon2xx:false })`，host 硬校验 `api.tikhub.io`（allowedOrigins）。
- **管线**：解析出的 `https://…` 直链 → `deconstructVideo({videoUrl})`（现有链路，`resolveVideoLocalPath` 已支持 http 直链，`extractVideoFrame.ts:57`）；或 `importRemoteAsset({projectId,url,kind:'imported'})` 落成项目素材，带 `AssetSourceEvidence`。
- **AssetSourceEvidence**：`{ source:'connector', connectorId:'tikhub', originalUrl:<分享链接>, resolvedUrl:<直链>, rightsStatus:'unknown', fetchedAt }`，作为 asset metadata 落进 `.meta` sidecar（`writeAsset` 已把 rawMeta 透传，`certificationEvidence` 同款先例）。**绝不推断可商用**。
- **UI**：设置「models」tab（`IconPlugConnected`）加 TikHub 卡；素材库工具行（`AssetLibraryToolbar`）加「贴链接」入口 → 弹输入 → 调 IPC 解析并落素材。

## IPC / 桥

新 main-process handler（全过 `assertTrustedSender`，`check:ipc-sender-binding` 因已加固不进 baseline）：
- `nomi:connector:tikhub:save-key` / `:key-status` / `:clear-key`（凭据边界）。
- `nomi:connector:tikhub:resolve-share-url`（分享链接 → 直链 + 平台 + 元数据摘要）。
- `nomi:connector:tikhub:import-to-project`（解析 + `importRemoteAsset` 带 evidence，一次 trusted 主进程调用）。

桥类型放 `src/desktop/bridgeConnector.ts`（中立契约层，不违反 `check:boundaries`）。

## 失败态（三段式 + 诚实提示）

发生什么 / 为什么 / 下一步。含固定诚实提示：「第三方抓取源可能随平台风控波动；直链短时有效，取到尽快用」。key 缺失 / safeStorage 不可用 / 非 200（分类 401 鉴权、403 额度、404 找不到、5xx/风控）/ 直链取不到，各给对应下一步。

## 验证

- fixture 合同测试：参数构造（`share_url`/`aweme_id`/`region`）、`ResponseModel` 信封解析、`original_video_url` 抽取、aweme 多候选路径抽取、错误分类（401/403/404/5xx/非直链）。
- 门控 e2e：`TIKHUB_E2E=1` + 环境变量取 key（**不问用户要 key、不写任何文件**），真解析一条抖音分享链接 → 断言拿到 http 直链。默认 skip。
- 全量 `pnpm run gates`（哨兵法）。
- 触 electron 高风险 pattern 则自写 R21 契约（`check:root-cause-contracts`）。

## 回滚

新增文件为主（connector / IPC / 桥类型 / UI 卡 / 入口 / i18n / 测试）。回滚 = 移除 connector 模块 + IPC 注册 + 两处 UI 入口 + i18n 键 + 桥类型；`deconstructVideo` / `importRemoteAsset` / catalog 凭据层零改，无迁移，无并行版。

## 验收门（对应 §7 v1 五条）

1. connector 形态 = `ConnectorDefinition`（native-api / api-key / allowedOrigins / effect / dataEgress）✅
2. 直链原样进 `deconstructVideo`、引擎零改 ✅
3. 文稿继续 whisper 主路、v1 不接外部文稿 ✅
4. key 用户自带 · `spend` 接费用确认 · 素材落 `AssetSourceEvidence(rightsStatus:'unknown')` ✅
5. 失败态三段式 + 第三方抓取诚实边界 ✅

## v1.1 双域名全球化（2026-09-01 追加）

**真实摩擦（D1）**：TikHub 官方两域——`api.tikhub.io`（主）与 `api.tikhub.dev`（大陆加速，主域在大陆被墙，用户实战研究事实）。全球化 = 让所有人都好用、按**最优线路自动选**，而不是按语言猜。

**机制（实测选路，不按语言猜）**：
1. **候选域清单**进 connector：`TIKHUB_HOSTS=['api.tikhub.io','api.tikhub.dev']`（单一 owner `electron/connectors/tikhubHosts.ts`），`allowedOrigins` 覆盖两者。
2. **连接时赛跑**：对两域各发一次**免费健康探测** `GET /api/v1/health/check`（R5 一手 openapi.json 确认：无鉴权、无计费依赖、返回 `{"status":"ok"}`），谁先健康用谁；探测走同一条 `hardenedFetch` 边界、**不带 Authorization**（保持免费、不泄 key）。
3. **sticky**：结果存**非凭据**连接偏好层 `connector-prefs.json`（`electron/connectors/connectorPrefsStore.ts`，只存 `routeMode`+`stickyHost`，绝不存 key）。
4. **失败自动切换**：主选域出站失败（`upstream` 类）→ 探测另一域，健康则更新 sticky 并重试一次；两域全失败 → `no-route` 三段式（含「高级设置手动指定线路」指引）。
5. **locale 只影响探测顺序**（zh 系先探 `.dev`），绝不决定结果（`orderedCandidateHosts`）。
6. **高级设置「线路」行**（自动=默认 / 强制 `.io` / 强制 `.dev` + 显示当前生效线路）：照 #282 `NetworkSection` 折叠先例，收起态一行 + 状态胶囊，展开态分段选择器。手动锁定压过 sticky/赛跑，且不触发自动切换。
7. **与 per-connection 代理自然组合**：探测/出站都过 `hardenedFetch` → `getAppDispatcher`，代理路由在 dispatch 时决议，两域探测自动继承当前代理。

**边界**：`resolveTikhubHost`/`failoverTikhubHost` 只返回候选域之一；sticky 读取时按候选清单归一；`fetchTikhubJson` 出站前硬校验 host ∈ 候选清单——被投毒的偏好也无法把流量导出 allowlist。手动线路模式单一 owner 在中立契约层 `electron/shared/contracts/tikhubRoute.ts`（跨进程共用）。根因合同 `docs/fixes/2026-09-01-tikhub-connector-ingest-boundary.root-cause.json` 的 scope 已扩展覆盖新增高风险文件（`connectorPrefsStore.ts` 等）。
