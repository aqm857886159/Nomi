# 教训库 — 本仓踩过的坑，一条一个文件

> **这是什么**：Nomi 开发过程中真实踩过、并且**换个人换台机器还会再踩**的坑。每条是一次事故的疤：结论、当时为什么会踩、下次怎么避。
>
> **谁读**：接手本仓任何工作的人或执行体（Claude / Codex / 协作者）。动手前不必通读——**按触发场景查**：写走查查 A 区、判测试红绿查 B 区、动分支/合并查 C 区、排查线上/平台故障查 D 区、做产品判断查 E 区。
>
> **和 `CLAUDE.md` 的分工**：`CLAUDE.md` 是**永远相关**的原则（P1–P5 / D1–D6 / R1–R27），必须每轮加载；本目录是**触发才查**的具体坑，可以有很多条、可以过期作废。原则升进 CLAUDE.md，细节留这里。规则详解在 [`../engineering-rules.md`](../engineering-rules.md)，编排纪律在 [`../engineering/agent-orchestration-playbook.md`](../engineering/agent-orchestration-playbook.md)。

## 维护纪律

- **真相源在这里**（2026-09-02 用户拍板）。本机 `.claude` 记忆里对应的文件已缩成一行指针，改教训**只改本目录**，不要在别处重写一份——本仓已因「两份手工维护」漂过 10 天（`CLAUDE.md` / `AGENTS.md` 双双取名 R17）。
- **一条一个文件**，文件名 = kebab-case 结论式短句（`expect-absent-passes-too-early`），不带日期前缀——日期写在文件头，文件名要能被 grep 到。
- **新增一条就在本索引挂一行**（格式：`- [标题](<slug>.md) — 触发场景钩子`，写成真链接）。索引是入口，孤儿文件等于不存在。
- **过期了就标，不要静默留着**：结论被推翻 → 头部状态改 `⛔ 已反转`，正文保留「当初为什么误判」（误判过程本身是教训）；已被门岗/代码结构消化 → 标 `✅ 已固化`，写清由哪个门岗接管。**删除只在这条彻底不再可能发生时**。
- **不进本目录的三类**：① 战况快照 / 路线图（几天就过期，属 `docs/plan` 或 `docs/DELIVERY-LEDGER.md`）；② 本机环境与个人账号偏好（属本机记忆）；③ 当前架构事实（属 [`../ARCHITECTURE-NOW.md`](../ARCHITECTURE-NOW.md)）。

## 文件格式

```markdown
# <一句话结论式标题>

> 📎 教训 · 首次记录 <YYYY-MM-DD> · 状态：现行 / ✅ 已固化 / ⛔ 已反转
> **触发场景**：<读到什么信号时该翻这条>

**结论**：<一两句，可直接照做>

**为什么会踩**：<机制与根因，带 file:line / 命令 / PR 号等硬证据>

**怎么用**：
- <可执行的检查动作，不是态度呼吁>

**出处**：<PR / commit / 实测命令 / 文档链接>
```

---

## A. 走查与体验验证（Playwright / Electron 真机）

- [走查断言必须有真信号](walkthrough-assertions-need-a-real-signal.md) — 写/改走查前必读：用 `tests/ux/_assert.mjs`，假绿是框架缺陷不是手滑
- [expectAbsent 会通过得太早](expect-absent-passes-too-early.md) — 「元素不存在」断言在计数本来就是 0 时首次采样即过
- [gates 全绿 ≠ 走查真的跑过](gates-green-does-not-mean-walkthrough-ran.md) — `check:walkthroughs` 是静态检查；旧截图不会自动失效
- [设计实验室基线全绿 ≠ 那套组件能接线](design-lab-baselines-green-does-not-mean-wirable.md) — 接手「已落基线、只差接线」的组件前先查两条：有没有回调 props、`src/` 里有没有非 devlab 的 importer；顺带附「换 UI 先数 DOM 测试锚点」的量法
- [修过期走查先打探针，别读源码猜选择器](walkthrough-repair-probe-first.md) — 附画布 composer 已验证锚点与三个坑
- [走查里别用 `win.reload()`](walkthrough-no-win-reload.md) — 原地刷新后活动项目恒 null，面板静默空掉，像极了真 bug
- [走查默认跑隔离 profile，不是真实资料库](walkthrough-default-profile-is-isolated.md) — 要写真库得 `isolate:false`
- [隔离实例的 key/设置组装三坑](iso-walkthrough-key-seeding-traps.md) — `hasApiKey=false` 不证解密失败；别手拷设置文件
- [断言计算色：别比字面串、翻主题先等 transition](walkthrough-computed-color-asserts.md) — oklch 序列化 + 插值帧两坑
- [一个死选择器同时造假红和假绿](dead-selector-lies-both-ways.md) — 找到一处失效锚点就 grep 它的全部用法
- [按「位置」认对象的锚点，多一个兄弟就变成掷硬币](positional-anchor-breaks-when-a-sibling-appears.md) — `.first()` 不会报错，只会安静指错；失败顶着下游的名字出现，加超时永远修不好
- [GitHub Windows runner 把窗口夹到下限](gh-windows-runner-clamps-window-to-minimum.md) — 「只有 Windows 红」的头号原因，先反推 stage 尺寸
- [功能落地后要做体验测试并记情绪摩擦日志](experiential-qa-emotion-log.md) — 截图审查要问「舒服吗」，不只问「在不在」
- [断言前先证明你在你以为的现场](assert-you-are-in-the-situation-you-claim.md) — 注入的 meta 会被归一，两种假绿看起来都和真绿一样
- [带状态的 UI 元素要立双层一致性合同](stateful-ui-needs-two-layer-conformance-contract.md) — 设计断言 + 功能承诺三层验证，专防装饰性 UI（`deviated` 恒 false 前科）
- [弹层被祖先 overflow 裁掉时三样证据同时失明](overlay-clipped-by-ancestor-overflow.md) — 浮层走查必查：`toBeVisible` / rect / 「点得动」全绿也可能用户点不到，改用 `expectOverlayReachable`

