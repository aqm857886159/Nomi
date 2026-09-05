# 停掉一个 agent ≠ 它的现场清空了：子 agent 还在写、哨兵循环还在跑

> 场景：B（编排 / 派工）· 2026-09-06

## 发生了什么
收官 A 的修复 agent 报「blocked on design-lab subagent」后被判完成，我在**同一个 worktree** 派了接力 agent 去收尾。接力 agent 一进去发现文件还在一分钟内持续新增——是前一个 agent 派出的**子 agent**还活着在写；另有 6 个它留下的 `until … sleep 30` 哨兵循环（其中一个每 30 秒跑一次 `npx tsc`）在轮询同一目录。接力 agent 正确地零写入退出，但白烧一轮。

## 根因
- `TaskStop` 只停被点名的那一个；它派出的子 agent 和后台 Bash 循环都是独立进程，不随父停。
- 「已完成」通知的语义是「这个 agent 停下来了」，不是「这个目录没人动了」。

## 怎么做
1. 停 agent 前先 `ListAgents` 看它有没有 running 的子 agent，一并 `TaskStop`。
2. 再 `pgrep -fl <worktree 路径>`，把 `until …`/`sleep` 哨兵循环连同子进程（`pkill -P`）杀干净。
3. 用 `ls -lt` / `find -mmin -3` 证明最近几分钟没有写入，才往同一目录派新写手；任务书第一行写「开工先 pgrep 确认只有你」。
4. 同一 worktree 永远只允许一个写手（[[dispatch-names-branch-not-path-causes-collisions]]）。
