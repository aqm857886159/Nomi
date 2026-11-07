# 设计卡：参考卡（定妆卡）发出去的字 = 框里的字（逃逸账本 USER-20261029-prompt-outbound-not-box，第 ① 处）

改动名：参考卡提示词不再因为有结构化特征就丢掉描述　线：I-style-verbatim　类别：[花钱][其他]（不碰界面元素；③ 只出方案不改）

### 功能分类
- [ ] 新界面 / 改交互
- [x] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [x] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能

## 先查别人（★0）

- 微软 Azure OpenAI 文档「prompt transformation」(https://learn.microsoft.com/en-au/Azure/foundry/openai/concepts/prompt-transformation) · 图像模型会把用户提示词改写后再生成，只在响应的 `revised_prompt` 字段里事后告知，且不能关 · 确认了「发出去的 ≠ 用户写的」会让人失去对画风的控制，所以我们这边不能再自己加一层看不见的改写；决定：出站只认框里的字。
- OpenAI 开发者论坛「DALL-E 3 changes my original prompt without my permission」(https://community.openai.com/t/api-image-generation-in-dall-e-3-changes-my-original-prompt-without-my-permission/476355) · 用户抱怨提示词被悄悄改，加一句「不要改」也无效，官方答复是为安全和补细节 · 确认了：悄悄改写是真实用户反感点；决定：我们自己加的字必须出现在框里或可见引用上，用户能删。
- 本仓 `docs/fixes/2026-09-30-storyboard-outbound-owner.root-cause.json` 与 `src/workbench/creation/storyboard/exec/shotOutbound.parity.test.ts` · 镜头行已经收成「发出去 = 行上写的 + 行上看得见的参考图」一个函数加对等测试 · 改了范围：同一条原则当时只守了镜头行，参考卡（`buildAnchorSheetPrompt`）没纳入，这一轮把参考卡补进同一类的契约测试。
- 本仓 `electron/shared/storyboard/storyboardPromptCompiler.ts:50-60`（修前）· 有 static / dynamic 就只发这两个字段、不发 description · 改了决定：description（框里那段）永远是正文。

## ★1 用户怎么用

- 当创作者在创作区或画布上看着一张参考卡（定妆卡 / 场景卡 / 道具卡）的描述框，我想让生成的图照着框里写的字（包括「写实摄影」「动漫」这类风格词）来，以便不用猜为什么出了没要的画风。
- 步骤：Agent 起草分镜方案，参考卡 description 里写了风格，同时带结构化的身份特征 → 落到画布 → 用户点生成（或在创作区改描述后点重生成）→ 发出去的提示词里有 description 原文。
- 不做什么 / 已知坑：本轮只修 ①；③（构图参考时请求上追加的写实要求）只出方案；其余 ②④⑤⑥⑦ 登记成已知例外不修；参考卡模板外壳（版面、视图、Variants 行）仍是固定外壳，登记为已知例外；结构化特征 static/dynamic 不再进提示词（它们是 description 的细化，仍留在节点 meta 里供身份轴 / 冻结门用），只有 description 为空的旧数据才退回用它们。
- 真实任务：①Agent 起草「叶秋」定妆卡，description 含「真人写实，古装」+ 带 staticFeatures；②创作区把 description 改成另一种风格后重生成，提示词随之变；③旧项目里 description 为空、只有 static 的卡，升级后仍照旧发出。
- 指标（量具）：主指标——定妆卡出站提示词包含 description 原文的比例，目标 100%（量具：`src/workbench/creation/storyboard/exec/outboundContract.test.ts` 的入口 × 形状矩阵）；质量指标——同一输入改前 / 改后各生一张的画风对照，量具 `tests/ux/anchor-outbound-real.paid.mjs`（协调跑一次，未验证前不下结论）；护栏——旧数据（description 空）发出的字与升级前逐字相同（同一个矩阵里的旧数据行）。
- 老用户（★1c）：已落到画布的参考卡 node.prompt 不动（升级不重写）；只有在创作区改描述 / 点重生成时才按新规则重编，那时提示词里多出 description、少了「身份特征 / 服装与状态」两行；description 空的旧卡行为不变。退回上一版仍能打开（数据形状没变）。

## ★2 谁说了算

- 概念：「参考卡出站提示词」唯一 owner 是 `electron/shared/storyboard/storyboardPromptCompiler.ts` 的 `buildAnchorSheetPrompt`；消费者 `storyboardPlan.ts`（落画布）与 `storyboardRowActions.ts`（重生成同步）。证据：`node scripts/door-map.mjs buildAnchorSheetPrompt` → 2 扇写入口，0 读入口。
- 同一份事实存几份：框里的字存在 anchor.description（创作区）与 node.prompt（画布）两处，由 syncAnchorNodeWithCard 单向同步（已有，不新增）。
- 没有靠「东西不见了」猜意图。

## ★3 一致与复用

- 以前定过：2026-09-30「一镜发出去 = 行上写的 + 行上看得见的参考图」，还算数；参考卡当时没被纳入，是漏口，不是反对。
- 三条路：沿原方向修（description 优先，static/dynamic 仍追加）——保留了框里看不到的字，违背原则，不选；换做法（description 作正文，static/dynamic 退出提示词）——选；删掉 static/dynamic 字段——它们还供冻结门使用，不删。
- 复用：不新增产品文件，改 `anchorIdentityBody` 一个函数；契约测试新增一个文件覆盖入口矩阵。证据：`pnpm run check:self-written`。

## ★4 全状态

- 空：description 空且无 static/dynamic——模板里该处为空（行为不变）。成功：提示词含 description。失败 / 取消中 / 过期 / 能力不可用：不新增，沿用生成链既有处理。旧数据：description 空而有 static/dynamic——退回旧写法（与升级前逐字相同）。
- 文案：不新增界面文案；`check:i18n` 无变化。

## ★9 验收与回滚

**验收清单（动手前写，实现线按它自验，验收线只核它）**

| # | 检查 | 命令 / 位置 |
|---|---|---|
| 1 | 入口 × 形状矩阵：每个「框里的字编成请求」的入口，发出去的 = 框里的字 + 可见引用；例外表里每条带逃逸账本条目 id 与序号 | `pnpm exec vitest run src/workbench/creation/storyboard/exec/outboundContract.test.ts` |
| 2 | 三类参考卡（角色 / 场景 / 道具）× 字段组合（仅 description / 加 static / 加 dynamic / 加两者 / description 空仅 static）：出站含 description 原文 | 同上 |
| 3 | 创作区改 description → 重生成同步到 node.prompt 后，出站随之变（修前不变） | 同上 + `storyboardPlan.test.ts` |
| 4 | 旧项目数据：description 空、只有 static / dynamic 的卡，出站与升级前逐字相同 | 同上（旧数据行） |
| 5 | 变异：把 `anchorIdentityBody` 改回「有 static 就丢 description」，矩阵里至少若干条变红 | 实现线在报告贴红的条数 |
| 6 | 例外表闭合：矩阵里每个例外都带逃逸账本条目 id 与序号；新增例外没登记就红 | 同上 |
| 7 | 既有对等测试不退步 | `pnpm exec vitest run src/workbench/creation/storyboard/exec/shotOutbound.parity.test.ts src/workbench/generationCanvas/agent/storyboardPlan.test.ts` |
| 8 | 付费走查免费演练过，产物带修复标记；演练和真付费都走用户 10-29 那条路：创作区打开分镜方案 → 点参考卡「生成参考卡「叶秋」」（`StoryboardPlanEditor` → `generateAnchorCard` 建卡）→ 读发往供应商的请求；真付费由协调跑一次（同输入改前 / 改后各一张） | `node tests/ux/anchor-outbound-real.rehearsal.walk.mjs` / 付费档由协调 |

**反例（这一类会从哪回来）**

- 另一个入口：有人在 `syncAnchorNodeWithCard` 或批量路径里另拼一份参考卡提示词 → 矩阵里「重生成同步」「落画布」两个入口逐字比对会红。
- 另一种卡类型：新增第四种可出图的锚类型，模板里忘了 description → 矩阵遍历可出图种类，新类型不在表里就红。
- 旧项目数据：description 空 / 仅空白、static 含空白行 → 矩阵旧数据行。
- 另一个供应商：本改动只在编译层，不碰供应商适配；⑦ 供应商适配 trim 登记为例外。
- 有人再在构建请求处追加后缀 → 矩阵 `buildCatalogTaskRequest` 一行，没登记的追加会红。

**回滚**：revert 本 PR 的修复提交即可，数据形状没变，已落画布的卡不受影响。

**真实场景复现**：用户 10-29 在创作区一路生成叶秋定妆卡，出了插画风、提示词里看不到风格词。我这边走同一条界面路径：往隔离资料里预埋一份分镜方案（角色参考卡 description 含「写实电影质感、35mm 胶片颗粒、不要插画风」，另带 staticFeatures / dynamicFeatures，形状照 Agent 起草落盘后的样子）→ 真人手势开项目、进创作区、打开方案、展开参考卡区 → 点「生成参考卡「叶秋」」（zh / en 各截图）→ 只读供应商那头收到的请求。修前（merge-base 构建，`--expect-before`）请求里没有风格词，修后有。旧做法（把构建产物算出的提示词贴进图片节点的框再点生成）已删，它绕开了创作区的建卡那一步。
与用户那次还差在哪：①没有用户原项目，方案是预埋的固定形状，不是 Agent 当场起草（起草那一步没走，也就没证明 Agent 真会把风格写进 description，只证明「写进去了就会发出去」）；②预埋的卡直接指定了被授权的图片模型，没走用户那次的模型选择；③没有用户当时的最终出站请求，无法证明他那次的风格词就在 description 里；④生图结果的画风因果未验证，由协调的一次改前 / 改后对比付费走查补。

**独立验收**：本卡归花钱类，合并前另一条线独立验收（PR 正文 `## 独立验收` 写报告链接与线编号）。

## 其余格（花钱类 9 格全填）

- 5 中途表：不新增状态；生成链的中途打断沿用既有。不适用：本改动只改一个纯函数的输出。
- 6 外部数据与失败：无新增外部来源；供应商侧对提示词的二次改写（上文 ★0 两条）不在我们控制内，由「框里可见」兜底。
- 7 性能：不适用（纯字符串拼接，无新增用户操作）。
- 8 真实条件：Windows / 英文界面 / 最小窗口 / 真规模：unverified（编译层纯函数，无界面差异）；真付费：留给协调一次；干净安装：不适用。
- 拍板图清单：不适用（本轮不改界面）；③ 的两个方案图只作交用户拍板的材料，未进实现。

## ③ 用户拍板（2026-11-07）

用户选方案 1：带站位构图参考时把写实要求写进描述框，作为一行可删的字；老节点在升级时一次补进框；请求上偷偷追加的那条路整个删掉。本 PR 不做，由后续 PR 实现，并从出站例外表删掉这一项（例外总数随之减一）。
