# 官网视频支持分段请求（Safari / iPhone 能播宣传片）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

- 日期：2026-09-27
- 触发：#901 手动部署上线后核对线上，`Range: bytes=0-1` 请求 `nomiaqm.com/assets/video/nomi-0.22-film.mp4` 回的是 200 + 整个 8 MB 文件（走不走本机代理都一样）。
- 根因合同：`docs/fixes/2026-09-27-site-media-byte-ranges.root-cause.json`

## 为什么改

浏览器播视频、拖进度条，靠的是「只要第 N 到第 M 个字节」的分段请求（HTTP Range）。Safari 和 iPhone 上的所有浏览器要求服务器支持它，否则视频直接播不出来；Chrome 虽然能播，但官网功能段要从片子第 58 秒开始循环，没有分段就得先把前面几 MB 全下完。

官网由 Cloudflare 的静态资源服务直接返回文件，它只会回 200 / 304 / 404，从不回 206。宣传片是官网和 README 的头号素材，B 站观众大多在手机上看，这一条必须修。

## 先查别人

- 平台本身支不支持？Cloudflare 静态资源服务的源码 `cloudflare/workers-sdk` `packages/workers-shared/asset-worker/src/handler.ts`（`resolveAssetIntentToResponse` 只有 `NotFoundResponse` / `OkResponse` / `NotModifiedResponse`）没有任何 Range 处理；功能请求 https://github.com/cloudflare/workers-sdk/issues/3861 被关闭但线上实测仍是 200。结论：**平台静态资源层不给 206，要在 worker 里补**。
- 平台有没有现成的切片？Workers Cache（https://developers.cloudflare.com/workers/cache/configuration/ ，`"cache": {"enabled": true}`）会替 worker 做 Range 切片；但开启后**所有静态资源请求**都按 worker 请求计费（https://blog.cloudflare.com/workers-cache/ ），免费档每天 10 万次上限，宣传期流量高峰会让整站报错。Cache API `cache.match` 也会按 Range 回 206（https://developers.cloudflare.com/workers/runtime-apis/cache/ ），但在 workers.dev 上是空操作、每个机房首次都要整份写入。结论：**不用平台缓存切片**，只把视频路径交给 worker，自己切。
- 语义照谁？Express 的 `send` / `range-parser`（https://github.com/pillarjs/send 、https://github.com/jshttp/range-parser ）：单段 → 206；多段、别的单位、格式错 → 忽略 Range 回整份 200；起点越界 → 416 + `Content-Range: bytes */总长`；`If-Range` 对不上 → 整份。规范 RFC 9110 §14（https://www.rfc-editor.org/rfc/rfc9110#section-14 ）。我们照抄这套语义，不引依赖（官网构建零依赖，见下）。
- 流式响应的长度怎么带？Workers 运行时会忽略手写的 `Content-Length`，要用 `FixedLengthStream`（https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/ ）。`wrangler dev` 实测：从 `env.ASSETS` 拿到的响应头里**没有** `Content-Length`（长度只挂在流上），所以总长度按 ETag（文件内容哈希）完整读一遍记下，同一份文件只数一次。
- 为什么不引 `range-parser`？Cloudflare 构建为了省构建额度要设 `SKIP_DEPENDENCY_INSTALL=1`（官网构建只用 node 内置模块），worker 一旦 import npm 包就得装全仓依赖。解析只有一种形状（`bytes=起-止`），十几行。
- TikHub 自媒体：不适用（站点服务层修复）。

## 范围

- `wrangler.toml` → `wrangler.json`（Cloudflare 官方支持的同义配置，JSON 让门岗能精确读出路由规则）：新增 `assets.binding = "ASSETS"`（worker 代码早就写了 `env.ASSETS`，但配置从没绑定过）与 `run_worker_first = ["/*.mp4"]`（只有视频先进 worker，图片和页面仍走静态层，不多算请求）。
- `worker/byteRange.ts`（新）：Range 解析 + 按 ETag 数总长 + 流式切片 + `FixedLengthStream`。
- `worker/index.ts`：非回调请求一律 `serveAssetWithRanges`；删掉「没绑定 ASSETS 就回纯文本 Not Found」的分支（绑定现在一定在）。
- `worker/kieSunoAck.ts`（新）：`ACK_PATH` 挪出入口模块——workerd 把入口模块的每个具名导出都当入口加载，导出一个字符串会让新版运行时拒绝启动（`wrangler dev` 实测报错），线上是暂时放过。
- `marketing/_headers`：视频、demo、两张社交预览图的规则先 `! Cache-Control` 再设，避免和 `/assets/*` 的「一年不变」拼成两份互相矛盾的缓存头（线上实测 `public, max-age=31536000, immutable, public, max-age=3600, must-revalidate`）。
- 测试：`electron/catalog/siteWorkerByteRange.test.ts`（报告案例 + 各种 Range 形态）、`scripts/marketing/serving-contract.test.mjs`（类门岗：`marketing/` 下每个音视频文件都必须先进 worker；每个文件最多一份 Cache-Control）、`electron/catalog/kieSunoAckWorker.test.ts`（回调不许碰 ASSETS；入口只许默认导出）。

## 不动项

- 页面、生成器、宣传片文件本身不动。
- 404 页（线上不存在的路径现在回空白 404）：要新画一页，按 R8 先出样张，登记 TODO，不在这里做。
- 回调地址 `https://nomiaqm.com/api/vendor-callbacks/kie/suno/ack` 在 electron 音频档案里散着多份拷贝：属于音频档案那条线的概念，登记 TODO。
- Cloudflare 后台设置（关分支预览构建、`SKIP_DEPENDENCY_INSTALL=1`）由用户在后台改，不进仓库。

## 回滚

单个 PR，`git revert` 合并提交后重新 `npx wrangler deploy` 即回到「静态层直接回整份」。

## 验收门

- 报告案例先红后绿：新测试在修复前 7/10 红、门岗测试红（缺 `wrangler.json`、9 个文件两份 Cache-Control），修复后 19/19 绿。
- 真运行时：`wrangler dev`（本机 workerd + 真实路由层与静态层）上 `bytes=0-1` / 中段 / 结尾 / `bytes=0-` / 越界 / 普通 GET / HEAD / `demo.mp4` / 图片 / 页面 / 回调 / 404 逐条核对，字节与原文件 `cmp` 一致。
- 合并后部署，线上 `nomiaqm.com` 同一组请求复核一遍。
