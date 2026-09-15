# 规则执行审计 — 可机器化分诊表（2026-09-03）

> 本文件由家规瘦身执行班在 `docs/claude-md-slim-20260903` 分支产出。
> 分诊依据：「已被门岗/hook/skill 完全覆盖 → 可从 L1 删；纯靠判断 → 保留」。
> 逐条标注「删减来源/覆盖者」，确保可追溯。

## 判据

| 类别 | 处置 |
|---|---|
| 纯靠判断（P0–P5, D1–D6, 决策自治边界, 并行纪律中靠人裁的部分） | 保留 L1 |
| 已被门岗/hook/skill 完全覆盖 | 从 L1 删/降级到 L2 |
| 同一族多条说同一件事 | 合并最锋利措辞 |
| 细节无需 always 加载 | 移位到 L2，L1 保留一句索引 |

## 分诊表

### 已删/降级条目（可追溯）

| # | 原位置 | 内容摘要 | 被谁覆盖 | 处置 |
|---|---|---|---|---|
| A1 | CLAUDE.md 文件头 preamble（L2触发才查行、查现状行） | L2/L3 层指针的详细说明 + ARCHITECTURE-NOW 存在的故事 | 指针本身保留，verbose 解释移除；新 AI 看 preamble 能找到所有文件 | 压缩：保留层指针，删 2026-08-27 故事句 |
| A2 | CLAUDE.md 维护纪律段（hook 安装机制说明） | postinstall 自动装、换机不需手动复制、worktree 要先 pnpm install、旧戳 TTL 细节 | `check:claude-hooks` 门岗 + postinstall 脚本；hook 安装机制是实现细节属 L2 | 压缩：保留「真相源 scripts/claude-hooks/，check:claude-hooks 验同步」一句，删机制细节 |
| A3 | CLAUDE.md 维护纪律段（AGENTS.md 漂移故事） | 2026-08-25 双份手工维护撞号故事（完整案例） | check:agents-sync 门岗 已硬拦漂移；故事属教训应在 docs/lessons/ | 保留「禁止手改 AGENTS.md，改纪律只改 CLAUDE.md + gen:agents」，删故事 |
| A4 | CLAUDE.md 三闸段（三闸详细展开） | 动手前/报完成前/push 前的详细 inline 规则（与 hook 几乎逐字重复）| self-check.sh hook 每轮注入三闸全文；L1 重复只增加上下文长度 | 压缩为 2 句：「三闸由 hook 自动注入，不在此复述。细节见 self-check.sh + CLAUDE.md §P1–P5。」 |
| A5 | CLAUDE.md 每日雷达「抓的时候不是随便抓」（4 维细节） | 论文雷达的 4 维筛选标准（最新/火不火/有没有用/成熟度）| nomi-research-radar skill 内已包含筛选逻辑；L1 无需重复维度列表 | 删 4 维列表，保留「维度见技能」一句 |
| A6 | CLAUDE.md 并行纪律（ponytail/force-push 长注释） | 「评审钩子按远端旧 tip→新 tip 算…重建一律走新分支，见 R25」注释块 | R25 行的索引已指向详细规则；实现细节属 L2 | 删括号内实现细节，保留「不 force-push main / 不向已存在远端分支 force-push 重建内容」核心约束 |
| A7 | CLAUDE.md P1 段（搬家不留转发壳·现存29个反例） | re-export 壳细节 + 现有数量 | check:filesize + 代码审查；数量会过期；具体规则在 L2 R1 | 删「搬家不留转发壳」段落，L2 R1 已有 |
| A8 | CLAUDE.md P2 段（schema-v3/recurring 细节） | recurring/高风险交 schema-v3 合同、旧 v1/v2 只读 | check:root-cause-contracts 门岗 + R21 行已索引 | 保留 P2 的判断部分，删 schema-v3 合同细节（属 L2 R21）|
| A9 | CLAUDE.md 三闸段 inline 控件层级规则 | §1.5 控件层级规则·手法优先级·先分组→再去重→再归位 | 设计系统文档 docs/design/nomi-design-system.md §1.5；P5 已指向 | 删 inline 展开，P5「加/挪控件先过设计系统 §1.5」保留 |
| A10 | CLAUDE.md 三闸段 inline derive/hardcode 三次前科 | 「含门岗断言：不许在测试/门岗里手抄真相源…栽过三次：账本/CI/>=22工具数」| check:vocabularies + check:heavy-path 硬拦；前科属 docs/lessons | 删 inline 前科罗列，保留「随输入 derive 不 hardcode」原则 |
| A11 | CLAUDE.md 工作目录 worktree 政策（两点视图长注释） | 「评审/对账/打捞任何分支先算 merge-base——对 main 两点视图里的大片删除…见 R22」| docs/lessons 教训文件已覆盖；R22 行索引 | 删括号内实现细节，保留「评审任何分支先算 merge-base」核心规则 |

