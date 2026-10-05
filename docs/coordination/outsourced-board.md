# 外包协作任务板（Mac 线）· 本 PR 永不合入

> 这是协调会话（Claude）和外包线（Mac 上的 AI）协作用的看板。**本 PR 永远不合入。**
> 真正的改动，每张卡单独开一个子 PR；讨论、审核、返工意见都写在**本 PR 的评论里**。

## 协作流程

1. **认领**：在本 PR 下评论「认领 卡N」。一次最多同时做 3 张。
2. **开子 PR**：每张卡从最新 `origin/main` 开一个分支、开一个子 PR。子 PR 正文第一行写「任务板 #<本 PR 号> 卡N」。
3. **交货**：在本 PR 下评论「卡N 交货：#<子 PR 号>」，附一句结论，再写清楚哪些没做完。
4. **审核**：协调会话在本 PR 下回一条「卡N 审核」，结论只有三种：
   - **通过**：协调会话来合子 PR；
   - **返工**：列出具体要改的点，改完在本 PR 下评论「卡N 已改：<提交号>」；
   - **收回**：这张卡不适合外包，协调会话自己做，子 PR 关掉。
5. **状态表**以协调会话更新的为准（见下）。

## 通用规矩（每张卡都适用）

1. 动手前先读根目录的 `CLAUDE.md`。每张卡单独用一个 worktree：`git fetch origin && git worktree add -b <分支名> ../Nomi-<卡名> origin/main`，然后 `pnpm install`。
2. 不推送 main，不 force push，不碰 `release/*`。只推自己的分支，只开子 PR，**不合并**。
3. **不许为了让检查变绿而改检查本身的判据**：不放宽阈值，不加豁免，不用 `--update-baseline`。基线只能往变少的方向改。
4. 提交类型照实写，`fix` 就是修 bug，`chore` / `refactor` 就是清理，不许为了绕过门岗换类型。被「方向检查」拦下时，停下来在本 PR 里说。
5. **禁区**（别处正在改，不要碰）：
   - `electron/capabilityCore/mcp*`（MCP 重做中）
   - `electron/productionRun/`、`src/workbench/generationCanvas/runner/`、`src/workbench/generationCanvas/spend/`、`electron/capabilityCore/appIntegration*`（发动机收敛 #1012）
   - `src/workbench/generationCanvas/nodes/director/`（3D-BOX #1002）
   - `scripts/fix-churn.mjs`、`scripts/self-written*`、`scripts/check-direction-trailer.mjs`、`docs/engineering/rules.json`、`docs/engineering/self-written.json`、`docs/engineering/concept-owners.json`（规矩改动中）
6. 不花钱：不调用任何付费模型，不填 API key。
7. 公开仓库：不写私有待办编号（T- 开头），不写任何密钥，日志里本机路径一律改成 `~`（不要出现 `/Users/<名字>`）。
8. 子 PR 正文四节：`## 为什么`、`## 改了什么`、`## 设计卡`、`## 测试`（命令 + 改前改后的数字或截图）。**设计卡要逐格写**，合并前扫描会逐格检查，不适用的写「不适用：理由」：
   ```
   - ★1 用户怎么用：……（没有用户可见改动就写「不适用：……」）
   - ★2 谁说了算：……
   - ★3 一致与复用：……
   - ★4 全状态：……
   - ★9 验收与回滚：验收 = 下面的命令和数字；回滚 = revert 本 PR
   ```

## 状态表

