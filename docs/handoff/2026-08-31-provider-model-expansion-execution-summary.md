# 供应商与旗舰模型扩充：执行结果与接手说明

> 文档状态：已完成代码修复与合并前验证；最新 `origin/main` 的本地合并冲突已解决，但合并提交和合并后复验由接手者完成。
>
> 记录日期：2026-08-31
>
> 工作树：`/Users/aoqimin/Desktop/Nomi-provider-model-expansion-20260830`
>
> 分支：`codex/provider-model-expansion-20260830`

## 1. 这次交付解决了什么

目标不是增加一张模型列表，而是保证用户从“选择模型”到“拿回可用资产”的完整链路不被隐藏的共享问题卡住。实现继续复用 Nomi 原有的：

```text
模型 -> 供应商 -> 参数 -> GenerationRuntime/ProductionRun -> 结果校验 -> managed asset
```

没有另建模型中心、供应商专用执行器或平行认证系统。

## 2. 已修复的根因

| 根因 | 修复位置 | 防止的用户问题 |
| --- | --- | --- |
| 应用代理建立前就做 DNS，代理域名被错误 pin 到假私网地址 | `electron/hardenedFetch.ts`、`electron/systemProxy.ts` | 任务提交成功但结果下载被代理拒绝 |
| MP4 结果来自不可 seek 的 pipe，尾部 `moov` 或内容完整性没有验证 | `electron/export/mediaProbe.ts`、`electron/providerAdapter/certificationMedia.ts`、`electron/assets/projectAssetStore.ts` | 视频显示成功但无法播放、重启后资产损坏 |
| 任务查询重建吞掉原始错误 | `electron/tasks/taskResultQuery.ts` | 用户只看到泛化失败，无法恢复或定位 |
| 手动下载绕过统一代理边界 | `electron/assets/downloadAsset.ts` | 自动流程能拿结果，手动下载失败 |
| 私有上传失败后错误地退回匿名图床 | `electron/catalog/assetLocalization.ts` | 用户被迫同意不可靠的第三方临时图床 |
| Runway 初始化缺少版本头；签名 S3 multipart 字段顺序错误；XML 错误被吞掉 | `electron/catalog/runwayOfficial.ts`、`electron/assets/localAssetFile.ts` | Runway 自有上传返回 4xx/5xx，且错误信息无法判断 |
| 最新 main 的 asset-relay 供应商卡与本任务卡片重复注册 `fal`/`runway` | `src/config/knownVendors.ts`、`src/config/knownVendors.test.ts` | 展示目录出现 15 项但只有 13 个唯一 `vendorKey`，Map 后写覆盖前写 |

根因合同位于 [`docs/fixes/2026-08-31-generation-result-retrieval-boundary.root-cause.json`](/Users/aoqimin/Desktop/Nomi-provider-model-expansion-20260830/docs/fixes/2026-08-31-generation-result-retrieval-boundary.root-cause.json)。对应回归测试覆盖代理、上传顺序、MP4 校验、任务查询错误和资产读回。

## 3. 供应商与模型交付状态

认证账本是唯一状态源：[`docs/integration-certification/model-certification-ledger.json`](/Users/aoqimin/Desktop/Nomi-provider-model-expansion-20260830/docs/integration-certification/model-certification-ledger.json)。当前共 66 条“供应商 × 模型 × 模式”记录：

| 状态 | 数量 | 含义 |
| --- | ---: | --- |
| `live-certified` | 7 | 最小真实 canary、结果校验、managed asset 落盘和新进程读回均通过 |
| `simulated` | 53 | 官方合同、静态校验、loopback、故障矩阵和零费用 MCP 通过，尚未做真实 canary |
| `blocked` | 6 | 有明确外部前置条件缺失，不能假报可用 |

### 已完成真实 canary 的代表模型

- KIE Seedance 2.0 image-to-video。
- KIE Gemini Omni 1.1 text-to-video。
- fal Nano Banana 2 text-to-image。
- Runway Gen-4.5 text-to-video 和 image-to-video。
- Runway Seed Audio。
- APIMart TTS。

