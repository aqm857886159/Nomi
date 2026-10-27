# 方向检查：走查仪器的外壳出口与静态门岗（2026-10-15）

触发：`node scripts/fix-churn.mjs scripts/check-walkthroughs.mjs` 命中自写登记 `gate-family`（under-review，近 30 天第 112 个 fix）。任务书（夜跑第一刀 N1）已预见本次要带 `Direction-Check:` trailer，这份即复盘；结构性结论交用户拍板。`tests/ux/_shell.mjs` 本身未命中热点。

### 0. 一句话根因

走查各自手抄「外壳在哪、怎么走到那里」，外壳一改就成片过期；缺的是三层——外壳可达操作没有**完整**的唯一出口、走查目录被 ESLint 整体忽略所以漏 import 看不见、旧字面量门岗只认有限几条。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 夜跑 S01–S09 共 42 条红（10-15） | 走查找旧侧栏 / 旧收起按钮 / 旧语言控件 / 旧文稿列表 | 出口覆盖不全（`openRailDrawer` 只准 `catalog`） |
| 夜跑 I05：clip-drop-zoom、clip-gesture-ownership、skill-library-specimen | 漏 import / 漏声明标识符，整条 0/3 红 | 走查目录没有静态检查 |
| 本次顺带查出的另外 3 个文件（canvas-image-aspect、core-a-old-project、evals/lib/judge.mjs 两处） | 同上；`captureExpectedLegacyTable` 在 b881d8ad0 已删但传参留着；judge.mjs 在错误信息里引用了不存在的 `text` | 同上 |
| #1136 → #1153 → #1197 | 每次外壳变动都要补一遍出口与门岗字面量 | 出口与门岗跟不上外壳 |

### 2. 为什么这一类会一直出现

走查是「一条一份、各自成篇」的文件，外壳位置抄在每份里；出口 `_shell.mjs` 只收了当时遇到的几处（回库、Agent 面板、模型入口、新建项目、画布底部），抽屉 / 设置 / 语言 / 工作区切换 / 文稿方案没收，于是仍然各抄各的。ESLint 因历史原因整体忽略 `tests/ux/**`（页内代码写成字符串，ESLint 看不见），任何 `no-undef` 都不会跑。铁律 ⑩⑪⑫ 均不适用（不涉及意图 / 模型参数 / 点击预期的产品行为），类根因在测试仪器层。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 下一次外壳变动（抽屉合并、设置换页签、顶栏改分段）夜跑再红一片 | 夜跑按首错签名分簇，看「找旧入口」簇是否再超过 5 条 |
| 新走查再漏一个 import，整条 0/3 红却混在外壳红里 | `pnpm run check:walkthroughs` 的 `undefined-identifier`（本次新增，硬零） |

### 4. 靶子独立性检查

尺子是门岗自己的单测里的阳性对照（漏 import 的真实形状必须被报）+ 对当前 main 的实测（修前 7 处红、修后 0 处绿），不是迁移这一线自己画的。走查本身的业务断言一条没删来换绿：被退役的断言逐条列在交付报告里，每条写明现役合同是什么。无「修对反而掉分」先例。

### 5. P0：这些是我们独有的吗？现成方案有哪些

- **no-undef 静态检查：不是我们独有的**，直接用 ESLint 自带的 `Linter` + `no-undef` 规则（`scripts/lib/walkUndefinedIdentifiers.mjs`，一个函数，不自写任何分析）。没有把整个 `tests/ux` 挪出 ESLint 忽略名单：那会带进主配置里所有为产品源码写的规则，几百份走查一次性红一片，属于另一刀。
- **旧外壳字面量门岗：是我们独有的**。它认的是 Nomi 自己的 DOM / 文案，没有任何现成工具知道「素材库导轨钮已经叫素材」。登记在 `gate-family`（under-review，reviewBy 2026-10-31）：本次只往既有的 `raw-shell-anchor` 规则里加了几条字面量，没有新增 `check:*` 脚本，也没有新增门岗家族成员。
- 外壳出口（`_shell.mjs`）：属于「走查怎么操作我们的外壳」，是领域；操作本身用 Playwright 的角色 / data 属性定位，没有自造定位层。

### 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | ESLint `Linter` 只开 `no-undef`，挂进 `check:walkthroughs`（出处：eslint.org/docs/latest/integrate/nodejs-api） | 小 | 低（只判标识符，页内代码字符串看不见，已写明） | **采用**（no-undef） |
| 补 | `_shell.mjs` 补全出口；`raw-shell-anchor` 加旧字面量 | 中（迁移 42 条 + 同类 30 多处） | 低（业务断言不动；本机屏外各簇抽跑中英） | **采用**（出口与字面量），为什么不换：出口本就是唯一出口，缺的是覆盖面，换不出更小的东西 |
| 重写 | 把走查改成页面对象 / 声明式清单 | 大，要重写几百份 | 高 | 否（不在这一刀） |
| 删 | 删掉过期走查 | 小 | 高（丢掉仍有价值的业务断言） | 否；只退役「现役合同已明确替代」的外观断言，逐条列出 |

### 7. 用户要权衡的核心

`gate-family` 还在「只加不减」：这一刀又给它加了一条规则（`undefined-identifier`）和几条字面量。要不要在门岗账本出来后，把「走查目录并进 ESLint 主配置」排进门岗合并清单——那样 `undefined-identifier` 这条自写封装本身就可以删掉。

## 特征测试清单

已钉住：`scripts/check-walkthroughs.node-test.mjs`（`raw-shell-anchor` 新旧字面量的阳性 / 阴性对照、`undefined-identifier` 的阳性 / 阴性 / 语法错对照）、`tests/ux/_launchApp.test.mjs`（`quiet-walk default` 屏外开关）、`tests/ux/storyboard-editor-entry.test.mjs`（方案行唯一入口）。