### 合并条目

| 合并后 | 原来多条 | 合并理由 |
|---|---|---|
| R1 行精简（删「搬家」附注） | R1 行 + P1 段搬家附注 | 同一规则两处说 |
| 三闸合并为 2 句 | 三闸段 + P5 的 inline 展开 | hook 已全覆盖 |
| 维护纪律段压缩为 3 句 | 原 preamble 中维护纪律两段（hook 安装 + AGENTS 故事） | 机器门岗覆盖实现细节 |

### 保留条目（及理由）

| 保留 | 理由 |
|---|---|
| P0–P5 全文 | 纯判断，机器替代不了 |
| D1–D6 全文 | 纯判断，用户决策逻辑 |
| 决策自治边界（自己定/才问用户/遇到矛盾） | 纯判断 |
| 并行纪律（worktree 基本规则） | 靠人裁的操作规范 |
| 规则索引表（所有 R# 行） | 指针，新 AI 需靠它找 L2 细节 |
| 每日雷达触发逻辑（今天有没有 → 跑/跳过） | 纯判断逻辑，无法机器化 |
| 项目概览、常用命令表 | 项目事实，must-load |

## hook 瘦身草案

### 目标

三闸注入文本压到核心三行以内；「近期坑」保留 Top 2（当前 Top 3）。

### 瘦身原则

- 「动手写码前」行：删冗余 inline 控件层级规则 + R8 大括号展开（link 到 docs/design）
- 「报完成前」行：删「眼见链四问」冗余细节（保留 P3 引用 + R13 引用）
- 「push 前」行：保持一句「pnpm run gates」
- violations.log 取前 2 条（从 3 改 2）

## 结论

可安全删减的文本约 3,500 字符（约 875 tokens）。
删减后 CLAUDE.md 仍能让新 AI 正确干活：P0–P5 完整、D1–D6 完整、规则索引完整、指向 L2 的指针完整。

## push 绕口留痕（PR #399 补充）

规则审计还发现，`git -c core.hooksPath=... push` 与 `git --no-verify push` 可以绕过 native pre-push hook；仅靠 push 前拦截无法为未安装 Claude hook 的 worktree 留证。PR #399 增加了两段式机器化补强：

- `scripts/claude-hooks/pre-push-check.sh` 在绕过命令放行前写入 `.claude/push-bypass.log`，记录时间、分支、HEAD、worktree 与命令摘要。
- `scripts/check-push-bypass.mjs` 及其行为测试把日志接入 `gates:contracts`：匹配本树、本 HEAD 的 gate stamp 可自动确认，否则必须人工 `--accept <sha>`，未确认记录保持红灯。

该补充是留痕与审计门，不取代既有的 worktree/HEAD gate stamp，也不把旧的文档瘦身审计报告重新复制到本文件。

## 门岗缺陷记账：删掉的门在 corrective 合同里无法表达（2026-09-14，PR #754 撞到）

R21.3「数门」（PR #759，2026-09-11 生效）在 `scripts/root-cause-contracts.mjs` 的
`validateDoorMap()` 里留了一个自相矛盾的组合：**stray 规则只问「改过的生产文件在不在门表里」，
没问「它还在不在」**，而门表每一条又必须过 `fileExists()` + `lineMentionsSymbol()`。
于是一个 P1 式的删除（加新必删旧）在 corrective 合同里三条路全堵：
写进 `scope_paths` 报「门没数全」、写进 `doors` 报「门不存在」、从 `scope_paths` 拿掉报
「高风险文件没有合同覆盖」。