| 卡 | 内容 | 类型 | 状态 | 子 PR |
|---|---|---|---|---|
| 1 | Mac 设计实验室视觉基线（报告 + 接触表） | Mac 专属 | ✅ 通过，已合 | #1007 |
| 2 | Windows 跑不了的走查在 Mac 上跑一遍 | Mac 专属 | ✅ 通过，已合 | #1009 |
| 3 | lint 警告清零 | 机械 | 🔁 返工：上限设成实际的 10 | #1008 |
| 4 | 测试类型存量清零（60 → 10） | 机械 | ✅ 通过，已合 | #1010 |
| 5 | 边界主人 87 条改成机器可读 | 机械 | 🔁 返工：根因合同 schema 报 76 处不合法 | #1004 |
| 6 | 效果库提示词按 10 条写法补强 | 内容 | ✅ 内容通过；正文补设计卡格子后合 | #1005 |
| 7 | 清理已删模块的残留引用 | 机械 | ❌ 不合，已关 | #1006 |
| 8 | 4 条设计实验室走查在 Mac 上失败：查根因 | 调研 | ✅ 通过，排队合 | #1017 |
| 9 | director-refine `d3a-clip-zh` 渲染失败 + 34 处像素差归因 | 调研 | 已认领 | — |
| 10 | 导演 / 3D-BOX 走查在 Mac 上配好环境跑完 | Mac 专属 | 已认领（第一批交掉一张后开） | — |
| 11 | 6 条自写机制的「现成方案」事实收集 | 调研 | 已认领（第二批） | — |
| 12 | 起草 33 镜要 2 分钟：模型清单每镜重建 | 实现（有严格验收） | 已认领，先交探针 + 特征快照 | — |
| 13 | 文本改写是否一直被付费闸拦住：复现 | 调研 | 已认领（第二批） | — |
| 14 | 三条过期走查跟上现行源码（卡 8 结论） | 机械 | 待认领 | — |
| 15 | 参数条英文压字回归（卡 8 结论） | 实现（有严格验收） | 待认领 | — |
| 16 | 综合体验验收方案协调返工（PR #1018） | 治理文档 | 🔁 返工：三条铁律、逃逸账本、分档、设计卡归并、Phase 0 收小 | #1018 |

---

## 卡 1～7

完整卡面见 `docs/coordination/outsourced-cards-1-7.md`（与本文件同目录）。返工意见在本 PR 评论里。

## 卡 8（调研）：4 条设计实验室走查在 Mac 上失败，查根因

卡 2 的报告里，下面这 4 条在 Mac 上两次都失败：
- `design-lab-ask-card-in-panel`：英文 light/dark 的 spend 参数条里控件互相压住（例如 `Kling 3.0 → 16:9`）。
- `design-lab-catalog-liveness`：`expected one unlisted note`。
- `design-lab-node-composer-bar`：「现役 composer 卡应有 1 张，实际 0」，共 5 格。
- `design-lab-settings`：assisted-01～06 没有在 `EXPECTED_STATE` 里认领状态。

**只诊断，不改代码**。每条都要回答：
1. 在 Linux CI 上它是红还是绿？到 GitHub Actions 的 E2E 或设计实验室 job 日志里查。
2. 如果是在某个提交之后才开始红的，用 `git bisect` 找出这个提交，每一步都在 Mac 上跑。
3. 归类：产品界面真的坏了（比如英文压字）/ 走查脚本过期 / Mac 环境问题。
4. 给出修法建议，并说明会改到哪些文件、碰不碰禁区。

**交货**：在本 PR 评论里给一张表（走查 / 归类 / 引入提交 / 证据 / 修法），截图放进子 PR 的 `docs/evidence/2026-10-xx-mac-lab-failures/`，子 PR 只放证据。

## 卡 9（调研）：director-refine `d3a-clip-zh` 渲染失败 + 34 处像素差归因

卡 1 的报告里：
- `director-refine` 定向更新基线时，`d3a-clip-zh` 连续复现失败；
- 另外 7 屏共有 34 个状态出现像素差（process-feedback 14、storyboard 8、settings 4、settings-sound 3、depth-action 2、director-3dbox 2、canvas-frame 1）。

**只诊断**：
1. `d3a-clip-zh` 为什么渲染不出来？给出报错原文，找出引入提交。
2. 34 处像素差逐屏归因：是哪个提交改了界面（比对基线录制的日期和之后改过这些组件的提交），还是字体或渲染环境的差异。把「代码改了、需要用户重新拍板」和「环境噪音」两类分开列。
3. **不更新任何基线**。

## 卡 10（Mac 专属）：导演 / 3D-BOX 走查配好环境跑完

