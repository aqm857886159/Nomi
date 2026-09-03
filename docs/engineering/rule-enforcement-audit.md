# 家规执行力分诊报告

> 分诊日期：2026-09-03 · 状态：现行
> 分诊方法：逐条规则查「现在靠什么生效」→ 查 violations.log / git log / docs/lessons/ 里有无实证违反 → 评可机器化程度 → 给建议。
> 实证标准：violations.log 行号 / commit SHA / PR 号 / docs/lessons/ 文件名——没有硬证据不写「曾违反」。

---

## 分诊表（P0–P5 + R1–R20）

| # | 规则 | 现在靠什么生效 | 有无实证违反 | 可机器化程度 | 建议动作 |
|---|---|---|---|---|---|
| **P0** | 默认自主推进到底 | 纯文本（CLAUDE.md） | 无硬证据 | 只能靠判断 | 不变 |
| **P1** | 加新必删旧 | check:filesize 棘轮（防巨壳），CSS 由 check:tokens 覆盖；无并行版无专门机器检测 | `b2a64430` chore: 删孤儿文件（P1 清零）；`a281dbc9` revert: 撤"整组运行"重复功能——证明出现过 | 部分可门岗化 | 可在 pre-commit 加「新文件引入同名 *Old* / *Legacy* / *V1* 模式」soft-check；CSS 已覆盖 |
| **P2** | 修根因不修症状 | self-check.sh 每轮注入提醒；check:root-cause-contracts 结构合同 | violations.log 行2（2026-09-01 P2/派工 cutover-transplant）；violations.log 行3（P2/裁决先类比后测量） | 部分可门岗化 | check:root-cause-contracts 已在链里；门岗化深度已到极限，剩余靠判断 |
| **P3** | 全绿 ≠ 完成 | self-check.sh 注入②闸；check:walkthroughs 静态扫 | violations.log 行1（2026-07-29 R11/P3 截图产出未亲眼看就推）；docs/lessons/gates-green-does-not-mean-walkthrough-ran.md | 部分已机器化 | check:walkthroughs 已在链；「眼见链」仍靠文本提醒，无法机器强制 |
| **P4** | 通用第一 | 纯文本；无专门机器检测 | 无硬证据 | 只能靠判断 | 不变 |
| **P5** | 想清楚再动手 | self-check.sh 注入①闸；stack-currency-check.sh（写 plan 或动 package.json 时触发） | violations.log 行2（2026-09-01 P5/D3 决策件未亲读 1100 行原文） | 触发式可增强 | 已有触发式 hook；上限已接近——docs/plan 文件数可作信号但不能代替判断 |
| **R1** | 加新必删旧（= P1 子集） | check:filesize（巨壳方向）；CSS 由 check:tokens/check:dangling-tokens | git log 有多条删旧提交（`b2a64430` `3456fe17` `c4061610`） | 部分已机器化 | 与 P1 合并处理 |
| **R2** | 用户视角 + 极简 | 纯文本 | 无硬证据 | 只能靠判断 | 不变 |
| **R3** | 决策对比表 | 纯文本 | 无硬证据 | 只能靠判断 | 不变 |
| **R4** | 执行前写 docs/plan | stack-currency-check.sh（写 plan 文件时提醒）；check:docs-index（plan 文件必须索引） | 无违反硬证据，但 plan 文件漏进 docs/plan/INDEX.md 的 `f1b92902 fix:docs-index` 间接证明有漏登现象 | 可触发化（已有） | check:doc-status 检查文档状态标记；已覆盖的「提交了就算」语义暂无法机器检测 |
| **R5** | 查官方文档（Context7） | model-doc-check.sh（碰 catalog/vendor 文件时提醒）；stack-currency-check.sh；check:archetype-sources（来源落库棘轮） | `a8fd3810 fix(archetype): Seedance 2.5 参考上限 9/3/3 → 30/10/10`——明确的档案参数未查文档直接填错；此前注释声称"对过"但实际未对（见 R5 详解） | **已有最强力机器覆盖**（check:archetype-sources 棘轮）；hook 已钩；仍有残余靠文本 | 现有覆盖已是最优；残余（选型时）靠 hook 触发 |
| **R6** | 读顶尖开源 | 纯文本 | 无硬证据 | 只能靠判断 | 不变 |
| **R7** | 6 角色评审 | 纯文本 | 无硬证据 | 只能靠判断 | 不变 |
| **R8** | 先出样张 | self-check.sh 注入①闸；completion-check.sh（PostToolUse 检测 screenshots 路径） | docs/lessons/mockup-delivery-is-a-per-screen-walkthrough.md 间接证明样张交付语义曾被误解 | 触发式有（但弱） | 样张拍板本质是用户协议，机器只能提醒不能强制 |
| **R9** | 模块化 + 防巨壳 | check:filesize 棘轮（白名单只减不增） | `f9a98022 fix(pr18): 拆巨壳`——拆巨壳是被门岗逼出来的，证明门岗起作用 | **已机器化** | 已覆盖 |
| **R10** | CSS 只可减不可增（= R1 CSS） | check:tokens；check:dangling-tokens | `617abfba chore: 抹除 styles.css`——CSS 迁移工作本身证明历史有过全局 CSS 增量 | **已机器化** | 已覆盖 |
| **R11** | 五门全过才 push | pre-push-check.sh（Claude PreToolUse 闸）；.git/hooks/pre-push（ponytail 闸）；gates 链 stamp | violations.log 行1（2026-07-29 R11/P3 管道吞退出码绕过）；docs/lessons/piped-test-runs-mask-exit-codes.md；**push-bypass 绕口无留痕**（今日修复） | **已机器化（今日加固）** | check:push-bypass 已加入链 |
| **R12** | 巨壳门岗（= R9 量化） | check:filesize | 同 R9 | **已机器化** | 已覆盖 |
| **R13** | 体验走查 | check:walkthroughs（静态扫走查结构质量）；completion-check.sh（截图检测） | violations.log 行1（截图未亲眼看）；docs/lessons/gates-green-does-not-mean-walkthrough-ran.md；docs/lessons/walkthrough-assertions-need-a-real-signal.md | 部分已机器化；「亲眼看」无法机器检测 | check:walkthroughs 已在链；眼见链靠文本提醒 |
| **R14** | 周期审计 | check:audit（≥25 commit 提醒；注意：已被蓄意豁免出 gates 链）；check:eval-cadence | 无违反硬证据 | **已机器化（提醒级）** | 豁免理由正确（节奏门不该拦无辜 push）；不变 |
| **R15** | 可见文字国际化 | check:i18n（visible-text / key-parity / key-refs / dead-keys 四道）；棘轮 | `fc281ae9 fix(i18n): 删除 dead-key 门岗暴露的 69 个无引用词条`——门岗工作正常 | **已机器化** | 已覆盖 |
| **R16** | 真实任务测试系统=完成门 | check:walkthroughs（静态扫；不执行走查本身）；纯文本 | docs/lessons/gates-green-does-not-mean-walkthrough-ran.md | 部分已机器化 | **PR 模板勾选清单**（见下「建议立刻做」）是最高 ROI 的补充手段 |
| **R17** | 重活门岗（本地看不出族） | check:heavy-path 棘轮 | docs/lessons/piped-test-runs-mask-exit-codes.md 是同族（管道退出码）；这族写法本身已触发 check:heavy-path 建立 | **已机器化** | 已覆盖 |
| **R18** | 测试等待门岗 | check:test-waits（硬零） | docs/lessons/production-run-tests-are-flaky.md | **已机器化** | 已覆盖 |
| **R19** | 解决状态必须可交付 | 纯文本；check:git-delivery（交付门岗） | violations.log 行3、行4（P2/派工、P2/裁决 均涉及"已实现"误称"已解决"模式） | 部分已机器化 | check:git-delivery 在链；语义判断靠文本 |
| **R20** | 造轮子前过 build-vs-buy 闸 | 纯文本；check:boundaries（边界违规棘轮） | docs/audit/2026-08-25-app-wide-foundation-audit.md（手写 MCP 协议缺标准语义） | 部分已机器化 | check:boundaries 在链；选型判断靠文本 |

