<!-- 本文件由 scripts/gen-rules-view.mjs 从 docs/engineering/rules.json 生成，请勿手改。 -->

# 规则登记表（视图）

> 正本是 `rules.json`，这里只是好读的版本。改规则改 `rules.json`，再跑 `node scripts/gen-rules-view.mjs`。
> 旧编号（R# / D# / PB# 等）写在每条的「旧号」列，`check:rule-aliases` 保证任何引用都解析得到。

## 常驻（CLAUDE.md 里就有）（12 条）

| 编号 | 旧号 | 规则 | 防的病 | 执行点 | 证据 | 负责 | 复查 | 删除条件 |
|---|---|---|---|---|---|---|---|---|
| P0 | P4 R5.3 R20 | 只写我们独有的领域；通用能力默认接入现成的，自写进 self-written.json，理由只认领域约束；能力按通用场景设计，与具体供应商解耦。登记不是一劳永逸：评估中（under-review）有期限，过期后再碰它的文件就拦，新登记不超过 30 天、最多续一次；已登记的自写通用能力 30 天内第 2 个 fix 就回头评估接入现成方案；已替换的条目（to-replace 的文件都没了）要删。 | agent 默认爱造轮子；通用能力被写成供应商专用 | gate:check:self-written(新增未认领模块 + 评估到期真拦 + 已替换要删登记)；gate:scripts/check-direction-trailer.mjs(自写登记连修第 2 次要带点名该登记的复盘)；coordinator-tool:scripts/self-written-review.mjs(排版本计划时跑，到期清单给用户看)；gate:check:prior-art；hook:self-check(先查别人块) | CI 里 check:self-written / prior-art 有红记录；用户纠正过「先接入再自写」 | 协调会话 | 2026-12-01 | check:self-written 完全表达它，且连续 2 个周期零违规 |
| P1 | R1 R10 R23 | 新实现同 commit 删旧实现，不留并行版 / fallback；CSS 只写组件 className；生成画布只许 React Flow 一个内核。 | 旧路径没删仍能写（最大一类逃逸） | gate:check:orphan-cables；gate:check:tokens | 复盘里 legacy-canvas-write-doors、legacy-storyboard-placement 两条：旧路径没删仍能写 | 协调会话 | 2026-12-01 | 出现能自动判「并行实现」的门岗 |
| P2 | R21 R21.1 R21.3 PB17 PB10 | 修根因不修症状：分清症状 / 直接原因 / 类根因；动生产代码前先 door-map 数清写读入口；修在最早共享边界；自问「同类还能从别处回来吗」。可复发 / 高风险 / 逃逸 bug 交根因合同（必答 invariant_owner_layer、带 doors、recurrence_check_on、detected_by）。用户发现的问题进逃逸账本（tests/ux/full-walk/escapeLedger/），结账（fixed）必须同时有根因合同、一条类级检查（铁律 ⑩ ⑪ ⑫ / inv:1-9 或矩阵 / 普查测试，只测单场景的不算）和合入的 PR 号；candidate 停留超 14 天警告。只修现场不算修好。 | 同类问题第二次、第三次从别的入口回来 | skill:root-cause-remediation；gate:check:root-cause-contracts(只对 schema 阻断，其余警告)；gate:check:escape-ledger(账本格式 + fixed 必须挂根因合同 / 类级检查 / PR 号；candidate 超 14 天警告)；coordinator-tool:scripts/merge-preflight.mjs(账本里 candidate → fixed 的状态转换才要求带根因合同，判断与 check:escape-ledger 共用 escape-ledger-lib)；hook:self-check(修根因块) | 复盘里同类复发仍在（行 2 与行 60 同为 CI 缺 Chromium）；合同 647 份 | 协调会话 | 2026-12-01 | 30 天复发率连续 2 个周期低于 10% 时降 l2 |
| P3 | R13 R32 | 全绿不等于完成：用户可见改动报完成前，和获批样张逐项对账、自己亲眼 Read 过真截图（zh/en 两轨）；功能交付要有真实任务闭环；四件真实：真应用 / 真输入 / 真工具轨迹 / 真素材；没有真实资源记 unverified，不许 mock 绿灯顶替。 | CI 全绿但体验不对、半成品被报成完成 | hook:completion-check；gate:test:core-smoke；gate:check:full-walk-catalog；template:tests/ux/full-walk/escapeLedger/；hook:self-check(报完成块) | completion-check 在 Stop 时拦无眼见证据的完成宣告 | 协调会话 | 2026-12-01 | 逃逸率连续 2 个周期低于 10% |
| P5 |  | 想清楚再动手：碰花钱 / 长跑 / 可打断 / 新界面先写设计卡；新增或改动用户可见界面，拍板样张必须是设计实验室用生产组件 + 真实宿主数据（ShellStage 手法）搭出的屏，拍板后生产代码就是它；手写 HTML / 交互 widget 只准标 exploration 做方向探索，不能作实现合同；新组件先写生产目录本体，实验室只给数据；重要改动动手前先 grill 一轮（每题带默认答案、连带面单独成题），纯 bug 修复不问。 | 没想清楚就写，返工与连带面漏掉 | template:docs/engineering/design-card.md；template:docs/engineering/design-card.md(★1/★9 指标与分档)；gate:check:pr-judgement(设计卡「功能分类」按路径推出的类别下限勾选 + `## 验收证据` 逐项对账，路由表 docs/engineering/test-routing.json；CI Contracts + push 前)；coordinator-tool:scripts/merge-preflight.mjs(同一份判据 + 规则与门岗改动范围)；template:tests/ux/full-walk/catalog.mjs(⑫ click target 对照)；hook:self-check(设计卡块)；template:docs/design/nomi-design-flow-howto.md | mockup-contracts 门岗；用户纠正「推荐先看用户控制权」 | 协调会话 | 2026-12-01 | 设计卡覆盖全部内容后并入 DC |
| DC | R4 R7 R33.1 R13.2 R16 PB13 | 设计卡（暂停点①）：碰花钱 / 长跑 / 可打断 / 新界面任一类，动手前写一页卡（9 格全填，其余改动只填 ★ 格 1、2、3、4、9），写进任务书或 docs/plan，PR 正文 `## 设计卡` 放链接或全文。 | 没想清楚就动手；概念占用、中途状态、真实任务、回滚没人在动手前回答 | template:docs/engineering/design-card.md；coordinator-tool:scripts/merge-preflight.mjs；hook:self-check(设计卡块) | 复盘：逃逸 bug 多出在中途状态和概念占用；卡取代原来分散的 plan 模板、6 角色评审、概念占用表 | 协调会话 | 2026-12-01 | 合并前扫描连续 2 个周期无空格 PR，且逃逸率低于 10% |
| IA | R25 R14.3 PB1 PB7 PB14 | 独立验收（暂停点②）：四类改动合并前由另一条线验收，PR 正文 `## 独立验收` 带报告链接和验收线编号，编号不得与实现线相同；红灯用固定复现命令一字不改；班组报告是声明不是证据。 | 干活的给自己打分；门岗只证没变坏、证不了做到了 | coordinator-tool:scripts/merge-preflight.mjs | 取代原交工前评审（其适配器不可用、处理大 diff 时崩） | 协调会话 | 2026-12-01 | 逃逸率连续 2 个周期低于 10% |
| DECIDE | D1 D2 D3 D4 D5 D6 | 替用户做决策时的判断逻辑（D1–D6）：从创作者真实摩擦和结构约束出发；第一性追到底层「为什么」，论断有据、不确定就实查；极简加诚实交付；逻辑清楚就快决，敢反驳、敢下判断。原文压缩稿见 CLAUDE.md「替用户做决策时」。 | 停下来问不该问的、或替用户做了他不会选的 | manual | 执行点 manual，用户 2026-10-02 拍板常驻（D1–D6 压缩保留，D3「先搞懂再叫 bug」、D5「敢反驳敢判断」都留） | 用户 | 2026-12-01 | 用户另行决定 |
| AUTO | R3 | 决策自治：默认自主推进到底，不留遗留；只在产品方向 / 不可逆取舍 / 架构岔路 / 用户独有资源 / 样张里两条拍板自相矛盾时停下上报（不许自己挑一条实现），并给对比表与推荐项。 | 停下来问不该问的，或在该停的地方自己挑了一条 | manual | 执行点 manual，用户 2026-10-02 拍板常驻 | 用户 | 2026-12-01 | 用户另行决定 |
| PAR | S-PAR H-PUSH | 并行纪律：独立 sibling worktree，先 delivery:preflight、先 pnpm install；不在共享主仓切分支 / 提交；推送前整合最新 origin/main（merge，不 reset 不压缩）；只推任务分支；不 force-push。 | 多会话踩同一工作树、推送丢提交 | gate:check:fresh-base；hook:pre-push-check；gate:check:push-bypass | pre-push 留痕 push-bypass.log（本机日志） | 协调会话 | 2026-12-01 | 不适用 |
| COORD | S-MS | 多会话：同一时段只有一个协调会话，用户只和它说话；其他会话只开 PR 并发号，不自己合并，新问题和要拍板的问题发消息给协调会话（不建任务卡、不直接问用户）。 | 多会话各自合并、各自问用户 | coordinator-tool:scripts/merge-preflight.mjs | 编排手册 §19 的运作记录 | 协调会话 | 2026-12-01 | 不适用 |
| R11 | R11.0 R11.1 R19 S-VIO | 交付与状态：按验证分层通过后自己 commit + push；状态词只有四档：已实现未推送 / 已推送待合入 / 已合入待验证 / 已解决（已解决需 merge SHA 上的 delivery:verify-merged 收据）。 | 把「写了」说成「解决了」 | hook:pre-push-check；gate:check:git-delivery；coordinator-tool:delivery:verify-merged | pre-push-check 留痕；git-delivery 在 contracts | 协调会话 | 2026-12-01 | 不适用 |

