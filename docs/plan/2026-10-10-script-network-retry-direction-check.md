# 方向检查：脚本网络调用的瞬断重试（gate-family 触发项）

> 触发：`node scripts/fix-churn.mjs scripts/check-network-entry.mjs` 命中自写登记 `gate-family`（30 天内第 2 个以上 fix）。本次并不修改 `check-network-entry.mjs`，但新门岗落在同一族（`scripts/check-*.mjs`），所以按规则写这一页。

## 0. 一句话根因

CI / 交付脚本各自直接调 GitHub API 或 `gh`，仓库里没有「网络瞬断重试」这一个共用边界，于是每个新脚本天然是「一次 `fetch failed` = 一次红」。

## 1. 归类表

| 事件 | 直接原因 | 类 |
|---|---|---|
| #1155 合入后 main 的 Quality Gate 红（`ci-annotation-hygiene` 取作业注解） | 一次 `fetch failed`，脚本不重试，直接判红；合并循环看到红收据整体停住约一小时，rerun 即绿 | 控制面网络调用没有共用重试边界 |
| `merge-preflight` 的 `ghApiFile` / `ghEscapeLedger` 等 | 任何错误（含网络瞬断）一律吞成 `null`，把「没取到」当「没有」 | 同上，且更隐蔽：瞬断被当成数据 |
| `git-delivery` 的 `listCommitCheckRuns`（verify-merged 收据） | 单次尝试，瞬断即抛 | 同上 |

## 2. 为什么会一直出现

重试是通用能力，不是 Nomi 的领域。每个脚本作者在写 `fetch` / `gh` 的当下只想着「拿到数据」，没有任何东西提醒他「这是一个会瞬断的网络调用」。靠 review 记得加重试，等于靠人记。

## 3. 不改结构的话会冒出什么

| 预测 | 验证 |
|---|---|
| 下一个新写的、取 GitHub / Cloudflare 数据的脚本仍然是「一次瞬断 = 红」 | 新门岗 `check:script-network-retry` 的必红用例：裸 `gh` / 控制面 `fetch` 一律红 |
| 合并线被一次瞬断卡住的事故再来 | 把修前的 `ci-annotation-hygiene.mjs` 放回去，门岗红 + 三条新单测红（已做变异校验） |

## 4. 独立性检查（特征测试）

`scripts/ci-annotation-hygiene.node-test.mjs` 新增：注入 `fetchImpl` 先抛 `fetch failed` 再成功，结果必须 `passed: true`；用完次数仍红且写明重试次数；403 只调用一次。判定由测试自己做，不依赖评分器或 UI。

## 5. P0：是否有现成方案

| 候选 | 看了什么 | 结论 |
|---|---|---|
| `p-retry`（仓库 lockfile 里有 4.6.2 / 7.1.1，均是传递依赖，不是根依赖） | 只有异步；`merge-preflight` / `prBody` / `check-pr-judgement` / `eng-metrics` 是同步 `execFileSync`，要么再手写一份同步循环，要么把四个入口改成异步 | 不接：10 个入口文件里 5 个是同步 `gh` 子进程，接了也要自写同步版，两套循环更糟 |
| undici `RetryAgent`（`undici` 是根依赖 6.19.8） | 在 dispatcher 层重试，默认方法含 PUT / DELETE、状态码含 429、错误码含 ENOTFOUND（出处 https://github.com/nodejs/undici/blob/main/docs/docs/api/RetryAgent.md），范围比我们要的宽 | 不接：只覆盖 `fetch`（4 个文件），覆盖不了 `gh` / `git` 子进程（6 个文件）；且注入 `fetchImpl` 的单测打不到 dispatcher 层，事故的「注入一次 fetch failed」无法在单测里复现 |
| 把 eslint `no-restricted-syntax` 当门岗 | `eslint.config.mjs` 全局忽略 `scripts/**` | 不接：解除忽略要把几百个脚本一次性纳入 lint，远超本次范围 |
| GitHub Actions 步骤级重试 | 平台没有原生 step retry；第三方 retry action 需要钉版本，且覆盖不了本机的 `verify-merged` / `merge-preflight` | 不接 |

自写部分：`scripts/lib/transientRetry.mjs`，约 150 行，其中「哪些错误算瞬断」「gh 只读白名单」是 Nomi 交付链路的约束。登记归属：`gate-family`（`scripts/check-*.mjs` 门岗），retry 助手在 `scripts/lib/`，不在 `self-written.json` 门岗扫的 `src/`、`electron/` 范围内。替换条件：若以后 `scripts/` 整体异步化，可把 `retryTransient` 换成 `p-retry`，`fetchWithRetry` / 门岗不变。

## 6. 选项

| 选项 | 代价 / 风险 | 建议 |
|---|---|---|
| A. 只给 `ci-annotation-hygiene` 加重试 | 最小；其余 9 个入口文件仍是同一颗雷 | 不采用（只修一处不算完成） |
| B. 共用助手 + 全部入口接上 + 新门岗拦住新写的 | 一个 PR 约 15 个文件，改动是机械替换 | **采用** |
| C. 在 workflow 层整个步骤重跑 | 平台无原生支持；本机脚本不受益 | 不采用 |

## 7. 用户要权衡的核心

重试只给只读调用：写操作（`gh issue create`、POST）和花钱调用（模型厂商探测）结构上进不了助手，换来的代价是这些调用仍然「一次瞬断 = 失败」，这是有意的——重试可能把写做两次。
