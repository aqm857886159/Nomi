# Ponytail 评审闸：自适应超时 + 全机串行锁 + 提交阶段留痕延后

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

- 日期：2026-09-11
- 规则：R25（提交/推送前 Ponytail 评审）、R17（门岗棘轮：加规则先验它会红）、R21（根因合同）、R28（防线建在最早能拦住的那层）
- 根因合同：`docs/fixes/2026-09-11-ponytail-timeout-starvation.root-cause.json`

## 背后的真实摩擦（D1/D6）

2026-09-11 凌晨，六条任务分支的提交在同一晚被 `pre-commit` 的 Ponytail 评审拦了十几次，
拦人的理由永远是同一句：`timed out after 180000ms`。

这台机器上常年挂着 20+ 棵 worktree，同一时刻可能有三四棵在跑 `pnpm run gates`。
`REVIEW_TIMEOUT_MS = 180_000` 是一个**写死的墙钟**：它假设评审进程能拿到一台闲机器。
负载 8 的时候，同一次 Codex 调用要花 3-5 倍的时间；再叠上多个评审互相抢 CPU，
180 秒到点时模型可能连报告都还没开始写。

于是闸门的语义悄悄变了：它本来是「这段改动过不过度工程化」的判断，
实际变成了「你现在这台机器忙不忙」的抽签。**闸门一旦开始拦无辜的人，人就会开始绕过闸门**
（`scripts/check-gates-chain.mjs` 抬头写的就是这条），本晚确实出现了要不要 `-c core.hooksPath` 的讨论。

用户 2026-09-11 03:40 拍板三条，正是对着这三个层次：
① 超时应当随「这次要审多少东西 + 这台机器有多忙」派生，而不是常量；
② 同一时刻只跑一个评审——把互相饿死的根源直接掐掉；
③ runner 真的不可用时，**留一条明路**（留痕延后），而不是逼出绕口。

## 先查别人

- 仓库已有的全机串行锁：`scripts/with-gates-lock.py:1`（抬头注释解释了为什么用 flock 而**不**删锁文件：unlink 会让两个 owner 落在两个 inode 上）、`scripts/with-gates-lock.py:104` 的 `try_lock`/等待循环，以及 `scripts/with-gates-lock.py:75` 的 `inherited_owner` 前台继承判定。本次不新造锁，直接复用它，只补 `--wait-timeout` / `--label` 两个参数。
- 仓库已有的「留痕而非禁止」账本：`scripts/check-push-bypass.mjs:1`（设计理由）、`scripts/check-push-bypass.mjs:30` 的日志行格式、`scripts/check-push-bypass.mjs:52` 的 `--accept <sha>` 机制，以及写入方 `scripts/claude-hooks/pre-push-check.sh:86`。延后账本逐字对齐这套格式与命令，不另发明一套。
- 仓库已有的「提交阶段拒绝、推送阶段留痕」分界：`scripts/claude-hooks/commit-bypass-check.sh:3` 明确写了为什么 commit 阶段是拒绝——跳过 pre-commit = 敏感数据永久进历史。本次**不放宽**它：留痕延后只走 `PONYTAIL_REVIEW_DEFER=1` 这一条明路，`-c core.hooksPath=` 照旧拒绝。
- 生态做法（串行）：pre-commit 框架自 v1.13.0 起默认并行跑同一 hook 的文件分片，对「会读写共享文件、会有竞态」的 hook 提供 `require_serial: true` 退回串行——即「共享资源的 hook 必须串行」是被验证过的公开做法，见 <https://github.com/pre-commit/pre-commit/issues/3317> 与 <https://github.com/pre-commit/pre-commit-hooks/issues/656>。
- 生态做法（串行/顺序）：lefthook 用 `parallel: true` / `piped: true` 显式区分并行与串行链，默认不并行，见 <https://github.com/evilmartians/lefthook/issues/66>。我们的评审是「独占一台机器的模型调用」，属于典型的 require_serial 场景。
- 生态做法（超时）：Git 自身不给 hook 任何超时语义（hook 挂住 = git 挂住），所以超时必须由适配器自己实现；公开的 hook 适配器普遍把它做成可配置而非常量。我们的偏差是把它**派生**（diff 大小 + 负载）而不是让人配——理由是这台机器上真正的变量就是这两个，让人配等于让人猜。

## 三条改动

### ① 自适应超时（`scripts/ponytail-review-hook.mjs`）

