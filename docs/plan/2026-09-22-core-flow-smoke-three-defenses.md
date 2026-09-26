# 核心流程冒烟：测试三道防线

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：实施中（分支 `test/core-smoke-defense-20260922`）。用户 2026-09-22 拍板四条，本文件逐条落地。

## 为什么要这三道防线

09-22 main 上出现三处故障：composer 不出现、「2 版」托盘打不开、编组框删不掉。当时 CI 全绿，测试一条都没报出来。
根因是 `data-dragging` 卡住：平移松手后 150ms 内点击，或者用滚轮平移，都会让它留在画布上。#836（`accc93b82`）已经修复。
测试没拦住，有四个原因：

1. 核心走查 `tests/ux/node-params-and-version-pill.walk.mjs` 没有进任何 CI 套件，写了等于没跑。
2. 分类器 `scripts/validation-policy.mjs` 只在改动 `src/workbench/generationCanvas` 时才开画布套件。但这次坏的是共享 CSS 开关，所以没触发。
3. 所有走查都在隔离的空 profile、空项目里跑。用户实际用的是滚轮平移档、窗口很小、Agent 面板开着、项目里有几十张卡，这些状态走查都没覆盖。
4. PR 合入后，没有人在 main 的 merge SHA 上确认核心流程还是好的。

对应三道防线：**①核心冒烟每次必跑**（原因 1 和 2），**②用真实状态夹具跑两遍**（原因 3），**③合入后立刻验 main**（原因 4）。

## 范围

| 件 | 落点 |
|---|---|
| 唯一场景清单 `CORE_SMOKE_SCENARIOS` + 夹具清单 + 依赖（needs）登记表 | `tests/ux/core-smoke/scenarios.mjs`（单一 owner） |
| 夹具：`empty` / `used`（CI）、`profile-copy`（仅本地） | `tests/ux/core-smoke/fixture.mjs` |
| 跑法：按「夹具 × 场景 × 用例」逐个起子进程，汇总写到 `outputs/core-smoke/<fixture>/summary.json` | `tests/ux/core-smoke/run.mjs`，命令为 `pnpm run test:core-smoke -- --fixture <empty\|used\|profile-copy>` |
| 两条走查改成从夹具开项目 | `tests/ux/node-params-and-version-pill.walk.mjs`、`tests/ux/canvas-drag-pan-gestures.walk.mjs` |
| 分类器新增 `coreSmoke` lane：只有纯文档改动才关，其他一律开，fail-closed | `scripts/validation-policy.mjs` 和它的单测 |
| CI 新增 job `core-smoke`（matrix: empty/used），**empty 纳入汇总判定，used 非阻断**（见下「2026-09-22 用户拍板」） | `.github/workflows/quality-gate.yml`、`scripts/check-quality-gate-workflow.node-test.mjs` |
| 合后收据要求**阻断档**的核心冒烟是 success（仅纯文档 merge 例外，并写明原因）；非阻断档抄结论不判 | `scripts/git-delivery.mjs` 和它的单测 |
| 流程纪律：上一个合入没有收据，就不合下一个 | `CLAUDE.md`（再跑 `gen:agents`）、`docs/release-process.md` |
| 真实素材登记：仓库内真实素材（公开仓库里已有的真 AI 镜头）登记为 `repoPath` 类素材 | `tests/ux/real-media-fixtures.json`、`tests/ux/fixtures/realMedia.mjs`、`scripts/check-real-media-fixture.mjs` |

## 不动项

- 生产代码原则上不动。唯一的例外是「用过的项目」夹具当场抓到的 ⌘Z 归属 bug（见下文「实测发现」#1），这项改动在 PR 里单独列出。
- 花钱路、Agent 契约、`src/workbench/ai/v4/**`、`electron/capabilityCore/*spend*` 等禁区不碰。花钱路的冒烟场景由「Draft PR 代码审查与整合」会话登记，本 PR 只提供框架和登记方式，**不写占位场景，也不写空跑就绿的桩**。
- `quality-gate.yml` 里对方会话要加的 2 行不碰。
- 现有 critical/full 画布套件、性能套件、合并规则的判据不改。拖动平移走查仍留在 critical/full 套件里，另外被冒烟清单引用。

## 设计取舍

