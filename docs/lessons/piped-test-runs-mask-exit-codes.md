# 管道跑测试会吞掉退出码

> 📎 教训 · 首次记录 2026-08-25 · 状态：现行
> **触发场景**：你准备说「套件通过了 / gates 过了」，而依据是一条 `... | tail` 的 exit 0，或一条后台任务通知里的 exit code。

**结论**：跑 vitest / gates 时**别把命令直接管道给 `tail`/`grep` 再读退出码**——管道的退出码来自最后一段，`vitest` 自己红没红被整个吞掉。要读退出码就 `set -o pipefail`，或显式取 `${PIPESTATUS[0]}`。声称「套件通过」前，先确认输出里真有 `Test Files N passed` 那行数字，别只看 exit code。

**为什么会踩**：

2026-08-25 查 `electron/productionRun/**` flaky 时当场栽了一次。跑的是：

```bash
npx vitest run --reporter=basic 2>&1 | tail -60
```

拿到 `exit code 0` 就对用户说了「全量套件这次通过」。实际上 **vitest 4 没有 `basic` 这个 reporter**（v3 起被并进 `default`），它启动即抛 `Failed to load url basic`，**一条测试都没跑**；exit 0 是 `tail` 的。

两个坑叠在一起才这么像真的：① 管道吞退出码；② reporter 名写错不是「降级用默认」而是**硬失败**，但错误堆栈埋在几十行 vite 内部帧里，`tail` 一截更像正常输出。

假绿在观测上和真绿一模一样——有输出、有 exit 0、命令看着跑完了。和 [`assert-you-are-in-the-situation-you-claim`](assert-you-are-in-the-situation-you-claim.md) 同病：那条讲「先证明你在你以为的现场」，这条讲「先证明你以为跑了的东西真的跑了」。

**同族第三个坑：哨兵文件读到上一轮的结论（2026-08-25 同日又栽一次）**

为绕开管道吞码，把 gates 后台跑成：

```bash
pnpm run gates > log 2>&1; echo "GATES_EXIT=$?" > exit.txt
```

两个新陷阱叠上来：

- **后台任务的完成通知报的 exit code 是那条复合命令最后一段的**（这里是 `echo`/`tee`），恒为 0。通知说「completed exit code 0」**完全不代表 gates 过了**，必须读 `exit.txt`。
- **重跑前不删 `exit.txt`，就会读到上一轮的值**。第二轮还在 typecheck 时 cat 出上一轮的 `GATES_EXIT=1`，差点当成本轮结论。哨兵文件只在跑完那刻才被覆盖，中途 cat 到的是历史。

**怎么用**：

- 要读退出码就 `set -o pipefail`，或显式取 `${PIPESTATUS[0]}`。
- 后台跑长命令：**先删哨兵文件**，再 `until [ -f exit.txt ]; do sleep 5; done` 等它出现；**别信任务通知里的 exit code**。
- 别自己发明 reporter 名。vitest 4 用 `default` / `verbose` / `dot` / `json` / `junit` / `tap`。想看每条测试耗时用 `--reporter=verbose --slowTestThreshold=1`。
- 声称「套件通过」前，先在输出里找到 `Test Files N passed` 那行数字。

**出处**：2026-08-25 `electron/productionRun/**` flake 排查实录；vitest 4 reporter 清单。相关：[`harness-catch-launders-bugs-into-verdicts`](harness-catch-launders-bugs-into-verdicts.md)、[`assert-you-are-in-the-situation-you-claim`](assert-you-are-in-the-situation-you-claim.md)。
