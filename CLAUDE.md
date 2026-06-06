# Nomi — 工程纪律速览

> 每次 session 读完这份再动手。详细规则按需查 `CLAUDE-RULES.md`。

## 项目概览

Nomi：本地优先 AI 视频创作工作台。
**技术栈**：Electron + React 18 + Tailwind 3 + Zustand + Vercel AI SDK。
**主要模块**：项目库 → 创作（文本）→ 生成画布（节点系统）→ 时间轴预览 → 导出 MP4。
**设计系统**：`Design.md` + `src/design/`，token-only，光模式，密度优先。
**工作树**：`/Users/aoqimin/Desktop/Nomi/`，分支 `main`，直接在 main 上 commit + push。

## 常用命令

| 命令 | 用途 |
|---|---|
| `pnpm dev` | 开发模式启动（Vite + Electron） |
| `pnpm build` | Vite 构建 + electron tsc |
| `pnpm run test` | Vitest 单测 |
| `pnpm run test:e2e` | Playwright smoke（零额度，CI-ready） |
| `pnpm run lint:ci` | Lint + max-warnings=98 棘轮（新增 1 个 warning 即红）|
| `pnpm run typecheck` | TypeScript 双向类型检查 |
| `pnpm run check:filesize` | 巨壳文件门岗 |
| `pnpm run check:audit` | 审计节奏提醒（≥25 commit 提示） |

**Push 前必须全过**：`check:filesize` → `lint:ci` → `typecheck` → `test` → `build`

## 五条核心原则

**P1 加新必删旧** — 引入新实现时同 commit 删旧实现，无并行版、无 fallback、无逃生口。CSS 同理：新样式只写组件 `className`，迁 Tailwind 即删旧 CSS；全局 CSS 只可减不可增。

**P2 修根因不修症状** — 看到 bug 先分：症状 / 根因 / 这类 bug 的入口集。修在根因层，让整类不再复发，配结构保证（测试/不变量）。自检：「修完后这个问题还能从别的入口出现吗？」答不出"不能" = 没到根因。

**P3 全绿 ≠ 完成** — CI 五门只证代码健康，证不了体验对不对。用户可见改动报完成前：① 和获批样张逐项并排对账；② 真体感走查（Playwright 截图人眼判断，不是 expect 断言）。缺一不算完成。

**P4 通用第一** — 能力/组件/交互按「模型身份 / 通用场景」设计，与具体供应商/模型解耦。不为不同模型写两套 UI（那是并行版，违反 P1）。档案声明槽，通用系统负责填。

**P5 想清楚再动手** — UI 改动**先读设计系统 `docs/design/nomi-design-system.md`（token/组件/规范）再画**，再出可视样张（HTML mockup）+ 用户拍板；架构改动先查 Context7 官方文档 + 读顶尖开源代码 + 6 角色评审；多文件改动先写 `docs/plan` 文档。

## 动手前自检

1. **在修 bug？** 挖到根因了吗，还是在让现象消失？症状/根因/类分清了吗？（→ P2）
2. **被现有代码框住了？** 从「这东西本该是什么」推解法，而不是从「它现在怎么写」推。
3. **hardcode 了？** 随输入变的东西必须 derive，不能钉死常数。
4. **造第二份真相源 / 并行版了？** 有没有现成可复用的？（→ P1）
5. **旧的删了吗？** 加新 = 删旧，CSS 同理。（→ P1）
6. **碰第三方库？** 先查 Context7 官方文档，不凭记忆手搓。（→ R5）
7. **用户可见改动？** **先读设计系统 `docs/design/nomi-design-system.md`（token/组件/规范）再画**，再出样张；token-only（禁非 token 的 px/hex）；渐进展开 / 防遮挡 / 空间极简。（→ R8）
8. **准备 push？** 五门全过了吗？（→ R11）
9. **要报完成？** 和样张对账过了吗 + 体感走查过了吗？（→ P3）

## 规则索引（详见 CLAUDE-RULES.md）

| # | 规则 | 一句话 |
|---|---|---|
| R1 | 加新必删旧 | 新替旧必同 commit 删旧；CSS 只可减不可增（R10 = R1 的 CSS 实例）|
| R2 | 用户视角 + 极简 | 每条信息问「有行动价值吗」，没有删；好产品不靠文字解释 |
| R3 | 决策对比表 | 涉及取舍先给用户对比表（方案/用户看到/代价），不单方面开干 |
| R4 | 执行前写文档 | 多文件/多步改动先写 `docs/plan`：范围/不动项/回滚/验收门 |
| R5 | 查官方文档 | 碰第三方库必先 Context7，不凭记忆；不查就写 = 工作错误 |
| R6 | 读顶尖开源 | 做方案前先读真实代码（Cline/ComfyUI/xyflow…），给出 file:line |
| R7 | 6 角色评审 | 项目方案定稿前：CTO / 设计 / PM / 前端 / 后端 / 真实用户各审一遍 |
| R8 | 先出样张 | 用户可见改动先出 mockup + 用户拍板；实现后必须与样张逐项对账 |
| R9 | 模块化 + 防巨壳 | 写码前想清楚分层；单文件 ≤800 行；白名单巨壳只减不增（R12 = R9 的量化门岗）|
| R10 | → R1 CSS | `src/styles/` 只可减不可增；新样式只写组件 className |
| R11 | 自动 commit/push | 验证通过即自己 commit + push；五门全过才能 commit |
| R12 | → R9 巨壳 | `check:filesize` 门岗；白名单基线只降不升 |
| R13 | 体验走查 | Playwright 走真实用户旅程 J1-J5（创作目标，不是功能探索）；截图人眼判断 |
| R14 | 周期审计 | ≥25 commit 或发版前：多维 subagent 审计 + 走查 + `docs/audit` 文档 |

## 决策自治

**自己定**（做完一句话说明）：实现细节、命名、模块拆法、测试策略、bug 修复顺序。

**才问用户**（AskUserQuestion，合并成一轮，给推荐项）：产品方向/不可逆取舍 / 架构岔路（影响大、多个合理解）/ 需要用户独有资源（API key、额度、真实素材）。

**遇到样张/需求自相矛盾**：停下上报，不许自己挑一条实现。

## 工作目录

唯一工作树：`/Users/aoqimin/Desktop/Nomi/`，分支 `main`。
操作文件用绝对路径；若用 worktree 将来扩展分支，务必放在仓库目录**同级**（非嵌套）。
