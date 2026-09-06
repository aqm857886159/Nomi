# commit 阶段的绕口要**拒绝**，push 阶段才留痕审计

> 📎 教训 · 首次记录 2026-09-06 · 状态：✅ 已固化（由 `scripts/claude-hooks/commit-bypass-check.sh` 接管）
> **触发场景**：你正要写 `git -c core.hooksPath=… commit` / `--no-verify` / `HUSKY=0 git commit`；或你在设计一条新防线，纠结「拦下来」还是「记下来事后审」。

**结论**：**同一种绕过写法，在 commit 阶段和 push 阶段要用不同的处置**——commit 阶段一律 **exit 2 拒绝**，push 阶段留痕 + `check:push-bypass` 审计。判据不是「哪个更严」，而是**拦错的代价**和**放过的代价**各是多少。

## 为什么这两阶段处置相反

|  | commit 阶段 | push 阶段 |
|---|---|---|
| 拦错了，代价多大 | **零**——去掉那几个字符重跑一次，工作树原封不动 | 大——远落后分支要追平 main，本地 push 的 15-88MB diff 会撞 ponytail `ENOBUFS`（见 [stale-branch-merge-use-update-branch](stale-branch-merge-use-update-branch.md)），此时绕口是**合法**动作 |
| 放过了，代价多大 | **不可逆**——`scripts/check-no-secrets.mjs` 扫的是微信聊天记录 / `db_key` / 私有配置，一旦进 git 历史就是永久的，push 到公开 GitHub 后洗不掉 | 可补救——远端分支还能改；而且有 `.claude/push-bypass.log` 一条条记着谁绕的、哪棵树、哪个 SHA |
| 有没有合法场景 | **没有**。没有任何理由需要「先偷偷提交，事后解释」 | 有（上面那条并线） |
| 于是 | **拒绝** | **留痕 + 审计** |

一句话：**有合法场景的地方才配用审计；没有合法场景的地方，审计只是把拦截的责任推给未来的自己**。

`docs/fixes/2026-09-03-push-bypass-audit-trail.root-cause.json` 里写的 “The remedy is auditing, not prohibition” 只对 push 成立——那份合同的 `scope_paths` 也只有 push 两个文件。把它的结论整段搬到 commit 阶段，就是把「因为有合法例外所以只能审计」误读成「绕口这一类都只能审计」。

## 2026-09-06 实测：靠自觉的防线不是防线

同一天，两个子 agent 各自**习惯性**写出 `git -c core.hooksPath=.git/hooks commit …`——等于把版本化 pre-commit 换成了另一个目录，敏感数据扫描和 R25 Ponytail 评审同时静默失效。两次都是自己发现、自己撤回的；**两次都没有任何机器拦过**。

当时的防线为什么全穿了：

- `scripts/claude-hooks/pre-push-check.sh` 的绕口留痕块，前置条件是 `[ -n "$TARGETS" ]`——`TARGETS` 只收 **push** 行，commit 命令一行都不产生，整块不运行；
- `scripts/check-push-bypass.mjs` 审的是 push 记录，没有记录就没有可审的；
- `scripts/claude-hooks/secret-guard.sh` 只看**子命令上的选项**（`commit --no-verify` / `add -f`），而 `-c core.hooksPath=` 是 **git 全局选项**、`HUSKY=0` 是**前置环境赋值**，两者都不在选项列里——它对这两种写法**完全失明**，不是漏判，是看不见。

这正是 **R28**（防线建在最早能拦住的那层）的反面教材：能在 commit 前一秒零代价拦住的事，被留到了 push 之后靠人复核。

## 顺带两个「分列」的坑（同一次开发中各让全部拦截静默失效）

命令理解层 `_bash-command-analysis.sh` 的输出是制表符分列的。消费方用 `while IFS=… read` 拆列时：

