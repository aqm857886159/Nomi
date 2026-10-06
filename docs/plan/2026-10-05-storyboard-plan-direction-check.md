# 方向检查：Agent 起草分镜方案（L-sbplan · 审计批 B6）

> 触发：`node scripts/fix-churn.mjs electron/capabilityCore/mcpGenerationTools.ts` → 近 14 天已有 9 个 fix，这一刀是第 10 个。
> 来源：逃逸账本 AUD-20261005-01（用户 10-05「分镜方案经常做错：建了好几个方案、数量不对，最后才合到一个」；审计 PR #1030）。
> 设计卡：`docs/plan/2026-10-05-storyboard-plan-single-owner.md`；根因合同：`docs/fixes/2026-10-05-storyboard-plan-single-owner.root-cause.json`。

### 0. 一句话根因

「方案里一行是谁、排第几」和「这次请求写到哪一份方案」都没有主人：手建方案有规矩（锚 `anchor-N`、镜号只数镜头），Agent 起草那条路按「锚和镜混排数组的位置」自己编号，而「往已有方案里补镜头」这扇门根本不存在。

### 1. 归类表：bug → 直接原因 → 类

`mcpGenerationTools.ts` 是生成规划的总入口，14 天 9 个 fix 分属不同概念，本次只有一类是这条线的：

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 820759673 比例在 draft_shots 上有了位置 | 比例键各家不同、模型猜错被吞 | 参数语义（⑩，已由 semanticAspectRatio 收口） |
| ef43d68ca 参考种类由素材决定 | 参考角色按调用方猜 | 参考完整性 |
| 3c7d59513 / 5d341dc63 / 5aa7d6e4d 结局未知、× 的终态 | 付费卡结局的状态机 | 花钱终态（花钱线的主人） |
| ee73ba0a4 只说显示名 | 回执带 id 不带名 | 回执措辞 |
| 03753fd27 / 59dd536bd 拆成镜头打开 / 自开回到主人 | 「谁发起」与「打开」不在一层 | 文稿方案落地的主人（09-30 已收） |
| 6a818f447 记了供应商的视频镜 | resolve 输入缺 modelVendor | 字段表对账 |
| **本次** 锚占镜号 / 改第 1 镜改到参考卡 / 同一请求多出一份方案 | `shotEnvelope` 兜底 `shot-${index+1}`、`storyboardPlanFromDraftSubjects` 的 `index+1`、`patchStoryboardSubject` 先找锚、回执叫模型「下一次再补」而宿主没有「补」的门 | **分镜主体身份与方案身份没有主人** |

文件热，是因为它是 9 个概念的共同装配点（P4 以来所有 capability 分支都在这一个 handler 里），不是同一个缺口反复冒。本类此前在这个文件上没有修过；同类的上一次是 09-22「只有参考卡的草稿不再拒」（那次放行了中间状态，却没补「补到同一份」的门，于是留下了今天的第三个症状）。

### 2. 为什么这一类会一直出现

编号与寻址是「顺手写的一行」：每个建方案的入口都要给新行一个 id 和镜号，最省事的写法就是用数组下标。手建编辑器、Agent 首建、剧本拟镜三处各写了一份，没有一处说了算，于是两种数法并存（手建只数镜头、Agent 锚和镜一起数）。「一次请求一份方案」更是没人拥有的事实：方案 id 在 handler 里铸，但 handler 不知道这是不是同一请求的第二次起草，模型面上也没有「补」这个形状，只能再建一份。

| 铁律 | 本类怎么落 | 证据 |
|---|---|---|
| ⑩ 说的=摆的 | 用户说「2 镜」→ 表上 2 行、行号 01、02；一次请求 → 一份方案 | 回环测试 `storyboardPlanSingleOwner.loopback.test.ts` AUD1 / AUD3（中英各一） |
| ⑪ 能选到 | 不适用：不涉及参数可选性 | — |
| ⑫ 点了=以为的 | 「改第 1 镜」→ 改到第 1 个镜头，不是参考卡 | 回环测试 AUD2 + 旧方案拒绝用例 |

