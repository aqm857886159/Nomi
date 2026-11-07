# 方向检查：试跑记录和信封新接口对不上

命中原因：`submissionIntent.ts` 14 天第 6 个 fix，`tryModel.ts` 第 5 个。

### 0. 一句话根因

两个 PR 各自在旧 main 上 CI 全绿，合起来接口对不上，而合并前没有人用「合并后的那棵树」跑过检查。这不是试跑行为第六次出错。

### 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| #1393 | 把 `markPolled` 改成异步、要带 `observed`，删掉 `markMaterialized` | 共享接口变了（正常改动） |
| #1387 | `recordResult` 还按旧接口调；两边没有文本冲突，Git 合得过 | 语义合并冲突 |
| 这个文件之前的 5 个 fix | 都是 #1387 自己开发和两次验收过程中的修复，同一个功能的提交 | 不是复发，只是都落在 14 天窗内 |

### 2. 为什么这一类会一直出现

PR 的 CI 跑在它开始那一刻的 main 上。main 往前走了，已有的绿灯不会失效，文本不冲突就能合。

另外 `recordResult` 是「尽力而为」，`catch` 吞掉一切，所以接口不对时单测照样绿，只有类型检查和推送前快检的未处理拒绝看得到。

三条体验铁律（⑩ ⑪ ⑫）不适用：这是交付流程的洞，不是用户操作的预期和结果不一致。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 下一对「一个改共享接口、一个新加调用方」的 PR 还会把 main 弄红 | 查合并收据：合并提交的类型检查红，而两个 PR 各自的 CI 是绿的 |
| 吞错误的写入在接口变化后静默失效 | 把 `markPolled` 调用改成旧写法跑矩阵：改之前全绿，这次加了断言后 6 格红（已做） |

### 4. 靶子独立性检查

新断言直接读落盘记录，不看 `recordResult` 的返回。验收线另开一条，只核这次的改动面。

### 5. P0：这些是我们独有的吗？现成方案有哪些

不是我们独有的，这叫 merge skew / semantic merge conflict，有现成做法，见下表。

### 6. 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成：合并队列 | GitHub merge queue | 只有组织名下的仓库能用（[文档](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)），本仓库是个人名下 | 用不了 | 否 |
| 接入现成：严格模式 | 分支保护的 Require branches to be up to date（[文档](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)） | 每合一个都要先并 main 再跑一轮全量 CI，约 40 分钟 | 多个 PR 排队排不动 | 否 |
| 补 | 合并前扫描先合成「最新 main + PR」的树，在那棵树上跑类型检查，红了不合 | 每次合并多 1 到 2 分钟 | 只抓接口层；行为层还靠合并收据 | **是** |
| 删 | 去掉 `recordResult` 的吞错误 | 记录写失败会让已花钱的结果报错丢失 | 比现在更糟 | 否 |

### 7. 用户要权衡的核心

main 红了，是往前修还是回滚 #1387。往前修是 10 行内的接口适配；回滚会把防重复扣费一起撤掉。推荐往前修。

## 特征测试清单

- `electron/capabilityCore/modelOnboarding/tryModelIntent.matrix.test.ts`：共享认领的「取回中」「已落成品」两种状态，现在断言记录真的写进去了。反例红 6 格。
