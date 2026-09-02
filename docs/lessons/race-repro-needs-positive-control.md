# 复现竞态必须有阳性对照

> 📎 教训 · 首次记录 2026-08-24 · 状态：现行
> **触发场景**：你在验证一个竞态/时序类修复，走查或压测跑绿了想收工；或者你正准备说「这个平台复现不了，得换平台验」。

**结论**：复现**竞态/时序类** bug（`ERR_INVALID_STATE`、双关闭、race）时，跑绿**什么都不证明**，除非同一次运行里有一条**阳性对照**——故意用手控时序把这条竞态摆出来，它必须炸。阳性对照炸了，才说明「这台机器能炸 + 收集器接得住 + 判据有鉴别力」，这时修复版的 0 命中才可解读。没有它，**0 命中和「仪器坏了」长得一模一样**。

**为什么会踩**：

2026-08-24 nomi-local `ERR_INVALID_STATE`（PR #126）。前一轮走查（30 seek + 60 abort，串行、只发整文件请求）在 macOS 上**修复前后都绿**，于是写进计划书 §7b 的结论是「macOS 没有鉴别力，得去 Windows 验」。

实际是**这把尺子不够灵，不是平台问题**——换成压测仪器后**当场在 macOS 上复现**：对照臂 **79/2400** 次取消命中，栈第 2 帧 `node:internal/deps/undici/undici:1465:28` 与用户回报**逐帧对上**；修复臂 **0/4000**。整个「必须去 Windows」的前提是假的，白等一轮。

**平台归因还反过来了**：后来把同一套三臂对照接到 GitHub Actions `windows-latest` 上跑（run 32743160547），**对照臂 0/4000**——即 macOS 复现、Windows CI 不复现，和「Windows 才炸」的猜测正好相反。所以关键变量从来不是平台，是**仪器设计**。另注意 **CI 的 Windows ≠ 报障用户的 Windows**（Azure VM、无 GPU、核数少、磁盘特性差很多），它那三个 0 属于「非鉴别性证据」，**不可读作「Windows 安全」**。

**怎么用**：

1. **先造阳性对照再谈绿灯**。同一进程里手控时序摆出竞态（如 `new Response(手控异步可迭代)` → `read()` 起 pull → `cancel()` → 让 pending 的 `next()` 以 `done=true` 解析）。它不炸就先修仪器。
2. **撑宽竞态窗口，不是单纯加次数**。窗口 ≈「`next()` 已发出、未解析」那段，所以要**高并发制造 I/O 争用 + 大文件随机偏移（逼真磁盘读）+ 取消时刻扫描（0–21ms 多档）+ 混合区间大小**。串行顺序读会命中页缓存，`next()` 瞬时解析 → 窗口趋近于 0 → 永远压不出来。
3. **多臂对照要按「代码形态」分臂，不是按分支名**。`main` ≠ 用户崩溃那一版：本例真正的对照组是 v0.20.1 之前的 `new Response(fs 流)`（Race B，用户栈就是它），`main` 当时已换成 `Readable.toWeb`（Race C，nodejs/node#64529）。拿 `main` 当「未修版」会验错东西。
4. **归因对照要自己造，别用「那时候的 main」**。问「X 是不是这个红的原因」时，直觉是拿 X 合入前的那个 commit 当对照——但只要中间隔了别的改动，它就是**脏对照**，跑出什么都归因不到 X 头上。正确做法：**当前 HEAD + 只回退 X 这一个变量**。

   2026-08-26 Electron 43 的 win32 归因即此：`62c77043^1` 到 `main` 隔着 135 commit / 106 个 UI 文件 / +5800 行，遂改成「当前 main + `package.json` 一行 + lockfile」把 Electron 换回 31.7.7，其余全同。结果两组几何数据**逐位相同**（含浮点尾数 `636.300048828125`），干净判定「非 43 回归」。

   **先查一下要回退的那个 commit 有没有捎带代码改动**——本例 PR #135 顺手把 `getBitmap()` 改成 `toBitmap()`，查 Electron 31.7.7 自己的 `electron.d.ts:9055` 确认 `toBitmap()` 那时就存在，才敢说这个单变量对照跑得通。
5. **每臂开跑前先从构建产物里读出形态自证**（读 `dist-electron/` 而非源码），与期望不符就退出。注意 `tsc` 默认保留注释，注释里提到 `Readable.toWeb(` 会让裸文本匹配误判——**先剥注释**。
6. **排除对照组污染**：修复臂用同一段阳性对照且真实路径 0 命中，即证明对照的异常没漏进统计桶。

**出处**：工具 `scripts/local-protocol-abort-stress.mjs`（阳性对照 + 形态自证 + 时序扫描压测）；PR #126、PR #135；GitHub Actions run 32743160547。相关：[`walkthrough-assertions-need-a-real-signal`](walkthrough-assertions-need-a-real-signal.md)、[`assert-you-are-in-the-situation-you-claim`](assert-you-are-in-the-situation-you-claim.md)、[`err-invalid-state-is-readablestreamfrom`](err-invalid-state-is-readablestreamfrom.md)。
