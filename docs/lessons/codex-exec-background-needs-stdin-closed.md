# `codex exec` 后台派工要关 stdin

> 📎 教训 · 首次记录 2026-09-02 · 状态：现行
> **触发场景**：用 `run_in_background` 派了一个 `codex exec` 班，过了很久零产出、克隆目录里一个 commit 都没有；或者你在盘算「让某个后台工人跨会话一直跑着」。

**结论**：任何非交互的后台 `codex exec` 调用**一律带 `</dev/null`**：

```bash
codex exec --cd <clone 目录> --sandbox danger-full-access "<中文任务书>" </dev/null
```

少了它，进程会打印 `Reading additional input from stdin...` 然后**永久挂起**，一行活都不干。派完 1-2 分钟后 tail 一眼 run 日志，看到这行就知道挂了，别干等。

**为什么会踩**：

`codex exec` 的 stdin 语义（`codex exec --help` 写着）是：**stdin 如果是管道，就把管道内容当作追加的 `<stdin>` 提示块读进来，一直读到 EOF**。这个设计本身是给 `cat brief.md | codex exec` 这种用法的。

而 `run_in_background` 起的 Bash 任务，stdin 恰好是一个**永不关闭的管道**——没有人往里写，也没有人关它，于是 EOF 永远不来，`codex exec` 就在读 stdin 这一步停住，任务书压根没开始执行。

阴险的地方在于它**看起来是活的**：进程在、日志有输出、后台任务状态是 running。2026-09-02 分镜表双池派工时白等了 51 分钟，直到会话结束才发现克隆里零产出。

**同一次踩到的第二条：会话内后台工人全部随 App 关闭而死**

Agent tool 起的后台任务、`run_in_background` 的 Bash、自己写的看门狗循环——**没有一个能活过 App 关闭**。

对抗手段不是想办法让进程不死（那条路走不通），而是**把现场外化到盘上**，让接力足够便宜：

- **里程碑 commit** —— 每完成一个工作单元就 commit，分支就是现场；
- **心跳文件** —— 让工人定期写一行时间戳，恢复后一眼看出它死在哪一步；
- **报告文件** —— 阶段结论落文件，不要只存在最终回复里（最终回复会跟着进程一起没）。

恢复会话后第一件事就是读这三样，判断死在哪一步、从哪接。

真需要跨会话存活的进程，用 `nohup <cmd> & disown` —— 代价是**放弃完成通知**，得靠轮询或哨兵文件补上（哨兵文件的坑见下方相关条目）。

**怎么用**：

- 后台 `codex exec` 命令行末尾检查有没有 `</dev/null`，没有就是待挂起状态。
- 派完 1-2 分钟 tail 一眼日志找 `Reading additional input`，早发现早重派。
- 派长班之前先想清楚「它死了我从哪接」——答不上来就先补里程碑 commit / 心跳 / 报告三件套。
- 别指望会话内后台工人跨会话存活；要跨会话就 `nohup … & disown` 并自己补轮询。

**出处**：2026-09-02 分镜表 v5 双池派工实测（白等 51 分钟）；`codex exec --help` 的 stdin 说明。相关：[`piped-test-runs-mask-exit-codes`](piped-test-runs-mask-exit-codes.md)（哨兵文件与假退出码）、编排纪律主文档 [`../engineering/agent-orchestration-playbook.md`](../engineering/agent-orchestration-playbook.md) §4（等待语义）、§8（Codex 执行体专项）。