## B. 测试与 CI 的红绿判读
- [停掉一个 agent ≠ 现场清空：子 agent 还在写、哨兵还在跑](stopping-an-agent-leaves-children-and-sentinels.md) — B · TaskStop 只停一个；先 ListAgents 停子 agent，再 pgrep 杀 until 循环，证明无写入后才派接力写手

- [管道跑测试会吞掉退出码](piped-test-runs-mask-exit-codes.md) — `| tail` 的 exit 0 是 tail 的；错的 reporter 名会「全绿」通过
- [测试文件不进主 typecheck](tests-are-not-typechecked.md) — 已由 `check:test-types` 接管，但 `pnpm typecheck` 仍看不见测试
- [判测试翻红前先查别的 worktree](flaky-test-check-other-worktrees-first.md) — 并行 suite 能把耗时放大 40x，和真 flake 长得一样
- [并行会话各跑各的 gates 会把机器压进 swap](parallel-gates-thrash-the-machine.md) — ✅ 已由 `vitest-fair-share` 接管；判超时红灯前先看 load 与 `sys%`，sys>15% 时超时红灯不作数
- [门岗只能下它真拿到证据的那个结论](gate-verdict-must-be-backed-by-evidence.md) — ✅ 已固化；门岗指的证据文件根本不存在（让你看差异图但一张都没有）= 红的是工具不是你的改动
- [productionRun 这类 flake 的分腿处置](production-run-tests-are-flaky.md) — 验修复用 `git cat-file` 看代码，别看 PR 状态
- [复现竞态必须有阳性对照](race-repro-needs-positive-control.md) — 没阳性对照的绿灯不作数；「换平台才能复现」多半是仪器没 power
- [性能预算在 macOS 校准却在 Linux CI 执行 → 假回归](canvas-perf-budget-calibrated-on-macos-fails-on-linux.md) — 别改预算挤 PR，那是治症状
- [Canvas Performance 红了：先看它红在哪一条判据](canvas-perf-red-read-which-assertion-failed.md) — 上一条的**前置步骤**：2026-09-05 那次红预算全绿，真凶是框选手势跑进 React Flow 自动平移带（按帧积分）导致选中数在 8/9/12 间跳；先打印 verdict + warmupFailures 再定性
- [在满载机器上用墙钟做一次性 A/B，不算性能证据](wallclock-bisect-on-a-busy-machine-is-not-evidence.md) — 「拆完 9.1s→47s」已被证伪；量 CPU 时间 + 交错 A/B + 先注入已知变慢验尺子
- [harness 的 catch 会把自己的 bug 洗成产品结论](harness-catch-launders-bugs-into-verdicts.md) — 报某腿失败前先分清是断言红的还是 catch 编的
- [A/B 两版提示词：确认关卡会污染两臂](prompt-ab-gating-question-confounds-arms.md) — 量到的是服从度不是质量
- [探针测不到它命名的那件事，断言就永远绿](vacuous-probe-passes-forever.md) — 按路径过滤 fs 读 spy 恒空；四个会话判成「负载 flake」的那条其实恒真。变异测试是唯一判据，「永不发生」必配阳性对照
- [硬链接复制 profile 会和运行中的 app 抢同一把 leveldb 锁](profile-copy-hardlink-shares-leveldb-lock.md) — 测启动性能前必读：`cp -Rl` 让副本共享 `Local Storage/leveldb/LOCK` 的 inode，凭空多出稳定可复现的 3.5s，伪装成"首屏渲染慢"；测前验 `lsof` 与两侧 inode；附冷/热文件缓存 10x 差异
- [门岗断言不许手抄真相源的派生值，且必须与真相源同触发面](gate-assertions-must-not-copy-derived-values.md) — 看到 `>= N` 先问「N 是抄谁的」；决定落后与否的是触发面不是细心；死名字既造假红也造假绿
- [有界性/复杂度不变量要用「计数」证，别用墙钟跑量](complexity-invariants-need-counters-not-wall-clock.md) — ✅ 已由 `check:test-waits` 第三条规则接管；留下的是门岗抓不到的那半：`fs.readFileSync(fd)` 让按路径过滤的 spy 断言恒真（实测 597 次重扫仍报 0）
- [转发壳能让「命令一字不改」的复核纪律失真](compat-shim-keeps-command-text-changes-its-meaning.md) — 钉死的是命令文本不是它验的东西；复核前先 `git log --follow` 看它有没有被掏空成 `import './别的.test'`

