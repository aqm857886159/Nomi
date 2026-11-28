# Cloudflare Worker 免费层 10ms CPU 预算根治方案（设计卡）

- 状态：✅ 已交付
- 日期：2026-11-28
- 线/负责人：impl-cf-worker-cpu
- 类别：[其他]（Cloudflare Worker 边缘运行时性能与防呆修复；不改桌面端用户可见界面、布局或文案）
- 根因合同：`docs/fixes/2026-11-28-cloudflare-worker-free-cpu-budget.root-cause.json`

## ★0 先查别人

- 出处：https://developers.cloudflare.com/workers/runtime-apis/cache/ · Cloudflare Workers `caches.default.match(request)` 在边缘 C++ 层原生解析 `Range` 与 `If-Range` 并直接返回 `206 Partial Content` / `416 Range Not Satisfiable`（`cache.put` 只收带精确长度与缓存头的完整 `200 GET` 响应）· **改了**官网媒体切片架构决定（推翻 `docs/plan/2026-09-27-site-media-byte-ranges.md`「不用平台缓存切片、每次在 JS 里切」的旧决定：自定义域名走 `caches.default` C++ 零 JS 流处理，仅在无 `caches.default` 环境保留轻量切片回退）。
- 出处：https://developers.cloudflare.com/workers/platform/limits/#cpu-time · Workers Free 计划每次调用硬上限为 `10ms` CPU 时间（I/O 等待不计入，但 V8 `ReadableStream` 逐块 `reader.read()` / `TransformStream.transform()` 回调、数百页 R2 RPC 反序列化与海量 `Date.parse` 全计入 CPU）· **改了**两个核心决定：① 彻底删除 `worker/byteRange.ts` 的 `assetLength()` 运行时读流数长度分支，改为静态精确字节清单 `worker/mediaAssetSizes.ts` + `Content-Length` 头直读；② 将 `workers/nomi-asset-relay/src/index.mjs` 单次 R2 调用预算从 `900` 收紧至 `32` 并新增单次对象扫描上限 `10000`。
- 出处：https://developers.cloudflare.com/r2/api/workers/workers-api-reference/ · R2 `list({ prefix, include: ["customMetadata"] })` 按键字典序升序分页返回，但每次上传若重复全桶分页扫描并在每对象上做 ISO `Date.parse` 会产生线性 CPU 放大 · **确认了** `assetKey()` 以毫秒时间戳前缀保证最老过期对象优先被 `cleanup()` 清退，并**改了**过期元数据与用量读取策略（新增数值 `expiresAtMs` 免 `Date.parse`，隔离实例内对 `usageSnapshot` 做短期 TTL 缓存 + 上传成功增量累加 `storageBytes += file.size`、清理/惰性删除立即失效）。
- 出口：https://developers.cloudflare.com/r2/api/workers/workers-api-reference/ · 当单次扫描触及 `32` 次调用或 `10000` 对象安全上限时，`cleanup()` 正常落盘已删批次并返回 `complete: false`，由后续整点调度继续从最老键清退；`usageSnapshot()` 仍 fail-closed 返回 `503 usage_unavailable`，桌面端素材上传自动回落其他通道并在清理降载后自动恢复 · 确认了 `workers/nomi-asset-relay/src/index.mjs` 的 `enforceStorageBudget` 与 `cleanup` 出口语义。

## ★1 用户怎么用

