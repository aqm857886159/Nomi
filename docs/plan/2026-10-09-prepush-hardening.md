# 推送前钩子加固：分发入口 + 手动跑不挂（2026-10-09）

线：F-prepush2　类别：其他（交付流水线脚本，不碰花钱 / 长跑 / 新界面）

## 设计卡（★5 格）

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当协调会话或子 agent 推送 / 手动重跑门岗时，我想让钩子永远跑到「当前树上的最新门岗」、手动跑几十秒内有结果。5 步：改代码 → 提交（commit-msg / pre-commit 钩子）→ 推送（pre-push 钩子）→ 门岗一次跑完 → 红了本机改。不做：不改门岗清单本身、不碰 CI。已知坑：钩子文件住在 .git 里不随分支走；子 agent 的 stdin 是永不关闭的管道。真实任务：(a) 10-09 旧钩子在 #1134 之后静默放行；(b) 手动跑挂 1700 秒。指标：旧钩子放行次数 = 0，手动跑挂死次数 = 0。 | `scripts/git-hook.node-test.mjs`、`scripts/pre-push-contracts.node-test.mjs` |
| ★2 谁说了算 | 「推送前跑哪些脚本」的唯一 owner = `scripts/git-hooks.json`（分发表）+ `scripts/git-hook.mjs`（分发入口）；钩子文件只分发，不再知道脚本名。「PR 正文怎么取」owner 不变：`scripts/lib/prBody.mjs`。一份事实一份。 | `node scripts/door-map.mjs runHook` |
| ★3 一致与复用 | 先查别人：husky / lefthook 都是「钩子文件固定一行，转交配置」；本仓沿用同一模式，没有引入依赖（引入 husky 会同时换掉 commit-msg 等三个已有脚本与 worktree 隔离安装逻辑，收益只有一行分发，不接）。分发入口登记为 boundary-owners（见下）。 | PR 正文「先查别人」 |
| ★4 全状态 | 入口在且脚本在 = 照跑；入口不在（老分支）= 退出 0 + stderr 原因；表里脚本不在 = 跳过该步 + stderr 原因；钩子名不在表里 = 退出 0 + 原因；脚本红 = 退出码原样返回；手动跑无参数 = 不读 stdin；正文取不到 / 指定文件读不了 / gh 超时 = 明确红，不是跳过。 | 测试表 |
| ★9 验收与回滚 | 验收：上面两个 node-test 全绿 + 变异校验（改回旧行为必红）；`node scripts/pre-push-contracts.mjs < /dev/null` 加正文变量全绿。回滚：revert 本 PR，再跑 `pnpm run hooks:reinstall-all`。 | 命令输出贴在 PR 正文 |

## 登记不许删除或改名的方式

选 boundary-owners（根因合同 `shared_boundaries`），不选 self-written：self-written 登记的是「我们自写了什么、为什么」，不管文件存不存在；boundary-owners 每次门岗都核「path + symbol 今天还在不在」，删除或改名当场红。合同：`docs/fixes/2026-10-09-git-hook-pins-script-names.root-cause.json`。

## 一键换钩子

`pnpm run hooks:reinstall-all`（= `node scripts/install-git-hooks.cjs --all-worktrees`）：遍历 `git worktree list`，对每个 worktree 重新生成钩子；只写各自的 hooks 目录，不碰用户资料。
注意：分支里还没有 `scripts/git-hook.mjs` 的 worktree 会被跳过（打印路径，保留旧钩子，pre-commit 敏感扫描不中断），合并 main 后再跑一次。