结账挂的类检查：`electron/shared/storyboard/storyboardSubjectIdentity.test.ts`（类级：任何入口的发号、接行、寻址）+ 回环测试（报告的三个现象）；结构性预防是唯一 owner `storyboardSubjectIdentity.ts` 与文稿方案主人 `generationDocumentPlan.ts`，两者都已登记进 `concept-owners.json`（`storyboard.subject-identity` / `storyboard.plan-per-request`）。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 剧本自动拟镜（scriptText）出的方案同样锚占号 | `mcpGenerationTools.test.ts`「scriptText 拟出的锚与镜头各自编号」在旧代码上红 |
| 「再加两镜」只能新建一份：带 operationId 的多镜只改第一镜、其余静默丢 | `draftShotsProjection.test.ts` 补镜头用例 + `malformedJsonArgument.test.ts`「改一镜只改一镜」在旧代码上红 |
| 旧方案里「改第 1 镜」继续改到参考卡 | 回环测试「旧方案里锚占着 shot-1」在旧寻址（变异 M3）上红 |

### 4. 靶子独立性检查

- 靶子来自审计线 A-sb（PR #1030）的零额度回环轨迹与截图，不是本线写的；本线的回环测试逐字照它的三段脚本化大脑。
- 没有「修对了反而掉分」的先例：这条路没有评测分数，只有走查观察。
- 靶子本身核过：手建方案的规矩（`makeAnchorId`、`renumber`）就是「镜号只数镜头」，说明审计的期望与产品既有设计一致，不是新口径。

### 5. P0：这些是我们独有的吗？现成方案有哪些

镜号、参考卡、方案都是分镜领域本身（`self-written.json` 领域目录：`electron/shared/storyboard/`、`electron/capabilityCore/generation*`）。通用部分（schema 校验、序列化）照旧用 zod，不另写。没有可接入的库能决定「参考卡不占镜号」这种领域规则。

### 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 无对应的库或标准（领域规则） | — | — | 不适用 |
| 补 | 在三处现场各改编号、回执改一句 | 小 | 三处各写一份规矩，下一个入口再写第四份；「补到同一份」仍没有门 | 否 |
| 重写（限一个模块） | 新建唯一 owner `storyboardSubjectIdentity.ts`，三处现场与编辑器全部改调它；文稿方案落地抽成 `generationDocumentPlan.ts` 并拥有「一次请求一份」；加「补镜头」这一条正经的路（`extend`） | 中：动 14 个生产文件、模型面描述与两份基线 | 模型面 schema 预算只剩个位数（已压回 9990 ≤ 10000）；与 #1029 同改 `writeVerbs.ts` 要合并 | **是** |
| 删 | 删掉「只有参考卡的草稿」这条中间状态，逼模型一次写完 | 小 | 违背用户 09-21 点名放行；只能消掉症状一，二三还在 | 否 |

### 7. 用户要权衡的核心

同一次请求里，Agent 第二次起草默认补到同一份方案上（宿主保证），代价是用户真想在一句话里要两版时，必须明确说「另起一份」Agent 才会分开建——协调会话已按 D5 拍板这条默认。

## 特征测试清单（动结构前先锁住）

- `src/workbench/creation/storyboard/storyboardPlanSingleOwner.loopback.test.ts`：先在旧代码上跑红（12/12 红，三个现象逐条复现），再改结构。
- 现有行为锁照跑不改：`agentStoryboardDesign.test.ts`（指名替换、方案缺失拒绝）、`mcpGenerationTools.test.ts`（改一镜只改那一镜、未知 shotId 拒绝、文稿方案存进同一份 storyboardDesign）、`storyboardPlanEdits` 相关测试（手建加锚 / 删拖重排）。
- 变异记录：六处改回旧行为各自变红（见 PR 正文）。