---

## 分布统计

| 类别 | 条数 | 占比 |
|---|---|---|
| 已机器化（门岗/hook 强制） | 10 | 43% |
| 部分已机器化（hook 触发提醒 + 门岗兜部分） | 7 | 30% |
| 触发式可增强（已有 hook，可加更多） | 2 | 9% |
| 只能靠判断（无机器手段） | 6 | 26% |

---

## 有实证违反的规则（有硬证据的）

| # | 规则 | 最重实证 | 根因 |
|---|---|---|---|
| **R11/P3（最重）** | 五门全过才 push / 全绿 ≠ 完成 | violations.log 行1（2026-07-29）；**今日发现 push bypass 十余次无留痕** | 管道吞退出码；push-bypass 无留痕两条腿同时失效 |
| **R5（次重）** | 查官方文档 | `a8fd3810` Seedance 2.5 参数四个数全错；注释声称"对过"而实际未对（工程规则 R5 §G1） | 声称对账与真实对账之间无验证手段，hook 提醒覆盖到文件层级但无法进入字段层 |
| **P2/R19（第三）** | 修根因不修症状 / 解决状态可交付 | violations.log 行2+行3（2026-09-01 cutover-transplant 事故、M1 路线纯类比裁决） | 编排者用类比替代测量做架构裁决；班组交付层无收货三查机器拦截 |