卡 2 里这批大多因为环境没配好而失败，或者没跑：缺 `NOMI_WALK_RENDERER_URL`、缺资源、Electron 环境异常等。

1. 读每个走查脚本的文件头和 `tests/ux/` 里的辅助脚本，弄清需要哪些环境变量和前置步骤（比如先起 renderer dev server、先 build）。
2. 把环境配好，每条跑 2 次：`director-*.walk.mjs`、`director-3dbox-*.walk.mjs`、`director-j1`～`j8`、`director-refine-tasks`。
3. 结果表格式同卡 2。失败的写出报错原文，归类为「环境 / 脚本 / 产品」。
4. 不改产品代码。只有当脚本里写死了别的平台的路径时，才允许改脚本，而且不许改断言。
5. 把「怎么在 Mac 上跑导演走查」写成一段说明，放进子 PR 的 README。

## 卡 11（调研）：6 条自写机制的「现成方案」事实收集

`docs/engineering/self-written.json` 里有 6 条还没下结论的自写机制：`validation-policy`、`network-stack`、`durable-json`、`logging-and-crash`、`gate-family`、`conversations-store`。

**你只收集事实，不下结论**，结论由协调会话来定。每条都要给出：
1. 今天的实现做了什么：列出文件:行号，以及登记的 paths 是否完整。
2. 至少 2 个现成方案。每个写清覆盖什么、不覆盖什么、当前版本号、出处链接。出处必须是官方文档或仓库，不凭记忆。
3. 近 30 天这些文件被 fix 改了几次（用 `git log` 统计）。
4. 换掉的话，工作量和风险大概有多大，写出你的依据。

**交货**：子 PR 只放一份报告 `docs/research/2026-10-xx-self-written-six-facts.md`。

## 卡 12（实现，有严格验收）：Agent 起草 33 镜要 2 分钟

诊断结论：起草是纯 CPU 活，每镜约 3～4 秒，耗时随镜头数线性增长。根因是 `electron/capabilityCore/liveGenerationRuntime.ts` 的 `registry.resolve` 每解析一镜就重读整份目录、重建整个模型清单。热点在：
- `derivePublishedExecution`（`electron/shared/modelPublication.ts`）
- `publishedModesFor`（`electron/capabilityCore/moduleCatalogBootstrap.ts:104`）

**做法**：
1. **先写性能探针和特征测试**：
   - 探针：起草 8 / 16 / 33 镜，记录耗时。
   - 特征测试：解析结果与改前逐字节一致。用同一份目录、同一批镜头，把改前的输出存成快照来比对。
2. 改成一次起草内共用一份清单快照。快照的生命周期只覆盖这一次起草，目录变了必须重新取，不能做全局缓存。
3. 先读 `CLAUDE.md` 的 P1 / P2，把根因修在最早的共享边界上，不在调用方各自加缓存。
4. 门岗：typecheck、lint、相关 vitest、`check:heavy-path`、`check:filesize`。

**验收标准**：33 镜起草从约 2 分钟降到 10 秒以内，解析结果快照逐字节一致。协调会话会另派验收线复核，验收没过不合。

## 卡 13（调研）：文本改写是否一直被付费闸拦住

发动机收敛的设计卡（#1012，`N13`）里怀疑：文本类的改写（例如让 Agent 改写一段提示词或文稿）可能一直被付费闸拒绝。

**只复现，不修**：
1. 读 #1012 的设计卡 N13 和相关代码，写出你认为会被拦住的调用路径（文件:行号）。
2. 用零额度夹具和全新临时资料目录，在 Mac 上实际复现一次。窗口不要弹到前台。
3. 给出结论：会拦 / 不会拦，附证据（日志、截图），并说明它影响哪些用户操作。

## 卡 14（机械）：三条过期走查跟上现行源码

依据是卡 8 的报告（#1017，`docs/evidence/2026-10-05-mac-lab-failures/README.md`）。**只改走查脚本或实验室夹具，不改产品代码，不放宽判据。**
1. `design-lab-catalog-liveness`：
   - 旁注的文案按现行 i18n 键或稳定的 data 标记来找，不要手抄中文。
   - 初始状态按现行合同来：unlisted 的模型保留用户原有的 enabled，不会被关掉。
   - 先断言「保持 enabled」，再测显式切换和删除。
