# Nomi 外包任务卡（2026-10-05，在 Mac 上执行）

> 这些活适合交给别的 AI：费 token，但判断不多，做完能用命令验对错。
> 一次贴一张卡，每张卡都要连同下面的「通用规矩」一起贴。
> 卡之间没有先后依赖，可以并行（卡 2 的一部分要等 #1001 合入，卡里写了）。
> 做完只开 PR，**不合并**，把 PR 号发给协调会话，由它审核后合并。

---

## 通用规矩（每张卡都要带上）

1. 仓库：aqm857886159/Nomi（公开仓库）。在 Mac 上 clone 或更新到最新 `origin/main`，动手前先读根目录的 `CLAUDE.md`。
2. 每张卡单独开一个分支、单独一个工作目录。在仓库的同级目录建 worktree：
   `git fetch origin && git worktree add -b <分支名> ../Nomi-<卡名> origin/main`
   然后在新目录里跑 `pnpm install`。Node 版本以 `package.json` 的 `engines` 为准。
3. 不推送 main，不 force push，不改 `release/*`。只推自己的任务分支，然后开 PR。
4. **不许为了让检查变绿去改检查本身的判据**：不放宽阈值，不往基线里加豁免，不用 `--update-baseline`。基线只许往「变少」的方向改。
5. 提交类型照实写：修 bug 用 `fix`，清理用 `chore` 或 `refactor`，不要为了绕开门岗换类型。被「方向检查」拦下时，停下来告诉协调会话。
6. **以下区域别处正在改，不要碰**：
   - `electron/capabilityCore/mcp*`（MCP 要整体重做）
   - `electron/productionRun/`、`src/workbench/generationCanvas/runner/`、`src/workbench/generationCanvas/spend/`、`electron/capabilityCore/appIntegration*`（发动机收敛在改）
   - `src/workbench/generationCanvas/nodes/director/`（3D-BOX 在改）
   - `src/workbench/generationCanvas/quickActions/`，以及新加的 4 个效果目录：`skills/effect-multi-angle-grid`、`effect-next-moment`、`effect-prev-moment`、`effect-story-four-panel`（快捷动作在改）
   - `scripts/fix-churn.mjs`、`scripts/self-written*`、`scripts/check-direction-trailer.mjs`、`docs/engineering/rules.json`、`docs/engineering/self-written.json`、`docs/engineering/concept-owners.json`（规矩在改）
7. 不花钱：不调用任何真实的付费模型，不填任何 API key。
8. 公开仓库：提交信息和 PR 正文里，不写私有待办编号（T- 开头的），不写任何密钥。
9. PR 正文写四节：
   - `## 为什么`
   - `## 改了什么`
   - `## 设计卡`：**逐格写**，合并前扫描要求每格都有一行，不适用的写「不适用：理由」。格式：
     ```
     - ★1 用户怎么用：不适用：没有用户可见改动
     - ★2 谁说了算：……（这次改的东西由谁管，一处还是多处）
     - ★3 一致与复用：……（复用了什么现成的，没另写）
     - ★4 全状态：……（覆盖了哪些情况）
     - ★9 验收与回滚：验收 = 下面的命令和数字；回滚 = revert 本 PR
     ```
   - `## 测试`：贴上用的命令，以及改前、改后的数字或截图

---

## 卡 1（Mac 专属）：设计实验室的 darwin 视觉基线

**背景**：设计实验室的像素基线是在 macOS（darwin）上录的，Windows 和 Linux 录不了。`tests/ux/design-lab/calibration.json` 里有 4 个屏标着「基线待用户拍板」（`pendingApprovalScreens`）：`director-refine`、`node-composer-bar`、`primitives-menu`、`agent-panel-v4`。

**做法**：
1. 跑 `pnpm run check:design-lab`，记下 23 个已登记屏的结果：哪些通过、哪些有像素差、差多少。
2. **`director-refine` 已经用户拍板**（10-04 精修 A 样张定稿，PR #991 已合）：
   - 用 `pnpm run design-lab:update` 只录这一屏的基线。看脚本用法，有按屏参数就用；没有的话只提交这一屏的 PNG。
   - 再把它从 `pendingApprovalScreens` 里删掉。
3. **另外 3 屏还不能录**：给每屏出一张「接触表」，即这一屏所有状态的截图拼在一起，中英各一张。放到 PR 里给用户看，**不录基线、不改登记**，等用户在 PR 上说「可以」以后再录。
4. 第 1 步里有像素差的屏，逐个判断原因：是代码改了导致的（找出是哪个提交），还是渲染环境导致的。**一律只报告，不更新基线。**

**完成标准**：
- PR 里包含：`director-refine` 的新基线、更新后的 `calibration.json`、3 屏的接触表截图、23 屏的结果表。
- `pnpm run check:design-lab` 在 Mac 上是绿的。有像素差的屏只列出来，不改。

