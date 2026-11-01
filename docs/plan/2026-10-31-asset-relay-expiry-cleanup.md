# 素材中转站：24 小时过期真的删，容量按真实占用算

负责人：本实现线。类别：隐私承诺、成本护栏、Cloudflare Worker 修复。范围：`workers/nomi-asset-relay` 的清理与用量统计、它的测试替身与门岗接线；不改上传协议、不改桌面端。

## 问题

用户 2026-10-31 发现 R2 桶 `nomi-assets` 占了 13.7 GB / 6,728 个对象，超过 8 GB 硬上限和 10 GB 免费额度。中转站承诺文件 24 小时过期，实际一直留存：隐私问题大于费用问题（超出免费额度每月只有几毛钱）。

## ★1 用户怎么用 / 指标

当创作者把参考素材传到中转站时，我想要它在 24 小时后真的消失，以便不把没成片的素材留在别人的服务器上。步骤：桌面端上传 → 拿到 24 小时有效的链接 → 模型读取 → 过期 → 每小时一次的清理删除。

真实任务：①线上桶 6,728 个对象的存量清理（部署后第一个整点 cron，用 `wrangler r2 bucket info nomi-assets` 前后对账）；②清理后继续上传一份素材，容量统计与桶一致；③无 `expiresAt` 的旧对象保持不动并报数量。

不做什么：不删没有 `expiresAt` 元数据的对象（只数）；不动 `nomi-feedback-intake`、`nomi-public-models` 两个桶；不加管理端点；不改 TTL、上限、预算数值。

指标（目标 → 信号 → 指标，量具都是 `tests/asset-relay/worker.node-test.mjs` 和部署后的 `wrangler r2 bucket info`）：
- 承诺的过期兑现：过期对象残留数 → 清理后 `expiredObjectCount` 应为 0 → 部署后 cron 日志 `deleted` 与 bucket info 对象数下降一致。
- 硬上限看得见真实占用：`storageBytes` 与桶内字节差 → 矩阵测试 5 种对象构成 × 4 种分页，差为 0。
- 不超子请求预算：每次清理调用桶的次数 → 每页 1 次 list + 1 次批量 delete；2,700 个对象 6 次调用（测试在 50 次上限下通过）。
- 基线与现状：13.7 GB / 6,728 个对象；目标 ≤ 8 GB；清理后数字见 PR 正文，未验证的写「未验证」。

★1b 连带界面：无用户界面；`/v1/usage` 的 JSON 多了 `expiredStorageBytes`、`untrackedObjectCount`，`objectCount` / `storageBytes` 现在含已过期未删对象（唯一读者是管理员 curl 和测试，仓库内无其他消费者）；cron 每次输出一行 `asset_cleanup` JSON 日志。

## ★2 谁说了算

桶里什么算「已过期」：只有 `assetExpiryMs(object)` 一处，`usageSnapshot`、`cleanup`、`readAsset` 共用；怎么列桶：只有 `assetPages()` 一处（固定前缀、页大小、`include: ["customMetadata"]`）。同一份事实存一份。门图：`node scripts/door-map.mjs` 的扫描根是 `src`、`electron`，Worker 不在其内（0 扇）；用 `rg -n '\.list\(|\.delete\(' workers infra worker` 手数：改前 list 两处 + delete 两处，改后 list 一处（`assetPages`）+ delete 两处（`cleanup` 批量、`readAsset` 单个）。没有靠「东西不见了」猜意图：删除只看 `expiresAt`。

## ★3 一致与复用

复用 R2 绑定自带的 `list({include})`、`delete(keys[])`，不自写分页库、不加依赖。删除：`usageSnapshot` 与 `cleanup` 各自手写的 list 选项、各自手写的过期判断、测试里内联的永远带元数据的 `bucket()` 模拟。新增：`tests/asset-relay/fakeR2.mjs`（忠实的 R2 替身）、`package.json` 的 `check:asset-relay` 门岗（此前该测试文件名 `.node-test.mjs` 不被任何车道认领，从未被跑过）。`git grep -n "customMetadata" workers tests/asset-relay` 核对。

## ★4 全状态

- 空桶：清理返回 0，统计全 0。
- 正常：过期对象每页一次批量删除；未过期保留。
- 失败：list / delete 抛错 → cron 任务失败（Cloudflare 日志可见），下个整点重试；上传前统计失败 → `usage_unavailable` 503，不放行。
- 部分成功：某页删除后下一页失败 → 已删的不回滚，下次继续。
- 取消中 / 过期：对象在 24 小时点后、整点清理前仍可能被读到——`readAsset` 读到已过期的会当场删除并返回 404。
- 容量满：已过期未删的字节也算，上传返回 507 `storage_limit_reached`；桌面端回落到其他上传通道；清理后恢复。
- 能力不可用：无用户界面。
- 无 `expiresAt` 的对象：不删，计入 `untrackedObjectCount`。

## ★9 验收与回滚

验收清单与反例（动手前写全，实现线按它自验）：

1. 新增测试对旧版 worker 必须红、对新版绿 → 实测旧版 38 项中 30 项红（`git show HEAD:workers/nomi-asset-relay/src/index.mjs` 放到临时目录跑同一份测试）。
2. 反例「list 不带 include」：census 与忠实替身两处都红。
3. 反例「逐个 delete」：2,700 对象在 50 次调用预算下超限即红。
4. 反例「不带 `expiresAt` / 值损坏」：不删，计数正确。
5. 反例「分页」：每页 1/2/3/1000 的矩阵；清理边翻页边删，不漏不重。
6. 反例「过期字节不计容量」：上限 120、过期 100 + 活 10，再传 20 → 507。
7. 类会从哪回来：①别的 Worker 列 R2 桶漏 include → census 覆盖 `workers/`、`infra/`；②测试替身放宽 → 替身自身有「不 include 不返回元数据」「超 1000 抛错」的测试；③测试文件没人跑 → 接了 `check:asset-relay`（CI Contracts 的 `gates:contracts`，在 `pre-push-gate-table.mjs` 登记为 CI 门岗；推送前选择器 `pre-push-contracts.mjs` 属热点概念「测试与走查的临时目录归属」，近 14 天 10 个 fix，不往里加登记，方向检查后再接）。
8. 部署后：第一个整点后 `wrangler r2 bucket info nomi-assets` 对象数 / 体积下降，报删除量、剩余量与剩余对象为何不过期。

命令：`pnpm run check:asset-relay`；`node --test scripts/pre-push-structure.node-test.mjs scripts/pre-push-contracts.node-test.mjs`；`pnpm run check:root-cause-contracts`；`pnpm run check:escape-ledger`。

回滚：revert 本 PR 的合入提交后 `npx wrangler deploy --config workers/nomi-asset-relay/wrangler.toml`（回到上一版本也可用 `wrangler rollback`）；回滚会让清理重新失效，不建议。

部署注意：必须带 `--config workers/nomi-asset-relay/wrangler.toml`。在仓库里用 `npx wrangler deploy` 会把工作目录带回仓库根，读到根目录 `wrangler.json`（营销站的 `nomi` Worker）——干跑时撞见过，没有真部署。