KIE Seedance 的请求、轮询和免费文件上传按官方合同核对：[Seedance API](https://docs.kie.ai/32356532e0)、[KIE 文件上传](https://docs.kie.ai/file-upload-api/quickstart)。Runway 按官方 OpenAPI 和 API 指南核对：[Runway OpenAPI](https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json)、[Runway API 指南](https://docs.dev.runwayml.com/guides/using-the-api/)。

### 当前明确阻塞

1. KIE Suno `music`、`extend`、`cover`：必须提供生产 ACK Worker 的 `callBackUrl`，部署需要生产 Cloudflare 批准。
2. APIMart Suno、APIMart Lyria：公开索引没有稳定的逐模型 OpenAPI 合同，且没有以该合同为依据执行 canary。
3. Runway Gen4 image：上传初始化和签名上传已验证；旧图片 canary 在代理根因修复前执行，结果落盘没有在最低花费预算内重跑。

Gemini Omni 的 `audio_ids`、`video_list`、`character_ids` 已进入 headless 合同并通过真实 text-to-video canary；Typed UI 控件仍未暴露，账本单独记录这个能力缺口。

## 4. 认证流程和零费用证据

所有新增或修改的模式都按以下顺序处理：

```text
官方文档/OpenAPI
-> 既有模型/供应商/参数合同
-> 静态校验
-> loopback 协议仿真
-> 故障矩阵
-> PR #221 MCP 零费用旅程
-> 最小真实 canary
```

合并 `origin/main` 之前已通过：

- 聚焦改动测试：181 条断言。
- 全量 Vitest：932 个测试文件通过、1 个跳过；8,903 条断言通过、1 个跳过。
- contracts、root-cause contracts、model certification coverage、secrets、i18n、typecheck、lint。
- J0 无密钥 MCP：43 tools、25 resources、`providerRequests=0`。
- J3 故障矩阵：8 组 fail-closed 测试，供应商请求为 0。
- PR #221 MCP spend confirmation：45 条断言，provider quota 为 0。
- Electron smoke：16 条断言；ARM64 packaged MCP smoke 通过。
- renderer/electron build、ARM64 directory package 通过。

合并后全量测试曾先捕获上述重复键回归；删除重复展示卡、保留单一 canonical entry 后，聚焦测试和全量测试均恢复通过。

真实 canary 的供应商扣费金额由 KIE、fal、Runway API 隐藏，账本只记录“已使用最小 canary、精确扣费不可见”。零费用路径没有向供应商发送请求。任何日志、提交和文档均不保存 API Key、签名 URL 或完整供应商凭证。

## 5. 最新 `origin/main` 合并状态

本轮已拉取最新 `origin/main`，并保留其 asset relay 能力：

- `electron/catalog/assetIngestionRegistry.ts`
- `electron/catalog/assetRelayRuntimeConfig.ts`
- `workers/nomi-asset-relay/`
- 设置页、preload、bridge 和 worker 测试

冲突已在以下边界解决：

- `builtinVendorSeeds.ts` 保留本任务的官方供应商种子和 main 的 asset relay 入口。
- `runtime.ts` 保留 multipart 上传参数和本任务的 `putBinaryForAssetUpload`。
- `knownVendors.test.ts` 保留单一 `BUILTIN_VENDOR_SEEDS` 来源。
- 交接、交付账本和计划索引保留双方新增内容。

当前索引状态已通过 merge commit `a2fe4967` 推送；该提交的 main 父提交为当时的 `ae158ee2`。推送后远端 `origin/main` 又前进到 `3a97cffc`，因此 PR 可能再次显示冲突，必须以最新远端基线重新做一次非破坏性合并和验证。合并后的长门禁、全量测试和 build 已在 `a2fe4967` 的树上通过，不能把它们直接当成包含 `3a97cffc` 的最终绿灯。

## 6. 接手者完成标准

1. 在本工作树查看 `git status`，确认没有未解决冲突；完成合并提交并 push 任务分支。完成标准：`git status` 不再显示 “you are still merging”，远端 PR 能看到新的 merge commit。
2. 重新运行 `pnpm run gates:contracts`、`pnpm run test`、`pnpm run build`。完成标准：命令退出码均为 0。
3. 重新运行 `pnpm run test:model-integration:no-repo`、`packaged`、`trusted-audio`、`fault-matrix`、`pnpm run test:mcp-journey` 和 `pnpm run test:e2e`。完成标准：零费用旅程仍显示 `providerRequests=0`，且结果读回成功。
4. 运行 ARM64 packaged smoke；x64 `electron-builder` 若再次卡在 Electron runtime 下载，只记录为网络阻塞，不修改代理或绕过安全边界。
5. 等 PR #241 所有必需检查通过后，再按项目授权合并到 `main`。完成标准：PR 显示 `MERGEABLE`、检查全绿，并能从 `origin/main` 读到合并提交。

## 7. 后续不能做的事

- 不要把 `simulated` 改成 `live-certified` 来减少欠账。
- 不要为了 KIE Suno canary 擅自部署生产 Worker。
- 不要恢复匿名第三方图床作为 Runway 的默认路径。
- 不要为单个供应商复制一套模型、任务或资产系统。
- 不要把真实额度当成字段调试工具；字段问题先回到官方合同、loopback 和故障矩阵。