常量与公式住一处，导出后供单测直接喂：

```
steps    = floor(diffBytes / 50_000)
raw      = 180_000ms + steps × 60_000ms
scaled   = load1min > 4 ? raw × 1.5 : raw
timeout  = min(600_000ms, round(scaled))
```

- `diffBytes` = 送审 diff 的 UTF-8 字节数（评审真正要读的量，不是 git I/O 量）。
- `load1min` = `os.loadavg()[0]`（原始 1 分钟负载，不按核数归一化——这台机器上要防的就是「20 棵 worktree 一起跑」的绝对拥挤度）。
- 上限 600s：再长就不是超时问题而是 runner 坏了，该走延后账本而不是继续等。

### ② 全机串行锁（`/tmp/nomi-ponytail.lock`）

复用 `scripts/with-gates-lock.py` 的 flock 模式，新增两个参数：

- `--wait-timeout <秒>`：等锁上限；到点返回 75（`EX_TEMPFAIL`），hook fail-closed。
- `--label <文本>`：排队提示里说清等的是哪把锁。

`ponytail-review-hook.mjs` 在**决定要真跑评审之后**把自己在锁下重跑一次
（`NOMI_PONYTAIL_LOCK_HELD=1` 防止递归），因此：

- **排队等锁的时间不计入评审超时**：外层进程只负责等锁（上限 15 分钟），
  内层进程拿到锁后才开始计 `REVIEW_TIMEOUT`。这是「重跑一次自己」而不是「用 wrapper 包住 codex」的唯一理由——
  包住 codex 的话，`spawnSync` 的 timeout 会同时盖住排队时间。
- 顺序是先判延后、再等锁：`PONYTAIL_REVIEW_DEFER=1` 时不该先排 15 分钟队再宣布跳过。

### ③ 提交阶段的留痕延后

`PONYTAIL_REVIEW_DEFER=1` 且 scope 为 `staged` 时：

- 版本化 `pre-commit` 仍然先跑敏感数据扫描（`scripts/check-no-secrets.mjs`）——顺序不变，被扫描拦下的提交不会走到这里。
- 评审记成一行「延后」，写进 `.claude/ponytail-deferred.log`，格式对齐 `push-bypass.log`：

  ```
  <ISO时间>|deferred|branch=<分支>|sha=<提交前 HEAD>|worktree=<路径>|reason=<理由>|reviewed=no
  ```

- 提交放行（exit 0）。
- `pnpm run check:ponytail-review` 读该账本：有 `reviewed=no` 的行即红；
  `node scripts/check-ponytail-deferred.mjs --accept <sha>` 或补跑 `@ponytail-review` 后标 `reviewed=yes`。
- `push` scope 不接受延后：outgoing diff 是最后一道本地闸，不许延后。

**不放宽的那条**：`scripts/claude-hooks/commit-bypass-check.sh` 照旧拒绝 `-c core.hooksPath=` 等一切绕口写法。
留痕只有 `PONYTAIL_REVIEW_DEFER=1` 这一条明路——它保留敏感数据扫描、保留账本、保留门岗红灯，
而绕口写法三样全丢。

## 不动项

- 评审的只读/临时/报告-only 合同（`--sandbox read-only`、`--output-last-message`、结果分类）一字不改。
- diff 采集范围、1.5MB 上限、32 条 ref-update 上限不变。
- `check:push-bypass` 与 push 阶段的留痕机制不变。
- 生成的 git hook 文本形状不变（锁在 Node 侧自持，不写进 hook 模板）。

## 回滚

三条互相独立，可单独 revert：
① 超时公式 → 把 `resolveReviewTimeoutMs` 的返回改回 `REVIEW_TIMEOUT_BASE_MS`；
② 锁 → 删掉 `runUnderPonytailLock` 调用（with-gates-lock.py 的两个新参数是纯附加，可留）；
③ 延后 → 删 `scripts/check-ponytail-deferred.mjs` 并把 `check:ponytail-review` 改回只跑单测。

## 验收门

- 新增单测先红后绿（R17）：超时公式各档、锁互斥（两个进程真抢 `/tmp` 锁）、延后账本读写与门岗红/绿。
- `check:ponytail-review`、`check:claude-hooks`、`check:hook-behavior`、`check:agents-sync`、`check:push-bypass` 全绿。
- `pnpm run gates` 全绿。
- 本分支自己的提交必须过现役钩子（不绕）。