---

## 今日实际机器化了哪几条

### 1. push 绕口留痕（R11 加固）—— 已完成 + 红证已跑

**问题**：`git -c core.hooksPath=/dev/null push` 绕过 native `.git/hooks/pre-push`（ponytail + stamp 闸），在子 agent worktree 里两层防线同时失效，十余次无留痕。

**方案（留痕而非禁止）**：
- `scripts/claude-hooks/pre-push-check.sh` 新增 bypass 检测段：命令里含 `core.hooksPath=` 或 `--no-verify` 就追加记录到 `.claude/push-bypass.log`。
- 新门岗 `scripts/check-push-bypass.mjs`（`check:push-bypass`）：读 log，无对应 gates 戳的未确认条目 → 报红；有戳或 `--accept <sha>` 后确认 → 放行。
- 已加入 `gates:contracts` 链（`check:claude-hooks && check:push-bypass && check:hook-behavior`）。

**红灯证明**（R17 原则：加规则必须先证它会红）：
```
# 注入一条无 gates 戳的假绕口：
echo "2026-09-03T12:00:00Z|bypass|branch=test|sha=deadbeef...|worktree=...|cmd=git -c core.hooksPath=/dev/null push|confirmed=no" >> .claude/push-bypass.log
node ./scripts/check-push-bypass.mjs
# → exit 1，⛔ check:push-bypass：1 条 push 绕口无对应 gates 戳
```

---

## 建议：从 CLAUDE.md 常驻文本移出（降到 L2 或删除）的条目

以下条目已被机器门岗覆盖，在每轮 L1 注入里只占注意力预算而无实质增量。建议用户拍板后从 CLAUDE.md 规则索引里**删除或缩短**，细节保留在 `docs/engineering-rules.md`（L2）：

| 条目 | 建议 | 理由 |
|---|---|---|
| R12（→ R9 巨壳） | 从 CLAUDE.md 索引行删除，只在 L2 保留 | check:filesize 已门岗化；R9 的一句话已覆盖；R12 是 R9 的重复索引 |
| R10（→ R1 CSS） | 从 CLAUDE.md 索引行删除，只在 L2 保留 | check:tokens + check:dangling-tokens 已门岗化；R10 是 R1 的重复索引 |
| R18（测试等待门岗） | 可从 CLAUDE.md 索引行缩短为一句（硬零，已机器化） | check:test-waits 硬零，已完全机器化；开发者触碰测试文件时 hook 不会读 CLAUDE.md |
| R17 的详细说明 | 索引行保留但缩短 | "规则清单以脚本 RULES 为准，别在文档里数条数" 这句可删（机器已保证一致性） |
| 「每日雷达」段 | 考虑移出 CLAUDE.md 主体，改为 hook 注入 | 这段占 CLAUDE.md ~15% 篇幅，内容是定期任务逻辑，不是「永远相关」的原则；改为 UserPromptSubmit hook 的条件注入（今天已有雷达就不注入）更精准 |

**不建议移出的**：P1–P5（每轮相关）、R4（多文件先写 plan）、R5（查文档）、R11（push 五门）、R13（走查眼见链）、R16（真实任务测试）、R20（build-vs-buy）——这些违反过或有机器补不到的判断层，文本提醒有边际价值。

---

## hook 注入精简建议

### 现有注入量估算

| 部分 | 字符数 | 估算 tokens |
|---|---|---|
| violations.log 前 3 条（当前 4 条取前 3） | ~571 字符 | ~400 tokens |
| 三闸自检 heredoc | ~829 字符 | ~580 tokens |
| 标题 / 空行 / 格式 | ~100 字符 | ~70 tokens |
| **合计** | ~1500 字符 | **~1050 tokens** |