### 前置状态怎么造：写 App 自己的项目文件，不灌 store

比较了三种造法：

| 方案 | 真实程度 | 代价 | 裁决 |
|---|---|---|---|
| 往 zustand store 里灌状态 | 绕过加载、迁移、规范化这些环节，灌进去的东西可能是 App 自己永远产不出的 | 低 | 否（用户明确禁止） |
| 全程用 UI 造：新建 20 多张卡，每张生成两三版 | 最真 | 多版本结果要走生成（真付费，或者 loopback 生成器还需要 apimart 身份）；每个 PR 跑两遍，要多花几分钟到十几分钟 | 否 |
| **写 App 自己持久化的 `.nomi/project.json`，然后从项目库卡片用 UI 打开** | 等于「用户打开昨天的项目」：加载、迁移、规范化、渲染走的都是真实路径 | 低 | **采用** |

补充说明：
- `used` 夹具的节点取自仓库里的真实用户项目快照 `tests/ux/fixtures/perf-heavy.project.json`，包括真实提示词、标题、多版本 history 和 meta。媒体 URL 统一改指到登记过的真实素材。编组、空编组框、时间轴 clip 按快照的数据形状补齐。
- UI 状态（时间轴展开、语言；滚轮平移档由场景自己声明）写进 App 自己的本机偏好 localStorage，也就是 `timelinePanelPrefs.ts` 用的那几个键，跟用户上一次关 App 时留下的一样。Agent 面板默认就是打开的。夹具打开项目后**用 UI 做前置断言**：时间轴确实展开、Agent 面板确实打开、窗口确实是 1280×800。任何一条不成立就红，不会假装已经处在「用过的项目」里。
- **被测的动作全部由真实鼠标、键盘、滚轮驱动。**

### 素材：CI 上没有 `NOMI_REAL_MEDIA_DIR`

用户拍板写的是「只用 `NOMI_REAL_MEDIA_DIR` 里登记过的真实素材」，同时要求 CI 每个 PR 都跑。可 CI 上没有那 1.38 GB 素材，而 `requireRealMediaAssets` 缺素材就会红（这个行为是对的，不许 skip）。两条要求放在一起，冒烟在 CI 上就会一直红。

处理方式：登记表新增一类 **`repoPath` 素材**，指向公开仓库里已有的真实 AI 镜头 `tests/ux/fixtures/real-shot-640x360.mp4`。它从 09-06 起就被 `editing-real-user-pass` 等走查当作真实素材使用。帧由它派生，派生规格同样登记。缺文件照样红，门岗 `check:real-media-fixture` 照样按身份扫描。

这是对拍板字面的**偏差**，已写进 PR 等用户确认。备选是把用户的 4K 私人素材放进公开仓库，因为有隐私问题，不采用。代价是冒烟测不到 4K HEVC 的解码成本。这不影响本次要守的「浮层可见、可点」，解码成本仍由性能那条腿负责（那条债另有登记）。

### 两遍夹具的含义

- `empty`：空白起点。节点参数走查只放场景自带的最少节点；拖动平移走查打开一个空项目，再自己用工具条建两张卡。
- `used`：在同一项目里先铺开「用过的」背景，再放场景自带的节点。背景包括 24 张真实卡（多版本、带连线）、2 个带成员的编组、1 个空编组框、时间轴 clip 并展开，窗口 1280×800，Agent 面板打开。
- `profile-copy`（仅本地，不进 CI）：用 `cp -R` 把用户真实的 userData 和项目根深拷贝到临时目录（不用硬链接），再把 `recent-workspaces.json` 里的路径改到拷贝上。只在拷贝上跑，跑完删除，原库零写入。项目用的是 `used` 夹具建进拷贝里的那份；拷贝提供的是用户真实的偏好（手势档、语言、目录、Agent 设置）。

### 分类器：冒烟只按「是不是纯文档」决定

`coreSmoke = !docsOnly`，没有其他降档路径。fail-closed 分支（空 diff、删除或改名、手动全量）同样开启。main push 用 `before..after` 分类，同一条规则。

CI 的汇总步骤：只有 `core_smoke=false` 且 `reason=docs_only` 时，才接受 `core-smoke` 为 skipped；其他情况一律要求 success。

