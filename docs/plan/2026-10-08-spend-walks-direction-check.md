# 方向检查：花钱走查的像素尺寸参数可见性

## 0. 一句话根因

付费卡把“清晰度 / 输出尺寸”是否属于逐项可见的主参数交给 `parameterControlRole`，但 10 月 5 日的比例别名修复把非比例 `size` 直接变成 `null`；因此真正影响报价的像素尺寸被 `InlineParameterBar` 收进齿轮菜单，花钱前无法逐项核对。

## 1. 归类表：bug → 直接原因 → 类别

| 提交 / bug | 直接原因 | 类别 |
|---|---|---|
| `agent-spend-card.walk.mjs`：找不到“尺寸” chip | `a16564746` 为修复 Agnes 的比例去重，让非比例 `size` 的 `parameterControlRole` 返回 `null`；`splitPrimaryParameterControls` 只露出有角色的控件 | 同一参数语义在去重和付费卡可见性之间分裂 |
| `agent-spend-confirm-executes.walk.mjs` | 当前 main 在 GPT Image 2 的 `aspect_ratio` / `resolution` 档案上通过，不能把它当作本次同一症状 | 不受影响 |
| `agent-spend-stop-midway.walk.mjs` | 当前 main 已通过停止闭环；没有新的生产症状 | 不受影响 |

## 2. 为什么这类问题会反复出现

`size` 是供应商适配层的多义键：有的档案用它表达比例，有的用它表达 1K/2K，有的用它表达像素尺寸。去重边界已经按选项判断“是不是比例”，但主参数 chip 的角色边界仍只覆盖比例、时长、清晰度的显式别名，导致同一个档案参数在“能否去重”和“花钱前能否看见”两条规则中得到不同答案。

### 三条体验铁律

| 铁律 | 类根因要回答的问题 | 最小证据 |
|---|---|---|
| 说的 = 摆的 | 卡上说要生成的尺寸是否和卡上可以直接改的尺寸一致？ | 走查截图 + `primaryParameterChips.test.ts` |
| 能选到 | 模型档案声明的像素尺寸是否在 Agent 付费卡、画布节点和共享面板都能找到？ | `parameterControlModel.test.ts`、`primaryParameterChips.test.ts` |
| 点了 = 以为的 | 点尺寸 chip 后是否只修改卡面草稿，报价和提交仍走既有 owner？ | `agent-spend-card.walk.mjs` 的卡面编辑与无请求断言 |

## 3. 不改结构会出现什么

| 预测 | 验证 |
|---|---|
| 任何使用像素 `size` 的新供应商都会把影响价格的尺寸藏在齿轮里 | 用真实模型档案夹具跑 `splitPrimaryParameterControls`，并执行 `agent-spend-card.walk.mjs` |
| 只有比例键的修复会继续造成“去重正确、可见性错误”的两套语义 | 对照 `parameterEquivalentKeys` 与 `parameterControlRole` 的类级测试 |

## 4. 闸子独立性

当前没有第二条验收线；走查由本实现线运行，只能作为原始复现证据，不能在合并前充当独立验收收据。

## 5. P0：是否是我们独有的

是。供应商参数键到 Nomi 用户语义角色的映射属于 Nomi 的模型档案领域；`optionsAreAspectRatios` 仍复用现有共享判据，不引入通用库。

## 6. 选项对比与推荐

| 选项 | 做什么 | 代价 | 风险 | 建议 |
|---|---|---|---|---|
| 接入现成方案 | 不适用：没有通用库知道 Nomi 的供应商参数语义 | — | 仍会漏掉像素尺寸 | 不推荐 |
| 补 | 在 `parameterControlRole` 这个唯一角色边界中，把“非比例的尺寸别名”归为 `resolution`；去重继续只按选项判断比例 | 一个共享判据 + 类级测试 | 需要覆盖尺寸档、像素串、比例串 | **推荐，待拍板** |
| 重写 | 给每个 `ModelParameterControl` 增加显式 `role` 并迁移全部档案 | 迁移所有档案，范围大 | 交付面扩大，易引入旧数据兼容问题 | 不推荐 |
| 删 | 删除主参数 chip，让所有参数进齿轮 | 改动小 | 直接违反花钱前逐项核对 | 禁止 |

