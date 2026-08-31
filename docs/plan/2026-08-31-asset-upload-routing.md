# 2026-08-31 资产上传路由与公共中转

状态：✅ 实现并完成 Cloudflare 发布（Worker `c13e9e62` 已推广 100%；终端与浏览器到 workers.dev 的真实 canary 受当前网络连接超时阻断）

## 真实摩擦

用户上传的本地图片、视频或音频只存在于本机。模型供应商只能读取公网可达的值；匿名图床一旦 500、被墙或 URL 过期，生成会在付费提交前后表现成不同的失败。当前普通 HTTP mapping、自定义调用、Replicate 独立入口都能触达同类问题，不能只修一个供应商。

## 目标

- 用户只需配置供应商 API key；不用理解上传字段、multipart 或临时 URL。
- 统一候选顺序：本地 ComfyUI 保持本地上传；先用目标供应商自己的上传 API，再用其他已配置供应商的上传 API；用户自定义 Relay 和 Nomi 受限公共 Relay 只做兜底，最后才是得到明确同意后的匿名临时托管。
- 接入 KIE、APIMart、fal、Replicate、Runway、RunningHub 的真实官方上传协议；图片、视频、音频按能力路由，不能把视频塞进图片-only 端点。
- 所有上传失败保持有界重试，4xx 鉴权/大小/参数错误不盲重试；一个通道失败才进入下一个通道。
- R2 秘钥只存在 Worker 环境。正式桌面端使用内置的公共 Relay URL，不要求用户填写密钥；高级设置允许用户配置自己的公开/私有 Relay，私有 Token 通过系统安全存储保存。
- 公共匿名通道保留作为最终兜底，并保留现有隐私确认、TTL 预检和本地源文件真相。

## 不做

- 本 PR 不扩展每家供应商的完整模型目录；这里只交付上传能力和已存在模型/自定义模型使用的通用传输边界。
- 不把 fal 的 `/data` 平台文件接口误当成公网模型输入；fal 走官方 CDN 上传协议。
- 不把 Runway 的 `runway://` 私有 URI 当作跨供应商公网 URL；它只对 Runway 目标请求有效。
- 不把 workers.dev 当成最终品牌域名；当前先用它完成真实链路，后续如需再接自定义域名。

## 传输声明

| 通道 | 协议 | 媒体 | 生命周期/隐私 | 失败后的下一步 |
|---|---|---|---|---|
| KIE | base64 image / multipart stream | 图/视频/音频 | 官方临时文件；代码按 24h 保守 | APIMart/其他已配置 |
| APIMart | multipart `/v1/uploads/images` | 图 | 官方 72h，图片 ≤20MB | 其他已配置 |
| fal | initiate + signed PUT | 图/视频/音频 | fal CDN 生命周期由请求偏好决定 | 其他已配置 |
| Replicate | multipart `/v1/files` | 图/视频/音频 | 文件 URL 以响应为准；不硬编码跨供应商永久性 | 其他已配置 |
| Runway | `/v1/uploads` 初始化 + multipart 上传 | 图/视频/音频 | `runway://`，24h，≤200MB | 其他已配置 |
| RunningHub | multipart `/media/upload/binary` | 图/视频/音频 | signed download URL，约 1 天 | 匿名链 |
| 用户自定义 Relay | 用户填写的公开/私有 multipart → 其自身公网 URL | 图/视频/音频 | 用户自己的生命周期/权限 | Nomi 公共 Relay |
| Nomi 公共 relay | 受限 multipart → R2 public URL | 图/视频/音频 | 24h；单文件/总存储/公共限流/预算闸门 | 匿名链 |
| 匿名链 | Litterbox → tmpfiles | 图/视频/音频 | 公共、需同意；24h/1h | 诚实失败 |

## 成本闸门

R2 激活后，不能只依赖“免费额度”这句说明，因为一次大文件或异常流量可能把额度快速消耗掉。本 Worker 增加三层保护：

- `MAX_UPLOAD_BYTES`：单个文件硬上限，默认 200MB。
- `MAX_STORAGE_BYTES`：本 relay bucket 的总存储硬上限，默认 8GB，给账号免费 10GB 留 2GB 缓冲。
- `MAX_MONTHLY_BUDGET_USD`：预计存储产生的月度付费上限，默认 0；超过就拒绝新上传。

