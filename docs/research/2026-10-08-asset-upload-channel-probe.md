# 参考图上传通道真网实测（2026-10-07）

## 结论先说

- **tmpfiles**：图片、约 1.50 MB JPEG、1 秒 MP4 均上传 3/3；上传中位约 1.48/3.12/1.67 秒，GET 对图片和 JPEG 全部通过，MP4 为 3 次中 2 次 GET 通过（另一次直连 GET `fetch failed`，同一链接 HEAD 返回 200 但是 HTML）。建议保留为匿名兜底，但把“返回页面不是文件”的验证作为失败信号。
- **litterbox**：三种素材均 0/3，上传直接 HTTP 403（原始响应为 `403 | Forbidden`）。建议后移或默认关闭，不能把它当作可靠的第一匿名 host。
- **Nomi 官方 Relay**：PNG 1/3、JPEG 3/3、MP4 3/3；成功上传中位约 5.77/6.29/5.49 秒。成功 URL 的 GET 对 JPEG/MP4 全部通过；PNG 有一次上传超时，另一次 GET `fetch failed`。公开 URL 的 direct/proxy HEAD 对本次 Relay 返回均为 404（GET 仍能成功的样本也如此），说明 HEAD 不是该 Relay 的可用可达性判据。建议在已配置/可信网络场景排在借用供应商之前，但先修正 HEAD/对象路由观测。
- **KIE / APIMart**：本进程没有 `KIE_API_KEY` / `APIMART_API_KEY`，按约定三种素材各 3 次均记录“未测：无 key”，没有查找或读取任何配置文件，也没有发供应商请求。视频即使有 key 也应按现有声明分别走 KIE video ingestion；APIMart 当前声明只接受 image，这是代码层面的能力缺口而非本次真网结果。

## 测试矩阵

| 通道 × 素材 | 上传成功率 | 上传中位 / 最大耗时 | GET 内容校验 | direct HEAD / proxy HEAD | 失败原因 |
|---|---:|---:|---:|---|---|
| litterbox × 64×64 PNG | 0/3 | — | — | — | HTTP 403 |
| litterbox × JPEG（1,502,932 B） | 0/3 | — | — | — | HTTP 403 |
| litterbox × 1 s MP4（8,459 B） | 0/3 | — | — | — | HTTP 403 |
| tmpfiles × PNG | 3/3 | 1,482 / 1,611 ms | 3/3 | 200 / 200（代理） | — |
| tmpfiles × JPEG | 3/3 | 3,121 / 3,279 ms | 3/3 | 200 / 200（代理） | — |
| tmpfiles × MP4 | 3/3 | 1,669 / 1,676 ms | 2/3 | 200 HTML / 200 HTML（代理） | 1 次 GET `fetch failed`；HEAD 非视频类型 |
| Nomi Relay × PNG | 1/3 | 5,766 / 5,766 ms | 1/1 | 404 / 404（代理） | 2 次上传超时；1 次 GET failed |
| Nomi Relay × JPEG | 3/3 | 6,287 / 6,469 ms | 3/3 | 404 / 404（代理） | HEAD 404，但 GET 成功 |
| Nomi Relay × MP4 | 3/3 | 5,490 / 6,072 ms | 3/3 | 404 / 404（代理） | HEAD 404，但 GET 成功 |
| KIE × 三种素材 | 未测 | — | — | — | 未测：无 key |
| APIMart × 三种素材 | 未测 | — | — | — | 未测：无 key |

说明：每个可测通道 × 素材执行 3 次；上传成功后再做一次独立 GET 和一次 HEAD。进程检测到系统代理环境，因此同时记录了代理对照 HEAD；报告不打印代理地址。失败保留 HTTP 状态、超时或 `fetch failed` 原文，完整逐次记录见 [原始 JSON](./2026-10-08-asset-upload-channel-probe.json)。

## 方法与边界

脚本 [probe-asset-upload-channels.mjs](../../scripts/probe-asset-upload-channels.mjs) 现场用 ffmpeg 生成纯色 PNG、1,502,932 B 合成 JPEG 和 1 秒合成 MP4；不读取用户素材、`%APPDATA%\\Nomi` 或 `~/.nomi`，不调用任何生成/付费接口。上传统一调用 `assetLocalization.ts` 的 `resolveLocalAsset`，由既有 strategy 分支处理 multipart、stream/base64 等协议；脚本只负责素材、编排、计时和验证。

## 隐私核对

现有设置页 walk [asset-transport-settings.walk.mjs](../../tests/ux/asset-transport-settings.walk.mjs) 已检查到：文案明确提到 KIE 上传、免费、公共/隐私风险；图片和视频行展示 litterbox/tmpfiles；“公共临时托管”复选框存在且默认勾选。该页未改动。本次 probe 不能替代产品文案审阅：Relay 的公开 URL 行为应在设置页继续明确写出。

## 建议

1. 将 litterbox 从匿名链的优先尝试位后移或默认关闭，并保留 403 原因遥测。
2. 在排序决策上，Nomi Relay 可以排在“借用别家”之前（它不消耗别家账户且本次 JPEG/MP4 成功率高），但应先解决 PNG 超时和 HEAD 404 的可观测性，再把它作为无条件默认。
3. 视频通道不能依赖 APIMart image-only 上传；KIE video 或 Relay 是现有可行路径。APIMart 视频支持应另立供应商契约与真实 key 实测，不能靠图片通道推断。

测试时间：2026-10-07（America/Santiago）；网络环境：Windows、Node v22.15.0（项目要求 >=22.19.0），进程检测到系统代理环境；未打印代理值或任何凭据。
