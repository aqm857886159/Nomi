# 数门：查根因必须先数清这个状态有几扇门

> 状态：✅ 已交付 · 2026-09-11 · 规则落点 R21（合同侧）+ R27（派工侧）
> 门岗：`pnpm run check:root-cause-contracts`（合同必填 `doors` / `door_reduction`）、`pnpm run check:door-map`（PR 侧引用）
> 工具：`node scripts/door-map.mjs <mutator 符号或文件>`

## 1. 真实摩擦：三簇 bug，同一个形状

2026-09-11 一天之内连着三簇 bug 收敛到同一句话：**这条不变量只在一扇门上实现了，另一个入口绕过去。**

| 簇 | 状态 | 门在哪 | 怎么漏的 |
|---|---|---|---|
| 画布写入 | 生成画布节点 | `applyCanvasToolCall` 有 **6 个直接写入口**（`src/workbench/capability/capabilityApplyHandler.ts:625`、`src/workbench/capability/multiShotCanvasLanding.ts:230`、`src/workbench/creation/storyboard/exec/storyboardRowActions.ts:97`、`src/workbench/generationCanvas/agent/proposalTxn.ts:256`、`src/workbench/onboarding/journeyTourStore.ts:99` 与 `:132`），其中事务门 `executeCanvasWriteTarget` 还隔了一跳（`src/workbench/generationCanvas/agent/canvasWriteTarget.ts:266`/`:448` 经 `applyProposalBatch`） | 校验加在事务门上，直发那几条绕过去 |
| 付费收据 | Run 的付费放行 | 签发方只有一个（`electron/productionRun/productionRunService.ts:120` 的 `createGateApprovalOwner`），核验回调却有**两个生产装配点**（`electron/capabilityCore/runOwnedGenerationGateAuthority.ts:74/134/173/210`、`electron/capabilityCore/productionTrustGrantChallenge.ts:46`） | 两处装配都没接回调，分开看都不像 bug，合起来把主确认面整个堵死 |
| 技能事实 | `SkillRecord` | `readSkillRecords` / `discoverSkillRecordsFromRoots` 有 **8 个 store 之外的消费者模块**，每个自己决定投影带哪些字段、什么时候取（清单与实核见 [`docs/audit/2026-09-11-skill-fact-projections-structure.md`](../audit/2026-09-11-skill-fact-projections-structure.md)） | 5 份根因合同 = 5 个消费者各被单独修了一次 |

三次都被当成独立的一处 bug 修了一遍。**根因不在修的人身上，在派工上**：任务书写的是「这里坏了，修这里」，
执行体被框在一个文件里——他看得见症状那扇门，看不见另外几扇，也没有动力去找跨结构的根因。

「同类问题还能从另一个入口回来吗」这一问，R21 的合同里其实早就有（`same_class_entry_points`、`recurrence.same_class_scan`）。
但它们都是**叙述**：作者说他扫过了，门岗只能核对格式。人在高负载下不会去数，而这件事本来就是机器的活。

## 2. 这次做了什么（三件，都可机器核对）

1. **合同加门表**。`docs/fixes/*.root-cause.json`（文件名日期 ≥ `2026-09-11`）必填两个字段：
   - `doors`：这条不变量碰到的状态的**全部写入口与读入口**，每条 `{kind:"write"|"read", path, line, symbol}`。
     门岗逐条核对 path 存在、且该行真的提到该 symbol——写错行号就是没重数。
   - `door_reduction`：`{before, after, why_not?}`。`after` 必须等于 `doors.length`（门表记的是修完之后还剩几扇）；
     `before ≥ 2` 而一扇没减时 `why_not` 必填——**允许不减，不允许无声地不减**。
   另加一条：本次改动中、落在本合同 `scope_paths` 内的 `src/` 与 `electron/` 生产文件，必须 ⊆ 门表 path 集合。
   改了门表之外的文件 = 门没数全，或者 scope 画大了。
2. **数门脚本** `scripts/door-map.mjs`。输入一个 mutator / store 符号，或一个文件（取它的全部导出符号），
   用 TypeScript compiler API 扫 `src/` + `electron/`，输出能直接粘进合同的 `doors` 数组。0.9 秒扫完 2325 个文件。
3. **派工两段式 + PR 侧门岗** `check:door-map`。判为 `recurring` 的修复，PR 正文必须引用那份带门表的合同——
   门表不能是写完就沉进 `docs/fixes` 的一页纸。做法照抄 `check:prior-art` 的 PR 侧（CI `pull_request` 必查、本地 `--pr` 才查、取不到正文明说没查成）。

### 刻意不做的

- **不做传递闭包**。脚本只数**直接**调用点；`executeCanvasWriteTarget` 这种隔一跳的门，要再数一跳
  （`node scripts/door-map.mjs applyProposalBatch`）才看得见。理由：传递闭包在这个仓库会一路爬到 React 组件树，
  门表变成几百行没人读——一张没人读的门表和没有门表是同一种东西。限制写在脚本头部，回归测试把它钉死。
- **不判门表质量**。门岗只判「数了没有、数的门解析得到没有」。一道试图判质量的门岗会开始误判，然后被绕过（R17）。
- **不追溯存量**。棘轮按**文件名日期**（本仓一贯做法，同 `INVARIANT_OWNER_LAYER_SINCE`），阈值之前的 400 份合同不追。
  追溯只会让门岗一上线就是一片红，然后被无视。

## 先查别人

