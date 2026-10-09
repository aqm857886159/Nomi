# Windows 上跑 agent 与门岗的一组已踩过的坑

> 📎 教训 · 首次记录 2026-09-24（持续补充） · 状态：现行
> **触发场景**：Windows 上本地门岗 / 提交钩子 / 脚本写文件出现莫名其妙的红、零输出、乱码、命令找不到。

**结论**（每条独立，别当成一个问题去修）：
1. **门岗里的路径**：`path.relative()` 在 Windows 给反斜杠，白名单 / 基线键是正斜杠 → 恒不命中，用 `.split(path.sep).join("/")`；`new URL(".", import.meta.url).pathname` 给 `/C:/…` 会拼出翻倍盘符，用 `fileURLToPath`；手拼 `file://` 用 `pathToFileURL(p).href`。TS 编译器 API 的 `fileName` 任何平台都是正斜杠，不能与 `path.join` 结果直接比。基线更新脚本会把反斜杠键写进基线 JSON 污染 macOS / CI。**一个门岗一行不打印就过了 → 先怀疑入口判断，不是通过**（见 [main-guard 教训](main-guard-hand-built-file-url-is-silent-on-windows.md)）。
2. **残留 CRLF**：工作树在换行规范生效前检出时，blob 是 LF 而工作区文件是 CRLF，`check:agents-sync` 报“少 N 行多 N 行”而 `git status` 干净。修法是重新检出该文件，不是跑 `gen:agents`（那只会把 CRLF 写进生成物让门岗变绿）。
3. **Python / PowerShell 写文件**：Python `open(p,"w")` 默认把 `\n` 写成 `\r\n`，要 `newline=""`；PowerShell 5.1 的 `Set-Content` / `>` 默认写 GBK 或带 BOM，开头带 BOM 的 `.mjs` 在 Linux 上 node 解析即崩（`#!` 前多三个字节）。推送前扫：对改动文件 `head -c3` 查 `ef bb bf`；Windows 本机的 mjs-parse 往往在干净 main 上就红，看不出来。
4. **应用商店的 python3 别名**：`python3` 是 WindowsApps 下的商店别名，一旦 stdin 是管道就退出 49 零输出，会让依赖 `python3` 做词法分析的提交 / 推送钩子恒判“无法解析”而 fail-closed，连放行的纯文档推送也拦。钩子应探测可用解释器并回落 `python`；临时办法是在 PATH 前放一个转调 `python` 的 `python3.cmd`。
5. **推送闸门按字面找推送动词**：命令文字里任何地方出现（包括 heredoc 里内联脚本的 `.push(` 调用）都会被拦。把脚本先写成文件再执行。
6. **worktree 里没有依赖**：报 `tsx 不是内部或外部命令` = 没装依赖，在该 worktree 里直接 `pnpm install --frozen-lockfile`（走全局 store，约 1.5 分钟）；用 junction 借别处依赖时，删之前必须先拆链接（见 [junction 教训](windows-worktree-remove-follows-junctions.md)），并先确认被借的依赖目录非空。
7. **对照干净 main 要比判词，不能只比退出码**：很多门岗是 `node --test <自测> && node <主脚本>`，Windows 上自测先挂，`&&` 后的主扫描根本没跑，本分支新增违规被遮住，两边都 exit 1 看着一样，推上去 Linux CI 才红。对这类门岗单独跑主脚本看判词行。本机能跑的门岗名以 `package.json` 为准，随手猜的名字报 exit 1 其实是“没有这个脚本”。
8. **全量测试对照**：看 delta 要把失败文件单独重跑，再与干净 main 的同批失败比；main 前进很快，Ponytail 一类按树校验的收据放在最后一次合 main 之后再跑。
9. **Windows 测试基线不是全绿**：有少量测试依赖 POSIX（`mkfifo`、`/bin/sh`、macOS 剪贴板字节格式）或只认已验证平台，判断有没有回归是跟干净 main 的基线比，不是跟全绿比。

**出处**：2026-08 至 2026-09 多次本机门岗事故（PR #866 / #870 / #874 / #876 等）；相关：[管道跑测试吞退出码](piped-test-runs-mask-exit-codes.md)。
