# 方向检查：设计实验室类型检查在 CI 上被内存杀掉

> 触发：自写登记 `gate-family`（状态 under-review）近 30 天 fix 数已超线，这一刀又碰 `scripts/check-design-lab.mjs`。
> 批准口径：只因自写登记口径命中、文件本身没命中，改法是「换」（把隐含的机器默认值换成写明的数），不新增分支或特例——协调会话代批，事后报用户。

## 0. 一句话根因

同一道检查在两种机器上不是同一个条件：`check:design-lab` 调 `tsc -p tsconfig.devlab.json` 时没写内存上限，CI 的 Mac 机器实测到约 2G 就被杀，开发机能过；而实验室的类型检查程序本身已经长到贴着 2G。

## 1. 归类表

| 现象 | 直接原因 | 类 |
|---|---|---|
| 一个 PR 本机 `check:design-lab` 的类型检查绿，CI 的 Design Lab (macOS) 2 分多钟红，日志 `JavaScript heap out of memory`（崩溃时堆 2042M），没有任何类型错 | tsc 进程吃机器默认的堆上限；CI 机器上这个上限低于这次程序需要的内存 | 门岗的运行条件随机器而变（本机绿、CI 红，且红得和改动内容无关） |

量到的数（本机，`tsc --extendedDiagnostics -p tsconfig.devlab.json`，另用 `node --max-old-space-size=<上限>` 复现）：

| | 文件数 | 2048 上限 | 3072 上限 |
|---|---|---|---|
| 主线 17e406f02 | 5875 | 过 | 过 |
| 多 114 个文件的 PR | 5989 | 被杀 | 过 |

## 2. 为什么这一类会一直出现

- 实验室入口顺着 import 把几乎整个应用带进类型检查（5875 个文件），程序大小跟着整个应用长，不跟着实验室自己长。
- 上限不在仓库里：没人写过，也就没有任何检查能看到「离上限还剩多少」。
- 这道检查的完整版只在 CI 跑；本机就算跑，机器内存大也永远绿。

三条体验铁律：不适用（门岗运行条件问题，不涉及意图抽取、参数清单、点击预期）。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 之后任何往实验室可达代码里加一百来个文件的 PR，都会在 Design Lab (macOS) 上以内存崩溃红，和 PR 内容无关 | 在主线上 `node --max-old-space-size=2048 node_modules/typescript/bin/tsc --noEmit -p tsconfig.devlab.json`，再在任一较大的开着的 PR 上跑同一条 |
| 每撞一次，至少多等一轮 CI，且日志是原生崩溃栈，第一眼看不出是内存 | 看失败作业日志开头 |

## 4. 靶子独立性检查

靶子是 tsc 自己的退出码，不是我们写的尺子；没有「修对了反而掉分」的先例。

## 5. 选项

1. **接入现成方案**（长期方向）：TypeScript 官方性能指南（github.com/microsoft/TypeScript/wiki/Performance）对大工程的建议是拆成 project references、收窄 `include`、开 `--incremental`。对应到这里：让实验室的类型检查不再把整个应用重查一遍（应用本体已经由主类型检查查过），程序大小就和应用脱钩。工作量大，要动 tsconfig 的拆分方式，另起一刀。
2. **写明上限**（这一刀）：调 tsc 时带 Node 的标准参数 `--max-old-space-size`（单位 MiB，nodejs.org/api/cli.html），取 4096；CI 的 Mac 机器 7G 内存，这一步只有 tsc 在跑。两种机器同一个条件，判据一条不动。
3. 不动：每个长大的 PR 各撞一次。

## 6. 结论

先做 2（只换一个参数，不加分支），1 记进计划表「减重与提速」那一组，和 `gate-family` 的门岗账本一起在 2026-11-30 前定：届时要么实验室类型检查瘦身后把上限调回去，要么所有 tsc 调用统一由 `scripts/typecheck.mjs` 一处写明上限。现在换不了成熟方案的原因：拆 project references 要先理清实验室和应用之间的 import 边界，不是一个参数的事；而主线现在就卡着开着的 PR。

## 7. 特征测试

反例：上限给 512 → tsc 被 SIGABRT 杀掉（status=null）；上限 4096 → 通过（status=0）。CI 上的证据是带这次改动的 Design Lab (macOS) 作业。