**分支名**：`chore/darwin-baselines`

---

## 卡 2（Mac 专属）：Windows 上跑不了的走查，在 Mac 上跑一遍

**背景**：一批走查脚本在 Windows 上因为盘符路径、`spawn npx` 等原因起不来，PR 里只能写「靠 CI」。Mac 能跑，要知道它们实际是红是绿。

**做法**：
1. 读 `docs/engineering/commands.md`，以及 `package.json` 里 walkthrough 相关的命令，弄清怎么跑单条走查。
2. 依次跑下面这些，每条跑 2 次：
   - `tests/ux/design-lab-*.walk.mjs`（全部）
   - 导演台和 3D-BOX 相关：名字里带 `director` 或 `3dbox` 的走查
   - **等 PR #1001 合入后再跑**：`image-grid-split-freeze`、`node-toolbar-one-row`，以及 `design-lab-node-quick-actions`
3. 做一张结果表：走查名、两次结果、失败时的报错原话、截图路径。
4. **只报告，不修产品代码。** 失败如果明显是脚本本身的环境问题（例如写死了 Windows 或 Linux 路径），可以修脚本，但不许改断言。

**完成标准**：PR 里有结果表和截图（可以只提交报告文档 `docs/evidence/2026-10-05-mac-walkthroughs/README.md`，外加修过的脚本）。

**分支名**：`chore/mac-walkthrough-run`

---

## 卡 3：lint 警告清零

**背景**：`pnpm run lint:ci` 现在有 78 条警告，上限是 79。

**做法**：
1. 跑 `pnpm run lint:ci`，把警告按规则分组统计。
2. 逐条修，**不改行为**：
   - 没用到的变量或 import，删掉；
   - 能收窄的类型，收窄；
   - hooks 的依赖数组按规则补齐。补之前先确认不会引起重复渲染或死循环，拿不准的就跳过，写进 PR。
3. 不许用 `eslint-disable`。确实只能禁用的，单独列出理由，交给协调会话决定。
4. 修完把上限降到新的数字（在 lint 配置或门岗脚本里找 79 这个数）。
5. 跑 `pnpm run typecheck`，以及改过的文件对应的 vitest，必须全绿。

**完成标准**：警告从 78 降到 0（降不到 0 就尽量少，并说明剩下的为什么修不了）；上限同步下调；typecheck 和相关测试全绿。

**分支名**：`chore/lint-warnings-zero`

---

## 卡 4：测试代码的类型错误清零

**背景**：`pnpm run typecheck` 里的测试类型门岗显示「存量 60 个（electron/ + evals/ + scripts/，棘轮只减不增）」。

**做法**：
1. 跑 `pnpm run typecheck`，把测试类型这一段的 60 个错误导出成清单：文件:行号，加上错误内容。
2. 逐个修**测试代码**：补类型、修好形状不对的 mock、去掉误用的 `any`。**不改产品代码。** 如果发现是产品代码的类型本身有错，记下来交给协调会话。
3. 通用规矩第 6 条列出的区域，里面的错误留着不动，并写进 PR。
4. 修完把棘轮基线（存着「60」的那个地方）降到新的数字。
5. 改过的测试文件全部跑一遍 vitest，必须仍然通过。

**完成标准**：存量从 60 降下来（目标：禁区以外的清零）；基线同步下调；改过的测试全绿。

**分支名**：`chore/test-types-debt`

---

## 卡 5：边界主人台账里「机器读不了」的 87 条

**背景**：`node scripts/check-boundary-owners.mjs` 最后一行是「声明 1470 条：… 待查 10 ｜ symbol 机器读不了 87」。根因合同 `docs/fixes/*.root-cause.json` 里声明了「谁负责守这条边界」，其中 87 条的 symbol 写的是人话，或者把几个符号写在一起，门岗没法核对它们还在不在，等于没人守。

**做法**：
1. 读 `scripts/boundary-owners.mjs`，弄清什么样的 symbol 写法机器读得懂，以及 `unreadable_symbols` 是怎么判出来的。
2. 导出这 87 条：合同文件、path、原来的 symbol 写法。
3. 逐条改成机器可读：
   - 一条写了多个符号的，按工具支持的格式拆开；
   - 写的是人话的，到代码里找到真正对应的函数名或类型名；
   - 实在找不到的，按台账规则记进 `retirements`（写清理由）或 `unverified`。
   **不许为了凑数乱填符号**，改后的每一条都要能在对应文件里 grep 到。
4. 改完跑 `node scripts/check-boundary-owners.mjs`：「机器读不了」的数字要明显下降，门禁仍然通过。

**完成标准**：PR 里有逐条对照表（原写法 → 新写法 → 在哪个文件哪一行能找到）；门禁通过。

