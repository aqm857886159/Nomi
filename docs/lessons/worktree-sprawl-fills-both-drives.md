# worktree 不清理会撑满两个盘

> 📎 教训 · 首次记录 2026-10-06 · 状态：现行
> **触发场景**：开新 worktree 前；盘剩余空间突然很少；出现 ENOSPC。

**结论**：合并并拿到收据的线，其 worktree（含只读验收 worktree）立刻进“待清理”清单；同时活着的约 10 个；新建放在与包管理 store 同一个盘（才能硬链接，否则依赖整份复制）；出现 ENOSPC 先查盘空间，别当成代码问题。

**为什么会踩**：2026-10-06 共有 65 个 worktree，一个盘只剩 0.2GB、另一个 9GB，新线因为盘满只能建在系统盘。每个 worktree 都有自己的依赖（Electron 本体约 300MB 解压后不共享）、构建与打包产物、截图和性能 JSON，合入后没人删。

**怎么用**：
- 攒到 5 个以上或任一盘剩余 < 20GB，就生成清理脚本交用户双击跑（删除类动作交用户；协调会话的沙箱 / 工具往往也被拦）。脚本要做到“双击一次全清完”。
- 清理脚本写法：**纯 ASCII + CRLF 换行**（含中文会被 cmd 按 GBK 读乱，LF 换行会报“找不到批处理标签”）；含 junction 的目录先拆链接再删（见 [junction 教训](windows-worktree-remove-follows-junctions.md)）；生成后先做一遍把 rmdir / robocopy 换成 echo 的空跑；正在跑的 .cmd 不能改（cmd 按偏移逐行读），要修就另存新文件名。
- 只读分析 / 对照 worktree 用完即进清单；对照 worktree 别放在路径很长的目录（依赖补丁会报 ENAMETOOLONG）。
- 自动回收见 `docs/engineering/agent-worktree-lifecycle.md`。

**出处**：2026-10-06 两盘告急事故。