## 7. 用户要权衡的核心

在保持 10 月 5 日“按选项判断比例”的修复前提下，把非比例尺寸归入“清晰度”角色，能让用户在花钱前直接核对尺寸；代价是这条角色边界要承担所有尺寸别名，而不是继续把 `size` 当成“未知参数”。

## 特征测试清单（已先钉住）

- `src/workbench/generationCanvas/nodes/primaryParameterChips.test.ts`：像素 `size` 必须进入主参数列表；当前在未改生产代码时为红，作为待拍板的现状钉子。
- 原始复现：`node tests/ux/agent-spend-card.walk.mjs`；失败于“付款卡真实尺寸参数”不可见，截图为 `.tmp/pi-spend-card-development-1791430821657/FAIL.png`。
- 对照绿证：`node tests/ux/agent-spend-confirm-executes.walk.mjs`、`node tests/ux/agent-spend-stop-midway.walk.mjs` 均通过。


## 协调会话批准（2026-10-08）

选「补」：在 `parameterControlRole` 这一个角色边界里把非比例的尺寸别名归为 `resolution`，去重仍只按选项判断比例。理由：付费卡逐项核对是花钱前唯一的确认点，像素尺寸直接影响报价，必须是主参数；角色判据只有一处，不给每个档案加字段（重写范围大且有旧数据兼容风险）。这是第 4 次碰 `parameterControlModel.ts`，所以要求同时补「每个模型档案里每个影响报价的参数都在主参数里」的类级测试（遍历真实档案登记），而不是只钉像素 size 一种形状。

## 返工 F-spendwalks6（2026-10-08）：Linux 红的真根因 + 报价 chip 换行

### A. Linux CI run 37795697410 两条付费走查红

| 层 | 内容 | 证据 |
|---|---|---|
| 症状 | `agent-spend-confirm-executes`：付费卡上找不到 `[data-parameter-chip="resolution"]`（element not found）；`agent-spend-stop-midway`：停下提示说「发出了 3 张，剩下 3 张」，宿主批下的不是 3。Windows 本机两条都绿。三次 CI（366b14c35、9f2e62b1e、5ba56857f）同样红。 | CI 的 `spend-walk-evidence` 日志；feel 记录里 FAIL 那一刻右上角挂着「Agent 为这张卡选的模型「gpt-image-2」（apimart）当前不可用」提示（x=965, w=260, h=72），画布节点模型位写着「选择模型」 |
| 直接原因 | 夹具在 Linux 上用 Chromium basic 合成后端加密 apimart 占位 key（`_encryptFixtureKey.cjs` 的 `setUsePlainTextEncryption`），但 `createRuntimeWalk` 起被测 App 时**没开** `syntheticCredentialStorage`。Linux CI 没有钥匙串，App 解不开这把 key → 渲染层把模型判成 `credential_locked` → 卡上模型未解析、一颗参数 chip 都没有；主进程的生成路走 `NOMI_E2E_FIXTURE_API_KEY`，照样能出图，所以只有看渲染层的断言红。Windows 的 DPAPI 不分后端，所以 Windows 绿。 | 本机复现：把夹具写进 catalog 的那把 key 换成解不开的密文，`agent-spend-confirm-executes` 红在同一行、同一句错误、同一个提示框（同坐标同尺寸）；旧版（712ff9ba7^）`agent-spend-stop-midway` 红得逐字一样：`sent 3 / notSent 3 / "发出了 3 张，剩下 3 张没发。"`、`textRequests 9`、`imageRequests 16`、同一行号 |
| 类根因 | 「凭据用哪个后端加密」和「App 用哪个后端起」是两个文件各自决定的：夹具决定前者，每个启动方自己决定后者。`core-smoke` 记得传，`createRuntimeWalk`（全部 apimart / higgsfield 付费走查）和 `storyboard-first-frame-false-alarms.walk.mjs` 没传。旧门岗（`_launchApp.test.mjs` 的文本扫描）只认 `upsertVendorApiKey`，看不见夹具这条 `enc: 'safeStorage'` 路。 | `grep syntheticCredentialStorage tests/ux/agent-runtime-walk-support.mjs` 无结果 |