## C. Git 交付、分支与文档改动

- [三点 diff 会掩盖过期分支的大回滚](three-dot-diff-hides-stale-branch-reverts.md) — 判断能不能合必须用两点 diff
- [远落后分支合并走 `gh pr update-branch`](stale-branch-merge-use-update-branch.md) — 本地 push 追平 merge 的巨型 diff 会撞 pre-push 钩子的 ENOBUFS
- [接到「修 X」先查在途 PR](check-open-prs-before-fixing-reported-bugs.md) — 30 秒 `gh pr list` + `git log --all`，省掉白做一版
- [PR 攒到阶段边界再开](pr-cadence-batch-by-default.md) — 频繁 PR 的成本是墙钟：CI 排队 + 合并列车 + 门岗链冲突；**但前提是还有下一件活可搭车——手上空了要交回给用户就是边界，必须开 PR，否则活搁浅在一次性分支上永远合不进去**
- [派任务只给分支名会撞车](dispatch-names-branch-not-path-causes-collisions.md) — 必须写死绝对目录 + 开工 `git worktree add`
- [下否定式结论前先证明你在哪个 checkout](prove-which-checkout-before-negative-claims.md) — 「仓库里没有 X」多半是你站在一个陈旧分支上
- [改 baseline JSON 用文本级编辑，别整体重写](json-baselines-need-surgical-edits.md) — 短数组原文是单行，重写会炸出上千行假 diff
- [方案讨论期别急着 commit/PR](discuss-before-committing-docs.md) — 聊透拍板再落 git；实施类不受限
- [闸门凭据要绑「哪棵树 + 哪个提交」](gate-stamps-must-be-keyed-to-tree-and-head.md) — 只认固定路径 + mtime 的 gates 戳会跨 worktree 互相顶用，同一天误放和误杀各栽一次
- [合并后不立刻录交付收据，窗口就永久关闭](verify-merged-receipt-window-closes-fast.md) — `verify-merged` 要求 HEAD == `origin/main` == 目标 SHA；main 一前进就再也录不成，收据命令要自带重试

## D. 排查与平台故障

- [`ERR_INVALID_STATE` 其实是 `ReadableStream.from`](err-invalid-state-is-readablestreamfrom.md) — 栈里有 `undici:NNNN` 就别去升 Electron
- [grep 静默跳过含 NUL 字节的文件](grep-silently-skips-files-with-nul-bytes.md) — 搜不到已知存在的符号时先 `file` / `grep -a`
- [查重别按报错串 grep](dedupe-grep-misses-silent-copy.md) — 不抛异常的那份正好隐身，而它才是真 bug
- [死 i18n 词条有两种成因，处置相反](dead-i18n-keys-two-causes.md) — 删之前先做「译文值 × 源码硬编码」交叉比对
- [Tailwind 只扫 `.tsx` 时，住进 `.ts` 的类名会静默消失](tailwind-content-ts-classnames-silently-dropped.md) — 「类名写着却没生效」先查它在不在生成的 CSS 里；已由 `content` 加 `./src/**/*.ts` + 哨兵单测固化，附全仓 4 处失效盘点
- [Electron 被 macOS 误报恶意软件的修法](electron-xprotect-false-positive-resign.md) — 重下 + ad-hoc 重签换 cdhash；摘 quarantine 没用
- [Windows 改保存名闪退：根因已修、平台未验](sogou-save-dialog-crash-pending-win32-verify.md) — 再遇先要崩溃日志尾行和 minidump，别重猜
- [MCP 侧改动必须重新打包 app 才看得到](mcp-fixes-need-repackaged-app.md) — MCP server 就是 app 二进制
- [多会话同开 MCP 会串库](nomi-mcp-multi-instance-library-swap.md) — 报「项目不存在」别重试、别改用当前 id
- [`nomi_get_run` 结果要读 `structuredContent.nomiRunData`](nomi-get-run-mcp-projection-shape.md) — text 块是人话不是 JSON
- [MCP elicitation 的支持面（结论已反转）](claude-code-lacks-elicitation-capability.md) — CLI ≥2.1.76 已支持；旧结论别再当前提

