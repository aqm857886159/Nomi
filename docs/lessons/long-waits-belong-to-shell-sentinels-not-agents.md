# 长等待交给 shell 哨兵，别交给子 agent

> 📎 教训 · 首次记录 2026-09-03 · 状态：现行
> **触发场景**：要派活但前置条件还没就绪（机器负载高、CI 在跑、别的班占着资源），你正想在任务书里写「等窗口开了再跑」。

**结论**：**「等一个条件成立」这件事本身不要交给子 agent**——不管哪个模型，它都会发明一种错误的等法然后交卷。把等待写成 `nohup` 后台 shell 循环，条件满足时自己执行，结果落哨兵文件；编排者只读哨兵。

## 三种实测过的死法（同一天，同一个战役）

| 执行体 | 它怎么"等" | 结果 |
|---|---|---|
| sonnet 子 agent | 起了个 Monitor 说「等它报 READY 后立即运行」，然后**结束回合** | 一次性 agent 交卷即终局，通知无人接收，走查永远没跑 |
| Codex 班 | 老实 `sleep 60; uptime` 轮询等低负载 | 等到会话限时结束，**期间零 commit**——所有工作悬在工作区，靠编排者手动落盘才没丢 |
| （历史）合并列车 | `gh pr checks --watch` | CI 有 check 永久 pending 时不返回，静默挂死 1 小时 |

三种都写在任务书里明令禁止过，还是复发——**说明这不是纪律问题，是模型的心智模型问题**：子 agent 的世界里「最终文本 = 报告 = 终局」，它没有"挂起再唤醒"的能力，所以一遇到长等待就会即兴发明。

## 正确写法

编排者自己挂后台哨兵，agent 只负责「条件已就绪之后的那段活」：

```bash
rm -f /tmp/<name>-<worktree>.exit /tmp/<name>-<worktree>.log
nohup bash -c '
for i in $(seq 1 90); do
  BENCH=$(pgrep -f canvas-performance-benchmark | wc -l | tr -d " ")
  LOAD=$(uptime | sed "s/.*load averages*: *//" | awk "{print \$1}")
  if [ "$BENCH" = "0" ] && awk -v l="$LOAD" "BEGIN{exit !(l < 15)}"; then
    cd <worktree> && node tests/ux/<walkthrough>.walk.mjs > /tmp/<name>.log 2>&1
    echo $? > /tmp/<name>.exit; exit 0
  fi
  sleep 60
done
echo 99 > /tmp/<name>.exit   # 99 = 窗口始终没开，别把它当成功
' > /dev/null 2>&1 &
```

要点：
- **超时哨兵值要能和成功/失败区分开**（这里用 99），否则「没等到」会被读成「跑过了」。
- 哨兵/日志文件名**带 worktree 后缀**——并行会话会串写同名 `/tmp` 文件（见 [`tmp-log-paths-collide-across-parallel-sessions.md`](tmp-log-paths-collide-across-parallel-sessions.md)）。
- 若非要让 agent 自己等：任务书必须写死「**每完成一个单元立即 commit**，等窗口期间不许空转不 commit」——Codex 那次就是零 commit 死在等待里。

## 配套事实：CI 不会替你跑新入库的走查

同一轮里验证过：把新走查脚本入库后，CI 的 E2E 走查腿**不会自动执行它**——`check:walkthroughs` 只做静态扫描（见 [`gates-green-does-not-mean-walkthrough-ran.md`](gates-green-does-not-mean-walkthrough-ran.md)）。所以「入库了就等 CI 帮我验」是错的，新走查**必须本地真机跑过一次**才算数；跑不了就把欠账明标出来（PR 评论 + 记忆），别让「已入库」听起来像「已验证」。
