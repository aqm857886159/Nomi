# 手拼 `file://` 判断「我是不是入口」，Windows 上门岗静默零输出、退出码 0

> 📎 教训 · 首次记录 2026-09-24 · 状态：✅ 已固化（`check:main-guard` 硬零接管，已入 `gates:contracts`）
> **触发场景**：写任何要「被直接运行时才执行 main()」的 .mjs/.ts 脚本；或者在 Windows 上跑某个门岗 / 脚本，它什么都不打印就退出 0。

**结论**：入口判断只写这一种：

```js
import { pathToFileURL } from 'node:url'
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
```

不要把 `process.argv[1]` 手拼成 URL——`` `file://${process.argv[1]}` ``、`new URL(process.argv[1], 'file:')`、`` new URL(`file://${p}`) `` 都会在某个平台上恒为假，而恒为假的后果是**脚本什么都不做、退出码 0**。门岗长这样就等于在那个平台上永远报绿。

**为什么会踩**：

Node 生成 `import.meta.url` 用的是 `pathToFileURL` 那套规则；手拼的 URL 只是「长得像」：

| 写法 | Windows（`C:\…`） | 路径含 `#` `?` `%`（任何平台） |
|---|---|---|
| `` `file://${argv1}` `` | 恒不等（`file://C:\…` vs `file:///C:/…`） | 不等 |
| `new URL(argv1, 'file:')` | 恒不等（盘符 `C:` 被当成协议名） | 不等 |
| `` new URL(`file://${argv1}`) `` | 普通路径碰巧相等 | 不等（`#` 变成片段） |
| `pathToFileURL(argv1).href` | 相等 | 相等 |

2026-09-24 在 Windows 上直接跑，`check:rule-aliases` / `check:real-media-fixture` / `check:supply-chain-pins` / `check:main-console` / `check:generation-entrances` 五个 `gates:contracts` 门岗全部**零字节输出、退出码 0**。主力开发机是 macOS，坏写法在那里恰好能跑，所以它被复制到了 14 处（scripts / tests / docs 三片）。

修好入口之后真跑一遍，`check:supply-chain-pins` 立刻红出第二层 bug：`collectSources()` 用 `path.join` 拼扫描键，Windows 上得到 `electron\shared\…`，与登记表的正斜杠永远对不上，每个已登记文件都被报成「没登记」。**一个从没执行过的门岗，连它自己的 bug 都攒着没人看见。**

**怎么用**：
- 在 Windows 上看到门岗「一行都没打印就过了」，先怀疑入口判断，不要当成通过。
- 修好一个从没真跑过的门岗后，给它塞一个真违规探针确认会红——绿可能是「真没问题」，也可能是「另一个 bug 让它查不到」。
- 符号链接路径（macOS 的 `/var` → `/private/var`）下 `pathToFileURL(argv1)` 仍不等于 `import.meta.url`（后者解过链接）。彻底的写法是 `import.meta.main`（Node ≥ 22.18），等本机 Node 升到 engines 要求的版本再全仓换，退出条件记在根因合同里。

**出处**：`docs/fixes/2026-09-24-windows-main-guard-silent-green.root-cause.json`；门岗 `scripts/check-main-guard.mjs`；同族：[`mac-only-testing-ships-windows-blind.md`](mac-only-testing-ships-windows-blind.md)（只在 Mac 上测）、[`git-path-output-is-quoted-by-default.md`](git-path-output-is-quoted-by-default.md)（门岗静默少扫）、[`gate-scope-pointing-nowhere-passes-silently.md`](gate-scope-pointing-nowhere-passes-silently.md)（门岗静默报绿）。
