# 常用命令与门岗（L2）

> 从 CLAUDE.md 搬来（规则体系瘦身，docs/plan/2026-10-01-rule-reminders-slimming.md）。CLAUDE.md 只留最常用的 7 条；这里是全表。
> **用到时怎么保证看到**：`self-check.sh` 在用户消息含「gates / check: / 门岗 / 命令」时注入指向本文件的【命令全表】块；CLAUDE.md 的「常用命令」一节也直接指向它；`package.json` 是真相源。

| 命令 | 用途 |
|---|---|
| `pnpm dev` | 开发模式启动（Vite + Electron） |
| `pnpm build` | Vite 构建 + electron tsc |
| `pnpm run test` | Vitest 单测 |
| `pnpm run gates` | 五门（按风险分档）：contracts 全部 + **改动相关**的测试 + build + 盖戳；碰测试基础设施/删改名/空 diff 自动升全量并打印原因 |
| `pnpm run gates:full` | 五门全量档（今天的全量测试）：测试基础设施改动、手动发布边界、想自己兜底时用 |
| `pnpm run test:core-smoke -- --fixture <empty\|used\|profile-copy>` | 核心流程冒烟（空节点 composer / 「2 版」托盘 / 编组框删除+⌘Z / 平移手势）：非纯文档 PR 与 main push 必跑，CI 两遍（空项目 / 用过的项目）；`profile-copy` 只在本机、深拷贝真实资料跑完即删。清单唯一 owner `tests/ux/core-smoke/scenarios.mjs` |
| `pnpm run test:system:focused` | 普通 PR 的 changed/sibling/related tests；仍须配合 contracts |
| `pnpm run test:system:full` | 测试基础设施或手动发布边界的显式全量本地验证 |
| `node scripts/merge-preflight.mjs <PR 号>` | 协调会话合并前扫描：四类判定、设计卡格、独立验收、逃逸合同、规则与门岗改动范围（正文 `## 碰到的规则与门岗` 逐个点名，账本条目不许消失）；只打印结论 |
| `pnpm run delivery:preflight` | 任务开始前有界刷新远端基线并验证独立干净分支 |
| `pnpm run delivery:verify-merged -- --expected-sha <SHA>` | 在真实 merged-main 上记录 exact-SHA CI checks 收据，不本地重跑 |
| `pnpm run test:e2e` | Playwright smoke（零额度，CI-ready） |
| `pnpm run lint:ci` | Lint + max-warnings=98 棘轮（新增 1 个 warning 即红）|
| `pnpm run typecheck` | TypeScript 双向类型检查 |
| `pnpm run check:filesize` | 巨壳文件门岗 |
| `pnpm run check:tokens` | 设计 token 门岗（禁任意 px 字号/圆角、hex 色、默认色板；棘轮只减不增）|
| `pnpm run check:heavy-path` | 重活门岗（同步图像编码 / base64 进 store / 尺寸双真相源；棘轮只减不增）|
| `pnpm run check:vocabularies` | 单一语义 owner 门岗（AST 扫状态/阶段词表；新增、复制、成员/位置漂移、陈旧登记或 debt 增长都会红）|
| `pnpm run check:i18n` | 可见文字国际化门岗（禁止新增硬编码 UI 文案；遗留基线只减不增）|
| `pnpm run check:framework-boundary` | 框架边界门岗（框架已提供的能力不许再长一份自研版本；债只减不增、绑方案、到期即红）|
| `node scripts/door-map.mjs <符号或文件>` | 数门（列出一份状态的全部写/读入口，输出直接粘进根因合同 `doors`）|
| `pnpm run check:real-media-fixture` | 真实素材门岗（画布性能/导入/导出/走查四类各至少一条真素材测试；合成夹具棘轮只减不增；缺素材硬红不许 skip，CI 未就位期只能记带到期日的债）|
| `pnpm run check:rule-aliases` | 规则编号解析门岗（家规文件里任何 `R<数字>` 都要解析得到——合并规则不许留悬空引用）|
| `node scripts/fix-churn.mjs <路径>` / `--staged` / `--range <base>..HEAD --warn` | 方向检查计数器：文件 / 概念目录 / concept-owners 概念 14 天内、自写登记条目 30 天内（第 2 个就命中）的 fix 与 revert-fix 数，命中就改派类根因复盘（RW，编排手册 §20） |
| `node scripts/check-dispatch-brief.mjs <任务书.md>` | 派工书检查：有没有写范围、不碰清单、停点、补还是换（近 14 天修几次 / 有无成熟方案 / 补换删）；第 3 轮修补必须引用复盘文档 |
| `pnpm run check:self-written` | 自写登记门岗（P0：diff 里在 `src/`、`electron/` 新增、落在领域目录之外又没被登记表认领的代码文件就报；`enforceFrom` 之前警告、之后阻断；测试 / 类型声明 / 纯接线豁免）；另外：`under-review` 过了 `reviewBy` 且这次改动碰它的文件就红（改离 under-review 才算评估 / 替换），新登记 ≤30 天、最多续一次（`renewed` 记录），`to-replace` 的文件都没了就红「请删登记」|
| `node scripts/self-written-review.mjs`（`pnpm run audit:self-written`） | **排版本计划时跑一遍，把到期清单（待替换 / 评估到期 / 复查日已到）给用户看**，结论改回 `self-written.json`，不只写在计划里 |
| `pnpm run check:framework-surface` | 框架接触面门岗（登记框架公开的**每个字段**都要有一条裁决：派生/常量/不用/上游默认/带到期日的债；上游升级加字段即红）|
| `npx skills experimental_install` | 从 `skills-lock.json` 还原 `.claude/skills/`（换机/协作者用） |

## 体系工具（2026-10-02）

| 命令 | 用途 |
|---|---|
| `node scripts/merge-preflight.mjs <PR 号>`（`pnpm run merge:preflight -- <PR 号>`）| 协调会话合并前扫描：四类判定、设计卡格、独立验收、逃逸合同、规则与门岗改动范围（正文 `## 碰到的规则与门岗` 逐个点名，账本条目不许消失）；只打印结论 |
| `pnpm run eng:metrics` | 工程三个数一行（逃逸率 · 30 天复发 · 门岗误报 · 到期合同）；SessionStart 也会打印；不作为任何通过条件 |
| `node scripts/gen-rules-view.mjs` | 由 `docs/engineering/rules.json` 重新生成可读视图 `rules.md` |
| `pnpm run handoff:report -- <branch>` | 交接体检报告（原 `check:handoff`，不是门岗） |
| `pnpm run check:escape-ledger` | 逃逸账本结账门岗（P2：账本格式不合法 → 红；条目改成 `fixed` 必须同时有根因合同、类级检查（铁律 ⑩ ⑪ ⑫ / inv:N 或矩阵 / 普查测试）、合入 PR 号；`candidate` 超 14 天警告。细则见 `docs/engineering/experience-system.md`） |
| `pnpm run check:pr-judgement` | PR 正文判据（CI Contracts + push 前）：按功能分类推路由——设计卡 `### 功能分类` 必须覆盖路径推出的类别、`## 验收证据` 逐项有证据或「未验证：原因」；并判规则与门岗改动范围（`## 碰到的规则与门岗` 逐个点名）。路由表 `docs/engineering/test-routing.json`；`--gaps` 列出工具缺口 |