2. `design-lab-settings`：`EXPECTED_STATE` 补上六个 assisted 格。最好让期望值和状态元数据从同一个注册源读，免得下次再漏。
3. `design-lab-node-composer-bar`：
   - 在截图或断言之前，等 composer 真的挂上（实验室登记 ready hold，或者等 locator）。
   - 不改生产代码里的延后挂载策略。
4. **验收**：这三条在 Mac 上各跑两次，全绿；把日志尾部贴进子 PR。改前改后 Linux 的 `check:walkthroughs` 都得是绿的。

## 卡 15（小实现，有严格验收）：参数条英文压字回归

依据同上。`70ebda21e` 修过一次；`d12adcce1` 合并时以为 #834 的规则已经覆盖，把修复撤了，结果外层包装照样被压缩。
1. **修在最早共享的那一层**：`InlineParameterBar.tsx` 里的 identityRow 外层包装，chips 横排时不缩。
2. **一条规则只放一处**：内外两层到底哪条多余，读清楚 #834 再定，多余的那条删掉，不要两层都留。正文里写清楚为什么留这一层。
3. **不碰**付费卡里的其他布局，不改任何断言。
4. **验收**：
   - Mac 上 `design-lab-ask-card-in-panel` 跑两次全绿；
   - zh、en 各给一组改前改后截图，放进子 PR 的 `docs/evidence/`；
   - 另外跑一遍画布浮条的相关走查，确认没有连带变化，列出跑了哪几条；
   - 门岗：typecheck、lint、相关 vitest、check:tokens。
5. 这是用户看得见的界面，但属于「恢复已经拍板过的样子」，不需要出新样张。截图对不上旧样子就停下来，在这里说。

## 卡 16（治理文档返工）：综合体验验收方案收小并补齐逃逸证据

关联 PR：#1018（`codex/comprehensive-experience-acceptance-20261005`）。本卡只改文档、设计卡模板、规则执行点和 `tests/ux/full-walk` 的账本 / 目录约定，**不改产品逻辑、不改既有门岗判据、不改 `CLAUDE.md`**。

协调审阅要求逐条落在以下交付物：

1. 类根因复盘和硬门规格补三条铁律：⑩「说的=摆的」（意图抽取期望与草稿参数确定性比对）、⑪「能选到」（模型档案参数清单自动生成并覆盖各入口）、⑫「点了=以为的」（`catalog.mjs` 的可点目标写用户预期与实际对照）。
2. `tests/ux/full-walk/escapeLedger.json` 有分类、对应铁律 / 用例、证据和 `completionCommits`；种子覆盖方案第 2 节七个问题与 2026-10-05 的「16:9 没传、断线误报、英文界面中文回答、删镜留空组」四项真实测试。
3. 分档只保留设计卡 ★1 / ★9 为普通 PR 要求；花钱 / 长跑 / 可打断 / 新界面跑中英文链，新界面加 AI 创作者任务；Agent 改动跑意图准确率，留出集 / pass@k / 单变量爬坡只归 Agent；发版前全套 + AI 创作者 + 逃逸报告。
4. 不新增指标卡或常驻规则；指标并入 `docs/engineering/design-card.md` 的 ★1 / ★9；删除方案第 7 节「没有指标卡不允许进入实现」；`CLAUDE.md` 不动；`rules.json` 只改 P3 / P5 enforcement。
5. AI 创作者规格写清一句 brief + 新手 / 老手人设、每步「预期 → 实际」、不一致先入候选账本后人工转正、图片只用最便宜模型并记录花费。
6. Phase 0 只做设计卡模板、逃逸账本（含种子）、catalog 预期列约定和三条铁律规格。

**验收**：检查 PR #1018 的文档 / 索引 / diff / preflight 证据；发现项在账本中保留候选状态，不能用补文案冒充产品修复。完成后在本 PR 回报：`卡16 已改：<提交号>`，并把相关提交同步到 PR #1018；不合并任一 PR。
