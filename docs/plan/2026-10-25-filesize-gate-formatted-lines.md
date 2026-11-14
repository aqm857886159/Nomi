# 设计卡：格式化代码行文件体积门岗

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：`check:filesize` 改为 Prettier 归一化代码行 + 650/800 门槛与冻结棘轮
线/负责人：Codex / chore-filesize-gate-formatted-lines
类别：门岗、规则、测试、数据格式

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式
- [ ] 新增功能 / 性能

## ★0 先查别人

- [ESLint max-lines 官方规则](https://eslint.org/docs/latest/rules/max-lines) · 用 `skipBlankLines` 和 `skipComments` 排除空行、注释，但仍直接量源文件物理行 · 确认本门岗可以借用“空行/注释不计”的语义，却必须另加 Prettier 归一化来防止压行。
- [cloc 官方说明](https://github.com/AlDanial/cloc) · 分开输出 physical、blank、comment、code，并按语言识别注释 · 确认代码/注释/空行应分开表达，但没有仓库 Prettier 配置和顶层声明提示，所以不替代本门岗。
- [tokei 官方说明](https://github.com/XAMPPRocky/tokei) · 按语言汇总 total/code/comments/blanks · 确认统计工具的分类方式与本次“代码行”目标相近，但本次决定保留仓库内 Node 门岗以便 CI 和 AST 提示在同一处完成。
- [Prettier API 官方文档](https://prettier.io/docs/api) · `prettier.format(source, { filepath })` 按路径解析配置并返回格式化文本；实测本仓 40 属性对象压成一行后恢复为 45 行 · 确认门岗先以内存格式化再计数，压行不能逃逸。
- [TypeScript compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) · `createSourceFile` 解析 TS/TSX 顶层声明，可取得节点起止位置 · 确认 650 黄牌必须点名最大的职责块，而不是只报一个数字。

## ★1 用户怎么用

当作者修改 `src/` 或 `electron/` 的生产 TypeScript 文件时，我想在提交前看到稳定的体积判定和可执行的拆分提示，以便按职责拆模块，而不是靠删空行、删注释或压成一行过门岗。

1. 修改一个生产 `.ts/.tsx/.mts/.cts` 文件。
2. 推送快检只把改动文件交给 `check:filesize`；完整门岗扫描全仓受跟踪文件。
3. 门岗以内存方式套仓库 Prettier 配置，排除空行和纯注释行，计算格式化代码行。
4. 650–800 行输出黄牌并列出最多三个最大顶层声明；超过 800 行输出红牌并阻断。
5. 已冻结文件超过其基线输出红牌并点名最大声明；低于基线输出下调提示。

真实任务：`pnpm run check:filesize` 全仓扫描；`scripts/check-file-sizes.test.mjs` 夹具矩阵；改动文件由推送快检调用。主指标是“超过 800 行的非白名单生产文件被阻断比例”，量具为 `pnpm run check:filesize` 和对应 Vitest；目标 100%，基线为旧物理行门岗。质量指标是 650 黄牌包含正确顶层声明名，量具为 `scripts/check-file-sizes.test.mjs`；护栏指标是全仓运行不超过 30 秒，量具为 shell `time` 收据。

不做业务文件拆分、不修改真实用户资料、不推送；已知坑是 Prettier 配置或 AST 解析失败必须显式红牌，不能静默按旧口径放行。

## ★1b 连带界面

无用户界面；连带输出只有终端、推送快检和 CI 日志。通过输出“格式化代码行口径、冻结基线数量”；黄牌输出上限下调和最大顶层声明；红牌输出超限文件、当前值、上限和最大声明；格式化失败直接报错。

## ★2 谁说了算

文件体积门岗基线的唯一 owner 是 `scripts/file-size-baseline.json`，判定和提示的唯一 owner 是 `scripts/check-file-sizes.mjs`；允许的消费者是 `package.json` 的 `check:filesize`、推送快检和 CI。状态只在门岗进程内计算，不写项目数据。`node scripts/door-map.mjs --roots=scripts check-file-sizes.mjs check:file-size` 输出 0 扇生产写/读门；测试只通过命令行夹具调用。基线同一份文件按 `kind: legacy|frozen` 区分，事实只存一份。

## ★3 一致与复用

复用仓库已有 `scripts/lib/gitPaths.mjs`、Prettier API 和 TypeScript compiler API；不自写格式化器、不引入新包。已有旧物理行计数和白名单逻辑由本次同提交删除，不保留并行判据。`check-file-sizes.test.mjs` 复用现有临时目录和 git 夹具。

## ★4 全状态

- 空：没有受跟踪生产文件，输出通过且列出扫描为 0。
- 加载：扫描开始时只在终端显示命令运行中，无中间假成功。
- 成功：所有文件 ≤800 且冻结项未涨，退出码 0。
- 失败：任一文件 >800、冻结项涨线、基线新增/上调、格式化或 AST 解析失败，退出码 1 并点名原因。
- 部分成功：存在黄牌但无红牌，退出码 0，黄牌逐项输出。
- 取消中：不适用；这是一次性本地命令，收到中断由 shell 负责结束，不能写入部分基线。
- 过期：不适用；基线只随提交更新，旧基线变更按比较规则报红。
- 能力不可用：Prettier/TypeScript 依赖缺失或无法解析时输出明确错误和下一步 `pnpm install --frozen-lockfile`，退出码 1。

## ★9 验收与回滚

动手前固定验收清单，验收线只核这些项目：

1. 900 行内容压成约 300 个物理行，格式化代码行仍约 900，红牌。
2. 删除全部注释后，代码行判定不变。
3. 651 行输出黄牌，且点名 AST 最大顶层声明。
4. 801 行输出红牌。
5. 冻结文件涨 1 行输出红牌，提示含最大顶层声明名。
6. 冻结文件减行输出黄牌，提示下调上限。
7. 基线新增一条冻结输出红牌。
8. 基线上调一条上限输出红牌。
9. 去掉“清单只许变短”比较后，新增条目反例必须变红。
10. 原始行数口径变异后，压行反例必须变红。
11. 旧 5 个白名单按新口径只在本次迁移基线中允许一次；之后的新增和上调均红。
12. 全仓命令在 30 秒内结束，并交耗时与退出码。
13. `check:rule-aliases`、`check:claude-hooks`、`check:agents-sync`、`check:main-guard`、`check:i18n`、typecheck、改动文件 ESLint 和相关 Vitest 全部有收据。

反例覆盖入口、形状和边界：新文件、旧冻结文件、旧 legacy 文件、压行、注释、TSX、`.mts/.cts`、格式化失败、缺依赖和 `origin/main` 基线漂移。实现线逐项记录“反例 → 结果 → 证据”。

回滚：`git revert <本次提交>`，恢复旧物理行门岗和旧规则视图；不改远端默认分支、不使用 reset。

## 拍板

用户 10-25 原话：「800 行门禁冻结超线的 32 个、按职责逐步拆」。
