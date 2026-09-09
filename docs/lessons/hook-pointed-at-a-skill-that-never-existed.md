# hook 指向的技能可以根本不存在，而且没有任何东西会发现

> 📎 教训 · 首次记录 2026-09-07 · 状态：现行
> **触发场景**：「我们明明有规则/流程，为什么还是没照做」；或任何 hook / 文档说「走 XX 技能」的时候。

**结论**：**hook 提示、文档索引、howto 三处都写着某个技能存在，不等于那个文件存在。**
`self-check.sh` 每次命中设计关键词都顶出「这类活走 `nomi-design-flow` 技能」，`docs/README.md` 把它列为真相源，
`nomi-design-flow-howto.md` 开头写「指向 `.claude/skills/nomi-design-flow/SKILL.md`」——
2026-09-07 实查（worktree 和主仓都查了）：**那个文件从来不存在**。

**为什么会踩**：

1. `.claude/*` 整体 gitignore（`.gitignore:36`），只放行 `settings.json`。nomi-* 技能是**本机数据、没有仓内真相源**——
   换机、清理、新 worktree 都会没有，而且**没有任何门岗会发现**。
   对比：hooks 有 `scripts/claude-hooks/` 真相源 + postinstall 安装 + `check:claude-hooks` 同步门岗，所以 hooks 不会丢。
2. 后果比「没有规则」更坏：**hook 说了有技能，技能会自己加载，所以我不会再去翻文档**。
   于是七闸设计流程只在「恰好去读 `docs/design/page-design-process.md`」时才跑。
   **防线指向一个不存在的东西 = 防线是断的**，但在日志里和「防线生效了」长得一模一样（R28）。

**怎么用**：
- 看到 hook / 文档写「走 XX 技能」，**先 `ls` 那个文件**再信它。一条命令：`ls .claude/skills/<name>/SKILL.md`。
- 判断「我们有没有 X 机制」时，**分三层查**：① 文档写了没 ② 执行体在不在 ③ 有没有门岗保证 ②。
  只有 ① 的叫「写过」，不叫「有」。
- 新增任何「由 hook/文档指路的执行体」时，同一 commit 里必须回答：**它的真相源在哪、谁保证它还在**。

**关联**：[[gates-green-does-not-mean-walkthrough-ran]]（同一族：证据看起来在，其实没跑）。