## E. 产品判断与对外表达

- [分镜表 = 画布节点的表格表示版](shot-table-is-a-projection-of-canvas-nodes.md) — 不是落画布前的临时物；两半列各有各的 derive 来源
- [参考槽：声明上限不是有效上限，锚→槽是语义绑定](nomi-reference-slots-are-already-declarative.md) — 别渲染 `slot.max`、别按下标推语义、Agent 建完只能改 prompt（结构本身见 `ARCHITECTURE-NOW.md`）
- [批量产出要逐步冒出来 + 自动编组](batch-output-appears-progressively-and-grouped.md) — 一个动作产出多个节点时的既定交互
- [「改不了 / 没有按钮」是可发现性问题](vendor-manage-is-a-discoverability-problem.md) — 功能一直在，根因是控件被 overflow 裁出视口
- [用户说「坏了」多半是「找不到」](group-says-broken-usually-means-undiscoverable.md) — 先真机实测再信；扫到真 bug ≠ 那就是他的 bug
- [中转平台的上限 ≠ 模型的上限](model-limits-first-party-over-reseller.md) — 参数上限要查一手厂商文档
- [KIE 文件上传的实测契约](kie-file-upload-real-contract.md) — 官方文档三处与实测不符（响应字段 / 回链域名 / 有效期）
- [讲方向必须说人话：自造名词和标准术语都要解释](d6-proposal-jargon-must-be-explained.md) — 附「从用户看得见的东西起头」五步结构
- [对外公开发言带 Nomi 品牌](public-upstream-reports-carry-nomi-brand.md) — 上游 issue / 社区默认具名，具名反而更有证据力
- [样张拍板只卡大 UI 改动](mockup-approval-gates-only-big-ui.md) — 小 UI / 非 UI 不等拍板照常推进，等待期并行推别的轨
- [样张交付 = 逐屏逐件走读，不是统计表汇总](mockup-delivery-is-a-per-screen-walkthrough.md) — 每件「这是什么 / 为什么 / 什么时候碰」三段式；走读文档还是验收合同的上游
- [界面重设计走四步流水线：整件复用优先](ui-redesign-four-step-pipeline.md) — 分类 → 找证据（库解剖 / 竞品还原，禁脑补）→ 还原解剖 → 套 token + 认知负荷审计
- [本地旧构建的 `-h` ≠ 官方现役能力面](stale-local-build-is-not-the-current-capability.md) — 判「工具支不支持 X」先刷新到现役版本；update log 才是事实源

## F. 多智能体编排

> 编排纪律的主文档是 [`../engineering/agent-orchestration-playbook.md`](../engineering/agent-orchestration-playbook.md)（`CLAUDE.md` R27 的 L2 详解）。本区只放**执行体自身的工具怪癖**——那不是编排原则，是踩过的具体坑。

- [`codex exec` 后台派工要关 stdin](codex-exec-background-needs-stdin-closed.md) — 缺 `</dev/null` 会永久挂起等输入；会话内后台工人全随 App 死
- [子 agent 起不来时的探针法](subagent-startup-400-probe-method.md) — 一次 harness 侧 400 故障的定位法与两次误诊，别照抄已过期的结论
- [长等待交给 shell 哨兵，别交给子 agent](long-waits-belong-to-shell-sentinels-not-agents.md) — 同一天三种死法（Monitor 交卷 / 零 commit 等到超时 / `--watch` 挂死）；附哨兵模板与「CI 不替你跑新入库走查」

> 另见 playbook [§14 门岗验「没变坏」，不验「做到了」](../engineering/agent-orchestration-playbook.md#14-门岗验没变坏不验做到了把-p3-机器化进派工合同)——派下去的活「36 门全绿」不等于规格达成；派工要绑验收物、收货先验规格再看门岗。
- [两个各自绿的 PR 合到一起会红](two-green-prs-merge-red.md) — 连合同一区域 PR 前先 update-branch 等 CI；分类器 skip 的门不算绿
- [合并收据只认 main 的 tip](merge-receipts-need-exact-tip.md) — 合一个等 CI 记一个再合下一个；probe worktree 分离 HEAD 跑 verify-merged
- [Docs Gate Autosync 往受保护 main 推必败](docs-autosync-cannot-push-protected-main.md) — GH006 三连 = 有文档没进索引/没状态，本地补即可
- [样张两条硬纪律：真字形、真比例](mockups-need-real-glyphs-and-true-proportions.md) — 图标从 @tabler 包抽真实路径；布局线框按 1680×842 真比例并自己看过