- 场景：当访客在 Safari / iOS / Chrome 打开官网观看或拖动 7.6MB 宣传片及功能循环片段、创作者连续上传参考素材到中转站、或用户提交接近 2MB 的诊断反馈包时，我希望每次边缘请求都在 `<1ms` JS CPU 内稳定响应，以便不再触发 Cloudflare 免费层 `10ms` CPU 超限（HTTP 1102）导致视频断流或接口报错。
- 关键链路（6 步）：① 浏览器请求官网 `.mp4` / `.webm`（含 `Range: bytes=0-1`、尾部 `moov` 探测、分段拖动、`bytes=0-`）；② 边缘优先命中 `caches.default.match` 由 C++ 层直接切片返回 `206`/`416`/`200`；③ 冷节点未命中时按 `Content-Length` 或 `MEDIA_ASSET_SIZES` O(1) 取总长（0 次读流计数），通过 `ctx.waitUntil(caches.default.put)` 写入完整 `200` 响应并服务本次请求；④ 创作者上传参考素材时 `nomi-asset-relay` 写入数值 `expiresAtMs`，命中隔离实例内 TTL 快照并增量累加 `storageBytes`；⑤ 每小时 `cleanup` 在 `32` 次 R2 调用与 `10000` 对象有界预算内优先清理最老过期对象并失效缓存；⑥ `feedback-worker` 对 `raw.length * 3 <= MAX_BODY_BYTES` 或 `raw.length > MAX_BODY_BYTES` 免除 `TextEncoder().encode` 整块分配。
- 不做什么 + 已知坑：不把非媒体静态页面/图片绕进 Worker（避免消耗每日请求配额）；不删除缺少可用过期元数据的历史 R2 对象；不在 `worker/index.ts` 新增具名运行时导出（避免 `workerd` 启动失败）；不在 `workers.dev` 无操作缓存下丢弃 RFC 9110 Range 回退能力。
- 真实任务：① 官网首页 `nomi-0.22-film.mp4`（`7,962,929` 字节）连续 `bytes=0-1`、尾部 `moov` 探测与中段 seek 回放；② 教程站 `.webm` 动图 Range 加载与边缘缓存命中；③ 桌面端连续多笔参考素材上传与整点积压清理 + 大体积反馈 JSON 校验。
- 指标与量具（Goals-Signals-Metrics）：
  - 主指标（边缘流循环归零）：媒体 Range 请求触发全量读流计数比例 → `ASSETS.fetch` 额外计数调用数 / 请求数 → 基线首请求 `100%`（冷启动双拉流）→ 目标 `0%`；`caches.default` 命中时进入 JS `TransformStream` 比例 → 目标 `0%`（量具：`electron/catalog/siteWorkerByteRange.test.ts`）。
  - 质量指标（静态字节清单零漂移）：`marketing/` 下音视频真实 `stat.size` 与 `MEDIA_ASSET_SIZES` 一致率 → 目标 `100%`（量具：`scripts/marketing/serving-contract.test.mjs`、`pnpm run check:site`）。
  - 护栏指标（中转站与反馈端 CPU 预算）：连续上传触发重复 `ASSETS.list()` 比例 → 目标 `0%`（TTL 窗口内首笔后零列桶）；单次调用 R2 子请求占比 `<= 32/1000`、扫描对象数 `<= 10000`；反馈包常规体积触发 `TextEncoder.encode` 比例 `0%`（量具：`pnpm run check:asset-relay`、`pnpm run check:feedback-worker`）。
- ★1b 连带界面：无桌面端 UI 变更；官网媒体 HTTP 响应头（`206`/`416`/`200`、`Content-Range`、`Accept-Ranges`、`Cache-Control`）、中转站 `/v1/assets` 与 `/v1/usage` JSON 结构、反馈端 `/v1/feedback` 与 `/v1/events` 状态码及回执完全保持不变。
- ★1c 老用户：不适用：本次仅优化三个无状态 Cloudflare Worker 的边缘计算路径；R2 桶内已存旧对象只带 ISO `expiresAt`（无 `expiresAtMs`）时，`assetExpiryMs` 自动回退解析 `expiresAt`，无过期元数据的旧对象仍保留不删，客户端与本地项目数据零迁移。

## ★2 谁说了算

- 概念归属：
  1. `site.media-byte-ranges` → 唯一 owner：`worker/byteRange.ts#serveAssetWithRanges`（路由入口：`wrangler.json#run_worker_first`，静态媒体字节表：`worker/mediaAssetSizes.ts#MEDIA_ASSET_SIZES` 由 `scripts/build-marketing-site.mjs` 与 `scripts/marketing/serving-contract.test.mjs` 单源校验）；允许消费者：`worker/index.ts`。
  2. `relay.asset-expiry` & `relay.asset-read` → 唯一 owner：`workers/nomi-asset-relay/src/index.mjs` 的 `assetPages`（唯一列桶与调用/对象双预算门）、`assetExpiryMs`（唯一过期毫秒判定，`expiresAtMs` 优先、兼容旧 `expiresAt`）、`usageSnapshot`（唯一容量统计与隔离内缓存真源）、`readAsset`（唯一读取与惰性过期清理）。
  3. 反馈接收端请求体上限判定 → `infra/feedback-worker/src/worker.mjs#exceedsMaxBodyBytes`。