`GET /v1/usage` 仍只允许管理员使用 relay token，返回对象数、字节数、免费额度余量和预计月存储费用。桌面用户不需要 token；公共上传由 Worker 的总量闸门和 Rate Limiting binding 共同限制。它不伪装成精确账单：Class A/Class B 请求数和账号实际账单仍以 Cloudflare R2 Billing Dashboard 为准；Dashboard 预算提醒作为通知层，Worker 闸门作为上传硬停止。

## 代码边界

- `electron/catalog/types.ts`：声明 multi-step upload 与 auth scheme，不在每个 provider caller 写分支。
- `electron/catalog/assetLocalization.ts`：唯一路由、媒体能力、候选顺序、生命周期预检和失败聚合。
- `electron/assets/localAssetFile.ts`：唯一 JSON/multipart/raw-PUT 上传执行器，统一 retry 语义。
- `electron/catalog/assetRelayRuntimeConfig.ts`、`electron/settings/assetRelaySettings.ts`：内置公共 Relay 与高级自定义 Relay 的运行时配置；Token 只在主进程系统安全存储中解密。
- `electron/catalog/assetTransportRuntime.ts`：把上传策略和同意策略提供给运行时；不把密钥暴露到 renderer。
- `electron/catalog/customCallDispatch.ts`、`electron/runtime.ts`、`electron/image/decomposeLayers.ts`：继续调用统一 resolver，不各自实现上传。
- `electron/catalog/runninghub3d.ts`、`electron/catalog/replicate.ts`、`electron/catalog/builtinVendorSeeds.ts`、`src/config/knownVendors.ts`：声明真实供应商入口，通用 UI 复用现有接入卡。
- `workers/nomi-asset-relay/`：独立 Cloudflare Worker + R2 binding，公共受限上传、私有 Bearer 上传、类型/大小/总量限制、Rate Limiting、public URL 返回和生命周期配置。

## 6 角色评审结论

- CTO：客户端不能持有 R2 S3/Workers secret；relay 必须是可选且未配置时可诊断。
- 后端：供应商 upload API 是声明式能力；fal/Runway 的两阶段协议必须在共享执行器实现。
- 前端：不新增一套 provider 专属上传表单；已知供应商仍使用同一张 key 接入卡，设置页从主进程展示真实首选通道。
- PM：默认配置摩擦保持为“填一个 key”；匿名上传只在最后，并在首次使用时明确公共链接风险。
- 设计：不增加常驻控制项；失败文案必须告诉用户素材、通道和可执行动作。
- 真实用户：国内用户优先使用已配置的 KIE/APIMart/RunningHub，海外用户优先使用已配置的 fal/Replicate/Runway；Nomi 公共 Relay 不应抢在供应商上传 API 之前消耗自有额度，用户自己的 Relay 可在设置里覆盖它。

## 验收

- 路由单测覆盖六家 provider、R2 开关、媒体过滤、顺序和匿名同意。
- multi-step fal raw PUT 与 Runway init+multipart 的请求形状单测覆盖。
- 普通 runtime、自定义调用、Replicate 独立入口均通过同一 resolver；无旧的 provider-specific upload caller。
- Worker 单测覆盖私有 auth、公共模式、大小/类型拒绝、R2 写入、public URL、生命周期 metadata 和限流拒绝。
- `check:root-cause-contracts`、focused unit、contracts、typecheck、lint 通过。
- R2 真实验收：历史版本已完成未授权 `/v1/usage` 401、带 Secret 200、真实 4B PNG 上传/取回/删除；本次公共模式已由 Wrangler 成功发布到 Worker `c13e9e62` 并确认 `PUBLIC_UPLOAD_LIMITER (30 requests/60s)`、R2 binding 和 `PUBLIC_UPLOAD_ENABLED=true` 均进入部署清单。当前终端与浏览器访问 workers.dev 均连接超时，因此本次无 Token 上传 canary 未伪装成通过，待网络恢复后只需重跑该 canary。

## 回滚

删除本 PR 的 relay Worker 与 provider upload declarations，保留统一 resolver 的现有 KIE/APIMart/匿名链；不修改已有项目素材、凭证或远端对象。R2 对象由 Worker lifecycle 回收，代码回滚不删除用户远端数据。