修法（结构）：`launchNomiApp` 不再让调用方各自记——没显式声明时，由隔离 settings 里那份 catalog 推出来：有 `enc: 'safeStorage'` 的凭据就开合成后端（`isolatedCatalogHasSafeStorageCredentials`）。显式 `false`（core-smoke 的 profile-copy，连的是用户真实钥匙串）仍然优先。之后任何写了加密夹具凭据的隔离走查都不可能再忘。

对 Codex 712ff9ba7 的判断：它把两条红归因成「Linux 字体更宽导致量少了」和「走查取数太早」，两条都不是本次 Linux 红的原因。`planParameterChips` 无视测量那半是对的方向（见 B），`overflow-x-auto` 违反合同已撤；`agent-spend-stop-midway.walk.mjs` 的改动按任务书没动，它没有削弱等式断言，但它要修的「竞态」在 Linux 上的真实来源是 key 解不开——建议 CI 绿后由协调会话决定是否回退到原断言。

### B. 付费卡报价 chip：量宽退位 → 放不下换行

| 层 | 内容 | 证据 |
|---|---|---|
| 症状 | Seedance 2.0（带变体）在生产宽 390 的付费卡里，「16:9」压在变体「标准」上；英文压到 300 时变体伸出卡外、三颗报价 chip 全退进 ⚙。712ff9ba7 改成横向滚动后 chip 仍在 DOM 里，但要滚才看得见。 | 设计实验室 `v4-panel-spend-seedance*` 四格 + `design-lab-ask-card-in-panel.walk.mjs` 无头量几何：712ff9ba7^ 红（相压 / 伸出卡外 / 报价参数没摆在底栏上 / 300 仍一行），712ff9ba7 红（overflow-x: auto，且相压仍在） |
| 直接原因 | `useFittedChipCount` 用 scrollWidth 对比 clientWidth 决定摆几颗；身份行（模型 + 变体）是一个 `min-w-0` 的 flex 项，它被压窄时里面不缩的变体溢出去压住下一颗，可行本身不报溢出，于是量成「装得下」。真报溢出时 `planParameterChips` 从尾巴把报价参数退进 ⚙。 | 同上 |
| 类根因 | 用户付钱前要核对的值，看不看得见取决于一次运行时测量；测量有盲区（收缩的包装、字体、首帧宽度），而测量的两个出口（退位 / 滚动）都会把值藏起来。 | — |

修法（删 > 结构）：删 `useFittedChipCount.ts` 与 `planParameterChips`；chips 横排改 `flex-wrap`，身份行在 chips 横排里用 `contents`，模型 / 变体 / 参数 chip 都是同一条可换行行的直接成员，放不下整颗换行。summary（画布节点、分镜行）一字未动。门岗：`InlineParameterBar.test.ts` 钉「chips 横排 flex-wrap、无 overflow、组件里没有量盒子的代码」，设计实验室走查量「两两不相交、整颗在卡里、不滚动、窄时真换行、Seedance 三颗报价 chip + 变体都在」。

要拍板的一点：Seedance 2.0 这类带变体的模型，在生产宽 390 下付费卡底栏会是两行。2026-09-10 v3 用户说过「参数摆得不齐、还上下两行」要一行；今天的合同选了「换行」而不是「藏」。Kling 这类不带变体的模型仍是一行（实验室实测 rows=1）。