### 合后收据

`delivery:verify-merged` 读取 merge SHA 相对 first parent 的 diff，用同一个分类器判断：

- 需要冒烟：`Core Flow Smoke (empty)` 和 `Core Flow Smoke (used)` 必须**恰好是 success**。skipped、neutral、缺失都拒绝，并说明原因。
- 纯文档 merge：不要求这两份 check，收据里写明 `coreSmoke: not-required (docs_only)`。

红了**不自动回滚**，由人决定修还是 revert。

## 2026-09-22 用户拍板：`used` 暂为非阻断

交工前按验收门 1 和 3 实测，结果分两半（全部原始数据见 [`docs/evidence/2026-09-22-core-smoke-negative-control/`](../evidence/2026-09-22-core-smoke-negative-control/)）：

- **验收门 1 成立**：把 `data-dragging` 的三个 owner 回退到 #836 之前，`empty` 与 `used` 都红 0/2，红的条目逐条对上用户报的三件事；`used` 还多抓到一条 `G6`（平移后接滚轮）。
- **验收门 3 不成立**：修复在位、生产代码逐字未变的前提下，`empty` 两种语言各 2/2，但 **`used` / zh-CN 连跑 5 次只有 1 次全绿**（1、1、2、0、1），`used` / en 两次都是 1/2。三种失败全部出自下面「实测发现」里已登记、本 PR 没修的小窗布局问题（T-CV-19 / T-CV-20 / T-QA-21），归因依据是 Playwright 报出的拦截者 DOM 原文。

**拍板**：先落防线，`used` 暂时非阻断。

- `empty`（zh-CN / en）是阻断门；`used` **照跑、照传证据、红了照样亮红给人看**，但不拉垮汇总判定，也不拦合后收据——收据里把它的结论抄下来（`coreSmoke.advisory`），看得见但不判。
- **升阻断的条件**：T-CV-19 / T-CV-20 / T-QA-21 三条布局 bug 修完，且 `used` **连跑 5 次全绿**。
- **怎么升**：只改 `scripts/validation-policy.mjs` 的 `CORE_SMOKE_BLOCKING_FIXTURES` 一处（把 `'used'` 加进去）。CI 的 `continue-on-error` 与合后收据都从它派生，三份门岗测试钉死这层派生关系——其中 `git-delivery.node-test.mjs` 有一条**故意写死名字**的用例，防止名单和测试一起漂而什么都证不到。
- 为什么不干脆让 `used` 一直红着当阻断门：一条 5 次绿 1 次的必过门，会让后续每个 PR 和每张合入收据都押在掷骰子上，红灯一旦不可信人就开始绕过它——那正是本方案要根除的东西。

- **2026-09-22 补：advisory 在注解卫生这一环漏了，已堵**。「非阻断」有**三条判定链路**要落地，当初只落了两条：① job 聚合（`continue-on-error` 只改 conclusion，`needs['core-smoke'].result` 照旧 success）、② 合后收据（`used` 不进 `requiredChecks`，记进 `coreSmoke.advisory`）都对了；③ Quality Gate 汇总 job 的第一行 `test "${{ steps.ci-hygiene.outcome }}" = "success"` 没人管——`scripts/ci-annotation-hygiene.mjs` 的 `delegatedOwner()` 只认三种情形，不认 advisory 格失败留下的 `##[error]Process completed with exit code 1.`，于是它落进 `unexpected`，汇总 job 红、收据出不来。main 上 merge ffffadc7d（#843）实测：16 annotations / 10 delegated / 0 allowed / **1 unexpected**。也就是说 `used` 实际**仍然阻断**，上面这条拍板当时并没有真的生效。**怎么堵的**：`delegatedOwner()` 新增一条规则，把非阻断冒烟格的 failure 注解委派给 T-QA-23；格子名从 `CORE_SMOKE_ADVISORY_CHECK_NAMES` 派生而**不写死**，所以升阻断那天它自动失效，阻断档 `Core Flow Smoke (empty)` 的逐字相同注解照旧是 `unexpected`。不判不等于看不见：报告多一个 `advisorySmoke` 子集、日志单列一行 `advisory-smoke: N`，`used` 红了仍然看得见——否则 T-QA-23 的「连跑 5 次全绿」没有观测面。根因合同：`docs/fixes/2026-09-22-advisory-check-still-blocked-via-annotation-hygiene.root-cause.json`。

