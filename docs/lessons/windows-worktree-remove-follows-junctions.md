# Windows 上删 worktree 会顺着 junction 把链接目标里的依赖一起删掉

> 📎 教训 · 首次记录 2026-09-24 · 状态：现行
> **触发场景**：在 Windows 上删除一个工作树（`git worktree remove`、归档会话时自动清理、`Remove-Item -Recurse`），而它的 `node_modules`（或任何子目录）是用 `mklink /J` 链接到别处的；或者一大批测试突然在加载阶段报 `Cannot find package 'xxx'`。

**结论**：Windows 上递归删除**不会停在目录 junction 前**，会一路删进链接目标。删任何含 junction 的目录之前，先用 `cmd /c rmdir <链接>` 单独删掉链接本身，再确认已经没有重解析点，最后才删目录。

**为什么会踩**：

- 2026-09-24，为了省空间，一个临时对比用的工作树把 `node_modules` junction 到了任务工作树。随后 `git worktree remove --force` 报「Directory not empty」失败。但在报错之前，它已经顺着 junction 清空了**真正**那份依赖里的包目录（例如 `.pnpm/zod@.../node_modules/zod`）。
- 之后几百个测试文件在加载阶段报 `Cannot find package 'zod'`，看起来像「Windows 测试基线本来就红」，并不像被人删坏了。
- 同一时期，主仓库那份被多个工作树共用的 `node_modules` 也出现了 `.bin` 消失、zod 成空目录的情况。很可能是同一个机制（未逐一核实）。

**怎么用**：

- 删目录前：`cmd /c rmdir <junction>`（只删链接）→ `Get-ChildItem -Recurse -Attributes ReparsePoint` 确认一个都不剩 → 再删目录。
- 工作树里还有 junction 时，不要执行 `git worktree remove`；协调会话归档会话之前也要先查一遍（归档会清理工作树）。
- 根治方向：每个工作树自己装依赖，不再共用、不再链接（D 盘上用 pnpm store 硬链接，装得很快）。已排进 TODO T-QA-34（Windows 工具链块）。
- 测试突然成片报 `Cannot find package` 时，先看那个包目录是不是空的，再去怪平台；修复用 `pnpm install --frozen-lockfile --force`。

**出处**：2026-09-24 本机事故；2026-09-25 主仓 node_modules 损坏的现场。