*注：中文 token 密度约 0.7 token/字符（混合中英）；Claude 计费约此量级。*

### 精简建议（草案）

violations.log 部分无法精简（数据驱动，自动变化）。heredoc 可以瘦身：

**建议精简后的 heredoc**（移除已被门岗覆盖的细节，保留判断点）：

```
【三闸 · 到这三刻必停（完整规则见 CLAUDE.md）】
① 动手前(P5)：UI 可见? 读设计系统+出样张+拍板(R8)｜三方库? Context7(R5)｜新框架? Context7+web 查现役｜多文件? 先写 docs/plan(R4)｜取舍? 对比表(R3)
② 交付前(P3)：全绿≠完成。和样张对账+真机走查(R13)。眼见链：截图→亲眼 Read→来自正确构建→拍到改动区。R16: 真实用户任务端到端才算完成
③ push 前(R11)：pnpm run gates 全过（push 闸会拦未过的，含 push-bypass 留痕）
【贯穿】P2 修根因｜P1 加新删旧｜derive 不 hardcode｜≤800 行(R9)
```

估算精简后 heredoc：~350 字符 ≈ 245 tokens（节省 ~57%）。加 violations.log 合计约 **650 tokens**（较现有 1050 减少 ~38%）。

---

## 规则索引覆盖面总结

- 分诊总条数：25 条（P0–P5 + R1–R20，含别名 R10/R12）
- 已机器化（门岗/hook 强制）：10 条（40%）
- 部分机器化（触发 hook 提醒 + 部分覆盖）：9 条（36%）
- 纯文本（无机器手段）：6 条（24%）
- 有实证违反的规则数：**7 条**（violations.log × 4 事件；lessons/ 多条；git log 硬证）
- 最重三条：R11（push 绕口）、R5（档案参数未查文档）、P2/R19（根因-裁决-交付）

---

# 规则执行审计 — 可机器化分诊表（2026-09-03）

> 本文件由家规瘦身执行班在 `docs/claude-md-slim-20260903` 分支产出。
> 分诊依据：「已被门岗/hook/skill 完全覆盖 → 可从 L1 删；纯靠判断 → 保留」。
> 逐条标注「删减来源/覆盖者」，确保可追溯。

## 判据

| 类别 | 处置 |
|---|---|
| 纯靠判断（P0–P5, D1–D6, 决策自治边界, 并行纪律中靠人裁的部分） | 保留 L1 |
| 已被门岗/hook/skill 完全覆盖 | 从 L1 删/降级到 L2 |
| 同一族多条说同一件事 | 合并最锋利措辞 |
| 细节无需 always 加载 | 移位到 L2，L1 保留一句索引 |

## 分诊表

### 已删/降级条目（可追溯）