| 问 | 查到什么 | 出处 | 和「数门」的关系 |
|---|---|---|---|
| 大型代码库怎么做「改共享 API 前先枚举全部调用者」？ | Google 的 LSC 流程用 Kythe 语义索引回答「这个函数的调用者在哪」，再由 Rosie 按项目边界与 owner 分片 | https://abseil.io/resources/swe-book/html/ch22.html | 支持：他们的「门」是**符号的调用点**，机器枚举；我们的门是**某份状态的入口**（读 + 写），索引不会白送——必须先说清是哪份状态 |
| 「一个写入口」有没有既有名字？ | Single Writer Principle：「for any item of data, or resource, that item of data should be owned by a single execution context for all mutations」 | https://mechanical-sympathy.blogspot.com/2011/09/single-writer-principle.html | 最接近的命名前例。但它是为竞争/延迟提出的，说的是**应该有**一个写者；数门说的是**先查清你实际有几个** |
| 有没有语言级把门数做成可检查的？ | Rust：「At any given time, you can have either one mutable reference or any number of immutable references」 | https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html | 编译器把门数变成可检查的，但它管的是**每个值**的独占，不是**跨若干值的一条不变量**——后者正是门表还要做的事 |
| 为什么知道全部写入口才谈得上推理？ | Rust nomicon：`&mut` 不允许被别名，编译器才能推断谁可能写过这块内存 | https://doc.rust-lang.org/nomicon/aliasing.html | 同一件事的「为什么值得」版本 |
| Elm 的单一 update 门算不算前例？ | 官方 guide 里 Model = 应用状态、Update = 按消息更新状态的唯一方式 | https://guide.elm-lang.org/architecture/ | 支持「由构造保证只有一扇写门」。诚实的保留：该页**没有**逐字说 update 是唯一变更处，这条性质来自语言而非该文；Elm 根本不需要事后审计 |
| 「在哪一层介入」有没有既有概念？ | Feathers 的 seam：「a place where you can alter behavior in your program without editing in that place」 | https://www.informit.com/articles/article.aspx?p=359417&seqNum=2 | 命名前例。seam 是为可测试性挑的；数门挑的是**支配全部写者的那一个** |
| 门多了会长成什么病？ | Shotgun Surgery：「Making any modifications requires that you make many small changes to many different classes」 | https://refactoring.guru/smells/shotgun-surgery | 高门数预示的**症状**。气味目录是事后诊断，数门是动手前量一次 |
| 修完之后该长成什么形状？ | 沙漏模型的「narrow waist」：单一、被广泛采用的跨越层充当唯一公共接口 | https://en.wikipedia.org/wiki/Hourglass_model | 目标形状的命名前例：数完门之后要**建**的那道腰 |
| Claude Code / Codex 仓库里有没有「先数调用点」的纪律？ | **负面结论**。Claude Code 最佳实践讲「Explore first, then plan, then code」「Address root causes, not symptoms」，但没有「动手前枚举共享状态的调用点」这一条：https://code.claude.com/docs/en/best-practices ；OpenAI codex 的 `AGENTS.md` 有相邻但不同的条款（「leverage existing abstractions rather than plumbing code through multiple levels」、把测试与文档搬到实现旁边「so the invariants stay close to the code that owns them」），点名了 invariant ownership，没有点名调用点枚举：https://raw.githubusercontent.com/openai/codex/main/AGENTS.md | 两家都到「找根因 / 不要重复抽象」为止，**没有把「先数门」写成一条可执行纪律**。这也解释了为什么单个修复工人不会自己去数：他的手册里没有这一步 |

结论：**用已有概念命名（single writer / narrow waist / seam），自研执行体**。
没有现成工具能回答「这份状态在我们仓里有几扇门」——Kythe 级索引我们没有，dependency-cruiser 只看模块依赖不看符号入口，
而 `typescript` 已经是仓内依赖（`check:vocabularies` 就用它扫 AST）。所以数门脚本走 TS compiler API，**不引新依赖**（R20 / R29）。

## 3. 范围与不动项

**动**：`scripts/root-cause-contracts.mjs`（加 `doors` / `door_reduction` 校验）、`scripts/check-root-cause-contracts.mjs`（为门表读文件内容）、
`scripts/new-root-cause-contract.mjs`（骨架加两个字段）、新增 `scripts/door-map.mjs` / `door-map-lib.mjs` / `check-door-map.mjs` 与测试、
`package.json`（`check:door-map` 进 contracts 组）、`.github/workflows/quality-gate.yml`（注入 `DOOR_MAP_PR_BODY`）、
`docs/engineering-rules.md`（R21.3 / R27）、`CLAUDE.md`（P2 一句）、`AGENTS.md`（`gen:agents` 同步）、
`.agents/skills/root-cause-remediation/SKILL.md`（流程加「数门」一步）、`docs/lessons/count-the-doors-before-fixing.md`。

**不动**：存量 400 份合同（日期棘轮，不追溯）、`check:symptom-cluster` 的判据（它管「第三份合同」这个信号，和门表正交）、
生产代码（本次不改 `src/` 与 `electron/` 任何一行）。

## 4. 回滚

单 PR、纯规则与门岗层。回滚 = revert 该 PR：`doors` 字段变成无人校验的额外键（旧 validator 忽略未知键），
`check:door-map` 从 gates 链摘除由 `check:gates-chain` 当场核对，不会留下半装状态。

## 5. 验收门

- `pnpm run check:door-map`：判据测试 10 条全绿，含三个真实案例的门数回归（数不出已知的门即红）。
- `pnpm run check:root-cause-contracts`：门表缺失 / path:line 解析不到 / 改了门表外的生产文件 / `after ≠ doors.length` / `≥2 扇没减又不写 `why_not`` —— 五种情况各有一条必红用例。
- `pnpm run gates` 全绿。
- 本 PR 自己带一份 schema v3 合同并填满门表（dogfood：规则第一次生效就用在它自己身上）。