- **现状（已验证可用的绕法）**：删除单独写成 `change_kind: "structural"` 合同——structural 分支在
  `validateContract()` 里早于 `validateDoorMap()` 返回，不跑门表校验。样本：
  `docs/fixes/2026-09-11-catalog-management-entry-removal.root-cause.json`。
  教训条目：`docs/lessons/deleted-file-cannot-be-a-door.md`。
- **正解（待做，本轮未动门岗）**：合同 schema 加 `removed_doors: [{path, line, symbol}]`——
  校验时不要求 path 仍存在，但要求它出现在本次 diff 的删除清单里，并让
  `door_reduction.before - after` 与它的条数对得上。门表由此从「修完还剩几扇」升级成
  「拆了哪几扇、还剩哪几扇」，**减门第一次变成可核对的事实而不是一句自述**。
  最小替代方案是给 stray 过滤加一条 `&& fileExists(file, existingFiles)`，但那只是不报错，
  拆门这件事仍然没有留下任何痕迹。
- **为什么本轮没顺手修**：改 `scripts/root-cause-contracts.mjs` 需要为这次改动自己出一份合同，
  而 `scripts` 在 `check:symptom-cluster` 眼里 7 天内已有 18 份合同，新加一份会立刻要求先出一份
  `scripts` 的结构评审。属于独立一轮的活，不该混进打捞 PR。

## 门岗撞名：两条 `check:tool-face` 与「死掉的门岗不会喊」（2026-09-14 收成一份）

模型可见工具面有两个声明 owner，各自长了一条门岗、**各自都叫 `check:tool-face`**：

| 脚本 | 守哪个 owner | 规则 |
|---|---|---|
| `scripts/check-tool-face.ts` | `electron/shared/agentCapabilities/verbDeclarations.ts`（整个面，64 个工具）| 4 条硬 + 4 条棘轮 |
| `scripts/check-tool-face.mjs`（PR #754，现已改名 `tool-face-onboarding-rules.mjs`）| `electron/capabilityCore/modelOnboarding/declarations.ts`（接模型 4 工具）| O1–O7 + C1/C2 |

`package.json` 里 `check:tool-face` 只有一条，2026-09-13 并 main 时它被指向了后者，
**前者从此不被任何地方调用**（连同它的阳性对照 `check-tool-face.node-test.mjs`），
而且没有任何东西会因此报错——`gates:contracts` 照常绿，因为它执行的是「那个名字」，不是「那些规则」。
顺带被藏起来的还有 4 处真实读数：那条门岗看得见新增的 4 个接模型工具，把它们报成
`mcp-transport-catalog` 新增违规。

- **修法（P1 收成一份）**：`check:tool-face` 只保留一个入口 `scripts/check-tool-face.ts`，
  它同时跑两个规则族；`.mjs` 改名为 `scripts/tool-face-onboarding-rules.mjs`，降级成规则模块
  （导出 `runOnboardingRules` / `runOnboardingSelftest`），**一条规则都没删**。
  两族都跑完再汇总退出码——第一族红就 return 会把第二族的结论藏起来，而「藏起来的门岗」正是本次的病。
- **那 4 处读数的处置**：接模型那 4 个工具不是「手写」，它们从第二个 owner 派生，
  所以 `handwrittenMcp()` 的派生名单同时认 `mcpProfileTools()` 与 `ONBOARDING_TOOL_NAMES`。
  棘轮因此 22 → 18（4 个被正确识别为派生，2 个随旧工具删除消失），**只减不增，未抬高基线**。
- **可机器化的下一步（登记，未做）**：`package.json` 里一个 `check:*` 名字对应多个脚本实现时报红。
  本次是靠人肉读 diff 发现的；同样的撞名可以在任何两条门岗之间再发生一次。
