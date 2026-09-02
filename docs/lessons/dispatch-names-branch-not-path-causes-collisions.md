# 派任务只给分支名会撞车，必须写死绝对目录

> 📎 教训 · 首次记录 2026-09-01 · 状态：现行
> **触发场景**：写派工 brief 时只想写「在分支 X 上工作」；或自己接到的任务只给了分支名没给目录；或发现刚写完的文件被别人覆盖了。

**结论**：派任务给 agent **必须写死绝对工作目录**，不能只给分支名。开工第一件事是 `git worktree add <新的 sibling 路径> <分支>`，**不许 `cd` 进已经存在的目录**（包括 harness 递过来的那个）。

**为什么会踩**：2026-09-01 M1 round-2 任务栽过。brief 只说「In the Nomi repo, branch `codex/agent-m1-host-lifecycle-r2`」，没给目录。执行体把它解析成 harness 给的 worktree 并在里面 checkout；另一个会话（做 agent-host 那条线 round-3 移植的）也落到同一个目录，**直接往文件里写、没走 worktree 机制**。结果：刚写完并测绿的两个模块被整个覆盖；两个会话各自独立修了同一个 skill DTO bug（`listSkillsForRenderer()` 不发 `contentHash`，`ProjectAgentResidentShell` 却 `.slice()` 它）；词表 baseline 的结构性改动被回退一次。没丢东西只是因为那份内容在另一条分支上已有提交——运气。

关键机制：**git 本来有护栏**——同一分支不能在两个 worktree 同时 checkout，第二个 `git worktree add` 会当场报错。但绕过 worktree 直接往目录里写文件，git 完全看不见（它只管索引和分支，不管谁在动文件）。护栏只在「老实开 worktree」时才有效。

`delivery:preflight` 挡不住这个：它验的是「分支干不干净」，不验「这目录是不是我的」。

**怎么用**：

- 派工 brief 写「在 `<绝对路径>/` 工作」，不写「在 X 分支工作」。
- 接到只给分支名的任务，先 `git worktree add` 到仓库同级的新路径再动手。分支已被别处 checkout 时 git 会报错——那就是信号，去问，别硬挤进那个目录。
- 怀疑有并发写入者：`find src electron -mmin -5` 看谁在写、`lsof -a -p <pid> -d cwd` 查进程 cwd；文件 mtime 比自己的编辑时间新就是撞车了。
- 发现被覆盖：先查内容是不是在别的分支上有提交（`git log --all --diff-filter=A -- <file>`），再决定救不救。

取舍：git 的假设是「一个分支 = 一个工作区 = 一条串行改动线」。想同时推进同一条线，只有「串行等」或「各开分支事后合并」两条路；共用工作区看起来像并行，实际是互相覆盖。

**出处**：2026-09-01 M1 round-2 与 agent-host round-3 的目录撞车。相关：[下否定式结论前先证明你在哪个 checkout](prove-which-checkout-before-negative-claims.md)。
