# TikHub → 项目素材 → 视频拆解 → 分镜表 receipt

## 基线与范围

- base: `origin/main=68e88075ddfaa90edb0078f902b2d9103dba1bb3`
- branch: `codex/tikhub-project-video-breakdown-e2e-20260904`
- 仅使用 loopback HTTP fixture；没有真实 TikHub API key、外部 upstream 或付费 provider。
- 没有修改视觉 UI、CSS、样张或 baseline coverage 配置。

## H/B/E/T/N 矩阵

| 类别 | 真实入口/边界 | 可执行证据 | 结果 |
| --- | --- | --- | --- |
| H | Electron 素材库“贴链接导入”→项目素材→视频节点“拆解”→真实视觉模型 wire→加入画布 | `node tests/ux/tikhub-project-video-breakdown.e2e.mjs`；TikHub `3` 请求、模型 `2` 请求，首个请求含 `image_url` 参考帧 | 通过 |
| B | TikHub 200 envelope 但 HQ 与 aweme fallback 都没有播放 URL | `pnpm exec vitest run electron/connectors/tikhubLocalFixture.test.ts`，真实 `resolveShareVideo` 入口实际发出两次本地 HTTP 请求并返回 `no-play-url` | 通过 |
| E | TikHub upstream 401/404 | 同上；真实 resolver boundary 保留 `auth/401` 与 `not-found/404`，不错误切换线路 | 通过 |
| T | resolver 的生产失败边界收到 `upstream` timeout seam，备线路为空 | 同上；真实 `resolveShareVideo` 入口收口为 `no-route` | 通过 |
| N | 非 E2E、非法 URL、非 loopback origin；模型返回非 JSON | connector 本地测试覆盖前两者；Electron journey 将第二次模型响应设为 malformed，结果为 `visionFailed=true`、`failedShotIndexes=[1]` 且没有伪造 visual | 通过 |

## 真实 Electron assertion

`15` assertions passed，包含：

1. 真实创建项目并进入项目。
2. 真实保存 fixture key 通过 TikHub account verification。
3. 项目素材出现视频，source evidence 保留 `connectorId=tikhub`、原始分享文本和 resolved URL。
4. 通过真实“拆解”用户入口，模型实际收到包含三张原片参考帧的 OpenAI-compatible request。
5. 得到结构化镜头结果：`1` shot，`failedShotIndexes=[]`。
6. `sourceFrameUrl` 为真实生成的 `nomi-local://` 原片帧，而非注入结果。
7. “加入画布”产生 `1` 个图像分镜节点。
8. 项目持久化 readback 保留拆解结果和画布副作用。
9. cold restart 后项目、拆解结果和分镜表 UI 均可 readback。
10. 第二次真实拆解遇到 malformed model response 时 fail-closed，不产生视觉分析假结果。

## TDD 与验证命令

- RED：`pnpm exec vitest run electron/connectors/tikhubLocalFixture.test.ts`；在加入 loopback origin seam 前失败于 `TikHub 出站目标非法：127.0.0.1`。
- GREEN focused：`pnpm exec vitest run electron/connectors/tikhubLocalFixture.test.ts electron/connectors/tikhubConnector.test.ts electron/connectors/tikhubTransport.test.ts electron/connectors/tikhubConnectorService.test.ts electron/catalog/taskParams.test.ts electron/video/deconstructVideo.test.ts` → `6` files / `135` tests passed。
- Matrix/service coverage run：`pnpm exec vitest run ...`（见下方 raw V8 command）→ `5` files / `121` tests passed。
- TypeScript：`pnpm run typecheck` → exit `0`。
- Scoped lint：`pnpm exec eslint electron/catalog/taskParams.ts electron/connectors/tikhubConnector.ts electron/connectors/tikhubConnectorService.ts electron/connectors/tikhubLocalFixture.test.ts tests/ux/tikhub-project-video-breakdown.e2e.mjs` → `0` errors；`.mjs` 被仓库 ignore 规则跳过，只有 `1` ignored-file warning。
- Build：`pnpm run build` → exit `0`，Electron identity check `43.4.1` 通过。
- Real Electron：`node tests/ux/tikhub-project-video-breakdown.e2e.mjs` → `15` assertions passed，`tikhub=3`、`model=2`。

## Changed production scope raw V8 receipt

命令：

```bash
pnpm exec vitest run --coverage.enabled --coverage.provider=v8 \
  --coverage.reporter=text --coverage.reporter=json \
  --coverage.reportsDirectory=.tmp/coverage/tikhub-scoped \
  electron/connectors/tikhubLocalFixture.test.ts \
  electron/connectors/tikhubConnector.test.ts \
  electron/connectors/tikhubTransport.test.ts \
  electron/connectors/tikhubConnectorService.test.ts \
  electron/catalog/taskParams.test.ts
```

Raw V8 artifact: `.tmp/coverage/tikhub-scoped/coverage-final.json`（本地生成、未提交；不覆盖或修改 baseline coverage）。该运行结果为 `5` files / `121` tests passed。

Scoped target is only the changed production behavior, not whole-file or whole-repository coverage:

| Production target | V8 function hit | Changed behavior evidence |
| --- | ---: | --- |
| `imageEditGuardError` runtime-fixed `image_to_prompt` early return | `1/1` | local regression test hits the guard and real Electron reaches `image_to_prompt` with frames |
| `getTikhubTestOrigin`, `resolveRuntimeHost`, `fetchTikhubJson`, `verifyTikhubApiKey`, `resolveShareVideo` | `5/5` | local HTTP happy/401/404/no-play-url/invalid-origin/timeout cases |
| `importTikhubShareUrl` and its trusted-origin closure | `2/2` | service test asserts source evidence and `trustedPrivateOrigin`; Electron also executes real import |
| Scoped changed production functions total | **`8/8 = 100%`** | function scope only |

Raw V8 function counts from `.tmp/coverage/tikhub-scoped/coverage-final.json`: `imageEditGuardError=11` hits；`getTikhubTestOrigin=18`、`resolveRuntimeHost=24`、`fetchTikhubJson=15`、`verifyTikhubApiKey=5`、`resolveShareVideo=22`；`importTikhubShareUrl=1`、trusted-origin closure=`1`。每个 scoped target 均 `count > 0`；这些数字是执行次数，不是全文件覆盖率百分比。

Uncovered intentionally: unchanged functions in `taskParams.ts` and `tikhubConnectorService.ts`, unrelated connector route internals, full Electron process instrumentation, renderer/UI components, and whole-repository baseline coverage. No whole-repo 100% claim is made.

## Live-provider boundary

Live TikHub/provider certification remains intentionally unclaimed. This PR proves the production connector and video-deconstruction user journey against local boundary fixtures only; API credentials, external network, model quota and paid-provider behavior require a separate authorized live canary.
