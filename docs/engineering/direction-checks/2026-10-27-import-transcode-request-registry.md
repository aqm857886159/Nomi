# 方向检查：导入转码的在途请求停止登记（#14 第 3 刀）

> 触发：`node scripts/fix-churn.mjs electron/assets/assetsIpc.ts` 命中「文件近 14 天已有 4 个 fix，这一刀是第 5 个」；`electron/video/videoIpc.ts` 只因目录 `electron/video/` 命中（第 7 个）。同一条线第 3 轮（I-import-transcode 第 1 轮、I-import-transcode-r2 第 2 轮、本刀 I-import-transcode-r3）。
> 结论由用户 10-27 拍板：选「并成一份」（第 6 节表里第 3 行）。

### 0. 一句话根因

主进程里每种「跑得久、要能被停」的 IPC 长请求（补预览、视频拆解、导入转码）都要把「发起窗口没了 / 项目会话失效 / 应用退出」汇成一个 AbortSignal。10-27 已经按用户拍板把它收成一份中立的 `electron/ipcRequestRegistry.ts`（补预览 + 拆解共用），导入线同一天并行开发，看不到它，又写了第二份 `electron/assets/importRequests.ts`。缺的不是哪一处判断，是「长请求的停止只许走这一份」没有落到导入上。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 287b7823b（10-16）补预览可打断 | 补预览的 ffmpeg 没人停，新写 `previewRequests.ts` | 长请求自己写停止登记 |
| 42736b307（10-17）生成产物落盘核字节 | 三扇写入口各自核类型 | 另一类（写入口不统一），本刀不管 |
| f66decf47（10-27，#1353）拆解取消真停 | 拆解要同样的停止；按用户拍板把 `previewRequests.ts` 挪成中立的 `ipcRequestRegistry.ts`，旧文件同提交删掉 | 同类，已收成一份 |
| dae9e0fc0、7a3202d79（10-27，#1347）导入转码跟着导入走、退出等落定 | 导入要停止，且退出时要等 ffmpeg 真退出、临时文件真删掉；另写 `importRequests.ts` | 同类，第二份 |

### 2. 为什么这一类会一直出现

Electron 的 `ipcRenderer.invoke` 没有取消机制，AbortSignal 也过不了结构化克隆，所以「这条请求的主人」只能在主进程里拼出来。没有一处所有长请求都必须经过的停止边界时，谁需要谁照着写一份；中立模块和导入修复是同一天在两条并行的线上写的，后合的那条看不到先合的那份。两份的差别也正是分叉的开始：导入那份退出时等真停、退出后不收新请求，中立那份只发中止、不等。

三条体验铁律：都不适用。这是主进程资源的生命周期（进程、临时文件），不是意图与参数、档案选项或点击预期的对账。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证（命令或步骤） |
|---|---|
| 两份的退出语义继续分叉：导入退出会等 ffmpeg 真退出，补预览 / 拆解只发信号不等，某一边在退出时留下孤儿 ffmpeg 或半成品 | 打包版在转码、补预览、拆解途中各退出一次，`ps` 看 ffmpeg 是否还在，系统 tmp 下有没有残留 |
| 下一个长请求（导出探测、外部工作流）照着其中一份抄出第三份 | `git grep -n "new AbortController" electron/` 数主进程里各自汇停止来源的地方 |
| 修了一份的缺陷（例如退出后还接新请求）另一份照旧 | 对照两份单测各自钉住的语义 |

### 4. 靶子独立性检查

- 验收线（V-import-transcode 系列、V-deconstruct-cancel 系列）和实现线不是同一条线；本刀不改任何评测或尺子。
- 没有「修对了反而掉分」的先例。

### 5. P0：这些是我们独有的吗？现成方案有哪些

不是领域能力，是 Electron IPC 的通用缺口。自写登记 `docs/engineering/self-written.json` 已有一条，paths 为 `electron/ipcRequestRegistry.ts`，status justified：invoke 没有取消、AbortSignal 过不了 IPC（https://www.electronjs.org/docs/latest/api/ipc-renderer#ipcrendererinvokechannel-args）。信号本身用 WHATWG / Node 的 AbortController，不自写。没有能直接接入的现成库，所以只许有这一份。

### 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 没有：Electron 不提供 invoke 取消，见第 5 节 | — | — | — |
| 补 | 机械并 main，导入继续用 `importRequests.ts` | 最省，#14 早约 1 小时进 main | main 上同一概念两份，违反 10-27「旧文件同提交删掉，不留第二份」 | 否 |
| 重写（限一个模块）：并成一份 | 中立那份补上 `drain`：立刻中止全部在途、之后不再接新请求、等它们都落定才兑现；导入改用它，同一提交删掉 `importRequests.ts` 及其单测，单测并入 `electron/ipcRequestRegistry.test.ts`；拆解的退出调用保持「只中止不等」 | 一轮实现 + 小复验，#14 晚约 2 小时进 main | 动到拆解的退出调用（只换方法名，行为不变） | **是（用户 10-27 拍板）** |
| 删 | — | — | 导入的停止就是 #14 的修复本身，删不掉 | 否 |

### 7. 用户要权衡的核心

#14 早一小时进 main，换不换 main 上多一份同功能的停止登记——用户选了并成一份。

## 特征测试清单（动结构前先锁住）

- `electron/ipcRequestRegistry.test.ts`（main 已有：按请求号撤回、窗口销毁、项目会话失效、退出全撤）。
- `electron/assets/importRequests.test.ts`（#14：窗口销毁、项目会话失效、退出排空等落定、排空后不接新请求）——并入上一个文件后删除。
- `electron/assets/importTranscodeLifecycle.integration.test.ts`（#14：真 ffmpeg 下退出排空等进程没了、半成品和临时目录删掉）。
- `electron/assets/previewRequests.test.ts`（main 已改为测中立模块）。
- 退出真机：V-import-transcode 那一遍（转码到 16% 时 `app.quit()`，216 ms 主进程退出、ffmpeg 没了、私有 TMPDIR 清空）由小复验重跑。