- 到点与未知状态语义（原则 2）：`cleanup()` 达到单次调用或对象预算时诚实返回 `complete: false`（不伪装清完），后续整点 cron 继续跟进；`usageSnapshot()` 达到预算无法证明真实总字节数时抛错返回 `503 usage_unavailable`（不把「没数完的半截字节数」当成安全放行）；静态媒体既无 `Content-Length` 又不在 `MEDIA_ASSET_SIZES` 时按未知长度整包返回 `200`（不阻塞播放，也不在运行时盲读整条流）。
- 门表证据：`node scripts/door-map.mjs ASSETS serveAssetWithRanges --roots=worker,scripts,electron`（2 扇门，均在 `worker/index.ts`）；`node scripts/door-map.mjs assetPages assetExpiryMs usageSnapshot readAsset --roots=workers,infra,worker`（4 扇门，均在 `workers/nomi-asset-relay/src/index.mjs`）。

## ★3 源头无错与单源演进

- ① 源头无错（Impossible by Construction）：
  - **物理删除错误路径（route-deletion）**：直接从 `worker/byteRange.ts` 删除 `assetLength()` 与 `lengthByETag` 的 `reader.read()` 循环，从结构上杜绝任何请求在 Worker JS 中全量读流数长度；全文件范围 `bytes=0-` 直接走原生 `FixedLengthStream(size)`，不进 JS `TransformStream`；`caches.default` 命中直接返回 C++ 切片响应。
  - **构建生成 + 门岗锁死单源数据**：`scripts/build-marketing-site.mjs` 自动同步并校验 `worker/mediaAssetSizes.ts`，`scripts/marketing/serving-contract.test.mjs`（已在 `pre-push` `SCAN_GUARDS` 监听 `marketing/` 全量文件）逐文件比对 `statSync.size`，任何视频增删改若未同步字节表在本地推送前即硬红。
  - **唯一列桶核双预算收口**：`assetPages()` 统一同时强制 `R2_CALL_BUDGET = 32` 与 `R2_OBJECT_BUDGET = 10000`，调用方无法写出无界全桶遍历。
- ② 仓库内单源演进：
  - 推翻 `2026-09-27-site-media-byte-ranges` 中「不用 Cache API、靠按 ETag 读流记长度 + 每次 JS 切片」的旧方案（线上实测 7.6MB 视频导致 >100 次 10ms CPU 超限），同提交删除旧计数实现；
  - 演进 `2026-10-31-asset-relay-expiry-cleanup` 中只按 `1000` 子请求上限设 `R2_CALL_BUDGET = 900` 的决定，收紧到免费层 `10ms` CPU 安全线内并消除连续上传重复全表 `list()`。

## ★4 全状态

- 空状态：R2 空桶统计全 0、清理删 0 次；反馈空对象 `{}` 正常校验通过。
- 加载 / 流式传输中：`caches.default` 命中直接流式返回 C++ `206`；冷节点未命中时 `ctx.waitUntil` 异步写缓存，客户端流不等待二次拉取。
- 成功：单段 Range 返回 `206` 精确字节与 `Content-Range`；上传返回 `201` 并写入 `expiresAtMs` + 增量更新缓存；反馈返回 `200` 编号。
- 失败 / 越界：Range 起点越界返回 `416` + `bytes */size`；反馈超 `2MB` 返回 `413 too_large`。
- 部分成功（分批清理）：积压超单次预算（`32` 次调用或 `10000` 对象）时已删批次生效，返回 `complete: false`，下个整点继续。
- 取消中：客户端提前断开视频流时底层 `ReadableStream` 自动取消，已投递 `ctx.waitUntil` 的边缘缓存写入独立完成或安全忽略异常。
- 过期：R2 素材到期后 `readAsset` 惰性删除并失效用量缓存返回 `404`；整点 `cleanup` 批量删除并失效用量缓存。
- 能力不可用：无 `caches.default`（如本地单测或预览域名）自动走无计数静态长度切片回退；R2 用量超预算无法核实时返回 `503 usage_unavailable`，桌面端回落其他上传通道。

