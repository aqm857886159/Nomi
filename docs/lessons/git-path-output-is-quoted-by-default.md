# 门岗读 git 的文件列表，默认拿到的是转义过的路径（中文名一律「不像 docs/」）

> 📎 教训 · 首次记录 2026-09-07 · 状态：✅ 已固化（`check:git-path-quoting` 硬零 + `check:hook-behavior` 轴 C 接管）
> **触发场景**：写/改任何按 `git diff --name-only`、`git ls-files` 取文件列表的门岗、hook 或脚本；或者遇到「纯文档改动却被要求过五门 / 门岗说扫了 N 个文件但某些文件明显没被查到」。

**结论**：从 git 读路径列表**一律加 `-z` 按 NUL 切**（JS 走 `scripts/lib/gitPaths.mjs` 的 `gitPaths()` / `gitNameStatus()`，shell 直接 `git diff -z --name-only … | while IFS= read -r -d ''`）。git 默认 `core.quotePath=true`：只要路径里有一个非 ASCII 字节，输出就变成 `"docs/\344\270\255\346\226\207.md"`——**首尾各裹一个引号、中间八进制转义**。本仓 `docs/` 下中文文件名是常态，所以这条默认在这里必然发作。

**为什么会踩**：

`scripts/claude-hooks/pre-push-check.sh` 的 `is_docs_only()` 按行读 `git diff --name-only`，再拿 `^docs/` 和 `\.md$` 量。中文文件名进来时：开头那个 `"` 挡掉 `^docs/`，结尾那个 `"` 挡掉 `\.md$`，两头都不匹配 → 判成「有代码改动」→ **纯文档的 push 白等一遍五门**。方向上是多跑门岗不是绕过，所以本地一路绿、CI 一路绿，只有人在等。实测（worktree off `origin/main`，`git add docs/中文附件说明.md`）：

```
$ git diff --cached --name-only
"docs/tmp-quotepath-repro/\344\270\255\346\226\207\351\231\204\344\273\266\350\257\264\346\230\216.md"
$ git -c core.quotePath=false diff --cached --name-only
docs/tmp-quotepath-repro/中文附件说明.md
```

真正的坑不是那条正则，是**「解码 git 的路径输出」这一步在本仓没有 owner**：14 个门岗各写各的 `--name-only` / `ls-files` + 按行 split。而且这一族**两半的症状完全不同**：

- **分类型**（列完就按前缀/后缀判）：判反。像 push 闸这样多跑一遍，或者反过来漏跑。看得见。
- **读文件型**（列完再 `existsSync` / `readFileSync` / `git show`）：转义后的路径根本不存在 → 多数调用点把读失败 `try/catch` 吞掉 → 门岗**静默少扫几个文件**，不报错也不报红。`check:secrets` 就是这一半里最贵的：一个中文名的 staged 文件被跳过，等于敏感数据从那个文件溜进公开仓库，而门岗打勾。

**怎么用**：
- 新写门岗要文件列表 → `import { gitPaths } from './lib/gitPaths.mjs'`，别自己拼 `execSync("git ls-files …")`。`check:git-path-quoting` 会拦，硬零无基线。
- shell 侧：`-z` + `while IFS= read -r -d ''`，并且用 `< <(git …)` 喂 stdin（别用 `$( )` 传字符串——`$( )` 会把 NUL 吃掉）。
- 确实要验「git 默认会转义」这件事本身 → 行内写 `git-path-quoting:intentional-default` 标记（目前全仓只有 `scripts/lib/gitPaths.node-test.mjs` 一处）。
- `git status --porcelain` 同样会转义，但现存调用点只判「空不空」，引号不改变空不空——**故意**不在门岗管辖内。哪天有人拿 porcelain 去分类路径，这条就适用了。
- 判断某个门岗「有没有真的扫到那个文件」，别看它报的数字，直接塞一个中文名的探针文件进去看它红不红。

**出处**：论文雷达工人报到 → 实测复现 → `scripts/lib/gitPaths.mjs`（共享出口）、`scripts/check-git-path-quoting.mjs`（写法门岗）、`scripts/check-hook-behavior.mjs` 轴 C `docs-only`（行为门岗，实跑真 hook 打真中文路径）、根因合同 `docs/fixes/2026-09-07-git-path-output-read-with-default-quotepath.root-cause.json`。