## 触发才查（11 条）

| 编号 | 旧号 | 规则 | 防的病 | 执行点 | 证据 | 负责 | 复查 | 删除条件 |
|---|---|---|---|---|---|---|---|---|
| RW | R21.2 | 方向检查（原重写判据）：同一文件、同一概念目录、concept-owners 里的同一概念（owner + write_api 的文件合起来）14 天内第 3 个 fix 提交，或同一条自写登记（status 为 under-review / to-replace，或 justified 但属通用区；paths 下的文件合起来）30 天内第 2 个 fix 提交（locale 词典 src/i18n/locales/*.ts 按「文件#顶层功能键」命名空间计数，中英同名算一个）、出现 revert fix 的提交、修复因评测分数下降被回滚、同一条线派第 3 轮及以上修补、要加第三个特例分支，任一出现就停止派修补，先做类根因复盘（归类表、为什么一直冒、预测、靶子独立性检查、P0 现成方案、接入 / 补 / 重写 / 删对比；成熟方案存在时推荐项默认是接入，除非有领域约束；自写登记命中的复盘必须点名该条登记并写清现在换不了的理由与哪天换），结构性结论交用户拍板，复盘前先写特征测试钉住现状。 | 同一处被反复补，没人回头问方向和靶子对不对（评测靶子由同一条线自己写、本身有错） | gate:scripts/check-direction-trailer.mjs；coordinator-tool:scripts/fix-churn.mjs；hook:edit-time-reminder；hook:self-check(方向检查块)；template:docs/engineering/direction-check-template.md | 2026-10-05 MCP 协议层 / 启动器一个月修约 14 次、散在 6 个文件，按文件 / 目录都没凑够 3 个，登记还写着「尚未评估」；2026-10-04 导演计划编译器一天约 13 个提交、9 个 fix（含一次 revert 和一次因 oracle 分数下降的回滚），协调层照交接单又派第五轮；旧执行点只有 Claude 编辑提醒，修复由 Codex 执行时 hook 不跑，派工那一步也没有检查；根因是缺舞台模型层，且评测靶子本身有错 | 协调会话 | 2026-12-01 | 30 天内热点 fix 提交带 Direction-Check 的比例持续为 100% 且无第 3 轮修补，则只保留 git 层 |
| R8 |  | 用户可见改动先出设计实验室样张并拍板：屏由生产组件 + 真实宿主数据（ShellStage 手法）渲染；实现后用整张对账表逐区域核对，每个 data-mockup-region 都有一致 / 差异+原因 / 推迟阶段的一行；手写 HTML / 交互 widget 只可标 exploration，不能作实现合同；拍板后生产代码就是实验室屏。 | 实现与获批样张不一致 | gate:check:mockup-contracts；template:docs/design/nomi-design-flow-howto.md；hook:self-check(设计卡块) | mockup-contracts 门岗在 contracts | 协调会话 | 2026-12-01 | 设计卡 ★4 格覆盖样张对账后并入 DC |
| R5 | R6 R5.2 R5.5 R29 R31 | 先查别人：结论默认接入，凭记忆判断等于没查。三方库 API 先 Context7；做方案先读近邻开源真实代码；外部也读写的格式 / 协议先找规范、写偏差与理由（后两者为建议档）。 | 凭记忆写第三方接口、自造格式 | hook:self-check(先查别人块)；gate:check:prior-art | prior-art 红灯 60 次几乎全是补文档（登记摩擦）；对应 check:standard-formats / dependency-capabilities / archetype-sources 三道零红门岗已删 | 协调会话 | 2026-12-01 | 门岗连续 2 个周期零触发且无外部契约类逃逸 |
| R5.4 |  | 接框架 / SDK / 运行时：先出四列表（它提供 / 我们用了 / 我们另写了 / 我们拆散了）+ 参考实现逐层对照，逐字段裁决（一致 / 有意不同且理由是领域约束 / 没想到）。 | 接了框架却只用一半、另写一份 | gate:check:framework-boundary；gate:check:framework-surface | framework-boundaries.json 登记；两道门岗在 contracts | 协调会话 | 2026-12-01 | 门岗连续 2 个周期零触发 |
| R9 | R12 | 模块化防巨壳：写码前想清楚分层；单文件不超过 800 行。 | 巨壳文件 | gate:check:filesize | check:filesize 红 21 次，真拦 15 次（例：拆 workbenchDocumentSlice） | 协调会话 | 2026-12-01 | 不适用 |
| R15 |  | 所有用户可见文字走 i18n（zh-CN / en），两轨都要真截图。 | 硬编码中文或英文 | gate:check:i18n | check:i18n 红 9 次，真拦 5 次（含键引用解析 check-i18n-key-refs，挂在 check:i18n 链里） | 协调会话 | 2026-12-01 | 不适用 |
| R17 | R17.0 R17.1 R17.2 R17.3 R18 R26 R28 | 防线建在最早能拦住的那层：能让编译器拦的别留给门岗，能让门岗拦的别留给人；棘轮基线只减不增，加规则先验它会红；门岗红了先读它红在哪条判据，别抬基线。含重活门岗（卡死一族）、测试等待、分层边界三族棘轮。 | 门岗被基线挤爆、规则只登记不执行 | gate:check:heavy-path；gate:check:test-waits；gate:check:boundaries；gate:check:vocabularies | check:vocabularies 红 9 次真拦 4 次；heavy-path / boundaries 在 contracts | 协调会话 | 2026-12-01 | 不适用 |
| R22 |  | 验证分层与测试预算：contracts 常跑，其余维度按真实风险独立触发；认不出的路径默认跑全量；没有真实资源记 unverified。 | 测试预算与风险错配 | gate:scripts/validation-policy.mjs；gate:check:quality-gate-workflow | CI scope job；复盘里「认不出的路径」两条 | 协调会话 | 2026-12-01 | 不适用 |
| R27 | PB2 PB3 PB5 PB6 PB9 PB19 PB19.3a | 多智能体编排：任务书带开工三行头与概念占用；收货三查；一个概念一个 PR、按阶段攒（提交不压缩）；协调会话运作见编排手册。省 token：①派活前先数轮次（同一处第 3 轮就停，改派复盘）；②协调会话不读大文件全文，先看大小和标题再按段读，读子 agent 结论不读过程；③子 agent 同时最多 3 个（含续跑）、默认 Sonnet，只有根因未定 / 碰花钱边界 / 结构改动才用 Opus，不再派子 agent；④任务书写清范围、不碰清单和停点，交货报告要短；⑤确定性的活用脚本不交给模型；⑥长输出落文件只看摘要，同一文件不反复读；⑦卡住 3 次就停下报告。 | 派工混乱、合并失控 | coordinator-tool:scripts/merge-preflight.mjs；coordinator-tool:scripts/check-dispatch-brief.mjs；hook:self-check(省 token 块) | docs/engineering/agent-orchestration-playbook.md（§19 运作、§20 省 token）；2026-10-04 导演编译器第五轮修补是派工层没数轮次、协调层读全文又派工的典型 | 协调会话 | 2026-12-01 | 不适用 |
| R33 | R33.2 R33.3 R33.4 R33.5 | 概念的 owner 先于目录：同一概念同一时段只归一条 lane；谁说了算在设计卡 ★2 格动手前回答；概念登记表 concept-owners/ 由门岗校验（警告档）。 | 同一概念出现第二个 owner | gate:check:concept-owners(警告)；template:docs/engineering/design-card.md | concept-owners 红 4 次全是登记没补 | 协调会话 | 2026-12-01 | 不适用 |
| SECRET | H-SECRET | 禁 --no-verify、禁 git add -f，敏感数据不进 git；提交前敏感数据扫描不得绕过。 | 密钥与隐私数据进入仓库 | hook:secret-guard；hook:commit-bypass-check；gate:check:secrets | commit-bypass-check 有单测 | 协调会话 | 2026-12-01 | 不适用 |

## 建议档（可以只有人工执行点）（4 条）

| 编号 | 旧号 | 规则 | 防的病 | 执行点 | 证据 | 负责 | 复查 | 删除条件 |
|---|---|---|---|---|---|---|---|---|
| R5.1 |  | 碰三方库或供应商模型定义前，先抓官方文档逐项对账（Context7 / 官方页面）。 | 外部数据与想象不一致 | hook:model-doc-check；hook:self-check(先查别人块) | 外部契约类逃逸（复盘 C 类） | 协调会话 | 2026-12-01 | model-doc-check 连续 2 个周期零命中 |
| R2 |  | 每条界面信息问「有行动价值吗」，没有就删；每屏记信息密度三个数。 | 界面堆无用信息 | template:docs/design/nomi-design-flow-howto.md | 设计系统评审 | 协调会话 | 2026-12-01 | 并入设计系统文档 |
| R13.1 | R13.3 R30 | 穿透式体验走查与 Agent 真实模型数字：走查按真实用户路径逐步亲眼看；Agent / 工具 / 契约改动要有真实模型的写对率与回合成功率，实验室基线只证外观。 | 走查走形式；Agent 改动没有真实数字 | gate:check:walkthroughs | check:walkthroughs 红 17 次，真拦 15 次 | 协调会话 | 2026-12-01 | 不适用 |
| R14 | R14.1 R14.2 | 周期审计：满 25 个提交或发版前，多维审计加走查；同一语义有几份定义，七维横扫。 | 漂移与重复定义积累 | manual | 旧 check:audit 本地从不跑，已删 | 协调会话 | 2026-12-01 | 改为发版前检查清单后删 |

## 保留号

- R24：PR #223 的能力完整性合同保留号；本仓不定义也不复制，避免与 Agent Host 规则形成第二套旁路