**分支名**：`chore/boundary-owner-symbols`

---

## 卡 6：效果库提示词按「10 条写法」补强

**背景**：效果库在 `skills/effect-*/SKILL.md`，共 40 条，每条是一段给图片或视频模型的提示词模板，`{角色名}` 这类占位符会在发送前展开。很多条写得太松，模型容易跑偏，例如换了人、改了场景、格数不对。

**10 条写法**（每条效果都按这 10 条检查）：
1. **任务定性**：开头一句说清这是什么任务（例如「这是一张 3×3 机位联系表」）。
2. **只改 / 保持成对**：写了要改什么，就同时写要保持什么（人物外貌、服装、场景、光线）。
3. **输出规格写死**：格数、排列顺序、画幅比例写成具体数字。
4. **每格预分配**：宫格类逐格写清每格是什么。
5. **防字面化**：防止模型把说明文字画进图里（例如「不要在画面里出现文字和编号」）。
6. **参考图分工**：有多张参考图时，写清每张参考图负责什么。
7. **按场景换不变量**：人像保持脸和服装，场景保持构图和光线，按效果类型选。
8. **宫格附空白网格参考**：宫格类说明会附一张空白网格图作为版式参考。只写文案，不用生成图。
9. **数值翻成画面效果**：不写「焦距 85mm」这类参数，写成「背景虚化、人物从背景里分离出来」这类画面描述。
10. **模板在前，用户补充在后**：模板写完后留一句「以下是用户的补充：」的位置。

**本卡范围**（先做这些，做完有余力再做别的）：
- 23 条视频运镜类效果：补上「保持人物与场景不变」的不变量。
- 表情九宫格、宽屏分镜：把格数和顺序写死。
- 俯视构图：加上任务定性和防字面化。

**做法**：
1. 每条效果改之前，先读它的 `metadata.nomi.library.slots`（占位符声明）。**占位符的写法和名字一个都不许改**，它们会在发送前被替换。
2. 中文效果用中文写，英文效果用英文写，保持原文件的语言。
3. 通用规矩第 6 条里那 4 个新效果目录不要碰。
4. 跑 `pnpm run check:skills-format`、`node --test tests/agent-runtime/skill-catalog-migration.test.mts`（或 `pnpm run test:agent-runtime`，看仓库里实际叫什么），以及 `electron/promptLibrary/curatedPrompts.test.ts`。
5. 效果正文变了，官网数据会过期，要跑 `pnpm run build:site` 重新导出，并一起提交。

**完成标准**：
- PR 里每条效果都有一张对照表：改前 → 改后，以及这次补了 10 条里的哪几条。
- 检查全绿。
- 不需要真跑生成。协调会话会在之后的真实测试里抽几条真跑。

**分支名**：`chore/effect-prompts-10-rules`

---

## 卡 7：清理文档和注释里指向「已删除模块」的残留

**背景**：最近删掉了一批旧实现，但活文档和代码注释里还提着它们，新人读到会被误导。

已经删掉的：
- `spendDecisionWaiters.ts`
- `nomi:production-runs:pending-spend` 这个 IPC 通道
- 付费卡的 1.5 秒轮询（`POLL_INTERVAL_MS`）
- 画布侧的 `mintSpendGrant` 单节点用法
- `core.generateOnProject` 一族

**等 PR #1001 合入后**，还要加上：
- `NodeImageEditToolbar.tsx`
- 手写的 `ToolbarMenu`
- `connectionCreateKindsForSource`
- 旧的 `CropGridSize = 1|2|3`

**做法**：
1. 用 `git grep` 找出上面这些名字在 **活文档** 和 **代码注释** 里的出现位置。活文档指 `docs/ARCHITECTURE-NOW.md`、`docs/GLOSSARY.md`、`docs/engineering/` 下的说明文档、各模块的 README。
2. **历史文档不改**：`docs/plan/`、`docs/fixes/`、`docs/research/`、`docs/evidence/` 下的文件都是当时的记录，保持原样。
3. 活文档改成描述现在的实现。不知道现在是什么实现的，就写「已删除（见 PR #xxx）」，不要编。
4. 代码注释：如果只是顺带提到旧名字，就改成现在的名字或删掉；如果注释在解释「为什么不用旧做法」，保留。
5. 通用规矩第 6 条的禁区不碰。

**完成标准**：PR 里有一张清单（文件:行号 → 怎么改的）；`pnpm run typecheck` 和 `lint:ci` 仍然是绿的。

**分支名**：`chore/stale-references-cleanup`

---

## 交回来的时候

把 PR 号发给协调会话（Claude 这边）。它会：
- 看 diff，确认没有放宽判据、没有越界改禁区里的文件；
- CI 绿了就合；
- 有问题就在 PR 上留言，你那边接着改。