跟进项：`docs/roadmap/TODO.md` 的 T-QA-23。

## 实测发现（「用过的项目」夹具第一次跑就抓到的）

| # | 现象（1280×800、时间轴展开、Agent 面板开着） | 性质 | 本 PR 的处理 |
|---|---|---|---|
| 1 | 在画布上删掉编组框后按 ⌘Z，什么都没回来。时间轴展开后它的 window 监听先注册，把 ⌘Z 吃成了时间轴撤销；去过一次预览页也一样，因为 keep-alive 的那条隐藏时间轴还在抢键 | **正确性 bug**，main 上用户实际会遇到 | **修了**：`src/workbench/shortcutSurface.ts` 统一归属规则——看不见的面不认领快捷键，同屏两面时归最近一次指针落下的那一面。根因合同见 `docs/fixes/2026-09-22-keyboard-shortcut-surface-ownership.root-cause.json`。改动在 PR 里单列 |
| 2 | 选中卡以后，浮框被小地图 / 画面小窗这类底部停靠物挤得放不下，按既定兜底 clamp 进视口，盖住卡本身和连线握把 | 小窗下的布局局限（`useComposerViewportPlacement.ts` 明写「放不下时宁可盖住节点一截」） | 没改产品。走查像人一样先收起画面小窗和地图，再去连线。记进 TODO |
| 3 | 画布只剩约 800 宽时，底部居中的批量生成栏压住左下角缩放条，「画布操作」帮助按钮点不到 | **布局 bug**：两个 bottom dock 在窄画布下相撞 | 没改产品。走查先点栏上的 × 收起它。记进 TODO |
| 4 | 卡上的模型是 apimart，隔离资料里没有 key，就挂出一条常驻警告 toast。它浮在弹层之上，压住设置弹窗的关闭钮 | 反馈层 z 序高于弹窗控件 | 没改产品。走查先点掉 toast。记进 TODO |
| 5 | 选中卡的浮框被 clamp 时，平移会让浮框每帧重新定位、每帧重排；空项目也有约 5 次 / 60 帧 | 性能观察，不是这次的回归 | 平移走查改成往画布中心平移，量的是平移本身；节点进出视野那几帧单独放行。记进 TODO |

对走查本身的修改（没有删除任何断言）：
- 判据只看这条走查自己建的两张卡和那条线，不再用「全画布第一张 / 全部卡」。
- 需要把卡放大时，先点「适应视图」，再在空白处滚轮放大。
- 建卡后的露出平移结束之后，才读平移前的基线。
- 回填证据截图改写到 `tests/ux/shots/canvas-drag-pan-gestures/<fixture>/evidence/`，不再改脏已跟踪的 `docs/plan/2026-09-11-triage-board-evidence/*.png`。
- runner 跑完会断言 `git status --porcelain` 前后不变；在 CI 上还要求工作树为空。

## 如何登记新场景（给后来的会话，照着做即可）

1. 写一条走查，放在 `tests/ux/<name>.walk.mjs`：
   - 开头调用 `const smoke = await launchCoreSmoke({ name, seed, needs: [...] })`（从 `tests/ux/core-smoke/fixture.mjs` 引入），再调用 `const win = await smoke.openProject()`，它会从项目库点开夹具项目，并进入生成画布。`seed` 是函数 `({ imageResult, imageMeta, frame, video }) => ({ nodes, groups, edges })`，只放这个场景自己需要的节点，素材由夹具从登记过的真实镜头里取。`needs` 必须和清单里写的一致，不一致就红。
   - 用 `smoke.win` / `smoke.app` 做真实 UI 操作，用 `smoke.needs.loopbackProvider` 这类句柄拿依赖；结束时调用 `await smoke.close()`。
   - 判据只看自己建的节点。`used` 夹具的画布上还有 24 张别的卡；夹具原有节点的 id 在 `smoke.project.record` 里。
   - 用例可以从 `smoke.caseId` 读（清单写了 `cases` 时，一次进程跑一例）。
   - 失败时 `process.exit(1)`，不许 `exit(0)` 逃生。
