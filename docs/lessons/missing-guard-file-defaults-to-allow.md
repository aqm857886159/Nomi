# 防线文件缺失 = 静默放行：闸门要么由「一定在场的那层」执行，要么自己声明缺失

> 📎 教训 · 首次记录 2026-09-07 · 状态：✅ 已固化（`check:claude-hooks` 结构面 + `check:hook-behavior` 行为面）
> **触发场景**：新写/新挂一道闸门时；主会话或子 agent 在一棵**落后 main** 的 worktree 里开工时；发现「某个 hook 明明登记了却没拦住」时。

**结论**：任何闸门的执行体如果住在一个**可能不存在的文件**里，就必须由「一定在场的那一层」先判它在不在，缺失时**明确**退出——拦截型 `exit 2`（Claude Code 唯一认得的阻断码），提示型 `exit 1` 且 stderr 有话。**可以 fail-open，不可以 fail-silent。** 另外：主会话/子 agent 开工前先把分支并上最新 `origin/main`——本仓的闸门自 2026-09-06 起随 checkout 生效，落后的分支上闸门会连人带文件一起消失。

**为什么会踩**：2026-09-07 实测到的现场是——一棵落后 main 的 worktree，`.claude/settings.json` 里好端端登记着

```
bash "$CLAUDE_PROJECT_DIR/scripts/claude-hooks/commit-bypass-check.sh"
```

而那棵树上**根本没有这个文件**（它是 `a436d63ec` 才进 main 的）。于是：

1. bash 报 `No such file or directory`，退出码 **127**；
2. Claude Code 的 PreToolUse 只把 **exit 2** 当阻断，其余非零码一律归为「hook 自己出错，继续」；
3. 子 agent 一条 `git -c core.hooksPath=… commit` 畅通无阻——**闸门在登记表里活着，在现实里不存在，全程没有一个字的红**。

真正的类不是「那个文件忘了带过来」，而是**防线依赖一个可能不存在的文件，缺失时默认放行**（R28：登记是备忘录不是防线）。这一族在本仓已经换过好几茬成因，每次都只修成因、没修「缺失即放行」：

| 缺失的成因 | 当时怎么修的 | 「缺失=放行」修了吗 |
|---|---|---|
| `.claude/hooks/` 靠 postinstall 装，没跑 `pnpm install` 的 worktree 是裸的 | `b60f708b4` 改成 `.claude/settings.json` 进 git、直指仓内 `scripts/claude-hooks/*.sh` | ❌ |
| 改完之后路径跟着分支走，落后的分支上脚本不存在 | ——（就是本条） | ✅ `2026-09-07` |

注意第二行是第一行的**代价**：把「装了才有」换成「checkout 就有」是对的，但它同时把缺失的成因从「没装依赖」换成了「分支停在旧提交」，而后者在这台 20+ worktree 的机器上更常见。

**为什么守卫是 settings 里的一行 `sh -c`，不是抽一个 `_guard.sh` 统一分发**：分发器**自己就是一个可能不存在的文件**——`bash _guard.sh` 在它缺失时同样 127、同样放行，等于把这个 bug 原样搬了个家。守卫必须由一定在场的那一层执行；hook 这条链上唯一一定在场的是 harness 起的那个 shell。所以判存在这件事只能写在命令串里。

**为什么分型是「拦截型 fail-closed / 提示型 fail-open」**（代价不对称，同 `a436d63ec` 的 commit-vs-push 论证）：

- 拦截型（`pre-push-check.sh` / `commit-bypass-check.sh` / `secret-guard.sh`）拦错的代价是零（并一下 main 重跑），放过的代价不可逆（敏感数据永久进历史、没过五门的推送上远端）→ 缺失即 `exit 2`。
- 提示型（`self-check` / `handoff-*` / Write|Edit 的两条 R5 提醒，以及 Stop 的 `completion-check.sh`——它的拒绝走 stdout 的 `decision: block` 而不是 exit 2）反过来：在 Stop 上 fail-closed 会把会话锁进「想修都停不下来」的死循环，而漏一条提醒是可恢复、用户当场看得见的 → 缺失即 `exit 1` + stderr。

**怎么用**：
- 新挂一道 hook：不要手写命令串，跑 `node -e "console.log(require('./scripts/claude-hooks-registry.cjs').guardedCommand('scripts/claude-hooks/x.sh','blocking'))"` 拿规范串；`pnpm run check:claude-hooks` 会把期望串直接抄给你。
- 拦截型 / 提示型**不另立名单**：由脚本正文自己推（有没有把 `exit 2` 当拒绝通道），加一道闸门不用再记得去哪登记一次分型。
- 判某道闸门「到底有没有在拦」时，别读 settings 也别读脚本——把脚本挪走、喂一条真实 PreToolUse 载荷、看退出码。`check:hook-behavior` 的 `settings-guard` 轴就是这么验的；结构对了行为不对是本仓的常见假绿。
- 主会话开工先并 main。落后的分支上「闸门在登记表里、脚本不在树上」不是异常而是常态，守卫会当场喊出来（`[nomi-hooks] 拦截型 hook 缺失…先并上 origin/main`），照做即可。

**出处**：2026-09-07 实测（落后 worktree + 子 agent `git -c core.hooksPath=` 提交未被拦）；修复见 `scripts/claude-hooks-registry.cjs`（`hookKind` / `guardedCommand` / `validateRegistration`）、`scripts/check-hook-behavior.mjs` 的 `settings-guard` 轴、`docs/fixes/2026-09-07-hook-file-missing-defaults-to-allow.root-cause.json`；前情提要 `a436d63ec`、`b60f708b4` 与 [`commit-bypass-must-be-blocked-not-audited.md`](commit-bypass-must-be-blocked-not-audited.md)。