| # | 原位置 | 内容摘要 | 被谁覆盖 | 处置 |
|---|---|---|---|---|
| A1 | CLAUDE.md 文件头 preamble（L2触发才查行、查现状行） | L2/L3 层指针的详细说明 + ARCHITECTURE-NOW 存在的故事 | 指针本身保留，verbose 解释移除；新 AI 看 preamble 能找到所有文件 | 压缩：保留层指针，删 2026-08-27 故事句 |
| A2 | CLAUDE.md 维护纪律段（hook 安装机制说明） | postinstall 自动装、换机不需手动复制、worktree 要先 pnpm install、旧戳 TTL 细节 | `check:claude-hooks` 门岗 + postinstall 脚本；hook 安装机制是实现细节属 L2 | 压缩：保留「真相源 scripts/claude-hooks/，check:claude-hooks 验同步」一句，删机制细节 |
| A3 | CLAUDE.md 维护纪律段（AGENTS.md 漂移故事） | 2026-08-25 双份手工维护撞号故事（完整案例） | check:agents-sync 门岗 已硬拦漂移；故事属教训应在 docs/lessons/ | 保留「禁止手改 AGENTS.md，改纪律只改 CLAUDE.md + gen:agents」，删故事 |
| A4 | CLAUDE.md 三闸段（三闸详细展开） | 动手前/报完成前/push 前的详细 inline 规则（与 hook 几乎逐字重复）| self-check.sh hook 每轮注入三闸全文；L1 重复只增加上下文长度 | 压缩为 2 句：「三闸由 hook 自动注入，不在此复述。细节见 self-check.sh + CLAUDE.md §P1–P5。」 |
| A5 | CLAUDE.md 每日雷达「抓的时候不是随便抓」（4 维细节） | 论文雷达的 4 维筛选标准（最新/火不火/有没有用/成熟度）| nomi-research-radar skill 内已包含筛选逻辑；L1 无需重复维度列表 | 删 4 维列表，保留「维度见技能」一句 |
| A6 | CLAUDE.md 并行纪律（ponytail/force-push 长注释） | 「评审钩子按远端旧 tip→新 tip 算…重建一律走新分支，见 R25」注释块 | R25 行的索引已指向详细规则；实现细节属 L2 | 删括号内实现细节，保留「不 force-push main / 不向已存在远端分支 force-push 重建内容」核心约束 |
| A7 | CLAUDE.md P1 段（搬家不留转发壳·现存29个反例） | re-export 壳细节 + 现有数量 | check:filesize + 代码审查；数量会过期；具体规则在 L2 R1 | 删「搬家不留转发壳」段落，L2 R1 已有 |
| A8 | CLAUDE.md P2 段（schema-v3/recurring 细节） | recurring/高风险交 schema-v3 合同、旧 v1/v2 只读 | check:root-cause-contracts 门岗 + R21 行已索引 | 保留 P2 的判断部分，删 schema-v3 合同细节（属 L2 R21）|
| A9 | CLAUDE.md 三闸段 inline 控件层级规则 | §1.5 控件层级规则·手法优先级·先分组→再去重→再归位 | 设计系统文档 docs/design/nomi-design-system.md §1.5；P5 已指向 | 删 inline 展开，P5「加/挪控件先过设计系统 §1.5」保留 |
| A10 | CLAUDE.md 三闸段 inline derive/hardcode 三次前科 | 「含门岗断言：不许在测试/门岗里手抄真相源…栽过三次：账本/CI/>=22工具数」| check:vocabularies + check:heavy-path 硬拦；前科属 docs/lessons | 删 inline 前科罗列，保留「随输入 derive 不 hardcode」原则 |
| A11 | CLAUDE.md 工作目录 worktree 政策（两点视图长注释） | 「评审/对账/打捞任何分支先算 merge-base——对 main 两点视图里的大片删除…见 R22」| docs/lessons 教训文件已覆盖；R22 行索引 | 删括号内实现细节，保留「评审任何分支先算 merge-base」核心规则 |

### 合并条目

| 合并后 | 原来多条 | 合并理由 |
|---|---|---|
| R1 行精简（删「搬家」附注） | R1 行 + P1 段搬家附注 | 同一规则两处说 |
| 三闸合并为 2 句 | 三闸段 + P5 的 inline 展开 | hook 已全覆盖 |
| 维护纪律段压缩为 3 句 | 原 preamble 中维护纪律两段（hook 安装 + AGENTS 故事） | 机器门岗覆盖实现细节 |

### 保留条目（及理由）

| 保留 | 理由 |
|---|---|
| P0–P5 全文 | 纯判断，机器替代不了 |
| D1–D6 全文 | 纯判断，用户决策逻辑 |
| 决策自治边界（自己定/才问用户/遇到矛盾） | 纯判断 |
| 并行纪律（worktree 基本规则） | 靠人裁的操作规范 |
| 规则索引表（所有 R# 行） | 指针，新 AI 需靠它找 L2 细节 |
| 每日雷达触发逻辑（今天有没有 → 跑/跳过） | 纯判断逻辑，无法机器化 |
| 项目概览、常用命令表 | 项目事实，must-load |

## hook 瘦身草案

### 目标

三闸注入文本压到核心三行以内；「近期坑」保留 Top 2（当前 Top 3）。

### 瘦身原则

- 「动手写码前」行：删冗余 inline 控件层级规则 + R8 大括号展开（link 到 docs/design）
- 「报完成前」行：删「眼见链四问」冗余细节（保留 P3 引用 + R13 引用）
- 「push 前」行：保持一句「pnpm run gates」
- violations.log 取前 2 条（从 3 改 2）

## 结论

可安全删减的文本约 3,500 字符（约 875 tokens）。
删减后 CLAUDE.md 仍能让新 AI 正确干活：P0–P5 完整、D1–D6 完整、规则索引完整、指向 L2 的指针完整。