2. 在 `tests/ux/core-smoke/scenarios.mjs` 的 `CORE_SMOKE_SCENARIOS` 里加一行：
   ```js
   { id: 'spend-confirm', script: 'tests/ux/<name>.walk.mjs', needs: ['loopbackProvider', 'fixtureTextModel'], cases: ['confirm', 'cancel'] }
   ```
   两种夹具都会自动跑，没有逐场景跳过的开关。
3. `needs` 只能写 `CORE_SMOKE_NEEDS` 里已有的键。当前已有：
   - `loopbackProvider`：零额度的 loopback 供应商，即 `agent-runtime-fixture.mjs`；目录写进隔离 settings。
   - `fixtureTextModel`：依赖前者，并把 Agent 默认文本模型设成 fixture 文本模型。

   需要新依赖时，在 `CORE_SMOKE_NEEDS` 里加 provisioner，并补一条单测。写了未登记的依赖，runner 会在起进程**之前**报「缺依赖」而红，不会静默跳过。
4. 本地先跑 `pnpm run build && pnpm run test:core-smoke -- --fixture empty`，再跑 `--fixture used`，两遍都要绿。

## 回滚

不涉及数据迁移。回滚就是 revert 本 PR。回滚后有三处影响：分类器和 CI 的冒烟 lane 一起消失；`verify-merged` 回到只要求 `Quality Gate` 和 `Mac Package`；⌘Z 归属修复也随之撤掉（时间轴展开时画布 ⌘Z 失效会回来）。

## 验收门

1. **阳性对照：会红。** 本地临时回退 #836 的生产代码修复（不提交）后，`empty` 和 `used` 两遍冒烟都必须红，并记下哪几条红。
   → **已验，通过**：两遍各 0/2，证据 `docs/evidence/2026-09-22-core-smoke-negative-control/`。
2. **分类器阳性对照：** 一个只改共享 CSS（`src/styles/*.css`）或 `src/workbench/generation/*` 的 diff，`coreSmoke` 必须为 true，有单测钉住。纯文档 diff 为 false。
3. 修复还在时，两种夹具本地全绿；截图 zh-CN 和 en 都亲眼看过。
   → **部分**：`empty` zh-CN / en 各 2/2；`used` 5 次只绿 1 次，据此降为非阻断（见上「用户拍板」）。截图两种语言都看过。
4. CI 上 `Core Flow Smoke (empty)` 为 success（阻断档），`Core Flow Smoke (used)` 记录结论但不判，时长记录进 PR。
5. `check:quality-gate-workflow`、`check:real-media-fixture`、`check:git-delivery` 等 contracts 全过；`pnpm run gates` 过。

## 先查别人

- VS Code 每个构建都跑 smoke，并且 smoke 必须和被测版本同一版本（「You must always run the smoketest version that matches the release」）；fixture 把测试工作区拷进私有目录。出处：https://raw.githubusercontent.com/microsoft/vscode/main/test/smoke/README.md 。我们的做法对应：冒烟每个非文档 PR 都跑，夹具建在隔离目录；`profile-copy` 同样是「拷一份再跑」。
- Playwright 官方推荐用 setup project 加 `storageState` 预置状态，让测试「已处在登录后状态」起步，而不是每条测试都用 UI 再造一遍。出处：https://playwright.dev/docs/auth 。对应我们用 App 自己的持久化文件预置「用过的项目」，被测动作仍然走 UI。
- GitHub merge queue 保证每个 PR 在「最新目标分支 + 队列前序 PR」合成的状态上过 required checks，红的会被踢出队列。出处：https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue 。我们目前没开 merge queue，所以用「上一个合入没有收据就不合下一个」加 `verify-merged` 硬要求冒烟 success，补上「合后状态有人验」这一环。
- 仓内先例：场景清单单一 owner、跑法和日志沿用 `tests/ux/canvas-real-suite.mjs:12`（`CRITICAL_CANVAS_SCENARIOS`）以及 `runCanvasScenario`；合后收据的 required checks 在 `scripts/git-delivery.mjs:10`；loopback 零额度供应商在 `tests/ux/agent-runtime-fixture.mjs:152`；真实项目快照夹具在 `tests/ux/fixtures/canvas-performance-fixture.mjs:295`。
