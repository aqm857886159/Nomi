# 单一语义真相源门岗实施计划

> 状态：✅ 本地实施与双审完成；待 PR Required Quality Gate / Mac Package 验证后合入。前置于 ProjectAgentHost、MCP、Skill 与内嵌 Agent 的统一实施。

## 为什么先做它

当前真正的风险不是大家不知道“不要重复实现”，而是写新代码时不知道仓库里已经存在第一套。#195 提出了正确方向，但原扫描器只识别单行单引号 union；多行、双引号、`z.enum`、`as const`、`Set` 和完全相同的第二份定义都会漏掉，也没有门岗自身的自动测试。

本阶段先把“检索失败”变成每个 PR 都会红的结构信号，再开始统一 Agent。它不是万能相似代码检测器：词表由机器守；工具面、权限、字段来源和对偶路径由 R14.1 所有权审计守；ProjectAgent 阶段再为唯一能力注册表和唯一执行器增加专门的 owner/projection 门岗。

## 范围

- `CLAUDE.md` 是规则唯一真源；重新生成 `AGENTS.md`，不手工维护两份。
- 新增 AST 版 `scripts/check-vocabularies.mjs` 和当前代码基线。
- 新增 checker 自测，先证明重复定义、成员漂移、陈旧基线和债务偷换会红。
- 将 `check:vocabularies` 接入 `pnpm run gates`；由现有 `check:gates-chain` 防止未来冲突时静默丢门岗。
- 把 R14.1 七维人工检查和“对偶路径”问法写入工程规则。

## 不做

- 不合入 #195 的 Skill 导入、UI、zip 或安全实现；它们需在最新 main 上单独重做和验收。
- 不声称静态扫描能判断两个不同名字的工具是否同义。
- 不在本 PR 重构产品状态实现；当前 AST 识别 167 个 owner，其中 83 个合法领域/视图合同登记为 `registered`，84 个重复、派生或缺少中立共享 owner 的定义登记为 `debt`。后续统一阶段只允许减少 debt，不允许等量偷换。

## 门岗合同

1. 扫描 `src/` 与 `electron/` 的 TS/TSX/MTS/CTS，使用 TypeScript AST。
2. 识别字符串 union、`z.enum([...])`、`as const` 字符串数组和 `Set([...])`。
3. 每个定义用稳定的“文件 + 声明路径”登记；成员完全相同但出现在第二个声明，也属于新定义并报红。
4. baseline 分 `registered` 与 `debt`：两者都必须写自足理由；成员或位置变化必须显式更新；陈旧条目报红。历史棘轮同时对 PR base、工作树 HEAD、父提交与最新 main 取更紧约束，禁止删档重建、debt 上限增长、等量偷换或把 debt 改名冒充 registered。
5. 失败信息给出最近的已有定义、成员差异和 owner，帮助复用而不是只说“不许”。
6. 更新模式只能生成待解释条目；留下 `TODO` 时门岗仍红。

## RED → GREEN 顺序

1. 先写 fixture 测试，确认当前/原 #195 实现无法识别多行、双引号、Zod、数组、Set、完全复制、陈旧基线与等量债务替换。
2. 实现最小 AST 扫描与稳定 owner 身份，使定点测试转绿。
3. 从当前 `origin/main` 生成 baseline，逐项沿用/修订 #195 已说明的合理独立理由和债务理由。
4. 接入 package gates，验证把脚本从长链拿掉时 `check:gates-chain` 会红。
5. 运行门岗定点测试、全量 `pnpm run gates`、Mac Package required check。

## 回滚与安全

- 本 PR 只新增检查和文档，不改变产品运行行为。
- 回滚只需撤销该 PR；不触碰用户数据、模型请求、预算和凭据。
- 门岗误报必须修扫描规则或登记真实理由，不允许用 ignore/扩大基线糊绿。

## 验收

- checker 阳性/阴性 fixture 全绿，且人工放入第二份完全相同定义时必红。
- 当前仓库扫描绿；所有 baseline 条目都能定位到真实 owner、无 TODO、无陈旧条目。
- `check:vocabularies` 可从 `gates` 传递到达。
- `check:agents-sync` 证明 `AGENTS.md` 与 `CLAUDE.md` 一致。
- 完整 gates、Required Quality Gate 与 Mac Package 通过后才合入 main。
