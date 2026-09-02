# 闸门凭据必须绑定「哪棵树 + 哪个提交」，只认路径和时间的戳会互相顶用

> 📎 教训 · 首次记录 2026-09-02 · 状态：✅ 已固化（`check:claude-hooks` 接管，见下）
> **触发场景**：改任何「跑过某个检查 → 盖个标记 → 后续步骤见标记就放行」的机制；或者发现 push 闸莫名放行/莫名拦人。

**结论**：凭据类标记（gates 戳、缓存命中标记、审批标记）必须把**被验证对象的身份**写进标记本身——这里是 worktree 绝对路径 + 盖戳时的 HEAD sha——而不是靠「文件在某个固定路径上」+「mtime 够新」来隐式代表。并行 worktree 一多，隐式身份必然错配，而且**两个方向都会错**。

**为什么会踩**：旧的 push 闸（`pre-push-check.sh`）读 `$CLAUDE_PROJECT_DIR/.claude/.gates-ok`，判据只有「存在」+「30 分钟内」。这台机器常年 20+ 棵并行 worktree，于是同一天两个方向各栽一次：

- **误放（危险的那个方向）**：在 sibling worktree 里 push，`CLAUDE_PROJECT_DIR` 指向的是**会话**那棵树。主仓里一枚别处盖的旧戳把一个 gates 实际 `exit=1` 的分支放上了远端（当时 PR 未开、CI 兜住，纯属运气）。
- **误杀**：`nomi-brand-mark` 里 gates 连过两轮，仍被会话树那枚过期戳拦了三次。

根因不是路径解析写错，而是**戳的身份维度不足**：它不认树、也不认提交，所以「A 树的戳」和「B 树的戳」在闸门眼里是同一枚；「盖戳时的代码」和「现在要推的代码」也是同一份。补丁式地修路径解析（先按命令里的 `cd` 目标定位）只堵了一半——命令不带 `cd` 时照样退回会话目录。

**怎么用**：
- 设计任何「过了就盖戳」的机制时，先问三句：**这戳是给谁背书的？换一棵树还成立吗？盖完戳对象变了还成立吗？** 答不出来就把答案写进戳的内容里。
- 用 `git rev-parse --absolute-git-dir` 存 per-worktree 状态：git worktree 的 gitdir 天然一树一份（主仓 `.git/`，worktree 是 `.git/worktrees/<name>/`），物理上不可能互相顶用；且在 `.git` 内，不受 `.claude/` 被 gitignore 影响。
- 门岗自身的失效是**静默**的（放行得和正常放行一模一样），所以门岗要有自己的行为测试：`scripts/pre-push-check.node-test.mjs` 在临时 git 仓的真实 worktree 上跑真实 hook，钉住「认树 / 认 HEAD / 认新鲜度」三项，三项缺一都能拦住。`check:claude-hooks` 拦的是「装的和仓里的不一致」，拦不住「仓里那份逻辑本身错了」——两层都要有。
- 老 worktree 记得跑一次 `pnpm install`：hook 由 postinstall 从 `scripts/claude-hooks/` 装进 `.claude/`，没装新的那棵仍在认旧的固定路径戳。

**出处**：`scripts/claude-hooks/pre-push-check.sh`（三项判定）、`scripts/stamp-gates-ok.mjs`（盖戳，`pnpm run gates` 末节）、`scripts/pre-push-check.node-test.mjs`（10 条阳性/阴性用例）。相关：[远落后分支合并走 `gh pr update-branch`](stale-branch-merge-use-update-branch.md)、[下否定式结论前先证明你在哪个 checkout](prove-which-checkout-before-negative-claims.md)。