- **不能用 TAB 当 IFS**：tab 属于 IFS whitespace，`read` 会折叠连续分隔符、吃掉空字段。于是「选项列为空、配置列有值」的 `git -c core.hooksPath=… cherry-pick` 把**配置读进了选项列**，闸门 exit 0 放行——实测三条用例栽在这上面。
- **也不能用 `\001`**：bash 内部拿它当 CTLESC，`read` 会把它直接**吃掉**而不是拿来分列（`a\001b\001\001c` 读成一个字段 `abc`），一列都不分，**所有**绕口写法全部漏放。

用 `\037`（US，单元分隔符）。两次的观测表现都是「hook 正常退出 0」，和真放行一模一样——只有跑真 hook 看退出码才测得到。

## 顺带挖出的两个「命令 vs 数据」边界洞（比原问题更大，三个闸门一起中招）

给 hook 加规则**必须先验它会红**（R17 同款要求）——照做的过程中，这两个洞是被真实命令绊出来的，不是想出来的：

- **换行不是命令分隔符**。共用理解层只把 `&& || ; |` 当分隔符，于是**多行命令从第二行起整条隐身**：`echo hi\ngit push origin HEAD` 和 `echo hi\ngit commit --no-verify` 在旧版里都解析出**零个** git 调用（对照 `origin/main` 实测确认，不是本次引入的）。而 agent 写多行 bash 是常态——**push 闸门也一样瞎**。修法：词法分析前把引号外的换行换成 `;`，并**关掉 `#` 注释**（否则一个行尾 `#` 会连着把后面所有行一起吞掉）。
- **heredoc 正文被当成命令**。shlex 不懂 heredoc，正文每一行都进命令流；而 `|` 是分隔符，**markdown 表格**正好把表格里的词推回命令位置。实测：本条教训对应的那个 PR，用 `gh pr create --body-file - <<'BODY'` 传正文（正文里正在讲这些绕过写法），被 secret-guard 当成真的 `git commit --no-verify` 拦下了。**会误报的闸门用不了几次就会被人绕过**——这是它自己撞上来的证明。修法：词法分析前整段摘掉 heredoc 正文，标记行本身保留。

共同的形状：**闸门的正确性等于「它对命令语法的理解」的正确性**。凡是「用近似手段理解 shell」的地方，两个方向的错（漏判 / 误伤）都会同时存在，而且都静默。

## 怎么用

- 写任何提交类命令，就用最朴素那条：`git commit -m "…"`。钩子没装（新 worktree）→ `pnpm install`；钩子真的坏了 → **修钩子**，不是绕开它。
- 设计新防线时先填上面那张表的四格（拦错代价 / 放过代价 / 有无合法场景 / 处置）。**四格没填就选了「先记录、事后审」的，多半是在给自己留逃生口**（P1）。
- 给 hook 加规则必须**先验它会红**（R17 同款要求）：`node --test ./scripts/claude-hooks/commit-bypass-check.node-test.mjs`。测判决（exit 2 / exit 0），不测实现细节。
- 反向也要测：**会误报的闸门几次之后就会被人绕过，等于不存在**。提交信息里写 `--no-verify`、`-n`、`core.hooksPath` 都必须照常放行（靠 `--` 与「确定带值的选项」跳过其值来实现）。

**出处**：`scripts/claude-hooks/commit-bypass-check.sh`、`scripts/claude-hooks/commit-bypass-check.node-test.mjs`、`scripts/claude-hooks/_bash-command-analysis.sh`（第 4、5 列 = 全局 `-c` 配置与前置环境赋值）；对照 `docs/fixes/2026-09-03-push-bypass-audit-trail.root-cause.json`。

**相关**：[gate-stamps-must-be-keyed-to-tree-and-head](gate-stamps-must-be-keyed-to-tree-and-head.md)、[stale-branch-merge-use-update-branch](stale-branch-merge-use-update-branch.md)、[dead-selector-lies-both-ways](dead-selector-lies-both-ways.md)