## ★9 验收与回滚

- 真实场景复现：
  - 用户的流程：生产环境过去 24 小时内访客访问官网播放/拖动 7.6MB MP4 视频、客户端调用素材中转站与反馈 Worker，Cloudflare 后台告警至少 100 次触及免费层 `10ms` CPU 时间限制。
  - 我走的：在本地用真实 `marketing/` 媒体清单（含 `7,962,929` 字节 `nomi-0.22-film.mp4` 及 4 个 `.webm`）驱动站点 Worker、`caches.default` 替身、R2 忠实替身与 2MB 反馈边界载荷回放全链路。
  - 差别：本地无 Cloudflare 生产账号边缘遥测面板，使用计数探针精确断言 JS 流 `reader.read` / `TransformStream` 回调次数、`ASSETS.fetch` / `ASSETS.list` 调用次数、`Date.parse` 与 `TextEncoder.encode` 触发次数。
  - 修前：冷启动 `Range: bytes=0-1` 触发 2 次 `ASSETS.fetch` 并逐块读完整个视频数长度，每次尾部 Range 拖动遍历全部前缀块；每次上传全表 `ASSETS.list()` 且 `cleanup` 单次允许 900 页（最高 90 万对象 `Date.parse`）；每笔反馈无条件 `new TextEncoder().encode(raw)`。
  - 修后：媒体 Range 0 次读流数长度、`caches.default` 命中及 `bytes=0-` 0 次进入 JS `TransformStream`；`marketing/` 全部音视频与 `MEDIA_ASSET_SIZES` 100% 对齐；连续上传复用缓存零重复 `list()`、单次预算 `<= 32` 次调用且 `<= 10000` 对象、数值 `expiresAtMs` 零 `Date.parse`；常规与超大 ASCII 反馈包零 `TextEncoder.encode` 拷贝。
- 验收清单与反例（动手前写全）：
  1. **反例 A（什么都不做 / 保留旧实现）**：目标测试断言冷启动无 `Content-Length` 请求 `/assets/video/nomi-0.22-film.mp4` 时 `ASSETS.fetch` 只调 1 次且不消费完整流、连续两次上传 `ASSETS.list` 只调 1 次、常规反馈 `TextEncoder.prototype.encode` 调 0 次 → 在旧代码上全部红灯。
  2. **反例 B（全部拦下 / 一刀切回 200 或拒单）**：若为省 CPU 对 Range 一律回 `200` 或拒单 `416`/`503` → Safari `bytes=0-1` 的 `206` 断言与正常上传 `201` 断言立即红灯。
  3. **反例 C（静态字节表漂移）**：修改或删除 `MEDIA_ASSET_SIZES` 任一字节数 → `scripts/marketing/serving-contract.test.mjs` 与 `node scripts/build-marketing-site.mjs --check` 立即红灯。
  4. **反例 D（`caches.default` 命中仍走 JS 流）**：`caches.default.match` 命中时若构造了切片流或调用 `ASSETS.fetch` → 探针断言立即红灯。
  5. **反例 E（清理后缓存未失效导致误拒上传 / 上传未累加导致超额放行）**：桶满 `507` 后跑 `cleanup()` 必须立即恢复 `201`；连续小文件上传累加超 `MAX_STORAGE_BYTES` 时即使命中缓存也必须精确返回 `507`。
  6. **反例 F（多字节 UTF-8 绕过 `feedback-worker` 2MB 限制）**：`800,000` 个中文字符（字符数 `< 2MB`，UTF-8 `2.4MB > 2MB`）且谎报 `Content-Length: 1` → 仍进入精确测量并返回 `413`。
- 验证命令：
  - `node node_modules/vitest/vitest.mjs run electron/catalog/siteWorkerByteRange.test.ts electron/catalog/kieSunoAckWorker.test.ts scripts/marketing/serving-contract.test.mjs`
  - `pnpm run check:asset-relay && pnpm run check:feedback-worker`
  - `node scripts/build-marketing-site.mjs --check`
  - `pnpm run check:root-cause-contracts && pnpm run check:concept-owners && pnpm run check:escape-ledger`
- 回滚：`git revert <merge-sha>` 后按需重部署对应 Cloudflare Worker。
